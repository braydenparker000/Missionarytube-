# Duplicate root media-app retirement

Planning only. No production, test, workflow, or runtime file is changed by this document.

Analyzed tree: [`0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b`](https://github.com/braydenparker000/Missionarytube-/commit/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b) (merge of PR 213). Jarvis pin in `jarvis-release.json`: [`c28c1b2f70aabb5217b08bf31ffe4c93d0353765`](https://github.com/braydenparker999/jarvis/commit/c28c1b2f70aabb5217b08bf31ffe4c93d0353765). `public/media` tree: `c4d89e4aab446f6f79b17b7df911ec3c3f59e4d7`.

The earlier read-only note at `6093a80` is superseded by the checks below. What still matches: `scripts/check.mjs` requires root `index.html` plus 19 asset files; `build-jarvis` does not ship the root copy; push path filters do not upload blobs. What changed after PR 213: media tests go through `tests/helpers/media-root.mjs` and still default to the repo root when `MEDIA_APP_ROOT` is unset, which is how `npm test` runs.

## Why the root copy is not the deploy artifact

[`scripts/build-jarvis.mjs`](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/scripts/build-jarvis.mjs#L11) copies only `.jarvis-source/public` into `dist/`. `npm run build` is that script (`package.json`). The qualify build job checks the pin out to `.jarvis-source` and then runs `npm test` and `npm run build` ([`qualify-jarvis.yml`](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/.github/workflows/qualify-jarvis.yml#L144-L159)).

A push that matches the path filter runs the qualification job only. The deploy job requires `workflow_dispatch` ([`deploy-azure-storage.yml` line 94](https://github.com/braydenparker000/Missionarytube-/blob/0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b/.github/workflows/deploy-azure-storage.yml#L94)). Deleting the root copy does not upload blobs. It does make `npm test` fail until the callers below are retargeted, and a red `npm test` blocks qualification.

Rollback of the old Astra site is the backup branch `backup/missionarytube-before-jarvis-20260920` at `dc5423d1a1c8923983db54b94693cedda772d68b`, plus the storage-before artifact (`README.md`). It is not this root tree. `README.md` line 7 currently says the old source is retained in this repository for rollback. That sentence has to be corrected in the removal PR so it names the backup branch.

## 1. Files proposed for removal

43 tracked paths, 1,009,279 bytes. Full sha256 list: `docs/plans/duplicate-app-retirement-inventory.json`. None of these paths are inputs to `scripts/build-jarvis.mjs`.

Shipped counterpart means `public/media/<same relative path>` at the pin above. "Identical" means the bytes match that file.

### Byte-identical to the pin (33)

Safe to delete. The pin already has the bytes `build-jarvis` copies.

`assets/css/cinema.css`, `assets/css/collection.css`, `assets/css/obsidian.css`, `assets/js/appearance.js`, `assets/js/astra-motion.js`, `assets/js/audio-player.js`, `assets/js/bootstrap.js`, `assets/js/discovery-health.js`, `assets/js/federated-search.js`, `assets/js/hub.js`, `assets/js/playback/adapters.js`, `assets/js/playback/delivery.js`, `assets/js/playback/diagnostics.js`, `assets/js/playback/engine.js`, `assets/js/playback/episodes.js`, `assets/js/playback/request-policy.js`, `assets/js/playback/settings.js`, `assets/js/playback/software-player.js`, `assets/js/playback/source-loader.js`, `assets/js/playback/source-view.js`, `assets/js/playback/streams.js`, `assets/js/playback/subtitles.js`, `assets/js/playback/video-health.js`, `assets/js/progress-store.js`, `assets/js/route-runtime.js`, `assets/js/search-intent.js`, `assets/js/youtube/config.js`, `assets/js/youtube/instances.js`, `assets/js/youtube/playback.js`, `assets/licenses/libmedia-COPYING.GPLv3.txt`, `assets/licenses/libmedia-COPYING.LGPLv3.txt`, `assets/licenses/libmedia-modifications.txt`, `assets/licenses/mediabunny.txt`.

The four license files are not read by any test. They still ship, because the pin has the same bytes under `public/media/assets/licenses/`.

### Different from the pin (5)

These are the stale copy. Do not port the root bytes into Jarvis. The pinned suite already executes against the Jarvis bytes.

| Path | Root bytes | Root sha256 | Jarvis sha256 |
| --- | --- | --- | --- |
| `index.html` | 5384 | `98031df87bde88b6c401062192bc18707b3706d8f5cfbd35527bc0a9d8e989ee` | `123acb17e65998e239bfa7bc05614d923aa9b6ffa818d3a497ef8df47cbe277e` |
| `assets/js/app.js` | 241197 | `34e783f26e3b199b9d226f27218492604fb87f84672edd99449aa18ef76a8e9f` | `983cf2c4ff215d78198cf56fbdaece63666d5220d8e7538b3df42a8a83fa410c` |
| `assets/js/catalog-registry.js` | 6624 | `6b3ae028d76a90f5086239006fad75f98ad33090351ec02bffede31ff92f5404` | `971a785bcd982a189ed110ca3defec8afce0576ca93a374dc1e066c09a6b86ea` |
| `assets/js/collection-tools.js` | 3980 | `16e49c248fadff9b141a83fb5193b29270cb19e6b0af1eeb677a737b5b2c95bc` | `2134bd3aff07e13c0fc0a9fb1f0a34a43b6d892d4123e3eab98d80b3578e07e9` |
| `assets/js/youtube/api.js` | 35686 | `0edb198fe20b1322555e2165348d64e3dcbba7c09e509c8fba408e2af22fee67` | `ec174231d8b52ef88460ef905f5dc1ff178bf3f445d351373bdccb43aa72c5ac` |

### No Jarvis source counterpart (5)

| Path | Bytes | Why it is still obsolete |
| --- | --- | --- |
| `src/astra-motion.js` | 25644 | Source for `build:legacy` only. The shipped file is `public/media/assets/js/astra-motion.js`, git blob `01cb4830d63b1e63b270eeaf2d6752946edc8242`, identical to root `assets/js/astra-motion.js`. |
| `src/interaction-logic.js` | 1080 | Imported only by root motion tests. No separate shipped module. Behavior that still matters is in the shipped motion bundle. |
| `src/compatibility-player.js` | 19504 | Source for `build:legacy` only. Shipped form is `public/media/assets/js/playback/compatibility.js` (minified, not this source). |
| `playback-check.html` | 6000 | Root-only page. No Jarvis file, not copied by `build-jarvis`, not read by `npm test`. It points at clips only `build:legacy` generates. |
| `assets/images/README.md` | 226 | No Jarvis file. No test reads it. |

Jarvis `public/media` also has 49 files the root copy does not have (the minified compatibility player, libmedia workers, and wasm). Those stay in the pin. They are not part of this deletion.

## 2. Remaining callers

A string search for `index.html` hits the deployed homepage name in publish scripts, receipt JSON, and storage fixtures (`mast/index.html`, `drawercast/index.html`, `name: 'index.html'`). Those are not this file. `tests/shell-assets.test.mjs` embeds sample markup and does not open the root tree. Leave both alone.

Historical snapshots that still mention `*.html`, `assets/**`, `src/**`, and `scripts/build.mjs`, and must not be edited:

- `scripts/release-identities/astra-approved-deploy-azure-storage.yml` lines 13-16
- `scripts/release-identities/relay-client-approved-deploy-azure-storage.yml` lines 13-16

They are fixtures for `tests/prewrite-overlap.test.mjs`, `tests/worker-reuse-diagnostics.test.mjs`, and `scripts/astra-worker-reuse-preflight.test.mjs`.

### Opens the root tree

`tests/helpers/media-root.mjs` lines 20-22: unset `MEDIA_APP_ROOT` returns the repo root. Every `readAppSource` / `appFileURL` / `appPath` / `listAppDir` call below then reads that root. `npm test` does not set the variable.

| File | Lines | Root paths |
| --- | --- | --- |
| `scripts/check.mjs` | 6-25, 43-49, 56-62, 86 | `index.html`, `assets/css/obsidian.css`, and 18 JS files; then every `.js`/`.html` under `assets/` |
| `scripts/build.mjs` | 14-27, 33, 45, 77-125 | every root HTML file, `assets/`, `src/astra-motion.js`, `src/compatibility-player.js`; writes `dist/assets/playback-check/` |
| `scripts/pin-player-libs.mjs` | 46, 71 | reads and writes `assets/js/app.js` |
| `scripts/test-jarvis-media.mjs` | 109-116 | `source-only` deletes `MEDIA_APP_ROOT` and runs 29 names against the root `src/` files |
| `scripts/media-qualification.mjs` | 45-48 | names `src/compatibility-player.js`, `src/interaction-logic.js`, `src/astra-motion.js` |
| `tests/browser/servers.mjs` | 541 | `join(root, "index.html")` |
| `tests/browser/youtube-flow.mjs` | 23, 190 | `root` is the repo root passed to `startApp` |
| `tests/media-app-root.test.mjs` | 7-10 | asserts unset `MEDIA_APP_ROOT` equals the repo root and reads `../index.html` |
| `tests/dependency-pinning.test.mjs` | 11-12, 54-57, 78, 95, 106 | reads `index.html` and `assets/js/app.js`; copies the repo and runs `scripts/check.mjs`; mutates `assets/js/app.js` and deletes `assets/js/progress-store.js` inside that copy |

Helpers, and the tests that import them. The import line is the caller; the helper line is the open.

| Helper | Open | Importers |
| --- | --- | --- |
| `tests/helpers/playback.mjs:4,28` | 11 `assets/js/playback/*.js` modules | `tests/playback-adapters.test.mjs:10`, `playback-delivery.test.mjs:3`, `playback-engine.test.mjs:3`, `playback-episodes.test.mjs:3`, `playback-request-policy.test.mjs:3`, `playback-settings.test.mjs:3`, `playback-streams.test.mjs:3`, `playback-subtitles.test.mjs:3`, `player-recovery.test.mjs:5`, `software-player.test.mjs:6` |
| `tests/helpers/youtube.mjs:24-30` | `request-policy.js`, `streams.js`, `youtube/{config,instances,api,playback}.js` | `tests/youtube-api.test.mjs:3`, `youtube-instances.test.mjs:3`, `youtube-piped.test.mjs:3`, `youtube-playback.test.mjs:3` |
| `tests/helpers/redesign.mjs:16,20,24` | `hub.js`, `audio-player.js`, `catalog-registry.js` | `tests/audio-player.test.mjs:3`, `media-hub.test.mjs:3`, `catalog-registry.test.mjs:4` |
| `tests/helpers/harness.mjs:9` | `assets/js/progress-store.js` | `tests/progress-store.test.mjs:11` |

Direct `readAppSource` / `appFileURL` / `listAppDir` besides the helpers:

| File | Lines | Paths |
| --- | --- | --- |
| `tests/app-wiring.test.mjs` | 7-8, 13 | `index.html`, `assets/js/app.js`, `assets/css/obsidian.css` |
| `tests/appearance.test.mjs` | 6 | `assets/js/appearance.js` |
| `tests/catalog-registry.test.mjs` | 97-98, 114-115 | `index.html`, `assets/js/app.js` |
| `tests/collection-tools.test.mjs` | 7, 55 | `assets/js/collection-tools.js`, `assets/js/app.js` |
| `tests/compatibility-player.test.mjs` | 9, 23 | `src/compatibility-player.js`, `assets/js/playback/request-policy.js` |
| `tests/dependency-pinning.test.mjs` | 11-12 | `index.html`, `assets/js/app.js` |
| `tests/discovery-health.test.mjs` | 7-11 | `discovery-health.js`, `index.html`, `app.js`, `obsidian.css` |
| `tests/federated-search.test.mjs` | 7-11 | `federated-search.js`, `index.html`, `app.js`, `obsidian.css` |
| `tests/initial-theme.test.mjs` | 6-9 | `index.html`, `appearance.js`, `bootstrap.js`, `cinema.css` |
| `tests/interaction-motion.test.mjs` | 12, 27-34, 69 | `src/interaction-logic.js`, `index.html`, `app.js`, `obsidian.css`, `assets/js/astra-motion.js`, `src/astra-motion.js` |
| `tests/library-continuity.test.mjs` | 5-6 | `app.js`, `obsidian.css` |
| `tests/playback-diagnostics.test.mjs` | 6 | `playback/video-health.js`, `playback/diagnostics.js` |
| `tests/playback-video-health.test.mjs` | 7 | `playback/video-health.js` |
| `tests/player-recovery.test.mjs` | 7 | `assets/js/app.js` |
| `tests/redesign.test.mjs` | 7-11, 524 | `index.html`, `app.js`, `obsidian.css`, `hub.js`, `assets/css/` |
| `tests/route-runtime.test.mjs` | 6 | `route-runtime.js` |
| `tests/search-intent.test.mjs` | 6 | `search-intent.js` |
| `tests/software-player.test.mjs` | 7 | `playback/software-player.js` |
| `tests/source-view.test.mjs` | 4 | `playback/source-view.js` |
| `tests/youtube-wiring.test.mjs` | 14-17 | `index.html`, `app.js`, `obsidian.css` |

`tests/jarvis-shipped-*.suite.mjs` call the same helper but throw if `MEDIA_APP_ROOT` is unset (`jarvis-shipped-first-paint.suite.mjs:11`, `jarvis-shipped-motion.suite.mjs:8`, `jarvis-shipped-compatibility.suite.mjs:20`). They do not read the root copy. `node --test` does not discover `*.suite.mjs`.

### Path filters and package scripts

| File | Lines | What |
| --- | --- | --- |
| `.github/workflows/deploy-azure-storage.yml` | 70-73 | `"*.html"`, `"assets/**"`, `"src/**"`, `"scripts/build.mjs"` |
| `scripts/partition-main-qualification.mjs` | 15-18 | same four patterns in `DEPLOY_PATHS` |
| `scripts/partition-main-qualification.mjs` | 27-29 | `GATE_RECIPE_SHA256` (see section 5; do not treat the live file as this pin) |
| `tests/main-qualification-partition.test.mjs` | 42-47 | expected `DEPLOY_PATHS`, compared to the historical workflow's path list |
| `tests/main-qualification-partition.test.mjs` | 76-77, 81 | `known` includes `index.html`, `playback-check.html`, `assets/app.js`, `assets/nested/deeper/icon.svg`, `src/main.js`, `src/nested/helpers.mjs`; `recipes` includes `scripts/build.mjs` |
| `tests/main-qualification-partition.test.mjs` | 144-146, 160-161, 168-171, 208-220, 234, 242-243, 258, 266, 275 | fixture paths under `assets/` and `src/` used as deploy-path examples, not as reads of this tree |
| `package.json` | 8 | `test` runs `scripts/check.mjs` before `node --test` |
| `package.json` | 10-12 | `pin:check`, `test:browser`, `build:legacy` |
| `docs/MAIN-QUALIFICATION-PARTITION.md` | 41-44 | documents the same four patterns |

### Docs that name the root copy

| File | Lines | Edit in the removal PR |
| --- | --- | --- |
| `README.md` | 7 | Point rollback at the backup branch, not this tree. Line 17 is the deploy homepage holdback, not this file. |
| `docs/WORKFLOW.md` | 41-45 | Stop telling people to replace root `index.html` and add root `assets/`. |
| `docs/YOUTUBE.md` | 89, 161 | Relative link to root `assets/js/youtube/config.js`. |
| `docs/PLAYBACK-0.32.md` | 63 | Describes `playback-check.html`. |
| `docs/PRODUCT-DIRECTION.md` | 103-104 | Historical design note. One sentence that the root files are gone is enough. |
| `docs/evidence/issue-9/README.md` | 17-18 | Says `scripts/build.mjs` copies root `assets/` and HTML. |
| `deploy/invidious/README.md` | 136 | Says root `assets/js/youtube/config.js` ships from this repo. |
| `test-evidence/media-migration/README.md` | 9, 99-102 | Says `npm test` reads the root copy and that the copy cannot be retired while the two todos exist. |

## 3. Assertion dispositions

PR 213 evidence at this commit (`test-evidence/media-migration/README.md`): `test:media-jarvis:source` is 512 tests, 483 pass, 29 fail; `test:media-jarvis:pinned` is those 483 against `public/media` with the 29 names skipped; `test:media-jarvis:source-only` is the 29, passing only because `MEDIA_APP_ROOT` is cleared and the root `src/` files exist; `test:media-jarvis:shipped` is 34 tests, 32 pass, 2 todo. This planning pass did not re-execute that suite. It re-checked the pin tree hash, the 29 names in `scripts/media-qualification.mjs`, and every read site above.

`npm test` still runs the source-unit files with `MEDIA_APP_ROOT` unset, so they still read the root copy even when the same assertion already passes against the pin.

### Already covered by the pinned public/media run: keep the assertion, drop the root read

These files are in `SOURCE_TESTS` (`scripts/test-jarvis-media.mjs` lines 24-60) and are not the 29 source-only names. `test:media-jarvis:pinned` already runs them against the pin. After removal, `mediaAppRoot()` resolves to `.jarvis-source/public/media` (the checkout the qualify build job already creates before `npm test`) and refuses the repo root. Missing checkout fails the run. It does not skip.

`tests/app-wiring.test.mjs`, `appearance.test.mjs`, `audio-player.test.mjs`, `catalog-registry.test.mjs`, `collection-tools.test.mjs`, `dependency-pinning.test.mjs` (the dash/hls assertions at lines 21-49, not the `check.mjs` subprocess), `discovery-health.test.mjs`, `federated-search.test.mjs`, `initial-theme.test.mjs`, `library-continuity.test.mjs`, `media-hub.test.mjs`, `playback-adapters.test.mjs`, `playback-delivery.test.mjs`, `playback-diagnostics.test.mjs`, `playback-engine.test.mjs`, `playback-episodes.test.mjs`, `playback-request-policy.test.mjs`, `playback-settings.test.mjs`, `playback-streams.test.mjs`, `playback-subtitles.test.mjs`, `playback-video-health.test.mjs`, `player-recovery.test.mjs`, `progress-store.test.mjs`, `redesign.test.mjs`, `route-runtime.test.mjs`, `search-intent.test.mjs`, `software-player.test.mjs`, `source-view.test.mjs`, `youtube-api.test.mjs`, `youtube-instances.test.mjs`, `youtube-piped.test.mjs`, `youtube-playback.test.mjs`, `youtube-wiring.test.mjs`.

Non-source-only tests inside `tests/compatibility-player.test.mjs` and `tests/interaction-motion.test.mjs` are in the same 483. They stay and run against the pin. `initial-theme.test.mjs` stays a characterization of deferred appearance scripts. It does not clear the first-paint todo.

`tests/interaction-motion.test.mjs` lines 64-68 read root `package.json` pins (`gsap` 3.15.0, `esbuild` 0.28.2) only when `MEDIA_APP_ROOT` is unset. Keep that pin check as a read of `package.json`, not of the media tree. The bundle hash on lines 69-71 stays against `public/media/assets/js/astra-motion.js`.

### 29 source-only names

28 are already kept by a named shipped test. Mapping: `test-evidence/media-migration/source-only-disposition.md`. Do not copy `src/` into Jarvis. Stop executing these names against the root. The shipped test is the assertion that remains.

| Source-only name | Shipped assertion that stays |
| --- | --- |
| real MKV AVC/AAC is repackaged to fragmented MP4 with video bytes intact | same name, prefixed `shipped:` |
| HEVC repair declares hvc1 exactly as the pinned MP4 muxer writes it | `shipped:` same name |
| HEVC open-GOP seeking drops unavailable leading pictures and preserves retained video and audio bytes | `shipped:` same name |
| seeking starts at a preceding keyframe and unsupported video is explicit | `shipped:` same name, for the keyframe and the explicit codec error |
| surround audio is downmixed to bounded stereo samples | `shipped:` same name |
| audio crossing a video keyframe is trimmed before encoding to avoid negative timestamps | `shipped:` same name |
| an unsupported default audio track falls back to usable audio in the same file | `shipped:` same name |
| replacing an in-flight startup reports the old read as cancelled, not a new playback failure | `shipped:` same name |
| real 40-second MKV VP8/Vorbis uses WebM when MP4 is unavailable, preserving both tracks | `shipped:` same name |
| audio conversion selects AAC when MP4 cannot accept Opus | `shipped:` same name |
| a WebM repair seek retains a preceding keyframe beyond the initial read-ahead window | `shipped:` same name |
| copied AAC audio crossing a seek keyframe keeps its timing and no longer fails the muxer | `shipped:` same name |
| compatibility fetch keeps addon headers on their origin and follows demuxer byte ranges | `shipped:` same name |
| compatibility HLS children on another origin never receive addon credentials | `shipped:` same name |
| compatibility startup distinguishes blocked access and connection failures | `shipped:` same name |
| audio repair retries a transient request and transfers the real prepared input without rereading | `shipped:` same name |
| audio repair bounds persistent fetch failures to one shared retry | `shipped:` same name |
| audio repair bounds persistent body failures to one shared retry | `shipped:` same name |
| cancelling repair during its retry delay stops it without another request | `shipped:` same name |
| repair cancellation promptly rejects a pending metadata fetch | `shipped:` same name |
| prepared repair is disposed when abandoned or its adapter is destroyed before attach | `shipped:` same name |
| aborting an unconsumed prepared repair invalidates it; abort after transfer leaves ownership with the adapter | `shipped:` same name |
| gesture thresholds distinguish a tap, a cancelled drag and a committed dismissal | `shipped motion distinguishes a tap...` plus the untouched-gesture and instrumented-boundary tests |
| custom press physics owns touch and pen, not mouse clicks | `shipped custom press physics owns touch and pen, not mouse clicks` |
| navigation direction follows the dock and accepts an explicit back route | `shipped navigation direction follows the dock and accepts an explicit back route` |
| site-wide content choreography is shared, viewport-aware and bounded | `shipped content choreography is viewport-aware and bounded` |
| direct interaction motion never exceeds the 360ms release budget | `shipped direct interaction motion stays inside the 360ms release budget` |
| View Transition callbacks cannot reorder or stall visible state | `shipped view-transition callbacks cannot reorder or stall visible state` |

Two clauses are not "delete the test and hope":

1. **`pumpPipeline` AbortError**, inside `seeking starts at a preceding keyframe and unsupported video is explicit` in `tests/compatibility-player.test.mjs`. The shipped bundle does not export `pumpPipeline`. The public adapter detaches `run.job` and suppresses `AbortError` in both the root source and the shipped bundle (`pending-and-discrepancies.md`, "Reclassified"). **Retire this clause.** Record that retirement in `source-only-disposition.md` in the same PR. Public cancellation, disposal, keyframe selection, and the unsupported-video error stay on the shipped adapter. This is not a new qualification todo.

2. **390px `.episode-nav-sticky` `backdrop-filter: none`**, inside `mobile motion avoids offscreen GPU layers and costly document snapshots`. The shipped test covers the rest of that case and records the winning `blur(20px)`. The `none` clause is already `test.todo` `shipped: at 390px .episode-nav-sticky backdrop-filter is none` in `tests/jarvis-shipped-motion.suite.mjs`, and it is already in the `qualification` block of `pending-and-discrepancies.md`. **Keep that todo.** Do not keep `src/astra-motion.js` to preserve the root assertion. Do not close the todo in this PR. Theme-before-paint and this blur bug stay out of scope.

`scripts/test-jarvis-media.mjs` `qualify` currently requires the source-only leg to exit 0. That leg is the root fallback. After removal it cannot pass. Change `qualify` so it no longer demands that leg. `QUALIFICATION: READY` still requires an empty pending list and zero todos, so the two existing todos keep it `NOT READY`.

The shipped suites must run in CI after the root files are gone, or the 28 kept behaviors leave `npm test`. `*.suite.mjs` is invisible to bare `node --test`. Add them to the `test` script with `MEDIA_APP_ROOT` pointed at the pin checkout (section 6). Motion and first-paint need Chrome (`CHROME_PATH`, `/usr/bin/google-chrome`, or `/usr/bin/google-chrome-stable`). The plan job already requires `google-chrome` or `chromium` on the same `ubuntu-24.04` image. Confirm the build job sees one of those paths. If it only has `chromium` on `PATH`, export `CHROME_PATH` in that step. Do not add a browser install.

### `scripts/check.mjs` assertions

Retarget the media half at `.jarvis-source/public/media`. Do not drop it.

| Assertion | Lines | Disposition |
| --- | --- | --- |
| 20 media files exist | 6-25 | Point the paths at the pin's `public/media`. |
| doctype, `lang`, viewport, non-empty title | 45-48 | Not duplicated elsewhere. Run them on the pin's `public/media/index.html`. |
| `<main>` landmark | 49 | `redesign.test.mjs` also checks `<main id="main">`. Keep this check on the pin file anyway. |
| Local asset references exist | 56-62 | Run against the pin tree. |
| Remote scripts are version-pinned and have SRI | 86-108 | Run against the pin's `index.html` and `assets/**`. `dependency-pinning.test.mjs` covers dash.js 5.2.0 and hls.js 1.6.13 specifically; this scan is the broader one. |
| Scoreboard schema and the doc files | 26-32, 111-114 | Stay on this repo. Unrelated to the media copy. |

`dependency-pinning.test.mjs` lines 70-110 copy the repo and expect `check.mjs` to pass, then break a mutable URL, strip an integrity hash, and delete the progress-store file. Keep those four assertions. Point them at a temp copy of pinned `public/media` plus the doc files. Exclude `.jarvis-source` from the full-tree copy (`cp` today does not exclude it, and the qualify job already has that checkout present during `npm test`).

### Tests that lock the root default

| Test | Disposition |
| --- | --- |
| `unset MEDIA_APP_ROOT keeps media regression on the repo-root copy` (`tests/media-app-root.test.mjs:7`) | Replace. New assertion: resolution uses the pinned checkout and does not read a repo-root media tree. |
| `a Jarvis target cannot resolve to the repo-root copy` (`tests/media-app-root.test.mjs:13`) | Keep. |

### No assertion to move

`playback-check.html`, `assets/images/README.md`, and the four license files have no test that reads them. Removing them drops no assertion. The license bytes remain in the pin.

## 4. Unchanged production output

`build-jarvis` never reads the root copy, so the removal must not change `dist/`. Compare sorted path + sha256 manifests. An empty diff is the pass.

Baseline recorded on `0c521d76` with `.jarvis-source` at `c28c1b2f70aabb5217b08bf31ffe4c93d0353765` and an empty `git status --porcelain` there:

- Builder log: `192` frontend files, `20.09 MiB` (count taken before `dist/jarvis-preview.html` and `dist/release.json` are added).
- Final tree: **194 files, 21,073,841 bytes**.
- Manifest sha256: **`b2ab23bac1a1824f605f680d94c2807e4e40e59480a749d591f6ee4558b5e0d5`**.
- Manifest body: `docs/plans/duplicate-app-retirement-dist-manifest.txt`.
- The final tree has no `playback-check` path and no `src/` path.

Reproduce the baseline, then the after-removal check:

```bash
git rev-parse HEAD   # expect 0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b on the baseline
rm -rf .jarvis-source
git init .jarvis-source
git -C .jarvis-source remote add origin https://github.com/braydenparker999/jarvis.git
git -C .jarvis-source fetch --depth 1 origin c28c1b2f70aabb5217b08bf31ffe4c93d0353765
git -C .jarvis-source checkout --detach FETCH_HEAD
test "$(git -C .jarvis-source rev-parse HEAD)" = c28c1b2f70aabb5217b08bf31ffe4c93d0353765
test -z "$(git -C .jarvis-source status --porcelain)"
node scripts/build-jarvis.mjs
python3 - << 'PY'
import hashlib
from pathlib import Path
root = Path("dist")
rows = []
for path in sorted(p for p in root.rglob("*") if p.is_file()):
    rel = path.relative_to(root).as_posix()
    rows.append(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {rel}")
manifest = "\n".join(rows) + "\n"
Path("dist-manifest.txt").write_text(manifest)
print(len(rows), hashlib.sha256(manifest.encode()).hexdigest())
PY
```

After the removal, from a clean pin checkout and the same `jarvis-release.json`:

```bash
# rebuild with the commands above, writing dist-manifest-after.txt
diff -u docs/plans/duplicate-app-retirement-dist-manifest.txt dist-manifest-after.txt
# empty diff required
```

The manifest hash must stay `b2ab23bac1a1824f605f680d94c2807e4e40e59480a749d591f6ee4558b5e0d5`. Do not commit `dist/`.

## 5. Focused checks for the removal PR

Run:

1. `npm test` (includes retargeted `scripts/check.mjs`, the pinned source-unit files, the skip of the 29 names, and the three shipped suites).
2. `npm run build`, then the manifest diff in section 4.
3. `node --test tests/main-qualification-partition.test.mjs tests/prewrite-overlap.test.mjs tests/worker-reuse-diagnostics.test.mjs scripts/astra-worker-reuse-preflight.test.mjs`.
4. `npm run test:media-jarvis:pinned` and `npm run test:media-jarvis:shipped`. Shipped stays 32 pass / 2 todo.
5. `npm run test:media-jarvis:qualify` prints `QUALIFICATION: NOT READY` and exits non-zero because the two todos remain. It must not fail because `src/` is missing.

Partition edits in the same PR, kept in lockstep:

- `.github/workflows/deploy-azure-storage.yml` lines 70-73: remove `"*.html"`, `"assets/**"`, `"src/**"`, and `"scripts/build.mjs"`.
- `scripts/partition-main-qualification.mjs` `DEPLOY_PATHS` lines 15-18: the same four removals. `expectedTrigger` is derived from `DEPLOY_PATHS`.
- `tests/main-qualification-partition.test.mjs`: the literal list at lines 42-44 must match. Read that path list from the **live** workflow. Do not edit the historical identity file to satisfy line 47.
- Move `index.html`, `playback-check.html`, `assets/app.js`, `assets/nested/deeper/icon.svg`, `src/main.js`, and `src/nested/helpers.mjs` from `known` (lines 76-77) to `unknown`.
- Move `scripts/build.mjs` from `recipes` (line 81) to `unknown`.
- Git fixtures at lines 208-220, 234, 242-243, 258, 266, and 275 use `assets/old.js` and `src/start.js` as the deploy-path example. Replace them with a path that remains deploy-only and is not a recipe change: top-level `tests/*.test.mjs` (for example `tests/release-a.test.mjs` renamed to `tests/release-b.test.mjs`). `docs/old.md` stays the unknown path. `changesGateRecipe` is true for `scripts/`, nested tests, and `package.json`, so those are the wrong substitutes.
- `docs/MAIN-QUALIFICATION-PARTITION.md` lines 41-44: same path list.

### `GATE_RECIPE_SHA256` — do not update it in this PR

The constant is the historical snapshot, not the live workflow.

| File | sha256 |
| --- | --- |
| Live `.github/workflows/deploy-azure-storage.yml` | `22fd502b29b02092508a7ec9b5e6a05f6321160c1fa89d77597d7eb36bb3936c` |
| Live `.github/workflows/qualify-jarvis.yml` | `ba6eb0a429f52ef8ba397b941f1a00738dfcdadfeda2777523320d83bbade2c9` |
| Pinned deploy value, equal to `scripts/release-identities/astra-approved-deploy-azure-storage.yml` | `30dc3c7caffa0d4048e63be296936d1ddbd8f2e55ebbba06e6a1d2f77db950a3` |
| Pinned qualify value, equal to `scripts/release-identities/relay-client-approved-qualify-jarvis.yml` | `0a4957bf97acaa01ade5bd298128710e7c9ba1c882896f691d30a62a4067c6c3` |

`recognizedGatingRecipes(live, live)` is already false, so every main push already keeps full Validate. `tests/prewrite-overlap.test.mjs` lines 254-256 and `tests/main-qualification-partition.test.mjs` line 49 assert the constant equals those historical files.

Updating only the deploy entry to the post-edit live hash breaks those tests and still leaves `recognizedGatingRecipes` false, because the live qualify file does not match `0a4957bf...`. Updating both entries to the post-edit live bytes re-opens the deploy-only shortcut and requires those tests to stop binding the constant to the historical snapshots. That is a qualification-policy change, not a requirement of deleting unshipped files. Leave the constant and the historical yml bytes untouched. The removal PR's own workflow edit keeps full Validate either way.

## 6. Patch boundary

### One PR

Delete the 43 paths. Retarget every `npm test` read so the pin checkout is the only media tree. Remove the three npm scripts that would invoke deleted inputs. Delete the two scripts whose only job is the root copy.

Changed files:

- Delete the 43 paths in section 1.
- Delete `scripts/build.mjs` and `scripts/pin-player-libs.mjs`.
- `package.json`: remove `pin:check`, `test:browser`, and `build:legacy`. Extend `test` so the shipped suites run against the pin checkout and the 29 source-only names are not executed as root failures. The skip list stays the existing `SOURCE_ONLY_TESTS` array so the names remain visible.
- `scripts/check.mjs`, `tests/helpers/media-root.mjs`, `scripts/test-jarvis-media.mjs`, `scripts/media-qualification.mjs` (comment and qualify-leg only; keep the 29 names).
- `tests/media-app-root.test.mjs`, `tests/dependency-pinning.test.mjs`, `tests/compatibility-player.test.mjs`, `tests/interaction-motion.test.mjs`.
- `scripts/partition-main-qualification.mjs` (`DEPLOY_PATHS` only), `.github/workflows/deploy-azure-storage.yml` (the four path lines only), `tests/main-qualification-partition.test.mjs`.
- Docs listed in section 2, including the source-only disposition note for the retired `pumpPipeline` clause.
- `.github/workflows/qualify-jarvis.yml` only if the build job cannot see Chrome at the paths the shipped suites already probe. That edit is an export of `CHROME_PATH`, not a new install.

`gsap` becomes unused (`src/astra-motion.js` is its only importer). Leave it, and leave `package-lock.json`, so this PR does not churn the lockfile. `mediabunny`, `@mediabunny/ac3`, `@mediabunny/dts`, `esbuild`, `playwright-core`, and `@libmedia/avplayer` stay: shipped suites, worker tests, and `scripts/build-libmedia.mjs` still import them.

### Deferred

- Deleting `tests/browser/` (`youtube-flow.mjs`, `servers.mjs`, `media.mjs`). Nothing in CI calls them once `test:browser` is gone. A later PR can remove the harness. Invoking the files directly will fail once `index.html` is gone; that is the point of the deferral.
- Uninstalling unused `gsap`.
- Reviving `GATE_RECIPE_SHA256` against the live workflows.
- Editing historical files under `scripts/release-identities/`.
- The two product bugs: stored accent and motion before first paint, and the 390px backdrop rule. Both stay pending.

## Blockers

No blocker to writing this plan. Blockers for treating the media app as qualified, which this deletion does not clear:

- `QUALIFICATION: NOT READY` while the two todos in `test-evidence/media-migration/pending-and-discrepancies.md` remain.
- The five divergent root files are stale relative to the pin. Deleting them discards those root bytes on purpose.
- `npm test` after the change requires `.jarvis-source` at the pin. The qualify build job already checks that out before `npm test`. A checkout without it fails closed.
