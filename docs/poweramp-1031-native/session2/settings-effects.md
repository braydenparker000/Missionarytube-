# Settings effects and dynamic audio controls

This extends Session 1 from static controls to their storage and consumers. `setting-deep-traces.json` contains 78 distinct control keys across 18 XML pages. Of those, 68 reach a traced control → storage → consumer or native configuration interface boundary. Ten deliberately retain narrower classifications: notification renderer selection (5), headset event delivery (2), queue branch coverage (2), and one fade control with an apply-notification gap. These are scope counts, not a percentage of the entire application. No claim here is runtime-confirmed; native DSP implementation and actual connected-device capabilities remain outside the traced boundary.

Sources are private reconstruction paths rooted at the verified build 1031 workspace. Ledger IDs `PA1031-S2-EFFECT-001` through `030` index exact paths, symbols and line locators. The structured rows contain per-control XML values, defaults, persistence, dependencies, effect routes and uncertainty. Page titles and navigation placement come from the common Settings registry; filenames below identify native pages rather than invented display labels.

## Dynamic outputs form a scoped configuration system

Audio Outputs declares six device classes: headset, speaker, Bluetooth, USB, other and Chromecast. The page helper adds endpoint-profile routes as well as the six class routes. The selected driver is a plugin unique-name string: global class selection lives in `foutp`; endpoint selection uses its nested keyed profile map. `output_api` writes this selection through `l30.i`, and changing driver requests pipeline reload with scheduling argument 500 ms. Driver candidates come from NativePluginManager and an output device-support mask, including a Chromecast restriction to device class 5. There is no fixed universal driver dropdown independent of platform and plugin availability. [`001`, `025`]

Each driver/device/endpoint combination owns a `j30` store named `foutp-<composite>`. The plain composite is the driver's short name followed by the device name and separators; endpoint variants prepend endpoint text and U+001F. Most controls in `audio_output_device_opts.xml` have `android:persistent="false"`. This means the Android Preference widget does not save the displayed key. It does **not** make their values transient: `wq1`/`zq1` bind them to keyed `j30` properties, change listeners write those properties, and page close saves the profile. The visible key `float` aliases stored `use_float`. [`001`, `003`]

Defaults have at least three levels: constructor fallback, profile initialization and runtime selection. `j30` registers zero/false for many fields, but `u01.А` invokes `u01.P` when buffer fields are unset. That reset initializes driver/device/platform-specific values. For example, Chromecast initializes presentation latency to 500 ms, buffer duration to 1500 or 1800 ms under its API/platform branch, one DSP buffer, and no-headroom/no-EQ/no-audio-focus flags. Treating the constructor's zero/false as a universal new-user default would be wrong. Hi-Res and USB-exclusive paths also initialize allowed-rate masks and DSD-related fields. The full vendor matrix in `u01.P` remains open. [`002`]

`nr1.M` queries native capabilities and supported rate/format masks, then adds, removes or disables controls. `bq1.I` caches removed Preference instances for later reinsertion and animates affected rows. `d0` handles Boolean capability binding; `h0` admits tristate controls only when all requested bits match. The following table is a verified interface mapping. A mask is a native support/activation contract, not proof that a particular device exposes it. Some unsupported controls remain visible but disabled, according to helper arguments. [`004`, `009`]

| Setting / control | Capability or request mask | Consumer contract |
|---|---:|---|
| No DVC | `0x10` | DVC request requires global `dvc_enabled` and profile `no_dvc=false` |
| No headroom / no EQ | `0x20` / `0x40` | Output configuration flags |
| Float format | `0x80` | Stored `use_float`, output configuration flag |
| No duck / no audio focus | `0x2000` / `0x100000` | Output configuration flags |
| DSD DoP / raw preference | `0x10000` / `0x20000` | Output configuration flags |
| Volume type / sync hardware volume | `0x40000` | Volume type 1 requests hardware volume; sync setting separately controls saved-volume synchronization |
| Force USB full speed | `0x80000` | Output configuration flag |
| Follow track rate | `0x800000` | Per-output −2, or Auto plus global follow flag |
| Set Bluetooth codec rate | `0x1000000` | May require Android 34+ CompanionDevice association |
| 64-bit / DSD remaster / bit-perfect | `0x2000000` / `0x4000000` / `0x8000000` | Tristate local setting with global inheritance |
| Target alternate-rate quirk / prefer base rate | `0x10000000` / `0x20000000` | Output configuration flags |
| PCM/DSD extra warmup / allow 48 kHz DSD family | `0x40000000` / `0x80000000` | Output configuration flags; 48 kHz option needs active remaster |
| Pause releases USB | `0x100000000` | Output configuration flag |
| Play silence in background | `0x200000000000000` | Java pipeline silence keeper, rather than a flag directly packed by `u01.A` |
| Warmup | `0x2` | Output configuration flag |

