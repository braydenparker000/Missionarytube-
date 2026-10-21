#!/usr/bin/env python3
"""Build the bounded settings-system reference and validate private citations.

Input is an existing, privately reconstructed build-1031 workspace. No APK or
decompiled source is copied to the output. This script records research claims,
not source code, and is intentionally separate from application implementation.
"""
import argparse
import json
import re
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--private-root', type=Path, default=Path('/workspace/work/poweramp'))
p.add_argument('--output', type=Path)
a = p.parse_args()
root = a.private_root
out = a.output or root / 'session2/drafts'
out.mkdir(parents=True, exist_ok=True)

def j(name):
    if name == 'com/maxmpz/audioplayer/SettingsActivity':
        name = 'com/maxmpz/audioplayer/preference/SettingsActivity'
    return 'jadx/sources/' + (name if '/' in name else 'ׅ/' + name) + '.java'

def src(name, needle, symbol=None, kind='java'):
    path = name if name.endswith('.smali') else j(name)
    text = (root / path).read_text()
    offset = text.find(needle)
    if offset < 0 and needle.startswith('public '):
        method = needle.split('(')[0].split()[-1]
        match = re.search(r'^\s*public[^\n]*\b' + re.escape(method) + r'\(', text, re.M)
        if match:
            offset = match.start()
    assert offset >= 0, (path, needle)
    line = text[:offset].count('\n') + 1
    return dict(kind='smali' if path.endswith('.smali') else kind,
                path=path, symbol=symbol or needle, locator=f'line:{line}')

records = []
def fact(n, topic, claim, sources, value=None, conditions=None, uncertainty=None,
         verification='Inspected native source reconstruction; no Android runtime execution.',
         status='CONFIRMED_STATIC'):
    records.append(dict(id=f'PA1031-S2-PREF-{n:03}', topic=topic, claim=claim,
                        status=status, conditions=conditions or [], value=value,
                        units=None, sources=sources, verification=verification,
                        uncertainties=uncertainty or []))

fact(1, 'settings.persistence.global',
     'SettingsActivity delegates global SharedPreferences to the application aggregate over b40, c40, m30, l30. These are custom registered binary stores, not ordinary Android preference XML.',
     [src('com/maxmpz/app/base/BaseApplication', 'public SharedPreferences getSharedPreferences'),
      src('com/maxmpz/audioplayer/Application', 'return new l3[]{b40.K'),
      src('com/maxmpz/audioplayer/SettingsActivity', 'public final SharedPreferences getSharedPreferences')],
     value={'stores': {'b40':'ftp','c40':'futp','m30':'frp','l30':'foutp'}})
fact(2, 'settings.persistence.registration',
     'The y40 ordered list holds all typed wrappers. Only cv1 wrappers enter the aggregate key map; vi0 keyed internal wrappers still participate in keyed import/export but need custom UI bindings.',
     [src('y40','public final void х(ConcurrentHashMap'), src('y40','public final LinkedHashMap H()'),
      src('cv1','interface cv1'), src('av1','class av1'),src('ti0','class ti0')])
fact(3, 'settings.persistence.static-format',
     'y40 serializes registration-order values without key names: header/version, typed payloads, footer. Integer and boolean values occupy int32, float uses raw IEEE bits, long uses int64, strings use a length plus UTF-8 with -1 null and zero empty. im1 values supply their own serialization. A generation comparison gates writes; temporary files are forced and renamed.',
     [src('y40','public final boolean C('),src('x40','public x40('),src('pw0','public final void A(')],
     value={'directory':'files/fsp','header':-168881612,'footer':-268483807,'byte_order':'little-endian','string_write_limit_bytes':1048576},
     uncertainty=['No crash/power-loss durability experiment; rename failure is reported by the store, not by aggregate commit().'])
fact(4, 'settings.persistence.mutation',
     'Global Editor put calls mutate registered typed wrappers immediately; apply schedules saves. commit flushes aggregate stores but returns true unconditionally. clear resets each store to wrapper defaults. remove does not remove fixed shared wrappers. Listener register/unregister methods are empty.',
     [src('m3','public final SharedPreferences.Editor putInt'),src('m3','public final boolean commit'),
      src('m3','public final SharedPreferences.Editor clear'),src('m3','public final SharedPreferences.Editor remove'),
      src('n3','public final void registerOnSharedPreferenceChangeListener'),src('o3','public final void В()')])
