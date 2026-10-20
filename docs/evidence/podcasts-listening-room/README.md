# Jarvis Podcasts — Listening Room review

Implemented on `feat/podcasts-listening-room`. Implementation/regressions: `1a0ea31`; placeholder contrast refinement: `5ef8611`. Measured source revision: `5ef8611b604f96e1bf50779e6b3cb7615edb104b`.
Baseline: `0dfa38c9dfc1f2130e684652fa35d53769bb7fce`. No merge or production deployment.

[Before/after gallery](gallery.html) · [Player trace](after/player-journey-trace.zip) · [Queue touch trace](after/queue-journey-trace.zip) · [Raw performance results](after/metrics.json) · [Baseline results](before/metrics.json) · [Source SHA-256 manifest](source-sha256.txt).

## What changed

- The Listening Room palette, local licensed Instrument Sans with Manrope/system fallback, deliberate typography, larger show/player artwork, flat artwork grids, compact navigation and responsive landscape player.
- Discover features a real directory result, native topic rail with retained position, genuine Continue listening rows, and search history available while searching. Library shows unfinished episodes and followed artwork. Submitted queries and scroll positions survive navigation; scroll restoration runs atomically with rendering.
- Show details uses a compact 136px cover (128px narrow), independent Play/Download/More targets, expandable description, full-title details and bounded rendering for large feeds.
- Player artwork and title travel continuously between measured mini/full positions. One modal image proxy is cleaned up at completion; the actual audio never participates in motion. Reversal, re-grab, interrupted close, second contacts, viewport changes and reduced motion retain operable modal/history state.
- Queue handles track pointers, animate displaced neighbors, scroll near edges, restore cancelled orders and persist exactly once on commit. Keyboard Up/Down/Home/End and menu moves remain available; menu moves calculate against the current order after autoplay changes it.
- Downloads expose transferred bytes, progress, saved size, cancellation, failure/retry and quiet completion status. Discover resume actions refresh independently of the directory grid.
- Shell cache is v6 / Podcasts 1.4.0. Audio/art cache names, storage key/schema, IndexedDB format, provider contracts and persistent audio element remain unchanged. Frozen `jarvis/` source is untouched. No dependencies added.

## Visual evidence

The [gallery](gallery.html) presents original screenshots at CSS pixel size. All content is clearly synthetic fixture data, never fabricated user history or editorial endorsements. Saved progress was produced through actual fixture audio playback and seeking.

| Screen, 390 × 844 | Before | After |
| --- | --- | --- |
| Discover | [PNG](before/discover.png) | [PNG](after/discover.png) |
| Loading | [PNG](before/discover-loading.png) | [PNG](after/discover-loading.png) |
| Empty results | [PNG](before/discover-empty.png) | [PNG](after/discover-empty.png) |
| Search | [PNG](before/search.png) | [PNG](after/search.png) |
| Library | [PNG](before/library.png) | [PNG](after/library.png) |
| Show details | [PNG](before/show.png) | [PNG](after/show.png) |
| Active download | [PNG](before/downloads-active.png) | [PNG](after/downloads-active.png) |
| Completed downloads | [PNG](before/downloads.png) | [PNG](after/downloads.png) |
| Queue | [PNG](before/queue.png) | [PNG](after/queue.png) |
| Now playing | [PNG](before/player.png) | [PNG](after/player.png) |
| Expanded episode options | [PNG](before/options.png) | [PNG](after/options.png) |

Additional captures: [320px Discover](after/discover-320x568.png), [320px player](after/player-320x568.png), [360px player](after/player-360x640.png), [412px player](after/player-412x915.png), [landscape](after/player-740x360.png), [Discover with progress](after/discover-with-progress.png), [reordered queue](after/queue-reordered.png). Full-size images are retained, not downscaled contact sheets.

The five text/accent/status tokens have contrast ratios of at least 6.60:1 on the elevated surface (and higher on the canvas). Placeholder text explicitly uses the secondary-text token. Visible focus and browser zoom remain available. This palette calculation is not a full assistive-technology audit.

Reviewed at actual image resolution: Discover, Library, Show, Downloads, Queue, full player, options, and narrow/landscape layouts. Iteration corrected the transition capture timing, crowded search history, and the real interaction defects recorded below.

## Measured performance

Environment: headless Chromium 154.0.8037.57, Node v24.19.0, linux 6.18.55, AMD EPYC 9V74 80-Core Processor, 5 logical CPUs; 390 × 844, DPR 1, touch/mobile emulation, no CPU throttling. Providers are deterministic local data fixtures with real 180-second PCM audio. Timing windows run without screenshots or tracing and separately from test runs.

| Interaction | rAF interval p95 | Maximum interval | Intervals >25 ms | Long tasks ≥50 ms | Maximum reported Event Timing |
| --- | ---: | ---: | ---: | ---: | ---: |
| open-player | 16.7 ms | 16.8 ms | 0 | 0 | 16 ms |
| close-player | 16.7 ms | 16.8 ms | 0 | 0 | 24 ms |
| library-tab | 16.7 ms | 16.8 ms | 0 | 0 | 16 ms |
| show-entry | 16.7 ms | 16.7 ms | 0 | 0 | 24 ms |
| queue-drag | 16.8 ms | 16.8 ms | 0 | 0 | 32 ms |

