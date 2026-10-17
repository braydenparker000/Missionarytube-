# Compact shared-player snapshot: independent visual review

October 5, 2026. Source reviewed: snapshot candidate `fdf7a2d` and theme-test
correction `89c6c09` plus the live-pseudo/important-variable correction
`772fdd05` and the CSSOM activation repair `76330a5`, based on `bcb843d`. This review introduces only tests,
a dependency-free screenshot reader, and this report. No publication, merge,
deployment, old production-player copy, or production debug export.

## Existing pixels inspected

I opened both existing V5 evidence screenshots before writing visual assertions:
`preview-mini-motion-60.png` and the trusted interrupted-library regrab image.
They show the actual generated cover art, title/subtitle chips, native controls,
waveform region, full-player backdrop, compact mini surface, and adjacent library
pages. They are earlier failure captures at 393 × 852, not acceptance evidence
for the compact candidate or the owner's 519 × 988 viewport.

## Source review findings

No source-level appearance or geometry regression identified in the reviewed
change. This is conditional on the required real-renderer gates below.

- The change is confined to property discovery/serialization before the existing
  clone path. Shared surface/cover/label/control endpoint reads, lerps, inverse
  backdrop/full-control masks, exact corners, suppression, inertness, capture,
  settlement duration, and canonical cleanup retain their previous owners
- Rules are discovered from real CSSOM per scene. Nested/imported/adopted rules
  are traversed; current computed values, not raw declarations, freeze appearance
- Authored shorthands are expanded using the browser's property inventory and
  CSSStyleDeclaration. The plan carries ancestor property names conservatively,
  so fonts, colors, and variable-resolved longhands are retained without an
  unverified hand-maintained list
- The scene-local Map holds the usage plan and frozen appearances. A new scene,
  including a separately refreshed play-icon clone, gets a fresh plan. No
  persistent style cache or speculative theme/art invalidation was introduced
- Standard resolved longhands retain native raster-mask/image values while the
  compact path omits duplicate custom-variable data URL strings. The follow-up
  conservatively retains variables consumed by live pseudo or important rules,
  including absent-variable fallback behavior; normal native-mask longhands
  remain frozen without duplicating every inherited custom-variable payload
- Unreadable CSS rules and unknown selectors conservatively return to exhaustive
  computed-property serialization. The old enumeration path remains available
  within the same asset; no second old player is required for comparison
- The baseline fixture changes only one real stylesheet's cssRules getter after
  boot. CSS remains enabled; computed style/rendering is unchanged. The getter
  throws inside snapshotPlan's guarded traversal, selecting exactly the prior
  all-computed-property serialization. The test records introspection reads and
  asserts the sheet remains enabled
- Existing canvas copies and late artwork/progress/play/background refresh paths
  are retained. The new test uses actual generated peaks and decoded artwork,
  then reads actual canvas dimensions and frozen geometry. The test uses only
  public PA objects, rendered scene DOM, and existing DOM clone maps; it does
  not reference the private IIFE scene controller

Computed-property parity is owned by `poweramp-snapshot-browser.test.js`; this
suite independently checks the actual owned scene's raster and geometry after
trusted navigation rather than constructing parallel detached clones.

## Mandatory owner-viewport raster gate

Run together with the candidate production change:

```sh
POWERAMP_EVIDENCE_DIR=/path/to/evidence \
  node --test tests/poweramp-snapshot-visual-browser.test.js
```

The required test boots the actual app and generated isolated fixture in Chromium,
using 519 × 988 CSS pixels and DPR 2.0818214416503906. It runs dark and light
UI themes with normal production animation timing. All external network is
blocked. Audio is paused at 42 seconds, generated known peaks pass through the
real waveform renderer, and no audio is fetched or played. The actual
Waveform.accept({duration, peaks}) method converts/stamps/paints pixels; these
generated remote R2 tracks have no waveformVersion, so the scheduled
Waveform.run returns before file/audio fetching.

For each theme it captures five exhaustive-baseline/compact pairs:

