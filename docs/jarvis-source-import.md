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
selected source. The preflight source `4532be6b6842320ed0cc64be973425d9505c7b03`
and open-work heads outside either parent are not independently published here.
Their existing refs remain intact; preserving those objects in Missionarytube-
requires a separately reviewed publication. An inventory reference is not a
replacement for an archival ref if the original repository is later deleted.
No open PR behavior is accepted merely by listing it.

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
- Switch source/test/build consumers to the surviving repository one component
  at a time, preserving artifact hashes, upload ordering, rollback receipts,
  dependency checks and static-only versus Worker release boundaries.
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
