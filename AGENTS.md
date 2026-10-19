# Codex repository instructions

## Mission

Maintain Jarvis as the primary frontend on the existing MissionaryTube Storage endpoint. Keep the repository name, main branch, and Entra deployment identity unchanged. `jarvis-release.json` retains the historical backend source and release configuration; editable frontend source lives in `frontend/`; legacy MissionaryTube source remains available in Git history and the documented backup branch for rollback.

## Consolidation destination

`braydenparker000/Missionarytube-` is the surviving repository. Edit static
frontend components only in `frontend/`; this is the complete selected input to
`scripts/build-jarvis.mjs`. The build generates frontend/component commit and
byte/mode tree provenance. Do not maintain component commit or tree pins.
Worker code is editable in `backend/`, with its existing behavior/security tests
in `backend/tests/`. The backend imports shared modules from `frontend/`, not
from the archived public tree. Root `npm ci` installs both workspace dependency
sets; `npm run test:backend` runs the current application suite. CI requires it
with the approved Node/Chrome runtimes and isolated fixtures.
Local edits can build and test; publication requires a committed checkout and
matching generated provenance. Never replace this source with an imported variant.

`jarvis/` is a frozen imported archive, including dormant variants, retained
backend inputs and the canonical
[delivery SOP](jarvis/.agents/skills/deliver-software-efficiently/SKILL.md).
Its exact import guard remains intact. This root guidance supersedes dated
checkpoints in the imported [delivery plan](jarvis/docs/delivery-plan.md).
`.jarvis-source` at the `jarvis-release.json` commit remains a read-only fixture
for historical qualification and rollback contracts; normal application builds
and publishers use the current frontend/backend workspaces. Its old repository field records historical identity;
checkouts use destination history in `braydenparker000/Missionarytube-`.
See [the source import record](docs/jarvis-source-import.md) and the selected
publisher for component-specific live preservation and rollback boundaries.
The build now reproduces the accepted public/private/music/cache application
bytes, including automatically fingerprinted music URLs. Configured assets and
content remain provider-owned and excluded from application publishing. The
normal Azure workflow publishes the whole selected frontend with generated
provenance and trusted prior-run evidence. Initial adoption requires every
runtime path already exist and match candidate bytes or immutable accepted
publication evidence; it cannot activate an imported variant. Subsequent
releases use generated receipts. Normal publishers reuse the exact successful
main Validate artifact, not another qualification run. Never update historical
pins for a new feature or release. The former specialized forward publishers
are retired; historical Daily Board restore remains available. The Drive
catalog publisher uses accepted current-workspace helpers with its existing
OAuth guard, parser, hourly schedule and identity.

Root `npm test` is the deployment suite; imported application tests remain
separately qualified. Run relevant imported tests explicitly, not through
accidental root discovery. Preserve original repository refs and publication
history, including legacy `braydenparker999/jarvis#2` and destination
`braydenparker000/Missionarytube-#250`; destination #2 is an imported PR.
Dated release maps and import checkpoints do not establish current live or
external-writer state. Use exact publisher receipts and current readback.
Do not reopen verified completed work based solely on a dated checkpoint.
Owner holds remain binding regardless of document age unless explicitly lifted
by the owner or superseded by verified owner instructions.

A merge or successful qualification is not shipment. Production publication
uses an explicitly authorized manual workflow and its existing identity,
qualification, backup and readback gates. Do not run nested workflows or
change schedules, credentials or access as an implied part of source work.

## Required checks

Choose validation by affected behavior, dependencies and release risk, following
the canonical SOP. This section replaces the former blanket requirement to run
`npm test` and `npm run build` for every proposed change.

- For every change, inspect the complete diff for credentials, private addon
  URLs, user data and unrelated edits. Report verified acceptance criteria,
  commands/results and remaining uncertainty.
- Routine documentation-only changes require diff/privacy review, relative-link
  validation and factual checks against the relevant source or workflow. Do not
  rerun application tests or builds solely for prose changes. Executable
  examples and documentation governing release or security behavior also need
  verification against the affected contracts; a Markdown extension alone does
  not establish low risk.
- For behavioral changes, run focused regressions first, then affected-component
  and integration checks based on dependency impact. For shared infrastructure,
  security or release changes, run the full applicable qualification, including
  root `npm test` and `npm run build` where the deployment suite/build is affected.
  Preserve authentication, negative-case, artifact-identity and rollback checks.
- Actual required CI checks and publisher qualification remain mandatory before
  merge/publication. This local validation policy does not change workflow
  triggers, branch protections or release gates. Reuse existing evidence only
  when its revision, dependencies, configuration and environment assumptions
  remain valid; do not treat an unrun required check as passed.

## Engineering constraints

- Preserve static Azure Storage compatibility: browser HTML, CSS, JavaScript, and static assets only unless a documented architecture change is approved.
- Treat Android Chrome as the primary client.
- Keep tap targets, safe-area insets, reduced-motion behavior, and keyboard accessibility intact.
- Avoid adding dependencies for work that the platform can do clearly and reliably.
- Never commit secrets, tokens, storage keys, connection strings, configured private addon URLs, or credentials.
- Do not edit deployment authentication to use long-lived Azure keys unless the repository owner explicitly changes the security decision.
- Keep changes focused and reversible.

## Collaboration modes

Use one assigned delivery owner for implementation, evidence and completion.
Choose review depth by risk, not model/provider identity. Small isolated changes
need a complete diff review and relevant checks, without a mandatory second
agent or serial handoff. Shared infrastructure, security and release changes
need adversarial review of affected contracts and failure paths, with independent
review where required by the task or existing release process. Review once
comprehensively, then verify fixes and their impact; reopen unchanged code only
for new evidence or material risk. See [collaboration guidance](docs/AI-COLLABORATION.md).

For an arena task, follow [docs/EVALUATION.md](docs/EVALUATION.md). Start from the exact recorded base commit, do not inspect the other contestant's branch before submission, and do not self-score.
