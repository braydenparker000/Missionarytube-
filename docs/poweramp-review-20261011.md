# Poweramp playback ownership review — 2026-10-11

Base: `8ca912e1cc0f3751bf852d6373267322c79755ff`, the active
`release/astra-live-backport-20261009` branch. The Poweramp and music-delivery
files match the previously tested release; this candidate builds on the landed
recovery and Media Session work rather than reintroducing it.

## Demonstrated defects and changes

1. **Sleep completion outlives cancellation.** The original expiry callback
   scheduled an untracked second timeout. Off or a replacement timer cleared
   only the first timeout. The second callback could pause a newer selection or
   an explicit resume. The fade now has an owned completion, cancellation
   restores its slot gain, and the sleep timer has a generation fence. Expiry
   cancels a pending source load; native end during an active sleep fade stops
   instead of advancing, and automatic crossfade cannot supersede that fade.
   A deliberate selection/resume retires an already-expired fade. A timer which
   has not yet expired remains scheduled across ordinary track changes.
2. **Deletion corrupts occurrence indices.** `removeTracks` filtered `queue`
   without remapping `order` or `pos`. In a shuffled queue containing duplicate
   occurrences, Next could choose the wrong occurrence or an absent index.
   Deletion now preserves surviving occurrence order, cancels obsolete spare
   transitions, and removes pending explicit entries. Deleting the selected
   song invalidates its pending read, releases playback, and selects the first
   surviving occurrence **paused**. It does not silently autoplay a replacement.
   The in-memory update happens before storage awaits.
3. **Stop leaks the selected local object URL.** Stop now uses the existing
   slot-release path for both elements, including URL revocation and transition
   ownership cleanup.

No HTML, CSS, layout, icons, gesture thresholds, codecs, EQ coefficients,
normalization targets, delivery policies, worker configuration, or dependencies
change. The only existing test fixture adjustment supplies the new sleep-cancel
method to a deliberately stubbed transport wrapper. The render performance
fixture pins the new full-source fingerprint; its frozen baseline, scenarios,
geometry/pixel thresholds and timing gates are unchanged.

4. **Worker timeout strands queued tags.** Deadlines previously started while
   jobs were queued, and timeout left the worker busy. Queued jobs could miss
   their only deadline and never resolve. Deadlines now start on dispatch; a
   failed or stalled pool is terminated and all outstanding jobs fall back to
   the existing parser. Stop settles active and queued promises, releases the
   worker URL, and rejects old worker messages/errors after a restart.
5. **Background work revives deleted records.** Local file reads could refill
   the file cache after deletion, and late metadata/duration results could
   persist removed or replaced records. These completions now check the live
   record identity; background blob batches skip deleted entries. Clear Library
   stops pending playback before awaiting storage. A retired metadata job does
   not mark a replacement record as already repaired.
6. **An unreadable file strands scanning.** A rejected handle read escaped the
   import's per-file processing and left the scanning flag set. Unreadable audio
   is now counted as a failed item; unavailable folder art is ignored. The real
   Chrome regression imports a readable file alongside the rejected handle,
   then successfully imports a second file.

## Ownership map and review coverage

