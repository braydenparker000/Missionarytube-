# Per-failure before/after

Baseline is `baseline.tap`: 511 tests, 456 pass, 55 fail, against pinned Jarvis `public/media` before the harness changes in this commit.

Migrated is `migrated.tap`: 512 tests, 483 pass, 29 fail. The extra test is `initial theme renders while appearance and bootstrap are still loading`. It was not one of the original 55. It passes on both the root copy and the pinned Jarvis tree.

Classes used here: `harness`, `implementation-detail`, `real behavior difference`. The 29 tests that still fail are classified again in `no-counterpart-mapping.md`. Their expectation was not rewritten to pass.

## Harness (11) — now pass

`bindArtwork` is defined in deployed `public/media/assets/js/app.js` and is called from `bindDynamic`. The recovery VM extracted `bindDynamic` and not `bindArtwork`, so each test threw `bindArtwork is not defined` before its recovery assertion ran. The fixture now extracts `bindArtwork` when that function exists. The recovery assertions are unchanged.

| Test | Failure before | Cause | Change | Result after | Class |
| --- | --- | --- | --- | --- | --- |
| the rendered failure card retries the same source after the engine has settled | `bindArtwork is not defined` | VM fixture omitted a function the deployed app calls | Extract `bindArtwork` into the recovery context | pass | harness |
| a timed-out seek offers restarting from zero without repeating the stuck position | `bindArtwork is not defined` | same | same | pass | harness |
| expired stream recovery can request a fresh source list for the same episode | `bindArtwork is not defined` | same | same | pass | harness |
| the rendered failure card can return to the source picker | `bindArtwork is not defined` | same | same | pass | harness |
| the rendered failure card's close button is bound after replacing the media element | `bindArtwork is not defined` | same | same | pass | harness |
| external playback can read the failed source when the current attempt is gone | `bindArtwork is not defined` | same | same | pass | harness |
| a failed compatibility attempt does not repeatedly reopen itself | `bindArtwork is not defined` | same | same | pass | harness |
| failure unlocks controls and exposes its recovery state | `bindArtwork is not defined` | same | same | pass | harness |
| a source connection failure does not start unnecessary format conversion | `bindArtwork is not defined` | same | same | pass | harness |
| YouTube keeps its own playback recovery instead of the file converter | `bindArtwork is not defined` | same | same | pass | harness |
| a docked audio failure expands to an accessible recovery screen | `bindArtwork is not defined` | same | same | pass | harness |

## Version string, script loading, artwork, pagehide (15) — now pass

These failed on source text that the root copy uses and Jarvis does not. The behavioral guarantee was separated from that text before the expectation changed.

Shared cache key: the root shell uses the placeholder `__ASTRA_VERSION__`. Jarvis stamps `?v=0.34.6`, which equals `<meta name="astra-release" content="0.34.6">`. The guarantee kept is one shared key across local shell assets, and that key is either the placeholder or the release meta. A mismatched per-file version still fails.

