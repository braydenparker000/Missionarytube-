#!/usr/bin/env python3
"""Original, inspectable static model of Poweramp1031 built-in theme resolution.
Reads private Apktool XML; emits identifiers/derived metadata, never assets.
Not an Android runtime or a general replacement for AssetManager.
"""
from pathlib import Path
from lxml import etree
from dataclasses import dataclass,asdict
from functools import cmp_to_key
import re,json,math,os
ROOT=Path(os.environ.get('POWERAMP_RESEARCH_ROOT',Path(__file__).resolve().parents[2])).resolve()
A='{http://schemas.android.com/apk/res/android}'
SIZE={'small':1,'normal':2,'large':3,'xlarge':4}
DPI={'ldpi':120,'mdpi':160,'tvdpi':213,'hdpi':240,'xhdpi':320,'xxhdpi':480,'xxxhdpi':640,'anydpi':65534,'nodpi':65535}
@dataclass
class Config:
 api:int=36
 sw:int=360
 width:int=360
 height:int=640
 size:str='normal'
 long:bool=True
 orientation:str='port'
 direction:str='ldltr'
 night:bool=False
 density:int=320
 font_scale:float=1.0
 language:str='en'
 region:str=''
 ui:str='normal'
 hdr:bool=False
 widecg:bool=False
 round:bool=False

def qualifiers(folder):
 q={}
 parts=folder.split('-')[1:]
 for p in parts:
  if re.fullmatch(r'sw\d+dp',p):q['sw']=int(p[2:-2])
  elif re.fullmatch(r'w\d+dp',p):q['width']=int(p[1:-2])
  elif re.fullmatch(r'h\d+dp',p):q['height']=int(p[1:-2])
  elif re.fullmatch(r'v\d+',p):q['api']=int(p[1:])
  elif p in SIZE:q['size']=SIZE[p]
  elif p in ('long','notlong'):q['long']=p=='long'
  elif p in ('port','land','square'):q['orientation']=p
  elif p in ('ldltr','ldrtl'):q['direction']=p
  elif p in ('night','notnight'):q['night']=p=='night'
  elif p in DPI:q['density']=DPI[p]
  elif re.fullmatch(r'\d+dpi',p):q['density']=int(p[:-3])
  elif p in ('highdr','lowdr'):q['hdr']=p=='highdr'
  elif p in ('widecg','nowidecg'):q['widecg']=p=='widecg'
  elif p in ('round','notround'):q['round']=p=='round'
  elif p in ('car','desk','television','appliance','watch','vrheadset'):q['ui']=p
  elif re.fullmatch(r'[a-z]{2,3}',p):q['language']=p
  elif re.fullmatch(r'r[A-Z]{2}',p):q['region']=p[1:]
  elif p.startswith('b+'):q['unsupported_locale']=p
  elif p:q.setdefault('unsupported',[]).append(p)
 return q

# The represented fixture configurations use exact/default locales, no BCP47 fallback.
def compatible(q,c):
 if 'unsupported' in q or 'unsupported_locale' in q:return False
 d=asdict(c);d['size']=SIZE[c.size]
 for k,v in q.items():
  if k=='density':continue
  if k in ('sw','width','height','api','size'):
   if v>d[k]:return False
  elif d[k]!=v:return False
 return True

ORDER=['language','region','direction','sw','width','height','size','long','round','widecg','hdr','orientation','ui','night']
def better(a,b,c):
 # Android qualifier precedence restricted to observed APK vocabulary.
 for k in ORDER:
  av=a.get(k);bv=b.get(k)
  if av==bv:continue
  if av is None:return -1
  if bv is None:return 1
  if k in ('sw','width','height','size'):return 1 if av>bv else -1
  # Both exact categorical matches cannot differ after compatible().
  raise AssertionError((k,av,bv,c))
 ad=a.get('density',0);bd=b.get('density',0)
 if ad!=bd:
  if ad==65534:return 1
  if bd==65534:return -1
  # nodpi is retained distinctly; no fixture consumes nodpi values bag.
  if ad==65535 or bd==65535:raise ValueError('nodpi value-bag comparison requires Android probe')
  ad=ad or 160;bd=bd or 160;req=c.density or 160
  if ad!=bd:
   high=max(ad,bd);low=min(ad,bd)
   if req>=high:chosen=high
   elif low>=req:chosen=low
   else:chosen=low if ((2*low-req)*high>req*req) else high
   return 1 if ad==chosen else -1
 av=a.get('api',0);bv=b.get('api',0)
 return (av>bv)-(av<bv)