Pointer-contact → next-animation-frame samples: p95 15.6 ms; maximum 16.7 ms (34 samples across the capture journey). This is a scheduling diagnostic, not direct paint detection; these samples include traced portions. CSS press feedback begins on contact.

The baseline also had approximately 16.7–16.8 ms p95 frame intervals and no long tasks in its four timing windows. These results show no observed regression in this lab run; they do **not** establish improved device smoothness or field INP. Chromium omits Event Timing entries below the configured 16 ms threshold. The samples are small and not statistical field telemetry.

During the after interaction journey, real audio advanced from 42.38s to 47.18s, stayed playing, retained the same source/node, and stayed at 1 source load. Queue trace demonstrates handle reordering; baseline trace uses the existing menu fallback. Audio continuity is also asserted by the regression suite.

## Validation

See [command results](commands.txt) and [Podcasts regression log](podcasts-tests.txt).

- `npm test`: 1,084 passed; no skipped tests. This covers the repository deployment/build-contract suite and browser regressions. The final contextual-search-history refinement was subsequently covered by the full affected suite below.
- `npm run test:podcasts`: 41 passed; no skipped tests, including directory/RSS/backend contracts and built-app browser journeys.
- `npm run build`: passed, frontend and Worker artifacts generated. Every built Podcasts file was compared byte-for-byte against source; hashes are in the manifest.
- `node scripts/podcasts-review.mjs --root dist --out docs/evidence/podcasts-listening-room/after`: passed, 21 screenshots, two traces, no page errors or horizontal overflow.
- `git diff --check`: passed. Complete diff/privacy review found no credentials, private provider URLs, user content or unrelated source edits.

Functional coverage includes follow/library, search/categories, show filtering/sort, independent playback/options/download actions, long press vs scrolling and multitouch, seek/skip/speed/sleep, queue commit/cancel/keyboard/menu/edge-scroll/autoplay, nested Back/focus, rapid transport taps, player re-grabs/rotation/lifecycle suspension, notes scrolling, missing artwork, long multilingual titles and 500-episode fixtures. A previous v5 shell upgrades during playback; downloaded audio, art and state survive offline reload and seeking. The previous fixture restores historical motion code too.

Review fixes were validated causally: stable-container pointer capture prevents drag cancellation when rows move; synchronous restoration prevents a delayed frame overwriting a new scroll; Discover row updates preserve the directory DOM; relative queue actions use the live index after real autoplay advances.

## Limits and release boundary

- **Physical Samsung Galaxy A15 verification is unavailable and remains required.** Android system Back/edge gestures, actual on-screen keyboard, TalkBack, OS font scaling, battery/background behavior and sustained scrolling on that hardware are unverified. CDP lifecycle freeze/resume and browser Back are lab evidence only.
- CI qualification on the repository's exact pinned runtimes is pending remote access. Local Node is v24.19.0; local Chromium is listed above. Full backend-only CI is not claimed; affected podcast backend tests passed.
- A show-cover transition falls back when the original/destination art differs, the target is offscreen, data takes over 450 ms, or motion support is unavailable. Player dismissal uses ordinary sheet motion when its cover has been scrolled out of view. Reduced motion uses immediate functional states.
- No artwork color extraction or decorative blur was introduced. Missing artwork uses the existing local placeholder; unsupported scripts fall back to system fonts.
- Failed download UI is session-local and is not saved as completed content. Existing persistent storage formats were deliberately retained.
- Live Azure comparison was not completed: the release-time inspector remained pending in this environment and was stopped. No production write was attempted. Production comparison, pinned CI and owner-authorized release remain separate gates.
- GitHub CLI reports invalid/unavailable authentication. Remote publication/PR status is recorded in the delivery note below; no authorization to merge or deploy is inferred.

## Exact implementation files

```text
frontend/podcasts/app.js
frontend/podcasts/fonts/InstrumentSans-OFL.txt
frontend/podcasts/fonts/README.md
frontend/podcasts/fonts/instrument-sans-latin.woff
frontend/podcasts/index.html
frontend/podcasts/motion.js
frontend/podcasts/navigation-motion.js
frontend/podcasts/queue-motion.js
frontend/podcasts/style.css
frontend/podcasts/sw.js
scripts/podcasts-review.mjs
tests/podcasts-mobile-browser.test.mjs
```

The separate evidence commit contains this report, gallery, screenshots, traces, logs and source hashes. The capture tool marks its default source mode `workingTree: true`; this final run used the committed build. The revision and byte manifest identify the measured source precisely.

## Delivery status

The implementation and evidence are pushed to [`feat/podcasts-listening-room`](https://github.com/braydenparker000/Missionarytube-/tree/feat/podcasts-listening-room). [Review the branch diff](https://github.com/braydenparker000/Missionarytube-/compare/main...feat/podcasts-listening-room). Evidence commit: `900d760`; source commits are recorded above.

A draft PR was attempted using the prepared [PR description](PR.md), but GitHub rejected `POST https://api.github.com/graphql` with `Forbidden`. No live PR was created. The repository-provided [create-PR link](https://github.com/braydenparker000/Missionarytube-/pull/new/feat/podcasts-listening-room) targets the pushed branch. Remote CI, owner review and release authorization remain outstanding. No merge or deployment was attempted.