| Test | Failure before | Cause | Change | Result after | Class |
| --- | --- | --- | --- | --- | --- |
| the external app loads after the progress store | `progress-store.js must be loaded` | Assertion required `?v=__ASTRA_VERSION__`. Jarvis loads `progress-store.js?v=0.34.6` before `app.js`. | Resolve scripts by path, then compare order | pass | implementation-detail |
| route ownership loads before the app and releases inactive catalog DOM | `route-runtime.js must load before the application` | Same version-token match | Same path-order check | pass | implementation-detail |
| every playback module is loaded before the app script | `settings.js is not loaded` | `settings.js` is loaded; the version token did not match | Same path-order check | pass | implementation-detail |
| the app exposes direct Surprise Me and focused health controls | regex required `discovery-health.js?v=__ASTRA_VERSION__` | Jarvis uses `defer` and `?v=0.34.6` | Require the script path and that it precedes `app.js` | pass | implementation-detail |
| natural-language constraints stay visible, removable, and evidence based | regex required `search-intent.js?v=__ASTRA_VERSION__` | Same stamp | Same path check | pass | implementation-detail |
| nothing in the UI invents content, availability or telemetry | regex required `audio-player.js?v=__ASTRA_VERSION__` | Same stamp | Same path check. The no-invented-telemetry assertions are unchanged | pass | implementation-detail |
| the Gallery stylesheet cache key matches the visible app version | expected `__ASTRA_VERSION__`, actual `0.34.6` | Jarvis stamps the release meta instead of the placeholder | Accept the placeholder or the `astra-release` meta, and require one shared key | pass | implementation-detail |
| one release placeholder owns every local shell asset cache key | actual keys were `?v=0.34.6`, including `/assets/pip-diagnostics.js?v=0.34.6` | Same stamp, plus a leading slash on one path | Same shared-key rule. Independent keys still fail | pass | implementation-detail |
| the early bootstrap and application are external reviewable files | `the js class is set before first paint` | Tag order was treated as proof the script had run. Jarvis defers `bootstrap.js` and `appearance.js`, so they do not run before first paint | Keep the external-file and order checks. Drop the tag-order paint claim. The paint behavior is the new theme test below | pass | implementation-detail |
| no runtime framework and no unpinned remote script was introduced | `local.length >= 9` was false | The local-script regex required `<script src=` and missed `<script defer src=` | Count local scripts with or without `defer`. Remote `http(s)` scripts still fail | pass | implementation-detail |
| YouTube plays natively, and no iframe or embed survives anywhere | unexpected host `images.metahub.space` | Jarvis preconnects the poster CDN. It is not a YouTube or Invidious instance | Allow that poster host. `youtube.com`, `youtube-nocookie`, and Invidious instance hosts still fail. No iframe/embed assertion was relaxed | pass | implementation-detail |
| every catalog card, including new releases, has resilient artwork | regex required inline `onload="this.parentElement.classList.add('image-ready')"` | Jarvis binds `bindArtwork` and `AstraArtworkFallback` instead of inline handlers | Fire load and error on the rendered image. Fallback advance, `image-error`, and `image-ready` must happen. CSS opacity rule kept | pass | implementation-detail |
| thumbnails are lazily loaded, escaped, and shaped like the artwork | `the shared image helper carries loading=lazy` failed on `mediaImage(art)` | Jarvis calls `mediaImage(art, {fallbacks})` and builds candidates with `videoArtCandidates` rather than only `safeUrl(m.poster\|\|m.background\|\|'')` | Execute the candidate helper. `javascript:` becomes `""`. An `https` still is kept. Lazy versus priority is checked by behavior | pass | implementation-detail |
| pending progress is flushed when playback or the page ends | regex required `window.addEventListener('pagehide',()=>progress.flush())` | Jarvis calls `checkpointPlayback()`, which records the live position immediately and otherwise flushes. It does not mark completion at pagehide, visibility, or pause | Drive pagehide, visibility, pause, and `closePlayer` against a progress double. Live media must record time `120.5` and not `completed` when a checkpoint exists; otherwise it must flush. Close still flushes and clears meta | pass | implementation-detail |
| the motion runtime is exact, local and loaded before app wiring | `runtime > -1 && runtime < app` was false | The script matcher missed `defer`, and the test also required root `package.json` pins (`gsap` 3.15.0, `esbuild` 0.28.2) that Jarvis does not ship | Replaced by `the shipped motion bundle matches the qualified compatibility build`. Root runs still check those package pins. Jarvis runs hash `assets/js/astra-motion.js` and must not read the root package. CDN scripts and `player.session` still fail | pass | implementation-detail |

`pending progress is flushed when playback or the page ends` is an implementation detail of the call shape. The saved behavior (checkpoint the live position, flush when media is not live, do not invent completion) holds on both trees. It is not a remaining behavior failure.

## Real behavior difference — new test, passing

`initial theme renders while appearance and bootstrap are still loading` models first paint while scripts are still in flight. Parser-blocking scripts run. `defer`, `async`, and `type=module` stay pending. A script tag's presence is not treated as execution.

Both trees must paint a dark floor from the render-blocking stylesheet (`--cinema-floor: #050607`), a dark critical-CSS fallback, default accent `#b4d1ff`, and `color-scheme: dark`, with a stored non-default accent (`violet`) in `localStorage`.

- Root copy: `appearance.js` and `bootstrap.js` block the parser, so the stored accent, motion, and surface are applied and the `js` class is set before paint.
- Jarvis: those scripts are `defer`. The test requires `dataset.accent` to stay unset, the `js` class to stay off, both scripts to remain pending, and `executed.length` to be 0.