| Area | Owner and invariant reviewed | Coverage / outcome |
| --- | --- | --- |
| Selection / autoplay | `Engine._playRequest`, `_loadingRequest`, `_playIntent`; source completion checks generation | Selection changes retire old reads; Pause invalidates pending starts. Deletion now uses the same cancellation boundary. |
| Actual playback | two native audio slots; `_playAttempt`, `_mediaStarted`, native readiness and AudioContext state | Intent is distinct from flowing audio. Rejected play, stale playing, missing pause, context interruption, and duplicate ends remain covered by existing engine and Chrome regressions. |
| Recovery | request + slot + source + track-bound R2 token; one retry per selection | No added blanket retries. Offline source-error evidence is bounded; decode/unsupported errors stay terminal. Seek, Pause, replacement selection and online callbacks retain their existing fences. |
| Delivery / catalog | `r2-api.js`, `r2-library.js`, `drive-api.js`, `drive-catalog.js`, `backend/music.js`, native delivery in `music-upload.js`, `music-library-cache.js` | Reviewed bounded catalog reads, hash/size identity, atomic commits, conditional object GET, Range/If-Range, HEAD, 304/416 and CORS. No delivery mutation. Existing delivery and catalog tests plus prior real R2 measurements are reused. |
| Queue / shuffle | `PlaybackQueue`, `resolveTrackStep`, `commitTrackStep`, installed `buildOrder` and transition wrapper | Queue occurrences are indices, not unique IDs. Reviewed repeat, explicit queue return, source filtering, rapid commands and preload. New deletion regressions include duplicates, shuffled order, all-removed and pending-load cases. |
| Seeking / input | `InputLifecycle`, transport binding, waveform, art and mini gesture commit, scene/navigation ownership | Seek commits retain selection generation and playback intent. Artwork promises cannot authorize transport. Existing tap, swipe, regrab, seek, history and rendering suites exercise these paths; no interaction redesign. |
| Lifecycle / Media Session | synchronous handler registration; metadata version fence; pagehide/freeze checkpoints; pageshow/resume/visibility reconciliation | The earlier handler and stall fixes remain in place. Sleep completion now follows the same cancellation principle. Synthetic lifecycle events are not proof of an OS suspension. |
| Persistence / local sources | IDB wrapper, checkpoint restore/remap, roots/permissions, file lookup, scan/cache/duration/metadata jobs, playlists/bookmarks | Reviewed source acquisition and saved-queue ownership. New regressions cover late local reads, metadata/duration writes, removed cache batches, worker deadline/drain ownership and per-file read failure. No database migration or parser replacement. |
| Audio fidelity / resources | `AudioQuality`, graph, gain ledger, worklet/fallback, `audio-core.js`, analysis binding | Transparent/custom routing, guard fallback, overlap reserve and worklet cleanup remain unchanged. New work only cancels obsolete sleep gain ramps and releases local URLs. Existing fidelity tests remain the numerical evidence. |
| Remaining presentation/configuration | settings bindings/schema, list/search presentation, shared scene implementation and boot wiring | Inventory and integration review, with existing rendering/interaction tests. Static embedded icon/preset data is unchanged; this is not a new exhaustive visual or every-setting certification. |

The additional local-job and worker audit targets were investigated to failing
reproductions and fixed in this candidate. The review still does not establish
that every importer/database interleaving or every browser/OS combination is
correct. File acquisition, parser results and actual audio output are distinct
owners; tests intentionally exercise their cancellation boundaries separately.

## Reproduction and validation

The public-safe evidence directory contains the exact source hashes, results,
and commands. Twenty-two new engine/background regressions fail on the frozen base. All three
new Chrome scenarios also fail on the base: cancelled sleep still pauses,
library deletion leaves the old order indices, and an unreadable file aborts
scanning. None of these regressions is a retry
or a relaxed assertion. The Chrome sleep test observes native audio time beyond
4.2 seconds without a virtual clock; the queue test uses the actual Delete
confirmation and registered Media Session callbacks.

Final implementation: `896c90d66afa53908e0e6c87f84dba7814522c70`.
Local results: 279/279 targeted checks, 14/14 native Chrome checks (13 scenarios
plus their parent), 105/105 Python R2 tests, and all three serial performance
gates pass. The full Node 22.23.3 aggregate reports 2662 passing, 2 failing
(the external archive-cover timeout and its parent), and 1 opt-in live podcast
skip out of 2665 tests. No Poweramp test fails. All 10 hosted checks passed on
the implementation commit; evidence-only publication creates a separate head.

Validation results are recorded in
[`results.json`](evidence/poweramp-review-20261011/results.json).
There is no generic build command in this repository. Required browser,
transport, numerical, delivery, Python and performance checks are listed there;
external-service failures and runtime setup failures are not counted as passes.

## Reused live evidence and limits

[`prior-live-acceptance.json`](evidence/poweramp-review-20261011/prior-live-acceptance.json)
is the exported prior acceptance summary, **not a test of this candidate**.
Its player hash is `10009870adbabe88db873f5b5f1af7f47acd50d5471a37c8f9700b169f5811b0`.
It records 416.896 seconds of observed real R2 playback with two automatic
transitions, plus a separate 408.753-second control/recovery session containing
70 Next/Previous callbacks, paused seeking, transient offline recovery, and
cancellation by Pause or replacement selection. The first session's complete
sampler history was not retained; exported checkpoints are the durable evidence.
The existing release check also measured three actual delivered objects for
hash, decode, Range, HEAD and CORS.

Generated PCM fixtures validate local decoding and state ownership. Direct
invocation of registered Media Session handlers does not verify Bluetooth or
headphone dispatch. The prior cloud browser did not actually become hidden or
freeze despite accepting lifecycle commands. Physical Android, locked-screen,
audio-focus and headphone verification remain required. No claim is made that
the exact reported phone behavior is fixed from browser fixtures alone.

This is a draft candidate for independent review. Merge, deployment and final
on-device acceptance remain with the release coordinator.
