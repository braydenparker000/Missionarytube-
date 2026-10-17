# Jarvis source import: first consolidation patch

Missionarytube- is the surviving repository. This patch imports application
source; it does not switch any release consumer or deploy a component.

- Deployment base: `1179c4fe40a84a6ddb3fd1dcd37950e6239f12d4`.
- Source: `braydenparker999/jarvis`, `feat/simple-chat-tasks`, commit
  `118673457777c9226e846d4513dc5e4eb206ea38`.
- Source tree: `9f983eb6a86ddc1989c3d4e7b85fb7c7d2819938`, imported under
  `jarvis/`: all 926 files, original bytes and modes (100644).
- The import commit has the deployment base and original source commit as its
  two parents. It preserves original source ancestry without squashing,
  rewriting commits, or merging unrelated branch behavior into the subtree.

The canonical [delivery SOP](../jarvis/.agents/skills/deliver-software-efficiently/SKILL.md)
is included unchanged. Root AGENTS.md and CLAUDE.md identify the new destination
and override older destination guidance in the exact imported snapshot.
Nested `jarvis/.github/workflows` are source files, not active root workflows.
No original repository or ref is changed or deleted.

## Preservation inventory

[The exact inventory](jarvis-source-import-inventory.json) records source main,
26 release/component identities referenced by the current deployment recipes,
and all 30 open PR heads and bases across both repositories at observation time.
Every open branch head was checked against its remote ref. Each identity states
whether it is reachable through the import parent, through the deployment base,
or remains reference-only in its original repository.

Jarvis main `ed7bbd436689be3ac9cca1ab5f111341dd690b80` is not an ancestor of the
selected source. At the inventory observation, preflight source
`4532be6b6842320ed0cc64be973425d9505c7b03` was outside both original import
parents and recorded as reference-only. A later public comparison confirms it
is now an ancestor of destination `main`; it was not added as an import parent.
Other open-work heads outside either parent remain unimported unless separately
reviewed. Their original refs remain intact. An inventory reference alone is
not an archival ref if the original repository is later deleted. No open PR
behavior is accepted merely by listing it.

## Test and privacy boundaries

Root `npm test` explicitly selects `tests/*.test.mjs`, `scripts/*.test.mjs`,
and the already-discovered `scripts/test-jarvis-media.mjs`. All 86 original
orchestration test entrypoints remain selected. A new test checks discovery
coverage and rejects omitted nested or differently suffixed test files.
Imported application tests are not automatically discovered or claimed passing.
They will run as a separately qualified component during cutover.

The original privacy rules assume the legacy media application's public-host
and fixture conventions. The imported tree includes public provider URLs,
synthetic OAuth response fixtures, and historical commit IDs in fixture
manifests. Do not broadly expand those allowlists. The privacy suite first
verifies the entire imported Git tree hash, including file modes and file set,
then applies every original assertion to the deployment tree. Changes inside
`jarvis/` fail closed and require explicit source-boundary review. The guard's
negative tests prove that changed bytes, executable modes, and added files
change its identity. This is an import-integrity boundary, not a claim that
all historical source behavior has been security-qualified. Inspection of the
credential-pattern hits found mock OAuth responses/negative fixtures, not a
new credential configuration; no secret values are included in the evidence.

The original imported source tree remains `9f983eb6a86ddc1989c3d4e7b85fb7c7d2819938`
as recorded in the inventory and import evidence. PR236 updated the maintained-
tree guard for the Daily Board reader; the source-budget and scheduler fixes
update that guard to `30fc34ef73f9743cacb8605308f6a5c78fbc964d`. Each update changes only the
current allowed tree identity; it does not rewrite imported history or the
original source snapshot. Future edits under `jarvis/` still require an
explicit reviewed boundary update.

## Media component source

