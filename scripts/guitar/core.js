// Guitar engine core: loads Songsterr revisions or Guitar Pro files with
// alphaTab and produces three things for the page:
//   reader   - dark, tab-only SVG systems sized for the screen, with bar and
//              beat positions so the page can draw the cursor itself;
//   timeline - every sounding note in playback order (repeats expanded) with
//              string, fret, pitch, duration and technique, plus tempo map,
//              bars and chord changes, for the Web Audio player;
//   print    - the unchanged A4 notation + tab systems that pdf.js lays out.
import * as alphaTab from '@coderline/alphatab';
import { SongsterrToAlphaTabConverter } from './vendor/songsterr-to-alphatab.converter';
import { chordName } from '../../frontend/guitar/chords.js';
import { FLAG } from '../../frontend/guitar/timeline.js';

const M = alphaTab.model;
alphaTab.Logger.logLevel = alphaTab.LogLevel.Error;
export const PPQ = 960;
export const PRINT_WIDTH = 840;

// Turn SMuFL music glyphs into vector paths so no music font is needed where
// the SVG ends up (an <img>, or a PDF).
export function outlineMusic(svg, font, baseSize, defaultFill = '#000000') {
  return svg.replace(/<g transform="([^"]+)" class="at"\s*><text([^>]*)>(.*?)<\/text><\/g>/g, (_, transform, attrs, entities) => {
    const chars = entities.replace(/&#(\d+);/g, (_m, code) => String.fromCodePoint(Number(code)));
    const percent = Number(attrs.match(/font-size:\s*([\d.]+)%/)?.[1] || 100);
    const size = baseSize * percent / 100;
    const x = attrs.includes('text-anchor="middle"') ? -font.getAdvanceWidth(chars, size) / 2 : 0;
    const path = font.getPath(chars, x, 0, size).toPathData(3);
    const fill = attrs.match(/fill="([^"]+)"/)?.[1] || defaultFill;
    return `<g transform="${transform}"><path d="${path}" fill="${fill}"/></g>`;
  });
}

export function loadScore(source) {
  if (source?.kind === 'songsterr') {
    const { score, warnings } = new SongsterrToAlphaTabConverter().buildScore(source.data);
    return { score, warnings };
  }
  if (source?.kind === 'gp') {
    const score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(source.bytes), new alphaTab.Settings());
    return { score, warnings: [] };
  }
  throw Error('Unknown source');
}

export function trackKind(track) {
  const staff = track.staves[0];
  if (!staff || staff.isPercussion) return 'drums';
  const program = track.playbackInfo.program;
  if (program >= 32 && program <= 39) return 'bass';
  if (!staff.tuning.length) return 'other';
  if (program >= 24 && program <= 31) return 'guitar';
  return staff.tuning.length >= 6 ? 'guitar' : staff.tuning.length === 4 || staff.tuning.length === 5 ? 'bass' : 'other';
}

export function scoreInfo(score, warnings = []) {
  if (!score.tracks.length || !score.masterBars.length) throw Error('Empty score');
  return {
    title: score.title || '', artist: score.artist || '', album: score.album || '',
    tempo: score.tempo || 120, bars: score.masterBars.length, warnings: warnings.length,
    tracks: score.tracks.map(t => {
      const staff = t.staves[0];
      return { index: t.index, name: t.name || 'Track ' + (t.index + 1), kind: trackKind(t), program: t.playbackInfo.program,
        strings: staff?.tuning.length || 0, tuning: staff ? [...staff.tuning].reverse() : [], capo: staff?.capo || 0, notes: noteCount(staff) };
    })
  };
}

function noteCount(staff) {
  let n = 0;
  for (const bar of staff?.bars || []) for (const voice of bar.voices) for (const beat of voice.beats) n += beat.notes.length;
  return n;
}