1. Trusted held mini expansion at .25
2. Trusted held mini expansion at .5
3. Trusted held mini expansion at .75
4. Trusted release, real transient-plane regrab, and held .5 after displacement
   from captured painted progress
5. Delayed generated artwork resolving during a real held .5 gesture, including
   decoded mini/full art, placeholder removal, completed background crossfade,
   and unchanged geometry

Each pair produces `snapshot-visual-{theme}-{case}-baseline.png`, its compact PNG,
and JSON through POWERAMP_EVIDENCE_DIR. Reported evidence includes both scene
geometries, endpoint lerps, opacity/corner/mask states, native bitmap dimensions,
trusted input trace, sheet/fallback observations, clone count, CSS payload, and
whole-viewport/per-part pixel comparisons. Geometry and pixel reports are bounded;
no unbounded pixel arrays or private live contents are emitted.

Limits are explicit: .05 CSS-pixel paired geometry tolerance; per-channel raster
threshold 2/255; changed pixels at most .05% of the viewport and .3% in each
cover/label/control/backdrop region; mean viewport channel delta at most .05.
Exact changed-pixel counts and maximum deltas are reported even below threshold.
The scene must also prove its compact CSS payload is less than 70% of baseline.
Failures retain all five pairs of PNG/JSON comparison evidence per theme before
reporting any failed acceptance gates. Limits are never relaxed when a pair fails.

The small PNG reader supports Chromium's non-interlaced 8-bit RGB/RGBA output
with all five PNG row filters. It uses built-in zlib only, rejects unsupported
formats and dimensions above 16 million pixels, and separately unit-tests
filter reconstruction, bounded regional reporting, identical pixels, malformed
input, mismatched dimensions, and unsupported formats.

## Checks actually completed

- Browser-test and PNG-reader JavaScript syntax checks passed
- All 387 non-browser Poweramp tests in this worktree passed against both the
  initial candidate and the final `772fdd05` production player, including the
  three new PNG checks
- Both existing real V5 PNGs decode as 393 × 852 and self-compare with exactly
  zero changed pixels
- The mandatory renderer suite has **not run locally**. Chromium was intentionally
  not relaunched after the previously verified local socket EPERM restriction
- Candidate screenshots still need remote CI execution, materialization, and
  direct pixel inspection before any visual-parity acceptance claim

This evidence does not establish phone FPS, touch latency, audio quality,
performance improvement, or owner acceptance. End-to-end measured setup timings
remain the separate downloaded-preview operation gate.

## Early V6 real-browser evidence (run 37250691128)

Both dark/light first .25 PNG pairs were opened and inspected directly after
materialization. They show the actual held shared-player morph: generated cover,
label/play crossfade, seeded waveform, full-control inverse reveal, library rows,
background, and dock. They are not endpoints or an empty/hidden clone.

The native raster is 1080 × 2057 for the requested 519 × 988/DPR
2.0818214416503906 context. Both pairs are encoded-byte identical and independently
recompute to zero exact/thresholded changed pixels. All twelve paired geometry
deltas are zero, progress is exactly .25, and recomputed endpoint lerp error is
below the unchanged .05 CSS-pixel limit. Both real sheets stay enabled, input is
trusted, and playback stays paused at 42 seconds.

This run does **not** establish compact-active parity. CSS payloads are identical
for the two modes: 1,028,899 characters (dark) and 1,034,983 (light), with 148 clone
nodes. Both variants selected the exhaustive fallback. The unchanged <70% CSS
reduction assertion correctly rejected this misleadingly pixel-perfect outcome.
The next gate must prove compact snapshots are active before visual acceptance.

Activation repair `76330a5` was subsequently reviewed: indexed traversal removes
CSSOM iterable assumptions, and readable selectors rejected by Element.matches
conservatively contribute their authored keys for the current scene. Actual
unreadable cssRules still selects exhaustive serialization, so the screenshot
baseline remains intact. No scene geometry/appearance ownership change was
introduced. The independent 387 non-browser Poweramp checks passed again against
this activation repair. Active-compact renderer/raster acceptance is pending the
next real-browser run.
