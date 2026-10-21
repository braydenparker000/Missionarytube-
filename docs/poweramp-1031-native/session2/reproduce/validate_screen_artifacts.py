from pathlib import Path
import json,re,os
from collections import Counter
root=Path(os.environ.get('POWERAMP_RESEARCH_ROOT',Path(__file__).resolve().parents[2]));out=root/'session2/drafts'
r=json.loads((out/'screen-registry.json').read_text());g=json.loads((out/'navigation-graph.json').read_text());l=[json.loads(x) for x in (out/'screens-ledger.jsonl').read_text().splitlines()]
issues=[];sources=[]
def walk(x):
 if isinstance(x,dict):
  if all(k in x for k in ['kind','path','symbol','locator']):sources.append(x)
  for v in x.values():walk(v)
 elif isinstance(x,list):
  for v in x:walk(v)
for x in [r,g,l]:walk(x)
for s in sources:
 p=root/s['path']
 if not p.exists():issues.append(['missing source',s]);continue
 n=len(p.read_text(errors='replace').splitlines())
 nums=[int(x) for x in re.findall(r'\d+',s['locator'])]
 if nums and max(nums)>n:issues.append(['source line beyond EOF',n,s])
ids=[x['id']for x in r['screens']];assert len(ids)==len(set(ids))
nodes={x['id']for x in g['nodes']}
for e in g['edges']:
 if e['source']not in nodes or e['target']not in nodes:issues.append(['bad edge',e['id']])
for x in r['screens']:
 for n,ps in x['layout_resource_variants'].items():
  if not ps:issues.append(['no layout variants',x['id'],n])
  for p in ps:
   if not(root/p).exists():issues.append(['missing layout',p])
assert len(r['manifest_components'])==40 and len(r['manifest_aliases'])==23
assert len([x for x in r['screens'] if x['family']=='settings_page'])==45
report={'typed_entries':len(ids),'edges':len(g['edges']),'ledger_records':len(l),'source_references':len(sources),'unique_source_locations':len({(x['path'],x['locator'])for x in sources}),'alias_classification':dict(Counter(x['classification']for x in r['manifest_aliases'])),'issues':issues}
(root/'session2/logs/screen-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2));assert not issues
