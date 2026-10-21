#!/usr/bin/env python3
"""Extract bounded widget control metadata and validate static source citations."""
import argparse, json, re
from pathlib import Path
import xml.etree.ElementTree as ET

p=argparse.ArgumentParser()
p.add_argument('--private-root',type=Path,default=Path('/workspace/work/poweramp'))
p.add_argument('--output',type=Path)
a=p.parse_args(); root=a.private_root; out=a.output or root/'session2/drafts'; out.mkdir(parents=True,exist_ok=True)
base='jadx/sources/com/maxmpz/audioplayer/widgetpackcommon/'
def S(path,needle):
    if '/' not in path: path='jadx/sources/ׅ/'+path+'.java'
    elif not path.endswith(('.java','.smali','.xml','.json')): path=base+path+'.java'
    t=(root/path).read_text(); n=t.find(needle); assert n>=0,(path,needle)
    return dict(kind='smali' if path.endswith('.smali') else 'xml' if path.endswith('.xml') else 'java',path=path,symbol=needle,locator='line:'+str(t[:n].count('\n')+1))
def B(needle):return S(base+'BaseWidgetConfigure.java',needle)
ledger=[]
def F(n,topic,claim,sources,conditions=None,uncertainties=None,value=None):
    ledger.append(dict(id=f'PA1031-S2-WIDGET-{n:03}',topic=topic,claim=claim,status='CONFIRMED_STATIC',conditions=conditions or [],value=value,units=None,sources=sources,
      verification='Static control and storage tracing; no Android widget host/runtime execution.',uncertainties=uncertainties or []))
F(1,'widgets.configuration.surface','Four size-specific configuration activities use a shared BaseWidgetConfigure with Background, Text, Buttons, Other pages, backed by four concrete layouts and dynamically specialized controls.',
  [B('this.Y = new int[]{R.layout.widget_conf_bg'),S(base+'B.java','public final androidx.fragment.app.B A('),S(base+'Widget2x2Configure.java','public final void C('),S(base+'Widget4x4Configure.java','public final void C(')],value={'tabs':4,'unique_option_control_ids':37})
F(2,'widgets.configuration.storage','Widget style configuration uses named appwidgets preferences, with decimal appWidgetId directly prefixed to keys. da2 stores colors, flags, packed style words, font family, radii, padding, theme and button color. x11 supplies preview/current-track state rather than style configuration.',
  [S('ia2','public static SharedPreferences B('),S('ia2','public final ga2 В('),S('da2','public final void x('),S(base+'В.java','public final da2 С(')],
  value={'named_store':'appwidgets','normal_application_directory':'files/fsprefs/appwidgets'})
F(3,'widgets.configuration.live-apply','A style edit marks the da2 object modified and coalesces zero-delay wf case2 work that serializes its widget-prefixed values and rebuilds the preview. Preview uses provider-generated RemoteViews apply/reapply. Style-page selection separately debounces control refresh300ms and serialization1000ms.',
  [B('public final void i(da2'),S('wf','default:'),B('public void updateWidgetInFragment'),S('vf','handler.postDelayed(wfVar, 300L)')],value={'edit_refresh_ms':0,'style_controls_ms':300,'style_save_ms':1000})
F(4,'widgets.configuration.complete','Done and Back both call the completion method: flush pending style serialization, clear provider caches, update the host widget ID, then finish. Back is therefore a commit path. Active option pane and advanced/collapsed state persist separately; expand/collapse uses a250ms native scene transition when animated.',
  [B('public void onBackPressed'),B('public final void Х()'),B('public final void onPause()'),B('public final void t(boolean'),B('public final void u(boolean')],
  value={'pane_default':0,'advanced_default':False,'scene_duration_seconds':.25})
