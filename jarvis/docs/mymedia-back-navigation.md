# MyMedia Back-navigation investigation, October 8, 2026

The release failures were caused by the browser test reading the old view after native fragment navigation changed the URL and before MyMedia's `hashchange` handler restored the destination view. The investigation reproduced that interval in the actual application. No persistent loss of creator search or sort state was observed.

The browser test now waits for both the destination URL and the rendered browse heading with the library visible. It then checks the original search, sort and video-count assertions. A wrong restored value still fails the assertion; a destination that never renders fails the bounded readiness wait.

## Retained CI evidence

All three source/deployment frontend executions below used source `c4d62409a3b67e4e5dac88809c6a4a0290b6e39e`, Node **22.23.3** and the checksum-verified Chrome **154.0.8037.97**. The source attempt-2 job freshly executed the same tests. The deployment attempt-2 qualification reused that verified source proof, so it is not counted as another fresh passing navigation execution.

| Execution | Frontend job | Evidence |
| --- | --- | --- |
| [Source run 37802921637, attempt 1](https://github.com/braydenparker999/jarvis/actions/runs/37802921637/attempts/1) | 113399648689 | `quiet !== Preview` at the creator Back assertion, original line 160 |
| [Same source run, attempt 2](https://github.com/braydenparker999/jarvis/actions/runs/37802921637/attempts/2) | 113402400295 | Same creator navigation subtest passed with unchanged source |
| [Deployment run 37804062718, attempt 1](https://github.com/braydenparker000/Missionarytube-/actions/runs/37804062718/attempts/1) | 113403940063 | Same assertion and values failed |

The three downloaded frontend artifacts matched their GitHub ZIP digests. They contain fictional MyMedia screenshots taken before Back, but no browser trace of the failing transition. The diagnosis therefore relies on the additional local browser reproductions, rather than inferring a route bug from those screenshots.

## Browser reproduction and causality

The diagnostic flow loaded the complete MyMedia application with the existing fictional Drive/media fixture. It used real links, menu playback, an Up next video, in-app Back, browser Back/Forward, and reload. It did not replace the application's router or history implementation.

- In 20 unobserved Node 22 flows, 18 reached the original Back assertion. Fifteen immediately read `quiet` after `waitForURL` had accepted `#creators`; all 18 subsequently restored `Preview` and retained creator `quiet` / `title` through Back, Forward and reload. The other two flows failed an earlier immediate creator-count assertion before the destination render.
- Six additional flows with event observation and Playwright tracing all completed. The trace observer recorded native `#creators` while the old heading was `Preview channel` and the search was `quiet`; the following rendered frame showed `Creators` and `Preview`. One recorded interval was 16.6 ms. Tracing changed the timing and those six flows did not reproduce the immediate stale read.
- After adding render readiness, 20 unobserved flows and four flows under CDP CPU throttling at rate 6 completed with no immediate stale reads.
- The shipped regression holds delivery of one `hashchange` after actual native Back changes the URL. Readiness must time out while the old screen remains visible, then succeed after event delivery resumes. Replacing the helper with URL-only waiting makes that regression fail with `Missing expected rejection`.

The change broadens the original state-preservation flow to 360, 390, 430 and 1200 pixels and adds explicit Forward-state assertions. The existing assertions, browser requirement, external artwork check and qualification gates are retained. Screenshots after Back are emitted through the existing CI evidence directory.

[Machine-readable evidence](mymedia-back-navigation-evidence.json) records exact runtime, artifact digests, counts and a fictional event timeline. Playwright documents [URL navigation waiting](https://playwright.dev/docs/api/class-page#page-wait-for-url) and the separate [locator value read](https://playwright.dev/docs/api/class-locator#locator-input-value); the concrete event ordering above was measured in this application.

## Validation and limits

The four viewport flows plus the held-event regression passed as six counted focused tests on Node 22.23.3 and Node 24.21.0, with Chrome 154.0.8037.97 and zero skips. The three MyMedia unit-test files passed **22/22**, zero skips. These focused local runs are not a full qualification claim.

The first unchanged full-file local attempt passed navigation but hit the existing 30-second real-archive-image readiness limit. That external image check remains in the suite and exact-head CI must cover it. No broader application reliability or physical Android-phone acceptance is claimed.

The patch changes browser tests and this investigation record. Production application files and the live source/deployment release are preserved. Merge and any deployment remain subject to independent parent review of the draft PR.

Run the complete shipped browser test with the repository-pinned Chrome and Node binary:

```sh
JARVIS_CHROME=/path/to/chrome154 /path/to/node22.23.3 --test tests/mymedia-layout-browser.test.js
```
