# Codex repository instructions

## Mission

Maintain Jarvis as the primary frontend on the existing MissionaryTube Storage endpoint. Keep the repository name, main branch, and Entra deployment identity unchanged. `jarvis-release.json` pins the Jarvis source; legacy MissionaryTube source remains available in Git history and the documented backup branch for rollback.

## Consolidation destination

`braydenparker000/Missionarytube-` is the surviving repository. Authoritative
Jarvis application source is imported under `jarvis/`; use its canonical
[delivery SOP](jarvis/.agents/skills/deliver-software-efficiently/SKILL.md).
This root guidance supersedes the imported delivery plan's former two-repository
destination. Keep the imported snapshot exact until the component-cutover patch
is reviewed; the import guard fails on byte, mode, or file-set changes.

The deployed build still uses the external checkout selected by
`jarvis-release.json`. Importing source does not switch production or authorize
running nested workflows. Root `npm test` is the deployment suite; imported
application tests remain a separately qualified component. Do not run them as
an accidental part of root discovery. Preserve Daily Board issue #2, current
release paths and all original repository refs. See
[the import record](docs/jarvis-source-import.md) for remaining cutover work.

## Required checks

Before proposing or merging changes:

1. Run `npm test`.
2. Run `npm run build`.
3. Inspect the diff for accidental credentials, private addon URLs, user data, and unrelated edits.
4. State which acceptance criteria were verified and which could not be verified.

## Engineering constraints

- Preserve static Azure Storage compatibility: browser HTML, CSS, JavaScript, and static assets only unless a documented architecture change is approved.
- Treat Android Chrome as the primary client.
- Keep tap targets, safe-area insets, reduced-motion behavior, and keyboard accessibility intact.
- Avoid adding dependencies for work that the platform can do clearly and reliably.
- Never commit secrets, tokens, storage keys, connection strings, configured private addon URLs, or credentials.
- Do not edit deployment authentication to use long-lived Azure keys unless the repository owner explicitly changes the security decision.
- Keep changes focused and reversible.

## Collaboration modes

For normal work, Codex is the adversarial reviewer after Claude's first implementation: find reproducible bugs, security problems, regressions, performance issues, and missed acceptance criteria, then fix confirmed problems.

For an arena task, follow [docs/EVALUATION.md](docs/EVALUATION.md). Start from the exact recorded base commit, do not inspect the other contestant's branch before submission, and do not self-score.