The unchanged media component now has its own exact destination identity in
[`jarvis-media-source.json`](../jarvis-media-source.json): commit
`7520eeaea05825ef8edafc5882ef4e053e99f26d`, path `jarvis/public/media`, tree
`c4d89e4aab446f6f79b17b7df911ec3c3f59e4d7`. Its bytes match the former
`c28c1b2f70aabb5217b08bf31ffe4c93d0353765:public/media` tree. The build keeps
the general release source and all other public paths on their existing pin,
then replaces only `dist/media` with the exact destination subtree. The
`dist/release.json` keeps the historical general source fields and adds the
media repository, commit, path and tree. The existing full-file artifact
manifest seals those bytes; its schema and historical receipt validation stay
unchanged.

## Daily Board route source

The byte-identical `daily-board` route now has an exact destination identity in
[`jarvis-dailyBoard-source.json`](../jarvis-dailyBoard-source.json): commit
`8201af9d10b6c0731f55c2b297b070b7922968d3`, path
`jarvis/public/daily-board`, tree
`b3214e6e8731cc0f3146d79a467c7c48710c3620`. Its tree matches the pinned
`c28c1b2f70aabb5217b08bf31ffe4c93d0353765:public/daily-board` tree. The build
replaces only `dist/daily-board` from that verified destination subtree; the
route's `/assets/*` dependencies remain from the general pinned source. The
resulting built route SHA256 matches the preserved pre-cutover artifact
manifest. `dist/release.json` now records both media and Daily Board component
identities while retaining the general source fields.

## Connect notice page source

The one-file static Connect notice was cut over in PR225 with an exact
destination identity in
[`jarvis-connect-source.json`](../jarvis-connect-source.json): commit
`41383d9d5154aab3b1d7922d5e7c376376139c07`, path `jarvis/public/connect`, tree
`14da00ba05225eddc0ad9d1717660c1f4b2e93c9`. Its tree matches the pinned
`c28c1b2f70aabb5217b08bf31ffe4c93d0353765:public/connect` tree. The build
replaces only `dist/connect`; its `/assets/shell.css` dependency remains on the
general pinned source, and the generated route matches the preserved
pre-cutover artifact manifest. PR225 is merged at
`2b29ab492af5a68bc49888cdb441fafdd38b5427`.

## Remaining cutover batches and estimate

The media, Daily Board, Connect, and unchanged route/data cutovers are merged.
PR226 merged at `54fb839d4efa26af6d4162d65b00e4308dffe274`. The independent
bundled-app batch is also merged: PR227 at
`cfaee9d3fbef4c18533155308cc625d6b696c085`.

- `content`, `portal`, `quick-ai`, `reader`, and `respond` have exact matching
  source/destination trees at the pinned source and current destination main.
  Their local runtime assets also match: Quick AI's CSS, JavaScript, config,
  and transitive modules; Reader's JavaScript and transitive modules; and the
  shared shell stylesheet used by Reader and Respond. Portal uses its existing
  external font and icon stylesheets. The source resolver validates these five
  subtrees together at destination commit
  `2b29ab492af5a68bc49888cdb441fafdd38b5427`, recorded in
  [`jarvis-routeData-source.json`](../jarvis-routeData-source.json).
- `favorites`, root `index.html`, `jarvis`, `notes`, `server`, `settings`, and
  `tools` have matching route trees, but load shared assets whose imported
  source differs. These seven routes remain on the exact active c28 public
  source snapshot described below. Their imported variants remain preserved
  under `jarvis/public` and are not activated by this build.

`mymedia` (8 files), `podcasts` (9), and `youtube-archive` (4) were cut over
with matching source/destination trees. Their local dependencies also match:
My Media's `assets/ui.js`, pip diagnostics, Drive config/API,
shell/premium/aligned CSS, and playback assets; Podcasts' config module and
shell/premium CSS; and YouTube Archive's internal stylesheet and pages. The
exact group is recorded in
[`jarvis-appBundles-source.json`](../jarvis-appBundles-source.json), and the
build records each identity in `dist/release.json`.