class Resources:
 def __init__(self,root=ROOT):
  if not (Path(root)/'decoded/res/xml/poweramp_builtin_skins.xml').is_file():raise FileNotFoundError('Set POWERAMP_RESEARCH_ROOT to the private research root containing decoded/res')
  self.root=Path(root);self.entries={};self.ids={};self.reverse_ids={}
  for file in sorted((self.root/'decoded/res').glob('values*/*.xml')):
   try:doc=etree.parse(str(file))
   except etree.XMLSyntaxError:continue
   q=qualifiers(file.parent.name)
   for node in doc.getroot():
    if not isinstance(node.tag,str):continue
    name=node.get('name');typ=node.get('type') if node.tag=='item' else node.tag
    if not name:continue
    if typ=='public':
     key=node.get('type')+'/'+name; self.ids[key]=node.get('id');self.reverse_ids[node.get('id')]=key;continue
    e={'type':typ,'name':name,'qualifiers':q,'config':file.parent.name,'path':str(file.relative_to(self.root)),'line':node.sourceline}
    if typ=='style':
     par=node.get('parent')
     if par is None and '.' in name:par='@style/'+name.rsplit('.',1)[0]
     e['parent']=par
     e['items']={x.get('name'):{'raw':''.join(x.itertext()).strip(),'path':e['path'],'line':x.sourceline,'symbol':name+'.'+x.get('name')} for x in node if x.tag=='item'}
    elif typ in ('dimen','color','integer','bool','string','item'):
     e['raw']=''.join(node.itertext()).strip()
    else:continue
    self.entries.setdefault(typ+'/'+name,[]).append(e)
  self.registry=etree.parse(str(self.root/'decoded/res/xml/poweramp_builtin_skins.xml')).getroot()
 def select(self,key,c):
  key=key.lstrip('@');matches=[e for e in self.entries.get(key,[]) if compatible(e['qualifiers'],c)]
  if not matches:return None
  return max(matches,key=cmp_to_key(lambda a,b:better(a['qualifiers'],b['qualifiers'],c)))
 def style(self,name,c,seen=()):
  name=name.removeprefix('@style/');key='style/'+name
  if key in seen:raise ValueError('Style parent cycle '+str(seen))
  e=self.select(key,c)
  if e is None:return {},[]
  inherited={};chain=[];p=e['parent']
  if p and p!='@null' and not p.startswith('@android:'):
   inherited,chain=self.style(p,c,seen+(key,))
  elif p and p.startswith('@android:'):chain.append({'external':p})
  inherited.update(e['items'])
  return inherited,chain+[{'style':name,'path':e['path'],'line':e['line']}]
 def record(self,raw,c,theme=None,trail=()):
  if not isinstance(raw,str):return {'value':raw,'sources':[]}
  if raw in trail:return {'value':raw,'unresolved':'reference cycle','sources':[]}
  if raw.startswith('?'):
   k=raw[1:].removeprefix('attr/')
   item=(theme or {}).get(k)
   if item is None:return {'value':raw,'unresolved':'theme attribute not defined','sources':[]}
   out=self.record(item['raw'],c,theme,trail+(raw,))
   out['sources']=[{k:item[k] for k in ('path','line','symbol')}]+out['sources'];return out
  if raw.startswith('@') and '/' in raw and not raw.startswith('@android:'):
   typ,name=raw[1:].split('/',1)
   if typ in ('dimen','color','integer','bool','string'):
    e=self.select(typ+'/'+name,c)
    if e:
     out=self.record(e['raw'],c,theme,trail+(raw,));out['sources']=[{'path':e['path'],'line':e['line'],'symbol':typ+'/'+name}]+out['sources'];return out
  return {'value':raw,'sources':[]}

