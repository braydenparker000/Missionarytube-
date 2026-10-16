# Media migration harness evidence

This directory records the Jarvis-targeted media suite. It does not change the root media copy or any deploy workflow.

## Which suite exercises which tree

| Command | What it runs |
| --- | --- |
| `npm test` | `node scripts/check.mjs && node --test`. `MEDIA_APP_ROOT` is unset, so media tests read the repo-root copy. A green result is not the migration passing. |
| `npm run test:media-jarvis` | `node scripts/test-jarvis-media.mjs`. Fresh clone of the `jarvis-release.json` commit. Sets `MEDIA_APP_ROOT` to that clone's `public/media`. This is the suite that exercises Jarvis sources and bundles. |

Jarvis-targeted reads throw if `MEDIA_APP_ROOT` is the repo root, and they throw `ERR_MEDIA_ROOT_FALLBACK` if a file is missing, instead of opening the root copy.

## Pinned Jarvis

- Repository: `braydenparker999/jarvis`
- Commit: `c28c1b2f70aabb5217b08bf31ffe4c93d0353765`
- `public/media` tree: `c4d89e4aab446f6f79b17b7df911ec3c3f59e4d7`
- Motion bundle blob (both trees): `01cb4830d63b1e63b270eeaf2d6752946edc8242`
- `assets/css/obsidian.css` blob (both trees): `294f9e8189a9eee554ca3ded5e402724f8beefca`

## Commands

Baseline, before the harness edits in this commit, dependencies installed, same pin checked out at `/tmp/jarvis-pinned` (`git status --porcelain` empty, re-checked in this session):

```
MEDIA_APP_ROOT=/tmp/jarvis-pinned/public/media node --test --test-reporter=tap \
  tests/app-wiring.test.mjs tests/appearance.test.mjs tests/audio-player.test.mjs \
  tests/catalog-registry.test.mjs tests/collection-tools.test.mjs \
  tests/compatibility-player.test.mjs tests/dependency-pinning.test.mjs \
  tests/discovery-health.test.mjs tests/federated-search.test.mjs \
  tests/interaction-motion.test.mjs tests/library-continuity.test.mjs \
  tests/media-hub.test.mjs tests/playback-adapters.test.mjs \
  tests/playback-delivery.test.mjs tests/playback-diagnostics.test.mjs \
  tests/playback-engine.test.mjs tests/playback-episodes.test.mjs \
  tests/playback-request-policy.test.mjs tests/playback-settings.test.mjs \
  tests/playback-streams.test.mjs tests/playback-subtitles.test.mjs \
  tests/playback-video-health.test.mjs tests/player-recovery.test.mjs \
  tests/progress-store.test.mjs tests/redesign.test.mjs tests/route-runtime.test.mjs \
  tests/search-intent.test.mjs tests/software-player.test.mjs tests/source-view.test.mjs \
  tests/youtube-api.test.mjs tests/youtube-instances.test.mjs tests/youtube-piped.test.mjs \
  tests/youtube-playback.test.mjs tests/youtube-wiring.test.mjs
```

That file list is the runner at `eac77ab` (no `tests/initial-theme.test.mjs`). Output: `baseline.tap`.

Migrated, after the harness edits:

```
node scripts/test-jarvis-media.mjs
```

The script creates a temporary directory, `git init`, `git remote add origin https://github.com/braydenparker999/jarvis.git`, `git fetch --depth 1 origin c28c1b2f70aabb5217b08bf31ffe4c93d0353765`, `git checkout --detach FETCH_HEAD`, prints `git rev-parse HEAD` and `git status --porcelain`, and exits before tests if HEAD is not the pin or porcelain is non-empty. It then runs the media list, `tests/initial-theme.test.mjs`, `tests/jarvis-shipped-compatibility.suite.mjs`, and `tests/jarvis-shipped-motion.suite.mjs` with `MEDIA_APP_ROOT` set to `<temp>/public/media`, and deletes the temp directory. Output: `migrated.tap`. The command transcript is `checkout-verification.txt`.

## Clean checkout verification

The migrated run did not reuse `.jarvis-source` or `/tmp/jarvis-pinned`. From `checkout-verification.txt`, against `/tmp/jarvis-pinned-JEX5Nf` (removed when the script finished):

