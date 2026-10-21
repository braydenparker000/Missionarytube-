#!/usr/bin/env python3
"""Generate original configuration outcomes from private decoded resources."""
from style_resolver import *
from itertools import product
R=Resources();source_index={};sources=[]
def source_id(s):
 key=(s.get('path'),s.get('line'),s.get('symbol'))
 if key not in source_index:
  source_index[key]=len(sources)+1;sources.append({'id':source_index[key],**s})
 return source_index[key]
def record(v):
 o={'value':v['value']}
 if v.get('sources'):o['sources']=[source_id(x) for x in v['sources']]
 if v.get('unresolved'):o['unresolved']=v['unresolved']
 if v.get('origin'):o['origin']=v['origin']
 return o
LAY={'Default':'','Alternative':'@attr/overlap_alt_layout','FullCover':'@attr/overlap_alt_layout2'}
COMPONENTS={
 'TopAABounds':['aaMarginBottom','aaMinSize','aaPaddingBottom','aaGravity','offsetWindowInsets','layout_heightRef'],
 'TopListWidget':['listSubstyle'],
 'TopWaveseekLayout':['android:layout_height','android:layout_marginBottom','android:paddingTop','layout_attachTop','layout_attachBottom','layout_attachLeft'],
 'TopWaveseek':['android:visibility','waveLayout','numBars','barSpacing','layout_maxHeight'],
 'TopPause':['android:layout_width','android:layout_height','layout_maxWidth','layout_maxHeight','android:drawable'],
 'TopSubAAButtons':['slotWidth','smallSlotWidth','slotLineHeight','slotLinePadding','slotPadding','fitCentered','smallFitCentered','minSlotWidthForFitCentered'],
 'ItemTrackTitle_Text':['android:textSize','android:fontFamily'],
 'ItemTrackLine2_Text':['android:textSize','android:fontFamily'],
 'ItemTrackAAImage_scene_aa':['android:layout_width','android:layout_height','android:layout_marginLeft','android:layout_marginTop','android:layout_marginRight','android:layout_marginBottom','layout_consumeSpace','scale','corners','baseScene'],
 'ItemTrackTitle_scene_aa':['android:layout_gravity','android:layout_marginLeft','android:layout_marginRight','layout_attachLeft','layout_attachRight','layout_attachBottom','layout_consumeSpace','layout_compensateScale','lineBackground','scale','baseScene'],
 'ItemTrackLine2_scene_aa':['android:layout_gravity','layout_attachRight','layout_attachBottom','layout_compensateScale','lineBackground','scale','baseScene'],
 'EqMilkFrs':['presetUri','roundRectClipRadius'],
}
SCALARS=['AAImage_scaleType','ItemLikeUnlikeLayout_layout','TopWaveseekLayout_extraLayout','corners_aa_scene_aa','corners_navbar','corners_equ_frs','navbar_marginB','navbar_marginT','Navbar_height','NavbarList_marginBottom','NavbarSeekbar_marginTop','NavbarSeekbar_marginBottom','NavbarSeekbar_height','TrackItem_eatFontPads','colorFrs','holeStartColor','holeColorWidth','arcStartColor','android:windowLightNavigationBar','TopFitsNavigationBarView','TopFitsStatusBarView','TopPlay','ItemLikeUnlikeLayout_scene_aa','ItemRatingBar_scene_aa']
fixtures=[];seen={}
def add(label,c=None,skin='Black',prefs=None,glob=None,rounded=False,extra=None,tags=None):
 c=c or Config();prefs=prefs or {};glob=glob or {};extra=extra or {}
 identity=json.dumps([asdict(c),skin,prefs,glob,rounded,extra],sort_keys=True)
 if identity in seen:
  seen[identity]['coverage_labels'].append(label);return
 t=Resolver(R,c,skin,prefs,glob,rounded)
 out={};provenance={}
 for attr,props in COMPONENTS.items():
  comp=t.component(attr,props)
  out[attr]={'style':comp['style'],'properties':{k:record(v) for k,v in comp['properties'].items()}}
  if comp.get('style_sources'):out[attr]['style_sources']=[source_id(x) for x in comp['style_sources']]
  if comp.get('unresolved'):out[attr]['unresolved']=comp['unresolved']
 for attr in SCALARS:out[attr]=record(t.value(attr))
 dims={k:t.numeric(k) for k in ['navbar_marginB','navbar_marginT','Navbar_height','NavbarList_marginBottom','NavbarSeekbar_marginTop','NavbarSeekbar_marginBottom','NavbarSeekbar_height']}
 if all(x['value'] is not None for x in dims.values()):
  d={k:v['value'] for k,v in dims.items()};normal=d['navbar_marginB']+d['Navbar_height'];two=normal+d['Navbar_height']+d['navbar_marginT']+d['NavbarList_marginBottom'];three=two+d['NavbarSeekbar_marginTop']+d['NavbarSeekbar_marginBottom']+d['NavbarSeekbar_height']
  nav={'normal_px':normal,'two_id_px':three if t.globals['navbar_seekbar'] else two,'three_id_px':three,'conversion':'per-attribute PixelOffset, model values'}
 else:nav={'value':None,'reason':'dimension resolution requires platform/external value'}
 f={'id':f'PA1031-S2-FIXTURE-{len(fixtures)+1:03}','coverage_labels':[label],'status':'CONFIRMED_STATIC','interpretation':'Derived theme/style selections, not native rendering observations','inputs':{'configuration':asdict(c),'skin':skin,'skin_preferences':prefs,'global_preferences':t.globals,'rounded_screen_detected':rounded,'initialization_contract':'explicit post-initialization preference state; unspecified built-in choices use registry defaults; device migration presets not silently inferred',**extra},'conditions':['Supplied1031 APK resources','No external skin','Theme/configuration fixed to these inputs','Component records are style bags, scene bags are not CSS-merged with base layout params'],'evidence_refs':['PA1031-S2-STYLE-001','PA1031-S2-STYLE-002','PA1031-S2-STYLE-003','PA1031-S2-STYLE-004','PA1031-S2-STYLE-005'],'outcomes':out,'navbar_reference_model':nav,'applied_style_sequence':[{'reason':x['reason'],'style':x['style'],'force':x['force'],'qualified_parent_chain':x['parent_chain']} for x in t.trace],'unknown_numeric_layout_values':{'final_text_bounds':None,'explanation':'Provide text plus Android Paint glyph widths/font metrics to the documented text kernel; style selection itself is resolved. Exact transition-time bounds require remaining FastLayout.p1 branches and scene progress inputs.','material_you_palette':None if prefs.get('mu_colors') else 'not requested'},'warnings':t.warnings}
 if t.warnings:f['status']='INFERRED';f['evidence_refs']+=['PA1031-S2-STYLE-006']
 fixtures.append(f);seen[identity]=f

