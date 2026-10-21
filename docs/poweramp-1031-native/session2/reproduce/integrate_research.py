#!/usr/bin/env python3
"""Assemble and validate original Session2 research; never changes application files."""
import argparse,collections,hashlib,json,re,shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--private-root',type=Path,default=Path('/workspace/work/poweramp'));p.add_argument('--stage',action='store_true');a=p.parse_args()
ROOT=a.private_root;D=ROOT/'session2/drafts';OUT=ROOT/'session2/deliverables'
def read(name):return json.loads((D/name).read_text())
def write(name,obj): (D/name).write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
effects=read('setting-deep-traces.json')['records']; regs=read('settings-registry.json');controls=read('settings-controls.json')['controls'];bycontrol={x['id']:x for x in controls}
for row in regs['settings']:
    traces=[x for x in effects if x['native_key']==row['native_key']]
    row['deep_trace_ids']=sorted({v for x in traces for v in x['evidence_ids']})
    row['effect_trace_refs']=[{'artifact':'setting-deep-traces.json','native_key':x['native_key'],'page':x['page'],'depth':x['trace_depth']} for x in traces]
    if traces:
        row['apply_behavior']=[{'page':x['page'],'contract':x['apply']} for x in traces]
        row['coverage']='deep_trace_with_explicit_scope'
        row['persistence']['explicit_binding_refs']=row['effect_trace_refs']
    row['values']={'control_declaration_refs':row['control_occurrences'],'choice_array_refs':sorted({bycontrol[i][k] for i in row['control_occurrences'] for k in ('choices','choice_values') if bycontrol[i][k]}),'note':'Controls retain ranges, scaling, typed arrays, labels and defaults. Helper replacements override declarations; explicit effect traces take precedence where present.'}
write('settings-registry.json',regs)

files=sorted(f for f in D.glob('*-ledger.jsonl') if f.name!='evidence-ledger.jsonl');ledger=[]
statusmap={'confirmed_static':'CONFIRMED_STATIC','inferred':'CONDITIONAL_INFERENCE','open':'OPEN','RUNTIME_BLOCKED':'BLOCKED','PARTIAL_STATIC':'CONDITIONAL_INFERENCE'}
for file in files:
    for line in file.read_text().splitlines():
        row=json.loads(line);old=row['status'];row['status']=statusmap.get(old,old)
        if old!=row['status']:row['contributor_status']=old
        row['origin_artifact']=file.name
        ledger.append(row)
assert len({x['id'] for x in ledger})==len(ledger),'Duplicate evidence IDs'
assert all(x['status'] in ('CONFIRMED_STATIC','CONFIRMED_RUNTIME','CONDITIONAL_INFERENCE','OPEN','BLOCKED') for x in ledger)
for row in ledger:
    assert row.get('claim') and row.get('sources'),row['id']
