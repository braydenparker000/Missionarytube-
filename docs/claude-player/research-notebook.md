# Claude Player — independent reference research notebook

Reference target: **Poweramp build 1031** (`build-1031-uni`, versionCode 1031009).
Every finding records: (a) artifact/version, (b) condition, (c) mechanism, (d) inference,
(e) confidence and falsifier, (f) the original implementation contract it drives.

Classes: `CONFIRMED_STATIC` (read from a declared resource, code or official doc),
`CONFIRMED_RUNTIME` (observed on the running reference), `INFERRED`, `OPEN`,
`UNSUPPORTED_WEB`. **No finding below is `CONFIRMED_RUNTIME`**: the reference could not be
executed in this environment (no Android device, emulator or KVM). A declared duration is
not an observed elapsed time, and a declared dimension is not a final on-screen bound.

## Sources and handling

| ID | Artifact | Handling |
| --- | --- | --- |
| S1 | `Poweramp-build-1031-uni.apk`, SHA-256 `27cfde3fc8e55b2effffe88c7e80ec3a1b1f69ec37a09ef86d9a34aafe8ebb9e`, 23,936,965 bytes (matches handoff) | Decoded with apktool 2.10.0 (`--no-src`) outside version control. Targeted JADX 1.5.1 single-class decompilation only. Nothing extracted is committed. |
| S2 | Official public repo [`maxmpz/powerampapi`](https://github.com/maxmpz/powerampapi) @ `60cac5a` (2026-09-01): `poweramp_skin_sample/readme.md`, `poweramp_skin_sdk/reference_resources` (commented attrs/styles of build 1026) | Read as documentation. Its LICENSE permits redistribution only for software that communicates with Poweramp on Android, so **none of it is copied into this project**. |
| S3 | In-app help overlays in S1 (`merge_help_*` layouts and their strings) | Official in-app description of gestures. |
| S4 | Renderer experiment in [`experiments/renderer-bench/`](experiments/renderer-bench/) | Original code, headless Chromium. |

Decompilation scope so far: `SceneFastLayout`, `SceneParams`, `AnimTimeHelper` and the obfuscated
scene animator helper class they delegate to. No smali, native-library or exhaustive decompilation.

## Findings

### F01 — Application shell and screens — `CONFIRMED_STATIC`
(a) S1 manifest. (b) Any configuration. (c) Activities `MainActivity`, `PlayerUIActivity`, `ListActivity`,
`EqActivity`, `SettingsActivity` (+ `preference.SettingsActivity`), ~40 dialog activities (`dialogs.*`:
EQ presets, list options, lyrics, tag edit, playlist select/sort/export, album-art select, audio info,
sleep/buffer…), `PlayerService`, media button/headset/BT receivers, widget providers, a quick-settings
tile, Android Auto browser service and Cast. Launcher-icon variants are activity aliases (`black_round`,
`rounded_mu` …). (d) The SDK readme states Poweramp v3 has *one* player activity; the other main
activities are entry aliases into it. (e) High. Falsify: runtime shows separate task stacks.
(f) One browser document hosts the whole player; settings and dialogs are separate scenes or layers.

### F02 — Main UI is a single scene graph — `CONFIRMED_STATIC`
(a) S1 `res/layout-sw2dp/activity_main.xml`; S2 readme “Poweramp v3 Skin Theme Specifics”.
(b) All skins. (c) One `TopNavSceneFastLayout` contains every major element: visualizer, list widget,
album-art bounds, Cast button, waveseek layout (waveseek, cursor, play/pause, elapsed, duration), meta
layouts, A–Z scroller, sub-album-art buttons, EQ/search/visualizer panels (lazily loaded behaviours),
navbar, list indexer popup, menu placeholders, selection menu, toasts, status/navigation bar
backgrounds. Each element is followed by `SceneParams` pseudo-tags giving its parameters per scene, and
by `StateAnimParams` for transient states. Buttons dispatch `msgId`/`longPressMsgId` onto a named bus
(`bus_player_cmd`). (d) “Player”, “library”, “search”, “EQ”, “lyrics” and “visualization” are **scenes of
one element set**, not pages. (e) High. (f) `SceneGraph` + `MessageBus` contracts; no route-per-screen UI.

### F03 — Scene inventory — `CONFIRMED_STATIC`
`defaultScene`, `scene_playing`, `scene_lib`, `scene_search`, `scene_lyrics`, `scene_eq`, `scene_vis`,
`scene_vis_w_ui`, `scene_vis_temp_ui` at the top level; list items have their own scenes (readme cites
`scene_aa` → `scene_grid`). Example: `TopWaveseekLayout` is `gone` with `scale 0.75` in `scene_lib`, visible
with `alpha 1` in `scene_playing`, `alpha 0.25` in `scene_vis_w_ui`. (f) Scene ids are enumerated
constants in the engine. Item-level scenes are `OPEN` until list layouts are analysed (M4).

### F04 — SceneParams semantics — `CONFIRMED_STATIC` (official doc)
(a) S2 `attrs-scene.xml`. (c) Missing visibility means unchanged. Missing alpha means 1.0. Scale is
uniform only. Elevation jumps rather than animates. `baseScene` copies another scene's params.
`scene_2…scene_6` share one params block. `recalcChildren`: `on_end` (default; children keep the
initial layout and jump at the end), `on_start` (children jump to the final layout first), `dynamic`
(re-layout every frame, documented as costly), `none`. `jumpVisibility`, `applyViewParams`,
`applyEvenIfGone`, `privateScene`. StateAnim is *orthogonal* to scenes and animates alpha, scale,
translation, rotation and duration per state id. (f) `SceneParams` record type; the engine implements
each documented flag exactly. An undocumented combination is `OPEN`, not guessed.

### F05 — Scene transition interpolation and duration law — `CONFIRMED_STATIC` (code), medium-high confidence
(a) S1 scene animator class (obfuscated) reached from `SceneFastLayout`. (c) The scene animation uses
Android `DecelerateInterpolator(2.0)`, i.e. `y = 1 − (1 − t)^4`. Its duration is
`1 / (1/T + v)` seconds, where `T` is the base time in seconds and `v` a velocity-like term clamped
to `[0, 10]`. It starts from the animator's **current ratio**, so a running transition can be reversed
or retargeted without restarting. A completion step starts a state animation of 0.45 s.
(d) A faster fling settles a scene sooner. A tap transition uses `v = 0`, so it takes `T`.
(e) Medium-high: static reading of obfuscated code; call-site mapping (which `T` for which scene pair)
is not traced yet. Falsify: a frame-stepped recording of a tap transition that doesn't fit a quartic
ease-out. (f) `SceneClock`: quartic ease-out, velocity-shortened duration, ratio-continuous
interruption. Tested by unit tests (M1) and later by device recordings.

### F06 — State animations — `CONFIRMED_STATIC` (code)
State animations use `DecelerateInterpolator(1.0)` (`1 − (1 − t)^2`), defaulting to 1 s when no
positive duration is given. Declared state durations come from F07. (f) `StateAnimClock`.

### F07 — Declared timing table — `CONFIRMED_STATIC` (declaration only)
`TopContainer` style: `animTime 150`, `animMainEnterTime 500`, `animMainExitTime 250`,
`stateAnimTime 250`, `playStateAnimTime 320`, `visAnimTime 320`, `visEnterAnimTime 500`,
`visExitAnimTime 100`, `aaEnterAnimTime 250`, `aaBlurExitAnimTime 150`, `aaBlurUpdateAnimTime 50`,
`aaBlurLongerUpdateAnimTime 250`, `aaBlurNoAAToAAAnimTime 200`, `forcedAnimTime 250`,
`aaLockDurationMs 90` (ms). (d) Enter and exit of the main scene are asymmetric (500 vs 250).
(e) Which attribute drives which transition is `INFERRED` from names; elapsed time is `OPEN` until
recorded. (f) Timing table keyed by transition, never one global duration.

### F08 — “Animations” setting — `CONFIRMED_STATIC` (code + prefs)
`ui.xml` `anim_speed` (feature-pack option). The helper returns ~1 ms (or 0.001 s) when disabled,
`× 0.6` in fast mode, and the declared value otherwise. A licence or feature check participates in the
mode lookup (`INFERRED`). (f) Global `animScale` ∈ {0 (instant), 0.6, 1}; `prefers-reduced-motion`
maps to “disabled” by default.

### F09 — FastLayout layout model — `CONFIRMED_STATIC` (official doc)
(a) S2 `attrs-fastlayout.xml`. (c) Strictly one pass, one measure per pass, in XML child order
(`layout_after` reorders). Gravity applies when no attach point exists on an axis. `layout_attach*`
attaches to a parent side, a sibling id or a fraction. `layout_attach*To*` aligns same edges.
`layout_consumeSpace` (+ reset flags) consumes parent space. Also `layout_matchDimension`
(width-to-height / height-to-width), percent sizes, min/max, `layout_*Ref` dynamic dimensions,
`goneWhenEmpty`, `attachToParentIfGone`, `forceGravityIfGone`, `compensateScale`, gravity groups.
(e) High for documented attributes. Undocumented edge cases (for example consume-space interplay
with percent sizes) are `OPEN` until oracle tests disagree. (f) `FastLayoutSolver`: a deterministic
one-pass JS solver over the same vocabulary. Its cost suits per-frame use for `dynamic` subtrees.

### F10 — Skin/theme composition — `CONFIRMED_STATIC` (xml + official doc)
(a) S1 `res/xml/poweramp_builtin_skins.xml`, S2 readme “overlapStyle and overlapAttr”.
(c) A skin is a base theme style plus ordered options. Each selected option applies an `overlapStyle`
directly, or resolves an `overlapAttr` **in the theme composed so far** and applies the resulting
style. The readme states this lets earlier options re-point later ones. Example: `overlap_more_buttons`
resolves to a different style under the default layout, the Alt layout and the plain seekbar.
(f) `ThemeComposer`: base style → ordered option application with attr indirection → resolved
attribute map. Layout and scene styles are looked up through `?attr` references.

### F11 — Built-in skin option inventory — `CONFIRMED_STATIC`
Skins **Light** (`ActivityTheme_White`, dark pair Black) and **Black** (`ActivityTheme_Black`, light pair
White), honoured by `follow_night_mode`. Options in declared order:
`alt_layout` radio (Default / Alt / Alt2), `track_labels_align` (depends on layout; Default/Centered),
`labels_bg` (Enabled/Hidden), `player_buttons_bg` (Enabled/Hidden), `mu_colors` (Android 12+;
Disabled/More/Less pronounced), `font_variant` (System / Alt / **Bold = default**), `rounding`
(More / Less), `seekbar` (Waveseek default / Static / Plain with buttons), `more_buttons` (default on),
`light_buttons` (Light skin only), `knob_hilite` (None / Mono / **Colorful default**),
`graphic_frs_color` (Mono / **Colorful default**), `force_light_navbar` (Light only), `statusbar_bg`
(Black only), `navbar_bg` (Default / Semi-transparent / No background), `navbar_offset`,
`android_navbar_bg`. Global options: rating disabled / stars menu.
(f) Typed `SkinOptionSchema`. Each value maps to the overlay it applies.

### F12 — Window-size buckets drive geometry — `CONFIRMED_STATIC`
~60 `values-*` qualifier sets (for example `sw360dp-h640dp-port`, `sw380dp-h750dp-port`,
`sw390dp-w640dp-land`). `TopPlay_maxSize` alone has 18 variants from 72 to 104 dp.
(d) Geometry is a function of the *app window* size in dp. In Chrome the URL bar and system bars
reduce the window, so a naive mapping selects a smaller bucket than the native app on the same phone.
(f) `QualifierResolver` implements Android's best-match rules over `{sw, w, h, orientation, long, density}`.
The window basis is explicit and shown in diagnostics (browser viewport vs standalone/full-screen).
1 CSS px = 1 dp on Android Chrome at default zoom (`devicePixelRatio` = density).

### F13 — Waveseek — `CONFIRMED_STATIC` (official doc)
`waveLayout`: `scrollable` (default; the wave scrolls under a cursor and is dragged by swipes) or
`fixed` (the Static Seekbar option; progress follows the touch, with `cursorPosition`/`cursorOffset`).
`numBars`, `barWidth`, `barSpacing`, `minBarHeight`, `divisor`/`divisorSize` (mirrored top/bottom
bars), bars drawn from crafted bitmaps with `barTint`. The plain seekbar option swaps in a plain `Seek`
with extra buttons (`merge_plainseekbar_morebuttons`). The waveform computation itself happens in
native code: `OPEN` (algorithm unknown; the provisional peak/RMS method will be labelled).
(f) `Waveseek` canvas component plus a worker-side `WaveformAnalyzer`.

### F14 — Gesture inventory — `CONFIRMED_STATIC` (in-app help, S3)
Album art: swipe ←/→ changes track, “swipe more” changes category, swipe ↓ or tap opens the track's
source list, swipe ↑ opens lyrics, long press opens the menu. Library list: swipe ←/→ goes to the parent
category, pinch-to-zoom changes the zoom level, long press an item opens the selection menu, and
multiple checked items drag as a group. Navbar: tap returns to the player, swipe ←/→ changes tracks,
long press opens the track category. Meta info: tap cycles. Between player buttons: long press edits
them. Search categories: tap toggles a filter, long press filters to one. Visualization: swipe ←/→
changes preset. Player settings add `line2_click`/`line2_long_click`, cover long press opening the menu,
and rating swipes. (f) `GestureArena` recogniser set.

### F15 — Gesture thresholds and fling physics — `OPEN`
Not declared in resources (no swipe, slop or fling dimens beyond Material library values). They live
in code (`AAScrollingBehavior`, `BusAAScrollingBehavior`, `ScrollingBehavior`, `DragHandler`, list
classes). Next step: targeted decompilation of those classes in M1. Until then, Android platform
defaults (touch slop 8 dp, long press ≈400 ms) are labelled *provisional platform defaults*, not
Poweramp values.

### F16 — Navbar / mini-player composition — `CONFIRMED_STATIC`
`merge_navbar`: `navbar_container` (scene layout) → `navbar` with `navbar_list` (a `PowerList`: the
mini-player is a horizontally paged track list), optional `navbar_seekbar` (setting “Seekbar in
Navbar”), `navbar_nav_buttons` (Library, EQ, Search, More), and `navbar_extension` with settings tags.
(f) `Navbar` component reusing the list/pager primitives.

### F17 — Settings corpus — `CONFIRMED_STATIC`
452 distinct preference keys across ~45 preference screens (`res/xml`). Root: Look and Feel, Audio,
Visualization, Background, Album Art, Library, Headset/Bluetooth, Lock Screen, Misc, About, plus
export/import and purchase/feature-pack entries. Typed widgets: switch, tag list, seekbar (min/max/
step/labels), colour, number list, redirects, raw text. Dependencies and defaults are declared.
(f) A generated-by-hand typed `SettingsSchema`. Every key carries an implementation status; none is
silently dropped.

### F18 — Library list transitions — `INFERRED`
Classes `PowerListZoomTransitionBase`, `PowerListGenericPivotTransitionBase`,
`PowerListHeaderToItemTransitionBase`, `PowerListItemToHeaderTransition`, `PowerListSharedItemTransition`,
`PowerListGenericFadeTransition`, `AASmallTransition` exist. The semantics are inferred from names
only. Next step (M4): targeted decompilation plus recordings.

### F19 — Typography — `CONFIRMED_STATIC`; licensing constraint
Bold font option (the **default**) uses **TT Norms Pro** Bold/Medium, a commercial typeface. The Alt
font uses a modified (“smaller”) **Manrope**, which upstream is SIL OFL. System uses the platform font.
(f) Bold option: a licensed substitute chosen by metric comparison and labelled as a substitute
(exact reproduction is infeasible without a purchased web licence). Alt option: upstream OFL Manrope
with size adjustment to match the modified metrics (`INFERRED` until measured). System: `system-ui`.

### F20 — Audio engine — `CONFIRMED_STATIC`; largely `UNSUPPORTED_WEB`
Native `libpowerampcore.so` and `libffmpeg_neon.so`. Settings cover output selection, bit-perfect,
resampler, DVC, buffer, audio focus, fade, replay gain, EQ (graphic and parametric bands), tone,
limiter and reverb. (f) Browser playback via HTML media elements plus an optional Web Audio graph.
Native output, DAC, bit-perfect and resampler semantics are `UNSUPPORTED_WEB`.

### F21 — Visualization — `CONFIRMED_STATIC`
MilkDrop-format presets (~250 `.milk` files), a Lua runtime and GLSL shaders in `assets/`, rendered
natively. Preset authorship is heterogeneous. (f) Deferred decision (M8): an independent WebGL
renderer or a licensed open-source one; no presets redistributed without a licence review.

### F22 — AutoEQ database — `CONFIRMED_STATIC`; budget constraint
`assets/auto_eq.db` is 7.3 MB, which exceeds the whole remaining frontend budget (F25).
(f) `UNSUPPORTED_WEB` within the current hosting budget. Would need an approved data-hosting decision.

### F23 — Album-art background parameters — `CONFIRMED_STATIC`
`aa_bg.xml`: blur 0–15 (default 5), details 0–10 (default 5), intensity 0–250 % (default 100),
saturation 0–300 % step 10 (default 150), gradient 0–10 with colour, list and lyrics backgrounds.
(f) `ArtBackdrop` (GPU-friendly downscaled blur on canvas) parameterised identically.

### F24 — Renderer experiment — measured, synthetic (not phone proof)
See [`experiments/renderer-bench/README.md`](experiments/renderer-bench/README.md). At 8× CPU
throttle, the DOM scene with compositor transforms held 59.7 fps with 0 % of frames over 33 ms.
A full-scene Canvas 2D at device resolution fell to 15 fps with 98.7 % of frames over 33 ms. A canvas
list fling ran at 22.7 fps against 60 fps for a recycled DOM list. A small waveform canvas beat SVG.
The environment has no GPU, which penalises canvas rasterisation more than a phone GPU would.

### F25 — Hosting/build constraints — `CONFIRMED_STATIC` (repo)
`scripts/build-jarvis.mjs` copies `frontend/` verbatim to `dist/` (no compile step). Every HTML file
needs a CSP `<meta>`. Media payload extensions are rejected. The total is capped at 25 MiB; the
current `frontend/` is 20.53 MiB, leaving **≈4.47 MiB** shared headroom. `frontend/claude-player/`
does not exist (no collision). Root `npm test` only discovers `tests/*.test.mjs` at the top level.

## Open questions, prioritised by fidelity impact

1. F15 gesture thresholds, fling velocity mapping into `v` (F05), track-swipe paging physics.
2. Which `T` (F07) applies to which scene pair, and tap vs drag ownership of each transition.
3. Default skin on first run, and the first-run screen.
4. List item scenes, zoom levels and list transitions (F18).
5. Waveform analysis algorithm and bar counts per bucket (F13).
6. Runtime corroboration of everything above. This needs an owner-run device capture protocol
   (see the architecture plan, “Fidelity verification”).
