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

Decompilation scope: JADX 1.5.1 decompiled the whole APK into scratch space (never committed), with
fallback (bytecode) mode for methods JADX could not restructure. The gesture and transition audit
(F15, F48–F50) read every touch handler, scroller, pager and list transition class listed below.
No native library is inspected.

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

### F15 — Gesture thresholds and fling physics — `CONFIRMED_STATIC` (bytecode-checked)
(a) S1 classes: the shared touch handler (`j0` and its subclasses `a0`, `m22`, `wm`), the list scroller
(`hc`, `sa0`, `eh0`, `dh0`), the album-art pager handler (`w`, `pv0`), the transition drivers (`km0`
and its subclasses `C0047`, `B`, `C0048`, `A`, `l22`), the transition runner (`x32`, `w32`, `h5`),
`PowerListTransitionBase`, the layouters' transition hooks (`P.j`, `h0.j`) and `hl0` (list substyle
times). JADX could not restructure `PowerListTransitionBase.A` and `w.mo1885`; their fallback output
was read instead.
(c)
- **Slop:** the platform's scaled touch slop (8 dp). A drag starts once either axis reaches it, and
  the start point then moves by the slop along each axis that crossed it, so the content does not jump.
- **Velocity:** the platform `VelocityTracker`, clamped to the scaled maximum fling velocity (8000 dp/s).
  A list fling needs at least the scaled minimum (50 dp/s).
- **List fling:** `v(t) = v0 · (1 − B(t/T))`, B = cubic bezier (0.103, 0.389, 0.307, 0.966),
  T = max(0.75 s, |v0| / 9000 px/s). A touch during a fling faster than 13.75 dp/s stops it without
  a click.
- **Album-art pager (`w` over the art layouter `P`):**
  - Horizontal drags move the pages. Past the first or last item each move is damped by
    1 − overscroll / art size.
  - Release goes to the neighbour when `|offset + v·1e-4| ≥ 0.2` (v in px/s), on the side given by the
    offset's sign. Otherwise it springs back.
  - The settle uses a cubic ease-out. Its speed is distance / `aaPosSettleAnimTime` (650 ms) plus
    |v|·0.2 when the fling points at the target, so a fling shortens it.
  - Programmatic moves use `aaPosAnimTime` (550 ms) on a bezier (0.5, 0.1, 0.15, 0.99).
  - An overscroll past 0.6 of a page changes category (`cmd_player_play_next/prev_category`).
- **Vertical drags on the art** are accepted only while the pages rest (|offset| < 0.05). They drive
  the list transitions of F48.
- **Navbar mini player:** the same pager handler without the overscroll damping (`pv0`), over a pager
  layouter (`ov0`) with previous/next-category decor items at the ends.
(d) The earlier "provisional platform defaults" are replaced by these values.
(e) High for the constants and rules. The platform `VelocityTracker` strategy (LSQ2) is reproduced
in form, not bit-exactly.
(f) `src/gesture.js` (velocity, fling, curves, elastic), `ListWidget` and `MiniPlayerList` pagers,
`PowerList` and the lyrics page scrolling.

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

### F26 — Album-art geometry (`P`) — `CONFIRMED_STATIC` (bytecode-checked)
Art size = smaller available side × `aaItemRatio`, capped by `aaMaxSize` minus paddings and by both
available sides, floored at `aaMinSize`. The available area subtracts list paddings, `aaPadding*` and
`aaMargin*` (margins may name runtime sizes such as `navbar_bounds_size`). The anchor follows
`aaGravity`; the wide alternative layout applies when available height ≤ `maxAvailSizeForAltAaLayout`
and width/height ≥ `altAaLayoutRatio`. A page at offset f shifts by `(int)(scale·dense·f·m + 0.5)`,
scales by `1 − ((1 − maxScale)/2)·|f|` (min 0.001) and tilts by f × (5° X abs, −10° Y, 5.5° Z).
Alpha is 0 below 5 % visibility, else `(v − 0.05) × 1.0526`. The decompiler inverted three spots
here (bottom anchoring when `aaItemBoundsMatchList & 2`, the alpha branch and the item scene choice);
the bytecode gives `mode & 15`: 0 → `scene_aa`, 1 → `scene_aa_playing`, 2 → `scene_aa_vis`.
(f) `list/aa-geometry.js`, shared by `AABounds` and the list's art pager.