`pipeline64`, `dsd_remaster` and `perfect_bit_perfect` each use `0=Auto`, `1=Enable`, `−1=Disable`. In Auto, their corresponding global Boolean selects the requested flag. Explicit local enable/disable wins. The native configuration builder starts at byte offset 32 and writes plugin/device IDs, buffer fields, flags, presentation latency, selected rate/format, reconfiguration delay, allowed rates and remaster rate. This boundary is established; the behavior of every native output implementation is not. [`005`, `009`]

Sample-rate options include Auto (0), capability-gated Follow Track (−2), Bluetooth Codec (−3) and supported PCM rates. The selector appears only when more than one candidate exists. Remaster/bit-perfect state also changes its effective display and enabled state. The allowed-rate multiselect stores a bitset: zero falls back to the supplied capability default, display ensures a PCM bit, and save requires at least one bit in `0x3ff0`. Native serialization applies mask `0x3ff03ff0`. Supported masks come from native calls; they must not be replaced by a single guessed list. Format selection offers Auto −1, conditional Codec −3 and indexes of supported format bits 0…30, and is shown when the mask is nonzero. Remaster-rate selection uses mask `0x15500000`, or bit `0x100000` when its supplied mask is zero; DSD rates are represented by negative integers. [`007`, `008`, `029`]

Ordinary profile changes generally schedule reload with argument 100 ms, driver/global changes 500 ms, and valid allowed-rate changes 1000 ms. These numbers are request parameters, not measured completion times. Global follow-rate only requests an immediate reload when the active device/driver and capability guard match. Global bit-perfect warning has a notable edge: `cq1` returns true after showing the warning, while its positive callback explicitly requests reload. The custom switch accepts a true listener result, so cancellation cannot safely be described as reverting the saved preference. Verify checked state, persisted state and the next unrelated reload on Android before reproducing this edge. [`006`, `024`]

## Audio controls apply through different routes

Global DVC defaults true. Its request bit is further gated by the selected profile's no-DVC setting and actual driver support. Unlike the global bit-perfect warning edge, enabling DVC from false returns false from the change listener and only the positive confirmation callback checks the switch and requests reload. Disabling requests reload directly. [`030`]

ReplayGain uses a live command route. Its type/source dropdowns send `cmd_player_set_rg`; both gain knobs send `cmd_player_set_rg_levels` during progress changes. `y01` dispatches to `Pipeline2.t`, and pipeline creation reapplies all four registered values. Type 0 disables dependent source/gain controls. Gains store hundredths of a dB in −1600…1600 with step 10 and display scale 100. The default type/source and gains are all zero. [`010`]

Resampler controls request pipeline reconstruction. The plugin receives `resampler_type & 1`, `dither & 15`, and cutoff divided by 1000. Settings displays the cutoff as saved value divided by 10 percent; 970 means 97.0% UI and 0.970 native input. Type 0/1 selects SWR/SOX. This establishes parameter and reload semantics without claiming equivalent filter output. [`011`]

Fade controls use `cmd_player_apply_pipeline_prefs`, not full reconstruction as their normal page action. `v11.В(false)` reads auto/manual advance modes, fade durations, seek/play-pause flags, preload and end-silence and forwards them to the current pipeline. One important gap remains: the page does not attach the same explicit listener to `fade_short_xfade_ms`, although the pipeline reads its saved value on preference apply/reconstruction. Its immediate effect when changed alone is not proven. Native fade interpolation, format constraints and bit-perfect interactions need further work. [`012`]

EQ band configuration is mode-dependent and debounced. Standard count changes trigger reload only in standard mode; custom count/frequency changes only in custom mode; the custom toggle always schedules the change. `js1.b` removes the previous pending work and posts the reload task after 1000 ms. Settings allows custom count 5…32, first frequency 5…200 Hz and last frequency 14000…20000 Hz. The consumer clamps more broadly to count 5…32, first 5…400 Hz and last 10000…24000 Hz; preserve UI constraints separately from model validation. The resulting band snapshot reaches the EQ list through the DSP bus. [`013`; rendering reference]

