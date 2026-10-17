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

The import is frozen for this first patch: do not install dependencies or
write generated files inside it before updating the boundary in the next
reviewed source-development patch.

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

## Unchanged operational boundaries

`jarvis-release.json` still selects external source `c28c1b2f70aabb5217b08bf31ffe4c93d0353765`.
The build, Worker configuration, root workflows, schedules, credentials,
package dependencies/lockfile, component pins, qualification gate recipes,
Azure endpoint and federation, and publication/importer endpoints are unchanged.
PR215 remains unmerged; this patch does not retire its root media files or reuse
its external-checkout test-routing change. No imported release workflow runs.

## Remaining component-cutover checklist

- Reconcile source-main differences (including seven main-only files) and
  accepted open work by subsystem; keep held work held.
- Establish component inventories beyond the existing private frontend's
  18 published files and 45 preserved dependencies. Refresh Worker metadata
  separately; a public receipt is not a new live Worker observation.
- Continue switching source/test/build consumers to the surviving repository
  one component at a time, preserving artifact hashes, upload ordering,
  rollback receipts, dependency checks and static-only versus Worker release
  boundaries.
- Migrate repository-specific qualification provenance with fresh proofs;
  preserve historical proof origins. Update workflow path filters and gate
  recipes together only in that reviewed cutover, not this import.
- Retain the approved PR215 deletion/assertion inventory for the cutover that
  actually retires the root app; do not merge PR215 independently.
- Preserve Daily Board issue #2 and its importer until a coordinated endpoint,
  provenance, cursor/deduplication and agent-schedule migration is reviewed.
- Retain Drive/R2/music, private-board/collaboration, Makima/Muse and egress
  release paths. Any credential or expanded-access change is separately gated.
- Complete agent references and archival decisions only after the replacement
  paths work. No rename, archive, deletion, merge or deployment in this patch.

Existing media qualification remains NOT READY (two documented UI TODOs and
an additional mobile-motion assertion reproduced on untouched main in the
prior cleanup evidence). Source import does not resolve or weaken that gate.

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
