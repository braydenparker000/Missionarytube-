# Phone-first development workflow

GitHub is the source of truth. The live Azure site is a deployment target, not a place to edit independently.

## Standard feature or fix

1. Create a focused issue with the problem, acceptance criteria, and observable failure or desired behavior.
2. Create a branch from the latest `main` using a descriptive prefix:
   - `feature/<short-name>`
   - `fix/<short-name>`
   - `refactor/<short-name>`
3. Ask Claude for the first implementation using the issue and exact starting commit.
4. Open a pull request. CI runs dependency-free validation and a production build.
5. Ask ChatGPT/Codex to review the pull request adversarially.
6. Apply fixes only when the finding is reproducible or tied to an acceptance criterion.
7. Wait for green CI and squash-merge.
8. Once Azure deployment is enabled, merging to `main` deploys automatically.

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

The current build reads the Jarvis checkout pinned by `jarvis-release.json`.
Media HTML and assets live under that checkout's `public/media/`; the former
root `index.html` and `assets/` app copy have been retired. Do not recreate them
for frontend changes. See [README.md](../README.md#media-regression-checks) for
checkout preparation and regression checks. Run `npm test` and `npm run build`
with that exact checkout, then inspect `dist/` and test on Android Chrome when
changing user-visible behavior.