F(5,'widgets.configuration.range','Padding sliders map progress through Math.round(progress*0.5)+size-specific minimum, despite float storage. The inverse UI binding uses Math.round((stored-min)/0.5). Font sizes are indices0..10, subsequently resolved to size-specific dimension resources. Radius controls are indices with nonlinear native radius mapping, not raw CSS pixels.',
  [B('float fRound = Math.round(i * 0.5f)'),S('decoded/smali/com/maxmpz/audioplayer/widgetpackcommon/BaseWidgetConfigure.smali','invoke-static {p1}, Ljava/lang/Math;->round(F)I'),
   S(base+'В.java','public static int Р('),S(base+'Widget4x1Provider.java','public final int p('),S(base+'Widget4x2Provider.java','public int p(')],
  uncertainties=['Full per-provider geometry remains outside this bounded trace; padding values are transformed again by density and provider-specific offsets.'])
F(6,'widgets.configuration.global-exception','The Animate Album Art widget checkbox writes global c40.l0 / animate_widget_aa, not an appWidgetId-specific style. onStop schedules c40 saving. Provider animation selection consumes the same field and preview mode suppresses animation.',
  [B('c40.l0.у(z)'),B('public final void onStop()'),S('c40','"animate_widget_aa"'),S(base+'В.java','!c40.l0.А || ga2Var.р')])
F(7,'widgets.configuration.conditional','API31 is the modern widget branch: replaces shadow-opacity controls with a shadow checkbox, exposes button color and album-art corner controls, and changes style resources and arrays. Size-specific subclasses hide/replace artwork options, expose fixed size only on2x2, and hide category-change controls on2x2.',
  [S(base+'В.java','о = Build.VERSION.SDK_INT >= 31'),B('public void o(ViewGroup'),B('public void C(ViewGroup'),S(base+'Widget4x2Configure.java','public Widget4x2Configure()'),S(base+'Widget2x2Configure.java','public final void o('),S(base+'Widget4x4Configure.java','public final void C(')])
F(8,'widgets.configuration.styles','Native bundled style JSON resources supply selectable presets, combined with saved style files and an optional reconfigure entry. API/resource qualifiers select different arrays. Existing-widget reconfiguration is inserted only when that ID has flags or legacy shadow data; smali repairs the misleading onCreate guard and proves the array parser returns its accumulated list.',
  [B('public final void onCreate(Bundle'),B('public da2 g(JsonReader'),S('decoded/smali/com/maxmpz/audioplayer/widgetpackcommon/BaseWidgetConfigure.smali','if-nez v1, :cond_8'),S('decoded/smali/com/maxmpz/audioplayer/widgetpackcommon/BaseWidgetConfigure.smali','.method public final a(Ljava/io/Reader;Z)Ljava/util/ArrayList;')],
  uncertainties=['Preset source-entry counts do not include saved owner files; complete visual reproduction of all presets is not claimed. No proprietary preset JSON is copied into research output.'])
F(9,'widgets.configuration.color','Background and icon color confirmation preserve each current alpha channel while changing RGB and resource reference; text/button colors use the selected HSV color. Shadow toggle writes0 or255. Enabling artwork shadow also resets artwork opacity to the slider maximum.',
  [S('of','public final void onClick('),B('public final void O(int i, boolean z)')])