# High interaction baseline: every skin/layout/orientation/seekbar/more-buttons combination.
for skin,layout,orientation,seek,more in product(['Light','Black'],LAY,['port','land'],['scrolling','static','plain'],[False,True]):
 c=Config() if orientation=='port' else Config(width=640,height=360,orientation='land')
 val='' if seek=='scrolling' else ('@attr/overlap_plain_seekbar' if seek=='plain' else '@style/ActivityTheme_'+('White' if skin=='Light' else 'Black')+'pro_StaticSeekbar')
 add(f'grid:{skin}:{layout}:{orientation}:{seek}:more={more}',c,skin,{'alt_layout':LAY[layout],'seekbar':val,'more_buttons':more})

# Every registered built-in option choice is represented; dependent choices use Alternative.
catalog=[]
for node in R.registry:
 skin='Light' if node.get('style').endswith('_White') else 'Black'
 opts=[]
 for option in node:
  key=option.get('key')
  if not key:continue
  o={'key':key,'control':option.tag,'dependency':option.get('dependency'),'minSdk':option.get('minSdk'),'default':option.get('defaultValue','') if option.tag!='option' else option.get('checkedByDefault')=='true','source':{'path':'decoded/res/xml/poweramp_builtin_skins.xml','line':option.sourceline},'choices':[]}
  if option.tag=='option':values=[False,True]
  else:values=[x.get('overlapAttr') or x.get('overlapStyle') or '' for x in option if x.tag=='option']
  for value in values:
   o['choices'].append({'stored_value':value,'resource_id':R.ids.get(value[1:]) if isinstance(value,str) and value else None})
   prefs={key:value}
   if option.get('dependency')=='alt_layout':prefs['alt_layout']=LAY['Alternative']
   add(f'option:{skin}:{key}:{value}',skin=skin,prefs=prefs)
  opts.append(o)
 catalog.append({'skin':skin,'options':opts})

# Noncommuting selector intersections and remapped globals.
for skin,layout,rating in product(['Light','Black'],LAY,range(4)):
 add(f'rating:{skin}:{layout}:{rating}',skin=skin,prefs={'alt_layout':LAY[layout]},glob={'rating_type':rating})
