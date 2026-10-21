#!/usr/bin/env python3
"""Extract build-specific research facts, not a runtime settings implementation.
Keeps declarations, registrations and candidate references distinct.
"""
from pathlib import Path
from collections import defaultdict,Counter
import json,re,hashlib,os
from xml.parsers import expat

ROOT=Path(os.environ.get('POWERAMP_RESEARCH_ROOT','/workspace/work/poweramp'))
OUT=ROOT/'session2/drafts';OUT.mkdir(exist_ok=True,parents=True)
APK='27cfde3fc8e55b2effffe88c7e80ec3a1b1f69ec37a09ef86d9a34aafe8ebb9e'

def short(s):
 if s.startswith('http://schemas.android.com/apk/res/android|'):return 'android:'+s.rsplit('|',1)[1]
 if '|' in s:return 'app:'+s.rsplit('|',1)[1]
 return s

def xml(path):
 p=expat.ParserCreate(namespace_separator='|');stack=[];roots=[]
 def start(tag,attrs):
  n={'tag':short(tag),'attrs':{short(k):v for k,v in attrs.items()},'line':p.CurrentLineNumber,'children':[],'text':''}
  (stack[-1]['children'] if stack else roots).append(n);stack.append(n)
 def end(tag):stack.pop()
 def text(s):
  if stack:stack[-1]['text']+=s
 p.StartElementHandler=start;p.EndElementHandler=end;p.CharacterDataHandler=text
 p.Parse(path.read_bytes(),True);return roots[0]

def src(path,symbol,line):return {'kind':'apk-resource' if path.suffix=='.xml' else 'jadx','path':str(path.relative_to(ROOT)),'symbol':symbol,'locator':f'line {line}'}

def atom(v):
 if v is None:return None
 if v=='true':return True
 if v=='false':return False
 if v=='null':return None
 if re.fullmatch(r'-?\d+',v):return int(v)
 if re.fullmatch(r'-?\d+(?:\.\d+)?f',v):return float(v[:-1])
 if v.startswith('"') and v.endswith('"'):
  try:return json.loads(v)
  except ValueError:return v[1:-1]
 return {'expression':v}

strings={};arrays={};resource_sources={}
for f in sorted((ROOT/'decoded/res/values').glob('*.xml')):
 for e in xml(f)['children']:
  name=e['attrs'].get('name')
  if not name:continue
  if e['tag']=='string':strings['@string/'+name]=e['text'];resource_sources['@string/'+name]=src(f,name,e['line'])
  if e['tag'] in ('array','string-array','integer-array'):
   arrays['@array/'+name]=[c['text'].strip() for c in e['children']];resource_sources['@array/'+name]=src(f,name,e['line'])

def label(v):
 if v is None:return None
 return {'reference':v,'base_label':strings.get(v,v) if len(strings.get(v,v))<=200 else None}

def array(v):
 if v is None:return None
 return {'reference':v,'base_items':[{'raw':x,'base_label':strings.get(x,x)} for x in arrays.get(v,[])], 'source':resource_sources.get(v), 'conditions':['Base resource declaration; localized/qualified resources and helper replacements may differ.']}

def role(tag,a):
 t=tag.rsplit('.',1)[-1]
 if t in ('PreferenceScreen','PreferenceCategory') or t.endswith('PreferenceCategory'):return 'container'
 if 'Redirect' in t or 'Redir' in t:return 'navigation'
 if t in ('RawTextPreference','LicenseStatusPref','ManageAppWarnPref','PowerampLogoPreference','UberLevelPref'):return 'information_or_status'
 if t in ('Preference','ButtonPref','ProgressPreference') or 'Restore' in t or t.startswith('Buy') or t=='FeaturePackPref':return 'action_or_dynamic'
 if t=='TagsPreference' or any(x in t for x in ('Switch','ListPreference','Seekbar','Knob','ColorPreference','EditText')):return 'value_control'
 return 'custom_control_unclassified'