const color = (r, g, b, a = 1) => new M.Color(r, g, b, Math.round(a * 255));
const HIDDEN_HEADER = ['ScoreTitle', 'ScoreSubTitle', 'ScoreArtist', 'ScoreAlbum', 'ScoreWords', 'ScoreMusic', 'ScoreWordsAndMusic', 'ScoreTranscriber', 'ScoreCopyright'];
function hide(settings, names) {
  for (const name of names) {
    const key = alphaTab.NotationElement[name];
    if (key !== undefined) settings.notation.elements.set(key, false);
  }
}
function render(settings, score, tracks, width) {
  const renderer = new alphaTab.rendering.ScoreRenderer(settings);
  renderer.width = width;
  const partials = []; let failure;
  renderer.error.on(e => { failure = e; });
  renderer.partialRenderFinished.on(e => {
    if (typeof e.renderResult === 'string' && e.firstMasterBarIndex >= 0) partials.push({ svg: e.renderResult, x: e.x, y: e.y, width: e.width, height: e.height,
      first: e.firstMasterBarIndex, last: e.lastMasterBarIndex });
  });
  try {
    renderer.renderScore(score, tracks);
    if (failure) throw failure;
    // Layout errors must fail visibly, never silently omit a system or a measure.
    const covered = new Set();
    for (const p of partials) for (let i = p.first; i <= p.last; i++) covered.add(i);
    if (!partials.length || covered.size !== score.masterBars.length) throw Error('Incomplete score rendering');
    return { partials, bounds: renderer.boundsLookup, musicFontSize: settings.display.resources.engravingSettings.musicFontSize };
  } finally { renderer.destroy(); }
}

// Reader: tab (with rhythm stems) for one track in Jarvis's dark palette.
export function renderReader(score, trackIndex, { width = 390, scale = 1, font } = {}) {
  const track = score.tracks[trackIndex];
  if (!track) throw Error('No such track');
  const stringed = track.staves[0]?.tuning.length > 0 && !track.staves[0].isPercussion;
  const settings = new alphaTab.Settings();
  settings.core.engine = 'svg';
  settings.core.enableLazyLoading = false;
  settings.core.includeNoteBounds = false;
  settings.display.staveProfile = stringed ? alphaTab.StaveProfile.Tab : alphaTab.StaveProfile.Score;
  settings.display.scale = scale;
  settings.display.padding = [0, 0, 0, 0];
  settings.display.stretchForce = 0.85;
  settings.display.systemPaddingTop = 18;
  settings.display.systemPaddingBottom = 18;
  settings.display.barsPerRow = -1;
  settings.notation.rhythmMode = alphaTab.TabRhythmMode.ShowWithBars;
  const res = settings.display.resources;
  res.staffLineColor = color(244, 241, 234, 0.2);
  res.barSeparatorColor = color(244, 241, 234, 0.42);
  res.barNumberColor = color(185, 180, 171, 0.75);
  res.mainGlyphColor = color(244, 241, 234);
  res.secondaryGlyphColor = color(185, 180, 171);
  res.scoreInfoColor = color(185, 180, 171);
  const SANS = 'Arial, Helvetica, sans-serif';
  res.tablatureFont = new M.Font(SANS, 14, M.FontStyle.Plain, M.FontWeight.Bold);
  // Text in the tab matches the app: sans everywhere instead of alphaTab's serif.
  res.effectFont = new M.Font(SANS, 11, M.FontStyle.Plain, M.FontWeight.Regular);
  for (const [key, f] of [...res.elementFonts]) res.elementFonts.set(key, new M.Font(SANS, f.size, f.style, f.weight));
  // Section names are drawn by the page above each system; BPM is in its header.
  // "Let ring" brackets crowd the chord names on a phone; playback still lets them ring.
  hide(settings, [...HIDDEN_HEADER, 'GuitarTuning', 'TrackNames', 'ChordDiagrams', 'EffectCapo', 'EffectDynamics', 'EffectMarker', 'EffectTempo', 'EffectLetRing']);
  const { partials, bounds, musicFontSize } = render(settings, score, [trackIndex], Math.round(width / scale));
  const systems = partials.map(p => ({ svg: font ? outlineMusic(p.svg, font, musicFontSize * scale, '#f4f1ea') : p.svg,
    width: p.width, height: p.height, first: p.first, last: p.last, bars: [] }));
  for (const system of bounds.staffSystems) for (const mb of system.bars) {
    const at = partials.findIndex(p => mb.index >= p.first && mb.index <= p.last);
    if (at < 0) continue;
    const p = partials[at], box = mb.visualBounds, real = mb.realBounds;
    const staffBar = mb.bars[0];
    const beats = [];
    for (const b of staffBar?.beats || []) {
      const beat = b.beat;
      if (beat.voice.index !== 0 || beat.graceType !== M.GraceType.None) continue;
      beats.push([beat.playbackStart, round(b.onNotesX - p.x)]);
    }
    beats.sort((a, c) => a[0] - c[0]);
    systems[at].bars.push({ index: mb.index, x: round(real.x - p.x), w: round(real.w), y: round(box.y - p.y), h: round(box.h),
      duration: score.masterBars[mb.index].calculateDuration(), beats });
  }
  return systems;
}
const round = n => Math.round(n * 10) / 10;