for skin,layout,font in product(['Light','Black'],LAY,['SystemFont','Whitepro_AltFont','BoldFont']):
 add(f'font:{skin}:{layout}:{font}',skin=skin,prefs={'alt_layout':LAY[layout],'font_variant':'@style/ActivityTheme_'+font})
for skin,layout,centered,nobg in product(['Light','Black'],['Alternative','FullCover'],[False,True],[False,True]):
 add(f'labels:{skin}:{layout}:center={centered}:noBG={nobg}',skin=skin,prefs={'alt_layout':LAY[layout],'track_labels_align':'@attr/overlap_track_labels_centered' if centered else '', 'labels_bg':'@attr/overlap_track_labels_no_bg' if nobg else ''})
for key,values in {'aa_aspect':[0,1,2],'cc_button':[0,1,2,3,4],'hide_menu':[False,True],'main_lyrics_button':[0,1],'headers_meta':[False,True],'vis_frs_type':[0,1,2],'list_header_buttons':[0,1],'localized_az':[False,True],'anim_long_labels_in_lists':[False,True],'navbar_seekbar':[False,True],'show_counter':[False,True]}.items():
 for value in values:add(f'global:{key}:{value}',glob={key:value})

# Resource qualifier/scale/platform boundaries; not a declaration of supported OS/device matrix.
for api in (21,23,25,28,29,31,33,35,36):
 for skin in ('Light','Black'):add(f'api:{api}:{skin}',Config(api=api),skin)
for cfg in [Config(height=566),Config(height=567),Config(height=609),Config(height=610),Config(height=629),Config(height=630),Config(height=660),Config(sw=380,width=380,height=750),Config(sw=600,width=600,height=920,size='large',long=False),Config(sw=800,width=800,height=1100,size='xlarge',long=False),Config(direction='ldrtl'),Config(night=True),Config(density=240),Config(density=420),Config(api=33,font_scale=1.3),Config(api=36,font_scale=1.3)]:
 add('configuration-boundary:'+json.dumps(asdict(cfg),sort_keys=True),cfg)
for skin,less,rounded in product(['Light','Black'],[False,True],[False,True]):
 add(f'rounding:{skin}:less={less}:screen={rounded}',skin=skin,prefs={'rounding':'@attr/overlap_less_rounding' if less else ''},rounded=rounded)
# Explicit migration-derived fresh-install states. Device flag remains symbolic.
for skin in ('Light','Black'):
 for flag,height,layout in [(False,640,'Default'),(True,792,'Alternative'),(True,828,'FullCover')]:
  add(f'fresh-install:{skin}:s41.C={flag}:height={height}',Config(height=height),skin,prefs={'alt_layout':LAY[layout],'more_buttons':True,'font_variant':'@style/ActivityTheme_BoldFont','navbar_offset':False},extra={'initialization_scenario':{'old_build':-1,'s41.C':flag,'device_height_over_width':height/360,'migration_evidence':'PA1031-S2-PREF-011','assumption':'No separately conditioned Samsung navbar-background override; device flag supplied symbolically, not inferred'}})

# Retained dependent values test the typed-read fallback; no fabricated UI reachability guarantee.
add('retained-centered-on-default',prefs={'alt_layout':'','track_labels_align':'@attr/overlap_track_labels_centered'},extra={'retained_preference_case':True})

# Representative editable sub-AA state fixtures (separate from skin style selectors).
for orientation,slots,centered,small,two,gap in [
 ('port',['subaabutton_vis','subaabutton_sleep',0,'subaabutton_shuffle','subaabutton_repeat'],True,False,False,False),
 ('land',['subaabutton_repeat',0,'subaabutton_vis','subaabutton_sleep','subaabutton_shuffle'],False,True,True,True),
 ('port',['subaabutton_vis',0,0,'subaabutton_shuffle',0,0],True,False,False,False)]:
 saved=list(slots)
 while saved and saved[-1]==0:saved.pop()
 c=Config() if orientation=='port' else Config(width=640,height=360,orientation='land')
 add('subaa-edit:'+orientation+':'+str(slots),c,extra={'subaa':{'input_slots':slots,'saved_slots_after_exit':saved,'preserve_internal_gaps':True,'centered':centered,'small':small,'two_lines':two,'no_gap':gap,'customization_gate':'passed','state_pref_values':{'layout':0 if centered else 1,'size':small,'lines':2 if two else 1},'slot_visual_order_first_five':[0,1,2,4,3],'second_line_slot_start':16}})

