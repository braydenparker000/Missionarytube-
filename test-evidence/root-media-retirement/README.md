# Root media retirement evidence

Base: `1179c4fe40a84a6ddb3fd1dcd37950e6239f12d4` (current main verified before publication).
Jarvis pin: `c28c1b2f70aabb5217b08bf31ffe4c93d0353765` from unchanged `jarvis-release.json`.
Date: 2026-10-17 UTC. Node v24.19.0; npm 11.9.0.
The PR head identifies the final patch; these checks ran on its code before adding this evidence.

## Boundary and review

`boundary.txt` enumerates the exact 43-file app boundary: 36 removed, four licenses
retained, three unchanged test-only src modules retained with all 29 contracts.
Five obsolete tooling files and only their three package commands were retired.
The browser harness callers were its package command and its internal imports;
legacy build/pinning commands had no active callers. Historical documentation,
workflow globs and DEPLOY_PATHS/GATE_RECIPE mentions are intentionally retained.

Media readers and validation now require public/media in a checkout whose HEAD
matches the release pin. Missing and wrong-pin checkout tests fail closed.
Source-unit imports explicitly select only the three legacy modules when no
MEDIA_APP_ROOT override is supplied. Pinned-source runs still expose absent src
modules rather than falling back. No source assertions were removed.
Scoreboard validation remains unchanged. Current affected documentation was updated.

Reviewed unchanged: dependencies, package-lock, source pin, workflow files,
DEPLOY_PATHS/GATE_RECIPE, fixtures, licenses, retained src modules,
scripts/build-jarvis.mjs and scripts/r2-player-config.mjs.
No runtime changes, held playback work, credentials, permissions, consolidation,
merge or deployment are included. Historical first-paint evidence was restored
following the qualification runs rather than overwritten by new screenshots.

## Results and measured command times

| Check | Result | Time |
| --- | --- | --- |
| HTML/assets/remote dependencies/scoreboard | pass: 27 required files, 5 HTML checks, 2 pinned remote dependencies | included in npm test |
| Initial affected root/dependency tests | 10 pass | 1.698 s |
| Final root routing tests including absent and wrong pin | 4 pass | 0.161 s |
| source-only | 29 pass, 0 skipped | 6.204 s |
| npm test (one final broad run) | 1,126 pass, 0 failures/skips/TODOs | 15.900 s |
| Baseline npm run build | pass | 0.753 s |
| Final npm run build | pass | 0.301 s |
| qualify with installed Chromium 151 | nonzero; 1 shipped assertion failure and 2 TODOs | 25.435 s |
| qualify with verified pinned Chrome 154.0.8037.97 | nonzero; same 1 failure and 2 TODOs | 25.719 s |
| Untouched base, isolated mobile-motion assertion, pinned Chrome | identical failure | 0.874 s |

Both sorted SHA256 manifests include every final dist file (194 files) and are
byte-identical. Each manifest's SHA256 is
`b2ab23bac1a1824f605f680d94c2807e4e40e59480a749d591f6ee4558b5e0d5`.
Both builds used the same clean pinned .jarvis-source checkout. The build's own
192-file count precedes generation of the preview and release metadata files.
This establishes unchanged output, not runtime qualification.

## Qualification limitations

The final qualification run passed all 483 pinned checks and all 29 source-only
checks. Shipped checks: 31 pass, 1 fail, 2 TODOs. The two documented TODOs remain:

- Stored non-default accent/motion before first paint.
- At 390px, episode navigation backdrop-filter should be none.

Additional existing failure in this environment: `shipped mobile motion avoids
offscreen GPU layers and costly document snapshots`, at line 254, expects the
`motion-lean` class but observes false. The identical failure reproduces on
untouched base main with the same clean pin and verified Chrome 154, as recorded
in `baseline-motion.txt`. Its underlying cause is not established here; this
patch does not fix, skip, weaken, or relabel it as a TODO. Thus qualification
prints `NOT READY` and exits 1 for tests failed, pending items, and TODOs.
This is a verified cleanup draft, not release readiness or live playback evidence.

Full transcripts (trailing whitespace normalized) and before/after manifests are alongside this record.
