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

## Importing the current site

When the current production HTML is supplied:

1. Replace the placeholder `index.html` on a new branch.
2. Add any referenced local assets under `assets/`.
3. Remove private tokens or user-specific addon configuration before committing.
4. Run `npm test` and `npm run build`.
5. Compare the built `dist/index.html` with the supplied source and test on Android Chrome.
6. Merge only after confirming the GitHub version matches the intended live behavior.
