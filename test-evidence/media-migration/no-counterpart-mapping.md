# 29 tests with no direct Jarvis source counterpart

These 29 are the failures that remain in `migrated.tap`. None are classified obsolete because the old source file is absent. The protected behavior still ships. The Jarvis-targeted run fails loudly if it would read the repo-root copy of that source file. `npm test` (unset `MEDIA_APP_ROOT`) still executes the source units against the root copy.

Deployed motion bytes: `public/media/assets/js/astra-motion.js` git blob `01cb4830d63b1e63b270eeaf2d6752946edc8242`, identical to the root copy. The pinned tree has no `src/astra-motion.js` and no `src/interaction-logic.js`.

Deployed motion stylesheet: `public/media/assets/css/obsidian.css` git blob `294f9e8189a9eee554ca3ded5e402724f8beefca`, identical to the root copy.

Deployed compatibility player: `public/media/assets/js/playback/compatibility.js`. It assigns `globalThis.AstraCompatibility` with `createAdapter` and `prepareRepair`. Pipeline helpers that the root tests import (`preparePipeline`, `pumpPipeline`, `stereoSample`, `alignAudioSample`) are inlined under minified names and are not module exports. There is no `src/compatibility-player.js` in the pin.

## Motion source units — covered elsewhere (7)

The source-unit tests stay on the root suite. Against Jarvis they throw `Refusing to fall back to the repo-root copy` and do not read root `src/`. The shipped behavior is locked by the byte-identical bundle and stylesheet, plus the shell tests that already pass on Jarvis.

Qualifying test: `tests/interaction-motion.test.mjs` — `the shipped motion bundle matches the qualified compatibility build`.

That test hashes the shipped bundle to `01cb4830d63b1e63b270eeaf2d6752946edc8242`, requires `AstraMotion`, requires the local script before `app.js`, rejects a CDN script, and rejects `player.session`. When `MEDIA_APP_ROOT` is unset it also checks root `package.json` for `gsap` 3.15.0 and `esbuild` 0.28.2. When `MEDIA_APP_ROOT` is set it does not read the root package.

The bundle contains the source-unit markers `pointerType`, `pointerdown`, `pointercancel`, `Math.hypot`, `.24`, `720`, `deviceMemory`, `hardwareConcurrency`, `startViewTransition`, and `IntersectionObserver`.

Shell tests that pass on Jarvis and read the same app and CSS:

- `navigation, dock and title detail continuity are all wired`
- `every mobile overlay can be dismissed physically without touching Player V3`
- `dismissed detail and source surfaces return keyboard focus`
- `reduced motion removes autonomous choreography and gesture zones`

| Test | Protected behavior | Deployed implementation | Existing coverage | Class |
| --- | --- | --- | --- | --- |
| gesture thresholds distinguish a tap, a cancelled drag and a committed dismissal | Tap slop, dismiss distance/velocity, and drag progress from `src/interaction-logic.js` | Inlined in `assets/js/astra-motion.js` (blob `01cb4830d63b1e63b270eeaf2d6752946edc8242`; contains `Math.hypot`, `.24`, `720`) | `the shipped motion bundle matches the qualified compatibility build` | covered elsewhere |
| custom press physics owns touch and pen, not mouse clicks | Pointer physics ignore mouse and listen for `pointerdown` / `pointercancel` | Same bundle (`pointerType`, `pointerdown`, `pointercancel`) | same qualification test | covered elsewhere |
| navigation direction follows the dock and accepts an explicit back route | Dock order and an explicit back route | Same bundle, called from app `Motion.navigate` | qualification test, plus `navigation, dock and title detail continuity are all wired` | covered elsewhere |
| site-wide content choreography is shared, viewport-aware and bounded | `Motion.refresh`, intersection reveals, and a bounded reveal budget | Same bundle (`IntersectionObserver`, `.search-provider-result`, `.video-row`, `.stream-item`) and identical `assets/css/obsidian.css` (`GSAP also owns content arrival`) | qualification test. CSS bytes match the file the root source test asserts | covered elsewhere |
| mobile motion avoids offscreen GPU layers and costly document snapshots | No offscreen opacity promotion; memory and CPU gates; lean CSS | Same bundle (`deviceMemory`, `hardwareConcurrency`, `startViewTransition`) and identical CSS (`.motion-lean .media-image`, narrow `backdrop-filter: none`) | qualification test. CSS bytes match the root file | covered elsewhere |
| direct interaction motion never exceeds the 360ms release budget | Source durations at most 0.36s; view-transition 340ms; seek pop 360ms | Same bundle and identical CSS (`animation-duration: 340ms`, `player-seek-pop 360ms`) | qualification test. CSS bytes match the root file | covered elsewhere |
| View Transition callbacks cannot reorder or stall visible state | Open/close commit fallbacks; navigation does not wait on a snapshot | Same bundle and identical CSS (`::view-transition { pointer-events: none; }`) | qualification test. CSS bytes match the root file | covered elsewhere |

These seven are not retired. The root suite still runs the source units. The Jarvis failure is the guard that refuses the root copy, not evidence that the behavior left the deployed app.

## Compatibility player — needs a new Jarvis test (22)

Each test imports `src/compatibility-player.js` and calls `preparePipeline`, `pumpPipeline`, `stereoSample`, `alignAudioSample`, `createAdapter`, or `prepareRepair`. The pin has no such module. The migrated error is `Refusing to fall back to the repo-root copy for src/compatibility-player.js`.

The behavior is in `public/media/assets/js/playback/compatibility.js` (`AstraCompatibility.createAdapter` / `prepareRepair`). App playback calls those two exports (`assets/js/app.js`). A new Jarvis test has to drive that shipped bundle (or a harness around those two exports). Matching the minified helper names would not be a behavior check.

