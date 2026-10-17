Concrete review findings and fixes during this task:
- Limiter preceded volume, so turning down playback retained gain modulation.
- Sample ceiling did not bound reconstructed peaks; Genesis output was +0.2 dBTP.
- First 48-tap detector passed a short oracle but failed the stronger 8193-tap
  32x reference near Nyquist. The acceptance threshold was retained.
- Default browser compressor fallback needed a different label and extra headroom.
- Opus container gain must not be applied again after Chromium decoding.
- Missing album evidence must not silently receive per-track gain.
- Source catalog count changed during work, requiring conditional metadata writes.
- Complete album claims require exact snapshot membership and invalidate on additions.

- Natural entry/return through the explicit queue also needed to preserve delayed output at an automatic boundary. Manual changes still reset stale samples.
- Chromium 151 stopped the deliberately failed callback without delivering processorerror. Event listeners plus a bounded heartbeat watchdog now recover; the actual exception fixture passed.

- A playback-state-only transition check missed a preexisting muted spare media element. Before Web Audio, transport cancellation set element volume to zero; the new graph used slot gains but retained that zero element volume. Resetting successfully routed elements to unity restored measured PCM. Regression and actual output-RMS checks passed. The silent-slot endurance attempt is excluded; the final run requires real output and advancing clocks.
