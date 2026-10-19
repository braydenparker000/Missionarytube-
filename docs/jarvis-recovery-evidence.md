# Jarvis recovery evidence — 2026-10-19

Baseline: destination `main` at `998dc6b468e86d09e1b020bd714658b2b8a694ef`.
The remote main ref matched the clean local checkout. Work is on
`recovery/daily-board-retry`; nothing was merged or published during recovery.

## Verified source-to-build map

`scripts/build-jarvis.mjs` calls the checked resolvers in
`scripts/media-source.mjs`. They verify component trees, commit ancestry,
tracked worktree bytes and untracked additions before copying files.

| Build input | Selected source | Identity |
| --- | --- | --- |
| Retained qualification/release consumers | `.jarvis-source` | `jarvis-release.json`: historical Jarvis commit `c28c1b2f70aabb5217b08bf31ffe4c93d0353765`, checked out from destination history |
| Default public files | `jarvis-active-public-c28/public` | `jarvis-activePublic-source.json`: `de5d7177a778f4bfa2aa071ab064a8a4fb9b2246`, tree `67a47e36414a8ceb4040c9454f64ed1982a9146c` |
| `/media` | `jarvis/public/media` | `jarvis-media-source.json`: `bccda52d2c84bdfc2d315c7250cd9efbd8594aff` |
| `/daily-board` baseline | `jarvis/public/daily-board` | `jarvis-dailyBoard-source.json`: `e168cab948fd8a1242c89b94d9036aa7613b8347`, tree `f9a0da32900699670e9611088fad209eb5b5a389` |
| `/connect` | `jarvis/public/connect` | `jarvis-connect-source.json`: `41383d9d5154aab3b1d7922d5e7c376376139c07` |
| `/content`, `/portal`, `/quick-ai`, `/reader`, `/respond` | Their `jarvis/public` subtrees | `jarvis-routeData-source.json`: `2b29ab492af5a68bc49888cdb441fafdd38b5427`, individual trees verified |
| `/mymedia`, `/podcasts`, `/youtube-archive` | Their `jarvis/public` subtrees | `jarvis-appBundles-source.json`: `54fb839d4efa26af6d4162d65b00e4308dffe274`, individual trees verified |
| Shared navigation | `jarvis/public/assets/app.js` | Exact retained SHA256 `867bf8f1f92e3811ffcf3336330758adfe36b762006a93eb94454eed853bd62c`; `daily-board-navigation.mjs` adds only the Board navigation hook |

The builder also generates `assets/r2-config.json`, converts the active SWA
configuration into document CSP/referrer metadata, adds the Board's scoped
`font-src data:`, adjusts the hosting description in `assets/hub.js`, copies
the root to `jarvis-preview.html`, and generates `release.json`.
No other imported `jarvis/public` variants are selected by this patch.

## Production evidence and limits

The local build is a recipe, not an inventory of every live overlay.
The general Azure workflow currently selects the
`reconcile-lucy-discovery` receipt-only mode. Its default manual invocation
will not publish this frontend change. Specialist publishers own additional
private workspace, Poweramp, publication-cache, Worker and catalog variants;
their source pins and preservation boundaries remain unchanged.