### F27 — Player states — `CONFIRMED_STATIC`
The main screen has two scenes: the default scene (paused) and `scene_playing`. Paused ↔ playing
uses `playStateAnimTime` (320 ms) without the animation-speed setting; library ↔ player uses
`animMainEnterTime`/`animMainExitTime`; between library, search and equalizer `animTime`. The first
animated change after start adds 0.35 s. The art item switches between `scene_aa` (scale 0.975) and
`scene_aa_playing` (scale 1.0).
(f) `widgets/topnav.js`, `list/list-widget.js`.

### F28 — Waveform seek bar — `CONFIRMED_STATIC`
Scrolling layout: the cursor sits at `cursorPosition` (50 %) and the waveform moves under it, so at
0:00 the bars start at the centre. Bar width is the bar bitmap width (`barWidth=auto`, 8 dp), spacing
1.25 dp, 100 bars, minimum height 10 dp, bars centred vertically. Bars left of the cursor use the
elapsed bitmap (grey 0x7e at 25 % alpha); upcoming bars are white at 66 % with a 45 % grey outline.
Partly clipped edge bars fade by their visible fraction. Without wave data a track with a duration
shows `|sin|` bands (3 periods, amplitude 0.33). Data changes cross-fade over 400 ms (150 ms to no
data). The bitmaps are replaced by procedurally drawn pills from extracted fill/edge colours.
(f) `widgets/waveseek.js`. The real wave (native scanner) is approximated from decoded audio later.

### F29 — Sub-art buttons row — `CONFIRMED_STATIC`
Without the feature pack the row is "fit centred", one line, normal size: slot width
`clamp((W − 4·gap)/5, min(36 dp, 68 dp), 68 dp)`; slots 0–1 from the left edge, slot 2 centred,
slots 3–4 from the right edge (slot 3 outermost), further slots past the right edge. Defaults:
visualisation, sleep timer, empty (counter when enabled), shuffle, repeat.
(f) `widgets/subaa.js`. Popup mode menus are not yet built; a tap posts `cmd_subaa_button`.

### F30 — Background (`MilkWidget`) — `UNSUPPORTED_WEB` (native GL), approximated
Visualisation and the blurred art backdrop are rendered natively. Defaults: blur level 5, downscale
2^5, saturation 150 %, intensity 100 %, bottom gradient level 4 to #FF000000.
(f) `widgets/milk.js`: CSS blur/saturate over the art plus a gradient. The radius and gradient curve
are guesses to tune against reference screenshots.

### F31 — Elapsed/duration labels — `OPEN`
Both labels attach to the parent on both sides with `wrap_content` in the "More buttons" layout.
The solver (bytecode) measures a view attached on both sides EXACTLY to the span, which yields two
full-width pills, the duration covering the elapsed label. That is very likely not the real look, so
some solver rule is still misread. Placement must be confirmed from a reference screenshot.

### F32 — Resizable round-knob stacks — `OPEN`
The Volume/Reverb tab knob layouts ("Resizable" styles) attach the value label to both parent
edges with `wrap_content` and `consumeSpace=vertical`, the label above it (`attachBottom=_value_label`)
and the knob above the label. Traced literally (bytecode `p1`/`d1`: both-edge attach measures
EXACTLY to the span; a view's top attach resolves before its bottom dependency is laid out; a view
attached on both edges consumes from the top), the value label fills the layout, the label gets zero
height and the knob lands above the layout. That cannot be the shipping look, so — as in F31 — some
rule for `wrap_content` attached on both edges is still misread. The implementation lays these
stacks out by intent (value at the bottom, label above, knob filling the rest, square, centred) and
flags it. A screenshot of the Volume tab settles both F31 and F32.