pages=[];occurrences=[]
keep={'android:key','android:title','android:defaultValue','android:dependency','android:persistent','android:entries','android:entryValues','android:enabled','android:selectable','app:target','app:values','app:entries','app:min','app:max','app:step','app:interval','app:scale','app:prefType','app:disableDependenciesValue','app:featurePack','app:minSdk','app:maxSdk','app:removeAsNeeded','app:skipSearch','app:searchBreadcrumb1','app:searchBreadcrumb2','app:requiresRecreate','app:multiplier'}
keep.update({'android:singleLineTitle','android:widgetLayout','android:order','app:floatScale','app:snapTo','app:valueFormat','app:separatorChars','app:allowWhitespace','app:tagsLimit','app:listTagsLimit','app:summaryWhenEmpty','app:searchIndexer'})
for f in sorted((ROOT/'decoded/res').glob('xml*/*.xml')):
 root=xml(f)
 if root['tag']!='PreferenceScreen':continue
 page=f.stem;qual=f.parent.name
 pages.append({'id':'settings.'+page,'qualifier':qual,'title':label(root['attrs'].get('android:title')),'source':src(f,'PreferenceScreen',root['line'])})
 def walk(e,anc,path):
  if e['tag']=='intent':return
  a=e['attrs'];key=a.get('android:key');r=role(e['tag'],a)
  oid=f'{page}:{qual}:{".".join(map(str,path))}'
  if path:
   declaration={k:v for k,v in a.items() if k in keep}
   occurrences.append({'id':oid,'page':'settings.'+page,'qualifier':qual,'native_key':key,'control_class':e['tag'],'role':r,'category_path':anc,'title':label(a.get('android:title')),'declarations':declaration,'choices':array(a.get('app:entries',a.get('android:entries'))),'choice_values':array(a.get('app:values',a.get('android:entryValues'))),'source':src(f,e['tag']+(' key='+key if key else ''),e['line']),'status':'CONFIRMED_STATIC','scope':'Declaration, not proof of runtime visibility or final dynamic values.'})
  nextanc=anc+([a.get('android:key') or a.get('android:title') or e['tag']] if r=='container' else [])
  for i,c in enumerate(e['children']):walk(c,nextanc,path+[i])
 walk(root,[],[])

def splitargs(text):
 out=[];start=0;level=0;quote=False;escape=False
 for i,c in enumerate(text):
  if escape:escape=False;continue
  if c=='\\' and quote:escape=True;continue
  if c=='"':quote=not quote;continue
  if quote:continue
  if c in '([{':level+=1
  elif c in ')]}':level-=1
  elif c==',' and level==0:out.append(text[start:i].strip());start=i+1
 out.append(text[start:].strip());return out

registrations=[]
method_map={'a':('int','av1',True,1,0),'c':('boolean','xu1',True,0,1),'b':('string','dv1',True,0,1),'с':('float','zu1',True,0,1),'p':('int','ti0',False,1,0),'X':('boolean','qi0',False,0,1)}
owners=['b40','c40','m30','l30','j30','rr','x11','y11','z30']
stores={'b40':'ftp','c40':'futp','m30':'frp','l30':'foutp','j30':'foutp-{profile identity}','rr':'dspi','x11':None,'y11':None,'z30':'search'}
globalowners={'b40','c40','m30','l30'}
for owner in owners:
 f=ROOT/'jadx/sources/ׅ'/f'{owner}.java';text=f.read_text();lines=text.splitlines()
 fields=dict(re.findall(r'public (?:static )?(?:final )?([\w$]+) ([\w$]+);',text)) # reversed below
 fieldtypes={name:typ for typ,name in re.findall(r'public (?:static )?(?:final )?([\w$]+) ([\w$]+);',text)}
 for n,line in enumerate(lines,1):
  m=re.fullmatch(r'\s*(?:(?:this\.)?([\w$]+) = )?(?:(\w+)\.)?([acbpXс])\((.*)\);',line)
  if not m:continue
  field,receiver,method,argtext=m.groups()
  if receiver not in (None,owner+'Var','this'):continue
  args=splitargs(argtext)
  typ,wrapper,shared,ki,di=method_map[method]
  if len(args)!=2 or not (args[ki].startswith('"') and args[ki].endswith('"')):continue
  key=json.loads(args[ki]);default=atom(args[di]);regid=owner+':'+key
  # A few protected settings retrieve the just-registered pref and assign it later.
  if not field:
   for following in lines[n:n+7]:
    fm=re.match(r'\s*([\w$]+) = \((qg0|ih)\) ceVar\w*;',following)
    if fm:field=fm.group(1);break
  registrations.append({'id':regid,'native_key':key,'owner':owner,'field':field,'wrapper':wrapper,'value_type':typ,'registered_default':default,'default_expression':args[di],'store':stores[owner],'global_adapter_member':shared and owner in globalowners,'registration_method':'y40.'+method,'source':src(f,owner+'.'+(field or '(unassigned)')+' registration '+key,n),'status':'CONFIRMED_STATIC','uncertainties':['Registration default precedes migrations, per-device profile initialization and conditional effective-value gates.']})

