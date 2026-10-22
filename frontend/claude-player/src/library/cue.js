// CUE sheets (process_cues, show_cue_source; notebook F77). An imported
// audio file with a .cue sheet beside it that names it (FILE "…", else the
// sheet of the same base name) and lists several tracks becomes a virtual
// folder (named after the .cue file) of virtual tracks, each a range of the
// disc image: from its INDEX 01 to the next track's (the last one to the
// file's end). The image itself is hidden unless show_cue_source. Sheet
// fields: TITLE / PERFORMER / SONGWRITER per sheet and track, REM GENRE /
// REM DATE; times are mm:ss:ff at 75 frames per second.

const unquote = s => {
  s = s.trim();
  return s.startsWith('"') ? s.slice(1, s.lastIndexOf('"') > 0 ? s.lastIndexOf('"') : undefined) : s.split(/\s+/)[0];
};

/** mm:ss:ff → ms. */
function cueTime(s) {
  const m = /^(\d+):(\d+):(\d+)$/.exec(s.trim());
  return m ? Math.round((+m[1] * 60 + +m[2]) * 1000 + +m[3] * 1000 / 75) : null;
}

/** A sheet: {title, performer, songwriter, genre, date, files: [{name, tracks: [{n, title, performer, songwriter, startMs}]}]}. */
export function parseCue(text) {
  const sheet = {title: '', performer: '', songwriter: '', genre: '', date: '', files: []};
  let file = null, track = null;
  for (const raw of String(text ?? '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    const sp = line.indexOf(' ');
    const cmd = (sp < 0 ? line : line.slice(0, sp)).toUpperCase(), rest = sp < 0 ? '' : line.slice(sp + 1);
    const target = track ?? sheet;
    switch (cmd) {
      case 'FILE': {
        // FILE "name" TYPE: the name may hold spaces when quoted.
        const q = rest.trim();
        const name = q.startsWith('"') ? q.slice(1, q.indexOf('"', 1)) : q.replace(/\s+\S+$/, '');
        file = {name, tracks: []};
        sheet.files.push(file);
        track = null;
        break;
      }
      case 'TRACK': {
        const n = parseInt(rest, 10);
        if (!file || !Number.isFinite(n)) { track = null; break; }
        track = {n, title: '', performer: '', songwriter: '', startMs: null};
        file.tracks.push(track);
        break;
      }
      case 'TITLE': target.title = unquote(rest); break;
      case 'PERFORMER': target.performer = unquote(rest); break;
      case 'SONGWRITER': target.songwriter = unquote(rest); break;
      case 'INDEX': {
        const [no, time] = rest.trim().split(/\s+/);
        if (track && +no === 1) track.startMs = cueTime(time ?? '');
        else if (track && +no === 0 && track.startMs === null) track.pregapMs = cueTime(time ?? '');
        break;
      }
      case 'REM': {
        const m = /^(GENRE|DATE)\s+(.*)$/i.exec(rest.trim());
        if (m && !track) sheet[m[1].toLowerCase()] = unquote(m[2]);
        break;
      }
      default: break;
    }
  }
  for (const f of sheet.files) f.tracks = f.tracks.filter(t => t.startMs !== null);
  return sheet;
}

/**
 * The sheet's part for one audio file (stored on the track as `cue`): the
 * FILE entry naming it, or the only entry; null without at least two tracks.
 */
export function cueFor(sheet, fileName, cueName) {
  const lc = s => (s ?? '').toLowerCase();
  const base = s => lc(s).replace(/\.[^.]+$/, '');
  let f = sheet.files.find(x => lc(x.name.split(/[\\/]/).pop()) === lc(fileName));
  // A sheet naming a different extension (a .wav sheet over a .flac image) matches by base name.
  f ??= sheet.files.find(x => base(x.name.split(/[\\/]/).pop()) === base(fileName));
  if (!f && sheet.files.length === 1 && base(cueName) === base(fileName)) f = sheet.files[0];
  if (!f || f.tracks.length < 2) return null;
  return {name: cueName, title: sheet.title, performer: sheet.performer, songwriter: sheet.songwriter, genre: sheet.genre, date: sheet.date, tracks: f.tracks.map(({n, title, performer, songwriter, startMs}) => ({n, title, performer, songwriter, startMs}))};
}

/** The virtual tracks of a disc image (t.cue), in sheet order. */
export function cueTracks(t, label) {
  const c = t.cue, list = c.tracks;
  const folder = (t.folder ? t.folder + '/' : '') + c.name;
  return list.map((x, i) => {
    const startMs = x.startMs, end = list[i + 1]?.startMs ?? (t.durationMs || null);
    const v = {
      id: t.id + '#' + x.n, cueOf: t.id, startMs, endMs: end,
      title: x.title || `Track ${String(x.n).padStart(2, '0')}`,
      artist: x.performer || c.performer || t.artist || '', album: c.title || t.album || '',
      albumArtist: c.performer || t.albumArtist || '', composer: x.songwriter || c.songwriter || t.composer || '',
      genre: c.genre || t.genre || '', year: parseInt(c.date, 10) || t.year || 0, track: x.n, disc: t.disc || 0,
      durationMs: end ? Math.max(0, end - startMs) : 0,
      format: t.format, sampleRate: t.sampleRate, bits: t.bits, bitrate: t.bitrate,
      path: folder + '/' + String(x.n).padStart(2, '0'), folder, fileName: t.fileName, size: t.size, mime: t.mime,
      artId: t.artId, added: t.added, replayGain: t.replayGain,
    };
    v.meta = label(v);
    return v;
  });
}