### F33 — Equalizer — `CS` (structure) / `INF` (DSP)
EQ tab: `EqKnobsList` (a PowerList) holds the preamp item (`preamp_knob_width`) then one
`LinearKnob` per band at `x = z + (i-1)·D`, `D` = the band knob measured UNSPECIFIED. LinearKnob
geometry (travel, thumb, hole, dashed guide ticks, value-blended fill) and RoundKnob geometry
(30°–330° from the bottom, arc ring outside the knob with round-cap trimming, rotating indicator)
come from their `onSizeChanged`/`onDraw`. The FRS in graphic mode draws one point per band, evenly
spaced, joined by cubics with horizontal tangents, over a centre backline, with tone humps and a
vertical five-stop gradient. The built-in presets, seeded from code as parameter strings
(`31=0.39;…;16K=0;preamp=1`, plus `bass`/`treble`), confirm the ten-band 31 Hz–16 kHz set and its
labels (`1K` …), normalised band gains (±1 = ±15 dB, the band knob range) and a linear preamp; the
extractor captures them. Tone shelf corners, the reverb impulse, limiter settings, tempo stepping
and the preamp knob scale remain inferred (native DSP). Tone knobs are boost-only (0–100%), matching the FRS humps.

### F34 — Popups — `CS` (mechanism) / `INF` (timing curve)
Popup button layouts (`BusActionPopupLayout`, preset list buttons) open in place: the menu
placeholder helper takes the button out of its parent (an `InvisibleView` keeps the slot when
`keepLayoutForPopup`), adds it to `menu_placeholder` (a private-scene layout with `shadeColor`) and
runs `scene_button_menu` over `popupEnterAnimTime` (350 ms); closing runs `scene_button_menu_closed`
over `popupExitAnimTime` (200 ms). Menu items come from `menuItemsLayout`; preset buttons show a
list (`popupListStyle`, rows `listItemSize`). The interpolation curve and overshoot handling
(`maxOvershoot`) are not yet traced; the scene engine's curve is used. Preset rows' titles are
bottom-attached with `center_vertical` gravity — same open family as F31/F32.

### F35 — Marquee labels — `CS`

`MarqueeFastTextView`: with `anim_long_labels` on, a single-line label whose ellipsize is `marquee` lays out at 3000 dp. When the line overflows the available width by more than 10 px, it is clipped to the text box and scrolled: the first wait is 1500 ms and later waits are 3000 ms. It scrolls left by the overflow at 42.5 dp/s, using accelerate-decelerate when the overflow exceeds 50 px and linear otherwise, then waits, scrolls back and repeats while shown. With the option off, marquee labels ellipsize at the end. `OptionAnimLongLabelsInLists` (list and mini-player labels) defaults on as in `ui_player.xml`.

### F36 — Sleep timer — `CS` (UI) / `INF` (expiry)

The sub-AA button is `sleep_timer_layout`, a popup over `merge_sleep_timer_popup_layout`. `SleepTimerBehavior` gives the knob a range of 180°–1620° (four turns, 60 min per turn, 0–240 min). Past one turn, `RoundKnob` draws a ring per turn, each one stroke plus arcOffset further out, and only the partial ring gets the cap trim.

- **Title:** "Sleep Timer: " followed by the abbreviated relative span, with periods removed and lowercased. Past 3660 s, the remaining minutes are appended. Without a timer the title reads "disabled".
- **Value:** "%d min", or "Disabled".
- **OK:** posts `cmd_player_set_sleep_timer` with arg1 = minutes × 60 and arg2 = play-to-end, and stores the minutes and `sleep_play_to_end`.
- **Disable:** posts 0.
- **Cancel:** closes the popup.
- **Refresh:** the labels update every 500 ms.
- **Button state:** the button is activated while the timer runs.

How the reference stops playback (fade or immediate) is not verified, so a plain pause is used. The frame is ?TopSleepTimerButtonLayout_scene_item_menu (centred, up to 340 dp). The icon stays at the top left (?SleepTimerButton_scene_button_menu).

### F37 — Visualization modes — `CS`

