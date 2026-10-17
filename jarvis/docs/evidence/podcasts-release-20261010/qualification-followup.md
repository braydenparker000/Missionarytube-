# Qualification follow-up

This supersedes the initial local toolchain interpretation in the original handoff. No workflow, toolchain guard, baseline reference, or strict test assertion was weakened. The final PR checks must be inspected against the corrective commit’s exact head; a prior head’s successful run does not qualify a later commit.

## Source and implementation order

Base: `06d1f26a1da1b2154b7a54bf113bcd781b7064b2`.

The original three implementation commits are:

1. `47f5a88d587c1bd008a45d3f27a20526d86ad04c` — backport the existing main data-only directory fix.
2. `e5cea48d8adc0af813af89703973c1c965409911` — podcast browsing, listening, navigation and saved states.
3. `56f726f29908fcc75890a9266197180a464c11e7` — accessible seek positions and loading descriptions.

`0d168ef0e5340ef3147aa24489995b8981fa12ac` added review evidence. The following corrective commit contains the changes described below and is also required for integration. Read its exact SHA and final hosted run links from PR #95’s current head/checks and final handoff; do not integrate only the original three commits.

## Supported runtime identity

The repository’s unchanged qualification recipe specifies Ubuntu 24.04 x64; Node 22.23.3 for ordinary lanes and Node 24.21.0 for owner24; Python 3.12.15; Google Chrome for Testing 154.0.8037.97.

Chrome archive SHA-256: `487c3b0e89f786d9257a6265a29bacf18b893e90f29c0ef6f7be9706ecc8c7a2`.

The exact Node and Chrome binaries were downloaded and verified locally against the repository’s browser hash and official Node SHASUMS256 files. Local controls used Node 24.21.0 and this Chrome binary on the same Debian 13 executor (Python 3.12.14), so they are diagnostic controls, not a substitute for the hosted Ubuntu qualification lanes. The earlier Node 24.19.0/Chromium 151 run’s 92 failures cannot be treated as candidate qualification.

## Review defects and corrections

- Reproduced both requested dialog-history failures on 0d168ef: reload with player open → Show Back stayed on the show; Close → Forward → Show Back also stayed on the show. Route indices now return to the actual origin entry, and ordinary browser Back skips dismissed same-URL entries. Tests assert real URLs and rendered views, including subsequent Forward/Back traversal. Existing nested-sheet Back and Escape checks remain intact.
- Independent screenshot/control inspection found show Refresh hidden with the redundant heading. Refresh is restored beside show Back, with a real feed refresh and preserved episode filter verified.
- Discovery no longer claims selected-country provenance when its provider response has no such metadata. It says “Browse by topic”; settings explain that Apple uses the selected region and fallback providers can be global. A client-provider failure/server fallback case verifies the neutral label while the requested region remains correctly sent.
- Last-episode controls are verified reachable above the fixed mini-player. All five real-content screenshots were refreshed and independently inspected: title/author/artwork remain legible; show Back/Refresh share the toolbar; playback controls retain consistent placement; no new clipping or page-width overflow was found.

Targeted corrected podcast suite on Node 22.23.3 / Chrome 154: **47 passed, 0 failed, 1 optional deployed-live skip** (48 total). The separate real-service candidate check passed, and axe-core reported zero WCAG 2 A/AA and 2.1 AA violations on all five screens.

## Matching controls and failure categories

The unchanged release baseline full suite, using pinned Node 24.21.0 / Chrome 154, completed with **2288 passed, 2 failed, 2 skipped** (2292 total). Its only leaf failure was `tests/mymedia-layout-browser.test.js:259`, real archive artwork waiting 30 seconds; the second count is its parent suite. Relay runtime and Poweramp history/file-preview failures from the wrong-toolchain run disappeared.

The corrected candidate full local run, with the same Node/browser and screenshot capture enabled, completed with **2308 passed, 3 failed, 2 skipped** (2313 total). The same My Media leaf/parent failed. The additional failure was the Relay screenshot helper’s intentional `git diff --exit-code` guard because review changes were still uncommitted. It did not reach a rendered-contrast assertion. The guard remains unchanged. After this commit, the exact guarded test is run against clean baseline and candidate checkouts with matching screenshot settings; its outcome and the final exact-head hosted outcomes are reported in PR #95.

## Hosted evidence already terminal for prior head

For `0d168ef0e5340ef3147aa24489995b8981fa12ac`, both hosted runs completed successfully:

- [R2 migration and playback qualification, all eight components and final source gate](https://github.com/braydenparker999/jarvis/actions/runs/38029278059)
- [Relay owner pairing](https://github.com/braydenparker999/jarvis/actions/runs/38029278076)

These are prior-head controls only. The corrective head must independently reach terminal hosted results before integration. No merge or deployment is authorized by this report.

Library upload remains blocked by the earlier authorization failure. It was not retried; screenshots remain in this authorized PR evidence folder. Physical Android/TalkBack, OS suspension and post-deployment cache propagation remain release-lead/device checks.