fact(5, 'settings.defaults.binding',
     'The global adapter contains(key) tests registration, not whether a user previously saved the key. Typed getters return the wrapper current value, falling back only when the wrapper type is absent. Custom controls in restore mode read these values and ignore their XML defaults.',
     [src('n3','public final boolean contains'),src('n3','public final int getInt'),
      src('com/maxmpz/audioplayer/preference/FixedTwoStatePreference','onSetInitialValue'),
      src('com/maxmpz/audioplayer/preference/TagListPreference','public final void onSetInitialValue'),
      src('com/maxmpz/audioplayer/preference/SeekbarPreference','public final void onSetInitialValue'),
      src('com/maxmpz/audioplayer/preference/EditTextPreference','public final void onSetInitialValue')],
     conditions=['Persistent control bound to the global adapter and registered expected type.',
                 'Android Preference initialization selects restore mode when shouldPersist and SharedPreferences.contains(key) are true.'],
     uncertainty=['The Android framework dispatch implementation is an external platform contract; the APK supplies the adapter and onSetInitialValue implementations. Startup and migration overrides must still be applied before calling the wrapper constructor value an effective default.'])
fact(6, 'settings.defaults.xml-conflicts',
     'Eight XML declarations differ from registered constructor defaults. The stored/default typed values take precedence in restore mode; vis_list_faded_alpha XML 25 versus float 0.25 is a scale conversion, not a contradiction.',
     [src('c40','"aa_aspect"'),src('c40','"anim_long_labels_in_lists"'),src('c40','"anim_speed"'),src('c40','"navbar_seekbar"'),
      src('c40','"vis_preset_change_sec"'),src('c40','"vis_list_faded_alpha"'),src('b40','"pl_import_ratings"'),
      src('b40','"resume_on_resume"'),src('b40','"shutdown_intent"'),src('com/maxmpz/audioplayer/preference/SeekbarPreference','public final void onSetInitialValue')],
     conditions=['See default_conflicts in settings-persistence-map.json; values assume no saved override and relevant startup migrations complete.'])
fact(7, 'settings.persistence.named-store',
     'Other names use the o30/x30 keyed store under files/fsprefs. It loads a typed map, uses __migrated for legacy migration, supports actual key removal, and has distinct typed getters. An integer entry is not coerced to boolean.',
     [src('com/maxmpz/app/base/BaseApplication','o30.К = new File'),src('o30','public o30('),
      src('o30','"__migrated"'),src('x30','public final boolean getBoolean'),src('p30','public final SharedPreferences.Editor remove')],
     uncertainty=['Named-store notification delivery is not established here; p30 records changed keys but its apply path directly schedules persistence. Do not substitute assumed global observer behavior.'])
fact(8, 'settings.migration.store-version',
     'y40.O completes loading and invokes the per-store format migration. Legacy migration reads keyed ti0/qi0/ui0/ri0/wi0 wrappers; b40 version migration additionally converts five zero float sentinels to -1 and returns format version2.',
     [src('y40','public final void O()'),src('y40','public final Pair o('),src('a40','public final int B('),
      src('c40','public final u81 x('),src('m30','public final u81 x('),src('l30','public final u81 x(')],
     uncertainty=['This typed legacy importer should not be generalized to every wrapper without inspecting wrapper inheritance and any other importer.'])
fact(9, 'settings.defaults.fresh-install',
     'A clean build-1031 installation starts previous-build field b40.H1 at -1. BaseApplication clamps it to at least -1 and dispatches Application.с(oldBuild,currentBuild) on a version change. This runs substantial ordered startup migrations even on a new installation.',
     [src('b40','H1 = b40Var.р(-1)'),src('com/maxmpz/app/base/BaseApplication','int iMax = Math.max(-1, pg0Var.А)'),
      src('com/maxmpz/audioplayer/Application','public final void с(int i, int i2)'),
      src('decoded/smali/ׅ/b40.smali','sput-object v4, Lׅ/b40;->H1:Lׅ/pg0;')],
     value={'previous_build_fresh':-1}, conditions=['No prior static preference file and no restored or migrated legacy preference values.'])