out={'schema_version':1,'source_apk_sha256':'27cfde3fc8e55b2effffe88c7e80ec3a1b1f69ec37a09ef86d9a34aafe8ebb9e','method':'Static original Python model of build1031 decoded XML plus validated control flow; no Android runtime assertions','coverage':'All registry options and a full72-case skin×layout×orientation×seekbar×more-buttons grid; additional global/typography/rating/qualifier/sub-AA cases. Finite representative matrix, not exhaustive Cartesian product of every setting.','resource_selection_limits':['Observed qualifier vocabulary; exact/default language/region matching for fixtures; BCP47/locale fallback deliberately excluded','Framework resources and Android system palettes are retained as external references','No native glyph metrics or pixel-comparison observations','Scene bags are independent; explicit baseScene inheritance follows do1 flags, not unconditional CSS property merge'],'source_catalog':sources,'built_in_control_catalog':catalog,'fixtures':fixtures}
# Intern repeated evidence-rich bags; fixture outcomes remain explicit ID mappings.
component_catalog=[];value_catalog=[];sequence_catalog=[];config_catalog=[];step_catalog=[]
indexes={}
def intern(kind,value,catalog):
 key=(kind,json.dumps(value,sort_keys=True,ensure_ascii=False))
 if key not in indexes:
  ident=kind+str(len(catalog)+1).zfill(3);indexes[key]=ident;catalog.append({'id':ident,**value})
 return indexes[key]
for f in fixtures:
 cfg=f['inputs'].pop('configuration');f['inputs']['configuration_ref']=intern('C',cfg,config_catalog)
 gp=f['inputs'].pop('global_preferences');f['inputs']['global_overrides']={k:v for k,v in gp.items() if GLOBAL_DEFAULTS[k]!=v}
 f['inputs'].pop('initialization_contract')
 sequence=[{k:v for k,v in x.items() if k!='qualified_parent_chain'} for x in f.pop('applied_style_sequence')]
 f['application_sequence_ref']=intern('A',{'step_refs':[intern('T',step,step_catalog) for step in sequence]},sequence_catalog)
 for key,value in list(f['outcomes'].items()):
  if key in COMPONENTS:f['outcomes'][key]=intern('S',{'component':key,**value},component_catalog)
  else:f['outcomes'][key]=intern('V',{'attribute':key,**value},value_catalog)
 f['outcomes']={'component_refs':[v for k,v in f['outcomes'].items() if k in COMPONENTS],'attribute_refs':[v for k,v in f['outcomes'].items() if k not in COMPONENTS]}
 f.pop('unknown_numeric_layout_values')
 f.pop('interpretation')
 f.pop('conditions')
 f['evidence_refs']=['PA1031-S2-STYLE-004']+(['PA1031-S2-STYLE-006'] if f['warnings'] else [])
out['configuration_catalog']=config_catalog
out['resolved_component_catalog']=component_catalog
out['resolved_attribute_catalog']=value_catalog
out['application_sequence_catalog']=sequence_catalog
out['style_application_step_catalog']=step_catalog
out['global_preference_defaults']=GLOBAL_DEFAULTS
out['fixture_contract']={'initialization':'Explicit post-initialization preference state. Global defaults plus overrides; registry defaults plus skin preferences. Device migration presets are separate scenarios.','conditions':['No external skin; supplied1031 APK','Component S IDs refer to style bags, not unconditional CSS scene merging','V IDs refer to resolved theme attributes with provenance','C IDs fully specify configuration inputs; A IDs are ordered style application steps'],'unknown_numeric_layout_values':{'final_text_bounds':None,'final_transition_rectangles':None,'dynamic_android_material_you_palette':None},'unknown_explanation':'These remain explicit unresolved outputs until Android Paint metrics/platform color inputs and the remaining scene-layout paths are supplied; no owner settings prerequisite is asserted.'}
path=Path(os.environ.get('POWERAMP_FIXTURES_OUT',ROOT/'session2/drafts/configuration-fixtures.json'));path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n')
print(json.dumps({'fixtures':len(fixtures),'source_catalog':len(sources),'all_registry_controls':sum(len(x['options']) for x in catalog),'all_registry_choices':sum(len(o['choices']) for x in catalog for o in x['options']),'warning_fixtures':[f['id'] for f in fixtures if f['warnings']],'bytes':path.stat().st_size}))
