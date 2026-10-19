# Podcasts P1 — implementation evidence

Implemented on `feat/podcasts-mobile-polish` from current main `f4f617ba228ec131c68dd881b8e314f4070689a1`. Not merged or deployed. All displayed shows, artwork and notes are synthetic. Browser evidence exercises the actual emitted module with real, decoded three-minute PCM audio, not a simulated media object.

The listening journey now has separate episode details/transport/download/options targets; cancellable row holds; connected, reversible player/artwork motion; header-only dragging; and nested history/focus restoration. Manrope, Discover/Library/Downloads/Queue, the single persistent audio element, source resolution, follows, progress, queue/autoplay, speed, sleep and offline downloads remain. No dependency, backend, CSP, storage-schema or release-system change.

Craft decisions applied:

- *Apple, Designing Fluid Interfaces*: respond immediately and allow new intent to interrupt motion. A closing player can be grabbed and reopened; transport never waits for animation.
- *Rauno, Invisible Details of Interaction Design*: retain spatial relationships and distinguish intentional gestures. Artwork travels between the mini and expanded player; holds cancel for scrolling and multi-touch without firing a click afterward.
- *Emil, Building a drawer component*: update the surface transform directly and separate drag from scroll. Dedicated headers own drag input; seeking and notes scrolling retain their own behavior. Native dialogs retain modality through exit.

## Review the working journey

Build and start the isolated preview using the same source files:

```sh
npm ci
npm run build
node tests/helpers/podcasts-browser-fixture.mjs dist 4173
```

Open `http://localhost:4173/podcasts/`. Providers and API configuration are local synthetic fixtures. The preview adds a stricter response CSP to block external providers; production document CSP is unchanged. It can exercise follows, downloads, queue, real audio, speed, sleep and the scoped worker without touching production. No additional server dependency is needed. A portable built-preview ZIP is also included with the task deliverable.

For phone review, use a reachable preview origin; localhost on the phone refers to the phone. Localhost/HTTPS is required for service-worker downloads. An ordinary HTTP LAN preview can demonstrate streaming/interactions but cannot establish offline acceptance. No public hosted preview or new hosting service was created.

[Journey recording](journey.webm) shows search, show filtering/pagination, details → options → Back, playback, expansion, speed/sleep, nested Back, drag reversal/dismissal and return to the same search position. The recording uses desktop touch emulation; audio playback continuity is asserted separately, since Playwright video records no sound.

Matched screenshots use the same synthetic show/episode, 390 × 844 viewport and settled state:

| State | Before | After |
| --- | --- | --- |
| Discover | [Before](before/discover.png) | [After](after/discover.png) |
| Show / episodes | [Before](before/show.png) | [After](after/show.png) |
| Expanded player | [Before](before/player.png) | [After](after/player.png) |
| Nested Sleep sheet | [Before](before/sleep.png) | [After](after/sleep.png) |

## Verification

Local runtime: Node v24.19.0, Chromium 154.0.8037.57, Linux. These are diagnostic checks, not a substitute for required CI's approved release runtimes. Recording used the installed system FFmpeg 7.1.5 through Playwright's expected helper path.

| Command | Result |
| --- | --- |
| `npm ci` | Passed; no dependency changes |
| `npm run build` | Passed; 243 frontend files, 20.40 MiB, below the existing 25 MiB cap; no media payloads in the app artifact |
| `npm run test:podcasts` | 33 passed: 22 existing provider/security/state checks and 11 built-module browser cases |
| `npm test` | 1,076 passed, zero failed/skipped; includes the browser suite |
| `PODCAST_EVIDENCE_DIR=<directory> node --test --test-name-pattern='built browse' tests/podcasts-mobile-browser.test.mjs` | Passed; regenerated the journey recording and playback metrics with browser Back and drag reversal |
| `git diff --check` | Passed |

The browser suite builds the current frontend through the real build recipe in an isolated temporary checkout. It covers held-row options versus scroll/cancel/multi-touch, direct finger tracking, short-drag reversal, pointer cancellation, interrupted opening, re-grabbing a closing player, nested Back/Escape/focus, paused/playing continuity, queue ordering/played filters, failed/cancelled downloads, async query races, reduced-motion changes and absence of Web Animations.

Layouts exercised: 320 × 568, 360 × 640, 390 × 844, 412 × 915, and 740 × 360. Seeking, transport, Sleep and expansion remain separate mini-player actions. Existing required CI is unchanged and must pass for the PR.

Offline upgrade uses the actual prior v4 controlled shell from Git history. A real downloaded WAV, follows and progress survive v5 activation while the old tab continues playing, then the new module reopens offline and resumes the saved position. Audio cache identity stays `jarvis-podcast-audio-v1`; a seeded legacy artwork cache entry remains byte-for-byte intact. Local fixture artwork is HTTP, so this demonstrates artwork-cache retention rather than production HTTPS-art fetching. No storage clear or download deletion is used.

## Performance evidence and limits

[Raw diagnostic summary](performance.json). Chrome DevTools timeline traces and the Playwright trace are retained in the task artifacts, outside Git. Same fixture, 390 × 844 viewport, 4× CPU slowdown, three player/sleep/Back cycles and one header drag/reversal per run:

| Local diagnostic | Before | After |
| --- | --- | --- |
| Sampled frame interval p95 | 16.8 ms | 16.8 ms |
| Tasks longer than 50 ms | One: 56 ms | Two: 61 and 52 ms |
| JS + CSS raw bytes (`app`, `style`, new `motion`) | 75,178 | 84,863 |
| Same files gzip size | 21,120 | 24,131 |

Incremental code/style is 9,685 raw bytes / 3,011 gzip bytes, with no new library. The fixture server serves uncompressed assets; gzip is a size comparison, not a claim about production response encoding. Removing the redundant row/notes redraw from player opening avoids unrelated UI work. There are still isolated >50 ms tasks under artificial slowdown; this is not a zero-jank or field-INP certification, and one run does not establish a statistical performance improvement.

**Physical-device limits:** no Samsung Galaxy A15 was attached. Real browser-toolbar/keyboard resizing, hardware/edge Back, TalkBack, system text enlargement, Bluetooth focus, lock-screen/long-background playback and the owner's additional browser remain unverified. The automated emulation and recording do not establish A15 feel. A live-provider smoke was not performed in this environment, whose outbound policy restricts production/provider origins. Production behavior remains unverified until an authorized release and live Podcasts check.

## Release boundary

Use the existing unified frontend publisher after explicit merge/release authorization: review the merge commit, require its successful main Validate artifact, then dispatch Deploy to Azure Storage with the exact reviewed SHA. Retain its pre-write rollback artifact and conditional-write/readback guards. Verify the Podcasts journey on the actual production origin, including a previously controlled session, in addition to the publisher's existing Board/private checks. This branch changes no manual source pins, credentials, settings or deployment identity.