The sub-AA vis button is a `BusSelectablePopupButtonLayout` over `vis_modes` / `vis_icons_32dp` / `vis_modes_enum` (VIS_NONE 0, VIS_W_UI 1, VIS_FULL_SCREEN 2). It posts `cmd_gui_set_vis_mode`. While playing, the top nav (`О(IZZ)`) picks `scene_vis_w_ui` for mode 1, `scene_vis` for mode 2, and `scene_playing` otherwise. In full screen a tap gives `scene_vis_temp_ui` for tempUITime + `vis_temp_ui_ms` (default 1500 ms). Mode 1 also posts `cmd_list_prefer_aa_state`, which is not reproduced.

### F38 — List scroller — `CS`

`ListScrollerView` attributes are `Q` styleable indices 0–22. The mode comes from the list (`sd.s()`):
- **Name-sorted lists** use mode 2 (the A–Z column) when `az_scroll` is on (the default), and mode 3 (a thumb) when it is off. If the list has no indexer, mode 2 also falls back to 3.
- **Other lists** use mode 1 (a thumb).
- **The album-art pager** uses mode 0 (hidden).

A–Z geometry (`e()`):
- avail = azSize × height (fraction), or height − azPaddingTop − azPaddingBottom.
- Cell f = avail / (chars + scroll-up item).
- Text size = azTextScale × f.
- Baseline offset = f − (f − (−ascent − descent)) / 2.

Drawing (`onDraw`): azBackground fills the column; the touched cell gets azTouchedBackground and the pressed text colour; separator lines are drawn in azSeparatorLineColor.

The thumb (`d()`): its top is (H − thumbH − padT − padB) × offset / (range − extent) + padT, and it shows whenever the list can scroll (`o()`). Fades take 250 ms. `anim_scrollbar_pressed` scales the scroller ×1.5 about its right edge and fades and scales the bubble in. The default chars are "0ABCDEFGHIJKLMNOPQRSTUVWXYZ#".

### F39 — Selection mode — `CS` (UI) / `INF` (actions)

The header Select button posts `list/cmd_list_toggle_selection_mode`. Items reveal `select_box` (ItemTrackSelectBox: platform check box on rounded_large, over the art) and show the selection as checked.

The list posts `cmd_selection_menu_open`:
- arg1 is the actions layout from `sd.t()`: tracks use `merge_selection_menu_list_tracks_items`, groups with art use `merge_selection_menu_list_items_w_aa`, and other lists use `merge_selection_menu_list_base_items`.
- data is the ids to hide.

`SelectionMenuBehavior` loads `merge_selection_menu_inner` once, inflates the actions into `selection_menu_items`, and moves `selection_menu_container` to `scene_selection_menu` (animTime 500 / exit 200).

The dynamic popup buttons (`dynamicButtons`) show the current insert mode's icon and label. A click posts clickMsgId; a long press opens the modes menu. Enqueue modes are "Add to end" (0) and "Shuffled" (2). The item box fade time is inferred.

### F40 — Lyrics — `CS` (structure) / `INF` (page geometry)

`main_lyrics_button`: 0 means never, 1 means when lyrics are available (default), 2 means always. `LyricsButton` hides through `isEmpty()` with `layout_goneWhenEmpty`, and `onDraw` returns early. A click opens `cmd_nav_to_lyrics`, and the top nav goes to `scene_lyrics`, whose main-UI records are based on defaultScene. The AA item has a `scene_lyrics`:
- art matched to the item height at the left (8 dp margins)
- title and line 2 beside the art, with marquee
- the menu and lyrics buttons

Lines use `item_lyrics`:
- **Inactive:** `?colorIconDisabled`, centred, 13 sp vertical margins.
- **Active:** `scene_active` (×1.1, textColorPrimary). `ap0.h0()` maps zoomed to `scene_zoomed_active` and small to `scene_small_active`.
- **Unsynced:** `scene_unsync` (left aligned, ×0.85, `?colorLessContrast`).

The layouter extends the last item so that late lines can reach the follow position (`ap0.i0`). With no lyrics, the page uses `item_empty_lyrics_with_config`; the web build shows `scene_empty_no_button` because it has no lyrics app.

