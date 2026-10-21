"""Validate original research records against the private reconstruction.

No APK code or assets are copied into outputs. Run after effects_build.py.
"""
from pathlib import Path
from collections import Counter
import argparse,json,re

ap=argparse.ArgumentParser(description='Validate bounded settings-effect research and its private citations.')
ap.add_argument('--private-root',type=Path,default=Path('/workspace/work/poweramp'))
ap.add_argument('--artifact-dir',type=Path)
ap.add_argument('--report',type=Path)
args=ap.parse_args()
root=args.private_root
draft=args.artifact_dir or root/'session2/drafts'
doc=json.loads((draft/'setting-deep-traces.json').read_text())
ledger=[json.loads(s) for s in (draft/'settings-effects-ledger.jsonl').read_text().splitlines()]
ids={e['id'] for e in ledger}
assert len(ids)==len(ledger)
assert len({r['native_key'] for r in doc['records']})==len(doc['records'])
required={'native_key','page','control','values','default','persistence','dependencies','consumers','apply','chain_sources','evidence_ids','status','uncertainties','trace_depth'}
sources=[]
for row in doc['records']:
 assert required<=row.keys(),row['native_key']
 assert row['values'],row['native_key']
 assert set(row['evidence_ids'])<=ids,row['native_key']
 assert row['uncertainties'],row['native_key']
 if row['control'].endswith(('SwitchPreference','CheckBoxPreference')):
  assert row['values']['available_values']==[False,True]
 sources+=row['chain_sources']
for entry in ledger:
 assert {'id','topic','claim','status','conditions','sources','verification','uncertainties'}<=entry.keys()
 sources+=entry['sources']
unique={(s['path'],s['locator']) for s in sources}
for path,loc in unique:
 src=root/path
 assert src.is_file(),path
 n=int(re.fullmatch(r'line (\d+)',loc).group(1))
 assert 1<=n<=len(src.read_text().splitlines()),(path,loc)
rows={r['native_key']:r for r in doc['records']}
assert rows['float']['persistence']['native_stored_key']=='use_float'
assert rows['_autosave']['persistence']['store']=='dspi'
assert rows['_bassQ']['default']['registered']==0.0
assert rows['_bassQ']['default']['effective_when_unset']==0.8
assert rows['enable_vis']['persistence']['native_stored_key']=='vis_mode'
assert rows['fade_short_xfade_ms']['trace_depth']=='persistence_to_consumer_with_apply_gap'
metrics={'records':len(rows),'pages':len(doc['metrics']['pages']),'ledger':len(ledger),'ledger_statuses':dict(Counter(x['status'] for x in ledger)),'trace_depths':dict(Counter(x['trace_depth'] for x in rows.values())),'source_occurrences':len(sources),'unique_source_locators':len(unique),'unique_source_files':len({p for p,_ in unique}),'runtime_records':sum(r['status']=='CONFIRMED_RUNTIME' for r in rows.values()),'validation':'PASS; shape, uniqueness, enum presence, evidence links, source existence/line bounds and selected alias/default invariants'}
report=args.report or root/'session2/logs/effects-validation.json'
report.parent.mkdir(parents=True,exist_ok=True)
report.write_text(json.dumps(metrics,indent=2)+'\n')
print(json.dumps(metrics,indent=2))