fact(10, 'settings.defaults.fresh-library',
     'Constructor zeros are not fresh library view defaults. Application startup and m30.d set category-specific zoom indices and sort values; fresh files_sort=1, library zoom1, file zoom3, album zoom5, search zoom1, and library_home=-1. Zero remaining indices may be interpreted by downstream category fallback logic.',
     [src('m30','public static final void d('),src('com/maxmpz/audioplayer/Application','m30.l0.у(1)'),
      src('com/maxmpz/audioplayer/Application','m30.Z0.у(1)'),src('com/maxmpz/audioplayer/Application','b40.I0.у(-1)')],
     conditions=['Clean install old build -1. Values are stored native indices, not measured geometry or translated list labels.'],
     value={'full_table':'settings-persistence-map.json:fresh_install_library_values'})
fact(11, 'settings.defaults.fresh-skin',
     'Application startup selects built-in Black and migrates both built-in skins. For oldBuild<=0, wv1.Х forces more_buttons=true and BoldFont. Device flag s41.C additionally selects Full Cover at float height/width>=2.3 and Alternative below that ratio. Android-version and device conditions can override navbar settings.',
     [src('com/maxmpz/audioplayer/Application','ti0Var2.у(la1.ActivityTheme_Black)'),src('com/maxmpz/audioplayer/Application','wv1.Х(this, i, la1.ActivityTheme_Black'),
      src('wv1','public static void Х(Application'),src('decoded/smali/ׅ/wv1.smali','div-float/2addr v3, v2')],
     conditions=['Clean installation; no imported owner configuration. Device flags and Android API are inputs.'],
     uncertainty=['The s41.C predicate is preserved symbolically here; this report does not label an untraced device flag as universal.'],
     verification='Verified fresh sentinel and float aspect-ratio division in smali; the JADX expression misleadingly looks like int division.')
fact(12, 'settings.navigation.factory',
     'tp1 binds PreferenceManager to global, resolves target page names, and constructs 45 explicit page helper routes. Legacy audio output aliases resolve to audio_outputs2 and ui_tweaks_player resolves to ui_player. The successful helper branch is inverted in JADX and corrected from smali.',
     [src('tp1','setSharedPreferencesName("global")'),src('tp1','"audio_output_plugins"'),
      src('decoded/smali/ׅ/tp1.smali','if-nez v7, :cond_32')],
     value={'helper_routes':45,'table':'settings-persistence-map.json:page_helpers'},
     verification='45 native const-string/new-instance associations extracted from tp1.smali; checked terminal branch: null helper finishes, non-null helper is installed.')
fact(13, 'settings.navigation.activity',
     'SettingsActivity is single-pane and accepts only tp1 as a valid fragment. Page paths can include a slash child path and #hash anchor. Back first dismisses search, otherwise follows Activity/fragment history; no_backstack can launch the helper parent path. Page entry and closing are distinct app bus commands.',
     [src('com/maxmpz/audioplayer/SettingsActivity','public final boolean onIsMultiPane'),src('com/maxmpz/audioplayer/SettingsActivity','public final boolean isValidFragment'),
      src('com/maxmpz/audioplayer/SettingsActivity','public void onBackPressed'),src('com/maxmpz/audioplayer/SettingsActivity','public final void A(boolean')],
     uncertainty=['SettingsActivity.onCreate has decompiler control-flow damage; exhaustive intent alias precedence is not asserted here.'])
fact(14, 'settings.lifecycle.helper',
     'js1 inflates the page, invokes page-specific binding, subscribes to app/player buses, and traverses p2 child controls for lifecycle hooks. Its rebuild path destroys old controls and reinflates the current page. Closing/stopping requests aggregate persistence.',
     [src('js1','public final void u()'),src('js1','public final void у()'),src('js1','public void с()'),src('js1','public js1(')])
