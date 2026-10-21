#!/usr/bin/env python3
"""Validate reproducible static-research invariants, not Android visual behavior."""
from style_resolver import *
import json
p=Path(os.environ.get('POWERAMP_FIXTURES_OUT',ROOT/'session2/drafts/configuration-fixtures.json'))
data=json.loads(p.read_text())
assert len(data['fixtures'])==279
catalogs={k:{r['id']:r for r in data[k]} for k in ['source_catalog','configuration_catalog','resolved_component_catalog','resolved_attribute_catalog','application_sequence_catalog','style_application_step_catalog']}
assert all(len(catalogs[k])==len(data[k]) for k in catalogs)
for r in data['source_catalog']:
 path=ROOT/r['path'];assert path.is_file(),r
 assert 1<=r['line']<=len(path.read_text().splitlines()),r
for f in data['fixtures']:
 assert f['inputs']['configuration_ref'] in catalogs['configuration_catalog']
 assert f['application_sequence_ref'] in catalogs['application_sequence_catalog']
 for ref in f['outcomes']['component_refs']:assert ref in catalogs['resolved_component_catalog']
 for ref in f['outcomes']['attribute_refs']:assert ref in catalogs['resolved_attribute_catalog']
for seq in data['application_sequence_catalog']:
 for ref in seq['step_refs']:assert ref in catalogs['style_application_step_catalog']
for cat in ['resolved_component_catalog','resolved_attribute_catalog']:
 for value in data[cat]:
  for r in value.get('sources',[])+value.get('style_sources',[]):assert r in catalogs['source_catalog']
  for prop in value.get('properties',{}).values():
   for r in prop.get('sources',[]):assert r in catalogs['source_catalog']
R=Resources()
def prop(r,c,k):return r.component(c)['properties'][k]['value']
checks=[]
for skin in ['Light','Black']:
 for layout,val in [('Default',''),('Alternative','@attr/overlap_alt_layout'),('FullCover','@attr/overlap_alt_layout2')]:
  r=Resolver(R,Config(),skin,{'alt_layout':val})
  assert r.component('TopAABounds')['style']=={'Default':'@style/TopAABounds2','Alternative':'@style/Alt_TopAABounds','FullCover':'@style/Alt2_TopAABounds'}[layout]
  assert prop(r,'TopWaveseek','numBars')=='100'
  assert prop(r,'ItemTrackTitle_Text','android:textSize')=='18.0sp'
  assert prop(r,'ItemTrackLine2_Text','android:textSize')=='13.5sp'
  assert prop(r,'EqMilkFrs','presetUri')==('internal://#fft2invrounded' if skin=='Light' else 'internal://#fft2rounded')
  attrs=['dragThreshold','dragThresholdVelocity','dragAnimTime','collapseDragDirection']
  assert all(v['origin']=='not_defined' for v in r.consumed('NavbarExtension',attrs)['properties'].values())
  a=Resolver(R,Config(),skin,{'alt_layout':val,'seekbar':'@attr/overlap_plain_seekbar','more_buttons':False})
  b=Resolver(R,Config(),skin,{'alt_layout':val,'seekbar':'@attr/overlap_plain_seekbar','more_buttons':True})
  assert a.component('TopWaveseek')==b.component('TopWaveseek')
  assert a.component('TopPause')==b.component('TopPause')
  assert a.value('TopWaveseekLayout_extraLayout')==b.value('TopWaveseekLayout_extraLayout')
  checks.append(skin+':'+layout)
assert sum(len(s['options']) for s in data['built_in_control_catalog'])==31
assert sum(len(o['choices']) for s in data['built_in_control_catalog'] for o in s['options'])==74
assert sum(any(x.startswith('grid:') for x in f['coverage_labels']) for f in data['fixtures'])==72
assert sum(any(x.startswith('fresh-install:') for x in f['coverage_labels']) for f in data['fixtures'])==6
assert len([f for f in data['fixtures'] if f['warnings']])==1
print(json.dumps({'passed':True,'fixtures':len(data['fixtures']),'source_records':len(data['source_catalog']),'invariant_combinations':checks,'checks':['catalog references','source path/line bounds','effective artwork mapping','font selection','rounded FRS presets','plain/more-button interaction','main-theme drag fallback','choice/grid/fresh-init coverage'],'limitations':'Static model invariants; no Android runtime or screenshot comparison'},ensure_ascii=False))
