# Codex repository instructions

## Mission

Maintain MissionaryTube as a fast, reliable, mobile-first static web app whose deployable source lives on `main`.

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
