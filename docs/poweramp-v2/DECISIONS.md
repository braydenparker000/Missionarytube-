# Architectural decisions — 2026-10-20

## Selection criteria and competing approaches

The first critical journey needs one continuous artwork element, interruptible scene progress, independent seek/play targets, stable audio across navigation, accessible text/controls and a small static artifact. APK evidence establishes a scene/property system but does not mandate its Android implementation language or renderer.

| Approach | Expected strengths | Costs and uncertainty | Decision |
|---|---|---|---|
| React or Svelte components + an imperative motion/audio boundary | Declarative screen composition and scalable state ownership; refs/actions can keep frame work outside component rendering | Introduces a compiler/bundle integration and lifecycle boundaries. No evidence that either inherently fails performance requirements | Credible next option if the growing screen/state graph becomes difficult to maintain |
| DOM/CSS modules + explicit scene progress + Canvas waveform | Native text, inputs, focus, scrolling; direct control of a single shared artwork; directly compatible with the host copy build | Manual reconciliation and cleanup need discipline; browser text and scroll physics still differ from native Poweramp | **Selected for the measured first slice** |
| Whole-scene Canvas/WebGL | Centralized draw order and precise graphic interpolation | Must recreate accessible text, focus, selection, hit testing and scrolling; no demonstrated need for a full GPU scene renderer yet | Reserve for a specific proven rendering requirement |

This is an engineering tradeoff plus a running DOM prototype, not a comparative React/Svelte benchmark. No A15 superiority claim is supported yet. The prototype's tests cover cancellation, shared-art endpoints, actual audio, 5,000 rows and CPU-throttled navigation. Keep renderer replacement possible by retaining independent audio/queue/source contracts.

## Motion and input

`SceneMotion` owns one normalized player/library progress value. A new settle starts at the current value; a gesture interrupts without snapping to a stale endpoint. rAF updates transform/opacity and artwork radius; no UI framework rerender is necessary per contact sample. Inactive scenes are inert. The library mounts only a visible window of rows, with a maximum of 32.

CSS transitions alone make regrabbing an in-flight property inconvenient. WAAPI and GSAP remain viable for a more complex verified timeline, but the current property set is small enough to keep one explicit progress owner. The selected 250 ms base comes from the list configuration, while cubic ease-out, distance scaling, thresholds and crossfades are provisional V2 choices. They are not recovered native motion curves. Root enter/exit and AA settle values are distinct evidence.

Pointer capture separates artwork/mini expansion, waveform seeking, playback controls and native list scrolling. A second contact anywhere cancels the single-contact gesture and cannot activate a different button. Native browser scrolling is intentional; exact Poweramp fling physics remains unverified.

## Audio

One persistent HTMLAudioElement survives scene changes. The engine separates desired play/pause from media-confirmed status and invalidates stale asynchronous play settlements on pause/source changes. Natural completion, manual navigation, shuffle traversal and repeat have explicit contracts. Media Session controls operate this same engine.

A Web Audio graph, AudioWorklet or WASM decoder is not required for the first streaming/file playback contract. Adding one without a demonstrated DSP/codec need would introduce decoding, scheduling, memory and lifecycle work. EQ/crossfade/gapless can be evaluated independently later. No native DAC, exclusive output, bit-perfect playback, Poweramp DSP or guaranteed background-lifecycle parity is claimed.

The browser test observes the media element's actual decoded stream through `captureStream()` and an analyser. That is test instrumentation, not the production output pipeline. A test initially attempted `fetch(blobURL)` for decoding; the production CSP correctly rejected it. The test was corrected to observe playback without widening CSP.

## Data and persistence

Catalogs expose `{tracks, dispose()}`. Demo source owns generated Blob URLs; local source owns explicitly selected file Blob URLs. Source replacement unloads old playback before revoking owned URLs. The new R2 adapter constructs exact service read routes from a validated origin and catalog; it never changes providers or silently falls back.

Small preferences use only `poweramp-v2:preferences:1`. Stored fields are schema, demo ID/position, repeat and shuffle. Playback intent, media URLs, local filenames and credentials are excluded. Storage denial/corruption falls back safely. No V1 IndexedDB/localStorage is read or changed. IndexedDB catalog indexing is deferred until persistent remote catalog/offline or playlist requirements exist; 5,000 in-memory synthetic tracks have been exercised.

## Static integration and evidence

The route is wholly under `frontend/poweramp-v2/`, research under `docs/poweramp-v2/`, tests under `tests/poweramp-v2/`, and the development server under `scripts/`. No build/release machinery or service configuration was changed. Runtime is **69,825 bytes before compression** at the implementation checkpoint, with no third-party runtime imports. The complete host build remains about 20.60 MiB, below its 25 MiB ceiling.

The first modules used `.mjs`; inspection found that the existing publisher maps `.js` but not `.mjs` to JavaScript MIME. Modules were renamed to `.js`. This avoids a needless hosting change. Build output was exercised at the actual `/poweramp-v2/` subpath, under the document's unmodified CSP.

Local evidence used Chromium headless shell141.0.7390.37 and Node24.19.0. The repository's Chrome154.0.8037.97 official archive passed its SHA-256/version checks, but full Chrome could not start because this environment disallows its ProcessSingleton Unix socket. No restriction was changed. Required CI's qualified runtime and A15 verification remain separate gates.

For one completed artifact run, 5,000 tracks rendered 9 rows near the end; catalog setup took 9 ms. During six navigation cycles at 4× CDP CPU slowdown, 342 rAF intervals had p95≈16.8 ms, maximum≈33.3 ms, no interval above34 ms, and no observed long tasks. These are local callback observations, **not** presentation latency/FPS, GPU raster measurements, Android scheduling or A15 proof. See [measurements.json](evidence/measurements.json); values may vary on rerun.

Reconsider the renderer if real phone profiling shows persistent layout/raster or input ownership problems; reconsider component tooling if maintaining more scenes causes state duplication. Reconsider the audio graph only with a concrete functionality or measured quality benefit.

## Primary API references inspected

- [React escape hatches — official documentation source](https://github.com/reactjs/react.dev/blob/main/src/content/learn/escape-hatches.md)
- [Svelte overview — official documentation source](https://github.com/sveltejs/svelte/blob/main/documentation/docs/01-introduction/01-overview.md)
- [Web Animations API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API)
- [HTMLMediaElement.play](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/play)
- [Media Session API](https://developer.mozilla.org/en-US/docs/Web/API/Media_Session_API)
- [Pointer capture](https://developer.mozilla.org/en-US/docs/Web/API/Element/setPointerCapture)
