# Shared mini/full player render cost

The first sections record the V3 implementation. The October 4 follow-up below supersedes its clip/compositor and tap-settle behavior; device performance remains unmeasured.

October 4, 2026. This patch preserves the approved mini/full geometry, appearance, gesture thresholds, reduced-motion behavior and 80–220 ms release timing. It does not change audio, queue semantics, the library history or deploy a release.

## Reproduced work

The production `SharedPlayerMotion.paint` previously refreshed every backdrop and seek descendant's computed style, copied all visible full-player canvases and rewrote fixed endpoint boxes on every display frame. Reads were interleaved with style writes. Geometry-only frames therefore performed work unrelated to a changed image, progress value or layout endpoint.

The deterministic DOM fixture instruments production computed-style and rectangle reads, style/attribute writes, clone construction and canvas copies. The same eight geometry checkpoints, including reversal, give these counts:

| Work across eight geometry-only frames | Base `5fad02b` | Patched |
| --- | ---: | ---: |
| Computed-style reads | 24 | 0 |
| Rectangle reads | 0 | 0 |
| Style writes | 1,408 | 232 |
| Layout-affecting style writes | 896 | 0 |
| Repeated accessibility attribute writes | 32 | 0 |
| Unchanged canvas copies | 8 | 0 |
| New DOM clones | 0 | 0 |

The fixture is deliberately small. These are operation counts, not elapsed time, forced-layout trace measurements, FPS, dropped frames or Galaxy A15 results. The base is expected to fail the new zero-work assertions when used for comparison.

With identical fixture setup, scene construction falls from 138 to 116 computed-style reads, 600 to 401 style writes and three to one canvas copies. The DOM clone count remains 29. Shared appearance is frozen once; invisible duplicate descendants skip computed snapshots, while their roots retain frozen dimensions so full-player controls keep their flow positions.

## Changes

- Capture endpoint boxes once. Move art, labels, play controls, seeks and the solid shell through transforms, rather than rewriting their fixed layout dimensions each frame
- Inverse-scale shell horizontal/vertical corner radii so non-uniform expansion retains the existing circular painted radii and exact endpoint rectangles
- Copy only changed inline seek values; take an appearance refresh for theme/class changes or a cleared inline value
- Notify the shared scene after an actual `UI.drawViz` paint, including direct waveform, seek, theme and layout calls. A held scene gets fresh pixels with no permanent polling RAF
- Clear cloned canvas pixels and synchronize bitmap dimensions before each fresh copy, preserving transparency and preventing stale bars or resize clipping
- Refresh backdrop appearance on art/palette mutations. Sample only live native backdrop animations while their computed values continue changing, even when the inline target/class remains unchanged. Sample the exact final value and cancel the short-lived RAF on cleanup
- Avoid repeated writes to original opacity, transforms, inertness and tab stops; reassert ownership if navigation changes them

## Regression checks

`tests/poweramp-shared-elements.test.js` runs the actual production branch against canonical DOM bounds and verifies checkpoints 0, .25, .5, .75 and 1, opening/closing symmetry, interruption/regrab/reversal, third-screen retargeting, captured pointer ownership, cleanup, resize/blur, reduced motion, late artwork/placeholder changes and dynamic progress/play icons.

New checks cover zero static per-frame reads/layout writes, delta-only seek refresh, unchanged canvas reuse, direct canvas notifications, transparent canvas replacement/resize, exact shell radii, unchanged settle timing, shared-root layout and a native backdrop artwork crossfade that continues during both a held scene and settling with no new style/class mutation.

Run focused checks:

```sh
node --test tests/poweramp-shared-elements.test.js tests/poweramp-morph-review.test.js tests/poweramp-library-review.test.js
node --check public/drawercast/player.js
git diff --check
```

The wider non-browser suite passed after the final patch. Browser suites were not rerun: Chromium socket creation is blocked with EPERM in this environment, and the cloud browser cannot open the local HTTP fixture. No workaround was attempted. Physical A15 testing remains required before publishing this preview.

## V3 remaining performance limits

The foreground still needs two rounded clip paths and changing corner radii. The global backdrop and transient foreground backdrop retain their existing filtered artwork layers to preserve the approved dim/reveal appearance. Stable filter values are no longer rewritten each frame, but the actual raster/compositor cost, layer memory and possible clipping-related paints cannot be established by this fixture.

A15 preview acceptance should compare the same artwork/settings and test both cold and warm opening, closing, held .25/.5/.75 checkpoints, reverse/regrab and a late artwork/background load. If rendering still drops frames, capture an actual browser performance trace before changing release timing or simplifying the approved appearance.

