# Rendering reference — Poweramp build 1031

All findings are static unless explicitly labeled otherwise. No native screenshot was available. `decoded/` refers to the Apktool 2.11.1 output of the verified APK; `jadx/sources/` to JADX 1.5.3 output with renaming and method inlining disabled. These paths identify private scratch evidence, not published copies of APK material. Evidence IDs below are in `08-EVIDENCE-LEDGER.jsonl` after consolidation.

## Composition and rendering ownership

The player is not one background image with conventional Android widgets layered on it. Its visible surfaces have separate renderers and update lifecycles:

| Surface | Native rendering owner | Evidence and significance |
|---|---|---|
| Art-derived backdrop and visualization | `MilkWidget`, an Android `SurfaceView`; `MilkRenderer` and `MilkLoader`; OpenGL ES in `libpowerampcore.so` | `activity_main.xml` places `milk` before the list. `MilkWidget` constructor creates a renderer; it does not blur the foreground View. Surface composition needs native observation. |
| Main artwork and reused list artwork | `AAImageView`, custom `View` | BitmapShader, an explicit scale matrix, and Canvas rectangle/rounded-rectangle drawing; not a stock `ImageView`. |
| Main artwork container, labels, rating and art menu | `AAItemView` / PowerList item hierarchy | The foreground art is a child in `item_track.xml`; scene parameters alter these same components. See UI atlas and motion report. |
| Title and subtitle | `com.maxmpz.audioplayer.widget.MarqueeFastTextView` → `im` → base `MarqueeFastTextView` → `FastTextView` | Custom measured text buffers, Canvas text drawing, per-line background drawables, and custom marquee. |
| Waveform | `Waveseek` → obfuscated `m92` | Custom Canvas bitmap bar drawing; it consumes a waveform array and a playback/seek fraction. |
| Transport and sub-art controls | `BusActionButton` / `FastButton` family, bitmap/vector/shape/ripple resources | Graphics and action behavior are separate. A generic Material play button is not authoritative. |
| Navbar | `Navbar` → `gx0` → `FastLayout` | Shape drawable background; custom scene interpolation can crossfade old/new background drawables; icon tint and icon shape selectors are separate. |

Logical drawing order from resources is backdrop, shared PowerList art/item content, independent player controls, navbar/menus/toasts and system-bar helper Views. This is a composition map, **not a measured GPU layer order**: `SurfaceView`, elevation and Android compositor behavior require runtime confirmation. [PA1031-RENDER-001]

## Foreground artwork: sampling, clipping and replacement

`AAImageView` owns two Paints, the current and previous bitmap references, shader matrices and three scene/type-specific radius slots. The current bitmap is installed in a `BitmapShader` with MIRROR tiling. Paint enables anti-aliasing and bitmap filtering. `onDraw()` uses `drawRect` for radius zero or `drawRoundRect` otherwise. Radius `-1` means half the view height. The current draw rectangle is the scaled image rectangle, not automatically the entire View. `onLayout` refreshes matrix/bounds and the outline. This establishes the rendering primitive; effective corner values are the theme/scene values in the UI atlas. [PA1031-RENDER-002]

An important trap: Android-like scale-type names do not imply standard Android scale-type behavior here. The registered default `aa_aspect=1` code path applies `OptionAAKeepAspect`, which assigns `fitCenter`; `AAImageView.К` implements that case itself:

- Let the source bitmap be `Bw × Bh` in source pixels and target View be `W × H` in resolved Android pixels.
- If `Bw + 16 < Bh`, use the centered fit-to-box matrix, retaining the mapped image rectangle.
- Otherwise use `s = W/Bw`, source displayed height `h = Bh*s`, draw height `min(h,H)`, draw rectangle `[0,(H-min(h,H))/2,W,(H+min(h,H))/2]`, and shader vertical translation `(H-h)/2`.
- Thus a near-square or wide source is width-fitted, with possible vertical clipping; a clearly portrait source follows centered fit-to-box. The `16` is a source-pixel comparison, not 16dp.

This special branch is confirmed in smali (`AAImageView.smali`, method `К`, lines 882–1050, `:pswitch_0`, `:cond_1`). Do not replace the entire rule with a generic `contain` property. The center-crop and `centerCropXY` alternatives have their own branches; all source aspect ratios should be captured before certifying crop parity. [PA1031-RENDER-003]

