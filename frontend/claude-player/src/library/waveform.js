// Seek-bar waveforms the reference's way (notebook F99). Poweramp's scanner
// (ScanDecode.native_scan) measures the audio's mean square per block, takes
// 100 bars as the RMS of equal spans of blocks (the nearest block when there
// are fewer), divides them by sqrt(max^2 + 0.01) and raises them to the power
// 1.35. Loud and quiet passages show; a quiet song stays lower than a loud one.

export const WAVE_BARS = 100;

/** Mean squares (per block or bin, full scale 1) to the reference's bars, 0..1. */
export function barsFromMeanSquares(ms, bars = WAVE_BARS) {
  const n = ms.length;
  if (!n) return null;
  const out = new Array(bars);
  for (let i = 0; i < bars; i++) {
    if (n < bars) { out[i] = Math.sqrt(ms[Math.min(n - 1, Math.trunc((i * n) / bars + 0.5))]); continue; }
    const a = Math.floor((i * n) / bars), b = Math.max(a + 1, Math.floor(((i + 1) * n) / bars));
    let s = 0;
    for (let k = a; k < b; k++) s += ms[k];
    out[i] = Math.sqrt(s / (b - a));
  }
  const max = Math.max(...out), norm = Math.sqrt(max * max + 0.01);
  return out.map(v => Math.round((v / norm) ** 1.35 * 1000) / 1000);
}

/**
 * The library's "rms" waveforms (scripts/audio/waveform.py): one byte per bin,
 * round(255 * sqrt(rms)), to mean squares.
 */
export const rmsBytesToMeanSquares = bytes => Array.from(bytes, b => (b / 255) ** 4);

/**
 * A measured song's waveform has hundreds of distinct bins; a few flat steps
 * is a cut decode (the start of the song only), due to be measured again.
 */
export const MIN_WAVE_STEPS = 100;
export function waveSteps(bytes) {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) if (i === 0 || bytes[i] !== bytes[i - 1]) n++;
  return n;
}

/**
 * Older peak waveforms (largest sample per bar, loudest 1): squared. A peak
 * only bounds loudness; squared, five sampled songs came within 0.08 of their
 * loudness bars on average (0.17 as they were).
 */
export const loudnessFromPeaks = peaks => Array.from(peaks, v => Math.round(v * v * 1000) / 1000);
