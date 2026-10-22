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
(F15, F48–F61) read every touch handler, scroller, pager and list transition class listed below.
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

**Sweep** (headless Chromium, 412×915): every non-default value of every option, both skins, 45
variants, each with the player and EQ screens.
- No page errors and no non-finite or runaway view frames.
- Every option changes the screen it targets: player-screen options the player, `knob_hilite` and
  `graphic_frs_color` the EQ.
- No visible effect, by design: `android_navbar_bg`, `statusbar_bg` and `force_light_navbar`, which
  style Android's system bars.
- Whether each change matches the reference's look still needs reference screenshots, as for F31.

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
The user's own AutoEq project zip and AutoEq text files import as presets (F82).

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
With the feature pack the row is editable (F62): up to 32 slots, the centred or compact layout,
small buttons and two lines, stored per orientation.
(f) `widgets/subaa.js` (the row, its button kinds and their popup menus), `widgets/subaa-edit.js`
(F62).

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
extractor captures them. The reverb impulse, limiter settings and tempo stepping remain inferred (native DSP);
the tone shelf corners and Q and the ±24 dB preamp are confirmed (F68). Tone knobs are boost-only (0–100%), matching the FRS humps.

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

### F36 — Sleep timer — `CS`

The sub-AA button is `sleep_timer_layout`, a popup over `merge_sleep_timer_popup_layout`. `SleepTimerBehavior` gives the knob a range of 180°–1620° (four turns, 60 min per turn, 0–240 min). Past one turn, `RoundKnob` draws a ring per turn, each one stroke plus arcOffset further out, and only the partial ring gets the cap trim.

- **Title:** "Sleep Timer: " followed by the abbreviated relative span, with periods removed and lowercased. Past 3660 s, the remaining minutes are appended. Without a timer the title reads "disabled".
- **Value:** "%d min", or "Disabled".
- **OK:** posts `cmd_player_set_sleep_timer` with arg1 = minutes × 60 and arg2 = play-to-end, and stores the minutes and `sleep_play_to_end`.
- **Disable:** posts 0.
- **Cancel:** closes the popup.
- **Refresh:** the labels update every 500 ms.
- **Button state:** the button is activated while the timer runs.

**Expiry** (`an.B`, `k21` message 21, `an.m1066`, `PlayerServiceCore.o`):
- Set while playing, the timer counts in real time; pausing does not stop it. Set while not
  playing, it waits and starts its full time when playback starts.
- At its end, if nothing plays it just clears. If playing, it pauses through the normal pause
  (with its fade, F70), or with play-to-end stops when the track ends; then it clears and shows
  the "Sleep Timer" / "Paused" toast.

The frame is ?TopSleepTimerButtonLayout_scene_item_menu (centred, up to 340 dp). The icon stays at the top left (?SleepTimerButton_scene_button_menu).

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

### F41 — Visualization panel — `CS`

`merge_vis_panel` holds `VisPanelFrame` (48 dp, `itemSize` 48 dp, `animTime` 500) inside a private-scene container. Collapsed, its `PowerList` pages the presets horizontally (`ov0`: one item per width), and settling on a page loads that preset. A tap expands the frame to `scene_vispanel_expanded` (352 dp):
- a vertical list of `item_vis` rows in `scene_vis_item_list` (like/unlike tristate, activated check)
- a filter field, a sort popup (type, name, author, source, rating) and the settings button
- the shim behind it, which collapses the panel

Close clears the filter, then collapses, then leaves vis mode (`cmd_gui_set_vis_mode` 0). Pausing and changing nav also collapse the panel. The advance button (`state_player_milk_advance`) is a non-dynamic `BusSelectablePopupButtonLayout`:
- `milk_advance_enum` is `@null`, so the modes are the indices: lock, change with track, change by time, shuffle by time
- the closed button shows only the selected row (`fp1.O1`)
- a press advances to the next mode and toasts the label with `toastOnPress` ("Long press for more options")
- a long press opens the menu

**Pager ↔ list** (`VisPanelFrame.H0` / `N`, `PowerListSharedItemTransition.mo621` / `mo623`, `P.j`,
`h0.j`): one PowerList changes from the pager layout (`ov0`, a `P`) to the list (`w62`,
scene_vis_item_list) on the expand scene's progress.
- The list takes the shared-item mapping (`h0` mode 4): it is scaled about a pivot by
  `1 + (r − 1)·f`, with r = pager item / row height, and faded by `1 − f`.
- The pager fades (`P` mode 2: alpha `1 − f`).
- With `itemSize` equal to `listItemSize` (both `VisPanelFrame_height`), r is 1. The morph is then
  exactly a cross-fade of pager and list on the scene's progress, which is how it is built.
- The library's art pager ↔ list hand-off is F48.

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

Show Titles Only selects the `scene_1*` variants. Max Items, Min Duration and Compact Header are F63.

**List Memory** (`ListOptsActivity` over a `jh1` list: folders `zf1` / `cg1` and playlists `ri1`;
`zf1.h0` / `ri1.h0` → `oh1`; `pi1.moveFilesCursorToListMemorizedPosition`, `shouldRestorePerTrackPos`;
`c30` / `d61` / `h60` / `k60` columns; `xc.j` / `xc.m` with `wa1.M`):
- A folder's or playlist's songs list shows the List Memory group: List Position (`keep_list_pos`)
  and Per Track Progress (`keep_track_pos`), each stored when the user ticks it
  (`cmd_data_set_list_meta`), with the reference hint and its second paragraph (`html_2`).
- **List Position:** a list started without a picked track starts at its memorized entry: header
  Play or Shuffle, a category list's Play (its first entry), previous / next category. The entry is
  the folder's file with the latest `played_at`, or the playlist entry last played from that playlist
  (`playlist_entries.played_at`).
- **Per Track Progress:** the list's tracks start where they were left, whatever `restore_pos` says.
- **Meta icons:** folder rows (Folders, Folders Hierarchy) and song list headers of folders and
  playlists show `(keep_track_pos << 1) + keep_list_pos` as the meta icon (`meta_songs_12dp`,
  `keep_list_pos_12dp`, `keep_track_pos_12dp`, `keep_list_track_pos_12dp`); playlist rows show
  List Position only (`d61`: column 5).