Bitmap replacement is also separate from moving to another track. `AAImageView.Х(Bitmap,bh,int)` refuses an identical bitmap, releases/cancels an older retained reference, and either replaces immediately or begins a local fade:

- On API below 28, any nonzero replacement animation mode is coerced to mode 3, a whole-view alpha fade.
- On API 28+, modes other than 3 can retain the prior shader/rectangle/filter in Paint `h`, install the new image in Paint `c`, and fade the new Paint from alpha 0.
- The `К` animator is created with a null interpolator; `h5` advances from Choreographer timestamps. This local fade asks for 200ms, or 300ms when the scene flag `z` is true. These are **code durations for this image-load path**, not observed track-change durations.
- In `К.P` the new alpha is set before its alpha is read for the old-alpha delta. Smali confirms this ordering. For normal in-range values the retained old Paint is not independently reduced by `1-p`; the new bitmap is composited over it, then the retained bitmap is released at completion. Avoid inventing a symmetric two-layer alpha animation.

`bh` references are acquired/released through the artwork provider (`j`/`i`) and `AAImageView.y()/у()`. The exact memory/disk cache eviction policy and decode size chosen for every scene were not exhaustively reconstructed. [PA1031-RENDER-004]

## Backdrop: recovered Java, shader and native path

### Settings and preprocessing

The actual settings path matters more than the similarly named XML declarations. `TopMilk` declares blur scale 32, level 5, saturation 1.5 and intensity 1.0, but `MilkWidget.Х()` applies runtime preferences directly to its `MilkLoader`. For a fresh preference set, `c40` registers:

| Key | Registered default | Applied behavior |
|---|---:|---|
| `aa_blur_enabled` | true | Enables art-backdrop path via ListWidget controller |
| `aa_blur` | 5 | Loader blur level; native blur-pass count clamped 0–15 |
| `aa_blur_scale` | 5 | Bitmap preprocessing size `1 << value` below 10, otherwise `Integer.MAX_VALUE`; default 32 |
| `aa_blur_saturation` | 150 | Divide by 100, multiply by theme `aaBlurSaturationMult` (constructor default 1) |
| `aa_blur_intensity` | 100 | Divide by 100, multiply by theme `aaBlurIntensityMult` (constructor default 1) |
| `aa_bg_gradient` | 4 | Clamp to 0–10 and apply preprocessing gradient when applicable |
| `aa_bg_gradient_color` | `#FF000000` | Gradient endpoint color; RGB parsed separately from input alpha |
| `aa_bg_gradient_for_list` | true | AND with theme `aaAllowBgGradientForList` |
| `list_aa_blur_enabled`, `lyrics_aa_blur_enabled` | true | Scene-specific enable flags, not proof of the owner's selections |

`MilkWidget` constructor reads `aaEffectReadable` and `aaEffectList` into separate `f0` effect entries. A selected entry can replace the ordinary size, saturation, intensity, pin-light, lighten and darken values. The built-in black-list effect, for example, declares size 4, saturation 1.75, intensity .125, darken .175 and pin-light .17; the white-list effect differs substantially. Consequently, a library background is not simply the full-player background with one universal opacity. The Java `MilkLoader.A` decompilation is malformed; its smali was followed through `:goto_1`, `:cond_5`, `:cond_7`, `:cond_c`, `:goto_8`, `:cond_13` to establish option lookup, preprocessing and native invocation. [PA1031-RENDER-005, PA1031-RENDER-006]

`MilkLoader.A` obtains the bitmap reference, applies the chosen effect if present, optionally creates a palette-derived solid-color bitmap, converts hardware bitmaps to ARGB_8888 where needed, downscales when larger than the configured size, applies gradient, then calls `native_load_aa`. Downsampling filtering is enabled when blur level is zero and disabled otherwise. The solid-color branch is selected when a `g0` effect exists, an explicit solid-color target exists, or ordinary scale size equals 1. It creates a 32×32 solid-color bitmap after palette selection. The palette scoring and all fallback color branches remain a secondary open trace rather than a certified visual algorithm. [PA1031-RENDER-006]

