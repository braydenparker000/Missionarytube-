// Lyrics dialog (dialogs.LyricsActivity, dialog_LyricsActivity over
// BottomsheetDialog; notebook F61): opened by a long press on the lyrics
// button (cmd_data_lyrics). It shows the track's unsynchronised lyrics tag
// when it has at least 32 characters (a lone \r becomes a line break), else
// "no lyrics", and follows the playing track while open. Search (button1)
// offers "lyrics <artist> <title>" for a web search (the album added when
// the artist is empty; - and _ become spaces) through the share sheet. The lyrics
// provider apps the reference also queries are Android apps (not on the web).
// The web's lyrics plugin (lyrics_plugin) is "Browser via custom URL":
// without lyrics (or first, for cmd_data_lyrics with arg1 1) the dialog
// opens lyrics_custom_url with %ARTIST%, %TITLE%, %ALBUM% and %TRACKNUMBER%
// filled in, then closes after a second. None turns it off; the app choices
// fall back to the custom URL, as an unavailable app does in the reference.
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

/**
 * The custom URL for a track (ci, BrowserUrlLyricsHelper): the first
 * %ALBUM%, %ARTIST%, %TITLE% and %TRACKNUMBER% (any case) replaced, - and _
 * in values as spaces, http:// added when the URL does not start with http.
 */
export function lyricsUrl(template, t) {
  if (!template) return null;
  let u = template.startsWith('http') ? template : 'http://' + template;
  const clean = v => (v ?? '').replace(/[-_]/g, ' ');
  for (const [k, v] of [['%ALBUM%', clean(t.album)], ['%ARTIST%', clean(t.artist)], ['%TITLE%', clean(titleOf(t))], ['%TRACKNUMBER%', String(t.track ?? 0)]]) {
    const i = u.toUpperCase().indexOf(k);
    if (i >= 0) u = u.slice(0, i) + v + u.slice(i + k.length);
  }
  try { return new URL(u).href; } catch { return null; }
}

/** The lyrics plugin on the web: the custom URL when one is set, unless lyrics_plugin is None. */
function lyricsPlugin(ctx) {
  if (+ctx.pref('lyrics_plugin') === -1) return null;
  const template = String(ctx.pref('lyrics_custom_url') ?? '').trim();
  return template ? {template} : null;
}

export function openLyricsDialog(ctx, track, {pluginFirst = false} = {}) {
  let t = track ?? ctx.player?.track;
  if (!t) return null;
  let unsubscribe = null;
  const plugin = lyricsPlugin(ctx);
  // P(): with artist and title the plugin opens and the dialog closes a second later.
  const runPlugin = d => {
    const text = d.find('big_text');
    if (!t.artist || !titleOf(t)) {
      text?.setText(str(ctx, 'no_enough_tags', 'Not enough tags'));
      text?.setVisibility(VISIBLE);
      d.host.requestLayout();
      return;
    }
    const url = lyricsUrl(plugin.template, t);
    if (url) globalThis.open?.(url, '_blank', 'noopener');
    setTimeout(() => d.cancel?.(), 1000);
  };
  const show = d => {
    const text = d.find('big_text');
    if (!text) return;
    if (pluginFirst && plugin) { runPlugin(d); return; }
    const lyr = t.lyrics;
    if (!(lyr && lyr.length >= MIN_LYRICS) && plugin) { runPlugin(d); return; }
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