The following are inferred:
- the page fills the AA item frame, with the header pinned and lines clipped under it
- the follow position (one third down)
- the follow pause after a user scroll (4 s)
- tap to seek

### F41 — Visualization panel — `CS` (structure) / `INF` (pager–list morph)

`merge_vis_panel` holds `VisPanelFrame` (48 dp, `itemSize` 48 dp, `animTime` 500) inside a private-scene container. Collapsed, its `PowerList` pages the presets horizontally (`ov0`: one item per width), and settling on a page loads that preset. A tap expands the frame to `scene_vispanel_expanded` (352 dp):
- a vertical list of `item_vis` rows in `scene_vis_item_list` (like/unlike tristate, activated check)
- a filter field, a sort popup (type, name, author, source, rating) and the settings button
- the shim behind it, which collapses the panel

Close clears the filter, then collapses, then leaves vis mode (`cmd_gui_set_vis_mode` 0). Pausing and changing nav also collapse the panel. The advance button (`state_player_milk_advance`) is a non-dynamic `BusSelectablePopupButtonLayout`:
- `milk_advance_enum` is `@null`, so the modes are the indices: lock, change with track, change by time, shuffle by time
- the closed button shows only the selected row (`fp1.O1`)
- a press advances to the next mode and toasts the label with `toastOnPress` ("Long press for more options")
- a long press opens the menu

The `PowerListSharedItemTransition` morph between pager and list is approximated by a cross-fade.

### F42 — Ratings and play statistics — `CS`

`LikeUnlikeLayout` keeps its two checks exclusive and sends `cmd_data_track_rating` with 5 (like), 1 (unlike) or 0. `RatingBar` (`rating_type` 2/3) shows `numStars` stars: `drawable` for set stars, `drawableOff` for the rest, over `lineBackground`. A track counts as played at `played_dur` percent (default 50). The lists are Most Played, Recently Played, Top Rated (≥ 4) and Low Rated (1–2).

### F43 — Dialogs — `CS`

Each dialog is an activity themed `dialog_<Activity>`, based on `BottomsheetDialog` (animTime 350, frame enters from `layout_attachTop 100%`) or `CenteredDialog` (450, `dialogAltOutScene`). All of them inflate the shared `dialog` layout:
- the shim
- the frame with the title layout and the theme's `dialogTitleExtraLayout`
- `dialogContentLayout` (a flex child with weight 1)
- `merge_dialog_buttons`

Scenes: `scene_dialog_in`, `scene_dialog_in_toast` (`DialogBehavior` message, then close) and the out scenes. Dialogs keep their own `menu_placeholder` and toast.

### F44 — Playlists and Add to Playlist — `CS`

`PlaylistSelectAndAddToListLayout` (`listItemSize` 50 dp, rows `item_playlist_select_plus_checkbox`) has title buttons:
- Add New Playlist (new playlists are named `playlist_root_word` N)
- sort: name 0, date added 0x40000001, date modified 0x40000003, number of tracks 0x40000002
- insert position: top 1, bottom 0, shuffled 2
- select type

The select types work as follows:
- **One playlist:** a tap adds, then the frame shows Added with an Open button and closes after 2 s.
- **Several:** check playlists, then use Add/Close.
- **Toggle:** a tap adds or removes.

`pl_no_dups` defaults to false. In a playlist, Delete removes entries; the Playlists category offers Rename and Delete. Header menus are `merge_menu_items_lib`, `_tracks` and `_playlists`, opened from `item_text`'s menu with `merge_item_text_popup_menu`, the same morph as the cover's item menu.

### F45 — Info/Tags and Album Art — `CS`

`dialog_content_info` shows:
- the file
- the format line, then ReplayGain
- statistics (Played Times and Last Played, with a Reset icon)
- the tags in a `TableLayout`, plus artist/album/genre/folder jumps
- the cover source (`embed_album_art`, `in_folder_image`, `no_album_art`)

The content scrolls (`ScrollingBehavior`). `SelectAlbumArtActivity` offers `pick_image` (Pick From Gallery) as its only button. A `use_for` check ("Also use for: %s") applies the picked image to the whole album. The online image grid is not available here.