Existing tests that do not cover these cases:

- `tests/playback-request-policy.test.mjs` covers `assets/js/playback/request-policy.js` alone (`segment origins never inherit addon credentials, including from earlier init objects`, `demuxer range wins over a static addon range`). It does not attach the compatibility adapter or perform its fetch.
- `tests/player-recovery.test.mjs` stubs `AstraCompatibility.prepareRepair`. It checks recovery UI and bounded reopen. It does not remux bytes, downmix, or run the real retry/abort path.
- `tests/software-player.test.mjs` covers `assets/js/playback/software-player.js` (`AstraSoftware`), a different adapter.
- `the reported MP4 H264/AC3 combination has readable video and decodable audio` passes on Jarvis because it reads the fixture with mediabunny and does not call the missing module. It does not remux.

| Test | Protected behavior | Deployed implementation | Existing coverage | Class |
| --- | --- | --- | --- | --- |
| real MKV AVC/AAC is repackaged to fragmented MP4 with video bytes intact | AVC/AAC MKV becomes fragmented MP4 and the video bytes survive | `AstraCompatibility.prepareRepair` / `createAdapter` in `assets/js/playback/compatibility.js` | none that mux bytes | needs a new Jarvis test |
| HEVC repair declares hvc1 exactly as the pinned MP4 muxer writes it | HEVC output uses `hvc1` as the muxer writes it | same bundle | none | needs a new Jarvis test |
| HEVC open-GOP seeking drops unavailable leading pictures and preserves retained video and audio bytes | Open-GOP seek drops leading pictures and keeps retained samples | same bundle | none | needs a new Jarvis test |
| seeking starts at a preceding keyframe and unsupported video is explicit | Seek starts at a prior keyframe; unsupported video is an explicit error | same bundle | none | needs a new Jarvis test |
| surround audio is downmixed to bounded stereo samples | Surround samples become bounded stereo | same bundle (`stereoSample` is inlined) | none | needs a new Jarvis test |
| audio crossing a video keyframe is trimmed before encoding to avoid negative timestamps | Audio that crosses the seek keyframe is trimmed before encode | same bundle | none | needs a new Jarvis test |
| an unsupported default audio track falls back to usable audio in the same file | Default audio that cannot be used falls back inside the file | same bundle | none | needs a new Jarvis test |
| replacing an in-flight startup reports the old read as cancelled, not a new playback failure | Superseded startup is `AbortError`, not a new playback failure | same bundle | none | needs a new Jarvis test |
| real 40-second MKV VP8/Vorbis uses WebM when MP4 is unavailable, preserving both tracks | VP8/Vorbis falls back to WebM and keeps both tracks | same bundle | none | needs a new Jarvis test |
| audio conversion selects AAC when MP4 cannot accept Opus | Opus is converted to AAC for MP4 | same bundle | none | needs a new Jarvis test |
| a WebM repair seek retains a preceding keyframe beyond the initial read-ahead window | WebM seek keeps a keyframe outside the first read-ahead | same bundle | none | needs a new Jarvis test |
| copied AAC audio crossing a seek keyframe keeps its timing and no longer fails the muxer | Copied AAC across the seek keyframe keeps timing and muxes | same bundle | none | needs a new Jarvis test |
| compatibility fetch keeps addon headers on their origin and follows demuxer byte ranges | Addon `Authorization` stays on the media origin; demuxer ranges replace a static range; redirect error; credentials omitted | `createAdapter` in the same bundle, using the request policy | policy module only: `demuxer range wins over a static addon range`. Not adapter fetch | needs a new Jarvis test |
| compatibility HLS children on another origin never receive addon credentials | Cross-origin HLS segments do not receive `Authorization` or `X-Playback-Key` | `createAdapter` in the same bundle | policy module only: `segment origins never inherit addon credentials, including from earlier init objects`. Not adapter fetch | needs a new Jarvis test |
| compatibility startup distinguishes blocked access and connection failures | A credentialed URL that is not fetched is `access` at `metadata`; a failed fetch is `network` | `createAdapter` in the same bundle | none through the adapter | needs a new Jarvis test |
| audio repair retries a transient request and transfers the real prepared input without rereading | One retry, then the adapter uses the prepared input and does not fetch again | `prepareRepair` then `createAdapter` | recovery tests stub `prepareRepair` | needs a new Jarvis test |
| audio repair bounds persistent fetch failures to one shared retry | Persistent fetch failure stops at two requests and `playbackType=network` | `prepareRepair` | none | needs a new Jarvis test |
| audio repair bounds persistent body failures to one shared retry | Persistent body failure stops at two requests | `prepareRepair` | none | needs a new Jarvis test |
| cancelling repair during its retry delay stops it without another request | Abort during the retry delay is `AbortError` and does not send a second request | `prepareRepair` | none | needs a new Jarvis test |
| repair cancellation promptly rejects a pending metadata fetch | Abort rejects a pending metadata fetch | `prepareRepair` | none | needs a new Jarvis test |
| prepared repair is disposed when abandoned or its adapter is destroyed before attach | Abandoned or pre-attach destroy invalidates `take()` | `prepareRepair` / `createAdapter` | none | needs a new Jarvis test |
| aborting an unconsumed prepared repair invalidates it; abort after transfer leaves ownership with the adapter | Abort before take invalidates the preparation; abort after transfer leaves ownership with the adapter | `prepareRepair` / `createAdapter` | none | needs a new Jarvis test |

No test in this list is truly obsolete. The repair pipeline is still what `app.js` calls through `AstraCompatibility`.
