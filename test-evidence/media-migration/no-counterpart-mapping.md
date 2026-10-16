# 29 source-unit tests and their shipped-bundle status

These 29 names still fail in `source-unit.txt` (512 tests, 483 pass, 29 fail, 0 skip, 0 todo). None are classified obsolete because the old source file is absent. The source command fails loudly if it would read the repo-root copy. `npm test` (unset `MEDIA_APP_ROOT`) still executes the source units against the root copy: 1117 pass, 0 fail (`npm-test.txt`). The shipped command is separate: 34 tests, 31 pass, 0 fail, 0 skip, 3 todo (`shipped.txt`).

The migration is incomplete. The source-unit names still fail, and the clauses listed as unsupported-documented or pending below are not shipped-bundle passes.

Deployed motion bytes: `public/media/assets/js/astra-motion.js` git blob `01cb4830d63b1e63b270eeaf2d6752946edc8242`, identical to the root copy. The pinned tree has no `src/astra-motion.js` and no `src/interaction-logic.js`.

Deployed motion stylesheet: `public/media/assets/css/obsidian.css` git blob `294f9e8189a9eee554ca3ded5e402724f8beefca`, identical to the root copy.

Deployed compatibility player: `public/media/assets/js/playback/compatibility.js`. It assigns `globalThis.AstraCompatibility` with `createAdapter` and `prepareRepair`. Pipeline helpers that the root tests import (`preparePipeline`, `pumpPipeline`, `stereoSample`, `alignAudioSample`) are inlined under minified names and are not module exports. There is no `src/compatibility-player.js` in the pin. Matching those minified names is not a behavior check.

Status values: `covered`, `mapped`, `unsupported-documented`. A motion clause that was not given a runnable behavior check in this pass is `artifact identity verified; deployed behavioral coverage pending`.

## Motion

New suite: `tests/jarvis-shipped-motion.suite.mjs`. It loads the pinned bundle and `obsidian.css` in headless Chrome and calls `AstraMotion`. The seven source-unit tests stay in the Jarvis run and still refuse `src/`.

Qualifying hash test, unchanged: `tests/interaction-motion.test.mjs` — `the shipped motion bundle matches the qualified compatibility build`. It hashes the bundle, requires `AstraMotion`, requires the local script before `app.js` via `scriptRunsBefore`, rejects a CDN script, and rejects `player.session`. That hash is artifact identity. It is not the behavioral coverage below.

| Original test | Shipped test | Status |
| --- | --- | --- |
| gesture thresholds distinguish a tap, a cancelled drag and a committed dismissal | `shipped motion distinguishes a tap, a cancelled drag, and a committed dismissal` plus `shipped velocity at or above 720 dismisses below the distance threshold` | covered, including `velocity >= 720`. A slow 110px touch drag snaps back. The same distance released immediately after the jump dismisses. 110px is under the 132px distance threshold at an 800px height |
| custom press physics owns touch and pen, not mouse clicks | `shipped custom press physics owns touch and pen, not mouse clicks` | covered |
| navigation direction follows the dock and accepts an explicit back route | `shipped navigation direction follows the dock and accepts an explicit back route` | covered |
| site-wide content choreography is shared, viewport-aware and bounded | `shipped content choreography is viewport-aware and bounded` | covered |
| mobile motion avoids offscreen GPU layers and costly document snapshots | `shipped mobile motion avoids offscreen GPU layers and costly document snapshots` | covered for lean refresh, no opacity promotion, no document snapshot, and the lean image transition. `backdrop-filter: none` at 390px is an explicit todo: the 419px rule declares it, and a later `.episode-nav-sticky` rule sets `saturate(180%) blur(20px)` and wins. The mobile test records that computed blur |
| direct interaction motion never exceeds the 360ms release budget | `shipped direct interaction motion stays inside the 360ms release budget` | covered. CSSOM seek rule is 360ms, view-transition art is 340ms, and the live navigation and press tweens settle inside a 360ms clock advance |
| View Transition callbacks cannot reorder or stall visible state | `shipped view-transition callbacks cannot reorder or stall visible state` | covered |

## Compatibility player

New suite: `tests/jarvis-shipped-compatibility.suite.mjs`. It loads pinned `compatibility.js` and `request-policy.js` in a VM and calls `AstraCompatibility.createAdapter` / `prepareRepair`. The 22 source-unit tests stay in the Jarvis run and still refuse `src/compatibility-player.js`.

Existing tests that still do not replace this suite:

- `tests/playback-request-policy.test.mjs` covers `request-policy.js` alone. It does not attach the compatibility adapter.
- `tests/player-recovery.test.mjs` stubs `prepareRepair`.
- `tests/software-player.test.mjs` covers `AstraSoftware`, a different adapter.