fact(15, 'settings.effects.listeners',
     'Settings effects are explicit listener contracts: immediate player-pipeline command4097, debounced pipeline reload1000ms, app data-change, theme configuration increment, skin reapply, notification recreation, and restart paths. There is no universal Settings reload or timeline.',
     [src('js1','public final void a()'),src('js1','public final void b()'),src('js1','public final void e()'),
      src('js1','public final void h(boolean'),src('js1','public final void i(boolean'),src('as1','public final boolean onPreferenceChange')],
     value={'pipeline_command_arg1':4097,'debounce_ms':1000})
fact(16, 'settings.controls.toggle-list-text',
     'Two-state clicks propose the new boolean to the change listener before persisting. NumberList and TagList retain typed values rather than always storing row indices. EditText commits only positive dialog closure accepted by the listener; empty text disables dependents.',
     [src('com/maxmpz/audioplayer/preference/FixedTwoStatePreference','public void onClick'),
      src('com/maxmpz/audioplayer/preference/NumberListPreference','public final void onDialogClosed'),
      src('com/maxmpz/audioplayer/preference/TagListPreference','public final void setIntValue'),
      src('com/maxmpz/audioplayer/preference/EditTextPreference','public final void onDialogClosed'),
      src('com/maxmpz/audioplayer/preference/EditTextPreference','public boolean shouldDisableDependents')])
fact(17, 'settings.controls.seekbar',
     'SeekbarPreference uses value=progress*step+min and integer division for value-to-progress. floatScale converts UI units to stored floats; array mode stores typed array values. Drag progress updates summary; accepted stop-tracking persists. User motion in the magnet interval snaps to magnet. JADX drops the ordinary progress assignment, which smali confirms.',
     [src('com/maxmpz/audioplayer/preference/SeekbarPreference','public final int А('),
      src('com/maxmpz/audioplayer/preference/SeekbarPreference','public final void Х(int'),
      src('com/maxmpz/audioplayer/preference/SeekbarPreference','public final void onStopTrackingTouch'),
      src('decoded/smali/com/maxmpz/audioplayer/preference/SeekbarPreference.smali','.method public onProgressChanged')],
     value={'max_progress':'(maximum-minimum)/step with integer division','step_zero':'replaced by1','float_read':'Math.round(stored*floatScale)','float_write':'UIvalue/floatScale'},
     uncertainty=['Rejected stop listeners trigger a display rebind but no proven rollback to the previously stored progress; do not assume standard slider rollback behavior.'])
fact(18, 'settings.skin.storage',
     'Skin values occupy an independent named o30 store identified by skin/package plus style resource ID. Built-in skins use skin_<hexStyleId>_. A selectable option stores the selected attr resource ID if present, otherwise the style resource ID; the ordinal is only a UI lookup.',
     [src('com/maxmpz/audioplayer/plugin/SkinInfo','public static String Х('),src('pv1','public final Object B('),
      src('qv1','public final void В('),src('qv1','setPersistent(false)')],
     value={'directory':'files/fsprefs','selected_value':'attrID else styleID'})
fact(19, 'settings.skin.apply-chain',
     'Skin selectors persist to their named store, schedule save, and refresh only when their skin matches active theme package/style. Switches store boolean. Skin seekbars store int/float and post a32ms active-skin refresh; selecting a style does not mutate a generic XML preference.',
     [src('qv1','public final void В('),src('com/maxmpz/audioplayer/preference/SkinSwitchOptionPreference','public final boolean persistBoolean'),
      src('com/maxmpz/audioplayer/preference/SkinSeekbarOptionPreference','public final boolean persistFloat'),
      src('wv1','public static void р('),src('wv1','public final void O()')],
     value={'skin_seekbar_refresh_delay_ms':32})
fact(20, 'settings.skin.dependency-type',
     'Skin runtime dependency checks use boolean lookup with true fallback. Since x30 only treats q30 entries as boolean, an integer selector such as alt_layout returns the fallback true. UI dependency disable behavior and runtime overlay filtering must be modeled separately.',
     [src('x30','public final boolean getBoolean'),src('wv1','getBoolean(skinOption.А, true)')],
     conditions=['Dependency key has an integer s30 stored entry; a genuine false q30 boolean instead suppresses the dependent option.'])