The four tone knobs are dynamically configured controls with no independent XML preference storage. Bass frequency maps to `tone_bass_freq`, bass Q to `tone_bass_q`, and analogous treble keys. They initialize from the live two-band snapshot. Zero in storage means 90 Hz / Q 0.8 bass and 10000 Hz / Q 0.6 treble. Their UI ranges are 20…250 Hz, 5000…15000 Hz and Q 0.1…2.0. Progress updates save the override and send frequency/Q commands at indexes −2/−1; Q rounds to 0.01. The generic Q descriptor nominal value 0.1 is not the actual initial/reset Q. [`021`]

EQ autosave also bypasses the global Preference map. `_autosave` reads `dsp_autosave_enabled`, sends a DSP set-param command, changes `sr.А` and persists keyed `eq_autosave` in store `dspi` through `s.k`. Its registered default is true. This is distinct from both `b40` global settings and a named EQ preset's data blob. Complete named-preset/user-preset edit-routing behavior remains a separate state-machine task. [`022`]

## Library, notifications and other screens

Library settings have heterogeneous effects. `no_sort_field` posts app-data-changed and changes provider sorting columns. Several header, metadata, A–Z and toolbar options instead refresh views. Localized A–Z is removed outside Russian locale. Search-title-only changes query column arrays; filename/title mode is another input. `search_play_tracks` decides whether final file-provider results become playable. These settings are consumed on queries/result completion, rather than all forcing an identical rebuild. [`014`, `015`]

Queue clear/never-clear behavior is partially resolved. Settings disables the never-clear control while clear-on-add is selected but retains its value. In the inspected enqueue branch without `playing_entry_id`, the code counts remaining unplayed entries (`played_at < created_at`) and clears when this count is zero and `(clear_on_add || !never_clear_on_add)`. That is an exact branch contract, not the full queue/return/history model. [`028`]

Notification type 0 resolves through API/vendor conditions, rather than naming one renderer. `notify_colorize` is removed below API 26, `notify_resume` below 30 and `notify_prefer_nav` at 33+. Colorize and prefer-nav are enabled for resolved type 1; notification colors for other types. Changing resume support removes the notification and requests process restart. The selected Android notification's final pixels and platform media behavior remain runtime questions. [`016`]

Lyrics offset changes presented time by compensating for playback latency: the internal compensation is latency minus the saved offset. The Settings range is −5000…5000 ms in steps of 50. Keep-screen is acquired and released by lyrics-page lifecycle. Plugin selection can expose a custom URL entry, while lyrics-file scan changes request rescan. [`017`]

Headset/Bluetooth resume default false and are consumed by connection events with playback and USB guards. USB/Bluetooth requests use a 500 ms delay argument in the inspected branch; command delivery uses a service below API 26 and broadcast at 26+. This is an event contract; no actual device connection or delivery was observed. [`018`]

Visualization's `enable_vis` checkbox aliases integer `vis_mode`: checked means nonzero, enabling writes 1, disabling 0. The player mode picker separately supports 0…2. It therefore does not preserve an earlier mode 2 when toggled off/on in Settings. The helper sends `cmd_gui_set_vis_mode` and explicitly saves `c40`; `i22` dispatches state-specific visualization transitions when playback is active. [`023`]

Two experimental controls demonstrate why unmatched global keys cannot be discarded. `usb_activity` persists in Android's component-enabled state for the manifest-disabled USBMainActivity alias; it enables/disables handling of USB attachment through MainActivity without killing the app. `load_user_so` uses a private marker file and requests process restart. The loader checks that marker and then attempts a readable library in the app's external files directory. No custom library was supplied or executed during research. [`026`, `027`]

General/player UI controls likewise have multiple application routes: orientation, status-bar and keep-screen settings notify the theme manager; many label/menu/animation options post view refresh; Settings theme/font can recreate the Settings activity; language changes also schedule locale-dependent library work. The style resolver must model these invalidation boundaries independently of the stored values. [`019`]

## Corrected decompilation and remaining targets

Smali resolves several material JADX errors: `u01.A` global-inheritance bodies were omitted; `nr1.M` inverted the sample-rate loop, sample selector count predicate, format-mask visibility predicate and driver entries-empty predicate; and `ur1`'s tone constructor sets discriminator 0 although JADX prints the merged field initializer as 1. These corrections matter to which controls exist and which saved values take effect. They are source corrections, not runtime validation.

The next most useful work is to normalize `u01.P/Х` hardware defaults and every `nr1.M` capability branch using smali; trace the global bit-perfect warning's cancellation on Android; finish queue/history precedence and all notification renderer variants; and resolve the lone fade listener gap. Those gaps do not block architecture experiments with scoped stores, typed settings, explicit consumer invalidation, capability-driven controls and separate DSP/plugin interfaces. They do prevent a claim that every platform-dependent setting or resulting native pixel has been reproduced.