Gradient preprocessing is recoverable. Normalize selected gradient amount `a` to `g=a/10`; its middle stop is `0.75 - 0.65g`, final stop `1 - 0.15g`. A vertical three-stop gradient starts transparent, remains transparent through the middle stop, then reaches the endpoint color. For default `a=4`, stops are `[0,.49,.94]`. Black RGB has endpoint alpha 255; nonblack endpoint alpha is rounded interpolation from 170 to 255 as amount increases. The 1024-unit shader matrix is mapped to actual bitmap size. This is drawn **into the bitmap before native blur/color processing**, not a proven independent final-screen CSS gradient. List gradient is skipped only for the list effect when its allow flag is false. [PA1031-RENDER-007]

### Narrow native investigation and shader math

Native UI work was justified by the Java JNI boundary; no DSP or license logic was altered. Inspection used ELF relocations with pyelftools 0.32 and ARM64 disassembly with Capstone 5.0.6, installed into private scratch. No binary was executed, patched or re-signed. Reproduction helper: `scripts/native_ui_evidence.py`; its default output records JNI mapping, file offsets and ELF load segments in `logs/native-ui-mapping.json`. This analysis applies to the `arm64-v8a` library with SHA-256 `c22a29d4e71723b1f7e8cb5dc6cd7e461aa5133b65e73ca4115928fa980f9d9e`; addresses are ELF virtual addresses, not process addresses. Tool acquisition and verification are recorded in `logs/native-python-provenance.json` and `logs/native-python-install.log`. Official package version pages are https://pypi.org/project/pyelftools/0.32/ and https://pypi.org/project/capstone/5.0.6/.

In `decoded/lib/arm64-v8a/libpowerampcore.so`, registration references identify:

| JNI method | Method-table field / relocated target |
|---|---|
| `MilkLoader.native_load_aa` | name pointer at VA `0x4662f8`, signature pointer `0x466300`, function pointer `0x466308` → `0x139f00` |
| `MilkRenderer.native_render_frame` | name `0x466c00`, function `0x466c10` → `0x1482dc` |
| `MilkRenderer.native_set_aa` | name `0x466cc0`, function `0x466cd0` → `0x148650` |
| `MilkRenderer.native_commit_aa` | name `0x466cf0`, function `0x466d00` → `0x148744` |

The loader's registration routine at `0x1397f0` passes the class string `com/maxmpz/milk/MilkLoader` and five JNI methods to registration. The native load entry gets/locks/unlocks Android bitmap pixels, then reaches `0x139530` → `0x13eed8` → `0x13f030` → blur-pass helper `0x13f3e0`. The latter clamps the blur level to 0–15 and performs an initial texture pass plus the requested number of ping-pong iterations. For positive counts the final iteration selects the color-processing shader; for zero the initial pass does. This proves **blur 5 is not a 5px Gaussian blur radius**. [PA1031-RENDER-008]

Two shader resources are present and the disassembled initialization at `0x13f100` references them: `assets/milk/shaders/blur_vs.glsl` and `blur_aa_fs.glsl`. In original mathematical notation:

1. Sample four diagonal texture coordinates `(u±p,v±p)`; sum them.
2. On the final color pass, multiply RGB by `intensity/4`. The `/4` is corroborated by native `0x13f308–0x13f310`; ordinary blur passes use `.25`.
3. Compute grayscale intensity as `0.2125R + 0.7154G + 0.0721B` and interpolate grayscale→RGB with the saturation parameter. Values above 1 increase saturation; this is not an HSV saturation operation.
4. Optional pin-light/lighten/darken processing follows; final alpha is forced to 1.

Native uniform-name lookup at `0x13f1c0–0x13f220` establishes `u_saturation`, `u_apply_light`, `u_pin_light`, `u_lighten`, `u_darken`; native `0x13f2dc` supplies their values. GLSL precision is mediump for the shader, with lowp color accumulation. Exact GPU rounding, texture-coordinate boundary behavior, hardware driver color output and compositor output remain unobserved. For this ELF, code VAs cited here equal file offsets; JNI method-table fields in the second PT_LOAD segment map to file offset `VA−0x4000`. Native offset scheduling includes alternating additional offsets; do not convert the algorithm to a single blur radius without a numerical rendering experiment. [PA1031-RENDER-009]

### Backdrop update and interruption endpoint

The Java rendering call chain is:

