# Renderer discrimination bench

Purpose: decide between the three candidate rendering architectures in the
[architecture plan](../../architecture-plan.md) using a synthetic scene shaped like the reference's
player ↔ library scene pair: album art, two labels, five transport buttons, a 400-bar waveform, the
navbar, and a 2,000-row list underneath. The transition runs on a quartic ease-out (F05).

| Mode | What it does |
| --- | --- |
| `A-dom-compositor` | Retained DOM elements; per frame only `transform`/`opacity` are written |
| `A-dom-layout` | Retained DOM; per frame `left/top/width/height` are written (worst case for `recalcChildren=dynamic`) |
| `A-canvas` | Whole scene redrawn in one device-resolution Canvas 2D each frame |
| `B-canvas` / `B-svg` | Waveform progress redraw while scrubbing: small canvas vs SVG clip |
| `C-dom` / `C-canvas` | List fling: recycled DOM row pool vs canvas-drawn rows |

Run (from the repo root after `npm ci`):

```sh
JARVIS_CHROME=/path/to/chrome node docs/claude-player/experiments/renderer-bench/run.mjs <cpuThrottle> <reps>
```

Emulation: 412×915 CSS px, DPR 2.625, mobile and touch, CDP CPU throttling. `work` is JS time inside
the frame callback (it excludes raster), so frame intervals are the deciding metric.

## Results (2026-10-21, headless Chromium 1194, 4-core VM, **no GPU**)

8× CPU throttle, 2 runs per mode:

| Mode | fps | p95 ms | p99 ms | frames >33 ms |
| --- | ---: | ---: | ---: | ---: |
| A-dom-compositor | 59.7 | 16.8 | 16.8 | 0 % |
| A-dom-layout | 59.3 | 16.7 | 16.8 | 0.5 % |
| A-canvas | **15.0** | 116.6 | 133.3 | **98.7 %** |
| B-canvas | 59.6 | 16.8 | 16.8 | 0.2 % |
| B-svg | 57.2 | 16.8 | 33.4 | 1.4 % |
| C-dom | 60.0 | 16.8 | 16.8 | 0 % |
| C-canvas | 22.7 | 50.1 | 83.4 | 69.3 % |

4× CPU throttle, 3 runs: the DOM modes held 60 fps with 0 % of frames over 33 ms. `A-canvas` reached
42.8 fps with 12.9 % over 33 ms. `B-svg` had 0.8 % and `C-canvas` 0.2 % over 33 ms.

## Interpretation and limits

- Full-scene canvas at device resolution is the only option that fails, and it fails by a wide margin.
  Software rasterisation (no GPU) exaggerates this, but on a phone it would still compete with the
  audio decode and list work for the same budget.
- Compositor-only DOM and layout-per-frame DOM are indistinguishable at this element count, so
  per-frame solver runs for `dynamic` subtrees are affordable.
- This is a synthetic desktop-VM measurement, **not physical-phone proof**. Phone profiling is part of
  the M2 gate.
