// Time helpers for the engine's playback timeline. Ticks are alphaTab MIDI
// ticks (960 per quarter); seconds are song seconds at 100% speed.
export const FLAG = { dead: 1, palmMute: 2, letRing: 4, ghost: 8, accent: 16, harmonic: 32, legato: 64, vibrato: 128, slide: 256, staccato: 512 };

export function tempoMap(tempos, ppq = 960) {
  const segments = [];
  let sec = 0;
  for (let i = 0; i < tempos.length; i++) {
    const [tick, bpm] = tempos[i];
    if (i) sec += (tick - segments[i - 1].tick) * segments[i - 1].spt;
    segments.push({ tick, sec, bpm, spt: 60 / (Math.max(10, bpm) * ppq) });
  }
  if (!segments.length) segments.push({ tick: 0, sec: 0, bpm: 120, spt: 60 / (120 * ppq) });
  const find = (key, value) => {
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (segments[mid][key] <= value) lo = mid; else hi = mid - 1; }
    return segments[lo];
  };
  return {
    secAt: tick => { const s = find('tick', tick); return s.sec + (tick - s.tick) * s.spt; },
    tickAt: sec => { const s = find('sec', sec); return s.tick + (sec - s.sec) / s.spt; },
    bpmAt: tick => find('tick', tick).bpm
  };
}

// Index of the last item whose key is <= value (0 when none).
export function lastAtOrBefore(items, value, key = 'start') {
  let lo = 0, hi = items.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (items[mid][key] <= value) lo = mid; else hi = mid - 1; }
  return lo;
}
// Index of the first item whose key is >= value (items.length when none).
export function firstAtOrAfter(items, value, key) {
  let lo = 0, hi = items.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (items[mid][key] < value) lo = mid + 1; else hi = mid; }
  return lo;
}

// Metronome clicks for the bars in playback order. Compound meters (6/8,
// 9/8, 12/8) click on the dotted quarter, like a player counts them.
export function clicks(bars, ppq = 960) {
  const out = [];
  for (const bar of bars) {
    const compound = bar.den === 8 && bar.num % 3 === 0 && bar.num > 3;
    const step = compound ? ppq * 1.5 : ppq * 4 / bar.den;
    for (let t = bar.start, i = 0; t < bar.end - 1; t += step, i++) out.push({ t, accent: i === 0 });
  }
  return out;
}
export const beatsInBar = bar => bar.den === 8 && bar.num % 3 === 0 && bar.num > 3 ? bar.num / 3 : bar.num;

// The occurrence of a written bar (master bar) to jump to: the next one at or
// after the current playback bar, else the first.
export function occurrence(bars, mb, fromSeq = 0) {
  let first = -1;
  for (let i = 0; i < bars.length; i++) if (bars[i].mb === mb) { if (first < 0) first = i; if (i >= fromSeq) return i; }
  return first;
}

const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
// FluidR3 per-note sample names (A0..C8, flats).
export const sampleName = midi => NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
export const SAMPLE_RANGE = [21, 108];

export function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