### F46 — List Options — `CS`

`ListOptsActivity` builds its sort radios from per-list `(label, value, hint)` tables, and Reverse is bit 30:
- **Tracks** (`uf1`): track 0, disc+track 13, title 1, filename 2, path 14, artist 8, album 9, year 3, year+album 15, added 12, modified 4, rating 5, duration 10, played at 7, play count 6, shuffle 11.
- **Albums** (`te1`), **album artists** (`ne1`), **names** (`cf1`/`hf1`/`eg1`), **folders** (`zf1`), **playlists** (`ri1`) and **years** (`vj1`) have their own tables.

"View as" levels come from `wh1.A()`: categories −4…5 (`ie`), track lists −3…2 (`jj1`) and home (`mg1`). The geometry comes from `pd.P0` and `bk0.P0`. Track lists remap their levels onto category levels −3, −2, −1, 0, 3 and 4, as the search list does (`vo1`). Item sizes come from the list substyle:
- small / small no-AA / 1-line no-AA / extra small
- itemSize / itemSizeZoomed
- grid cells: square art plus `grid*ExtraSpace`

Show Titles Only selects the `scene_1*` variants. Not reproduced: Max Items, Min Duration, list memory and the compact header.

### F47 — Waveform data — `CS` (storage) / `OPEN` (analysis)

`TagReader` reads `track_wave` as a float blob and resamples it to 100 values with `c22.A`, nearest-neighbour on a rounded index. The native analysis behind those floats is not visible in Java and is not reverse-engineered here (native code). The R2 index now carries 500 peak bytes per track, normalised to 255. Peak envelopes of heavily limited masters are nearly flat, which matches the data rather than a rendering fault.

### F48 — List page transitions — `CONFIRMED_STATIC` (bytecode-checked) / visual `INFERRED` in part

(a) S1 `PowerListTransitionBase`, `PowerListSharedItemTransition` (+ move up/down/forward/reverse),
`PowerListGenericPivotTransitionBase`, `PowerListGenericFadeTransition`, `x32`, `w32`, `h5`, `C0047`,
`C0048`, `ListWidget.b1/s0`, `p31`, `i22` (top navigation), `P.j`, `h0.j`, `u31.A`.

(c) The main list is one `PowerList` whose pages (art page, lyrics page, category lists) change by
transitions with a progress from 0 to 1.

**Gestures that drive a transition:**
- On the art: drag ↓ → `PowerListSharedMoveDownItemTransition` to the playing track's source list
  (`C0069.f(MIN_VALUE)`), positioned at the track. Drag ↑ → `PowerListSharedMoveUpItemTransition` to
  the lyrics page when `main_lyrics_swipe` allows it (0 never, 1 with lyrics, 2 always; default 2,
  from code). Progress = drag / art size.
- On the lyrics page: a side swipe goes back to the art (forward or reverse move-down variants;
  progress = swipe / list width), and so does a pull down at the top (move down).
- In library lists: a side swipe goes to the parent level (header-to-item swipe transitions).

**Release (`PowerListTransitionBase.A`):**
- A fling of at least 500 dp/s commits when it points forward and cancels otherwise. A slower
  release commits past 0.3.
- The settle runs at the release rate (progress/s, clamped to [1/T, 8] forward, [−8, −3.5] back)
  unless progress is beyond 0.8 (commit) or below 0.2 (cancel).
- Otherwise it is accelerate-decelerate over the remaining fraction of T: `pageManualCommitAnimTime`
  (250 ms, at least 100 ms) or `pageManualCancelAnimTime` (500 ms, at least T/3).
- Programmatic transitions use the pair's time: `pageAnimTime` 250, `aaToTopLibAnimTime` 250,
  `topLibToAAAnimTime` 250, `aaToLyricsAnimTime` 250, `lyricsToAAAnimTime` 150,
  `libSearchAnimTime` 150, `aaToSearchAnimTime` 150, `searchToAAAnimTime` 250 ms.