fact(21, 'settings.reset.page',
     'Generic page reset recursively visits persistent non-plain controls and resets registered ce wrappers to their constructor defaults, then saves/rebuilds the page. It does not rerun every application startup migration, and actions/nonpersistent custom bindings require explicit reset callbacks.',
     [src('js1','public static void l('),src('js1','public final void k('),src('ka','case 24:')],
     uncertainty=['A page-specific callback can add resets or effects; use the controller binding for a particular page.'])
fact(22, 'settings.reset.skin',
     'Skin reset recursively removes option keys, then for built-in skin applies the built-in migration/default initializer and active-skin refresh. This differs from generic wrapper reset and from deleting all app preferences.',
     [src('wv1','public static void p(List'),src('q0','wv1.p(arrayList, p30Var)'),src('wv1','public static void Х(Application')])
fact(23, 'settings.sub-art.editor-persistence',
     'Editable sub-art layouts persist separate portrait/landscape arrays of button resource IDs. Editor exit trims trailing empty slots while retaining internal zero gaps, and asynchronously saves c40. Centered layout stores0; the alternative stores1. Two-line mode stores2.',
     [src('com/maxmpz/widget/player/SubAAButtonsLayout','public final void G1('),src('com/maxmpz/widget/player/SubAAButtonsLayout','public static void x1('),
      src('c40','"sub_aa_buttons_port"'),src('com/maxmpz/audioplayer/preference/PaEditableButtonsRestorePref','public final void restore(')],
     uncertainty=['The resource IDs are action identities, not visual left-to-right positions; SubAA onLayout determines placement.'])
fact(24, 'settings.sub-art.constructor-correction',
     'SubAA constructor uses centered=true iff the selected orientation layout value is0, and twoLines=true iff its orientation lines value is2, when the custom option path is enabled. JADX inverted these boolean expressions. Fallback paths choose centered=true and twoLines=false.',
     [src('decoded/smali/com/maxmpz/widget/player/SubAAButtonsLayout.smali','iput-boolean v2, p0, Lcom/maxmpz/widget/player/SubAAButtonsLayout;->U:Z'),
      src('decoded/smali/com/maxmpz/widget/player/SubAAButtonsLayout.smali','iput-boolean v6, p0, Lcom/maxmpz/widget/player/SubAAButtonsLayout;->W:Z')],
     verification='Traced constructor branch labels cond_1/cond_2/cond_3 and cond_8/cond_9 with final iput-boolean; no entitlement enforcement was altered.')
fact(25, 'settings.export.ui-contract',
     'Settings import/export actions construct selectable-domain dialogs and background tasks. The option model contains13 domains: settings, music folders, EQ presets, reverb presets, otherDSP, outputs, third-party skins, artwork, playlists, streams, ratings/statistics, bookmarks, list memory. File filters recognize poweramp-settings and poweramp-backup.',
     [src('s','public s()'),src('e30','poweramp-settings'),src('pt1','public final boolean onPreferenceClick')],
     uncertainty=['Domain availability and defaults depend on the option model and app state; this fact counts declared domains, not universally enabled/exported domains.'])
fact(26, 'settings.export.typed-contract',
     'Export gathers keyed preferences, writes prefs rows with file/name/type/value, and uses type codes s,l,i,b,f,[i; int arrays are little-endian blobs. Import resolves known keyed wrappers and type-checks each row before mutation. Unknown or invalid keys/types are skipped/logged. The cursor loop continues after rows; JADX contains a spurious dangling throw.',
     [src('c30','public static void P('),src('c30','public static void Р('),src('hf0','public static void Х('),
      src('decoded/smali/ׅ/hf0.smali','.method public static Х(')],
     uncertainty=['Native wrapping around the archive has not been reverse engineered; binary compatibility with the original export format is not claimed.'],
     verification='Checked hf0.smali method Х cursor loop and successful y40.C(false,false) exit; no owner data imported/exported.')