const VELOCITY = [0.32, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

// Every note of one track in playback order. Repeats, alternate endings and
// jumps come from alphaTab's own MIDI generator so playback matches the score.
export function buildTimeline(score, trackIndex) {
  const track = score.tracks[trackIndex];
  if (!track) throw Error('No such track');
  const tempos = [];
  const ignore = () => {};
  const handler = { addTimeSignature: ignore, addRest: ignore, addNote: ignore, addControlChange: ignore, addProgramChange: ignore,
    addBend: ignore, addNoteBend: ignore, finishTrack: ignore, addTickShift: ignore,
    addTempo(tick, bpm) { if (tempos.length && tempos.at(-1)[0] === tick) tempos.at(-1)[1] = bpm; else tempos.push([tick, bpm]); } };
  const generator = new alphaTab.midi.MidiFileGenerator(score, new alphaTab.Settings(), handler);
  generator.generate();
  if (!tempos.length || tempos[0][0] > 0) tempos.unshift([0, score.tempo || 120]);
  const staff = track.staves[0], strings = staff.tuning.length;
  const bars = [], events = [], origins = new Map(), shapes = new Map();
  generator.tickLookup.masterBars.forEach((lookup, seq) => {
    const master = lookup.masterBar, bar = staff.bars[master.index];
    bars.push({ mb: master.index, start: lookup.start, end: lookup.end, num: master.timeSignatureNumerator, den: master.timeSignatureDenominator,
      section: master.section?.text || '' });
    const beats = [];
    for (const voice of bar?.voices || []) for (const beat of voice.beats) if (!beat.isEmpty && !beat.isRest && beat.notes.length) beats.push(beat);
    beats.sort((a, b) => a.playbackStart - b.playbackStart || a.voice.index - b.voice.index);
    for (const beat of beats) {
      let tick = lookup.start + beat.playbackStart, length = Math.max(30, beat.playbackDuration);
      if (beat.graceType !== M.GraceType.None) {
        length = Math.min(length, PPQ / 8);
        if (beat.graceType === M.GraceType.BeforeBeat) tick = Math.max(lookup.start, tick - length);
      }
      const notes = [];
      for (const n of beat.notes) {
        if (n.isTieDestination && n.tieOrigin && origins.has(n.tieOrigin)) {
          const origin = origins.get(n.tieOrigin);
          origin.d = tick + length - origin.at;
          origins.set(n, origin);
          continue;
        }
        let flags = 0;
        if (n.isDead) flags |= FLAG.dead;
        if (n.isPalmMute) flags |= FLAG.palmMute;
        if (n.isLetRing) flags |= FLAG.letRing;
        if (n.isGhost) flags |= FLAG.ghost;
        if (n.accentuated !== M.AccentuationType.None) flags |= FLAG.accent;
        if (n.harmonicType !== M.HarmonicType.None) flags |= FLAG.harmonic;
        if (n.isHammerPullDestination || n.slideOrigin) flags |= FLAG.legato;
        if (n.vibrato !== M.VibratoType.None || beat.vibrato !== M.VibratoType.None) flags |= FLAG.vibrato;
        if (n.slideOutType !== M.SlideOutType.None) flags |= FLAG.slide;
        if (n.isStaccato) flags |= FLAG.staccato;
        const note = { s: strings ? strings - n.string : 0, f: n.fret, m: n.realValue, d: length, fl: flags, at: tick };
        // Bend points: [offset 0..1 across the note, semitones].
        if (n.hasBend && n.bendPoints?.length) note.b = n.bendPoints.map(p => [round(p.offset / 60), p.value / 2]);
        if (note.fl & FLAG.slide && n.slideTarget) note.to = n.slideTarget.realValue;
        origins.set(n, note);
        notes.push(note);
      }
      if (!notes.length) continue;
      const strum = beat.brushType === M.BrushType.BrushUp || beat.brushType === M.BrushType.ArpeggioUp || beat.pickStroke === M.PickStroke.Up ? -1
        : notes.length >= 3 || beat.brushType !== M.BrushType.None || beat.pickStroke === M.PickStroke.Down ? 1 : 0;
      const spread = beat.brushType === M.BrushType.ArpeggioUp || beat.brushType === M.BrushType.ArpeggioDown ? Math.max(beat.brushDuration || 0, PPQ / 4) : 0;
      const event = { t: tick, d: length, q: seq, v: VELOCITY[beat.dynamics] ?? 0.7, st: strum, n: notes };
      if (spread) event.sp = spread;
      if (beat.hasChord && beat.chord?.name) event.c = beat.chord.name;
      events.push(event);
    }
    if (!shapes.has(master.index)) shapes.set(master.index, barChords(beats, master, strings, staff));
  });
  for (const e of events) for (const n of e.n) delete n.at;
  const chords = [];
  bars.forEach((bar, seq) => {
    for (const part of shapes.get(bar.mb) || []) {
      const t = bar.start + part.offset;
      const last = chords.at(-1);
      if (last?.name === part.name) {
        // Arpeggios spread one shape across windows: fill strings seen later.
        if (last.q >= seq - 1) part.frets.forEach((f, i) => { if (last.frets[i] < 0 && f >= 0) last.frets[i] = f; });
        continue;
      }
      chords.push({ t, q: seq, name: part.name, frets: part.frets });
    }
  });
  const end = bars.length ? bars.at(-1).end : 0;
  return { ppq: PPQ, tempos, bars, events, chords, end, strings, tuning: [...staff.tuning].reverse(), capo: staff.capo || 0 };
}

// Chord names for a bar: written names win; otherwise notes in each half bar
// (or the whole bar in odd meters) are named when they form a common chord.
function barChords(beats, master, strings, staff) {
  const length = master.calculateDuration();
  const windows = master.timeSignatureNumerator % 2 === 0 && master.timeSignatureNumerator >= 4 ? 2 : 1;
  const out = [];
  for (let w = 0; w < windows; w++) {
    const from = length * w / windows, to = length * (w + 1) / windows;
    const inside = beats.filter(b => b.playbackStart >= from && b.playbackStart < to && b.graceType === M.GraceType.None);
    if (!inside.length) continue;
    const written = inside.find(b => b.hasChord && b.chord?.name);
    const frets = Array(strings).fill(-1), pitches = [];
    let together = 0;
    for (const beat of inside) together = Math.max(together, beat.notes.filter(n => !n.isDead && !n.isTieDestination).length);
    for (const beat of inside) for (const n of beat.notes) {
      if (n.isDead || n.isTieDestination) continue;
      pitches.push(n.realValue - (staff.capo || 0));
      const index = n.string - 1;
      if (index >= 0 && index < strings && frets[index] < 0) frets[index] = n.fret;
    }
    // Notes struck together name a chord; single notes only when they spread
    // over four or more strings (an arpeggio), never a lead line.
    const spread = frets.filter(f => f >= 0).length;
    const chordal = together >= 3 || spread >= 4;
    const name = written ? written.chord.name : chordal && new Set(pitches.map(p => p % 12)).size >= 3 ? chordName(pitches) : '';
    if (!name) continue;
    if (written?.chord.strings?.length) {
      // Guitar Pro diagrams list frets from the highest string.
      const listed = [...written.chord.strings].reverse();
      if (listed.length === strings) for (let i = 0; i < strings; i++) frets[i] = listed[i];
    }
    out.push({ offset: (written || inside[0]).playbackStart, name, frets });
  }
  return out;
}

// Print: the A4 notation + tablature systems pdf.js expects, as before.
export function renderPrint(score, trackIndices, font) {
  const result = { systems: [], warnings: [], measures: 0 };
  for (const index of trackIndices) {
    const settings = printSettings(score);
    const { partials, musicFontSize } = render(settings, score, [index], PRINT_WIDTH);
    const systems = partials.map(p => ({ svg: font ? outlineMusic(p.svg, font, musicFontSize) : p.svg, width: p.width, height: p.height, first: p.first, last: p.last }));
    if (trackIndices.length > 1) systems[0].sectionName = score.tracks[index].name || 'Guitar';
    result.systems.push(...systems); result.measures += score.masterBars.length;
  }
  if (!result.systems.length) throw Error('No score');
  return result;
}
function printSettings(score) {
  for (const t of score.tracks) for (const s of t.staves) {
    const program = t.playbackInfo.program;
    const guitar = program >= 24 && program <= 31, bass = program >= 32 && program <= 39;
    s.showStandardNotation = true;
    s.showTablature = !s.isPercussion && s.tuning.length > 0 && (guitar || bass || trackKind(t) === 'guitar');
    if (guitar || bass) s.displayTranspositionPitch = -12;
    if (bass) for (const b of s.bars) b.clef = M.Clef.F4;
  }
  const settings = new alphaTab.Settings();
  settings.core.engine = 'svg';
  settings.core.enableLazyLoading = false;
  settings.core.includeNoteBounds = false;
  settings.display.padding = [0, 0, 0, 0];
  settings.display.scale = 1;
  settings.display.stretchForce = 0.65;
  settings.display.systemPaddingTop = 10;
  settings.display.systemPaddingBottom = 14;
  settings.display.effectBandPaddingBottom = 8;
  settings.display.barsPerRow = -1;
  settings.display.resources.secondaryGlyphColor = new M.Color(0, 0, 0);
  settings.display.resources.barNumberColor = new M.Color(65, 65, 65);
  // Header is drawn separately with wrapping; keep alphaTab's tuning/tempo/track labels.
  hide(settings, [...HIDDEN_HEADER, 'ChordDiagrams']);
  return settings;
}

// Songsterr prints each selected part from its own score, as it always has.
export function printSongsterr(data, font) {
  const result = { systems: [], warnings: [], measures: 0 };
  for (const revision of data.revisions) {
    const { score, warnings } = loadScore({ kind: 'songsterr', data: { ...data, revisions: [revision] } });
    const part = renderPrint(score, [0], font);
    if (data.revisions.length > 1) part.systems[0].sectionName = revision.trackMeta.name || revision.trackMeta.title || 'Guitar';
    result.systems.push(...part.systems); result.warnings.push(...warnings); result.measures += part.measures;
  }
  if (!result.systems.length) throw Error('No score');
  return result;
}
