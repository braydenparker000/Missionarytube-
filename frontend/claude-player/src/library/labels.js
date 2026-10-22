// Track labels as the reference library builds them (z22 / n12 label helpers
// and the track lists' line-2 projection, uf1.e1; notebook F63). An empty tag
// is the reference's unknown entry (id 1000):
// - title: the title tag, or the file name with title_filename;
// - artist: the album artist with use_albumartist, else the artist, else "Unknown artist";
// - album: the album, else "Unknown album" ("" with hide_unknown_album);
// - line 2: "artist - album", leaving out unknown parts with
//   hide_unknown_album / hide_unknown_artist and leading with the album
//   artist with use_albumartist;
// - numbers (track_num_type): 1 a separate number ("-" without one), 2 in
//   the meta, 3 before the title; types 1 and 2 only in album and folder
//   track lists. track_disc_meta adds the disc to the meta.

const str = (ctx, name, fallback) => ctx.res?.stringByName(name) ?? fallback;

/** The file name of a path (after the last /). */
function fileName(t) {
  const p = t.fileName || t.path || '';
  const i = p.lastIndexOf('/');
  return i === -1 || i === p.length - 1 ? p : p.slice(i + 1);
}

export function trackTitle(ctx, t) {
  if (!t) return '';
  if (!ctx.pref?.('title_filename') && t.title) return t.title;
  return fileName(t) || t.title || '';
}

export function artistLabel(ctx, t) {
  if (!t) return '';
  if (ctx.pref?.('use_albumartist') && t.albumArtist) return t.albumArtist;
  return t.artist || str(ctx, 'unknown_artist_name', 'Unknown artist');
}

export function albumLabel(ctx, t) {
  if (!t) return '';
  if (ctx.pref?.('hide_unknown_album') && !t.album) return '';
  return t.album || str(ctx, 'unknown_album_name', 'Unknown album');
}

/**
 * uf1.e1: the second line of a track row. In an album artist's track lists
 * (qe1 / pe1) use_albumartist_albumartists leads with the album artist.
 */
export function trackLine2(ctx, t, albumArtistList = false) {
  if (!t) return '';
  const pref = k => !!ctx.pref?.(k);
  if (albumArtistList) {
    const lead = pref('use_albumartist_albumartists') ? t.albumArtist || t.artist || str(ctx, 'unknown_artist_name', 'Unknown artist')
      : t.artist || str(ctx, 'unknown_artist_name', 'Unknown artist');
    if (pref('hide_unknown_album') && !t.album) return lead;
    return lead + ' - ' + (t.album || str(ctx, 'unknown_album_name', 'Unknown album'));
  }
  const artist = t.artist || str(ctx, 'unknown_artist_name', 'Unknown artist');
  const album = t.album || str(ctx, 'unknown_album_name', 'Unknown album');
  const hideAlbum = pref('hide_unknown_album'), hideArtist = pref('hide_unknown_artist');
  if (!pref('use_albumartist')) {
    if (!hideAlbum) return artist + ' - ' + album;
    if (!hideArtist) return t.album ? artist + ' - ' + album : artist;
    if (!t.album) return t.artist || '';
    return t.artist ? artist + ' - ' + album : album;
  }
  const lead = t.albumArtist || artist;
  if (!hideAlbum) return lead + ' - ' + album;
  if (!hideArtist) return lead + (t.album ? ' - ' + album : '');
  const known = t.albumArtist || t.artist || null;
  return (known === null ? '' : known + (t.album ? ' - ' : '')) + (t.album ? album : '');
}

/**
 * Row numbers (xc / AAItemView.m): {num, title, meta} for a track in a list
 * where track numbers are relevant (album and folder track lists) or not.
 */
export function trackNumbers(ctx, t, relevant) {
  const type = +ctx.pref?.('track_num_type') || 0;
  const disc = ctx.pref?.('track_disc_meta') && type !== 0 && (relevant || type === 3) ? t?.disc || 0 : 0;
  const no = type === 3 || ((type === 1 || type === 2) && relevant) ? t?.track || 0 : 0;
  const meta = m => {
    const tail = m ? ' | ' + m : '';
    if (type === 2 && no > 0) return no + (disc > 0 ? ' / ' + disc : '') + tail;
    if (disc > 0) return disc + tail;
    return m ?? '';
  };
  return {
    num: type === 1 && relevant ? (no > 0 ? String(no) : '-') : null,
    title: title => (type === 3 && no > 0 ? no + '. ' + title : title),
    meta,
  };
}