```
$ git -C /tmp/jarvis-pinned-JEX5Nf rev-parse HEAD
c28c1b2f70aabb5217b08bf31ffe4c93d0353765
$ git -C /tmp/jarvis-pinned-JEX5Nf status --porcelain
<empty>
clean checkout verified: git status --porcelain empty at c28c1b2f70aabb5217b08bf31ffe4c93d0353765
Jarvis media source c28c1b2f70aabb5217b08bf31ffe4c93d0353765 public/media c4d89e4aab446f6f79b17b7df911ec3c3f59e4d7
```

HEAD equality was not the only check. Porcelain was printed and had to be empty.

## Totals

| Run | Tests | Pass | Fail |
| --- | --- | --- | --- |
| Baseline Jarvis (`baseline.tap`) | 511 | 456 | 55 |
| Harness-only Jarvis, previous `migrated.tap` | 512 | 483 | 29 |
| Shipped-bundle Jarvis (`migrated.tap`, this pass) | 541 | 512 | 29 |
| Default `npm test` (root copy, not the migration) | 1117 | 1117 | 0 |

The Jarvis gain from 512 to 541 is the 22 shipped compatibility tests plus the 7 shipped motion tests. The 29 failures are the original source-unit names. They still throw `Refusing to fall back to the repo-root copy` and were not loosened. `npm test` gained `tests/shell-assets.test.mjs` (1116 to 1117).

`npm run build` (`node scripts/build-jarvis.mjs`) completed against a `.jarvis-source` checkout whose HEAD was the pin: 192 frontend files, 20.09 MiB. Transcript: `npm-build.txt`. Root suite transcript: `npm-test.txt`. `dist/` is not part of this evidence.

26 of the original 55 pass after the earlier harness fixes. The same 29 source-unit names still fail on the Jarvis run. Their shipped-bundle status is in `no-counterpart-mapping.md`.

## This migration is incomplete

Shipped-bundle coverage has not fully passed. `tests/jarvis-shipped-compatibility.suite.mjs` and `tests/jarvis-shipped-motion.suite.mjs` pass against the pin, and the 29 source-unit tests still fail on purpose. These clauses are still unsupported or pending, so the root media copy cannot be treated as retired:

- The original before-first-paint guarantee is unresolved. `tests/initial-theme.test.mjs` is a characterization of a parser/VM loading-mode model. A pass on the deferred Jarvis shell explicitly leaves the saved accent and motion preference unapplied. It is not a throttled browser paint test. A future browser test would have to hold script responses and inspect computed styles or screenshots. That test was not written in this pass.
- `seeking starts at a preceding keyframe and unsupported video is explicit` is covered for the keyframe and the explicit unsupported-video error. The original also rejects `pumpPipeline` when its signal is already aborted. `createAdapter` detaches that mux job and does not surface the internal `AbortError`. That clause is unsupported-documented.
- Gesture distance, tap slop, and in-range progress are covered in Chrome. The `velocity >= 720` dismiss branch did not get a stable gesture. For that branch only: artifact identity verified; deployed behavioral coverage pending.
- Narrow-viewport `backdrop-filter: none` is declared inside `@media (max-width: 419px)`, and a later `.episode-nav-sticky` rule of the same specificity sets `saturate(180%) blur(20px)` and wins. The computed style at 390px is not `none`. That clause is unsupported-documented. The rest of the mobile-motion case is covered.

## Shipped-bundle commands

Clean pin, empty porcelain, this pass:

```
npm run test:media-jarvis
```

Root suite and build, `MEDIA_APP_ROOT` unset, `.jarvis-source` checked out at the same pin:

```
npm test
npm run build
```

`npm test` was recorded before the last gesture-drag wait in `tests/jarvis-shipped-motion.suite.mjs`. That file is a `*.suite.mjs` and is not part of `node --test` discovery, so the root transcript still matches the root suite. The gesture change is in `migrated.tap`.

## Files

- `baseline.tap`
- `migrated.tap`
- `checkout-verification.txt`
- `npm-test.txt`
- `npm-build.txt`
- `originally-failing.txt`
- `before-after.md`
- `no-counterpart-mapping.md`
- `README.md`
