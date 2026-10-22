# Poweramp V2 checkpoint — 2026-10-20

## Exact source

- Repository: `braydenparker000/Missionarytube-`.
- Branch: `feat/poweramp-v2-foundation-20261020`.
- Base: `4fd9547d37d5845fbafb3f0edad53b6150a8cedd`.
- Working implementation commit on GitHub: **`ff204c42093eed9c14fb8bf1814caef745348c47`**.
- Local verification commit: `588fb13007b48eb86c1fa150655e0dfec28df3d5`. Both commits have the exact Git tree `9787efa942130abc821fa507648012f45fe8e700`. The connected GitHub API saved the source because shell Git credentials were unavailable; blob and complete tree identities were verified.
- Subsequent documentation/evidence commit(s) preserve this implementation and its captures; use `git log -3 --oneline` to see branch HEAD.
- New route source: `frontend/poweramp-v2/`. Test ownership: `tests/poweramp-v2-*.test.mjs` with a distinct ownership prefix.

## State of delivery

| State | Result |
|---|---|
| Implemented | First player/library/mini-player/audio vertical slice, plus basic grouping/search/local import |
| APK analyzed | Hash matched; Apktool3.0.3 decode; focused JADX1.5.6 and smali cross-checks;23 evidence claims |
| Locally tested |48 V2 checks passed, including actual built-artifact browser execution;18 privacy/provenance/test-discovery checks passed |
| Source committed |Implementation commit above, isolated feature branch; findings/captures committed separately |
| PR opened |[Draft PR #285](https://github.com/braydenparker000/Missionarytube-/pull/285); no merge authorized |
| Full required CI |Not established by local tests; inspect the PR's exact revision checks before merge |
| Original/A15 comparison |Not performed; original runtime/settings capture unavailable |
| Remote personal playback |Not activated; adapter has synthetic contract checks only |
| Merged/deployed |No; owner approval remains required for both |

## What works

- Resource-guided black player scene: over-art title/artist, separate sub-art actions, centered real-peak waveform, overlaid playback, four navbar positions.
- One shared artwork node across full/mini states; interruptible/reversible scene progress; scene ownership and reduced motion.
- Independent mini playback/seek/expand targets; cross-target multi-touch cancellation and no row click-through.
- Real generated audio and session-local file playback, play/pause/seek, previous/next, natural progression, repeat, shuffle history and Media Session action handling.
- Songs, basic album/artist grouping, search, title sort and queue membership listing; virtualized96px rows.
- New versioned preference namespace; demo reload remains paused; denied/corrupt storage does not break boot.
- Newly authored R2 read adapter with strict schema, bounded body, safe errors and cancellation, isolated from the preview's UI and CSP.

## Verification performed

```sh
npm run build
V2_ROOT=dist/poweramp-v2 node --test tests/poweramp-v2-*.test.mjs
node --test tests/source-layout.test.mjs scripts/frontend-source.test.mjs tests/privacy.test.mjs
git diff --check
```

V2:48 pass,0 fail,0 skipped. Host checks:18 pass,0 fail. The source suite also passed before the final artifact run. Local runtime: Node24.19.0, Playwright-core1.56.1, Chromium headless shell141.0.7390.37. The normal build produced both frontend and backend artifacts.

The first PR CI run,39477697163, passed all V2 cases and all component/Worker lanes. The root suite passed1,142 of1,143 checks; its sole failure rejected nested test filenames, even though the wrapper executed them. V2 tests were moved to the repository's required top-level naming scheme with their own `poweramp-v2-` prefix; the wrapper was removed. No test-discovery guard was relaxed. All48 V2 cases and18 host checks passed again after the move. Inspect the draft PR's exact revision checks for the subsequent full CI result.

Actual decoded18s audio had a nonzero monitored sample peak≈0.266. Browser checks exercised touch drags/reversal/cancel, a second finger on another control, waveform mapping/cancel, mini seeking, long-press Stop, track change during seek, autoplay/error races, reload, storage denial, real local-file import, keyboard focus, empty catalog and5,000 rows. Viewports320×568,360×780,430×932 and780×360 were captured. Full Android font-scaling and background/locked-screen tests remain open.

The original-app runtime was not available. Resource assertions and V2 screenshots do not prove an exact native visual match. The five controlled motion-progress captures establish V2 rendering endpoints/intermediate geometry; they are not a recording of native timing.

Build/runtime bytes, local measurements and retained captures are in [evidence](evidence/). The complete frontend is≈20.60MiB under25MiB, with no packaged media or proprietary APK contents. V2 runtime source is69,825bytes uncompressed.

Resolved setup issues: a generic Playwright CDN URL returned an invalid archive; its supported official fallback installed the headless shell. The repository-qualified Chrome154 archive verified, but full Chrome launch required a Unix socket disallowed here. An initial privacy check also traversed that ignored local browser installation; moving the tool outside the repository restored the existing privacy gate without changing it. Local browser evidence remains explicitly141, not154.

The final documentation scan caught two framework documentation hosts outside the repository's existing allowlist. The references now point to those projects' equivalent official documentation sources on GitHub. No privacy rule or test was relaxed.

## Safe continuation

```sh
git fetch origin
git switch feat/poweramp-v2-foundation-20261020
npm ci
npm run dev:poweramp-v2
npm run test:poweramp-v2
```

Read [GAPS.md](GAPS.md) first for the next bounded milestone. Highest value: obtain the two owner screenshots/short gesture recording, calibrate the actual built-in variant, then implement remote-source selection under the existing authorized Azure-origin contract and CSP. A later approved origin preview is needed to establish real remote playback; do not change CORS or deploy implicitly.

Source code was written independently; no V1 implementation or tests were imported. V1, other frontend modules, backend behavior, provider data, credentials and deployment workflows remain unchanged. No APK/decompiled corpus/native binaries or personal media are in Git/build/evidence.