**Rendering per layouter (f = the page's distance from shown):**
- List layouters (`h0`; the lyrics page too) scale about a pivot by `(R − 1)·f + 1` and fade by 1 − f,
  with R 0.5 for an entering page and 1.5 for a leaving one.
- The art layouter (`P`) scales each item by the same law with R 0.75 or 1.25 and ignores the pivot.
- Move transitions pivot the leaving page at its top centre, shifted by ± the list width for the
  side-swipe variants. Back pivots swap the factors. Fade transitions only fade.
- While a drag drives a transition, the top navigation scene follows the same ratio
  (`state_list_transition_ratio`) and ends with it.

**Without a target**, the art follows the finger elastically, `√(0.3·|d|)·0.3` of the art size
(d = drag / art size), and returns over max(0.35 s, |shift| / 2) with a cubic ease-out. A library
list at its top level follows a side swipe at a quarter.

(d) A cover tap opens the same source list (in-app help `h_main_aa`).
(e) The constants and the scale/alpha laws are read from bytecode.

The following are `INFERRED`:
- Which pair time each programmatic navigation uses: the `p31` selection is partly garbled.
- The side of the pivot for the forward/reverse lyrics swipes, taken literally.
- The shared item's view hand-off between pages: not reproduced.
- The header-to-item morph of library swipes: substituted by the generic back pivot zoom.

(f) `src/list/list-transition.js`, `ListWidget.startTransition`, `levelTransition`,
`SceneController.release`, `TopNavSceneFastLayout.adoptNav`.

### F49 — Line 2 and menu-button actions — `CONFIRMED_STATIC`

`C0069.y/A0/B0`:
- **Line 2:** a tap runs `line2_click` (default 0, disabled) and a long press runs `line2_long_click`
  (default 1). The values are 1 artist, 2 album, 3 folder, 4 genre. A tap with no action is consumed.
- **Menu button long press (`menu_button_long_press`, default 0):** 1 delete, 2 add to playlist,
  3 info, 4 album art, 5–8 artist/album/folder/genre, 9 share, 10 like, 11 unlike.
- **Lyrics button long press:** opens the lyrics dialog, which is not built.

### F50 — Gestures with no reproduction yet — `CONFIRMED_STATIC`

Read but not built:
- the overscroll category change of the art pager
- pinch-to-zoom (`A`: zoom-in/out transitions, scale law `√(clamp/3·0.2)·0.2`)
- the drag-reorder handler (`DragHandler`, `DraggableSourceBehavior`)
- the navbar extension's sheet drag
- the predictive back gesture (`zb` / `ListWidget.V/g0/T`), which has no browser counterpart

### I1 — Layout inferences to verify against screenshots

- A child attached to the parent's bottom only, with `layout_gravity` `center_vertical`, is centred in the area. Examples: `ItemPopupListTitle`, `DialogToastLineOnly1`, `ItemTrackMenu_scene_lyrics`.
- Flex children take spare space only at an exact parent size. Content beyond a wrap_content maximum shrinks the weighted child.
- The vis panel filter field (`fill_parent` + `layout_attachRight @id/sort`) overflows left by the sort button's width under the solver port; its true placement is unverified.

## Build status of the findings

Statuses:
- **Built** means implemented and exercised in headless Chromium. Gesture rows were exercised this
  session with CDP touch events.
- **Partial** means part of the finding is implemented.
- **Not built** means nothing is implemented yet.
- **N/A** means the finding is a constraint or a source note rather than a feature.

No status is device-verified.

| Finding | Status | What is missing |
| --- | --- | --- |
| F01 shell | Built | — |
| F02 scene graph | Built | — |
| F03 scene inventory | Built | Item scenes beyond the lists in use |
| F04 SceneParams | Built | — |
| F05 scene clock | Built | The call-site mapping of velocity into scene changes |
| F06 state anims | Built | — |
| F07 timing table | Built | Elapsed times on a device |
| F08 animation speed | Built | — |
| F09 FastLayout | Built | I1 inferences |
| F10 theme composition | Built | — |
| F11 skin options | Partial | Options apply through generic overlay composition and are not checked one by one. Follow Day/Night (`darkMode`/`lightMode` pairing) is **not built**. Material You has no seed-colour substitute. |
| F12 window buckets | Built | — |
| F13 waveseek | Built | Native analysis `OPEN` |
| F14 gesture inventory | Partial | Art ←/→, ↓ (source list), ↑ (lyrics) and tap are built, as are the navbar tap, ←/→ and long press, the library parent swipe and the line 2 tap and long press. **Not built:** art "swipe more" (category), pinch-to-zoom, multi-select drag, meta-info tap cycling, long press between buttons (edit), search-chip toggle and long press (a tap selects one chip), the lyrics button long press, rating swipes, the visualization ←/→ preset swipe on the vis itself (the vis panel pager is built). |
| F15 thresholds and physics | Built | VelocityTracker reproduced in form only |
| F16 navbar | Built | — |
| F17 settings corpus | Built (screens) | Per-key implementation statuses not recorded |
| F18 list transitions | Partial | The F48 zoom transitions are built. The header-to-item and item-to-header morphs, the shared item view hand-off and the zoom transitions (pinch) are **not built**. |
| F19 typography | Built | — |
| F20 audio | Built (web subset) | Native engine `UW` |
| F21 visualization | Built (butterchurn) | — |
| F22 AutoEQ | Not built | `UW` within the budget |
| F23 art background | Built | Blur kernel approximated |
| F24 renderer bench | N/A | — |
| F25 hosting | N/A | — |
| F26 art geometry | Built | Tilt signs `OPEN` |
| F27 player states | Built | — |
| F28 waveseek drawing | Built | — |
| F29 sub-art buttons | Partial | Editing **not built** |
| F30 backdrop | Built (approximation) | — |
| F31 elapsed/duration | Partial | Placement `OPEN` |
| F32 knob stacks | Partial | Laid out by intent |
| F33 equalizer | Partial | Preset save/rename/share/import/export, platform FX and AutoEQ not built |
| F34 popups | Built | Curve inferred |
| F35 marquee | Built | — |
| F36 sleep timer | Built | Expiry fade not verified |
| F37 vis modes | Built | — |
| F38 list scroller | Built | — |
| F39 selection | Partial | Multi-select drag **not built**. Delete files skipped (owner decision). |
| F40 lyrics | Built | Page geometry inferred. Lyrics dialog **not built**. |
| F41 vis panel | Built | Pager–list morph cross-fades |
| F42 ratings/stats | Built | Rating swipes **not built** |
| F43 dialogs | Partial | Drag-to-dismiss **not built** |
| F44 playlists | Partial | Re-sort, import and drag reordering **not built** |
| F45 info / album art | Built | Tag editing skipped (owner decision) |
| F46 list options | Partial | Max Items, Min Duration, list memory and the compact header not built |
| F47 waveform data | Built | — |
| F48 list page transitions | Partial | See F48 (e) |
| F49 line 2 / menu actions | Built | Delete is a no-op (owner decision). The lyrics dialog is not built. |
| F50 unbuilt gestures | Not built | — |

## Open questions, prioritised by fidelity impact

1. Runtime corroboration of F15/F48 (curves, the pivot side of the lyrics swipes) against recordings.
2. Which programmatic pair time (F48) each navigation uses, and whether search transitions zoom or fade.
3. Default skin on first run, and the first-run screen.
4. List transitions (F18); zoom levels and item scenes are now known (F46).
5. Waveform analysis algorithm (F13, F47): native, so it is not inspected; the data now comes from the R2 index.
6. Elapsed/duration label placement in the "More buttons" layout (F31).
7. F32 resizable knob stacks (Volume/Reverb tabs), and the real band set of the native DSP.
8. Sign conventions of the art pager's 3D tilt (rotationX/Y) and the backdrop blur look (F26, F30).
9. Layout inferences I1, and the Add to Playlist sheet height (it fills to the larger bottom-sheet maximum because the content is `fill_parent`).
10. Runtime corroboration of everything above. This needs an owner-run device capture protocol
   (see the architecture plan, “Fidelity verification”).