- **Inferred:** a folder's `played_at` is our last completed play; flags are kept in the library
  store (the reference's settings export of them is not built).

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
- **Shared item hand-off** (`PowerListSharedItemTransition.mo621`, art pager ↔ list), now built:
  the playing track's art item and its list row are one view during the change.
  - The row stays hidden.
  - The art item moves from its pager frame into the row's frame, as the list page's zoom shows it.
  - Its item scene morphs into the row's scene by the same fraction; the children's frames are laid
    out at the row's size.
  - At the end the row shows again and the art item returns to its own scene.
  - It applies only when the row is on screen.
  - The art scene's own background switches at the end; the item root is not a scene child.
- The header-to-item morph of library swipes: substituted by the generic back pivot zoom.

(f) `src/list/list-transition.js`, `ListWidget.startTransition`, `levelTransition`,
`SceneController.release`, `TopNavSceneFastLayout.adoptNav`.

### F49 — Line 2 and menu-button actions — `CONFIRMED_STATIC`

`C0069.y/A0/B0`:
- **Line 2:** a tap runs `line2_click` (default 0, disabled) and a long press runs `line2_long_click`
  (default 1). The values are 1 artist, 2 album, 3 folder, 4 genre. A tap with no action is consumed.
- **Menu button long press (`menu_button_long_press`, default 0):** 1 delete, 2 add to playlist,
  3 info, 4 album art, 5–8 artist/album/folder/genre, 9 share, 10 like, 11 unlike.
- **Lyrics button long press:** opens the lyrics dialog (F61).

### F50 — Gestures with no reproduction yet — `CONFIRMED_STATIC`

Read but not built:
- the predictive back gesture (`zb` / `ListWidget.V/g0/T`), which has no browser counterpart

The art pager's overscroll category change, pinch-to-zoom, drag reordering, the navbar sheet drag
and sub-art button editing (feature-pack tier, owner approved; F62) were listed here and are now
built (F52, F53, F59, F60, F62).

### F51 — Meta info line — `CONFIRMED_STATIC`

(a) S1 `k51`, `merge_meta_info_layout`. (c) A tap sends `cmd_player_switch_track_meta` and cycles
the mode, which persists. The default mode 0 is decode info. The cycle runs decode → output →
category → folder → next → decode.
- **Category:** "name - position / count".
- **Folder:** the parent folder's name, with the `micro_folders` icon.
- **Next:** "title - artist - album" of the next track, with `meta_next_12dp`. At a list end it
  shows `next_cat_s` (the next category's name), `next_list`, or `end_reached`.
- **Button:** `openOnClick` false, so a long press opens the audio info popup. `firstPressToast`
  shows a hint on the first press.

`INFERRED`/substitutes:
- The output line names "Web Audio" and the context's sample rate, because the browser reports no
  output device.
- The first-press toast shows once per session; its persistence is not read.

(f) `src/widgets/meta-info.js`, `PopupLayout.firstPressToast`.

### F52 — Category navigation and the art pager's "swipe more" — `CONFIRMED_STATIC`

(a) S1 `pi1` (category navigation), `w`/`P` (`X0`, `t0`), `ov0`/`pv0` (navbar decor pages),
`item_aa_le_decor`, `item_miniplayer_prev_next_decor`. (c) A queue started from a library list
carries its category: the list's groups, with the track's group as the position.
- **When it applies:** category navigation needs shuffle mode other than 1 (all).
- **`next()`:** at the queue's end, with repeat ADVANCE (or mode 5) or a user "next", it runs
  `nextCategory(wrap = repeat ≠ 5)`.
- **`prev()`:** at the queue's start it runs `prevCategory(true)`, which starts at the category's
  last track. `prevCategory` always wraps.
- **Art pager:** past the last or first track the neighbouring page is a decor page showing the
  next or previous category's name (`no_next_list` / `no_previous_list` without one). Its alpha is
  1 − |offset|: 0 below 0.35, ramping to 1 at 0.6.
- **Overscroll:** beyond 0.6 of a page, with category navigation available, the release changes
  category: next wraps, previous starts at the first track.
- **Navbar:** the mini player's pager (`pv0`, undamped, over `ov0`) follows the same rule.

(f) `Player.nextCategory/prevCategory/categoryNavigable`, `ListWidget.bindDecor/settlePage`,
`MiniPlayerList`, `categoryFor`.

### F53 — Pinch-to-zoom in library lists — `CONFIRMED_STATIC`

(a) S1 `A`, `pd.k`/`pd.r` ("View as" zoom tables). (c) A second finger starts a pinch. Once the
spread changes by touch slop, the direction picks the zoom: spreading zooms in to the next "View
as" level, pinching zooms out to the previous one.
- **Progress:** (d / d0 − 1)·1.25, mirrored for zooming out. The shown level leaves and the new
  one enters with the F48 list zoom law (R 0.5 / 1.5).
- **Release:** at least 500 dp/s commits when the spread moves with the zoom direction and cancels
  against it, at a quarter of the spread rate. A slower release commits past 0.3. The rate is
  zeroed beyond 0.8 (commit) or below 0.2 (cancel). Both settle times are
  `pageManualCancelAnimTime` (500 ms).
- **No further level:** the list scales elastically, by `√(min(f, 3)/3·0.2)·0.2` pinching in and
  the mirrored law spreading out, and springs back on release.
- **Item kept in view:** the middle visible item leads the new level.

(f) `ListWidget.onPinchStart/Move/End`, `startZoomTransition`, `input.js` (second pointer).

### F54 — Header-to-item and item-to-header morphs — `CONFIRMED_STATIC` / `INFERRED` in part

(a) S1 the shared header transitions in mode 2, `u31.m3287`. (c) Opening a level from a tapped
item, and going back to it, morphs between the item and the level:
- **The child level** maps into the item's rect (x, y, 2x + w, 2y + h) at page scale j. j is
  rect height / H, unless the list is wider than tall and the rect narrower than the list, in
  which case it is rect width / W. Translation is (R.left·f, (R.top − P·j)·f), with P the content
  top. It fades by 1 − f.
- **The parent** magnifies by f2 = max(2, W / (x + w)) about its top-left, translated by
  −y·f2·f, and fades.
- **Direction:** forward, the parent leaves magnifying and the child grows out of the item. Back
  reverses both, over `pageAnimTime`.
- **Without an item** (Back after a scroll that dropped the item, or a level not opened from an
  item), the F48 pivot zooms run.

**Header title.** There is no separate title morph. `u31.m3287` only sets the magnified layout
rect, and `PowerListSharedItemTransition` pairs views only between the art pager and a list (F18),
so level changes morph whole pages.

(f) `ListWidget.levelTransition/pageMorph`, `PowerList.itemRect/contentTop`.

### F55 — Search category chips — `CONFIRMED_STATIC`

(a) S1 `ListSearchCatsLayout` (`I0` → `w1`, `l` → `v1`). (c) The chips hold a category mask:
- A tap toggles its category.
- A long press keeps only its category.
- "All" sets every bit.

The layout becomes visible with `nav_search`. Results combine songs and the matching group kinds
under the mask.

Superseded by F64: the categories, per-kind subheaders and history are ported there.

(f) `src/widgets/search.js`, `searchSource(…, mask)`.

### F56 — Follow Day/Night — `CONFIRMED_STATIC`

(a) S1 `yp1` (the `follow_night_mode` preference), `c40.V` (the flag), `wv1` (SkinnableThemeManager
theme load), `SkinInfo` (`e`/`f` pair, `g` set by `darkMode`). (c) With the option on, the theme
load picks the pair skin:
- at night (`uiMode` night), a skin that declares `darkMode` loads as that pair;
- by day, a skin that declares `lightMode` loads as its pair.

The stored skin is not changed, so turning the option off returns to it. The browser's
`prefers-color-scheme` stands in for the system night mode, and a scheme change reloads (the
reference recreates the activity).

(f) `followNightMode` in `src/app.js`.

### F57 — Star rating bar — `CONFIRMED_STATIC` (fallback bytecode)

(a) S1 `RatingBar`, styleable `wa1.k0`, `ItemRatingBar*` styles, `anim_ratingbar_pressed`.

(c) **Layout and drawing.** There are five stars of `drawableWidth` (O) each. Gravity is
`android:gravity & 7`: 1 centred, 5 right, otherwise left.
- **At rest**, with `doClip`, only max(1, rating) star slots show, over a `lineBackground` sized to
  them.
- **A press** grows the slots to five; the release shrinks them back. The slot count animates over
  max(75, trunc(|to − from + 0.5|)·75) ms with accelerate-decelerate.
- **Draw order:** on stars for the rating, then off stars, stepping −O for right gravity.

**Touch.** The bar takes the stream: its list may not intercept.
- **Down:** pressed, `anim_ratingbar_pressed` (scale 1.1) over 0.45 s.
- **Tap or swipe:** a horizontal move over twice the touch slop turns the tap into a swipe that
  rates live.
- **Release:** a tap rates the star under the finger. The rating is sent only when it differs from
  the one at the press. The state animation returns over 0.2 s.
- **Long press:** toggles 5 ↔ 0. The rating is sent on release.

**Star under x.** p = trunc(x − paddingLeft + 0.5).
- **Left gravity:** star = trunc(p/O) + 1; the first half is p < O/2.
- **Right gravity:** star = 5 − trunc(p/O).
- **Centred:** the five stars are centred.
- **Clamp and the first star:** the star is clamped to 0..5. On star 1, a swipe gives 0 on its
  first half and 1 otherwise, and a tap toggles 1 ↔ 0. A tap left of the stars on rating 0 gives 1.

**Scene changes** (H0 / N / V0 / onDraw):
- A scene that changes the stars, their tint or the line background fades the new ones in over the
  old ones by the scene fraction (old 1 − K, new K).
- A change of gravity or clipping moves the background, the clip and the star origin from the old
  geometry to the new one.
- A reversed change keeps the old look.
- Here this applies to animated scene changes (item menu, lyrics). The art's play-state change
  switches item scenes at once (its frames animate).

`INFERRED`: the outlined star glyph is original art.

(f) `src/widgets/rating.js`.

### F58 — Dialog drag to dismiss — `CONFIRMED_STATIC` (fallback bytecode)

(a) S1 `DialogBehavior`, `vm` (drag), `wm` (shim and frame touch over `j0`), `um` (attributes
`wa1.f4985`), `do1.r/m1459/m1460`, `ao1`, `DialogOuterFastLayout`.

(c) **Attributes** (`BaseDialog`): `collapseDragDirection` none/down/up (bottom sheets down;
centered and top sheets up), `dragAnimTime` 1000, `dragThreshold` 0.5,
`dragThresholdVelocity` 1800 dp.

**Drag.** A drag starts inside the frame once it passes touch slop on either axis. The start
moves by the slop on each axis it crossed.
- **Progress:** dy / span, where span is the frame height (down) or the frame bottom (up); dy is
  negated for up. It drives the scene towards the out scene (default, or
  `scene_dialog_out_alt`).
- **Past either end:** ln(|over| / 0.05 + 1)·0.05, limited to −0.2 below and 1 above.

**Release.**
- A fling over the velocity threshold commits when it points in the collapse direction and
  cancels against it. Otherwise progress > `dragThreshold` commits.
- **Settle time:** 1 / (1 / (dragAnimTime·max(0.25, rest)) + rate) s. The rate is |v| / span
  (0..10) on a commit and 0 on a cancel. The interpolation is decelerate (2.0).
- A commit collapses the dialog (cancel). A dialog that refuses returns to `scene_dialog_in`.

**Shim.** A touch that did not drag the frame dismisses on release, including drags that start on
the shim.

**Lists in the frame.** A list starts a nested scroll on down, which disables the frame's
intercept. With `dragByNestedScroll` (BaseDialog on; off for the list alert dialog and Select
Album Art), `DialogOuterFastLayout` hands the frame the scroll the list cannot use:
- the scroll's start puts down a virtual pointer drag of the frame (past touch slop, as a touch);
- each step goes to the frame first while it is off its rest by more than 0.025
  (onNestedPreScroll);
- then the list scrolls, and what it could not use moves the frame (onNestedScroll);
- the scroll's stop releases the frame, ignoring the velocity unless
  `dragUseNestedScrollVelocity`.

The app's lists (PowerList) and scrolling dialog content (ScrollingBehavior) scroll by steps and
offer each one to the frame.

A scene held by a drag takes its dragged frames again after a layout pass. Rows bound while the list
scrolls under a held frame no longer snap the frame to the target layout.

(f) `installSheetDrag` in `src/widgets/sheet-drag.js` (used by `installDrag` in `src/widgets/dialog.js`), `SceneController.drag` (limits) and `settleTo`.

### F59 — Drag reordering and multi-select drag — `CONFIRMED_STATIC` (fallback bytecode) / `INFERRED` in part

(a) S1 `DragHandler`, `AAItemView.H/w1/x1`, `om0.mo632`, `kw0` (MultiGridDragHelper), `iw0`, `hw0`,
`gw0`, `fw0`, `jw0`, `sa0.m3081`, `x62` (flags 12), `yf0.K`, `g32.mo1250` (`cmd_data_reorder`),
`cm2.n`, `ui1`/`si1.mo1184`, `item_bg`, `ItemTrackDragView`.

(c) **Where it applies.** In selection mode, rows of reorderable lists (playlists and the queue) show
the drag handle next to the select box. A press on the handle starts the drag at once.

**Lift.**
- The row scales to 1.05 (`x62` flag 4; 1.07 in grids) over 350 ms with AnticipateInterpolator(2.0).
- Its background takes `ITEM_BG_LEVEL_INTERMEDIATE` (32), which draws `colorDraggedBg`, a rounded
  #AA000000.
- It moves to the front.

**Follow.** The row follows the finger, vertically only in one-column lists.
- When its centre enters another row, the gap moves there. The row is inset by 4 dp in grids, 0 in
  lists. The first row also takes a centre above it, and the last row one below or to its right.
- One-column lists rotate the rows between the old and new gap; grids swap the two
  (`iw0.m2123`).
- The displaced rows slide with the finger. Progress = (|centre − old gap centre| /
  |new gap − old gap| − 0.5)·2. At 1.01 the slide completes; at −0.01 the gap moves back and the rows
  return.

**Autoscroll (`kw0.m2317`, `sa0`).**
- **Zones:** 2 % of the content height (rounded), measured at least the padding in from each edge.
- **Speed:** (19.05 + (857.14 − 19.05)·depth / zone) dp/s, unbounded, so a row dragged over the
  navbar padding scrolls fast.
- **Start:** a row that starts inside a zone (zone moved 4 dp past it) scrolls only after it leaves.
  Autoscroll starts on a move with no overlap or during a slide.

**Release.**
- The row returns to the gap over 250 ms (decelerate). It then drops to scale 1 over 150 ms
  (anticipate 0.3) and its background level returns.
- **Background fades** (kw0 → `AAItemView.x1`): the lift fades the dragged level in over 200 ms;
  the drop fades it out over 200 ms. These are the level-list's DrawableContainer enter and exit
  fades, ported as `fadeLevel`. Popups fade their surface level the same way (`G1`): in over the
  popup enter time, out over the exit time.
- The order goes to the source as slot → row (`cmd_data_reorder` "poses"). The sort column is
  rewritten for every moved row.

**Multi-select.** Dragging a selected row while others are selected carries the selection.
- **Pick-up:** the other selected rows fly into the dragged row (alpha 0, scale 0.75) while the
  rest close up, over 250 ms (x32 settle, accelerate-decelerate). A badge "Items: N"
  (`ItemTrackDragView`, centred on the art) fades in from 1.5× scale over 350 ms (decelerate).
- **Drop:** the selection lands as one block at the drop slot, in its original order: the remap
  shifts the rest by the block length. The block spreads out of the dropped row (from alpha 0,
  scale 0.85) over 250 ms.

`INFERRED`/substitutes:
- **Release during a slide:** the reference finishes the slide while the row rides along via the
  transition's other rect. Here the row interpolates to the gap on the same curve, over
  max((1 − p)·250 ms, 100 ms).
- **After the drop:** the selection stays on the moved tracks. The reference's handling of its
  checked positions is not read.
- **List height:** it keeps the full row count while carried rows are away.
- **Grids:** the swap path and the 1.07 lift are implemented but unreachable, because the app's
  track lists have no grid zoom.

(f) `src/list/reorder.js`, `PowerList.applyOrder`, `AAItemView.initDragHandle`, `Playlists.reorder`,
`Player.reorderQueue`.

### F60 — Navbar menu sheet drag — `CONFIRMED_STATIC`

(a) S1 `NavbarExtension` (`a0`, `d`, `Z0`, `u`, `onInterceptTouchEvent`, `onTouchEvent`), `um`, `vm`,
`wm` (the F58 drag), styleable `wa1.a0` (`shim`, `content`, `twoLineEnterAnimTime`,
`twoLineExitAnimTime`).

(c) The open sheet (`scene_navbar_*_sheet`) collapses by drag with the F58 laws.
- **Target:** the matching non-sheet scene (1line_sheet → default, 2lines_sheet → 2lines,
  3lines_sheet → 3lines).
- **Span:** the extension's height (no `content` view set).
- **Attributes:** the extension's style sets none of the drag attributes, so `um` takes its
  defaults: collapse down, `dragAnimTime` 500 ms, threshold 0.8, velocity 1000 px/s (pixels, not dp).
- **Touches:** the extension consumes touches on its own background, so a drag can start there as
  well as on its lines.
- **Shim:** a touch on the shim released without dragging the sheet closes it with
  `animExitTime`, even if it moved.

(f) `installSheetDrag` in `src/widgets/sheet-drag.js` (shared with F58), `Navbar.installSheetDrag`,
`Shim`.

### F61 — Lyrics dialog (lyrics button long press) — `CONFIRMED_STATIC` / substitute in part

(a) S1 `ListWidget` (the `R.id.lyrics` long click → `cmd_data_lyrics`), `x8` (`cmd_data_lyrics` →
`dialogs.LyricsActivity`), `LyricsActivity`, `dialog_LyricsActivity` (BottomsheetDialog),
`dialog_content_lyrics`.

(c) A long press on the lyrics button opens the bottom-sheet lyrics dialog.
- **Title and buttons:** "Lyrics", with button1 "Search" and buttons 2 and 3 hidden.
- **Text (`big_text`):** the track's unsynchronised lyrics tag when it has at least 32 characters,
  with a lone `\r` turned into a line break. Otherwise `no_lyrics`.
- **Following the track:** the dialog follows the playing track (`msg_player_track_changed`).
- **Search:** asks for a web search of "lyrics " + artist + " " + title. The title falls back to the
  file name. The album is added only when the artist is empty, and `-` and `_` become spaces.

Substitutes and not built:
- **Search:** Android's `WEB_SEARCH` chooser becomes the Web Share sheet with the query; without
  it, the query is copied to the clipboard. No search host is hard-coded (the repository's host
  allowlist).
- **Provider apps:** the third-party lyrics apps the reference queries first (`qo0` providers,
  `lyrics_search_provider`, the `arg1 == 1` path) are Android apps and are not built.

(f) `src/widgets/lyrics-dialog.js`, `LyricsButton.onLongClick`.

### F62 — Sub-art button editing — `CONFIRMED_STATIC` / owner-approved feature-pack feature

(a) S1 `SubAAButtonsLayout` (`F1`, `z1`, `y1`, `C1`, `A1`, `onLayout`, `performLongClick`),
`LoadableDraggableButtonsBehavior`, `DraggableSourceBehavior`, `cm2` (the button factory), `c40`
(the stored row), `EditButtonsRedirPref`, `merge_subaabuttons_edit`, `@array/sub_aa_buttons`,
`FastLayout` (`stack_horizontal` wrap).

(c) Editing begins on a long press between the buttons, moving no further than the touch slop.
It also begins from Settings → Player → "Edit player screen buttons", which closes settings,
returns to the player screen and begins 150 ms later.
- **Conditions:** the player screen (`nav_main`) is showing, no navigation is animating, nothing
  modal is open, and `sub_aa_buttons_no_lp_edit` is off (that pref gates only the long press).
- **Row:** rises over the shade with `translationZ = ?popup_elevation`; touches follow Z order.
  Its 32 slots draw with `slot` / `slot_highlighted` and fade in over 250 ms. While editing, the
  row scrolls over the slots' extent; otherwise it scrolls over the buttons' right edge.
- **Panel (`merge_subaabuttons_edit`, loaded after the row):** the shade (`Shim`; a tap ends
  editing) and a panel with:
  - Centered, 2 lines and Small checkboxes;
  - a settings shortcut to the player screen settings;
  - the palette, four per row (`EditableButtonContainer` 25 % wide, `stack_horizontal`), each
    button with its label below and at 25 % alpha while it is in the row;
  - the hint.
- **Drag:** a long press on a palette or row button lifts a copy. The copy scales to 1.2 over 200 ms
  and follows the finger; the row and the palette no longer scroll for that touch.
  - The highlighted slot is the one whose span contains the copy's centre x and overlaps its top or
    bottom.
  - Touching the row's left or right edge scrolls the row at 350 dp/s.
  - Release on a slot: the copy flies there over 200 ms and the button lands. A different button in
    that slot leaves the row; a button moved within the row leaves its old slot.
  - Release elsewhere: a palette copy flies back; a row button leaves the row as its copy fades
    over 100 ms.
- **Layout options:** changing one moves the buttons to their new slots over 0.5 s
  (accelerate-decelerate). Two lines starts the second line at slot 16.
- **Ending:** the shade, Back or Escape end editing. The slots fade out, the panel closes over
  0.25 s, and the row is stored per orientation with trailing empty slots dropped.
- **Button kinds (`cm2`):**
  - visualisation, sleep timer, counter ("position / count", or "- / -"), shuffle and repeat;
  - menu, add to playlist (icon morphs when the track is in a playlist), album art, info/tags,
    lyrics (icon morphs when the track has lyrics), artist, album, genre and folder;
  - like / unlike / love / unlove checkboxes, and the like-unlike and love-unlove rating menus;
  - previous / next category: a long press goes to the first / last category with a toast; both are
    disabled when categories cannot be navigated;
  - −10 s / +10 s: a tap jumps 10 s. Held, the jump repeats every 250 ms: 10 s for the first 3 s,
    then 20 s;
  - audio info: the short audio meta line, opening the DSP info popup.

Substitutes and not built:
- **Feature pack:** the reference sells editing in its feature pack; the owner approved it for this
  private build, so it is always unlocked.
- **Omitted kinds:** cast (no web counterpart), delete and tag editing (owner decisions), and
  bookmarks (not built).
- **Audio info:** the routed device icon has no web counterpart.
- **Engine fix:** a `stack_horizontal` child that wraps to a new line now lays out on that line.

(f) `src/widgets/subaa-edit.js`, `src/widgets/subaa.js`, `Player.edgeCategory`, the
`cmd_player_seek_jump` `ms` argument, `SettingsUi.closeAll`, `input.js` Z-ordered hit testing and
the long-press disallow-intercept, `FastLayout` wrap position.

### F63 — Library list preferences and List Options — `CONFIRMED_STATIC` (fallback bytecode in part)

(a) S1 `yp1` (Settings → Library → Lists listeners), `z22` / `n12` and `uf1.e1` (track labels),
`lw0` (multi-tag splitting), `ListOptsActivity` (and its fallback decompile for `у(FastButton)`),
`ql0` / `vl0` (option handlers), `gi1` / `fi1` (library categories), `oi1`, `zi1`, `yi1`, `sj1`,
`ii1`, `hi1` (the statistics and Long Files queries), `m30` (state defaults, including the
first-run block `m30.d`), `p31` (`cmd_nav_to_lib`, `cmd_list_clear_list`, `cmd_list_show_all`),
`hs.у` (clear and show all), `ie` (`W0`, `mo2079`), `g32` / `b32` (header heights), `hl0`.

(c) Track labels and list behaviour:
- **Title:** the title tag, or the file name with `title_filename`.
- **Artist:** the album artist with `use_albumartist`; album rows lead with it with
  `use_albumartist_albums`; an album artist's track lists lead with it with
  `use_albumartist_albumartists`.
- **Line 2:** "artist - album", leaving out unknown parts with `hide_unknown_album` (default on)
  and `hide_unknown_artist`.
- **Numbers (`track_num_type`):** 1 a separate number ("-" without one), 2 in the meta
  ("N / disc | meta"), 3 a title prefix "N. ". Types 1 and 2 apply only in album and folder track
  lists. `track_disc_meta` adds the disc.
- **Albums:** keyed by (album, album artist), case-insensitively. With `join_albums` (default on) a
  track without an album artist joins the album whose album artist is the track's artist.
- **Sort field:** names sort without a leading "The", "A" or "An" unless `no_sort_field` is on; the
  A–Z column follows.
- **Splitting:** `artists_split_chars`, `composers_split_chars` and `genres_split_chars` (tokens
  joined by U+001F; genres default to ";" and "//") split tags; a name from `artists_split_ignore`
  ("AC/DC | +/-") at the start of a part stays whole. Artists and composers split only into two or
  more parts; `show_unsplit_cats` keeps the unsplit entry as well.
- **`list_action_resets` off:** tapping the playing track adopts the list as the queue without
  restarting the track.
- The shown lists are re-made when any of these change.

List Options:
- **Home (`library_layout`):** a check box per category in `gi1` order for the home list
  (`library_lists`, default 1048511), each after a star for the start category (`library_home`,
  default -1). Notes sit under Album Artists, Albums by Artist and Bookmarks.
  - A long press on a star or a check box makes that category the start one, or clears it when it
    already is, and checks the box.
  - Unchecking the start category clears it.
  - The stars fade over 250 ms (1 for the start category, 0.1 for the others).
  - `cmd_nav_to_lib` with no remembered list opens the start category over the home.
- **Search (`search_layout`):** a check box per searched category. The mask persists and is shared
  with the search chips.
- **Max Items (`limit_group`):** 200 / 500 / 1000 / no limit for Most Played, Top Rated, Low Rated,
  Recently Added and Recently Played. The value is `*_files_limit`: 0 in `m30`, but the first-run
  block sets 200, and the read is `max(2, v)`.
  - The cap applies in the query's own order before the list's sort.
  - The queries: Most Played is `played_times > 0` by plays; Recently Played and Recently Added
    are by date; Top Rated is `rating > 1` by rating; Low Rated is `rating = 1`.
- **Clear / Show All:** shown for Most Played, Recently Played and Recently Added (`ch1`). Clear
  sets the list's start time to now; Show All sets it back to 0. Neither asks for confirmation.
- **Min Duration (`duration_group`, Long Files):** a 0–119 seek bar for 1–120 minutes, saved when
  the drag ends. `long_files_min_duration` is 15 minutes after the first run (the app used 20).
- **Compact Header (`layout_header_compact`, `xh1`):** an entry's track list takes
  `compactTextHeaderSize` instead of `textHeaderSize` (`b32.F0`).
- **Show Titles Only:** disabled at zoom levels -2, -3 and -4 (`ie.mo2079`).
- **Sort notes:** shown under their options.
- **Settings gear:** opens Settings → Library. It is invisible when List Options opens from the
  `library_list_opts` / `list_opts` preferences (`arg1` 1).
- **Reference quirk:** the "no limit" radio's tag is " 2147483647" with a leading space, so
  `Integer.parseInt` throws and the choice is dropped. Here it applies, a deliberate deviation.

(f) `library/labels.js`, `library/split.js`, `Library.albums()` and the category builders,
`list/sources.js` (`STAT_LISTS`, sort keys, `homeCategories`), `list/list-opts.js`,
`ListWidget.openStart` / `openListOptionsFor` / `rebuildStack`, `widgets/search.js`
(`searchMask`), `view/seekbar.js` (platform SeekBar stand-in), `view/html-text.js` (HtmlTextView
with inline icons), `SettingsUi.overDialog` (the settings page moves under a player dialog while
it is open). Not built: list memory (a playlist's or folder's remembered position and per-track
progress).

### F64 — Search results, categories and history — `CONFIRMED_STATIC`

(a) S1 `jj1` (`v1`, `u1`), `kj1` (the merged result cursor, its separator rows, search history `А`
and the empty query), `vo1` (`T0`, `g0`, `f`, `y`, `e0`, `P0`), `to1` (row types), `l2.B` (matching),
`ls` (the word splitter), `uf1` / `te1` / `cf1` / `le1` / `zf1` / `eg1` / `vj1` / `hf1` / `ri1`
(search fields and `R` orders), `SeparatorItemView`, `item_separator_button`,
`item_search_history`, `item_clear_search_history`, `ListSearchCatsLayout` / `im0` (the chip row,
a `b82` scroller), `m30.f1` (`search_track_titles_only`), `b40.N0` (`search_play_tracks`).

(c) **Categories:** Albums, Artists, Album Artists, Folders, Genres, Years, Composers, Playlists,
All Songs and Streams, in that order. The chips select them (bit i = category i, persisted). The
chip row scrolls sideways (drag, fling, clamped ends).

**Matching:** the query splits on whitespace, ":", "-" and "_". Every word must occur,
case-insensitively, in the category's fields joined with no separator; more than 64 words find
nothing. Fields:
- Albums: album and artist.
- All Songs: title, album and artist. With `search_track_titles_only`, the title only. With
  `title_filename`, the file name stands in for the title.
- Every other category: its name.

**Results:** each category with matches gets a subheader row (`item_separator_button`: the
category's name and a hairline, `separatorSize` high), then its rows sorted by name with NOCASE
ordering. Entries show as track-style rows.
- A tap on an entry opens it.
- A tap on a song plays the found songs from it (`vo1.f`).
- Play / Shuffle (`vo1.g0`) plays through the Queue (F65). With `search_play_tracks` (default on),
  and when songs are the last results, only the found songs; otherwise every result row's songs in
  order.

**History:** every delivered result set records its query. A query that extends a stored term
replaces it; a query a stored term already extends adds nothing; anything else is added. The empty
search lists the 16 newest terms (`item_search_history`: the term and a clear button), then "Clear
search history". A tap on a term searches it; its button removes it.

**Fix:** the chip row now lays out after Search opens. Its scene change had captured a 0 × 0
target frame while the row was gone.

**Minimum query:** two characters (one when targeted, or for Japanese, Korean and Chinese).
Shorter, the plain search lists its history and a targeted one nothing (`kj1.B`).

**Search zoom** (`list_zoom_search`, `jj1.A` / `u` / `q0` / `F`, `vo1.P0`): six one-column levels,
the track lists' table: 1 line extra small, 1 line, List - no images, List - compact (the default),
List - small and List. The one-line scenes apply when the search covers one one-line category
alone (Playlists, Genres, Years or Composers). Pinch steps through the levels; List Options offers
them; separators and history rows keep their own heights.

**Targeted search** (`ste` / `fpt`; `p31` `cmd_list_target_search` / `cmd_list_clear_target_search`,
`vo1.T0` / `W0` / `S0`, `kj1.B`, `pd.I0`, `ListSearchTargetButton`, `ListSearchCatsLayout.x1`):
- A list header's search button searches within the shown list: a category list, an entry's
  songs or albums, Albums by Artist, a Folders Hierarchy level. The Library home, the Queue and
  the search itself open the plain search.
- The query starts empty with the keyboard. The category chips hide behind the target chip: the
  list's label ("Albums", "Album Songs: Coastlines", "Folders Hierarchy: <folder>") with an X.
- It searches the list's own rows in the list's own order: a category list its entries (albums by
  album and artist), a track list its songs, a Folders Hierarchy level its subfolders and the songs
  directly in it, the songs under "Folder Songs" (a header shows only before a second category).
  A result binds, opens and plays as in that list (a song plays the list from it).
- The chip clears the target: the same text over the chosen categories, the chips back.
- The last plain search text comes back when Search is opened plainly; targeted terms still enter
  the history.

(e) **Inferred:** the labels' kind names for deeper lists, and the one-line levels' scenes for
results that are not one-line categories.

Not built: Streams results (owner decision).

(f) `list/sources.js` (`searchSource`, `targetedRows`, `historySource`), `library/search-history.js`,
`list/power-list.js` (separator and plain row types with their own heights), `widgets/search.js`
(`SEARCH_CATS`, the chip row scroller, `ListSearchTargetButton`), `list/list-widget.js`
(`targetSearch`, `targetLabel`, `setSearchTarget`, the search's pinch zoom).

### F65 — The Queue — `CONFIRMED_STATIC`

(a) S1 `pi1` (`shouldMoveToQueueAfterSong` / `AfterList`, `startQueueImpl`, `exitQueueImpl`,
`next`, `onQueueUpdated`, `postCreate`), `hs.y` (adding), `ui1` (the Queue entity and its order),
`qq0.j` / `qq0.n` (labels), `k21` (`played_at`), `b40.Q` / `b40.R` / `b40.S`, `c40.a0` / `c40.b0`,
`m30.C` / `m30.f3172` / `m30.c`, `vo1.g0` (search Play).

(c) The Queue is a list of entries. An entry stays unplayed until its track's playback session
starts after the entry was added (`played_at < created_at`). Unplayed entries wait while another
list plays.

**Queue mode:** the entries become the playing list and the interrupted list is saved. The Queue
starts at the first unplayed entry (or the last), with a 1 s "Started queue" toast. `queue_start`
sets when:
- 1: as soon as tracks are added;
- 2 (default): on the next song;
- 3: at the end of the list, ahead of repeat and advance.

**End (`queue_end`):**
- 1 (default): return to the saved list and go on to its next track, with "Left queue".
- 0: stay. Repeat on plays the Queue again; otherwise playback stops.

In queue mode the next/previous "category" is "Leave queue" (the same exit).

**Adding:**
- Play Next with `q_next_forces_after_song` (default on) sets `queue_start` to 2.
- `queue_clear_on_add` clears the Queue first, keeping the playing entry unless the Queue starts
  immediately.
- Otherwise a Queue whose entries have all played is cleared, unless `queue_never_clear_on_add`.
- Play Next inserts after the playing entry, or before the unplayed ones; Add appends.
- Insert mode 2 shuffles the added tracks. The insert modes are the `queue_insert_pos` /
  `play_next_insert_pos` preferences, shared with the selection menu's mode buttons.

**Other rules:**
- `queue_no_shuffle` plays the Queue in order.
- Clear Queue keeps the playing entry in queue mode.
- Search Play / Shuffle clears the Queue, fills it with the results and starts it ("Playing queued
  search results"). A song tap in the results plays the found songs.
- The entries, their played state, queue mode and the list to return to persist across restarts.

Inferred: the order of a shuffled Queue (the reference's `shuffle_order` column) uses the player's
shuffle permutation.

(f) `player/player.js` (`entries`, `startQueue`, `exitQueue`, `queueNext`, `enqueue`,
`queueUpdated`, `playAsQueue`, `clearQueue`, `resumeQueueMode`), `list/mode-state.js`, `app.js`
(persistence), `ListWidget.playSearch`.

### F66 — Playlist re-sort, import and export — `CONFIRMED_STATIC` / web substitute in part

(a) S1 `PlaylistSortActivity`, `dialog_content_resort`, `cm2.q` (the orders), `si1.S` / `ui1.S`,
`g32` (Re-Sort shown for `bi1`), `y51` (reading), `lc0` (writing), `PlaylistsExportActivity` / `oa`,
`ct1` (the Playlists settings), `b40.a1` / `b40.o1` / `b40.p1`.

(c) **Re-Sort** (playlists and the Queue): each radio re-sorts the stored order at once; Reverse
(bit 30) re-sorts again and starts from "by track". The orders follow `cm2.q`:
- names are case folded;
- album and artist use their sort fields;
- ties fall back to the title;
- rating, duration, play count and played time run highest first;
- Random ignores Reverse.

"By added to list" exists only for the Queue (its entry time). Entries whose files are missing stay
after the sorted ones.

**Reading:** .m3u8 as UTF-8; .m3u as UTF-8 with `m3u_utf8`, else in the tag encoding; .pls by its
`FileN=` lines; .wpl / .zpl by their `media src`. `#EXTINF` names an entry, and with
`pl_import_ratings` `#EXT-X-RATING:` sets the next entry's rating.

**Writing:** `#EXTM3U`, then per entry `#EXT-X-RATING:<rating>` and its path, with CRLF line ends,
one `<name>.m3u8` per playlist. File-based playlists are written only with "Also export file based
playlists".

**Web substitutes:**
- Import picks playlist files; the reference imports the system library's playlists, which a
  browser cannot reach. Each file becomes a file-based playlist, and re-importing the same file
  replaces it.
- Entries resolve by the longest matching path tail among tracks with the same file name.
- Unresolved entries stay (`path:<path>`, not playable). With `pl_auto_resolve` they are matched
  again whenever the library changes.
- Export downloads through the browser; there is no target folder choice.

(f) `widgets/resort-dialog.js`, `library/playlist-files.js`, `SettingsUi.importPlaylists` /
`openExportDialog` / `toast`, `ListWidget.listAction` (`cmd_list_resort_dialog`).

### F67 — Equalizer presets — `CONFIRMED_STATIC` / not built in part

(a) S1 `EqPresetPopupListLayout` (`m10` rows, `n10`, `o10`), `EqPresetSearchCatsLayout`, `mf1`
(sections and filters), `AddEqPresetActivity` / `BaseAddPresetActivity`, `merge_eq_menu_layout`,
`merge_selection_menu_eq_preset_items`, `item_eq_preset_search`, `u31.r` (preset JSON), `oc` / `x81`
(export file name), `Band` (types).

(c) **Popup (Preset button):**
- A header with a name search and the filter chips: User / Built-in / AutoEq, Graphic / Parametric,
  Assigned. The chips persist, defaulting to all but Assigned.
  - A tap toggles a chip; a long press keeps only that chip within its group.
  - Graphic or Parametric always stays on.
  - Reset Filters restores the default.
- The presets in sections (User, Built-in) under subheaders, by name, each with its mini response
  curve. The current preset shows checked; a tap loads it and closes the popup.
- A long press selects presets (select boxes over the curve), with Rename (one preset), Delete
  (user presets), Share, Export and Import over the list.

**EQ menu:**
- Auto Save: edits are written into the current preset unless it is Locked; otherwise an edit
  leaves the preset and the label returns to "Preset".
- Save/Assign: "Save Preset", the name prefilled and existing names suggested. With a current
  preset, saving updates it (data and name); otherwise it adds or overwrites a user preset.
- Rename, Share, Export, Import.
- Restore Defaults, after the reference confirmation: a built-in preset loses its edits and name;
  a user preset's gains go to zero.

**JSON:** `{name, preamp (dB), parametric, bands: [{type, channels, frequency, q, gain (dB), color}]}`
with type 0 bass shelf, 1 treble shelf, 2 peak. Several presets export as an array to
`<name or Presets> [<date time>].json`.

`_autosave` in the EQ settings is the same switch. `BusActionButton` now honours `confirmTitle` /
`confirmText` / `confirmButton`.

**Inferred:** imported peaks at other frequencies summing into the nearest graphic band. (The tone
shelves' frequency and Q in the JSON are the Tone settings, F68.)

### F68 — EQ knob values, Tone and band settings, settings rows — `CONFIRMED_STATIC` / inferred in part

(a) S1 `KnobLabelAndValue` (`onDraw`, `onMeasure`, `m640`, `b`, `e`), `LinearKnob` (`q`, `l`, `v`,
`f`, `k`, `onTouchEvent` from fallback bytecode, `setValueFromDialog`), `zi0` (zoom animator), `h5`,
`f10` (band knob), `C0049` (`as` preamp knob), `pr.H` / `lc0` (preamp scale), `DSPToneRoundKnobLayout`,
`DSPRoundKnobLayout` (`v1`, `onLongClick`), `RoundKnob` (`d`, `getValueForDialog`,
`setValueFromDialog`), `Utils.m545 / m547 / m549`, `ur1` (Tone settings, `zr` definitions), `b40`
(`tone_*`, `equ_*` keys), `v11` (band layout hand-off), `RoundKnobPreference`,
`preference_roundknob`, `RawTextPreference` (`m404`, attributes `wa1.o0`), `r81` (`m2970`,
`wa1.Z`), `SeekbarPreference` (`A`, `mo409`, `B`, `onStopTrackingTouch`, `wa1.w0`),
`settings_quote_background` (v23).

(c) **Band and preamp knobs (eq_labels, default 1):**
- Mode 1 shows the value as "%.1f" over -15..15 dB for bands and -24..24 dB for the preamp; mode 2 as
  "%.0f%%" over -100..100; mode 0 hides it.
- The value line (`?EqKnobValue_Text`) sits at the bottom, the label `valuePadding` above it; both
  stand on the label background. The travel loses the value line and `textPadding`.
- The value text shows the target value. While the thumb is held it zooms ×`valueAnimZoom` (1.5) and the
  label background ×1.5 / ×1.1, over `valueAnimTime` (300 ms, decelerate). There is no zoom without
  a value.
- Touches:
  - On the thumb, or within `thumbMinTouchableSize` / 2 of its centre: a drag.
  - Below the travel (the label): a long press opens the value entry dialog — title the band label,
    the value selected, the volume warning below. The typed value is clamped to the range, mapped back
    and animated.
  - Elsewhere on the travel: on release, the value steps 0.05 toward the tap, snapped to twentieths.
    It slides linearly over 500 ms per unit (100 ms at least). A step landing on exactly 0 is dropped,
    as in the bytecode.
- The preamp spans -24..+24 dB, linear through 0 dB at the middle (`pr.H`). It was ±15 dB here before.

**Tone knobs (tone_labels, default 2):**
- Mode 1 shows "%.1f" over 0..15 with one dialog digit; mode 2 percent with whole numbers; mode 0
  has no value label and no long press.
- A long press on any DSP round knob's label or value label opens the same value dialog, which takes
  `dialogPrecision` digits. The typed value is mapped back (m545), rounded to `rounding` steps and
  animated: 120 ms for a change of 0.05 or less, otherwise 400 ms, decelerate(2).

**Tone settings (peq_equ_tone):**
- Four knobs: bass frequency 20..250 Hz (default 90), bass Q 0.1..2 (default 0.8), treble frequency
  5..15 kHz (default 10 kHz), treble Q (default 0.6). Each maps linearly.
- They are stored as tone_bass_freq / tone_bass_q / tone_treble_freq / tone_treble_q: whole hertz
  and two-decimal Q factors, with the default stored as 0. A long press on the value enters it.
- The web shelves are IIR filters with the RBJ shelf Q, cross-faded when their coefficients change.
  They replace the platform shelving biquads, which have no Q.

**Band settings (peq_equ_bands):**
- equ_bands_num picks 5, 10, 12, 15, 16, 24, 31 or 32 bands. equ_custom_bands uses
  equ_custom_bands_num over first_fr..last_fr instead (clamped to 5..32, 5..400 Hz and 10..24 kHz).
- The frequencies come from the native library. Here ISO 10 / 15 / 31 take the ISO 266 octave,
  2/3-octave and 1/3-octave centres.
- *Inferred:*
  - other counts are log-spaced over the custom defaults (20 Hz..16 kHz);
  - each band's Q is sqrt(2^N) / (2^N − 1) for an N-octave spacing (1.41 at one octave);
  - gains and presets are resampled in log frequency onto a new layout.

**Settings rows:**
- RawText summaries are composed of summary, line1, smallLine1 … line4, smallLine4. Lines are
  separated by a blank line (one newline with singleNewline, two between groups with
  extraLineBetweenGroups). Small lines take the Hint style; prefixes, lineCase and addDots apply.
  The text is HTML: inline drawables, settings / #key / web links.
- `summary2` follows in the tertiary colour, after a blank line for the RawText family, knobs and
  switches. `sup` is a small line above the summary.
- RawText backgrounds: the v23 quote bar, a rounded outline and a warning outline. Rows the reference
  fills from Android state stay out.
- Seek bars:
  - step, `scale`, `floatScale` (stored value ÷ floatScale) and entries / values arrays;
  - summary and summary2 formatted with the value;
  - left / centre / right labels and tick marks;
  - the value is stored when the touch ends.
- Dependent rows follow their switch, its default included.

**No web counterpart:** dsp_border_gain (native gain smoothing).

**Not built:** device assignment (F81) and AutoEq presets. Parametric presets are F82.

(f) `dsp/eq-presets.js`, `widgets/eq-preset-ui.js`, `EqPresetPopupListLayout` in
`widgets/popup.js`, `PopupList` row heights, the DSP's preset hooks (`get` / `set` / `setBand`).

### F69 — Reverb presets — `CONFIRMED_STATIC`

(a) S1 `ReverbPresetPopupListLayout`, `jk1`, `cd`, `mr` (`D1`, `W1`), `uh.j` (built-in seeds),
`gj1` (`ORDER BY name`), `ReverbPluginService` (`O`, `mo368`, `m391`), `AddReverbPresetActivity`,
`dialog_content_add_reverb_preset`, `merge_selection_menu_preset_items`, `wr1` / `yp1`
(Restore Reverb Presets), `yp1.J` / `x8` case 5 (Restore Equalizer Presets), `c40.I`
(`help_once_flags`).

(c) **Presets:**
- Eight built-ins (`reverb_preset_labels`, ids 1000 down to 993) carry "1=…;…;8=…;" parameter strings.
  Parameter 8 is always 1.0 and has no knob here.
- The Preset button opens them by name as `item_popup_simple` rows with the reverb icon; the current
  one shows checked.
- A tap applies a preset (`cmd_dsp_set_reverb_preset`) and closes the popup; the button shows its
  name. Any knob edit leaves the preset (the label returns to "Preset").
- A long press selects presets for Rename (one preset) and Delete; built-ins can be deleted too.
- The first time each preset list (EQ bit 1, reverb bit 2) finishes opening, a 4 s toast says a long
  press selects items.

**Save** (`cmd_data_add_reverb_preset_dialog`, the tab's Save button):
- The current preset's name is prefilled and existing names are suggested.
- With a current preset (id ≠ 0) Save updates that preset's name and data; otherwise it adds one.
- The values then apply under the typed name with id 0, as the bytecode does, so the saved row is
  not checked until it is picked.

**Settings:**
- Restore Reverb Presets deletes ids ≤ 1000 and seeds the built-ins again; user presets stay.
- Restore Equalizer Presets drops the built-in presets' edits and names and reloads a current
  built-in.
- Both confirm first and show "Done".

### F70 — Fades and crossfades — `CONFIRMED_STATIC` (settings) / `INF` (curves)

(a) S1 `fade.xml`, `b40` (crossfade_auto_advance 0, crossfade_length_ms 5000, fade_manual_advance 1,
fade_short_ms 400, fade_short_xfade_ms 400, fade_seek_ms 100, fade_play_pause and fade_seek on,
track_end_silence_ms 0), `v11` (hands them to the native `Pipeline2.l / u / q / n / r`),
`pref_auto_fading_entries`, `pref_fading_entries`.

(c) The fading itself runs in the native pipeline, so these behaviours follow the settings' wording
with linear gain ramps (inferred). The player has two media decks, each with its own gain in the
DSP graph.

- **Play / pause** (fade_play_pause): pausing fades out over fade_short_ms, then pauses; resuming
  fades in. A seek made while fading out (Stop) lands once it is silent.
- **Seek** (fade_seek): out over fade_seek_ms, the jump, then in over fade_seek_ms. The position shows
  the target at once.
- **Manual track changes** (fade_manual_advance): No fading, Short crossfade (fade_short_xfade_ms) or
  Crossfade (crossfade_length_ms). The next track starts on the other deck while the current one
  fades out.
- **Automatic advance** (crossfade_auto_advance): within crossfade_length_ms of the end the next track
  starts crossfading. Modes:
  - All songs.
  - Shuffled songs: only with shuffle on.
  - Non-gapless/cue: except for gapless pairs. A gapless pair is inferred as the next track number of
    the same album, disc and folder.
  - No crossfade is started when the advance would stop (end of list, single song, sleep timer) or
    repeat the song, or when the track is not longer than the crossfade.
- **track_end_silence_ms:** silence after a track ends before the next one starts.

### F71 — ReplayGain — `CONFIRMED_STATIC` (settings) / `INF` (gain rules)

(a) S1 `rg.xml`, `b40` (rg_preamp_mb `r`, rg_default_mb `q`), `yp1` / `zp1` (`cmd_player_set_rg_levels`),
`RoundKnobPreference` (`wa1.s0`: min, max, scale, valueFormat; `B`, `m406`).

(c) **Gain:**
- The reference passes the levels to its native player. The rules here are the standard
  ReplayGain ones that the settings name:
  - rg_type: Don't apply, Apply Gain, or Apply Gain / prevent clipping by peak (gain ≤ 1 / peak);
  - rg_source: Album, falling back to Track, or Track, falling back to Album;
  - RG preamp (rg_preamp_mb, ±16 dB) adds to tagged songs; "Preamp for songs without RG info"
    (rg_default_mb) is the gain of untagged songs.
- The gain is a per-deck gain before the fade gain and the DSP. Setting changes apply to the playing
  track at once.

**Tags:** REPLAYGAIN_* in Vorbis comments, ID3 TXXX and MP4 freeform items, and Opus R128_* (Q7.8 dB,
+5 dB to the ReplayGain reference) are read on import and rescan. The R2 index's values already were.

**Settings:**
- The two knobs are XML RoundKnobPreferences: an int over min..max, shown divided by scale in
  valueFormat ("%.1fdB"); a long press on the value enters it.
- Restore Defaults now notifies every restored key.

### F72 — Shuffle modes and options — `CONFIRMED_STATIC` (fallback bytecode in part)

(a) S1 `pi1` (`toUri`, `next`, `startQueueImpl`), `qq0.S` (the `shs` parameter per shuffle mode),
`ie.W` / `R0` / `S0` / `T0` / `U0` (fallback bytecode: shuffle_order), `m30.g1`
(shuffle_random_factor 0.5), `b40` (no_reshuffle `V`, no_reshuffle_for_large_lists `n2`,
category_shuffle `Z1`, hier_flat_shf `U`), `ie.A` (20000 tracks from Android 9), `y01` / `PlayerServiceCore`
(reshuffle on a pick unless no_reshuffle).

(c) **Modes:**
- Shuffle All shuffles the playing list's songs without category navigation.
- Shuffle Songs and Shuffle Songs/Categories shuffle the songs (`shs`). Shuffle Categories keeps the
  songs in order.
- Shuffle Categories and Songs/Categories advance through the categories in a shuffled order, the
  current one first. Next / previous category and the category labels follow that order.
- (Before, every mode shuffled the songs and the categories stayed in order.)

**Randomization** (shuffle_random_factor y, default 0.5, a float seek bar over 12 steps):
- Below 1, with more than 4 tracks, the tracks whose played_at is at or below a threshold come first,
  each part shuffled.
- The threshold is the played_at at offset round(n·y) in played_at order; from 10 000 tracks it is
  min + (max − min)·y.
- y = 1 shuffles fully.

**Picking a track from the playing list** keeps the shuffle order with no_reshuffle, or for lists
over 20 000 tracks with no_reshuffle_for_large_lists (default on). Otherwise the list starts a new
shuffle. A pick while playing is a manual track change for fade_manual_advance (F70).

category_shuffle and hier_flat_shf act on the category lists' header Shuffle (F76).

### F73 — Library playback options, pro button morph — `CONFIRMED_STATIC`

(a) S1 `b40` (scan_min_track_duration 6, skip_video, restore_pos, restore_pos_min_dur 45), `c40.b`
(long_skip_rewind), `pi1.shouldRestorePerTrackPos`, `p21` (`last_pos` updates, restore on load),
`k51` (`state_player_long_seek`), `MorphableBusStateBehavior` (`wa1.Y`), `BusDisabledForStateBehavior`,
`TopPrevCat` / `TopNextCat` styles, `xs1` / `ss1` / `hs.H` (Reset stats).

(c) **Scan settings** (applied to the loaded records at once):
- Tracks shorter than scan_min_track_duration seconds are left out of the library ("Don't ignore" = 0).
- With skip_video, files with a video stream are left out. Imports detect it from an MP4 `vide`
  handler or a video MIME type, R2 tracks from their MIME type.

**restore_pos:**
- Leaving a track stores its position (`last_pos`; 0 within 2 s of the end).
- A track longer than restore_pos_min_dur minutes, or one played from the Long list, starts at that
  position. The exception: when an automatic crossfade would begin within crossfade + 2 s of it.

**long_skip_rewind** (state_player_long_seek: the option on and a track over restore_pos_min_dur
minutes, or the Long list):
- The pro previous / next category buttons morph into −10 s / +10 s. A tap jumps 10 s; held, they
  jump every 250 ms, 10 s for 3 s and then 20 s, until released (`cmd_player_begin_seek_jumps` /
  `end_seek_jumps`). They stay enabled.
- Otherwise they follow `state_player_category_not_navigable` (disabled outside category lists).
- BusActionButton now honours enableForStateId / disableForStateId / morphWhenState for the states
  this runtime knows: category navigation, long seek, seekable, dsp_enabled.

**Reset stats:** "Reset stats?" with the warning and the stats-based categories note; Reset sets
played times and last played to zero for every track.

### F74 — About: version and licenses — `CONFIRMED_STATIC`

(a) S1 `general.xml` (`about_version`, `oss` with its SettingsLicenseActivity intent), `ns1`
(the version summary).

(c) **Version:** the summary is "build-1031-uni", then on new lines a native build string and the
32/64-bit word. Here it is "build-" and the deployed commit, then the player folder's tree and
"local edits" when the deployed tree was dirty, from `release.json` beside the app folders.
A checkout without `release.json` shows "build-local".

**Open Source Licenses:** a settings page with one note per third-party piece the player loads:
butterchurn 2.6.7 and butterchurn-presets 2.4.7 (MIT, with the full notice), Manrope3 (OFL 1.1, the
full notice in `fonts/LICENSES.md`) and TT Norms Pro (used under the owner's permission). The
reference's own list (its native libraries) does not apply.

### F75 — Navbar scroll-away and the bottom toolbar — `CONFIRMED_STATIC` (fallback bytecode)

(a) S1 `TopListWidget` (moveableToolbar `@id/navbar`, moveableToolbarAnchor bottom,
moveableToolbarExtraStates false), `om0` (wa1.U attributes, `c0` creates `yv0`, `h0` / `i` / `h` / `r` /
`t0` / `p0`, cmd_list_force_ab_on_screen), `ListWidget` (static_navbar: anchor bottom → fixedBottom),
`yv0` / `xv0` (fallback bytecode), `h0` (layout status), `pd.y0` / `sh` / `w62.f0` / `w62.j` / `z62`
(bottom toolbar, scene_bottom_toolbar), `hl0` (bottomToolbarSize, 44 dp), `sb0` and `i22` (posters),
`yp1` (both settings recreate the screen).

(c) **Scroll-away (bottom anchor).**
- Each scroll step of f px (content movement; negative towards the list end) moves the offset
  H = H + f.
- The offset is 0 (shown) at the list top or when everything fits, and at the end.
- In between, the navbar moves down by −H, up to height = the rows' reserved space (navbar bounds plus
  the bottom inset) plus the bottom toolbar size. At full height it is invisible.
- Approaching the end (last item shown, scrolling on), H is held at ≥ −(scroll left), so the navbar
  comes back as the end nears.
- fixedBottom (static_navbar, or while pinned) keeps it in place.
- Jumps (A–Z, scroll to track) re-place it without moving it.

**Other states.**
- **Art or lyrics layout:** shown at once (a 250 ms linear move back).
- **Level change:** the configured anchor again, then placed for the new list; while the level
  transition runs, a 100 ms linear move back.
- **Library and search help:** pinned while open (cmd_list_force_ab_on_screen 1 / 2).
- **Equalizer:** going there shows it.
- **Selection mode:** alpha 1 → 0 over 250 ms (linear), and back.

**Bottom toolbar** (list_bottom_toolbar: 0 disabled, 1 semi-transparent, 2 enabled):
- **What and where:** every non-empty list with a header shows the header's item again in
  scene_bottom_toolbar, 44 dp high (bottomToolbarZ 1.25 dp), right above the navbar. Its top is
  list bottom − reserved − size + how far the navbar moved down (its translation plus bottom margin),
  clamped to the list's bottom edge.
- **Fade-in:** with header buttons on, while one of the first three items is the first shown, it
  fades in and grows from 0.85 as the scroll passes the header, over 104 dp. Without header buttons it
  is always shown.
- **Semi-transparent:** alpha × 0.55.
- **Padding:** the rows' bottom padding grows by its size whenever the setting is on (om0.u0).

**Inferred:**
- The bottom toolbar's fade measure reads `w62.f0`'s first-item offset as the list's scroll from the
  content top.
- A zero-alpha toolbar takes no touches.

### F76 — Category levels, Albums by Artist, Folders Hierarchy — `CONFIRMED_STATIC`

(a) S1:
- **List classes:** `p31` (list class per entity type), `kc.f` / `he.a` (an entry opens
  `<category>/<id>/albums`), `u3` / `v3` / `r3` / `y62` (the second level and its −103 row),
  `ze1` / `eg1` / `hf1` / `le1` / `vj1` (the categories implementing `ah1`).
- **Albums by Artist:** `ue1` / `ve1` (the artist_albums table).
- **Folders Hierarchy:** `cg1` (a1, M, W), `h60` (FoldersAndFilesPage).
- **Header Play / Shuffle:** `sd.g0` / `sd.V` / `u3.V` / `u3.z`, `p31` (cmd_list_play → g0(0),
  cmd_list_shuffle → g0(4)), `pi1.toUri` / `qq0.S`, `m30` (root_hier_immediate `h`,
  hier_files_zoom `k0`), `b40` (hier_flat_shf `U`, hier_no_advance `W`, category_shuffle `Z1`),
  `strings` (all_*_songs).

(c) **Second level.**
- Artists, Album Artists, Genres, Composers and Years open an entry's albums.
- Under the header is an "All Artist / Album Artist / Genre / Composer / Year Songs" row
  (allTracksSubheadSize, scene_1, "N songs"), which opens the entry's songs. Then come the albums
  that hold the entry's songs, sorted like albums.
- Albums and Folders open their songs directly.

**Albums by Artist:** one row per album and track artist (unsplit), with album sorts. A row opens
that artist's songs on the album.

**Folders Hierarchy.**
- **Top level:** the root's folders; with root_hier_immediate, the first folder with tracks or
  several subfolders (8 levels at most).
- **A folder's rows:**
  - its subfolders: name, parent folder, and "files | duration" of the whole subtree;
  - then its files.
- **Zoom:** with hier_files_zoom, a folder with files only takes the Folders files zoom.
- **Playing a file:** plays the folder. The hierarchy's folders with files are the categories, in
  path order.

**Header Play** (shuffle off):
- **Category list:** the first entry, with the entries as categories.
- **Folders Hierarchy:** the folder, or its first folder with files. It also sets Play All
  Categories (repeat 2) unless hier_no_advance.

**Header Shuffle:**
- **Category list:** category_shuffle (4 songs and categories, 3 categories; Songs counts as 4 on a
  top level list). On an entry's albums, Songs shuffles all the entry's songs.
- **Folders Hierarchy, hier_flat_shf on:** every song of the subtree, shuffled.
- **Folders Hierarchy, hier_flat_shf off:** songs and categories, with the subtree's folders first.

**Also:**
- The track menu's Folders button opens the folder in Folders Hierarchy, with the levels above it on
  the back stack; with menu_nav_to_folders it opens the Folders list.
- The player takes the reference ids cmd_player_set_repeat_mode and cmd_player_set_shuffle_mode.

**Inferred:**
- Rows use the track item where the reference uses text items for category and top-level folder
  rows (as the other category lists here).
- Folder rows show the first track's art.
- With root_hier_immediate the walk follows the setting's text: the decompiled loop's exit when a
  level has several folders is garbled.

### F77 — CUE sheets — `CONFIRMED_STATIC` (settings) / `INF` (parsing and playback)

(a) S1:
- `library_misc` / `library_lists` XML: process_cues (default on), show_cue_source (default off).
- `strings`: "Virtual folders are created for CUE files with multiple tracks"; "Big undivided CUE
  disc image files will be visible in lists".
- `m30` (show_cue_source `f3171`); `df1` / `cg1` (cue_folder_id, num_all_files with
  show_cue_source).
- The native CUE parser and the pipeline's range playback are not in the bytecode.

(c) **Import.**
- A .cue sheet beside imported audio is parsed: FILE, TRACK, INDEX 01 (mm:ss:ff at 75 frames per
  second), TITLE / PERFORMER / SONGWRITER per sheet and track, REM GENRE / DATE.
- It is stored on the audio file it names (by name, else by base name).

**Library.**
- With process_cues, a file whose sheet lists several tracks shows as virtual tracks in a virtual
  folder named after the .cue file.
- Each track is a range of the image: from its INDEX 01 to the next track's, the last one to the end
  of the file.
- Track fields come from the sheet, falling back to the image's tags.
- The image itself shows only with show_cue_source.
- Virtual tracks keep their own plays, ratings and positions.

**Playback.**
- A virtual track plays its range of the image. Seeks, positions and crossfade timing are relative
  to the range.
- At the range's end, the next contiguous track of the same image goes on without reloading
  (gapless). Any other change stops the image first.

**Also:**
- WAV files now read their fmt / data chunks for the duration, LIST/INFO text and an embedded ID3
  chunk. They previously fell through to the MP3 frame scan.

**Waveforms** (inferred; the reference analyses natively): a virtual track's waveform is its range of
the image's peaks. The image is decoded once per session at 10 slices a second, then the range is
cut into the track's bars and normalised like a file's.

**Not covered:** the R2 library, whose index lists audio files only.

### F78 — GUI modals: the navbar sheet over the visualization — `CONFIRMED_STATIC`

(a) S1 `gx0` (the navbar posts cmd_gui_set_modal / cmd_gui_unset_modal with @id/navbar as its sheet
opens and closes), `t61` (modal popups as @id/popup_menu, item menus as @id/popup_menu_item), `i22` (the modal stack; `m2030`, the main scene choice; the unset path).

(c) **While a modal is up** (the navbar menu sheet, a modal popup, an item menu):
- The player screen leaves the visualization scenes for scene_playing (its full UI).
- A touch starts no temporary UI.

**When the last modal goes:**
- the player screen takes its own scene again (scene_vis_w_ui, scene_vis or scene_playing), or
- an open temporary UI restarts its timer.

**Before:** the temporary UI's timer returned the open sheet to scene_vis_w_ui. The navbar container
was then at the faded-controls alpha, and the transport showed through the sheet. A scene change
within the same navigation also closed the sheet; only a navigation change does now.

### F79 — Entry headers, back decor and category row meta — `CONFIRMED_STATIC` (fallback bytecode in part)

(a) S1 `c32` / `g32` (an entry's songs), `u3` (an entry's albums), `h60` (Folders Hierarchy), `kc` /
`b32` / `k60` (category lists), `pd.H0` / `pd.z0`, `md.o` (header item type at -2 / -10, back decor
at -5), `xc.mo1881` / `xc.e` (header and row binding), `hl0` (sizes), `h0.z` (the back decor takes
the header's frame), `BackDecorItemView`, layouts `item_track` (scene_header / scene_header_1),
`item_back_decor`, `item_text_back_decor`, `item_top_text_back_decor`, `item_no_title_back_decor`.
`g32.F0`, `u3.F0` and `h60.F0` are read from fallback bytecode (jadx mangles them).

(c) **Header item.** An entry's songs (album, artist, folder, genre, playlist, …), an entry's albums
and a Folders Hierarchy folder use the track item (`_item_type_track`) as their header; category
lists, the hierarchy's top level and the home keep the text header.
- **scene_header:** the entry's art fills the header; the title, line 2 and the meta (with its icon)
  sit at its foot over the header buttons.
- **scene_header_1** (title, no line 2) when the parent category is a `tg1` one: artists, album
  artists, genres, composers, years, playlists.

**Height** (plus the top inset; Compact Header = `xh1.W0`):

| List | Height | Compact |
| --- | --- | --- |
| artist, album artist, composer songs (`gh1`: `df1`, `qe1`, `kf1`; under a `tg1` category) | humanCatHeaderSize (at most the width) | compactHumanCatHeaderSize |
| album songs of album artists and composers (`pe1`, `jf1`) | humanCatHeaderSize | compactHeaderSize |
| other songs lists (albums, folders, genres, years, playlists, Albums by Artist) | headerSize | compactHeaderSize |
| an entry's albums (`u3`) | headerSize; years (`ug1`) humanCatHeaderSize | compactHeaderSize; years compactHumanCatHeaderSize |
| Folders Hierarchy folder (`h60`, not the top level) | headerSize | compactHeaderSize |
| category lists (`kc`), hierarchy top level | textHeaderSize | compactTextHeaderSize (never offered) |

**Header content** (the category entry's row, `pd.z0`): title the entry's name; line 2 its `C0`
(an album's artist, a folder's parent); meta its `m0` "files | duration" (albums add " | year";
playlists pad the bar with two spaces); meta icon `meta_songs_12dp`, or the folder's / playlist's
List Memory flags (F46).

**Category rows** (`xc.e`): the same line 2 and meta. Previously line 2 showed the song count.

**Back decor** (`sd.c()`; `BackDecorItemView`): an up-nav title ("‹ Parent", `cmd_list_up_nav`)
laid over the header in scene_header_back_decor, with the header's frame and alpha, above it.
- Its text is `pd.H0`: the parent entity's name (Library above a category; Artists above "All Artist
  Songs"), or in a second level the parent entry's (the artist above one of their albums).
- Layouts: song lists `item_back_decor`; an entry's albums `item_text_back_decor`; category lists
  `item_top_text_back_decor`; a hierarchy folder `item_back_decor` with the parent folder's name, or
  `item_text_back_decor` under the top level. Search shows none here (`item_no_title_back_decor`).
- `disableForStateId` selection mode: disabled, and invisible (disabledAlpha 0).

The header art's stretch on overscroll is F80. Artist images (the reference's `CatImage` and artist art) are
not available; headers and rows show the first track's art.

(f) `sources.js` (`entryHeader`, `groupMeta`, `groupLine2`, `metaIconOf`), `power-list.js`
(`placeBackDecor`), `list-widget.js` (`backTitleFor`, `setMetaIcon`, `cmd_list_up_nav`),
`library/list-memory.js`, `list-opts.js`, `html-text.js` (`html_2`; glyph boxes through the CSSOM,
which `style-src 'self'` allows).

### F80 — Library list overscroll — `CONFIRMED_STATIC` / `INFERRED` in part

(a) S1 `hc` (PowerScroller: `C` drag, `mo1890` damping, `mo1886` release, `A` / `mo1887` spring
back, `m1889` overshoot, the `fc` runnables), `dh0` (spring), `eh0` (fling and the linear
overshoot), `h0` (`P` = 44 dp, `g` = 30 dp, the spread loop, `mo986` overscroll, `z` header
stretch), `v62.v` / `w62.v` (row scaleY and offset), `AAImageView.E` / `onDraw`, `hj0` / `tb`
(edge glow), `PowerList.draw` / `K` / `mo617` / `mo616`, `wa1.h0` (`android:colorEdgeEffect`),
`kw0` (drag reorder sets `P` to 0).

(c) **Drag past an end.** The content moves on past the end by a rubber band: (P / 4)·ln(1 + C / P)
for C px of finger travel beyond the end, P = 44 dp. Moving back towards the list undoes the
overscroll 1:1, then scrolls. Lists inside a dialog frame hand that drag to the frame instead (F58),
and a drag reorder has none.

**Release.** An overscrolled list does not fling; it springs back over max(0.5 s, |o| / 1500 px/s)
along the fling curve (0.103, 0.389, 0.307, 0.966), ending within half a pixel.

**Fling into an end.** The remaining velocity v overshoots past the end, decelerating linearly over
|v| / 10⁶ s (about v² / 2·10⁶ px), then springs back.

**While overscrolled** (pulled past the top, or pushed past the end of a list that scrolls), the
shown rows spread. The k-th of n rows moves by (k / n)·(o / P)·30 dp and is scaled vertically by
1 ± (k / n)·|o / P|·0.04 (larger at the top, smaller at the end). A track header's art reaches up
over the gap: its rect grows by o and the image moves up by o / 2. The moveable toolbar reads
past-top / past-end.

**Edge glow** (`hj0`, the platform's pre-12 EdgeEffect): pulls, releases and absorbs (v / 5) at the
end. Its colour is `android:colorEdgeEffect`, transparent in the default themes, so it shows only in
themes that set one.

**Inferred:**
- The rubber band reads `hc.mo1890` as a target: its decompiled register use is ambiguous.
- Row scale pivots on the row's centre.
- An image's area above its bitmap stays the placeholder colour (the shader clamps there).

Also fixed: a header image taller than its rect (a square cover in the wide header) was squashed;
it is now cropped and centred, as `AAImageView` does.

(f) `power-list.js` (`dragBy`, `spreadFor`, `springBack`, `overshoot`, the glow), `edge-glow.js`,
`list-widget.js` (`AAImageView.setStretch`, crop), `gesture.js` (`FLING_CURVE`).

### F81 — EQ preset song and category assignment — `CONFIRMED_STATIC` (storage, dialogs) / `INFERRED` (playback switch)

(a) S1:
- `merge_eq_preset_assign`, `EqPresetsBehavior` (rows; `__bind_to_track`, `__bind_to_cat`,
  `__bound_cat_uri`).
- `EqPresetAssignActivity` (OK / Cancel / Unassign: `__unbind_from_all_track_ids`,
  `__unbind_from_all_devices`).
- `qf1` (`REPLACE INTO eq_preset_songs` per file; a category binds each of its files).
- `EqPresetPopupListLayout` (`cmd_list_preset_assign_dialog` for one selected preset).
- `m10.o` (`item_eq_preset_3line` for a bound preset).
- `mf1` (the Assigned filter).
- `s` (`DSPIPresetState`, the loaded preset's reason: `pre_song` for a song preset).

(c) **Storage.** The reference stores song bindings only (`eq_preset_songs`: file → preset).
Binding a category binds every song it holds at that moment.

**Dialogs.** Save/Assign and Assign Preset show `merge_eq_preset_assign`.
- Its output devices (speaker, wired, Bluetooth, USB, Chromecast, other) are hidden: a web page
  cannot tell its outputs apart.
- "Apply to songs" shows:
  - "Song: <title>", checked when the playing song is bound to the preset;
  - its category, by the category's singular name (Album, Artist, Folder, …) with its micro icon.
    It is hidden for lists that are not a category entry.
- Save applies the boxes to the saved preset; OK applies them to the selected one.
- Unassign removes the preset from every song.
- The preset list's selection menu offers Assign for one preset.

**Preset list.** A preset bound to the playing song shows the 3-line row with its song icon. The
Assigned filter keeps the presets bound to the playing song (no device bindings exist here).

**Playback** (inferred; the switch is in the native preset state):
- When a bound song starts, its preset loads.
- The next song without one returns to the preset (or unsaved EQ) that was on before.
- A preset the user picks becomes that fallback.

(f) `dsp/eq-presets.js` (`presetForTrack`, `assignTracks`, `unassignAll`, `onTrack`),
`widgets/eq-preset-ui.js` (`setupAssign`, `openAssignPresetDialog`), `widgets/popup.js`.

### F82 — Parametric equalizer — `CONFIRMED_STATIC` (model, UI, presets) / `INFERRED` (filter maths, tall item layout)

(a) S1:
- Model and controller: `Band`, `pr` / `or` (band array, add `or.P`, reorder `or.m2758`),
  `u21` (`cmd_dsp_*` handling: add, delete by serial, reorder, lock, set gain / freq / Q / type /
  channels / colour), `s.a` / `pr.m2840` (preset load), `qr` (binary blob), `u31.r` / `u31.s`
  (JSON), `qf1.V0` / `U0` (import and its toasts), `qq0.T` and `kn` (built-in presets).
- UI: `EqKnobsList` (selection, lock toast `o0`, controls `z`, item width `p0`), `C0049`
  (adapter: preamp, `_param` items, `_controls` / `_empty_controls`), `c10` (band item),
  `h10` (item background), `g10` + `ColorCircleSelector` (colour popup), `fp1` (type and
  channel popups), `nr` / `zr` (knob scales), `KnobLabelAndValue`, `np` (colour cursor),
  `FrequencyResponseScroller` (parametric drawing and touch).
- Resources: the `EqParam*` and `EqListControls*` styles, `merge_selection_menu_eq_knobs`,
  `merge_eq_param_colors`, `eq_param_type_modes` / `eq_param_lr_modes` and their icon arrays,
  `EqParamColorSet_Default`.

(c) **Mode.** There is no mode setting: the EQ is parametric when its bands are (the loaded preset
decides). A graphic preset drops the parametric bands; a parametric preset replaces the bands.
Reset zeroes gains and preamp and keeps the bands.

**Bands.** Type 0 Low Pass, 1 High Pass, 2 Band Pass, 3 Peaking Band, 4 Low Shelf, 5 High Shelf;
channels L+R / Left / Right; frequency an integer 1..24000 Hz; Q 0.1..12; gain ±15 dB; colour;
lock. At most 64.
- Add Band: the first is a Band Pass at 31 Hz, Q 1.5; each next one takes the last band's type
  and Q at twice its frequency (at most 20 kHz). Its colour comes from a cursor walking the
  palette down each column (first "none"), kept in memory only.
- A locked band disables its type and channel popups; its knobs ignore touches and are not
  clickable, so a tap reaches the band and shows "Band is locked" (with the Lock hint). Colour,
  Select, the lock box, delete and reorder still work.

**List.** The preamp, one item per band, then the controls item: Add Band, Select and, in the
first 7 days after the first run, "Long press value to edit"; with no bands, Add Band alone.
Every item has the first band item's width, measured unconstrained at the list height (`p0`).
Adding a band scrolls it into view with 200 sp of slack (less 20 %).

**Band item.** From its styles: the gain slider, two column guides, Select, colour, lock, the
channel and type popups, the Q and Freq knobs with their labels, the select box and the drag
handle (both shown only in selection mode).
- Freq scale (`nr`): 20–199, 200–994, 1000–7950 and 8000–24000 Hz over the four quarters,
  snapping to 5 / 50 / 100 Hz in the upper quarters while dragged; labels "440", "2.50K",
  "12.0K". Q scale (`zr`): 0.1..12 through 1.5 at the middle, "%.2f".
- A long press on a label opens the value dialog (title Frequency / Q / Gain, the volume-jump
  warning).
- Background (`h10`): the band colour as a rounded fill (2 dp left inset, 28 dp corners), else a
  dotted separator except after the last band. A colour pick fades in CIE Lab over 250 ms.

**Colour popup.** The palette rows (split at 0 entries) as circles, the current one ringed;
touch-down and every move pick live; the popup stays open (the selector takes the touch stream,
so no click reaches the popup).

**Selection mode** (Select, or a band's Select button with that band): the selection menu with
Delete (confirmed; locked bands too) and Lock/unlock (the opposite of the first selected band's
lock, for all). The drag handle reorders bands. Tapping the controls item ends it.

**Curve.** Each band is its own filled lobe between its response and 0 dB, not summed; ±15 dB
fills the half height; colours are the band colour at twice its HSV saturation and value (fill
alpha 0.5). The FRS is the list's scrollbar: a drag scrolls proportionally; a touch outside the
window glides there over 350 ms (decelerate 2), the outer tenths clamping to the ends.

**Presets.** The six built-in parametric presets and the three graphic tone presets are listed.
JSON keeps the reference order (`name`, `preamp`, `parametric`, `bands`; tone bands first; signed
ARGB colours). Import reports "Imported parametric presets: n" (else graphic), with the name for
one preset. A taken name gets " (n)".

**AutoEq text** (`cy0.G` / `J` / `I`): a file whose first 100 lines hold "Preamp: X dB" and
"Filter n: ON <type> Fc <Hz> Hz Gain <dB> dB Q <q>" lines imports as a parametric preset (up to
64 bands, coloured by the colour cursor; PK / PEQ / Modal peaking, LS / LSC and HS / HSC shelves,
LP / LPQ, HP / HPQ, BP). A "GraphicEQ: <Hz> <dB>; …" line with at least 5 rising points imports
as a graphic preset, each gain taken as (dB + 6) / 15. The graphic points are sampled onto the
EQ's bands like any graphic preset (the reference rebuilds a band layout from the points; here the
band count stays the user's).

**Default presets** (`qq0.m2923`, `m10.h` / `o`): each mode has a user preset named Graphic or
Parametric with no data; loading it resets the EQ to that mode (Parametric: no bands). Their rows
are 2-line with "Default Preset".

**Import AutoEq Presets** (`_import_autoeq`; `pq1`, `ma`): a notice ("Import presets from a zip
file …" and "The imported presets will overwrite …") with Select File, then every
"<name> ParametricEQ.txt" / "<name> GraphicEQ.txt" of the zip (at most 64 KB each) becomes an
AutoEq preset: bands locked, a parametric preset's preamp 0 dB, the source taken from the two
folders above the file's own (underscores as spaces, first letter capitalised) and shown as the
row's second line. A preset with the same name and source is replaced. The result is "Done" with
"Imported presets: n". The presets show under the AutoEq filter.

(e) **Inferred.**
- The filter maths is native (`Coefs`). Peaking and the shelves are RBJ biquads with a Q. Low,
  High and Band Pass carry gains in the reference presets and tone bands, so they are boost/cut
  filters here: x + (g − 1)·F(x), F the RBJ pass filter. At a high Q this dips just past the
  corner.
- The curve's frequency axis is taken as log 20 Hz..24 kHz.
- The tall item variant (screen height ≥ 700 dp) read literally gives the Q knob no height: Freq,
  attached to both parent edges, exceeds its maximum height, keeps only its top attach and sits
  at the top, where Q also starts. It is laid out by intent (as F32): Q under the popups, Freq at
  the bottom beside the tool column, labels inside each knob's bottom padding.
- The empty EQ's Add Band item takes the rest of the list width.
- The select box and drag handle fade in over 150 ms.

**Not built:** the per-device AutoEq suggestions (`suggest_autoeq`: outputs not identifiable),
the binary preset blob (presets are stored as JSON here), and haptics.

(f) `dsp/param-eq.js`, `dsp/dsp.js` (parametric model, commands, graph), `dsp/eq-presets.js`,
`widgets/eq-param.js`, `EqKnobsList` and `FrequencyResponseScroller` in `widgets/eq.js`,
`widgets/eq-preset-ui.js` (import toast), `icons.js` (type, channel and unlock glyphs),
`tests/claude-player-param-eq.test.mjs`.

### F83 — App drawable states and wrap measuring under an unlimited parent — `CONFIRMED_STATIC`

(a) S1: `h30` / `i30` (extra drawable states pushed down a view tree), `x82.mo651`
(`state_locked`), `LimiterDSPCheckBox` (`state_limiting`), `yv0.m3714`
(`state_toolbar_in_header`), `FastLayout.onMeasure` / `g1` (child specs).

(c) **States.** Selectors use the app's own states as well as the platform's: `w:state_locked`,
`w:state_limiting`, `w:state_toolbar_in_header`. They were read as unconditional items, so:
- every enabled EQ knob thumb drew its locked look (the disabled stroke), never the normal or
  pressed one;
- the Limit button always drew its limiting look;
- the navbar's lists icon was always filled.

Now:
- locked bands set `state_locked` on their knobs;
- the Limit button samples the limiter every 100 ms while playing and shows `state_limiting`
  while its gain is under 0.9995 (here the compressor's gain reduction);
- the moveable toolbar pushes `state_toolbar_in_header` down the navbar while the library list
  shows its first item (`extraStates`).

**Measuring.** A FastLayout measured without a width (or height) limit measures its wrap_content
children without one too (`onMeasure` mode 0). A plain view then takes no space instead of the
huge limit.

(f) `view/drawables.js`, `res/resources.js`, `view/view.js` (`setExtraState`, `stateKey`),
`LimiterDSPCheckBox` in `widgets/eq.js`, `list/moveable-toolbar.js`, `list/power-list.js`
(`scrollState().first`), `view/fast-layout.js`.

### F84 — Colour and text preferences — `CONFIRMED_STATIC` / `INFERRED` in part

(a) S1 `ColorPreference`, `preference_color`, `AmbilwarnaLayout` / `ambilwarna_layout`
(`AmbilWarnaKotak`, `ambilwarna_hueWidth` 36 dp, `ambilwarna_spacer` 16 dp), `EditTextPreference`
rows (`lyrics_custom_url`).

(c) **Colour** (`aa_bg_gradient_color`):
- The row shows "#RRGGBB" and a 60 × 30 dp swatch under its text.
- A click opens the picker with no title: a saturation / value square 280 dp high, the hue bar on
  its right (hue 0 at the bottom, 360 at the top) with its cursor, the target ring, then the new
  colour (60 × 30 dp) beside its six hex digits. Typing six valid digits sets the colour.
- OK stores "#AARRGGBB|@0" (the reference's form; `@<attr>` names a theme colour picked from the
  system palette circles).

**Text:** a one-line entry dialog (title, OK / Cancel).

(e) **Inferred:** the swatch corner rounding (the outline provider's radius is not read). **No web
counterpart:** the Android 12 system palette circles (`merge_widget_mu_colors`).

(f) `settings/settings.js` (`pickColor`, `editText`, `colorPrefValue`), `app.css` (`.cps-amb*`),
`widgets/milk.js` (reads the colour part).

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
| F11 skin options | Built | Every option rendered and checked in a sweep (F11); looks not compared with reference screenshots. Follow Day/Night is built (F56). Material You has no seed-colour substitute. |
| F12 window buckets | Built | — |
| F13 waveseek | Built | Native analysis `OPEN` |
| F14 gesture inventory | Built | Built: art ←/→, ↓ (source list), ↑ (lyrics), tap and "swipe more" (category, F52); the navbar tap, ←/→, long press and category overscroll; the library parent swipe; line 2 tap and long press; pinch-to-zoom (F53); meta-info tap cycling (F51); search-chip toggle and long press (F55); rating taps, swipes and long press (F57); dialog drag (F58); drag reorder and multi-select drag (F59); the navbar sheet drag (F60). the lyrics button long press (lyrics dialog, F61); the long press between the sub-art buttons (editing, F62). The help's visualization ←/→ preset swipe (`h_vis_swipe`) is anchored to `vis_panel_frame`: it is the vis panel pager, which is built, and no UI class sends `cmd_player_load_next/prev_milk_preset`. |
| F15 thresholds and physics | Built | VelocityTracker reproduced in form only |
| F16 navbar | Built | — |
| F17 settings corpus | Built (screens) | Per-key implementation statuses not recorded |
| F18 list transitions | Built | The F48 zoom transitions with the shared item hand-off, the header-to-item and item-to-header morphs (F54) and the pinch zoom transitions (F53) |
| F19 typography | Built | — |
| F20 audio | Built (web subset) | Native engine `UW` |
| F21 visualization | Built (butterchurn) | — |
| F22 AutoEQ | Partial | The bundled database is `UW` within the budget; the AutoEq project zip and text files import (F82) |
| F23 art background | Built | Blur kernel approximated |
| F24 renderer bench | N/A | — |
| F25 hosting | N/A | — |
| F26 art geometry | Built | Tilt signs `OPEN` |
| F27 player states | Built | — |
| F28 waveseek drawing | Built | — |
| F29 sub-art buttons | Built | Editing is F62 |
| F30 backdrop | Built (approximation) | — |
| F31 elapsed/duration | Partial | Placement `OPEN` |
| F32 knob stacks | Partial | Laid out by intent |
| F33 equalizer | Partial | Presets per F67, song assignment per F81, parametric mode and AutoEq import per F82; platform FX, the bundled AutoEq database and device assignment not built |
| F34 popups | Built | Curve inferred |
| F35 marquee | Built | — |
| F36 sleep timer | Built | — |
| F37 vis modes | Built | — |
| F38 list scroller | Built | — |
| F39 selection | Built | Multi-select drag built (F59). Delete files skipped (owner decision). |
| F40 lyrics | Built | Page geometry inferred. Lyrics dialog built (F61); provider apps not built. |
| F41 vis panel | Built | — |
| F42 ratings/stats | Built | Rating swipes built (F57) |
| F43 dialogs | Built | Drag to dismiss with the list overscroll handoff (F58) |
| F44 playlists | Built | Drag reordering (F59); re-sort, import and export (F66) |
| F45 info / album art | Built | Tag editing skipped (owner decision) |
| F46 list options | Built | List Memory built; its settings export not built |
| F47 waveform data | Built | — |
| F48 list page transitions | Built | Pair times per navigation and the lyrics swipe pivot side inferred (F48 (e)) |
| F49 line 2 / menu actions | Built | Delete is a no-op (owner decision). The lyrics button long press opens the lyrics dialog (F61). |
| F50 unbuilt gestures | `UW` | Predictive back has no browser counterpart (the system back arrives as a plain history step); sub-art button editing is F62 |
| F59 drag reorder | Built | Release mid-slide and the grid path inferred or untested |
| F60 navbar sheet drag | Built | — |
| F61 lyrics dialog | Built | The share sheet substitutes the search chooser; provider apps not built |
| F62 sub-art button editing | Built | Cast, delete, tag editing and bookmark buttons left out; no routed device icon |
| F51 meta info | Built | Output line substituted; first-press toast persistence inferred |
| F52 category navigation | Built | — |
| F53 pinch-to-zoom | Built | — |
| F54 item/header morphs | Built | — |
| F55 search chips | Built | Categories, subheaders and history per F64 |
| F56 Follow Day/Night | Built | Night mode from `prefers-color-scheme` |
| F57 star rating bar | Built | — |
| F58 dialog drag | Built | — |
| F63 library list preferences / List Options | Built | — |
| F65 queue | Built | Shuffled order inferred |
| F66 playlist re-sort / files | Built | Import picks files (web) |
| F67 EQ presets | Partial | Song / category assignment built (F81), parametric, default and AutoEq presets (F82); device assignment not built |
| F68 EQ knob values, Tone / band settings, settings rows | Built | Band frequencies for non-ISO counts and resampling inferred; dsp_border_gain native |
| F69 Reverb presets | Built | Parameter 8 kept at 1.0 without a knob |
| F70 Fades and crossfades | Built | Curves and the gapless-pair test inferred (native pipeline) |
| F71 ReplayGain | Built | Gain rules follow the standard (native player) |
| F72 Shuffle modes and options | Built | — |
| F73 Library playback options, pro button morph | Built | — |
| F74 About: version and licenses | Built | — |
| F75 Navbar scroll-away and the bottom toolbar | Built | The bottom toolbar fades with the leaving page in level transitions (`w62.j` fades it by the transition fraction) |
| F76 Category levels, Albums by Artist, Folders Hierarchy | Built | Text-item rows for categories (track items here) |
| F77 CUE sheets | Built | R2 index (audio files only); virtual track waveforms sliced from the image (inferred) |
| F78 GUI modals (navbar sheet, popups, item menus) | Built | — |
| F81 EQ preset song and category assignment | Built | Devices hidden (outputs not identifiable); the playback switch-back inferred |
| F79 Entry headers, back decor, category row meta | Built | No artist images |
| F80 Library list overscroll | Built | Rubber band reading of `mo1890` and the row scale pivot inferred; glow only where the theme colours it |
| F82 Parametric equalizer | Built | Filter maths and curve axis inferred (native); tall item layout by intent; AutoEq text files and the AutoEq project zip import; per-device suggestions not built |
| F83 App drawable states, unlimited wrap measuring | Built | — |
| F84 Colour and text preferences | Built | System palette circles have no web counterpart |
| F64 search | Built | Zoom levels and targeted search built; no Streams (owner decision); deeper lists' target labels inferred |

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
