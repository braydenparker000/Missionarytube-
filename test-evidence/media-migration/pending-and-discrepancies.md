# Pending items and discrepancies

These are the todos, unsupported behaviors, and known discrepancies that must clear before the pinned Jarvis media app (`c28c1b2f70aabb5217b08bf31ffe4c93d0353765`) is qualified. A green `npm test` runs the repo-root copy and does not clear them. A green `npm run test:media-jarvis:shipped` does not clear them either: the three todos below are reported, not passed.

Kept source-only names, and which shipped test covers each, are in `source-only-disposition.md`. Those 27 missing-`src` refusals are not additional behavioral gaps.

## Todos

Each of these is `test.todo` in a shipped suite. Node counts them as todo, not pass.

| Todo | File | What must become true |
| --- | --- | --- |
| stored non-default accent and motion are applied before first paint | `tests/jarvis-shipped-first-paint.suite.mjs` | With `localStorage['astra.v1.appearance']` set to violet / motion off / charcoal, the first paint uses that accent and motion. It must not paint the stylesheet default while `appearance.js` and `bootstrap.js` are still deferred. |
| shipped: an already-aborted pumpPipeline job passes AbortError through attach() | `tests/jarvis-shipped-compatibility.suite.mjs` | An already-aborted mux job surfaces `AbortError` from `attach()`, matching `pumpPipeline` in `tests/compatibility-player.test.mjs`. |
| shipped: at 390px .episode-nav-sticky backdrop-filter is none | `tests/jarvis-shipped-motion.suite.mjs` | At 390px, computed `backdrop-filter` on `.episode-nav-sticky` is `none`, as the `@media (max-width: 419px)` rule declares. |

## Unsupported

- **Before-first-paint theme.** `appearance.js` and `bootstrap.js` are `defer`. Holding every `.js` response leaves the stored accent and motion unapplied at first contentful paint. The guarantee is unsupported on this pin.
- **Aborted `pumpPipeline`.** `createAdapter` detaches the mux job and does not reject `attach()` with that internal `AbortError`. The shipped bundle does not export `pumpPipeline`, so the source-unit call cannot be made against the public adapter. Keyframe selection and the explicit unsupported-video error stay covered by `shipped: seeking starts at a preceding keyframe and unsupported video is explicit`. The abort clause does not.
- **Narrow backdrop rule.** `@media (max-width: 419px)` sets `.episode-nav-sticky { backdrop-filter: none }`. A later `.episode-nav-sticky` rule of the same specificity sets `saturate(180%) blur(20px)` and wins. The `none` clause is unsupported on the shipped stylesheet. Lean refresh, opacity, document snapshots, and the lean image transition stay covered.

## Known discrepancies

### First paint does not apply the stored accent or motion

`tests/jarvis-shipped-first-paint.suite.mjs` serves the pinned `public/media` bundle, seeds `astra.v1.appearance` with violet / motion off / charcoal, and holds every script response.

At first contentful paint the stored values are present and unapplied:

- `--accent` is the default `#b4d1ff`
- `.brand-orbit` is `rgb(180, 209, 255)`
- `.page.active` is still `page-arrival`
- `dataset.accent` and `dataset.motion` are unset
- `AstraAppearance` is not defined

After the script responses are released, `appearance.js` applies violet / off / charcoal, `--accent` becomes `#cbbaff`, and the page animation becomes `none`.

Evidence:

- `test-evidence/media-migration/first-paint/computed-style.json` (`beforeFirstPaintGuarantee` is false)
- `test-evidence/media-migration/first-paint/held.png`
- `test-evidence/media-migration/first-paint/released.png`

`characterization: held scripts leave the stored accent and motion unapplied at first paint` passes by recording that limitation. The pass is not the guarantee.

`tests/initial-theme.test.mjs` (`characterization: loading mode leaves a deferred stored accent and motion preference unapplied`) is the same discrepancy in a parser/VM model. On this pin `appearance.js` and `bootstrap.js` are deferred, the test requires `dataset.accent` and `dataset.motion` to stay unset, and that result passes. It does not hold script responses and it does not read computed style. It must not be treated as clearing the todo.

### `pumpPipeline` `AbortError` is not surfaced

The source test aborts a controller and expects `pumpPipeline` to reject with `AbortError`. On the shipped adapter, `createAdapter` starts that work as a detached job. `attach()` does not reject with the internal `AbortError`. There is no public `pumpPipeline` export to call instead. This remains the pending gap on source-only row 4.

### 390px backdrop blur overrides `none`

At a 390px viewport, computed `.episode-nav-sticky` backdrop-filter is not `none`. `shipped mobile motion avoids offscreen GPU layers and costly document snapshots` records the winning value: `blur(20px)` with `saturate(180%)` (or `saturate(1.8)`). That assertion is the observed cascade, not a pass of the `none` clause. The todo remains the qualification check. This is the pending gap on source-only row 27.