```text
scene/art controller → MilkWidget.A(...)
  → MilkRenderer.c(reference, directionFlag, effectMode, duration)
  → remove queued loader messages of matching type 4/5; queue latest
  → jv0.handleMessage → MilkLoader.A → native_load_aa
  → renderer message 14/15 or direct same-thread dispatch
  → MilkRenderer.Р → native_set_aa
```

`MilkRenderer.Р` supplies duration 0 unless either renderer resume flag `у` or active native frame-loop flag `К` is true. Until the native context exists, it stores the pending reference and parameters. The manually supplied art ratio takes a separate message 17 route to `native_set_aa_ratio`; commit takes message 18 to `native_commit_aa`. ARM64 `0x15c40c` clamps the ratio to `[0,1]`; `0x15c42c` can toggle the retained slots and replace ratio by `1-ratio` when its first argument is nonzero. Flags govern retained-slot cleanup. This is evidence of an explicit native progress/commit mechanism, **not sufficient evidence of every top-level interruption policy**. The scene report supplies those callers. [PA1031-RENDER-010]

## Waveform: a sampled waveform strip, not a live spectrum

### Effective variants

`poweramp_builtin_skins.xml` sets `seekbar` default to the empty/default overlap for both built-in skins. Therefore the normal resource chain is `TopPoweruiStyles → TopWaveseek → TopWaveseekBase`, unless owner options override it. `more_buttons` is independently checked by default and changes transport/time layout; it **does not select fixed waveform mode**.

| Variant | Value chain | Bar geometry |
|---|---|---|
| Default scrolling waveform | `TopWaveseekBase`; `m92.O=0` default | 100 samples, auto bitmap width, 1.25dp spacing, 10dp minimum bar height; cursor at 50% of padded width; 8dp left/right padding; edge-bar fading enabled |
| Static waveform option | `ActivityTheme_*pro_StaticSeekbar → TopWaveseekStatic` | Fixed mode 1; 60 samples; .5dp spacing; width recalculated to fit all bars; `cursorBgFastTracking=true` declaration |
| Simple seekbar option | `PlainSeekbar` overlap | Disables this Waveseek surface and inserts a separate Seek view; do not draw fake wave bars for it |

The bitmap resources are supplied in `drawable-sw2dp-xxxhdpi`: ordinary bars are 32×68 source pixels; narrow bars 22×90. Android `BitmapFactory.decodeResource` applies density scaling. `auto` width is the **decoded** bitmap width; 32 source pixels at 640dpi nominally represent 8dp, but actual integer decoded dimensions depend on target density. Do not assume all 100 scrolling bars are visible simultaneously. [PA1031-RENDER-011, PA1031-RENDER-012]

For default scrolling mode, let `b` be decoded bar width, `s` resolved spacing, `N=100`, `C` content width and `q` playback fraction. The logical waveform span is `L=ceil((b+s)N-s)`. The Canvas is translated by `paddingLeft + .5C - qL` before bar drawing. A visible subset of the N bars is clipped into the content rect; the playback cursor stays centered while the waveform moves. In fixed mode, `b=(C+s)/N-s`, with a 1px minimum and corresponding gap adjustment; the cursor follows the fraction across the stationary waveform. [PA1031-RENDER-013]

`m92.O(Canvas,Bitmap,...)` vertically slices each bar bitmap into top cap, stretchable middle and bottom cap. Cap height is half the decoded bitmap width. The outer Y coordinates are rounded; drawing uses filtered bitmap Paint. The normal undivided bar is vertically centered with height `max(amplitude*contentHeight,minBarHeight)`. The class also supports split/divisor bars; `divisorSize=2dp` alone does not activate a split—the `divisor` fraction must exist. The normal base style does not supply that fraction. [PA1031-RENDER-014]

Elapsed and remaining regions select distinct bitmap resources using clipped drawing passes, rather than recoloring a primitive rectangle. Default white theme maps `bar`/`elapsedbar`; black theme maps `inverse_bar`/`inverse_elapsedbar`. A nullable `colorWaveseekTint` can add a PorterDuff filter. These PNGs contain antialiasing, translucent fills and edge pixels; one sampled solid color does not describe them. Resource inspection found, for example, inverse-bar dominant fill RGBA `(255,255,255,168)` and inverse-elapsed dominant fill `(126,126,126,64)` in the 640dpi files. Those are **resource-pixel measurements**, not rendered screen colors, and should not be used without the theme/backdrop/compositing chain. [PA1031-RENDER-015]

