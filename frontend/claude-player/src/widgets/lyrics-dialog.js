// Lyrics dialog (dialogs.LyricsActivity, dialog_LyricsActivity over
// BottomsheetDialog; notebook F61): opened by a long press on the lyrics
// button (cmd_data_lyrics). It shows the track's unsynchronised lyrics tag
// when it has at least 32 characters (a lone \r becomes a line break), else
// "no lyrics", and follows the playing track while open. Search (button1)
// offers "lyrics <artist> <title>" for a web search (the album added when
// the artist is empty; - and _ become spaces) through the share sheet. The lyrics
// provider apps the reference also queries are Android apps (not on the web).
import {VISIBLE} from '../res/values.js';
import {openDialog} from './dialog.js';

const str = (ctx, name, fallback = name) => ctx.res.stringByName(name) ?? fallback;
const MIN_LYRICS = 32;

/** The track's title, else its file name without the extension. */
function titleOf(t) {
  if (t?.title) return t.title;
  const name = (t?.path || t?.fileName || '').split('/').pop();
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

/** The reference's web search query (LyricsActivity.onClick). */
export function lyricsQuery(t) {
  const clean = s => s.replace(/[-_]/g, ' ');
  let q = 'lyrics ';
  if (t.artist) q += clean(t.artist);
  q += ' ' + clean(titleOf(t));
  if (!t.artist && t.album) q += ' ' + clean(t.album);
  return q;
}

export function openLyricsDialog(ctx, track) {
  let t = track ?? ctx.player?.track;
  if (!t) return null;
  let unsubscribe = null;
  const show = d => {
    const text = d.find('big_text');
    if (!text) return;
    const lyr = t.lyrics;
    text.setText(lyr && lyr.length >= MIN_LYRICS ? lyr.replace(/\r(?!\n)/g, '\n') : str(ctx, 'no_lyrics', 'No lyrics'));
    text.setVisibility(VISIBLE);
    d.host.requestLayout();
  };
  const dialog = openDialog(ctx, {
    style: 'dialog_LyricsActivity', title: str(ctx, 'lyrics', 'Lyrics'),
    buttons: {positive: str(ctx, 'search', 'Search')},
    // The web counterpart of the WEB_SEARCH chooser (substitute): the share
    // sheet with the query, else the query copied to the clipboard.
    onButton: which => {
      if (which !== 1) return false;
      const q = lyricsQuery(t);
      if (navigator.share) navigator.share({title: q, text: q}).catch(() => {});
      else navigator.clipboard?.writeText(q).catch(() => {});
      return false;
    },
    onClosed: () => unsubscribe?.(),
    setup: d => {
      const content = d.find('content');
      if (content) ctx.inflater.inflate('dialog_content_lyrics', content);
      show(d);
    },
  });
  // The dialog follows the playing track (msg_player_track_changed).
  unsubscribe = ctx.bus.subscribe('bus_player', msg => {
    if (msg !== 'msg_player_track_changed' || dialog.closed) return;
    const next = ctx.player?.track;
    if (!next || next === t) return;
    t = next;
    show(dialog);
  });
  return dialog;
}