Browser guidance: [Chrome/web.dev animation performance guidance](https://web.dev/articles/animations-guide) and [Element.getAnimations, including CSS transitions](https://developer.mozilla.org/en-US/docs/Web/API/Element/getAnimations).


## October 4 follow-up: V3 still laggy on A15

The user reported that the V3 downloaded silent HTML still felt extremely slow when expanding the mini-player. No A15 frame report or renderer trace was supplied. The earlier geometry-only fixture missed three real code paths:

1. `clone` freezes every computed property inline, including `will-change:auto`. That inline property outranked the scene stylesheet's `will-change:transform,opacity` on labels, play/seek parts and the backdrop. The intended transient layer hints were therefore absent. This is a verified cascade defect; the amount of resulting phone raster work is unknown.
2. Every geometry frame rewrote two large rounded `clip-path` insets. The new code gives each full-only/background clone a separate rounded overflow mask. Its transform follows the exact expanding shell; an inverse transform keeps its child at the original viewport origin and scale. Separate mask z-indices retain the backdrop/art/full-only/shared-part stack. Inverse-scaled radii retain all four circular shell corners, including nonzero app/backdrop origins. This removes geometry-frame clip-path writes without moving the background or introducing a static duplicate player.
3. `UI.startLoop` only skipped visualization while a pointer contact existed. Tap expansion settling has no contact, so it kept drawing the waveform/visualization and then copying its canvas into the transient player. `Nav.go` and `DockLayout.schedule` also refitted the already synchronously fitted endpoint and drew a canvas on the first animation frame. These periodic draws and redundant fits now defer only while a shared-player morph owns the display. Progress and audio continue. Direct waveform/seek/theme/art updates remain supported. Cleanup schedules one coalesced canonical dock fit/draw; cancel, blur, resize and retarget paths retire the pause too.

The changed compositor hints are explicit inline styles applied after cloning, including replacement play/pause clones and artwork appearances. They exist only on transient scene nodes, which are removed on cleanup. The full background filters, artwork, fonts, endpoints, thresholds and 80–220 ms easing/timing remain unchanged.

### Measured deterministic work, V3 (`8f5eee9`) versus this follow-up

| Fixture work | V3 | Follow-up |
| --- | ---: | ---: |
| Computed-style reads across eight unchanged geometry frames | 0 | 0 |
| Rectangle reads / layout-affecting writes / canvas copies in those frames | 0 / 0 / 0 | 0 / 0 / 0 |
| Large rounded clip-path writes in those frames | 16 | 0 |
| Total geometry style writes in those frames | 232 | 264 |
| Setup computed-style reads / cloned nodes / canvas copies | 116 / 29 / 1 | 116 / 29 / 1 |
| Setup style writes / layout-affecting writes | 401 / 160 | 449 / 184 |
| Tap first-frame endpoint fits, including initial capture | 3 | 1 |
| Tap first-frame dock measures / visualization draws | 1 / 1 | 0 / 0 |
| First 150 ms contact-free tap: fits / periodic visualization draws | 2 / 3 | 1 / 0 |
| First 150 ms contact-free tap: progress updates | 3 | 3 |

Two small mask wrappers add setup and transform writes. This deliberately trades more cheap transform/clip-mask state for removing repeated large clip-path changes and competing layout/canvas work. The fixture counts operations, not their elapsed time. Neither total writes nor `will-change` alone proves a browser layer was created or avoids every raster. The masks still change rounded corner radii; actual compositor/paint behavior and GPU memory need a trace. [Chrome's rasterization guidance](https://developer.chrome.com/blog/re-rastering-composite) explains why transform hints can avoid repeated scale rasterization, but is not evidence of current A15 performance.

The new regressions fail against V3 for the blocked inline hint, 16 clip-path writes, duplicate fit/draw, and periodic contact-free visualization paths. They check mask/content transform composition at 0, .001, .25, .5, .75, .999 and 1 (plus reversal), exact corner radii, nonzero viewport origins, dynamic play/pause promotion, tap settling without contacts, deferred cleanup, cancellation/third-screen retargeting, live progress, and held/direct artwork/canvas updates. The existing mandatory Chromium scene test also now checks actual mask and child `getBoundingClientRect` results and effective CSS hints at held checkpoints.

### Validation and limits

- 172 focused non-browser checks passed, including shared elements, morph review, render loop, gestures, scene lifecycle and library review
- All 656 non-browser tests passed; JavaScript syntax and `git diff --check` passed
- The standalone silent preview builder parsed the runtime and reported zero external assets/module imports with isolated memory storage, denied network and simulated audio only
- Browser suites were not run in this worktree because Chromium/CUA runtime access is already blocked in this environment. The new browser assertions are authored but unverified. No alternate route was attempted to bypass that denial
- No dominant Galaxy A15 bottleneck has been measured. Cold synchronous CSS snapshot/clone construction, initial filtered-background raster/upload, promoted layer memory, text sampling/antialiasing during scale and changing rounded masks remain possible costs. Exact geometric tests are not screenshot, paint-trace or physical-device acceptance

The next phone report should separate cold scene setup, drag frames and settling frames; include create/paint, fit/draw call times and frame-interval percentiles. Compare the same artwork/settings in cold and warm runs, pause at .25/.5/.75, regrab/reverse, and change artwork while held. Only a measured drag-versus-settle result can justify shortening release duration; this follow-up leaves it alone.