### Data and updates

`z22.r` carries the track waveform array. `Waveseek.y()` selects actual data or a deterministic placeholder; `m92.c()` resamples to the selected bar count via `c22.х`. That resampler uses nearest sample index `min(sourceLength-1,floor(accumulator+.5))`, accumulator step `sourceLength/targetLength`; it does not calculate bucket maxima or averages. [PA1031-RENDER-016]

If the placeholder branch is selected and duration/state conditions allow it, the N values are built as:

`max(.01, min(1, abs(sin(2π*((i+.5)*frequency/N+phase))) * amplitude))`.

Scrolling uses frequency 3, amplitude .33 and phase 0; fixed uses frequency 1.5, amplitude .25 and phase .25. This fallback is a deliberate synthetic shape, not evidence of the audio's amplitude. No-data clearing uses zeros that still respect the minimum rendered bar height. [PA1031-RENDER-017]

Actual waveform generation crosses JNI: `z11.В` queues missing-track work; `x8.handleMessage` case 15 calls `ScanDecode.B`, which invokes `native_scan`. The result is posted as `msg_player_track_wave_changed` and stored in the `wave` database column; 100 floats use 400 bytes. `TagReader` can read stored floats and normalize a non-100 length through `c22`. The native scan's exact sampling/window/normalization algorithm was not reversed; do not substitute an arbitrary RMS/FFT waveform and claim parity. This is a precise remaining boundary in `com/maxmpz/audioplayer/decoder/ScanDecode.native_scan`, distinct from the recovered bar rendering. [PA1031-RENDER-018]

Data changes can morph bar heights. Defaults read by `m92` are 400ms for data and 150ms for no-data. `m92.c` records the currently blended heights before replacing a still-running target. `q0.run` case 28 advances `gh0`; `gh0.В` uses cubic ease-out `1-(1-clamp(t/T,0,1))^3`, and requests frames via `postOnAnimation`. Initial application may bypass animation (`Waveseek.a0`). These data animations are independent of the scene-engine timing multipliers. [PA1031-RENDER-019]

Pressed feedback is a child cursor View: default alpha 0, scales .55/.55, 1.5dp width; `anim_waveseek_pressed` changes alpha and scale to 1. `m92.setPressed` requests a .25-second state transition and pauses/resumes the normal playback-position subscription through `i51`. Seeking can also fade the transport controls through `anim_seeking`. See the gesture report for UP/CANCEL behavior; cancellation must not be guessed from rendering state. [PA1031-RENDER-020]

## Typography and label backgrounds

Both built-in skin schemas select `ActivityTheme_BoldFont` by default. It maps `BoldFont_font` to bundled `res/font/ttnormspro_bold.otf`, with medium/regular alternatives mapped to `ttnormspro_medium.otf`. Thus the default full-player title is not established by merely choosing Android `sans-serif-bold`. The ordinary `ItemTrackTitle_Text_BoldFont` size comes from `large4_AltFont_textSize` (18sp in unqualified dimensions), and subtitle `ItemTrackLine2_Text_BoldFont` from `medium2_AltFont_textSize` (13.5sp). Scene scale, font-scale preference and large-screen qualifiers must then be applied; these two values alone are not final pixel sizes. System-font, alternative Manrope and additional font variants exist. [PA1031-RENDER-021]

`FastTextView` obtains text appearance and explicit View attributes through `w02.y`, applies `textSizeMultiplierPref` if present, configures anti-aliased `Paint`, loads packaged font resources or a named/system Typeface through `w02.x`, and measures with `Paint.FontMetricsInt`. It has custom `eatFontPads`, `lineSpacingExtra`, `lineSpacingMultiplier` and `fontPads` handling; it is not equivalent to a browser line-height or a standard TextView's `includeFontPadding`. `FastTextView.с` draws its own text buffers and ellipsis glyph. Per-line background shapes are sized to the actual text line bounds by `FastTextView.c`. No active full-player letter-spacing adjustment was found in the consumed FastTextView attribute array; this is narrower than claiming that the entire app never uses letter spacing. [PA1031-RENDER-022]

