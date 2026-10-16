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

The script creates a temporary directory, `git init`, `git remote add origin https://github.com/braydenparker999/jarvis.git`, `git fetch --depth 1 origin c28c1b2f70aabb5217b08bf31ffe4c93d0353765`, `git checkout --detach FETCH_HEAD`, prints `git rev-parse HEAD` and `git status --porcelain`, and exits before tests if HEAD is not the pin or porcelain is non-empty. It then runs the media list plus `tests/initial-theme.test.mjs` with `MEDIA_APP_ROOT` set to `<temp>/public/media`, and deletes the temp directory. Output: `migrated.tap`. The command transcript is `checkout-verification.txt`.

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
| Migrated Jarvis (`migrated.tap`) | 512 | 483 | 29 |
| Default `npm test` (root copy, not the migration) | 1116 | 1116 | 0 |

`npm run build` (`node scripts/build-jarvis.mjs`) completed against a `.jarvis-source` checkout whose HEAD was the pin: 192 frontend files, 20.09 MiB. `dist/` is not part of this evidence.

26 of the original 55 pass after harness fixes. 29 still fail and are classified in `no-counterpart-mapping.md`. The 512th test is the new first-paint theme test, and it passes.

Original names: `originally-failing.txt`. Before/after: `before-after.md`.

## Files

- `baseline.tap`
- `migrated.tap`
- `checkout-verification.txt`
- `originally-failing.txt`
- `before-after.md`
- `no-counterpart-mapping.md`
- `README.md`
