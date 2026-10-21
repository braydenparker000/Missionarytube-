# Settings construction, typed storage, defaults, and application contracts

This reference covers build 1031's settings infrastructure and representative complete configuration chains. All findings are static unless explicitly qualified. No Android instance was executed, no owner configuration was requested, and no native preference file was modified. The companion ledger contains 26 claims with 112 private-source citations; `settings-persistence-map.json` contains 45 helper routes, 15 factory contracts, eight default differences, and 76 audited fresh-install library values. These are mechanism-coverage counts, not claims that every user-facing setting has a traced consumer.

## The distinction that controls default resolution

Poweramp does not use a single ordinary Android SharedPreferences XML file. Its Settings UI presents Android Preferences, while `BaseApplication.getSharedPreferences("global", …)` returns a custom adapter over the `b40`, `c40`, `m30`, and `l30` stores. These stores live under `files/fsp/` with names `ftp`, `futp`, `frp`, and `foutp`. A separate named, dynamically keyed store uses `files/fsprefs/`; skins use this second mechanism. [PREF-001–008]

Each global `y40` store holds typed wrappers in declaration order. Its factories register both shared wrappers (`av1`, `xu1`, `zu1`, `dv1`) and keyed internal wrappers (`ti0`, `qi0`, etc.). Only wrappers implementing `cv1` enter the `n3` aggregate that Android Preferences see. Internal keyed values can still be exported and imported, or bound explicitly by specialized controllers. A lexical key inventory therefore cannot assume that every key is a directly persistent Android Preference. Audio device controls and editable sub-art controls are concrete exceptions.

Six different values must remain separate in a future configuration model:

1. The XML-declared default.
2. The typed wrapper constructor default.
3. A value loaded from a saved file or legacy migration.
4. The value after application version/fresh-install initialization.
5. The value produced by the particular Reset action.
6. The final runtime selector after device, theme, category, and other conditions.

The aggregate's `contains(key)` means “registered key,” even if no user file exists. Its getters return the current wrapper value of the expected type. In the standard Android Preference initialization contract, a persistent key found by `contains` selects restore mode; the app's custom controls then read the aggregate value, bypassing the XML default. This framework dispatch is an external Android contract; the APK directly proves the adapter and each `onSetInitialValue` implementation. [PREF-005]

| Key | XML declaration | Registered value when unset | Important interpretation |
| --- | --- | --- | --- |
| `aa_aspect` | 0 | 1 | Typed integer selector |
| `anim_long_labels_in_lists` | true | false | Global switch |
| `anim_speed` | false | 1 | Integer TagList value; XML token is misleading |
| `navbar_seekbar` | false | true | Global switch |
| `pl_import_ratings` | true | false | Startup migration also writes false |
| `resume_on_resume` | true | false | Still subject to its dependent-control rules |
| `vis_preset_change_sec` | 15 | 10 | Seekbar stores integer seconds |
| `shutdown_intent` | empty string | null | EditText's initial field/fallback is null; empty and null are distinct stored states |

`vis_list_faded_alpha` is not a conflict: the XML UI value25 corresponds to stored float0.25 through `floatScale=100`. The registry must normalize control units before comparing defaults. [PREF-006,017]

## Fresh installation is an initialized state

The previous build field `b40.H1` is constructed with **-1**, not0. `BaseApplication.onCreate` takes `max(-1,H1)`, saves the current build and invokes `Application.с(previous,current)` on a version change. A new installation therefore runs the ordered migration initializer with `previous=-1`; constructors alone do not specify fresh behavior. Smali confirms this sentinel. [PREF-009]

Fresh initialization selects built-in Black. It assigns category-specific library zoom indices and sorting codes, including files sort1, library zoom1, files zoom3, albums zoom5, artists/genres/composers zoom4, search zoom1, and library home-1. The machine-readable map contains76 exact library stored values. Remaining zero indices retain downstream category fallback semantics and must not be described as final measured list layouts. [PREF-010]

At the end of initialization, both built-in skin stores pass through `wv1.Х`. For `previous<=0`, this explicitly writes `more_buttons=true` and `font_variant=ActivityTheme_BoldFont`. The default from the skin declaration alone is therefore insufficient. Under device flag `s41.C`, it also writes Full Cover (`overlap_alt_layout2`) when **floating-point** display height/width is at least2.3; otherwise Alternative (`overlap_alt_layout`). Smali confirms conversion to float before division, correcting the misleading JADX expression. API>=29 can set `navbar_offset=false`; API>=31 plus the device predicate and a bottom-navigation-inset test can choose NoAndroidNavbarBg. The predicate is preserved as an input here rather than assigned an unverified marketing/device label. [PREF-011]

