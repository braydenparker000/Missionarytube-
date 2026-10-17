# Follow-up choices and remaining work

The owner asked for another fidelity review after the first release. The chosen
changes address measured signal handling and reproducible errors:

| Idea | Evidence | Implemented result |
| --- | --- | --- |
| Keep emergency protection idle | Rounded preparation peaks left up to 0.049 dB of guard reduction on the six-file reference set at 100% | Use the higher sample/true peak plus an explicit 0.25 dB reserve; all six full files now render with zero reduction |
| Preserve extreme EQ mathematically | 32 coincident boosts requested −495 to −1132 dB; conversion stopped at −180 dB, and resonant shelf chains became silent | Normalize extreme sections individually; 18 production cases retain the declared response/phase with zero guard reduction |
| Keep transitions bounded | A shared gain could expose a fading curve to the next curve's preamp/headroom | Keep preamp/headroom in each curve branch; ordinary/extreme rapid edits satisfy the independent output ceiling |
| Correct quiet-preset gain | Recovering EQ peak from a clipped headroom estimate overstated boost with a negative preamp | Calculate the response peak directly, preserving intended preamp attenuation |
| Show the curve that plays | Tone preview used hard-coded 200/4000 Hz and Q instead of configured values | Nine plotted-curve checks match independent algebra and active coefficients |
| Expand fixed-gain evidence | Twelve of the next 100 originals exceeded the unknown +3 dBTP assumption | Review/apply one bounded metadata-only batch; 120 tracks measured, original audio identities intact |

Three additional highest-peak files pass full-length 48/96 kHz verification.
Hard transport reset during a fading curve passes with a deliberate pre-reset
tail and zero aligned post-reset output. The standard transparent null,
independent transition peak scan, streaming/recovery, regression suites and
30-minute cloud-browser checks gate release.

## Next evidence that needs the owner's device

The largest remaining uncertainty is the actual Samsung A15 output route and
native Poweramp configuration. Use the existing exact-file, matched-output-level
USB comparison first, then matched headphone EQ; document Android effects and
both applications' gain ledgers. Bluetooth negotiation, background playback,
route handoff, listening results and battery remain unverified here.

A high-rate/custom decoder rewrite has no demonstrated benefit in these
measurements. It would add streaming, seek, container-gain and trimming risks.
The browser's preferred rate and original encoded bytes remain the chosen path.
WASM/SIMD work should start only if device callback timing demonstrates an
underrun problem; desktop timing cannot make that decision. Wider catalog
analysis can use further separately reviewed bounded batches without schedules
or audio rewriting. Complete-album normalization needs trustworthy complete
membership and one common peak before it can be enabled as album evidence.