android='{http://schemas.android.com/apk/res/android}'
fields={
 'bg_color_button':('x/y','colors/color_reses','color'), 'bg_style_spinner':('X','style_bits[0:3]','style-index'),
 'padding_hor':('С','padding_hor','padding'), 'padding_ver':('c','padding_ver','padding'), 'padding_ver2':('с','padding_ver2','padding'),
 'bg_alpha':('alpha(x)','colors','alpha'), 'corner_radius':('o','style_bits2[0:5]','radius-index'),
 'bg_shadow':('р','style_bits[16:23]','boolean-shadow'), 'shadow_alpha':('р','style_bits[16:23]','alpha'),
 'text_color_button':('K/H','colors/color_reses','color'), 'font_family_spinner':('О','font_family','font-index'),
 'title':('A:1024','flags','inverted-boolean'), 'title_font_style_bold':('A:128','flags','boolean'),
 'title_font_style_italic':('A:256','flags','boolean'), 'text_align_left':('a=1','style_bits2[8:9]','alignment'),
 'text_align_center':('a=2','style_bits2[8:9]','alignment'), 'text_align_right':('a=3','style_bits2[8:9]','alignment'),
 'title_font_size':('о','style_bits[8:11]','font-size-index'), 'other_text':('A:2048','flags','inverted-boolean'),
 'font_style_bold':('A:32','flags','boolean'), 'font_style_italic':('A:64','flags','boolean'), 'font_size':('O','style_bits[4:7]','font-size-index'),
 'buttons_color_button':('d/e','button_color/button_color_res','color'), 'icons_color_button':('Р/P','colors/color_reses','color'),
 'theme_spinner':('b','theme','theme-index'), 'cat_change':('A:2','flags','inverted-boolean'),
 'playing_mode':('A:4','flags','inverted-boolean'), 'icons_alpha':('alpha(Р)','colors','alpha'),
 'aa_cb':('A:4096','flags','boolean'), 'alt_scale_cb':('A:4096','flags','boolean'),
 'aa_shadow_cb':('A:8192','flags','boolean'), 'meta_cb':('A:16','flags','boolean'), 'meta_bg':('A:512','flags','boolean'),
 'animate_aa':('c40.l0','animate_widget_aa','global-boolean'), 'fixed_size':('A:16384','flags','inverted-boolean'),
 'aa_alpha':('p','style_bits[24:31]','alpha'), 'aa_corner_radius':('C','aa_corner_radius','radius-index')}
conditions={
 'shadow_alpha':'API<31; enabled only for nonzero background style', 'bg_shadow':'API>=31; enabled only for nonzero background style',
 'aa_corner_radius':'API>=31', 'buttons_color_button':'API>=31 and theme index1,2,3,4 enabled',
 'aa_cb':'2x2/4x1/4x2; hidden4x4','alt_scale_cb':'4x4 only','fixed_size':'2x2 only',
 'cat_change':'Hidden2x2','padding_ver2':'Hidden when subclass maximum is0 (4x4)',
 'bg_alpha':'Enabled only for nonzero background style','corner_radius':'Enabled only when provider.A(style) allows it',
 'title_font_size':'Enabled when Title is checked','title_font_style_bold':'Enabled when Title is checked','title_font_style_italic':'Enabled when Title is checked',
 'font_size':'Enabled when Other text is checked','font_style_bold':'Enabled when Other text is checked','font_style_italic':'Enabled when Other text is checked'}
controls=[]
tabs=[('bg','Background'),('text','Text'),('buttons','Buttons'),('other','Other')]
for tab,label in tabs:
 path=root/f'decoded/res/layout/widget_conf_{tab}.xml'
 for e in ET.parse(path).iter():
  typ=e.tag.split('.')[-1]; id=e.get(android+'id','').split('/')[-1]
  if typ not in ['Button','Spinner','SeekBar','CheckBox','FastCheckBox']:continue
  assert id in fields,id
  field,key,kind=fields[id]
  r=dict(id=id,tab=label,control=typ,value_kind=kind,model_field=field,persistence_key_suffix=key,
    scope='global:c40' if id=='animate_aa' else 'appwidgets:<decimal widget id>',
    default='Selected bundled/saved/reconfigured style; no universal control default.',
    availability=conditions.get(id,'Present in base page; active style and host may add further guards.'),
    sources=[S(str(path.relative_to(root)),e.get(android+'id'))],evidence=['PA1031-S2-WIDGET-001','PA1031-S2-WIDGET-002','PA1031-S2-WIDGET-003'])
  if kind=='alpha':r['range']=[0,255]
  if kind=='font-size-index':r['range']=[0,10]
  if kind in ['boolean','inverted-boolean','global-boolean']:r['values']=[False,True]
  if kind=='padding':r['mapping']='Math.round(progress*0.5)+minimum; maxProgress=Math.round((maximum-minimum)/0.5)'
  if id=='animate_aa':r['default']='c40 constructor true, subject to Application.с device/API startup overrides.';r['evidence'].append('PA1031-S2-WIDGET-006')
  controls.append(r)
