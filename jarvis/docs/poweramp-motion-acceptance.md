# Persistent player motion acceptance

The rejected v7 clone implementation remains the canonical appearance baseline
for the settled Library/Mini and full Player. Screenshot gates are unchanged:
channel tolerance 2, changed fraction at most 0.0005, and mean channel delta at
most 0.05. Shared geometry remains within 0.05 CSS pixels in the paired serial
test. Real production artwork, fonts, palette, settings, IDs and listeners own
the canonical endpoints.

V7 intermediate pictures are retained as comparison evidence, not as the new
motion oracle. Its double shared labels/play icons and translucent stationary
controls were artifacts of two painted copies. The replacement checks one real
shared artwork/title/subtitle/play/seek owner and no painted full duplicate.
Full-only controls have an explicit separate fade. Held and regrabbed frames
must preserve the actually painted geometry, current content, and cleanup.
Screenshots are inspected for duplicate ghosts, clipping and jumps.

Absolute synchronous setup must remain at most 33 ms at 4x CPU throttling.
Measure first, repeated and playing opens and closes; additionally force the
small known-widget appearance model unavailable so the fallback is measured
honestly. Include the scene caller, not only its shared-motion callee. No deep
DOM cloning, full computed-style enumeration or CSSOM inventory reads are
allowed on these input paths. These are browser operation measurements, not
phone FPS or touch-to-display latency.

The generated 5,000-track trusted-input Library and All Songs visibility test
is mandatory. Ordinary, repeated, under-threshold, canceled, reversed and
regrabbed round trips must restore the canonical computed root, visible rows,
mini player and navigation. No active mask, contact plane or history overlay
may survive the settled endpoint.

Clone/cache/canvas-copy unit contracts remain explicitly on
SnapshotReferenceMotion where useful. They preserve independent baseline
utility coverage and do not qualify the persistent production path. Runtime
unit and real-browser probes instead use persistent node identity, geometry,
live writers, ownership and cleanup invariants. Event-target probes recognize
real descendants of a widget, while retaining the actual native event target.

No phone preview is qualified from focused results alone. Applicable aggregate
regressions and the revised absolute/visual/visibility gates must pass for the
same source and draft head. Phone acceptance remains the release gate.

## Reviewed motion-only compositing rounding

On 2026-10-05, engineering review inspected the paired v8/transient-dim
pictures at progress 0.25, 0.5 and 0.75. Promoting the existing solid dim only
while the shared mask is active prevents the static filtered tone/gradient
picture from being rastered on every frame. It changes intermediate 8-bit
compositing rounding in the exposed background, not authored colours or
geometry. The original failed global-mean receipts are retained; this is an
explicit engineering-review exception, not user acceptance or a general
threshold relaxation.

The motion-only serial gate now requires every pixel channel delta at most 2,
unchanged geometry within 0.05 CSS pixels, and shared-player-surface mean delta
at most 0.05. Exposed-background mean RGBA delta is bounded at 0.22 on the
0–255 channel scale (observed 0.108595, 0.149234 and 0.209593); its maximum
channel delta remains 2. The old changed-fraction guard remains present, and
reports retain whether the original global-mean 0.05 gate would pass. Canonical
settled endpoint gates above remain unchanged. Active-mask cleanup restores
the original dim ownership on ordinary, canceled and interrupted round trips.

The evidence is browser-only. Native RasterTask work and interval unions are
reported separately, with renderer PID filtering and no nested-event double
counting. Neither these values nor callback gaps qualify Android FPS, input
latency, or phone acceptance.