For future changed or dependency-sensitive paths, require exact per-path tree
checks, source tests, and built-file manifest comparison. The other public
differences are not candidates for blind copy: `assets` has 13 modified and 32
added files; `drawercast` has 4 modified and 2 added files; `guitar` has 2
modified files; `mast` and `muse` each have 1 modified file; and
`staticwebapp.config.json` differs. The added asset files
include private/security modules. Preserve destination-only `muse-key` and
`private` files. Review changed behavior and prove any behavior-preserving
movement before selecting the resulting batches. Keep the held playback and
security behavior unchanged.

The source import and root-media cleanup batches are complete: PR228 merged at
`07f010ae72148cc14e9872fc76373912f0b5a8f3`, PR229 at
`8a3e45d706c011f7052a66d77147ad47a143d5a3`, and PR230 at
`cc2a2b0c8693094d0c4dbdddeb8e53e0489fddf7`. PR230 superseded and closed the
older PR215 after its callers retired. PR234 fixed the success logger in the
guarded provenance publication and merged at
`217c0a49cb3bf3ba6a62a83388a226dca16456a7`. The provenance-only Azure
publication and actual post-deploy readback are complete in run
[39034316137](https://github.com/braydenparker000/Missionarytube-/actions/runs/39034316137).
Worker and R2 publications retain their separate gates.

## Active and pending public variants

The static build now starts from the exact pinned public tree at
`jarvis-active-public-c28/public`, recorded in
[`jarvis-activePublic-source.json`](../jarvis-activePublic-source.json):
destination repository `braydenparker000/Missionarytube-`, source commit
`de5d7177a778f4bfa2aa071ab064a8a4fb9b2246`, path
`jarvis-active-public-c28/public`, tree
`67a47e36414a8ceb4040c9454f64ed1982a9146c`. The snapshot tree is byte- and
mode-identical to `public/` at historical Jarvis commit
`c28c1b2f70aabb5217b08bf31ffe4c93d0353765`; source ancestry is retained in
destination Git history. Component-specific overlays continue to use their
existing exact destination identities.

`jarvis/public` remains the imported, pending variant and is unchanged. The
build resolves the active variant by exact repository, commit, path and tree,
then verifies the worktree against that commit before copying it. This keeps
the currently selected Relay/Mast/Muse UI, the seven dependent routes, and
held drawercast/Guitar/config behavior byte-for-byte as built. The frontend
release receipt records the active variant separately from the historical
general Worker source pin in `jarvis-release.json`; that pin and all Worker
release gates remain unchanged.

The active snapshot is at the repository root so the exact imported-source
guard for `jarvis/` remains unchanged. Its build comparison produced the same
194-file path set and the same SHA256 for every output file except
`dist/release.json`, whose additional active-variant provenance is intentional.
The output remains 20.09 MiB with no media payloads. A focused dependency walk
from the seven routes resolved all 25 referenced local files and JavaScript
modules. The pre-change sorted artifact manifest SHA256 was
`2c4786a24f2962097b29a26205860435a95b3e82a1d55df7e33d067020d56e17`; all
193 non-receipt artifact files kept their hashes, and only the receipt changed
to add variant provenance. The focused resolver/import/privacy tests passed,
and root `npm test` passed 1,147/1,147 tests.

The Daily Board reader still imports owner-authored publication comments from
the open `braydenparker999/jarvis#2` issue. The external scheduled writer
“Publish Jarvis Daily Board” still targets that issue. No repository writer
was identified; `jarvis_publish_briefing` is a separate Worker board API.
Treat the issue and automation as an operational dependency. Preserve the
original issue and messages until the reader, external writer, provenance,
  per-source cursors and deduplication can migrate together with rollback.
Destination issue #2 is already an imported PR and cannot be reused. No
issue, schedule, writer, or publication endpoint was changed here.

The current `release-qualified.json` digest is
`c064b89a4734848861d96a2bafc66cd27d359a1b090f9ca099b4a9c41bfc64f5`. Its
top-level receipt is from successful run `38404971865`; its parent chain is
mobile-file-save → simple-chat-tasks → owner-progress → the pinned c28 base.
The owner-progress checker had been applied directly to the latest wrapper and
rejected a valid chain. PR232 fixed the traversal order and preserved each
historical layer's existing checker and source pins. Read-only live run
`39005718644` then passed release lineage, R2 byte/Range/CORS checks, and
independent playback, seeking and artwork checks. This run used the PR232 merge
commit `bd2853c619bb3123e0761569928cca68d18a0239`. Earlier run
`39003845606` failed at the summarized step “Verify independent live playback,
seeking and artwork.” Its report artifact download returned HTTP 403, so the
exact inner assertion is unavailable. The later successful verifier supersedes
that historical failure; it is not an outstanding playback failure. The
provenance-only run below did not rerun the playback verifier.

The destination-owned static artifact was published through the provenance-only
route in run [39034316137](https://github.com/braydenparker000/Missionarytube-/actions/runs/39034316137)
on orchestration `217c0a49cb3bf3ba6a62a83388a226dca16456a7`. Its candidate has
194 files; 171 existing public files matched exactly, and the other 22 were
held at their already-live hashes. Those comprise private/shared overlay files,
drawercast and Guitar behavior, and configured keys; none were uploaded by this
route. The workflow verified the 63-path private-workspace receipt before and
after publication, bound the rollback artifact, published only `release.json`
and the additive `release-component-provenance.json` sidecar, then verified
lineage; rollback was skipped on success. Direct readback confirmed release
SHA256 `d676c6977fbfc8e44c2017342077273561c895e3b8d1d4e41583bf8601d4ce74`,
sidecar SHA256 `e0a350db6bf99b3b2a59ae2f6a1ca22303cb8f28d99689dc6cf59ca8884a85e4`,
all 22 preserved hashes, and HTTP 200 for `/`, `/mymedia/index.html`,
`/podcasts/index.html`, and `/reader/index.html`. Both published JSON objects
were served with `no-cache` headers. No application asset or Worker state
changed.

## Unchanged operational boundaries

`jarvis-release.json` still carries the historical general source identity
`braydenparker999/jarvis@c28c1b2f70aabb5217b08bf31ffe4c93d0353765` for Worker
qualification and release checks. The workflow checkout origins use
destination history. This batch changes only the static build's active public
tree and adds one separate, manually gated provenance-only static-storage
route. Worker configuration, schedules, credentials, package lock, component
pins, qualification gates, Azure endpoint and federation, and
publication/importer endpoints remain unchanged. This route does not run a
Worker or upload app files.

## Consolidation closeout and deferred work

The behavior-preserving code consolidation is complete for the agreed active
frontend and deployment source. PR216 imported the 926-file source history;
PR217–222 moved active root workflow checkouts to destination history; PR223–227
cut over the byte-verified component groups; PR228–230 completed import,
qualification and duplicate-root cleanup; PR231–234 bound and published the
active public source provenance path. These changes preserve the historical
source commit and current Relay/Mast/Muse behavior. The active checkout origin is
`braydenparker000/Missionarytube-`; the old `jarvis-release.json` repository
field remains the historical source identity, not an active checkout origin.

The following work is explicitly held or belongs to a separately scoped
operational migration; it is not a blocker to this behavior-preserving
consolidation:

- **Held source variants:** `favorites`, root `index.html`, `jarvis`, `notes`,
  `server`, `settings`, and `tools` remain on the active c28 snapshot because
  their shared dependencies differ. Other reviewed differences include 13
  modified and 32 added assets, Drawercast storage/playback changes, Guitar
  save-to-files changes, Mast/Muse UI changes, and `staticwebapp.config.json`.
  Private/security modules and destination-only `muse-key` and `private` files
  remain inactive. Activate none without a product/security decision and
  component-scoped qualification.
- **Daily Board operational dependency:** the reader still consumes comments
  from open `braydenparker999/jarvis#2`; external scheduled automation “Publish
  Jarvis Daily Board” (`6ac854579d1481918af16682c5b5936c`) still targets that
  issue. No repository writer was identified; `jarvis_publish_briefing` writes
  to a separate Worker board API. Destination issue #2 is already an imported
  PR. Preserve the old issue, messages and schedule. The reader now has a
  backward-compatible second-source path gated by both
  `JARVIS_DAILY_BOARD_DESTINATION_ENABLED=true` and an exact
  `JARVIS_DAILY_BOARD_DESTINATION_ISSUE`; neither is configured here, so the
  existing issue remains the only active feed. The additive journal keys
  comments by repository/issue/comment ID, stores exact source comment bodies,
  and keeps scan/watermark state per issue. Existing global publication-ID and
  same-date briefing reservations continue to suppress duplicates. No issue was
  created, feed switched, test content published, schedule/access changed, or
  deployment activated. The additive source has a separate ceiling of 144
  GitHub reads per UTC day, half of the unchanged 288-read reconciliation
  budget; both readers still share the existing 36-per-hour and 48-total-per-
  hour ceilings, with the historical feed processed first. Empty destination
  scans use adaptive 5-to-30-minute backoff. Journaled destination work retries
  locally before network reads, including after an upstream failure. The
  publisher status exposes bounded per-source pending/conflict counts,
  catch-up state and watermark presence; it excludes comment IDs and bodies.
  Repeated overlapping tail comments count as new activity only on first
  journal insertion, preserving historical-feed idle backoff. Unresolved
  destination journal rows use the persisted local retry cadence; new public
  generations can still wake and recover them immediately.
  A later cutover still requires a unique destination
  issue, source authentication/provenance verification through a watermark,
  switching the single writer only after dual-read validation, and a rollback
  that disables the destination reader while keeping the old feed untouched.
- **Historical inventory and separate release paths:**
  `release-inventory.json` remains the explicitly historical 2026-10-16
  observation of a limited 18-file/45-dependency private frontend closure and
  Worker metadata, not a complete current-site inventory. Refreshing broader
  inventories or Worker metadata is separate from this static provenance
  publication. Retain Drive/R2/music, private-board/collaboration, Makima/Muse,
  and egress release paths with their own gates; any credential or expanded
  access change requires separate authorization.
- **Legacy refs and media qualification:** preserve original repository refs;
  no rename, archive, or deletion is part of this plan. Existing media
  qualification remains NOT READY because of the documented UI TODOs and
  mobile-motion assertion. Do not weaken that gate. The successful live
  playback verifier above is distinct from these media qualification items.

No additional application cutover or deployment is required to close this
behavior-preserving phase. Keep the held variants and Daily Board dependency
visible in any future plan rather than describing this as full independence
from the former repository's operational feed.

Existing media qualification remains NOT READY (two documented UI TODOs and
an additional mobile-motion assertion reproduced on untouched main in the
prior cleanup evidence). Source import does not resolve or weaken that gate.

The execution checklists below preserve each historical patch's original
evidence and state; the dated consolidation closeout above is the current
status.

## Qualification build consumer: execution checklist

- **Obstacle / owner:** the qualification build job still acquired unchanged
  source from the former repository. Codex owns this bounded checkout cutover.
- **Scope:** only that build job's repository becomes
  `braydenparker000/Missionarytube-`; its exact workflow blob entry in
  `jarvis-release.json` becomes `44cddf3d3411f408dc42723bbe35abc325ea8c30`.
  Planning/component checkouts, deploy jobs, permissions, schedules, build
  scripts, source provenance and `GATE_RECIPE_SHA256` remain unchanged.
- **Identity:** retain source `c28c1b2f70aabb5217b08bf31ffe4c93d0353765`,
  tree `900f1e53227b84976619bbfdb2a3f17170f30429`. A fresh fetch from the
  destination verified both identities and an empty worktree status.
- **Required checks / reasons:** checkout-boundary coverage prevents other jobs
  or refs changing; artifact-identity checks preserve source/configuration
  binding; Worker recipe-policy checks require the exact updated workflow;
  partition/producer checks retain full qualification on recipe drift.
  The five focused files (`scripts/relay-source-bootstrap.test.mjs`,
  `tests/qualified-release.test.mjs`, `tests/relay-full-worker-release.test.mjs`,
  `tests/main-qualification-partition.test.mjs`, and
  `tests/main-qualification-producer.test.mjs`) passed 165 tests in 7.642s.
  The added stale-workflow-recipe case also passed a focused rerun in 0.981s,
  rejecting the old hash before any provider read, output or checkpoint.
- **Byte evidence:** isolated before/after builds used exact base/candidate
  package, release and build-script files. The baseline used the existing clean
  pinned checkout; the candidate used a fresh destination checkout. Builds
  passed in 0.319s / 0.298s (fetch plus both builds: 5.167s). All 194 dist files
  match each other and `../test-evidence/jarvis-source-import/after.sha256`;
  sorted-manifest SHA256 remains
  `b2ab23bac1a1824f605f680d94c2807e4e40e59480a749d591f6ee4558b5e0d5`.
- **Reuse / invalidation:** prior source/runtime evidence is reused because
  source bytes, dependencies, build scripts and runtime configuration did not
  change. A different pin/tree, input bytes, dependency lock or environment
  invalidates the corresponding evidence. The changed workflow and recipe
  are checked afresh. Artifact release/recipe metadata changes intentionally;
  byte identity does not authorize reuse of an incompatible production receipt.
  Historical deduplication hashes remain unchanged and continue to require
  full qualification. No unrelated broad suite was run manually; required
  root orchestration/build checks run in draft-PR CI.
- **Finish / state:** draft publication plus terminal CI and exact-diff review
  complete this patch. It is not merged or deployed by this task. CI waiting
  and final readiness are reported on the PR; no credential/access blocker
  occurred during preparation. Existing media TODOs/mobile-motion failure and
  the separately observed live-music release-check failure are not fixed or
  weakened by this checkout change.

## Qualification checkout origin: execution checklist

- **Obstacle / scope:** after the build checkout moved, planning and component
  qualification still fetched the exact same Jarvis source from the former
  repository. Only those two checkout origins now use the surviving repository;
  deploy jobs, schedules, credentials, source pin, tree, suite selection and
  original source provenance stay fixed.
- **Identity:** source `c28c1b2f70aabb5217b08bf31ffe4c93d0353765`, tree
  `900f1e53227b84976619bbfdb2a3f17170f30429`; verified commit is reachable from
  destination `main` before changing either checkout.
- **Checks / reason:** checkout-boundary test requires all three qualification
  checkouts to use destination history, keeps only the source-origin proof
  identity, and verifies the exact source pin plus workflow recipe hash. Relay
  Worker release identity also binds the updated workflow blob through the
  `jarvis-release.json` recipe. Focused checkout, release-recipe and provenance
  checks passed 31 tests in 7.4 seconds; diff whitespace check passed. Full
  root CI runs on the draft PR.
- **Finish / state:** one exact-diff review and terminal draft-PR CI complete
  this patch. It is not merged or deployed. The two existing shipped UI TODOs
  and the live-music release-check failure remain outside this checkout change.

The frontend regression suite also compares the pinned source against
historical My Media commit `8c4f6de790b3e06cd78b11706dfa2c055174bbf1`, retained
by original ref `fix/mymedia-count-clarity-qualified-20261010` in the original
Jarvis repository. PR225 originally fetched that exact ref because the commit
was not reachable in destination history. This cutover preserves its original
ancestry through a no-tree-change merge parent, then fetches the current
qualification ref from Missionarytube- and verifies the exact baseline SHA
without moving the pinned checkout HEAD or changing its worktree. The original
Jarvis ref remains untouched. This keeps the historical before/after
comparison while removing the qualification lane's remaining source fetch
from the former repository. The separate live thumbnail test in
`mymedia-layout-browser.test.js` timed out on the unchanged pinned source when
the environment's request to `i.ytimg.com` returned 403; the assertion is
preserved and the network-dependent result is not treated as a code regression.

## Historical qualification baseline origin: execution checklist

- **Scope:** the frontend qualification lane still needs the exact My Media
  before/after test commit `8c4f6de790b3e06cd78b11706dfa2c055174bbf1`, but no
  longer fetches its branch from the former repository. A merge commit with
  the destination tree unchanged records that historical commit as a second
  parent. The workflow fetches its current event ref from Missionarytube- into
  the pinned source checkout, verifies the baseline SHA, and confirms the
  pinned checkout HEAD and worktree did not move.
- **Preservation:** the original upstream branch and all files remain intact;
  only Git ancestry, the qualification fetch URL, and the qualification
  workflow's recorded recipe hash changed. No application, deployment
  endpoint, credential or publication path changed.
- **Checks:** the checkout-origin and qualification workflow checks pass; the
  focused checkout, qualified-release and Worker release suites passed 32
  tests. `check-release-inventory.mjs release-inventory.json` reports the
  saved observation valid and not live-verified. Root CI provides the full
  required checks for this workflow and release-recipe update. No deployment
  was run.

## Fixed source checkout origins: execution checklist

- **Obstacle / scope:** sixteen source checkouts across the main Azure workflow
  and six compatible publisher/verifier workflows still named the former
  repository. Their fifteen distinct commits were each verified as ancestors
  of destination `main` before changing origins. Checkout refs, source trees,
  script behavior, workflow schedules, manual gates, credentials, permissions
  and publication destinations stay unchanged.
- **Checks / reason:** a focused boundary test enumerates every migrated ref,
  retains historical source provenance and protects intentionally excluded
  dynamic or unreachable checkouts. The deployment workflow recipe hash in
  `jarvis-release.json` is updated to its exact new blob. Focused publisher,
  qualification, recipe and prewrite checks passed 210 tests in 8.4 seconds;
  `git diff --check` passed. CI and post-merge results are recorded on this PR.
- **Finish / state:** the exact diff was reviewed once; this patch was merged
  without running production publication, upload, migration or deployment jobs.
- **Remaining dependencies:** historical proof identities, provenance readers,
  publication endpoints and Daily Board issue #2 remain tied to their existing
  owners. The active `migrate-music-r2.yml` source checkouts now use destination
  history while preserving the fixed validation pin and exact validated SHA.

## Provenance-gated dynamic checkouts and Astra source: execution checklist

- **Scope:** both runtime `source_commit` checkouts now use destination history
  and reject unless the checked-out HEAD is the exact input, the input is a
  40-character SHA, the origin is the surviving repository and the commit is
  an ancestor of destination `main`. Full history is fetched before this check;
  existing source tests and manual actions remain in place. Astra's exact
  `f999581aa979712b4b63a6783b7c56842fedb6a1` source checkout also uses
  destination history while its original release identity and `4532...`
  orchestration pin remain unchanged.
- **Astra history:** public commit inspection showed `4532be6b6842320ed0cc64be973425d9505c7b03`
  has only one file change: the `jarvis-release.json` source pin moves from
  `c4d62409a3b67e4e5dac88809c6a4a0290b6e39e` to `f999581aa979712b4b63a6783b7c56842fedb6a1`.
  GitHub's public comparison shows this commit is already behind current
  destination `main`; no additional history preservation is needed. The
  existing Astra release branch is left untouched and its workflow was not run.
- **Checks / finish:** focused accepted/rejected source, origin-boundary, Astra
  proof and manual-gate checks passed 29 tests in 0.6 seconds. This patch did
  not run deployment, analysis, upload, migration or Astra workflows; applicable
  CI, integration and terminal post-merge checks are recorded on this PR.
- **R2 migration checkout:** both `migrate-music-r2.yml` source checkouts use
  destination history, preserving fixed validation
  pin `dd0797bd48431ea04354f83663c3df765cc8f5b0` and exact validated dynamic
  `source_sha`. The push-path validation remains separate from its manual
  migration job. Original Actions proof identities, provenance readers and
  publication destinations remain on their existing owners.
