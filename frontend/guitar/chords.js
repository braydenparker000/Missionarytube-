// Chord and tuning names from MIDI pitches. Pure functions: the engine worker
// bundles this file and the page uses it for labels, so both always agree.
const SHARP = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const noteName = midi => SHARP[((midi % 12) + 12) % 12];
export const noteWithOctave = midi => noteName(midi) + (Math.floor(midi / 12) - 1);

// Most specific first; when two shapes fit the same notes, the earlier wins.
const SHAPES = [
  ['', [0, 4, 7]], ['m', [0, 3, 7]], ['7', [0, 4, 7, 10]], ['maj7', [0, 4, 7, 11]], ['m7', [0, 3, 7, 10]],
  ['sus4', [0, 5, 7]], ['sus2', [0, 2, 7]], ['add9', [0, 2, 4, 7]], ['madd9', [0, 2, 3, 7]], ['6', [0, 4, 7, 9]],
  ['m6', [0, 3, 7, 9]], ['7sus4', [0, 5, 7, 10]], ['9', [0, 2, 4, 7, 10]], ['m9', [0, 2, 3, 7, 10]], ['maj9', [0, 2, 4, 7, 11]],
  ['dim', [0, 3, 6]], ['m7♭5', [0, 3, 6, 10]], ['dim7', [0, 3, 6, 9]], ['aug', [0, 4, 8]], ['5', [0, 7]]
];
const fifthless = intervals => intervals.length > 3 && intervals.includes(7) ? intervals.filter(i => i !== 7) : null;

// Names the chord made by these pitches, or '' when no common shape fits all
// of them. The lowest note picks the root when it can, else becomes a slash.
export function chordName(midis) {
  const notes = [...new Set(midis.filter(Number.isFinite))].sort((a, b) => a - b);
  if (notes.length < 2) return '';
  const classes = [...new Set(notes.map(n => ((n % 12) + 12) % 12))];
  if (classes.length < 2 || (classes.length === 2 && !classes.includes((classes[0] + 7) % 12) && !classes.includes((classes[1] + 7) % 12))) return '';
  const bass = ((notes[0] % 12) + 12) % 12;
  let best = null;
  for (const root of [bass, ...classes.filter(c => c !== bass)]) {
    const set = classes.map(c => (c - root + 12) % 12).sort((a, b) => a - b).join();
    SHAPES.forEach(([suffix, intervals], rank) => {
      for (const shape of [intervals, fifthless(intervals)]) {
        if (!shape || shape.join() !== set) continue;
        const score = rank + (root === bass ? 0 : 40) + (shape === intervals ? 0 : 10);
        if (!best || score < best.score) best = {score, name: noteName(root) + suffix, root};
      }
    });
  }
  if (!best) return '';
  return best.root === bass ? best.name : best.name + '/' + noteName(bass);
}

const TUNINGS = [
  ['Standard', [40, 45, 50, 55, 59, 64]], ['Drop D', [38, 45, 50, 55, 59, 64]], ['E♭ standard', [39, 44, 49, 54, 58, 63]],
  ['Drop C♯', [37, 44, 49, 54, 58, 63]], ['D standard', [38, 43, 48, 53, 57, 62]], ['Drop C', [36, 43, 48, 53, 57, 62]],
  ['Open G', [38, 43, 50, 55, 59, 62]], ['Open D', [38, 45, 50, 54, 57, 62]], ['DADGAD', [38, 45, 50, 55, 57, 62]],
  ['Open E', [40, 47, 52, 56, 59, 64]], ['Standard 7', [35, 40, 45, 50, 55, 59, 64]], ['Bass standard', [28, 33, 38, 43]],
  ['Bass 5', [23, 28, 33, 38, 43]]
];
// tuning: MIDI pitches from the lowest string to the highest.
export function tuningName(tuning) {
  if (!Array.isArray(tuning) || !tuning.length) return '';
  const found = TUNINGS.find(([, notes]) => notes.join() === tuning.join());
  return found ? found[0] : tuning.map(noteName).join(' ');
}

// Fret window for a chord diagram: frets lists one fret per string from the
// lowest string, -1 for strings that do not sound.
export function diagramWindow(frets, span = 4) {
  const fretted = frets.filter(f => f > 0);
  if (!fretted.length) return {first: 1, span};
  const low = Math.min(...fretted), high = Math.max(...fretted);
  const first = high <= span ? 1 : low;
  return {first, span: Math.max(span, high - first + 1)};
}
