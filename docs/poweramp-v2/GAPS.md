# Prioritized next evidence and implementation work

## 1. Calibrate the real reference

Request just these from the owner when resuming fidelity work:

1. One full-player screenshot and one All Songs/library screenshot from the A15 at current settings.
2. A short recording of player↔library/mini-player: tap, slow drag reversed before release, horizontal artwork swipe, and waveform drag.
3. Confirm whether Alternate Layout, More Buttons, enlarged artwork/text and navbar seekbar are enabled; a settings export can replace this list.

Then use the same artwork, viewport, font scaling and settings for paired captures. Establish regional image tolerances after seeing actual font/raster variation. Current screenshots are V2-only synthetic evidence; no visual-diff percentage or exact-match claim is valid yet.

Specific unverified appearance: active AABounds2 measurements, top/system insets, library header/cards and row details, toolbar action order, previous/next placement, playing-art animation, blurred/art-dependent background and text font/raster. Resource dp→CSS-px translation is a calibration hypothesis.

## 2. Native gesture/motion equivalence

Trace PowerList's gesture owner and the relevant i22 paths with the focused decoded map, then validate against the recording. Priority: native vertical-art behavior, mini expansion arbitration, waveform scrub/fling/cancel, velocity thresholds, long presses and regrab curves. Durations can be scaled by preferences; avoid equating the list250ms declaration to all observed transitions.

## 3. Authorized music integration

The new remote adapter is isolated and has9 synthetic contract checks. It is not active in the UI or CSP. Next work: read the existing published config with a strict expected-origin check, deliberately select the remote source, allow only its verified media/art/API host in CSP, render validated remote artwork, and use safe source failure/retry UI. Do not read or mutate V1 storage or change CORS/auth/provider configuration.

Local browser fixtures cannot establish production CORS. A later owner-approved preview at the existing Azure origin is required for actual catalog/Range/seek/artwork/error playback proof. Keep V1 operational. Never publish personal tracks or token-bearing fixtures to solve this.

## 4. Coherent player expansion

Implement persistent catalog/index and playlist state under a new versioned namespace only when needed, preserving prior schemas. Add actual upcoming queue/reorder, category/scroll history, tags/art for local files, context menus and configurable built-in layout variants. No silent importer from V1. Split the UI coordinator into dedicated library/player modules as the number of screens grows.

EQ, ReplayGain, gapless/crossfade, lyrics, ratings, folders/genres and visualizations are not implemented. EQ is visibly disabled. Measure any DSP graph against reference output and browser lifecycle before selecting AudioWorklet/WASM or another decoder. Browser-native output/DAC parity remains platform-limited.

## 5. Release and device gates

Run required CI on the exact reviewed commit and qualified runtimes. Local Chrome154 full-browser launch was blocked by the environment's Unix-socket restriction; local Chrome141 headless results are not a substitute for that gate. No policy workaround was used.

On the A15: measure input-to-visible acknowledgement, long tasks/frame presentation, memory and raster costs; exercise rotation, system text scaling, keyboard, reduced motion, repeated interruption and two-finger contact. Test locked-screen/background playback, battery restrictions, headset/Media Session controls, calls/audio focus and prolonged streamed stalls. Local synthetic4× CPU callbacks do not establish phone60Hz or reliable background audio.

Only after those results propose an owner-reviewed integration/release. Merge and production publication each retain the explicit approval boundary.