There are also API-specific global fresh defaults: for example the `previous<0` branch chooses Settings font2 at API>=29 and0 below29. Generic page reset writes wrapper constructor defaults instead, so a Reset result can differ from the original fresh state. A faithful recreation must define initialization and scoped resets separately.

## Storage and update sequence

`y40` files have a little-endian header magic, format version, ordered typed payloads, and footer magic. Keys are absent from this binary sequence. Primitive wrappers read their saved slot if available and otherwise retain their constructor default. Strings distinguish null, empty, and positive-length UTF-8; custom `im1` serializers handle arrays/other composites. A change generation gates saving. A temporary sibling file is mapped/written/forced and renamed to the destination. This is a static I/O contract, not a tested claim about power-loss durability. [PREF-003]

Global `Editor.put*` mutates the typed wrapper immediately. `apply()` schedules writes; `commit()` flushes stores but returns true unconditionally. Missing or wrong-typed global keys throw. `clear()` resets registered wrappers, while `remove()` does not erase fixed shared wrappers. The global adapter's listener-registration methods are empty. Explicit page listeners and message buses, rather than a presumed universal SharedPreferences observer, drive application effects. [PREF-004]

The dynamic `o30/x30` store instead owns key/type entries and supports actual deletion. Getters do not coerce types: `getBoolean` accepts `q30`, while an integer `s30` returns the supplied boolean fallback. The skin runtime dependency pass uses fallbacktrue; consequently an integer dependency such as `alt_layout` passes this check. That does not prove every dependent overlay visibly affects every layout: the separate UI enable/disable path and actual target-style applicability still matter. [PREF-007,020]

Two version systems are distinct: per-file format migration (`y40.O` and `x(version)`) and application-build initialization (`Application.с`). The former can import legacy keyed wrappers; `b40` format migration additionally converts five zero float sentinels to-1. Neither should be flattened into a generic “set defaults” operation. [PREF-008,009]

## Page construction, ownership, and effects

`SettingsActivity` is a single-pane PreferenceActivity admitting only the `tp1` fragment. `tp1` sets the PreferenceManager name to `global`, resolves a page name to XML, and chooses one of45 explicit helper routes. The companion table includes route, concrete helper, smali line, and discriminator for reused `yp1`, `xp1`, and `vr1` helpers. Four important route aliases are proven: `audio_output_plugins`, `audio_output`, and `audio_outputs` go to `audio_outputs2`; `ui_tweaks_player` goes to `ui_player`. The terminal null/success helper branch is inverted in JADX; smali proves that a non-null helper is installed and a null helper fails/closes. [PREF-012]

`js1` owns XML inflation, page-specific control binding, recursive preference lifecycle, relevant bus subscriptions, and page reconstruction. A page can therefore dynamically insert/remove controls after inflation; the XML tree is not the final page tree. Back closes Settings search before normal navigation; `no_backstack` can route to the helper's parent page. Paths can carry child paths and `#hash` targets. Exact intent-alias precedence is still limited by damaged `SettingsActivity.onCreate` reconstruction. [PREF-013,014]

| Listener/effect family | Native contract |
| --- | --- |
| Immediate audio reload | `js1.a` removes its pending delayed reload, then posts `cmd_player_reload_pipeline`, arg1=4097, source `settings` |
| Debounced audio reload | `js1.b` cancels/reposts the same runnable after1000ms |
| Data change | `as1` posts `msg_app_data_changed` |
| Theme revision | Explicit ThemeManager configuration increment |
| Theme reapply | `js1.e` rebuilds the effective theme, applies it to Application, then increments configuration |
| Notification change | `cmd_player_recreate_notification` |
| Settings restart | Finish/restart Settings with current intent, optionally fading |
| Application restart | Separate `js1.h`/`lp1.g` path |

These mechanisms are binding targets, not a claim that every preference uses every path. The setting-effects registry assigns specific controls to their actual listeners. [PREF-015]

## Representative complete chains

**Ordinary boolean:** `FixedTwoStatePreference` proposes the inverse value to `callChangeListener`; accepted input calls `setChecked`, which persists through global `n3/m3` to the `xu1/ih` wrapper. The page's explicit listener schedules the relevant app effect. Mutation precedes asynchronous disk persistence. Dependencies and visual notification follow control-specific code. [PREF-004,016]

