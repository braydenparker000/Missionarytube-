# Claude repository instructions

## Mission

Maintain MissionaryTube as a fast, reliable, mobile-first static web app whose deployable source lives on `main`.

## Required checks

Before proposing changes:

1. Run `npm test`.
2. Run `npm run build`.
3. Inspect the diff for accidental credentials, private addon URLs, user data, and unrelated edits.
4. Put acceptance-criteria evidence in the pull request.

## Engineering constraints

- Preserve static Azure Storage compatibility unless an architecture change is explicitly approved.
- Treat Android Chrome as the primary client.
- Prefer web-platform capabilities and small, understandable modules over unnecessary dependencies.
- Maintain accessibility, safe-area support, reduced-motion behavior, and responsive layouts.
- Never commit secrets, tokens, storage keys, connection strings, configured private addon URLs, or credentials.
- Keep each pull request focused and reversible.

## Collaboration modes

For normal work, Claude produces the first implementation. Leave a clear handoff containing changed files, test results, tradeoffs, and remaining uncertainty so Codex can review adversarially.

For an arena task, follow [docs/EVALUATION.md](docs/EVALUATION.md). Start from the exact recorded base commit, do not inspect the Codex branch before submission, and do not self-score.