GLOBAL_DEFAULTS={'rating_type':1,'hide_menu':False,'main_lyrics_button':1,'aa_aspect':1,'cc_button':1,'headers_meta':True,'vis_frs_type':2,'list_header_buttons':1,'localized_az':False,'anim_long_labels':True,'anim_long_labels_in_lists':False,'navbar_seekbar':True,'show_counter':False}
class Resolver:
 def __init__(self,resources,c=None,skin='Black',prefs=None,globals=None,rounded_screen=False):
  self.resources=resources;self.c=c or Config();self.skin=skin;self.prefs=prefs or {};self.globals=GLOBAL_DEFAULTS| (globals or {});self.theme={};self.trace=[];self.warnings=[];self.selections=[]
  self.registry=next(x for x in resources.registry if x.get('style')=='@style/ActivityTheme_'+('White' if skin=='Light' else 'Black'))
  self.apply(self.registry.get('style'),True,'base')
  self.global_pass('global:first')
  # SkinInfo.х builtin path sets h=1; no legacy-padding/minmax; build1031 >=1003.
  self.apply_options(self.registry)
  self.global_pass('global:remapped',{x.get('option').removeprefix('@attr/'):x.get('overlapAttr').removeprefix('@attr/') for x in self.registry if x.tag=='globalOption'})
  if rounded_screen and self.c.api>=31:self.apply_attr('OptionRoundedScreenCorners',True,'rounded-screen')
  self.apply_attr('TopPoweruiStyles',False,'activity-catalog')
  self.apply_attr('BasePoweruiStyles',False,'base-catalog')
 def apply(self,style,force,reason):
  if not style:return
  if not style.startswith('@style/'):
   self.warnings.append({'kind':'non_style_apply','selector':style,'reason':reason,'effect':'no style bag modeled; native applyStyle invalid-type fallback not executed'});return
  vals,chain=self.resources.style(style,self.c)
  if not chain:self.warnings.append({'kind':'style_not_found','selector':style,'reason':reason})
  changed=[]
  for k,v in vals.items():
   if force or k not in self.theme:self.theme[k]=v;changed.append(k)
  self.trace.append({'reason':reason,'style':style,'force':force,'parent_chain':chain,'changed_count':len(changed)})
 def apply_attr(self,key,force,reason):
  out=self.resources.record('?'+key,self.c,self.theme)
  if str(out['value']).startswith('@style/'):self.apply(out['value'],force,reason+':'+key)
 def global_pass(self,reason,remap=None):
  g=self.globals
  opts=[['OptionRatingDisabled','OptionRatingLikeUnlike','OptionRatingStars','OptionRatingStarsMenu'][g['rating_type']] if g['rating_type'] in range(4) else 'OptionRatingLikeUnlike']
  if g['hide_menu']:opts+=['OptionHideMenu']
  if g['main_lyrics_button']==0:opts+=['OptionHideLyricsButton']
  if g['aa_aspect'] in (1,2):opts+=[{1:'OptionAAKeepAspect',2:'OptionAACrop'}[g['aa_aspect']]]
  opts+=[{0:'OptionCCDisabled',2:'OptionCCInMenu',3:'OptionCCMainUIAndInMenu',4:'OptionCCMainUIButton'}.get(g['cc_button'],'OptionCCMainUI')]
  if g['headers_meta']:opts+=['OptionHeaderMeta']
  if g['vis_frs_type']==2:opts+=['OptionEquFRSRounded']
  if g['list_header_buttons']==0:opts+=['OptionNoHeaderButtons']
  if g['localized_az']:opts+=['OptionLocalizedAZScroll']
  if g['anim_long_labels'] and g['anim_long_labels_in_lists']:opts+=['OptionAnimLongLabelsInLists']
  for opt in opts:
   if remap is not None:
    if opt not in remap:continue
    opt=remap[opt]
   self.apply_attr(opt,True,reason)
 def apply_options(self,parent):
  for option in parent:
   key=option.get('key')
   if not key:continue
   dep=option.get('dependency')
   # x30.getBoolean accepts q30 only; an int selector stored under dep falls back true.
   depval=self.prefs.get(dep,True)
   if dep and type(depval)==bool and not depval:
    self.selections.append({'key':key,'skipped':'Boolean dependency false'});continue
   if option.tag in ('radio','multiSwitch','popup','seekbarList'):
    selected=self.prefs.get(key,option.get('defaultValue','') or '')
    if isinstance(selected,int) and not isinstance(selected,bool):
     # Inputs may use actual package resource ID, never UI ordinal.
     k=self.resources.reverse_ids.get(hex(selected));selected='@'+k if k else ''
    self.selections.append({'key':key,'value':selected,'defaulted':key not in self.prefs,'ui_minSdk':option.get('minSdk'),'source_line':option.sourceline})
    if selected:
     if selected.startswith('@attr/'):
      value=self.resources.record('?'+selected[6:],self.c,self.theme)['value']
      if str(value).startswith('?'):value=selected
     else:value=selected
     self.apply(value,True,'skin:'+key)
   elif option.tag=='option':
    selected=self.prefs.get(key,option.get('checkedByDefault')=='true')
    self.selections.append({'key':key,'value':selected,'defaulted':key not in self.prefs,'source_line':option.sourceline})
    if selected:
     if option.get('overlapAttr'):self.apply_attr(option.get('overlapAttr')[6:],True,'skin:'+key)
     else:self.apply(option.get('overlapStyle'),True,'skin:'+key)
   else:self.warnings.append({'kind':'option_type_not_modeled','type':option.tag,'key':key})
 def value(self,attr):return self.resources.record('?'+attr,self.c,self.theme)
 def component(self,attr,properties=None):
  ptr=self.value(attr);name=ptr['value']
  if not isinstance(name,str) or not name.startswith('@style/'):return {'style':name,'unresolved':ptr.get('unresolved'),'properties':{}}
  vals,chain=self.resources.style(name,self.c)
  props={}
  for k,v in vals.items():
   if properties is not None and k not in properties:continue
   out=self.resources.record(v['raw'],self.c,self.theme)
   props[k]={'value':out['value'],'sources':[{'path':v['path'],'line':v['line'],'symbol':v['symbol']}]+out['sources']}
   if 'unresolved' in out:props[k]['unresolved']=out['unresolved']
  return {'style':name,'style_sources':ptr['sources'],'parent_chain':chain,'properties':props}
 def consumed(self,attr,properties,explicit=None,defaults=None):
  """Model obtainStyledAttributes for explicit ?componentStyle with no defStyleAttr/res.
  Style bag and final theme fallback remain distinct in returned provenance.
  Constructor-specific defaults must be supplied; absent != false or zero.
  """
  out=self.component(attr,properties)
  explicit=explicit or {};defaults=defaults or {}
  for key in properties:
   if key in explicit:
    v=self.resources.record(explicit[key],self.c,self.theme)
    out['properties'][key]=dict(v,origin='explicit_layout_attribute')
   elif key in out['properties']:
    out['properties'][key]['origin']='component_style_bag'
   elif key in self.theme:
    out['properties'][key]=dict(self.value(key),origin='theme_fallback')
   elif key in defaults:
    out['properties'][key]={'value':defaults[key],'sources':[],'origin':'caller_supplied_constructor_default'}
   else:
    out['properties'][key]={'value':None,'sources':[],'origin':'not_defined','unresolved':'Requires constructor getter/default or platform fallback; absence is not zero'}
  return out
 def numeric(self,attr,conversion='offset'):
  val=self.value(attr)['value'];m=re.fullmatch(r'(-?\d+(?:\.\d+)?)(dip|dp|sp|px)',str(val))
  if not m:return {'value':None,'reason':'not a resolved dimension','raw':val}
  number=float(m[1]);unit=m[2]
  if unit=='sp' and self.c.api>=34 and self.c.font_scale!=1:return {'value':None,'reason':'API34 nonlinear FontScaleConverter requires platform conversion; do not assume scalar multiplication','raw':val}
  px=number*(1 if unit=='px' else self.c.density/160)*(self.c.font_scale if unit=='sp' else 1)
  if conversion=='float':out=px
  elif conversion=='offset':out=math.trunc(px)
  else:
   out=math.floor(px+.5)
   if out==0 and px!=0:out=1 if px>0 else -1
  return {'value':out,'unit':'px','raw':val,'conversion':conversion,'model_only':True}

if __name__=='__main__':
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--skin',choices=['Black','Light'],default='Black');p.add_argument('--layout',choices=['Default','Alternative','FullCover'],default='Default');p.add_argument('--attr',default='TopAABounds');p.add_argument('--landscape',action='store_true');args=p.parse_args()
 c=Config()
 if args.landscape:c.width,c.height,c.orientation=640,360,'land'
 prefs={'alt_layout':{'Default':'','Alternative':'@attr/overlap_alt_layout','FullCover':'@attr/overlap_alt_layout2'}[args.layout]}
 r=Resolver(Resources(),c,args.skin,prefs)
 print(json.dumps({'inputs':{'configuration':asdict(c),'skin':args.skin,'preferences':prefs},'component':r.component(args.attr),'trace':r.trace,'warnings':r.warnings},ensure_ascii=False,indent=2))