Result on the migrated run: pass. Class: real behavior difference, asserted explicitly. Deferred script tags alone are not accepted as before-first-paint proof.

## Still failing (29)

These are the original no-counterpart failures. The harness change makes a Jarvis run throw `Refusing to fall back to the repo-root copy` instead of reading root `src/`. Expectations were not loosened. See `no-counterpart-mapping.md`.

| Test | Failure before | Cause | Change | Result after | Class |
| --- | --- | --- | --- | --- | --- |
| real MKV AVC/AAC is repackaged to fragmented MP4 with video bytes intact | `Cannot find module .../src/compatibility-player.js` | Jarvis ships the minified player, not `src/compatibility-player.js` | Loud refusal. No root fallback | fail | see mapping |
| HEVC repair declares hvc1 exactly as the pinned MP4 muxer writes it | same missing module | same | same | fail | see mapping |
| HEVC open-GOP seeking drops unavailable leading pictures and preserves retained video and audio bytes | same | same | same | fail | see mapping |
| seeking starts at a preceding keyframe and unsupported video is explicit | same | same | same | fail | see mapping |
| surround audio is downmixed to bounded stereo samples | same | same | same | fail | see mapping |
| audio crossing a video keyframe is trimmed before encoding to avoid negative timestamps | same | same | same | fail | see mapping |
| an unsupported default audio track falls back to usable audio in the same file | same | same | same | fail | see mapping |
| replacing an in-flight startup reports the old read as cancelled, not a new playback failure | same | same | same | fail | see mapping |
| real 40-second MKV VP8/Vorbis uses WebM when MP4 is unavailable, preserving both tracks | same | same | same | fail | see mapping |
| audio conversion selects AAC when MP4 cannot accept Opus | same | same | same | fail | see mapping |
| a WebM repair seek retains a preceding keyframe beyond the initial read-ahead window | same | same | same | fail | see mapping |
| copied AAC audio crossing a seek keyframe keeps its timing and no longer fails the muxer | same | same | same | fail | see mapping |
| compatibility fetch keeps addon headers on their origin and follows demuxer byte ranges | same | same | same | fail | see mapping |
| compatibility HLS children on another origin never receive addon credentials | same | same | same | fail | see mapping |
| compatibility startup distinguishes blocked access and connection failures | same | same | same | fail | see mapping |
| audio repair retries a transient request and transfers the real prepared input without rereading | same | same | same | fail | see mapping |
| audio repair bounds persistent fetch failures to one shared retry | same | same | same | fail | see mapping |
| audio repair bounds persistent body failures to one shared retry | same | same | same | fail | see mapping |
| cancelling repair during its retry delay stops it without another request | same | same | same | fail | see mapping |
| repair cancellation promptly rejects a pending metadata fetch | same | same | same | fail | see mapping |
| prepared repair is disposed when abandoned or its adapter is destroyed before attach | same | same | same | fail | see mapping |
| aborting an unconsumed prepared repair invalidates it; abort after transfer leaves ownership with the adapter | same | same | same | fail | see mapping |
| gesture thresholds distinguish a tap, a cancelled drag and a committed dismissal | `Cannot find module .../src/interaction-logic.js` | Jarvis does not ship `src/` | Loud refusal. No root fallback | fail | see mapping |
| custom press physics owns touch and pen, not mouse clicks | `ENOENT` on `src/astra-motion.js` | same | Loud refusal | fail | see mapping |
| navigation direction follows the dock and accepts an explicit back route | missing `src/interaction-logic.js` | same | Loud refusal | fail | see mapping |
| site-wide content choreography is shared, viewport-aware and bounded | `ENOENT` on `src/astra-motion.js` | same | Loud refusal | fail | see mapping |
| mobile motion avoids offscreen GPU layers and costly document snapshots | `ENOENT` on `src/astra-motion.js` | same | Loud refusal | fail | see mapping |
| direct interaction motion never exceeds the 360ms release budget | `ENOENT` on `src/astra-motion.js` | same | Loud refusal | fail | see mapping |
| View Transition callbacks cannot reorder or stall visible state | `ENOENT` on `src/astra-motion.js` | same | Loud refusal | fail | see mapping |