regbyfield={(x['owner'],x['field']):x for x in registrations if x['field']}
consumers=defaultdict(list);keyrefs=defaultdict(list)
keys={e['native_key'] for e in occurrences if e['native_key']}
keys.update(x['native_key'] for x in registrations)
fieldpattern=re.compile(r'\b('+'|'.join(owners)+r')\.([\w$]+)')
for f in sorted((ROOT/'jadx/sources').rglob('*.java')):
 if '/com/maxmpz/' not in str(f) and '/ׅ/' not in str(f):continue
 for n,line in enumerate(f.read_text().splitlines(),1):
  for m in fieldpattern.finditer(line):
   reg=regbyfield.get(m.groups())
   if reg and f.name!=reg['owner']+'.java':consumers[reg['id']].append({'path':str(f.relative_to(ROOT)),'line':n,'field':m.group(0)})
  for lit in re.findall(r'"([A-Za-z0-9_]+)"',line):
   if lit in keys:keyrefs[lit].append({'path':str(f.relative_to(ROOT)),'line':n})
for reg in registrations:
 refs=consumers[reg['id']]
 reg['field_reference_count']=len(refs);reg['candidate_consumer_references']=refs
 reg['reference_semantics']='Exact lexical field reference; does not by itself establish consumption, value precedence or an end-to-end effect.'

skin=[];f=ROOT/'decoded/res/xml/poweramp_builtin_skins.xml'
for si,s in enumerate(xml(f)['children']):
 for order,e in enumerate(s['children']):
  a=e['attrs'];key=a.get('key')
  if not key:continue
  opts=[]
  for index,opt in enumerate(e['children']):
   oa=opt['attrs'];val=oa.get('overlapAttr',oa.get('overlapStyle',''))
   opts.append({'index_for_display_only':index,'label':label(oa.get('name')),'selected_resource':val or 0,'overlay_kind':'attribute' if 'overlapAttr' in oa else 'style','source':src(f,key+' option '+str(index),opt['line'])})
  skin.append({'id':f'skin.{si}.{key}','skin_style':s['attrs']['style'],'skin_name':label(s['attrs'].get('name')),'native_key':key,'control_type':e['tag'],'order':order,'title':label(a.get('name')),'declarations':a,'choices':opts,'default_declared':a.get('defaultValue',a.get('checkedByDefault')),'source':src(f,key,e['line']),'status':'CONFIRMED_STATIC','scope':'Built-in skin schema; persisted identifiers and effective style resolution are specified separately.'})

raw_occurrence_count=len(occurrences)
choice_catalog={}
for o in occurrences:
 for field in ('choices','choice_values'):
  data=o[field]
  if data:
   choice_catalog[data['reference']]=data
   o[field]=data['reference']
groups={};merged=[]
for o in occurrences:
 signature=json.dumps({k:v for k,v in o.items() if k not in ('id','qualifier','source')},sort_keys=True,ensure_ascii=False)
 if signature in groups:
  target=groups[signature];target['sources'].append(o['source']);target['qualifiers'].append(o['qualifier'])
 else:
  target=dict(o);target['sources']=[o['source']];target['qualifiers']=[o['qualifier']]
  target.pop('qualifier');groups[signature]=target;merged.append(target)
occurrences=merged

bykey=defaultdict(list)
for o in occurrences:
 if o['native_key']:bykey[o['native_key']].append(o)
