# Podcasts 1.2 release handoff

Draft PR: https://github.com/braydenparker999/jarvis/pull/95
Branch: `design/podcasts-release-20261010`
Verified implementation commit: `56f726f29908fcc75890a9266197180a464c11e7`
Base: `06d1f26a1da1b2154b7a54bf113bcd781b7064b2` on `release/astra-live-backport-20261009`.
Status: draft only; no merge, deployment or counterpart edit performed. The original broad local run below used the wrong toolchain and is historical, not qualification. See the qualification follow-up in this folder for matching controls and exact supported pins.

## Delivered

- Podcast-only dark surfaces, restrained blue accents, local OFL Manrope typography, legible artwork/title/author and compact search rows.
- Search history with clear action, topic URLs, accurate directory context, loading/empty/error/offline states and stale-result protection.
- Compact show header with descriptions/publisher links together; explicit scope for episode search; restored filters, loaded row count and scroll when returning.
- Direct episode download/cancel/manage actions with truthful saved labels; removal clears stale labels; real Cache Storage downloads and range playback remain intact.
- Compact player with separate 48px seek target, elapsed time and direct sleep timer access. Expanded player retains speed, skip, all timers, download/options and collapsible notes.
- Same-URL dialog history makes browser Back close one layer before leaving the show; Escape/Close restore native focus. Show Back returns to the originating search, topic or library.
- All previous useful podcast features retained. No fake discovery data, fake downloads, paid service, credentials, account changes, Poweramp UI changes or shared stylesheet edits.

## Slider audit follow-up

Independently inspected the current code and Chromium accessibility tree during actual fixture playback at 25 seconds. No literal `aria-valuetext="not available"` was reproduced. The attribute was absent and the enabled native slider exposed only `25`, without elapsed/total units. This was a real accessibility gap.

Both sliders now set readable `aria-valuetext` and an associated accessible description, including seek previews, elapsed/total units, unknown duration and unloaded/resume state. Chromium 151 in this executor exposes the native numeric value even for a minimal standalone range with aria-valuetext, so the description provides a verified additional path. The browser-tree regression confirms “25 seconds of 1 minute”; native controls and keyboard seeking remain intact. Physical TalkBack speech was not tested.

## Commits and integration

1. `47f5a88d587c1bd008a45d3f27a20526d86ad04c` — existing data-only directory fix, cherry-picked from main's `2007d661af7f7f171d674e8b910b5d4234b9a571`.
2. `e5cea48d8adc0af813af89703973c1c965409911` — browsing/listening/navigation release.
3. `56f726f29908fcc75890a9266197180a464c11e7` — readable seek values and accessible loading state.

Integrate all three in order onto the active release branch. If the destination already contains the data-only fix, apply the final two. Do not merge unrelated main history. Implementation diff against 06d1f26a: 18 files, 836 additions, 114 deletions, plus the 43,448-byte local font. A final evidence-only commit adds this report and eight screenshots.

Scope: `public/podcasts/`, podcast tests/fixtures/docs, `scripts/verify-podcast-ui.mjs`, existing directory normalization in `backend/podcasts.js`, and only the `/podcasts*` CSP entry in `public/staticwebapp.config.json`. The CSP removes Apple script execution and allows same-origin fonts. Podcast shell cache v4 retains audio/artwork caches and existing listening storage keys.

Release lead owns merging, updating the source pin in `braydenparker000/Missionarytube-`, deployment and post-deployment verification. Include the font and scoped CSP change. Do not deploy this branch independently.

## Exact checks

| Check | Outcome |
| --- | --- |
| Final focused suite: `JARVIS_CHROME=/usr/bin/chromium node --test tests/podcasts.test.js tests/podcast-directory-contract.test.js tests/podcasts-browser.test.js` | **42 passed, 0 failed, 1 skipped** (43 total). The skip is the optional deployed-live browser test; real services were checked separately below. |
| `node scripts/verify-podcasts.mjs`, through the executor's configured proxy/CA | **Passed**: real directory, RSS and audio ranges; History That Doesn't Suck, The Daily, The Diary of a CEO. |
| `scripts/verify-podcast-ui.mjs` with actual provider services | **Passed** on final code: discovery, search, show episodes, advancing publisher audio, player/mini-player and 320–1200px overflow checks. This intercepts candidate frontend files only inside an isolated browser at the existing origin; nothing is deployed. |
| axe-core 4.10.3, WCAG 2 A/AA and 2.1 AA | **Zero violations** on all five screens: discovery, search, show, expanded player and mini-player. |
| Focused mobile behavior | **Passed**: 320/360/390/430/1200px layouts, selected 48px targets, local font load, reduced motion, keyboard Escape/focus, browser Back layers, delayed search, stale show navigation, direct cancellation, honest saved states, offline reload/resume/ranges, speed, queue and timers. |
| Syntax checks and `git diff --check` | **Passed**. Working tree clean after commit. |
| Broad `JARVIS_CHROME=/usr/bin/chromium timeout 300s npm test` | **Completed, failed**: 2169 passed, 92 failed, 2 skipped; 2263 total, ~222s. No timeout. This ran before the final accessibility-only follow-up; that follow-up passed the final focused and real-service checks. |
| Baseline `06d1f26a` Poweramp history suite | **8 passed, 4 failed** (three failing cases plus parent suite), reproducing the candidate broad-run history timeouts without podcast changes. |
| Initial broad `npm test` without explicit browser path | 2090 passed, 19 failed, 80 skipped; superseded by the configured-browser run. A leftover native-browser test process was stopped after failure. |
| Initial direct-network live check | Failed due executor outbound proxy requirements; superseded by successful proxied real-service checks. |
| Root build | Not applicable: this static source package has no `build` script. Deployment counterpart build was not run or changed. |
| Physical Android/TalkBack, background/lock-screen playback, OS eviction, post-deployment cache propagation | **Not run**. Release-lead/device checks remain. |

Broad-run failure details: 72 leaf checks fail the Relay approved-Node gate (requires Node 22.23.3 or 24.21.0 and Chrome for Testing 154.0.8037.97; executor had Node 24.19.0/Chromium 151). Other leaf failures are five browser-policy-blocked file:// previews, two downloaded-preview navigation failures, three baseline Poweramp history timeouts, and one My Media real-artwork timeout. Failed parent suites account for the remainder of the 92. These modules were not modified. The full repository is not claimed green.

## Screenshot pack

- `podcasts-before-discovery-fixture.png`, `podcasts-before-show-fixture.png`: original deterministic baseline.
- `podcasts-offline-show-fixture.png`: explicit offline/saved-feed state using fixture data.
- `podcasts-1.2-discovery.png`, `podcasts-1.2-search.png`, `podcasts-1.2-show.png`, `podcasts-1.2-player.png`, `podcasts-1.2-mini-player.png`: candidate UI using actual directory/publisher metadata and artwork at 390×844. The five real-content screenshots were refreshed with Chrome for Testing 154 after the navigation/refresh/provenance review fixes. The offline fixture screenshot was refreshed from the corrected candidate run.

Library delivery was attempted through the current Library prepared-upload helper and failed at authorization (HTTP 401 during tool discovery), before any upload was created. The complete screenshot pack is therefore retained in this PR’s `docs/evidence/podcasts-release-20261010/` folder. Library delivery remains blocked pending connector authorization.

The original handoff was followed by independently reproduced dialog-history edge cases and a hidden show Refresh regression; both are corrected and regression-tested. Discovery no longer implies country provenance for a global fallback. Integration remains gated on the exact corrective head’s hosted checks and release-lead/device verification. Awaiting parent coordination; no other modules are being expanded.
