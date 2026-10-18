# Phone-first development workflow

Use the canonical [delivery SOP](../jarvis/.agents/skills/deliver-software-efficiently/SKILL.md)
with the repository-required checks. GitHub holds source and release tooling;
exact publisher receipts and readback establish live state. The live Azure site
is a deployment target, not a place to edit independently.

## Standard feature or fix

1. Create a focused issue with the problem, acceptance criteria, and observable failure or desired behavior.
2. Create a branch from the latest `main` using a descriptive prefix:
   - `feature/<short-name>`
   - `fix/<short-name>`
   - `refactor/<short-name>`
3. Use the assigned delivery owner and exact starting commit. The default Claude implementation / Codex review lane applies when no task-specific assignment supersedes it.
4. Open a pull request when authorized. CI runs the existing qualification and build checks. A draft PR is an intermediate artifact when the requested outcome is verified shipment.
5. Review the complete bounded diff adversarially using the assigned reviewer. Verify subsequent fixes and their impact; reopen unchanged code only for new evidence or material risk.
6. Apply fixes only when the finding is reproducible or tied to an acceptance criterion.
7. Require applicable green checks and authorization before merge.
8. For an authorized shipment, select the existing component publisher and exact
   reviewed revision. The general Azure workflow's production job requires
   manual `workflow_dispatch`, main, `AZURE_DEPLOY_ENABLED`, qualification
   success and its input exclusions. Specialized jobs have their own gates.
   Matching main pushes can qualify code; merge does not deploy automatically.
9. Verify the actual target with the publisher's readback and relevant runtime
   acceptance. Report implementation, review, merge, deployment and live
   verification separately. If publication is outside the task's authorization,
   deliver the tested local candidate and state that boundary.

The repository owner can do issue and PR approval from GitHub's Android app. The AIs should perform file, branch, commit, diff, review, merge, and Actions work whenever their GitHub connections allow it.

## Pull-request handoff

Every implementation should report:

- exact base commit
- goal and acceptance criteria
- changed files
- commands run and results
- performance or bundle-size change when relevant
- known limitations
- screenshots or recordings for visual changes when available

## Emergency live-site fix

Use a `fix/` branch and the normal PR checks. If production is unusable, a fast merge is acceptable only after the minimum automated checks pass. Follow it with a full review issue; do not make Azure portal edits that are absent from GitHub.

## Frontend source and checks

The static build starts with the destination-owned active snapshot and exact
component overlays in `scripts/media-source.mjs`; `scripts/build-jarvis.mjs`
also applies explicit navigation/configuration transforms. The pinned
`.jarvis-source` checkout remains required for qualification and retained
release consumers and comes from destination repository history. The old
repository field in `jarvis-release.json` is historical identity. Do not
recreate retired root `index.html` or `assets/` copies. See
[the import record](jarvis-source-import.md) and [README.md](../README.md#media-regression-checks)
for component boundaries and checkout preparation.

Run focused checks first, then required `npm test` and `npm run build`. Current
repository and CI requirements remain mandatory; risk-scoped checks guide
iteration and additional acceptance, not bypassing release qualification.
Inspect `dist/` and test the changed user-visible behavior on Android Chrome
when applicable.

## Interruption and completion

Use existing request IDs, immutable results and supported job reads to recover
recorded progress. Callback acceptance is not execution; lease expiry indicates
uncertainty, not permission to repeat consequential work. Persist a concrete
artifact or handoff before ending a turn. Report a job as running only with
current execution evidence. Continue independent approved work when an optional
item is blocked. Repository state can expose incomplete work and preserve
recorded evidence; it cannot make a hosted assistant resume after its job ends.
