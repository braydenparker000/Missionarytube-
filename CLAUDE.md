# Claude repository instructions

## Mission

Maintain MissionaryTube as a fast, reliable, mobile-first static web app whose deployable source lives on `main`.

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