regsbykey=defaultdict(list)
for reg in registrations:regsbykey[reg['native_key']].append(reg)
registry=[];conflicts=[]
for key,occs in sorted(bykey.items()):
 matches=regsbykey[key]
 globalmatches=[x for x in matches if x['global_adapter_member']]
 decldefs=[{'occurrence':o['id'],'value':o['declarations']['android:defaultValue']} for o in occs if 'android:defaultValue' in o['declarations']]
 conflicts_here=[]
 if len(globalmatches)==1:
  gd=globalmatches[0]['registered_default']
  for d in decldefs:
   dv=d['value'] if globalmatches[0]['value_type']=='string' else atom(d['value'])
   if not isinstance(gd,dict) and dv!=gd:conflicts_here.append({'control':d['occurrence'],'xml':d['value'],'registered':gd})
 if conflicts_here:conflicts.append({'native_key':key,'registration_id':globalmatches[0]['id'],'classification':'display_unit_conversion' if key=='vis_list_faded_alpha' else 'null_string_getter_fallback' if key=='shutdown_intent' else 'raw_default_difference','differences':conflicts_here})
 classes=sorted({x['control_class'] for x in occs});roles=sorted({x['role'] for x in occs})
 registry.append({'id':'setting.'+key,'native_key':key,'pages':sorted({o['page'] for o in occs}),'roles':roles,'control_classes':classes,'control_occurrences':[x['id'] for x in occs],'declared_defaults':decldefs,'registration_ids':[x['id'] for x in matches],'registered_global_default':globalmatches[0]['registered_default'] if len(globalmatches)==1 else None,'global_default_basis':globalmatches[0]['id'] if len(globalmatches)==1 else None,'persistence':{'classification':'registered_global_adapter' if len(globalmatches)==1 else 'requires_control_or_helper_trace','profiles_or_namespaces':[x['store'] for x in matches],'xml_persistent_flags':sorted({o['declarations']['android:persistent'] for o in occs if 'android:persistent' in o['declarations']})},'dependencies':[{'control':o['id'],'key':o['declarations'].get('android:dependency'),'feature_pack':o['declarations'].get('app:featurePack'),'disable_dependencies_value':o['declarations'].get('app:disableDependenciesValue')} for o in occs if any(k in o['declarations'] for k in ('android:dependency','app:featurePack','app:disableDependenciesValue'))],'candidate_key_references':keyrefs[key],'apply_behavior':None,'deep_trace_ids':[],'coverage':'declared_control_and_registration' if matches else 'declared_control','status':'CONFIRMED_STATIC','status_scope':'Only existence/declarations and matched registration facts; dependencies/effects not fully traced without deep_trace_ids.','uncertainties':['Runtime helper can remove or replace control, values and defaults.','Final effect, reload timing and per-key migration require explicit chain evidence.']})

def write(name,data):
 (OUT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
write('settings-controls.json',{'source_apk_sha256':APK,'scope':'All PreferenceScreen XML variants present in the supplied APK, equivalent declarations merged with all source locations. Declaration inventory, not reachability proof. Choice references resolve in settings-choice-arrays.json.','pages':pages,'controls':occurrences})
write('settings-choice-arrays.json',{'source_apk_sha256':APK,'scope':'Base values for arrays referenced by inventoried controls; dynamic helper replacements and localized labels require their own conditions.','arrays':list(choice_catalog.values())})
write('preference-registrations.json',{'source_apk_sha256':APK,'scope':'Explicit literal-key registrations via six y40 factories in nine settings stores. Untyped/internal/no-key and custom constructors are tracked separately, not silently called user settings.','registrations':registrations})
write('skin-settings-registry.json',{'source_apk_sha256':APK,'scope':'All keyed built-in skin option declarations, maintaining separate Light and Black schema order.','settings':skin})
write('settings-registry.json',{'source_apk_sha256':APK,'scope':'Unique literal keys appearing on PreferenceScreen controls. Same-key controls can have different profile scopes; use occurrences/registration identity, not key alone. Navigation/action/status keys are explicitly separate roles.','settings':registry})
write('settings-default-differences.json',{'scope':'Literal comparison of XML defaults versus registered global defaults; does not declare a bug or a runtime observation.','differences':conflicts})
stats={'preference_xml_files':len(pages),'preference_xml_resource_names':len({p['id'] for p in pages}),'control_occurrences_all_qualifiers':raw_occurrence_count,'control_declarations_after_equivalent_qualifier_merge':len(occurrences),'keyed_unique_controls':len(registry),'unique_value_control_keys':sum('value_control' in x['roles'] for x in registry),'literal_registrations':len(registrations),'global_registrations':sum(x['global_adapter_member'] for x in registrations),'xml_keys_with_registration_match':sum(bool(x['registration_ids']) for x in registry),'keyed_skin_controls':len(skin),'distinct_skin_keys':len({x['native_key'] for x in skin}),'xml_registered_raw_default_difference_keys':len(conflicts),'roles':dict(Counter(o['role'] for o in occurrences))}
write('settings-inventory-metrics.json',stats);print(json.dumps(stats,indent=2))

if __name__=='__main__':pass