| Original test | Shipped test | Status |
| --- | --- | --- |
| real MKV AVC/AAC is repackaged to fragmented MP4 with video bytes intact | `shipped: real MKV AVC/AAC is repackaged to fragmented MP4 with video bytes intact` | covered |
| HEVC repair declares hvc1 exactly as the pinned MP4 muxer writes it | `shipped: HEVC repair declares hvc1 exactly as the pinned MP4 muxer writes it` | covered |
| HEVC open-GOP seeking drops unavailable leading pictures and preserves retained video and audio bytes | `shipped: HEVC open-GOP seeking drops unavailable leading pictures and preserves retained video and audio bytes` | covered |
| seeking starts at a preceding keyframe and unsupported video is explicit | `shipped: seeking starts at a preceding keyframe and unsupported video is explicit` | covered for the preceding keyframe and the explicit "cannot decode the video codec" error. The pre-aborted `pumpPipeline` `AbortError` is an explicit todo: `createAdapter` detaches the mux job and does not reject `attach()` with that internal error. The bundle does not export `pumpPipeline` |
| surround audio is downmixed to bounded stereo samples | `shipped: surround audio is downmixed to bounded stereo samples` | covered |
| audio crossing a video keyframe is trimmed before encoding to avoid negative timestamps | `shipped: audio crossing a video keyframe is trimmed before encoding to avoid negative timestamps` | covered |
| an unsupported default audio track falls back to usable audio in the same file | `shipped: an unsupported default audio track falls back to usable audio in the same file` | covered. MP4 would copy Vorbis, so the test rejects that combination the way an unsupported device would. The undecodable default track then yields to the AAC sibling, and forcing the Vorbis track id rejects with `AUDIO_CODEC_UNSUPPORTED` |
| replacing an in-flight startup reports the old read as cancelled, not a new playback failure | `shipped: replacing an in-flight startup reports the old read as cancelled, not a new playback failure` | covered |
| real 40-second MKV VP8/Vorbis uses WebM when MP4 is unavailable, preserving both tracks | `shipped: real 40-second MKV VP8/Vorbis uses WebM when MP4 is unavailable, preserving both tracks` | covered |
| audio conversion selects AAC when MP4 cannot accept Opus | `shipped: audio conversion selects AAC when MP4 cannot accept Opus` | covered. A fresh bundle load records the encoder query `mp4a.40.2` and does not query Opus |
| a WebM repair seek retains a preceding keyframe beyond the initial read-ahead window | `shipped: a WebM repair seek retains a preceding keyframe beyond the initial read-ahead window` | covered |
| copied AAC audio crossing a seek keyframe keeps its timing and no longer fails the muxer | `shipped: copied AAC audio crossing a seek keyframe keeps its timing and no longer fails the muxer` | covered |
| compatibility fetch keeps addon headers on their origin and follows demuxer byte ranges | `shipped: compatibility fetch keeps addon headers on their origin and follows demuxer byte ranges` | covered |
| compatibility HLS children on another origin never receive addon credentials | `shipped: compatibility HLS children on another origin never receive addon credentials` | covered |
| compatibility startup distinguishes blocked access and connection failures | `shipped: compatibility startup distinguishes blocked access and connection failures` | covered |
| audio repair retries a transient request and transfers the real prepared input without rereading | `shipped: audio repair retries a transient request and transfers the real prepared input without rereading` | covered |
| audio repair bounds persistent fetch failures to one shared retry | `shipped: audio repair bounds persistent fetch failures to one shared retry` | covered |
| audio repair bounds persistent body failures to one shared retry | `shipped: audio repair bounds persistent body failures to one shared retry` | covered |
| cancelling repair during its retry delay stops it without another request | `shipped: cancelling repair during its retry delay stops it without another request` | covered |
| repair cancellation promptly rejects a pending metadata fetch | `shipped: repair cancellation promptly rejects a pending metadata fetch` | covered |
| prepared repair is disposed when abandoned or its adapter is destroyed before attach | `shipped: prepared repair is disposed when abandoned or its adapter is destroyed before attach` | covered |
| aborting an unconsumed prepared repair invalidates it; abort after transfer leaves ownership with the adapter | `shipped: aborting an unconsumed prepared repair invalidates it; abort after transfer leaves ownership with the adapter` | covered |

## Script order harness

`tests/helpers/shell-assets.mjs` now reads `<script>` elements only. A preload `<link href>` cannot satisfy `assetIndex` or `scriptRunsBefore`. `async`, including `async defer`, is not an ordered load. Mixed blocking/defer pairs are not ordered. `tests/shell-assets.test.mjs` locks that. `app-wiring`, `redesign`, and the motion script-order check use `scriptRunsBefore`.