assert len(controls)==37 and len({x['id'] for x in controls})==37
sizes={
 '2x2':dict(padding_hor=[-24,96],padding_ver=[-16,256],padding_ver2=[-64,256],background_style=[0,6],corner_max='8 beforeAPI31;16 fromAPI31'),
 '4x1':dict(padding_hor=[-32,36],padding_ver=[-16,18],padding_ver2=[-16,32],background_style=[0,7],corner_max='8 beforeAPI31;16 fromAPI31'),
 '4x2':dict(padding_hor=[-50,72],padding_ver=[-16,32],padding_ver2=[-8,40],background_style=[0,7],corner_max='8 beforeAPI31;16 fromAPI31'),
 '4x4':dict(padding_hor=[0,32],padding_ver=[0,64],padding_ver2=None,background_style=[0,6],corner_max=16)}
arrays=[]
for d in ['values','values-v26','values-v31']:
 path=root/f'decoded/res/{d}/arrays.xml'
 for e in ET.parse(path).getroot():
  if e.get('name') in ['pref_widget_font_families','pref_widget_font_families_extra','widget_theme_entries']:
   arrays.append(dict(name=e.get('name'),qualifier=d,values=[x.text for x in e],source=str(path.relative_to(root))))
presets=[]
for path in sorted((root/'decoded/res').glob('raw*/*styles.json')):
 d=json.loads(path.read_text())
 presets.append(dict(source=str(path.relative_to(root)),entries=len(d),all_objects=all(isinstance(x,dict) for x in d),evidence=['PA1031-S2-WIDGET-008']))
fonts=[]
for path in sorted((root/'decoded/res').glob('values*/dimens.xml')):
 for e in ET.parse(path).getroot():
  if re.fullmatch(r'widget(?:2x2|4x1|4x2)_font_size\d+',e.get('name','')):
   fonts.append(dict(name=e.get('name'),value=e.text,qualifier=path.parent.name,source=str(path.relative_to(root))))
obj=dict(schema_version=1,scope='Bounded deep trace of37 unique controls in4 shared option tabs, size/API conditions, style storage and preview/completion; no runtime widget host.',
 controls=controls,size_ranges=sizes,array_declarations=arrays,font_dimension_declarations=fonts,
 preset_source_counts=presets,style_source_selection={'4x1':'small_widget_styles','4x2':'widget_4x2_styles at API>=31, otherwise small_widget_styles','2x2':'widget_2x2_styles','4x4':'widget_4x4_styles'},
 persistence=dict(named_store='appwidgets',key_prefix='decimal appWidgetId with no separator',shared_ui_state={'pane':0,'advanced':False},
   style_bits={'0..3':'background style','4..7':'other-text size index','8..11':'title size index','16..23':'shadow alpha','24..31':'art alpha'},
   style_bits2={'0..5':'corner index','8..9':'text alignment'},legacy_read='font family can be read from style_bits bits12..15 then overridden by separate font_family key',
   evidence=['PA1031-S2-WIDGET-002']),
 consumer_contracts=['Provider.Р radius mapping index<=10→4*index, otherwise40+8*(index-10); when circle mode enabled and index16→10240 sentinel.',
  'Provider font-index resolver reads getDimensionPixelSize of per-size dimen; declared font dimensions here are dip, not automatically sp.',
  'Provider consumes flags for visibility, colors/opacity, layout/theme, padding, and typography; exact final pixel geometry remains unmeasured.'],
 open_questions=['Complete per-preset effective widget geometry and qualifier/font fallbacks.',
  'Live widget-host sizing and resize behavior, platform differences and interruption cases.',
  'All named-file persistence errors and host rendering outcomes.',
  'Menu style import/export loops and legacy style conversion need additional smali validation for full compatibility.'])
(out/'widget-settings.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
(out/'widget-settings-ledger.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in ledger))
print(json.dumps({'controls':len(controls),'tabs':4,'size_families':4,'ledger_records':len(ledger),'preset_source_files':len(presets),'source_citations':sum(len(x['sources']) for x in ledger)},indent=2))
