# Media qualification status

The pinned Jarvis media source is qualified for the two previously pending
shipped UI criteria after the focused browser checks pass. The qualification
gate still requires the pinned checks, source-only checks, an empty list below,
and zero runtime TODOs.

```qualification
```

Kept source-only names and their shipped-test coverage are in
`source-only-disposition.md`. The direct `pumpPipeline` abort remains a
source-unit contract and is not a shipped UI qualification item.

## Resolved shipped criteria

### Stored appearance before first paint

`appearance.js` is now a parser-blocking, same-origin head script before the
stylesheets. The browser regression stores violet / motion off / charcoal,
holds the other JavaScript responses, and asserts the first-contentful-paint
snapshot already has those values, the violet accent colors, and no page
arrival animation. It also records the initializer resource timing and checks
that first contentful paint follows its response completion.

This trades deferred loading for one 1,540-byte same-origin script request that
must finish before HTML parsing can proceed to the stylesheets. The recorded
local run took 54.5 ms from request start to response end and transferred
1,840 bytes including headers; first contentful paint was at 244 ms. The JSON
receipt records the request and paint timing. This local measurement does not
estimate mobile production latency; the real user cost includes the request's
network round trip plus script execution.

The earlier held-all-scripts screenshots, JSON report, and qualification logs
remain historical evidence of the old deferred behavior. The updated browser
run records the passing pre-paint state.

### 390px episode navigation backdrop

The narrow-screen rule now comes after the shared `.episode-nav-sticky` rule
and explicitly sets both `backdrop-filter` and `-webkit-backdrop-filter` to
`none`. The shipped motion test reads computed style after the complete
stylesheet cascade at a 390px viewport and requires `none`; its unrelated lean
motion, image transition, and no-snapshot checks remain in place.

## Reclassified: direct `pumpPipeline` abort

`tests/compatibility-player.test.mjs` (`seeking starts at a preceding keyframe
and unsupported video is explicit`) still aborts a controller and expects
`pumpPipeline` to reject with `AbortError`. That direct source-unit contract
stays. The public adapter in `src/compatibility-player.js` assigns that work to
`run.job` and does not await it. `fail()` drops `AbortError`, so a later pump
abort is not reported as a playback failure. `attach()` therefore does not
reject with that internal error. The shipped bundle follows the same public
adapter behavior and does not export `pumpPipeline`. Requiring `attach()` to
reject that abort would compare an internal helper with a public result.

Public cancellation and disposal remain asserted on the shipped adapter:
replacing an in-flight startup, cancelling repair during its retry delay,
rejecting a pending metadata fetch on cancel, disposing or destroying a
prepared repair before `attach()`, and aborting an unconsumed prepared repair.
Keyframe selection and the explicit unsupported-video error remain covered by
`shipped: seeking starts at a preceding keyframe and unsupported video is
explicit`.