Full-player `ItemTrackTitle_scene_aa` and `ItemTrackLine2_scene_aa` use inverse text color, marquee ellipsize, and `text_bg_alpha_rounded` as **line backgrounds**. Their geometry is specified by the UI atlas. The drawable gets `corners_text_bg` and `colorTextBgAlpha`; standard black base declares alpha-black `#c0000000`, while the white base declares `#c8000000`. Layout/label/no-background overlaps can replace these. These resource values are not an automatic contrast algorithm. Art itself changes the perceived contrast underneath them; actual theme/settings must identify the effective color. [PA1031-RENDER-023]

Long-label animation is preference-controlled (`anim_long_labels`, true by registered default). The base marquee class uses an explicit pause/forward/pause/reverse state loop, with 3000ms standard pauses (1500ms requested accelerated restart) and nominal travel speed rounded from 42.5dp per second; for overflow distance above 50 resolved pixels it selects `AccelerateDecelerateInterpolator`. The exact font/viewport text overflow decides whether animation starts. No claim is made about measured motion or runtime font rasterization. [PA1031-RENDER-024]

## Controls and navbar graphics

`TopPlay` consumes `?main_play`, mapped to `ripple_play_round_100dp`; that is an Android ripple wrapping `?play_round`. The selected theme then maps that payload to a density-qualified bitmap. More-buttons pause similarly uses `?main_pro_pause` → ripple pause → selected bitmap. The alternative compact pause can be a separate icon with independent background/tint/size. Sub-art and next/previous controls follow analogous resource references and may change to seek-jump graphics via their morph behavior. Do not infer geometry from a filename's `100dp`; final layout bounds come from the scene/style chain. [PA1031-RENDER-025]

Navbar buttons are custom FastButtons with a rounded ripple background, `?colorNavbarIcons` tint and resource-defined drawable size. Their icon families include solid, rounded, and stroke-selector variants. In a rounded stroke selector, `state_toolbar_in_header`, `state_activated` and `state_pressed` select the filled glyph; otherwise the outline glyph is drawn. The selector's exit-fade declaration is distinct from scene animation. Black-theme `navbar_icons_selector` chooses `?colorPrimary` when activated/pressed, otherwise `?colorNavbarIconsLessContrast`; some white-theme paths supply a fixed color instead. `gx0` sets up and interpolates navbar background drawables independently of button glyphs. [PA1031-RENDER-026]

`navbar_bg` is a shape with `?corners_navbar` and `?colorBgNavbar`. `gx0.onDraw` can apply incoming alpha `round(255*p)` and outgoing alpha `255-round(255*p)` while its scene transition is active, then commit or restore via `N`. The platform ripple and Drawable state machinery remain Android-owned. [PA1031-RENDER-027]

## Open rendering questions and reproducible next steps

1. **Owner configuration:** capture/export the chosen built-in skin, layout, waveform style, font variant, art aspect, corners, labels, gradient/blur/intensity/saturation, navigation appearance and animation preferences. Source defaults cannot identify owner overrides.
2. **Actual native composition:** capture full player, playback, library mini-player and a transition recording on the original APK with physical viewport, density, font scale and insets. No screenshots exist from this session.
3. **Pixel background parity:** reproduce native shader passes numerically using an agreed test cover, or observe original outputs. Native function `0x13f3e0` and helper `0x155704` are the continuation boundary for complete ping-pong texture setup/coordinate/precision analysis. The shader equations and iteration count are recovered; final pixels are not certified.
4. **Waveform data parity:** native `ScanDecode.native_scan` is the unresolved audio-to-peaks boundary. Rendering can be driven by known captured arrays in a later experiment; do not assert that another analyzer generates identical bars.
5. **Fonts and icons:** measured source dimensions and font names are recovered; no proprietary font or icon payload is shipped here. A lawful independent asset strategy is a later implementation decision, with visual comparison against authentic captures.
6. **Foreground bitmap loading:** finish provider `i`/`j`/`bh` cache/decode-size tracing only if different images/resolutions cause visible differences. Main AAImageView crop and local replacement behavior already have explicit source evidence.

The open boundaries above are tracked as PA1031-RENDER-028. Source bitmap measurements use Pillow 12.3.0; `scripts/rendering_ledger.py` reproduces dimensions, hashes and pixel histograms without publishing image payloads.

The recovered drawing architecture and conditional algorithms are suitable for a technical reference. They do not establish pixel-perfect fidelity without native rendering and the owner's active settings.
