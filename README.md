# MissionaryTube

MissionaryTube is a mobile-first static web app hosted from Azure Storage.

- Live site: https://missionarytube.z13.web.core.windows.net/
- Source of truth: the `main` branch in this repository
- Current state: the existing single-file Astra site is imported and ready for GitHub-managed development
- Deployment state: prepared but disabled until the one-time Azure OIDC setup is complete

## Commands

No local computer is required for normal development. Claude and ChatGPT/Codex can work through GitHub branches and pull requests.

```bash
npm test           # static validation plus the unit test suite
npm run build      # copy deployable files into dist/
npm run pin:check  # verify pinned player-library hashes (needs network)
npm run test:browser  # optional: drive the real app in a real browser
```

`npm test` runs `scripts/check.mjs` and then the Node test runner over `tests/`. It stays
offline and dependency-free, and it is what CI runs. The build copies deployable files into
`dist/`.

`npm run test:browser` is separate and optional. It launches Chromium, serves the real site,
and plays real video against a mock Invidious instance: a search, a result, a decode, an audio
track, a seek, a pause, a fullscreen request, a quality change and an instance failover. It
generates its media with `ffmpeg` and needs a Chromium binary, and it **skips** rather than
fails when either is missing. See [docs/YOUTUBE.md](docs/YOUTUBE.md).

```bash
FFMPEG_PATH=/path/to/ffmpeg npm run test:browser
```

### Runtime dependencies

The two player libraries are the only code loaded from a third party at runtime. Both are
pinned to an exact version and protected by a subresource integrity hash, so a CDN or upstream
release cannot change what the deployed site executes:

| Library | Version | Loaded for |
| --- | --- | --- |
| [dash.js](https://github.com/Dash-Industry-Forum/dash.js) | 5.2.0 | MPEG-DASH streams |
| [hls.js](https://github.com/video-dev/hls.js) | 1.6.13 | HLS streams without native support |

`npm test` fails the build if any remote script uses a mutable channel such as `/latest/` or
is missing an integrity hash. To bump a version, edit `scripts/pin-player-libs.mjs`, run
`node scripts/pin-player-libs.mjs`, and commit the regenerated `index.html`.

## Repository map

| Path | Purpose |
| --- | --- |
| `index.html` | Static app entry point |
| `assets/` | CSS, JavaScript, images, icons, and other browser assets |
| `scripts/` | Dependency-free validation, build, and dependency-pinning scripts |
| `assets/css/obsidian.css` | The Astra Obsidian design system: tokens first, then components built from them |
| `assets/js/hub.js` | Media-hub taxonomy — which content types exist and which an installed add-on actually exposes |
| `assets/js/youtube/` | The YouTube provider: Invidious configuration, instance selection, API client and playback planning |
| `deploy/invidious/` | Docker Compose for a private Invidious instance |
| `assets/js/audio-player.js` | Audio player state read from the media element |
| `tests/` | Node test-runner suite for the design system, media hub, audio state, progress storage, playback, and dependency pinning |
| `docs/YOUTUBE.md` | How YouTube playback works, and how to point it at your own instance |
| `docs/WORKFLOW.md` | Phone-first GitHub development workflow |
| `docs/AI-COLLABORATION.md` | Claude implementation and Codex review protocol |
| `docs/EVALUATION.md` | Blind Claude-vs-Codex competition rules |
| `docs/AZURE-DEPLOYMENT.md` | One-time Azure and GitHub deployment setup |
| `evals/` | Competition specifications and recorded results |
| `AGENTS.md` | Instructions for ChatGPT/Codex |
| `CLAUDE.md` | Instructions for Claude |
| `.github/workflows/` | Validation and gated Azure deployment automation |

## Design system

The interface is **Astra Obsidian**: a near-black cinematic field, bone type, cold silver
seams, and one rationed signal colour. It lives in [`assets/css/obsidian.css`](assets/css/obsidian.css),
which defines every colour, space, type size, motion duration and safe-area inset as a token
before any component uses one. Components never introduce a raw colour or a magic pixel value.

Two rules the tests enforce rather than merely document:

- **44px is a token, not a per-component guess.** Every interactive control builds its height
  on `--tap`.
- **Nothing is shown that was not measured.** Availability, catalog counts, stream facts and
  playback position all come from an add-on response or from the media element. There is no
  synthesised waveform, no invented ranking, and no content category that reads as populated
  without an installed provider behind it.

`npm test` checks the type ramp against WCAG AA, the tap-target token, focus visibility, the
reduced-motion block, and the absence of any remote or unpinned runtime dependency.

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