# Factory mapping is a contract for extraction, not a count of user-visible settings.
factories = [
 ('a','av1','int',0,1,True),('b','dv1','string',1,0,True),('c','xu1','boolean',1,0,True),
 ('с','zu1','float',1,0,True),('p','ti0','int',0,1,False),('X','qi0','boolean',1,0,False),
 ('О','wi0','string',None,1,False),('о','ui0','long',None,1,False),('у','ri0','float',None,1,False),
 ('Н','pg0','int',None,None,False),('р','pg0','int',0,None,False),('K','hh','boolean',None,None,False),
 ('P','ey1','string',None,None,False),('y','s50','float',None,None,False),('Р','yn0','long',None,None,False)]
implicit={'О':None,'о':0,'у':0.0,'Н':0,'K':False,'P':None,'y':-1.0,'Р':0}
factory_rows=[]
for method,wrapper,typ,defaultarg,keyarg,glob in factories:
    row=dict(method=method,wrapper=wrapper,type=typ,default_argument_index=defaultarg,
             key_argument_index=keyarg,exposed_in_global_adapter=glob,
             static_helper=method in ['О','о','у'],evidence=['PA1031-S2-PREF-002'])
    if defaultarg is None: row['implicit_default']=implicit[method]
    factory_rows.append(row)

helper_path=root/'session2/logs/settingssystem-helper-extraction.json'
helpers=json.loads(helper_path.read_text())
assert len(helpers)==45 and len({x['page'] for x in helpers})==45
yp={'already_purchased':0,'buy_methods':6,'ui':17,'ui_theme':18,'ui_player':20,'ui_notify':19,
    'audio':1,'fade':7,'audio_focus':2,'audio_tweaks':5,'rg':14,'audio_resampler':13,
    'peq_equ_bands':4,'audio_outputs_tweaks':3,'library_lists':8,'library_search':11,
    'library_queue':9,'library_shuffle':12,'library_scanner':10,'translations':16,'space':15}
for h in helpers:
    h['evidence']=['PA1031-S2-PREF-012']
    h['source']='decoded/smali/ׅ/tp1.smali'
    if h['helper']=='yp1': h['variant_discriminator']=yp[h['page']]
    if h['helper']=='xp1': h['variant_discriminator']={'ui_lyrics':1,'ui_mediaactions':2,'aa_bg':0}[h['page']]
    if h['helper']=='vr1': h['variant_discriminator']={'vis':1,'audio_platform_log':0}[h['page']]

conflicts=[('aa_aspect',0,1,'c40.t','aa'),('anim_long_labels_in_lists',True,False,'c40.O0','ui_player'),
 ('anim_speed',False,1,'c40.K0','ui'),('navbar_seekbar',False,True,'c40.j0','library_lists'),
 ('pl_import_ratings',True,False,'b40.p1','library_playlists'),('resume_on_resume',True,False,'b40.t0','audio_focus'),
 ('vis_preset_change_sec',15,10,'c40.D','vis'),('shutdown_intent','',None,'b40.K1','misc')]
conflict_rows=[]
for key,xmlval,regval,field,page in conflicts:
    path=root/j(field.split('.')[0]); txt=path.read_text()
    match=re.search(r'([\w\u0400-\u04ff]+)\s*=.*?"'+re.escape(key)+r'"',txt)
    owner=field.split('.')[0]
    field=owner+'.'+match.group(1) if match else None
    if key=='anim_speed':
        # The factory result is obtained indirectly from the last registered entry.
        assert 'n0 = (qg0) ceVar;' in txt
        field='c40.n0'
    conflict_rows.append(dict(key=key,page=page,xml_default=xmlval,registered_constructor_default=regval,
      field=field,registration_owner=owner,control_restore_value_when_no_saved_override=regval,
      precedence='Typed registered current value, after startup migrations, through global adapter.',
      evidence=['PA1031-S2-PREF-005','PA1031-S2-PREF-006']))

