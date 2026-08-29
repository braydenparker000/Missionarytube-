# MissionaryTube

MissionaryTube is a mobile-first static web app hosted from Azure Storage.

- Live site: https://missionarytube.z13.web.core.windows.net/
- Source of truth: the `main` branch in this repository
- Current state: the existing single-file Astra site is imported and ready for GitHub-managed development
- Deployment state: prepared but disabled until the one-time Azure OIDC setup is complete

## Commands

No local computer is required for normal development. Claude and ChatGPT/Codex can work through GitHub branches and pull requests.

```bash
npm test
npm run build
```

The project has no runtime or development dependencies. The build copies deployable files into `dist/`.

## Repository map

| Path | Purpose |
| --- | --- |
| `index.html` | Static app entry point |
| `assets/` | CSS, JavaScript, images, icons, and other browser assets |
| `scripts/` | Dependency-free validation and build scripts |
| `docs/WORKFLOW.md` | Phone-first GitHub development workflow |
| `docs/AI-COLLABORATION.md` | Claude implementation and Codex review protocol |
| `docs/EVALUATION.md` | Blind Claude-vs-Codex competition rules |
| `docs/AZURE-DEPLOYMENT.md` | One-time Azure and GitHub deployment setup |
| `evals/` | Competition specifications and recorded results |
| `AGENTS.md` | Instructions for ChatGPT/Codex |
| `CLAUDE.md` | Instructions for Claude |
| `.github/workflows/` | Validation and gated Azure deployment automation |

## Normal change workflow

1. Start a branch from the latest `main`.
2. Implement one focused change.
3. Run `npm test` and `npm run build`.
4. Open a pull request with acceptance criteria and evidence.
5. Have the other AI review the diff.
6. Fix valid findings, wait for CI, then squash-merge.

See [docs/WORKFLOW.md](docs/WORKFLOW.md) for the phone-only process and [docs/EVALUATION.md](docs/EVALUATION.md) for fair competitions.

## Security

Never commit Azure keys, connection strings, client secrets, personal access tokens, configured addon URLs, or private user data. Deployment uses short-lived GitHub OIDC tokens. Configuration values are stored in GitHub Actions secrets or variables, not in repository files.
