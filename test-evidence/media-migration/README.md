# Media migration harness evidence

This directory records the Jarvis-targeted media suite. It does not change the root media copy or any deploy workflow.

## Which suite exercises which tree

| Command | What it runs |
| --- | --- |
| `npm test` | `node scripts/check.mjs && node --test`. `MEDIA_APP_ROOT` is unset, so media tests read the repo-root copy. A green result is not the migration passing. `scripts/test-jarvis-media.mjs` matches Node's `test-*.mjs` discovery; under that runner it exits 0 without selecting a suite. |
| `npm run test:media-jarvis:source` | Fresh clone of the pinned commit, then the retained source-unit files. Missing `src/` paths still fail instead of reading the root copy. |
| `npm run test:media-jarvis:shipped` | Fresh clone of the same pin, then the shipped-bundle suites only: compatibility, motion, and the first-paint characterization. |

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

The earlier combined command `node scripts/test-jarvis-media.mjs` wrote `migrated.tap`. It now requires `source` or `shipped`. Both modes still create a temporary directory, `git init`, `git remote add origin https://github.com/braydenparker999/jarvis.git`, `git fetch --depth 1 origin c28c1b2f70aabb5217b08bf31ffe4c93d0353765`, `git checkout --detach FETCH_HEAD`, print `git rev-parse HEAD` and `git status --porcelain`, and exit before tests if HEAD is not the pin or porcelain is non-empty. `source` runs the retained source-unit list. `shipped` runs the three shipped suites. Each deletes its temp directory. Transcripts: `source-unit.txt`, `shipped.txt`.

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

| Run | Tests | Pass | Fail | Skip | Todo |
| --- | --- | --- | --- | --- | --- |
| Baseline Jarvis (`baseline.tap`) | 511 | 456 | 55 | 0 | 0 |
| `npm run test:media-jarvis:source` (`source-unit.txt`) | 512 | 483 | 29 | 0 | 0 |
| `npm run test:media-jarvis:shipped` (`shipped.txt`) | 34 | 31 | 0 | 0 | 3 |
| Default `npm test` (root copy, not the migration) | 1117 | 1117 | 0 | 0 | 0 |

The 29 source-unit failures still throw `Refusing to fall back to the repo-root copy`. They are not in the shipped command, so a missing `src/` path does not hide a shipped assertion. The shipped command's 3 todos are the unsupported clauses below. `npm run build` completed against `.jarvis-source` at the pin: 192 frontend files, 20.09 MiB (`npm-build.txt`). Root suite transcript: `npm-test.txt`. `dist/` is not part of this evidence.

26 of the original 55 pass after the earlier harness fixes. The same 29 source-unit names still fail on the Jarvis run. Their shipped-bundle status is in `no-counterpart-mapping.md`.

## This migration is incomplete

The shipped command passes its runnable assertions. The source-unit command still fails the same 29 names. These clauses stay explicit todos, so the root media copy cannot be treated as retired:

- Before-first-paint theme guarantee. `tests/jarvis-shipped-first-paint.suite.mjs` serves the pinned `public/media` bundle, seeds `localStorage['astra.v1.appearance']` with violet / motion off / charcoal, and holds every `.js` response. At first contentful paint the stored values are present and unapplied: `--accent` is the default `#b4d1ff`, `.brand-orbit` is `rgb(180, 209, 255)`, and `.page.active` is still `page-arrival`. After the responses are released, `appearance.js` sets violet / off / charcoal, `--accent` becomes `#cbbaff`, and the page animation becomes `none`. Evidence: `first-paint/computed-style.json`, `first-paint/held.png`, `first-paint/released.png`. The guarantee itself is `test.todo`, not a pass. `tests/initial-theme.test.mjs` remains the parser/VM characterization in the source command.
- Aborted `pumpPipeline` `AbortError` is not passed back through `attach()`. `createAdapter` detaches that mux job, and the bundle does not export `pumpPipeline`. Todo in `tests/jarvis-shipped-compatibility.suite.mjs`. The keyframe and explicit unsupported-video clauses stay covered.
- At 390px, `.episode-nav-sticky` `backdrop-filter: none` inside `@media (max-width: 419px)` loses to a later rule of the same specificity, `saturate(180%) blur(20px)`. The mobile motion test records that computed blur. The `none` clause is a todo.

`velocity >= 720` now has a shipped behavioral test. A slow 110px touch drag on an 800px-tall surface snaps back. The same distance, released immediately after the jump, dismisses. 110px is under the inlined distance threshold (`min(132, max(72, size * 0.24))`, which is 132 at that height).

## Commands recorded in this pass

Clean pin, empty porcelain, each Jarvis command clones its own temporary checkout:

```
npm run test:media-jarvis:source
npm run test:media-jarvis:shipped
```

Root suite and build, `MEDIA_APP_ROOT` unset, `.jarvis-source` checked out at the same pin:

```
npm test
npm run build
```

`*.suite.mjs` files are not part of `node --test` discovery. The source command exits 1 because of the 29 missing-`src` failures. The shipped command exits 0.

## Files

- `baseline.tap`
- `migrated.tap`
- `checkout-verification.txt`
- `source-unit.txt`
- `shipped.txt`
- `npm-test.txt`
- `npm-build.txt`
- `first-paint/computed-style.json`
- `first-paint/held.png`
- `first-paint/released.png`
- `originally-failing.txt`
- `before-after.md`
- `no-counterpart-mapping.md`
- `README.md`