# Fresh library stored indices, resolved from the ordered oldBuild=-1 startup path.
m30=(root/j('m30')).read_text()
# Deliberately retain an explicit audited subset; all unresolved fields stay out.
zooms={'l0':1,'m0':3,'n0':5,'o0':3,'p0':3,'q0':5,'r0':3,'s0':5,'t0':3,'u0':5,'v0':3,
 'w0':5,'x0':3,'y0':4,'z0':3,'A0':5,'B0':3,'C0':4,'D0':3,'E0':5,'F0':3,'G0':4,'H0':3,
 'I0':5,'J0':3,'K0':5,'L0':3,'M0':3,'N0':3,'O0':3,'P0':3,'Q0':3,'R0':3,'S0':3,
 'T0':0,'U0':0,'V0':0,'W0':0,'X0':3,'Y0':0,'Z0':1}
sorts={'l':1,'m':0,'n':0,'q':0,'r':0,'s':0,'t':0,'u':9,'v':0,'w':0,'z':0,'D':9,'E':0,'F':0,
 'G':0,'I':9,'J':0,'L':9,'M':0,'N':0,'Q':0,'R':9,'S':0,'T':0,'U':0,'V':6,'W':4,'Y':7,
 'Z':1,'a0':0,'b0':9,'c0':0,'d0':0,'e0':2,'a1':900000}
fresh=[]
for field,value in {**zooms,**sorts}.items():
    match=re.search(r'^\s*'+field+r' = m30Var\.p\((\d+), "([^"\n]+)"\)',m30,re.M)
    assert match,field
    fresh.append(dict(key=match.group(2),field='m30.'+field,constructor_default=int(match.group(1)),
                      fresh_install_stored_value=value,conditions=['oldBuild=-1; no legacy/restored state'],
                      evidence=['PA1031-S2-PREF-009','PA1031-S2-PREF-010'],
                      caution='Stored index/sort code; downstream category fallback and semantic mapping still apply.'))

obj=dict(schema_version=1,scope='Build1031 static settings plumbing and selected complete chains; no runtime observation.',
 global_stores=[dict(owner=x,filename=y,directory='files/fsp',evidence=['PA1031-S2-PREF-001']) for x,y in [('b40','ftp'),('c40','futp'),('m30','frp'),('l30','foutp')]],
 named_store=dict(owner='o30/x30',directory='files/fsprefs',keyed=True,strict_typed_getters=True,evidence=['PA1031-S2-PREF-007']),
 registration_factories=factory_rows,page_helpers=helpers,default_conflicts=conflict_rows,
 scale_normalizations=[dict(key='vis_list_faded_alpha',xml_default=25,stored_default=.25,float_scale=100,evidence=['PA1031-S2-PREF-017'])],
 fresh_install_library_values=fresh,
 fresh_install_skin_values=dict(previous_build=-1,active_skin='Black',both_builtin_skins={'more_buttons':True,'font_variant':'ActivityTheme_BoldFont'},
   device_conditional={'s41.C':{'aspect_ratio_gte_2_3':'overlap_alt_layout2','aspect_ratio_lt_2_3':'overlap_alt_layout'},'API>=29':{'navbar_offset':False}},
   evidence=['PA1031-S2-PREF-009','PA1031-S2-PREF-011']),
 important_boundaries=[
   'XML declared default, typed constructor default, startup-migrated fresh value, saved value, reset value, and effective runtime selector are separate fields.',
   'Global Editor immediate wrapper mutation precedes async disk save; explicit listeners control UI/application reload.',
   'Skin stores are independent per theme; select values are resource identities, not row ordinals.',
   'Output device controls can be nonpersistent Android Preferences backed by custom profile wrappers; see the audio-output investigation.',
   'No APK runtime execution or pixel measurements were performed.'])
(out/'settings-persistence-map.json').write_text(json.dumps(obj,ensure_ascii=False,indent=2)+'\n')
(out/'settings-system-ledger.jsonl').write_text(''.join(json.dumps(x,ensure_ascii=False)+'\n' for x in records))
print(json.dumps({'ledger_records':len(records),'page_helpers':len(helpers),'factory_methods':len(factory_rows),
 'default_conflicts':len(conflict_rows),'fresh_library_values':len(fresh),'source_citations':sum(len(x['sources']) for x in records)},indent=2))