- [Daily Board run 39098577801](https://github.com/braydenparker000/Missionarytube-/actions/runs/39098577801)
  published the standalone Board at orchestration
  `b260cf06bff0da243702af8ecc4873220fdd2766`. Its job log contains the
  receipt and successful public SHA256 readback for all seven allowed paths.
  All seven reproduced baseline files match that receipt, including the
  transformed shared navigation. This is stronger evidence than the dated
  import notes. The published Board imports `v1/live.js`, which performs one
  read; the older shell's 30-second `drawShell()` refresh is not this route.
- [Latest Azure run 39169201572](https://github.com/braydenparker000/Missionarytube-/actions/runs/39169201572)
  published the Poweramp patch from
  `23bcf625813eb654f0b21956bc443a660f913a72`, including the hashed player,
  font files and route selected in `scripts/poweramp-shuffle-file-pins.json`.
  Its log verifies the files and unchanged Worker/settings. It did not
  publish the general frontend or Daily Board.
- [Music verification 39169420997](https://github.com/braydenparker000/Missionarytube-/actions/runs/39169420997)
  passed its R2 byte/Range/CORS step. The playback step received a runner
  shutdown signal and exited 143. That run does not establish a playback
  regression or successful live playback.

Fresh GET access to the production origin is blocked in this workspace:
`curl -I https://missionarytube.z13.web.core.windows.net/release.json`
returns a proxy CONNECT 403. The evidence above is the successful publishers'
recorded readback, not a new live observation. No network policy or identity
was changed to work around this restriction.

## Implemented candidate and checks

Daily Board now offers **Try again** after a failed read, disables the control
while a retry is pending, and restores keyboard focus on success or repeated
failure. Reports still pass through the same reader, schema and renderer.
Empty reports retain their existing message. No polling or storage is added.

The maintained route commit is
`1a8d13286571b32791d5d66d430ce38369708308`, tree
`52069a7390ead86792593bcff9d3fe7a9f07f187`. The exact component pins and
the explicit import guard were advanced; other source identities were retained.

The existing Board publisher now validates a successful main publication run
and its archived receipt as the baseline. It compares all seven live hashes,
requires unchanged shared navigation, uploads only changed Board files,
and preserves the Azure OIDC identity, target and concurrency lock. The
checkpoint captures bytes, headers, metadata and ETags before writes.
Rollback restores every changed Board file, including partially uploaded
dependencies, using conditional writes and public readback. Original
migration rollback artifacts remain supported.

Observed locally on Node `v24.19.0`, npm `11.9.0`, Chromium `154.0.8037.57`:

- Clean baseline `npm test`: **1,195 passed**, zero skipped; about 20.5 seconds.
- Baseline `npm run build`: **197 frontend files**, 199 final files, **20.23 MiB**;
  about 0.6 seconds.
- New browser regression against baseline: fails waiting for the absent retry
  control. With the fix, all three cases pass at 320px/390px, including
  repeated errors, pending clicks, report recovery, empty state and focus.
- Candidate `npm test`: **1,208 passed**, zero skipped, including trusted-run
  rejection, candidate/baseline drift, conditional-write races, interrupted
  publication, damaged backups and complete rollback.
- Pre-merge review replaced an ineffective navigation-count assertion with an
  original-document identity check. A reproduced rollback regression now checks
  headers and metadata before any restoration, and restoration explicitly
  retains the captured content digest.
- `DAILY_BOARD_ARTIFACT_ROOT=dist node --test tests/daily-board-browser.test.mjs`:
  **3 passed** against built files using the real selected API client and
  isolated synthetic HTTP responses.
- Artifact comparison: identical 199-path file set; only
  `daily-board/v1/live.js` and generated `release.json` differ. The only runtime
  upload for this candidate is `daily-board/v1/live.js`, SHA256
  `9f81f7c7518e661d1c86fd9f68951f0c3e78ff29ad43939015229b0b8a7222a0`.

The locked dependencies were reinstalled with `npm ci`. CI retains its exact
Node 22/24, Python and browser qualification requirements; local evidence
does not replace those required checks.

## Exact release procedure for this candidate

Merging and publication both require explicit owner authorization.

1. Require the PR's existing Validate qualification to pass. Review the complete
   diff. **Use a merge commit, not a squash/rebase merge**: the current source
   resolver requires the maintained route commit above to remain an ancestor.
   A squash would recreate the source-pin follow-up problem this recovery is
   working toward removing.
2. Once publication is authorized, select the reviewed main SHA from the
   authorized merge and
   use the existing Board workflow, with the parent receipt verified above:

   ```sh
   JARVIS_REVIEWED_MAIN_SHA='<full reviewed main SHA from the authorized merge>'
   gh workflow run publish-daily-board.yml \
     --repo braydenparker000/Missionarytube- --ref main \
     -f action=publish -f parent_run_id=39098577801 \
     -f expected_commit="$JARVIS_REVIEWED_MAIN_SHA"
   ```

   The workflow refuses a different dispatched SHA, untrusted parent run,
   changed live baseline or shared navigation. It builds and tests before
   Azure login, saves `daily-board-rollback-<new-run-id>` before writes, then
   verifies every public byte. Do not substitute the general Azure workflow.
3. Require both the static readback and the delivered Chrome tests to pass.
   `DAILY_BOARD_ORIGIN` makes those tests load the actual production documents
   and modules. Failure/retry cases intercept API GETs inside the test browser
   with synthetic responses; the final case reads the real public feed.
   Synthetic reports are never uploaded. Retain
   `daily-board-evidence-<new-run-id>` and its receipt. A successful static
   write followed by a failed behavior check remains a failed release.
4. If rollback is explicitly authorized, use the captured publication run:

   ```sh
   gh workflow run publish-daily-board.yml \
     --repo braydenparker000/Missionarytube- --ref main \
     -f action=rollback -f rollback_run_id='<new-run-id>' \
     -f expected_commit="$JARVIS_REVIEWED_MAIN_SHA"
   ```

   Partial failed/cancelled publications can supply a rollback checkpoint.
   Unknown concurrent bytes or damaged backups stop restoration. Reports,
   content, database, Worker, settings and unrelated blobs are retained.
   Backup/evidence retention remains 90 days.

This milestone removes the one-time publisher baseline restriction. Manual
component/source-tree pins still exist. The next bounded source change should
replace that maintenance for the already-active Board subtree while retaining
its exact generated provenance and dirty-worktree checks. A second source-to-live
improvement has not yet been demonstrated.
