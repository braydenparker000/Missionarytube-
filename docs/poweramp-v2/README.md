# Poweramp V2 — independent working foundation

V2 is a new static web player in `frontend/poweramp-v2/`. It implements a real player → library → mini-player journey, actual audio, centered waveform seeking, local-file playback, queue navigation, repeat/shuffle, search and basic album/artist grouping. This is a development preview, not a completed Poweramp recreation or an approved production release.

The supplied build 1031 APK informed the reference evidence. No V1 player implementation was used as a design/code foundation. No extracted APK code, icons, fonts, artwork or binaries are in this project. The visible demo artwork and three short sound studies are original generated material.

## Run

From the repository root:

```sh
npm ci
npm run dev:poweramp-v2
# Open http://127.0.0.1:8765/poweramp-v2/
```

Open Menu → Open audio files to play selected device files. They remain local to the browser session. The demo catalog is prepared in memory; no music payload is bundled or uploaded. Reload restores demo selection, position and modes, always paused. Local files must be reselected after reload.

## Verify

```sh
# Use existing Chrome through JARVIS_CHROME, or install the pinned Playwright shell:
node node_modules/playwright-core/cli.js install chromium --only-shell
npm run test:poweramp-v2
npm run build
V2_ROOT=dist/poweramp-v2 node --test tests/poweramp-v2-*.test.mjs
node --test tests/source-layout.test.mjs scripts/frontend-source.test.mjs tests/privacy.test.mjs
```

The browser suite prefers `JARVIS_CHROME`, `CHROME_PATH`, or an installed system Chrome, then the Playwright headless shell. It fails if no usable browser exists. Root `npm test` discovers `tests/poweramp-v2-*.test.mjs`; no V1 tests were ported. Full existing CI qualification still applies before any merge or publication.

Evidence defaults to ignored `.browser-check/poweramp-v2/`. Set `V2_EVIDENCE_DIR` to another directory if needed. Captures in [evidence](evidence/) are synthetic V2 output, not images of the original app.

## Read next

- [STATUS.md](STATUS.md): exact checkpoint, verified scope and continuation.
- [REFERENCE.md](REFERENCE.md) and [evidence.jsonl](evidence.jsonl): APK identity, resource/bytecode findings and confidence.
- [DECISIONS.md](DECISIONS.md): competing architectures, selected approach and measured limits.
- [INTERACTIONS.md](INTERACTIONS.md): implemented state and gesture contracts.
- [SOURCE-CONTRACT.md](SOURCE-CONTRACT.md): newly inspected backend contracts and publication baseline.
- [GAPS.md](GAPS.md): prioritized fidelity, functionality and phone checks.

## Delivery boundary

The existing copy build includes the separate `/poweramp-v2/` route. There is no launcher link or change to `/drawercast/`. Runtime files use `.js`, matching the current Azure publisher's JavaScript MIME mapping. CSP is declared in the document; runtime dependencies are local. Other modules, backend behavior, deployment workflows, credentials, provider data and V1 remain unchanged.

No merge, deployment or production replacement is authorized by this checkpoint. The remote adapter is contract-tested but deliberately not connected to the preview UI/CSP. Existing API CORS permits the Azure origin only; localhost is not an authorized remote-source browser test.
