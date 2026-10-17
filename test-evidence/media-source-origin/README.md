# Media test source-origin cutover

Base: `38a3a9744b162626eddc63d3a2f41ec1ec97c288`, the ancestry-preserving
merge of PR216. Date: 2026-10-17 UTC. Node v24.19.0; npm 11.9.0;
verified Chrome for Testing 154.0.8037.97.

Only the fetch origin in `scripts/test-jarvis-media.mjs` changes, from
`https://github.com/braydenparker999/jarvis.git` to
`https://github.com/braydenparker000/Missionarytube-.git`.
The original source provenance in `jarvis-release.json` remains unchanged.
No branch tip or imported working-tree snapshot replaces the release pin.

## Exact identities

- Source commit: `c28c1b2f70aabb5217b08bf31ffe4c93d0353765`.
- Full source tree: `900f1e53227b84976619bbfdb2a3f17170f30429`.
- Media tree: `c4d89e4aab446f6f79b17b7df911ec3c3f59e4d7`.
- The runner's actual fetch reported `From https://github.com/braydenparker000/Missionarytube-`.
- Its checkout verification reported the exact pin and empty `git status --porcelain`.
- Its media-tree readback reported the exact tree above.

The pin is reachable through the imported original source ancestry now on
Missionarytube- main. Both GitHub's destination commit API and the local Git
object identify the same full source tree. The runner retains its exact-SHA,
clean-checkout, missing-file and no-root-fallback guards unchanged.

## Checks

| Command | Result | Elapsed |
| --- | --- | --- |
| `node --test tests/media-qualification.test.mjs` | 7 pass; qualification refusal/TODO semantics retained | 0.100s |
| `npm run test:media-jarvis:qualify` | 483 pinned + 29 source-only pass; shipped 31 pass, 1 fail, 2 TODOs; exit 1 | 24.954s |
| `npm test` | 1,127 pass; no failures/skips/TODOs | 15.855s |
| `npm run build` | pass; same clean pinned checkout | 0.320s |

Qualification correctly remains `NOT READY`: stored accent/motion before first
paint and the 390px episode-navigation backdrop-filter are still TODOs. The
existing shipped mobile-motion assertion expects `motion-lean` but sees false.
That same failure was previously reproduced on untouched main with the same
pin and verified Chrome154, documented in PR215's baseline-motion evidence.
No assertion, TODO, suite selection, verdict, or release identity was changed.

Every one of the 194 dist files matches the prior import build manifest at
`../jarvis-source-import/after.sha256`; its sorted-manifest SHA256 is
`b2ab23bac1a1824f605f680d94c2807e4e40e59480a749d591f6ee4558b5e0d5`.
The generated historical first-paint evidence was restored after testing.

## Scope and remaining work

This changes one test-source consumer, not runtime deployment inputs.
Root workflows, dependencies/lockfiles, imported source, test assertions,
source pins, Worker settings, schedules, credentials, publication endpoints,
and build scripts are unchanged. PR215 remains unmerged. The remaining
component cutover checklist is `../../docs/jarvis-source-import.md`.

PR216 post-merge Validate run `38994686700` and the qualification-only Azure
workflow run `38994686731` succeeded. All production deployment jobs were
skipped; no workflow dispatch or live deployment was performed by this task.
The independently triggered live-music verification is reported separately;
it is not evidence of this test-runner origin change.
