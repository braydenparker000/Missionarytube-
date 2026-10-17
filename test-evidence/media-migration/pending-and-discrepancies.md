# Pending items and discrepancies

These are the todos, unsupported behaviors, and known discrepancies that must clear before the pinned Jarvis media app (`c28c1b2f70aabb5217b08bf31ffe4c93d0353765`) is qualified. A green `npm test` now reads the pinned Jarvis media checkout plus explicit test-only legacy sources; it does not clear these shipped UI gaps. A green `npm run test:media-jarvis:shipped` does not clear them either: the two todos below are reported, not passed. `npm run test:media-jarvis:qualify` reads the block below and the `test` todos on disk. It prints `QUALIFICATION: NOT READY` and exits non-zero while any pending item or todo remains, including a todo whose reason is empty. `QUALIFICATION: READY` requires the pinned checks and the source-only checks to pass, this block to be an empty list, and the todo count to be 0.

```qualification
todo	stored non-default accent and motion are applied before first paint	tests/jarvis-shipped-first-paint.suite.mjs
todo	shipped: at 390px .episode-nav-sticky backdrop-filter is none	tests/jarvis-shipped-motion.suite.mjs
```

Kept source-only names, and which shipped test covers each, are in `source-only-disposition.md`. Those 28 kept missing-`src` refusals are not additional behavioral gaps. The direct `pumpPipeline` abort is one of them: it stays a source-unit contract and is not a qualification item.

## Todos

Each of these is `test.todo` in a shipped suite. Node counts them as todo, not pass.

| Todo | File | What must become true |
| --- | --- | --- |
| stored non-default accent and motion are applied before first paint | `tests/jarvis-shipped-first-paint.suite.mjs` | With `localStorage['astra.v1.appearance']` set to violet / motion off / charcoal, the first paint uses that accent and motion. It must not paint the stylesheet default while `appearance.js` and `bootstrap.js` are still deferred. |
| shipped: at 390px .episode-nav-sticky backdrop-filter is none | `tests/jarvis-shipped-motion.suite.mjs` | At 390px, computed `backdrop-filter` on `.episode-nav-sticky` is `none`, as the `@media (max-width: 419px)` rule declares. |

## Unsupported

- **Before-first-paint theme.** `appearance.js` and `bootstrap.js` are `defer`. Holding every `.js` response leaves the stored accent and motion unapplied at first contentful paint. The guarantee is unsupported on this pin.
- **Narrow backdrop rule.** `@media (max-width: 419px)` sets `.episode-nav-sticky { backdrop-filter: none }`. A later `.episode-nav-sticky` rule of the same specificity sets `saturate(180%) blur(20px)` and wins. The `none` clause is unsupported on the shipped stylesheet. Lean refresh, opacity, document snapshots, and the lean image transition stay covered.

## Known discrepancies

### First paint does not apply the stored accent or motion

`tests/jarvis-shipped-first-paint.suite.mjs` serves the pinned Jarvis `public/` tree in its real layout and opens `/media/`, because `public/media/index.html` loads `/assets/pip-diagnostics.js` from the site root. It seeds `astra.v1.appearance` with violet / motion off / charcoal and holds every script response.

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

### 390px backdrop blur overrides `none`

At a 390px viewport, computed `.episode-nav-sticky` backdrop-filter is not `none`. `shipped mobile motion avoids offscreen GPU layers and costly document snapshots` records the winning value: `blur(20px)` with `saturate(180%)` (or `saturate(1.8)`). That assertion is the observed cascade, not a pass of the `none` clause. The todo remains the qualification check. This is the pending gap on source-only row 27.

## Reclassified: direct `pumpPipeline` abort

`tests/compatibility-player.test.mjs` (`seeking starts at a preceding keyframe and unsupported video is explicit`) still aborts a controller and expects `pumpPipeline` to reject with `AbortError`. That direct source-unit contract stays.

The public adapter in `src/compatibility-player.js` assigns that work to `run.job` and does not await it. `fail()` drops `AbortError`, so a later pump abort is not reported as a playback failure. `attach()` therefore does not reject with that internal error. The shipped bundle follows the same public adapter behavior and does not export `pumpPipeline`. Requiring `attach()` to reject that abort would compare an internal helper with a public result. It is not a product defect, it is not in the qualification block, and the todo scan does not list it.

Public cancellation and disposal stay asserted on the shipped adapter: replacing an in-flight startup, cancelling repair during its retry delay, rejecting a pending metadata fetch on cancel, disposing or destroying a prepared repair before `attach()`, and aborting an unconsumed prepared repair. Keyframe selection and the explicit unsupported-video error stay covered by `shipped: seeking starts at a preceding keyframe and unsupported video is explicit`.

The two todos in the qualification block still block `QUALIFICATION: READY`.
