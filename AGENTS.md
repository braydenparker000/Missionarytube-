# Codex repository instructions

## Mission

Maintain Jarvis as the primary frontend on the existing MissionaryTube Storage endpoint. Keep the repository name, main branch, and Entra deployment identity unchanged. `jarvis-release.json` pins the Jarvis source; legacy MissionaryTube source remains available in Git history and the documented backup branch for rollback.

## Consolidation destination

`braydenparker000/Missionarytube-` is the surviving repository. Authoritative
Jarvis application source is imported under `jarvis/`; use its canonical
[delivery SOP](jarvis/.agents/skills/deliver-software-efficiently/SKILL.md).
This root guidance supersedes dated checkpoints in the frozen imported
[delivery plan](jarvis/docs/delivery-plan.md). Preserve the import integrity
boundary; maintained component changes must use the existing exact-source
manifests and guards, not a wholesale snapshot replacement.

The current static build uses `jarvis-active-public-c28/public` plus exact
component overlays resolved by `scripts/media-source.mjs` and the explicit
navigation/configuration transforms in `scripts/build-jarvis.mjs`.
`.jarvis-source` is still required at the `jarvis-release.json` commit for
qualification and retained release consumers, but active workflow checkouts
use destination history in `braydenparker000/Missionarytube-`. The manifest's
old repository field is historical identity, not the current checkout origin.
See [the import record](docs/jarvis-source-import.md) and the actual selected
publisher for component-specific source, preservation and rollback boundaries.

Root `npm test` is the deployment suite; imported application tests remain
separately qualified. Run relevant imported tests explicitly, not through
accidental root discovery. Preserve original repository refs and publication
history, including legacy `braydenparker999/jarvis#2` and destination
`braydenparker000/Missionarytube-#250`; destination #2 is an imported PR.
Dated release maps and import checkpoints do not establish current live or
external-writer state. Use exact publisher receipts and current readback;
completed product work is not reopened by a historical hold.

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
