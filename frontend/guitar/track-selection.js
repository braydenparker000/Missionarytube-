// Pure track-selection logic for the Guitar song view.
//
// A fresh song view must default to a guitar track ("All guitar tracks" when
// available), never to whatever track id happened to be checked in the DOM
// from a previously viewed song. A remembered selection is only honored when
// it names a real, current option for THIS song.
export function guitarTracks(tracks) {
  return tracks.filter(t => t.kind === 'guitar');
}

// The multi-select "All guitar tracks" value, or null when the option is not
// offered. The 2..12 bounds match the picker UI.
export function allGuitarValue(tracks) {
  const guitars = guitarTracks(tracks);
  return (guitars.length > 1 && guitars.length <= 12)
    ? guitars.map(t => t.partId).join(',')
    : null;
}

// Default selection for a song with no valid remembered choice.
export function defaultParts(tracks) {
  const all = allGuitarValue(tracks);
  if (all) return all;
  const guitar = tracks.find(t => t.kind === 'guitar');
  return String((guitar || tracks[0]).partId);
}

// Returns the remembered value only if it is a real option for this song:
// the current "All guitar tracks" value or an existing track partId.
// Anything else (stale ids, ids leaked from another song) yields null.
export function validParts(tracks, value) {
  if (value == null || value === '') return null;
  if (value === allGuitarValue(tracks)) return value;
  return tracks.some(t => String(t.partId) === value) ? value : null;
}

// Prefer the latest valid visit, then a saved choice, then the guitar default.
export function resolveParts(tracks, remembered, saved) {
  return validParts(tracks, remembered) || validParts(tracks, saved) || defaultParts(tracks);
}

// The track the reader opens first: a rhythm part when one is named, else a
// guitar that is not the lead or solo. GP tracks also carry note counts, so
// nearly empty guitar tracks are passed over.
export function readerTrack(tracks) {
  const guitars = tracks.filter(t => t.kind === 'guitar');
  const most = Math.max(0, ...guitars.map(t => t.notes ?? 1));
  const usable = guitars.filter(t => (t.notes ?? 1) >= most * 0.25);
  const pool = usable.length ? usable : guitars.length ? guitars : tracks;
  return (pool.find(t => /rhythm/i.test(t.name)) || pool.find(t => !/\b(lead|solo)\b/i.test(t.name)) || pool[0])?.id;
}
