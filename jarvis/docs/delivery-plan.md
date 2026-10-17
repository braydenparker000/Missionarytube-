# Jarvis delivery plan

Status checkpoint: 2026-10-17. Missionarytube- is the surviving source and deployment repository. This plan coordinates bounded changes; it does not authorize new access, release activation, held work or a product rewrite.

## Goals

1. Simplify the source/release structure: authoritative application source in Jarvis, explicit component versions and an understandable release path.
2. Make individual modules faster to change: focused checks first, preserved source-unit coverage and exact shipped-artifact validation.
3. Make collaboration reliable: one delivery owner, concrete artifacts and finish lines, fewer repeated handoffs and evidence-based review.

Use the canonical [delivery SOP](../.agents/skills/deliver-software-efficiently/SKILL.md). Lucy owns SOP rollout and integration; Mast owns the release-inventory documentation candidate; Makima owns the duplicate-retirement boundary and coverage plan. Agents without automatic skill discovery should explicitly read the linked file. Deployment repositories should link here rather than maintain another SOP copy.

## Current source and release checkpoint

The imported Jarvis history is maintained under `jarvis/` in repository
`braydenparker000/Missionarytube-` (ID `1350047370`). The active frontend build
starts from destination commit `de5d7177a778f4bfa2aa071ab064a8a4fb9b2246`,
path `jarvis-active-public-c28/public`, tree
`67a47e36414a8ceb4040c9454f64ed1982a9146c`. This tree is byte- and
mode-identical to the former
`c28c1b2f70aabb5217b08bf31ffe4c93d0353765:public` tree. It then applies only
component-scoped trees with exact destination identities. The imported
`jarvis/public` tree remains preserved but is not
wholesale active. The general pin in `jarvis-release.json` remains for
qualification and other release consumers; it does not describe every live
component. The existing Azure Storage frontend deployment route and identity
remain in place, and a merge or successful qualification alone does not prove
that an upload ran. See the [source and component evidence](../../docs/jarvis-source-import.md)
for each active and held path.

Shared UI differences and the changed Drawercast, Guitar, Mast/Muse, security,
configuration and device variants remain held pending scoped behavior and
security decisions. Keep the active snapshot for dependent routes until an
equivalent behavior is proven and the component passes its own qualification.
Do not activate destination-only private modules or change storage, playback,
credentials, permissions, schedules or other responders as part of this plan.

The additive Daily Board destination-reader code was published to the existing
Worker in [run 39040982427](https://github.com/braydenparker000/Missionarytube-/actions/runs/39040982427)
(code SHA-256 `74c8bf880a674b19bfeab74f65cf87e069b9f88233c4e65eba37393b13d0064d`),
but its destination-feed path remains disabled: no destination issue or
enabling configuration is set. The current feed still reads the open
[`braydenparker999/jarvis#2`](https://github.com/braydenparker999/jarvis/issues/2),
“Jarvis publications — replies and Daily Board.” The external scheduled
automation “Publish Jarvis Daily Board” (`6ac854579d1481918af16682c5b5936c`)
still targets that issue. Destination issue #2 is already an imported PR.
Preserve the old issue, comments and schedule until a separately approved
migration allocates a unique destination issue, enables and validates the
dual-reader through a watermark, switches the one writer, and verifies rollback.
The active feed selection, writer, issue, schedule and publication endpoint
have not been changed. Only the additive, disabled reader path is deployed.

The interface-only lazy-loading optimization was reviewed and rejected for
this consolidation batch: no FCP benefit was measured, while preserving the
divergent live override source and private-session lifecycle would expand
ownership and regression risk. No speedup is claimed. The current interaction
evidence and explicit disposition are in the
[consolidation acceptance record](../../docs/jarvis-source-import.md#current-acceptance-and-optimization-disposition-2026-10-17).

## Delivery sequence and finish lines

### 1. Close the current test-infrastructure batch

[Deployment repository PR213](https://github.com/braydenparker000/Missionarytube-/pull/213) merged as `0c521d76b5f1c12ea38d5cc07d96c8ca6f1b725b`. The batch moved media tests toward pinned Jarvis source; it did not change application assets, source pins, workflows or deployment.

DONE for this historical infrastructure batch: merge verified and evidence retained in the PR. The media UI repair merged as PR248 at `b3853e336b5c12d037605d73186884af34660998` and was published successfully by run [39060426739](https://github.com/braydenparker000/Missionarytube-/actions/runs/39060426739). It moves `appearance.js` before the stylesheets and reapplies the 390px backdrop override after the shared rule; shipped qualification covers computed pre-paint appearance and the completed mobile CSS cascade. Its rollback is GitHub Actions artifact `media-only-rollback-39060426739-1` (ID `12111127615`, SHA-256 `29da793f671a929075522ad3011ba43c223a037eb49f9810e4a54b9db4790a12`, retained through 2027-01-15). Current live music verification passed 19 browser checks in run [39060584579](https://github.com/braydenparker000/Missionarytube-/actions/runs/39060584579). See the [acceptance record](../../docs/jarvis-source-import.md#current-acceptance-and-optimization-disposition-2026-10-17) for verified-TLS cloud interactions and remaining authenticated Relay, guitar playback, Daily Board and physical-device limits.

### 2. Retire duplicate application code reversibly

Makima supplies the exact deletion boundary, consumers, assertion-to-replacement coverage map and unchanged-output proof plan. Lucy makes the implementation/integration decision after that bounded plan; planning does not start deletion.

DONE: authoritative source is explicit; no remaining build/runtime/test caller silently uses the retired copy; source-only unit coverage remains in the source repository; shipped-artifact and integration checks still exercise the actual output; before/after build outputs match for this behavior-preserving batch; required CI passes and a reverting commit restores the prior state. Keep evidence and licenses where required. Do not combine runtime bug fixes with retirement.

### 3. Document the real release map

Mast prepares a concise source-to-component-to-artifact-to-publisher map from current manifests, workflows and readbacks, including independent frontend/backend versions and recovery references. Avoid assuming README statements or a branch name alone establish what is live.

DONE: every shipped component has a verified source revision, build/input path, publication owner/mechanism, delivery target, check and rollback reference; differences between source, release and live states are explicit. This is documentation, not a pin or deployment change.

### 4. Reconcile branch histories deliberately

The verified source base for this SOP is `feat/simple-chat-tasks` at `572415b0b1d7f3bd8470590dbbe97a48f5bf02fd` after [PR174](https://github.com/braydenparker999/jarvis/pull/174). Recheck heads before subsequent work. Do not treat divergent `main` as automatically authoritative or blindly reset either history.

DONE: ancestry and unique accepted changes are inventoried; a reviewed merge or selective integration preserves accepted work and relevant evidence; the combined candidate passes applicable checks; source and release documentation agree with the chosen result. Held work remains held.

## Working boundaries

Keep runtime bugs in separate bounded batches with their own reproductions and acceptance evidence. No framework migration or UI rewrite is part of this plan. No credential, expanded-access, purchase, destructive operation, workflow, pin or settings change is implied. Each next batch names its exact owner, scope, artifact, required checks and stopping condition before implementation.

Measure editing, test execution, environment setup, queue time and review/handoff waiting separately. Use observed delays to choose improvements; do not add process merely to count activity.
