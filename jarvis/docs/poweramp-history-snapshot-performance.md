# Mini-player release: library history snapshot work

October 5, 2026. This is a narrowly scoped follow-up to the V4 silent preview.

## Evidence and limits

The selected A15 report records three list-to-player releases with 53, 61 and
72 ms between the captured `pointerup` event and the observed settling owner.
The corresponding player-to-list releases take 0–5 ms. All three opening
contacts were already in gesture phase `drag`. The old report prioritizes the
gesture owner over the shared scene, so it cannot tell us exactly when the
shared scene was constructed, how long history capture took, or where a large
RAF callback gap occurred. The whole opening delay is **not** attributed to
history capture by this patch.

Code inspection establishes a specific synchronous release path:

1. The mini gesture commits through `ScreenDrag.end` and `ScreenDrag.activate`
2. The outer `Nav.go` wrapper calls `LibraryPageHistory.save` while the list is
   still the current page
3. `save` deep-clones that page through `LibraryPageMotion.capture`, walks all
   mounted descendants, reads their scroll values, processes attributes and
   rewrites IDs/references before shared-player settling starts

Closing from the player does not take that capture path because library
history is inactive. Capturing the outgoing list also runs for tap opening,
before the cold shared scene is built.

The actual production shared-scene harness combined with the actual history
wrapper confirms one outgoing-list capture on the old drag release and old
tap path, versus zero with this change. These are deterministic call counts,
not phone timing, raster, layer-memory or FPS measurements.

## Change

Library-to-player navigation saves the category spec, ancestry and primary
scroll position synchronously, then marks its visual snapshot pending. The
canonical page remains in the DOM throughout the player detour. Returning to
the same category needs no capture.

An actual horizontal gesture already calls `save` before mounting its outgoing
picture, so it gets a fresh picture and scroll position. A subsequent category
change, direct list render or history branch captures the retained page before
its DOM is replaced. Deferred capture uses the saved primary scroll position:
hidden source elements have no CSSOM scrolling box and can otherwise report
zero. Snapshots remain inert, source-mapped and bounded by the existing
32-visit ring.

The production virtual window already returns before measuring its range or
mounting rows when its screen is hidden. ResizeObserver refreshes therefore
retain the distant mounted rows and spacers. A focused test exercises that
early return. Deferred capture also checks the current category and ancestry
against the saved visit; a mismatched or removed source keeps the last valid
snapshot instead of replacing it with unrelated DOM.

There is no background or idle callback for this capture. Cancellation,
repeated detours and eviction cannot leave an asynchronous job holding an old
visit or compete with the active player morph. Release duration, approved
appearance, player clones, masks and compositor hints are unchanged.

## Validation

- 113 focused non-browser checks passed across library history, shared
  elements, morph review and library review
- The eight deferral regressions and the valid-picture fallback regression
  fail against the previous production runtime; the hidden virtual-window
  early return is existing behavior and is checked on both runtimes
- Real production drag and tap integration checks count zero history captures
  on opening; cleanup and same-page return also count zero
- Later horizontal capture preserves a newly changed scroll position; a new
  category from player preserves the old title and hidden primary scroll
  before replacement
- JavaScript syntax and `git diff --check` passed

Phone acceptance and a real renderer trace remain necessary. The next bounded
preview report should time scene creation, history capture, layout fitting and
paint separately, retain large RAF-gap timestamps and expose the actual scene
phase independently of the mini gesture owner.