**Scaled slider:** `vis_list_faded_alpha` binds a `SeekbarPreference` with min0, max100, floatScale100. Restore reads the registered float, multiplies by100 and rounds. Drag value is `progress*step+min`; ordinary progress updates the summary. Stop tracking sends the typed float to the change listener and persists accepted `UIvalue/100`. Array-mode sliders instead persist the selected integer/float/string array entry. `value→progress` uses Java integer division, not a general round-to-nearest rule. User movement within `[magnet-step, magnet+step]` snaps to the magnet. Smali repairs a missing ordinary-progress assignment in JADX. No rollback to the previous persisted position is claimed for a rejected listener. [PREF-017]

**Built-in layout selector:** the generated skin preference binds `qv1` and sets Android persistencefalse. Selection chooses the option's attr ID if present, otherwise its style ID, then writes that integer to the current skin's named store and schedules saving. If the selected skin package and resource ID match the active skin, `wv1` cancels GUI modal state and re-applies the theme. The effective-style resolver then combines the selected overlay with global options and runtime mappings. The saved integer is a resource identity, never merely a list ordinal. [PREF-018,019]

**Skin boolean/slider:** `SkinSwitchOptionPreference` writes a boolean directly to that named store and invokes the active-skin refresh. `SkinSeekbarOptionPreference` copies range/step/scale/magnet metadata from `SkinSeekbarOption`, writes int or float, and posts active refresh after32ms. These typed controls are separate from `qv1`'s selectable style-ID path. [PREF-019]

**Sub-art editing:** the editor operates on a separate portrait/landscape array of button resource IDs. Exit trims trailing empty cells but preserves internal zero gaps; it writes `c40.D0` or `c40.N0`, then schedules a c40 save. Centering writes orientation layout0 for centered and1 otherwise; two-line mode uses value2. Constructor smali confirms `centered=(layout==0)` and `twoLines=(lines==2)` under the custom-option availability guard; JADX had both expressions reversed. The slot array is not left-to-right display order. View construction/layout and edit gesture ownership belong to the component/style and interaction references. [PREF-023,024]

**Reset:** generic reset traverses the current preference tree and calls `ce.y()` on registered persistent non-plain controls, then saves/rebuilds. Custom nonpersistent preferences require a callback or another specialized reset. Skin reset recursively deletes the current skin/page option keys, runs built-in initialization with previous-build0 where applicable, and refreshes the active skin. Sub-art reset explicitly resets eight portrait/landscape configuration keys. These are three different reset scopes. [PREF-021–023]

**Import/export:** Settings actions create domain-selection dialogs and background tasks. The model declares13 domains; state and application edition affect availability. Keyed preferences become `prefs` rows with file/name/type/value, including type codes `s/l/i/b/f/[i`; integer arrays use little-endian blobs. Import looks up known wrappers and verifies the expected type before mutation/save. Smali confirms cursor iteration after invalid/handled rows, correcting a dangling throw in JADX. The native archive wrapper remains unexamined, so interchange compatibility is not established. This investigation never requested or processed an owner's settings export. [PREF-025,026]

## Limits and implementation implications

The settings infrastructure, typed value model, page factory, scoped reset model, selected control chains, and fresh/default distinction are sufficiently established to design a configuration architecture. Every option must retain its own type, storage scope, phase-specific default, dependency, and application contract. Exact native IDs and Android resource values should remain evidence identifiers, not automatically become web public API contracts.

The remaining gaps are explicit: exhaustive effects for all controls; dynamic page visibility across real device capability combinations; Android framework behavior across supported API versions; every device flag behind initialization; all migration histories; notification delivery in named stores; platform lifecycle interruptions; original archive interoperability; runtime preview and pixel verification. The76 fresh library rows give stored indices, not final effective resource/layout results. No static count here implies runtime confirmation or complete inventory of conditional controls.

Run `python session2/scripts/settingssystem_build.py --private-root <reconstructed-workspace>` to regenerate the structured artifacts and validate all112 citation anchors. This script requires the private source reconstruction and the45-route extraction in `session2/logs/settingssystem-helper-extraction.json`; it never copies decompiled source into research output. Ledger IDs use the full prefix `PA1031-S2-` before each `PREF-…` reference above.