(D/'evidence-ledger.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False,separators=(',',':'))+'\n' for x in ledger))

sourceuses=collections.defaultdict(list);missing=[];badlines=[];jsoncount=0
def walk(o,artifact,trail=''):
    if isinstance(o,dict):
        path=o.get('path')
        if isinstance(path,str) and path.startswith(('decoded/','jadx/','bundle/')):
            f=ROOT/path
            if not f.is_file():missing.append((artifact,path,trail))
            else:
                use={k:o[k] for k in ('symbol','locator','line','kind') if k in o};use['artifact']=artifact
                sourceuses[path].append(use)
                if f.suffix in ('.java','.smali','.xml'):
                    line=o.get('line')
                    if line is None:
                        match=re.match(r'^lines?\s*:?\s*(\d+)',str(o.get('locator','')))
                        if match:line=int(match[1])
                    if isinstance(line,int) and not 1<=line<=len(f.read_text().splitlines()):badlines.append((artifact,path,line))
        for k,v in o.items():walk(v,artifact,trail+'/'+k)
    elif isinstance(o,list):
        for i,v in enumerate(o):walk(v,artifact,trail+'/'+str(i))
    elif isinstance(o,str) and not trail.endswith('/path') and o.startswith(('decoded/','jadx/','bundle/')) and o.endswith(('.java','.smali','.xml','.json','.apk')) and not any(c.isspace() for c in o):
        f=ROOT/o
        if not f.is_file():missing.append((artifact,o,trail))
        else:sourceuses[o].append({'artifact':artifact,'kind':'reference-path','symbol':'standalone source/resource path'})
for f in sorted(D.glob('*.json')):
    if f.name in ('source-citation-index.json','validation-results.json','coverage-metrics.json','artifact-manifest.json'):continue
    obj=json.loads(f.read_text());jsoncount+=1;walk(obj,f.name)
walk(ledger,'evidence-ledger.jsonl')
index=[]
for path,uses in sorted(sourceuses.items()):
    f=ROOT/path;b=f.read_bytes();unique={json.dumps(x,ensure_ascii=False,sort_keys=True):x for x in uses}
    index.append({'path':path,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'line_count':len(b.decode().splitlines()) if f.suffix in ('.java','.smali','.xml') else None,'citations':list(unique.values())})
(D/'source-citation-index.json').write_text(json.dumps({'scope':'Private original evidence reconstruction. Paths are intentionally not repository hyperlinks; no source payloads included. Hashes bind citations to exact files.','source_apk_sha256':'27cfde3fc8e55b2effffe88c7e80ec3a1b1f69ec37a09ef86d9a34aafe8ebb9e','files':index},ensure_ascii=False,separators=(',',':'))+'\n')

screens=read('screen-registry.json');graph=read('navigation-graph.json');screenids={x['id'] for x in screens['screens']};nodes={x['id'] if isinstance(x,dict) else x for x in graph['nodes']}
assert len(nodes)==len(graph['nodes']),'Duplicate graph node'
edgeerrors=[]
for e in graph['edges']:
    for key in ('from','to','source','target'):
        if key in e and isinstance(e[key],str) and e[key] not in nodes:edgeerrors.append((key,e[key]))
assert not edgeerrors,edgeerrors[:10]
assert len(screenids)==len(screens['screens']),'Duplicate screen ID'
assert {p['id'] for p in read('settings-controls.json')['pages']}=={'settings.'+x['page'] for x in read('settings-persistence-map.json')['page_helpers']},'Settings XML/helper denominator mismatch'
fixture=read('configuration-fixtures.json');ferrors=[]
catalog_names={'configuration_ref':'configuration_catalog','application_sequence_ref':'application_sequence_catalog','component_refs':'resolved_component_catalog','attribute_refs':'resolved_attribute_catalog'}
catalogs={name:{x['id'] for x in fixture[name]} for name in catalog_names.values()}
def fixturewalk(o):
    if isinstance(o,dict):
        for k,v in o.items():
            if k in catalog_names:
                for value in v if isinstance(v,list) else [v]:
                    if value not in catalogs[catalog_names[k]]:ferrors.append((k,value))
            fixturewalk(v)
    elif isinstance(o,list):
        for v in o:fixturewalk(v)
fixturewalk(fixture['fixtures']);assert not ferrors,ferrors
eids={x['id'] for x in ledger};refs=[]
for f in fixture['fixtures']:refs.extend(f.get('evidence_refs',[]))
for x in effects:refs.extend(x['evidence_ids'])
missingids=sorted(set(refs)-eids)
metrics=read('settings-inventory-metrics.json');metrics.update({'screen_registry':screens['coverage'],'navigation_nodes':len(nodes),'navigation_edges':len(graph['edges']),'deep_effect_traces':read('setting-deep-traces.json')['metrics'],'dynamic_list_control_families':len(read('list-options-registry.json')['records']),'configuration_fixtures':len(fixture['fixtures']),'session2_evidence_records':len(ledger),'session2_evidence_statuses':dict(collections.Counter(x['status'] for x in ledger)),'cited_private_source_files':len(index),'source_citation_uses':sum(len(x['citations']) for x in index),'runtime_confirmed_records':sum(x['status']=='CONFIRMED_RUNTIME' for x in ledger),'scope_warning':'Counts are non-additive and do not estimate the unknown denominator of every conditional UI state. Lexical candidate references are not deep effect traces.'})
write('coverage-metrics.json',metrics)
result={'parsed_json_artifacts':jsoncount,'evidence_unique_ids':len(eids),'missing_source_paths':missing,'invalid_primary_source_lines':badlines,'unresolved_evidence_ids':missingids,'navigation_integrity':'pass','settings_xml_helper_set_equality':'pass','fixture_reference_integrity':'pass','runtime_observations':0,'application_tests':'Not applicable: research-only documents and analysis scripts; application checkout unchanged.','overall':'pass' if not(missing or badlines or missingids) else 'fail'}
write('validation-results.json',result);print(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({'ledger':len(ledger),'sources':len(index),'fixtures':len(fixture['fixtures'])}))
assert result['overall']=='pass','Resolve citation/reference errors before staging'
if a.stage:
    OUT.mkdir(exist_ok=True,parents=True)
    for f in D.iterdir():
        if f.suffix not in ('.md','.json','.jsonl') or f.name.endswith('-ledger.jsonl'):continue
        if f.suffix=='.md':
            body=f.read_text()
            for name in files:body=body.replace(name.name,'evidence-ledger.jsonl')
            (OUT/f.name).write_text(body)
        else:shutil.copy2(f,OUT/f.name)
    shutil.copy2(D/'evidence-ledger.jsonl',OUT/'evidence-ledger.jsonl')
    repro=OUT/'reproduce';repro.mkdir(exist_ok=True)
    for f in (ROOT/'session2/scripts').glob('*.py'):shutil.copy2(f,repro/f.name)
    for name in ('style-ledger.jsonl','inventory-ledger.jsonl'):shutil.copy2(D/name,repro/name)
    shutil.copy2(ROOT/'session2/logs/settingssystem-helper-extraction.json',repro/'settingssystem-helper-extraction.json')
    shutil.copy2(ROOT/'session2/logs/runtime-recheck.json',OUT/'runtime-recheck.json')
