// Re-Sort (PlaylistSortActivity, dialog_content_resort; notebook F66): a
// playlist's or the Queue's entries take a new stored order. Each choice
// re-sorts at once (cmd_data_resort); Reverse (bit 30) flips every key.
// The orders are cm2.q's: names case folded (COLLATE NOCASE), album and
// artist by their sort fields (no leading article unless no_sort_field),
// ties broken by the title; Random ignores Reverse. "By added to list"
// (14) is the Queue's entry time; playlists have none and hide it.
import {openDialog} from './dialog.js';
import {GONE} from '../res/values.js';
import {FastRadioButton, FastCheckBox} from '../view/text.js';

export const REVERSE = 0x40000000;
const ARTICLE = /^(the|a|an)\s+/i;

const fold = s => String(s ?? '').toLowerCase();
const cmpText = (a, b) => { const x = fold(a), y = fold(b); return x < y ? -1 : x > y ? 1 : 0; };
const cmpNum = (a, b) => (a ?? 0) - (b ?? 0);
const fileName = t => { const p = t.fileName || t.path || ''; return p.slice(p.lastIndexOf('/') + 1); };

/** Sort keys per value: [compare(a, b) of entries, descending by default]. */
function keys(ctx, value) {
  const sortField = s => (ctx.pref?.('no_sort_field') ? s : String(s ?? '').replace(ARTICLE, ''));
  const album = e => sortField(e.track.album), artist = e => sortField(e.track.albumArtist || e.track.artist);
  const T = (f, desc = false) => [(a, b) => cmpText(f(a), f(b)), desc];
  const N = (f, desc = false) => [(a, b) => cmpNum(f(a), f(b)), desc];
  const title = T(e => e.track.title);
  switch (value) {
    case 0: return [N(e => e.track.track), title];
    case 1: return [title];
    case 2: return [T(e => fileName(e.track))];
    case 3: return [T(album), T(artist), title];
    case 4: case 5: return [T(artist), T(album), title];
    case 6: return [N(e => e.track.year), title];
    case 7: return [N(e => e.track.modified || e.track.added), title];
    case 8: return [N(e => e.track.rating, true), title];
    case 10: return [N(e => e.track.added), title];
    case 11: return [N(e => e.track.durationMs, true), title];
    case 12: return [N(e => e.track.plays, true), title];
    case 13: return [N(e => e.track.lastPlayed, true), title];
    case 14: return [N(e => e.created)];
    case 16: return [T(e => e.track.path || fileName(e.track))];
    case 17: return [T(artist), T(album), N(e => e.track.track)];
    case 18: return [T(album), N(e => e.track.track)];
    default: return null;
  }
}

/** The entries ({track, created?}) in the order of a sort value, or null for none. */
export function resortEntries(ctx, entries, value) {
  const v = value & ~REVERSE, rev = (value & REVERSE) !== 0;
  if (v === 9) {
    const out = [...entries];
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }
  const ks = keys(ctx, v);
  if (!ks) return null;
  return [...entries].sort((a, b) => {
    for (const [cmp, desc] of ks) {
      const c = cmp(a, b);
      if (c) return desc !== rev ? -c : c;
    }
    return 0;
  });
}

/**
 * Opens Re-Sort for a list: name (the title's %s), entries, hasAddedTime
 * (shows "by added to list"), apply(sorted entries).
 */
export function openResortDialog(ctx, {name, entries, hasAddedTime = false, apply}) {
  const str = (k, f = k) => ctx.res.stringByName(k) ?? f;
  // Reverse alone re-sorts by the last order, track number at first (h = 0).
  let value = 0, reverse = false;
  const run = () => {
    const sorted = resortEntries(ctx, entries(), value | (reverse ? REVERSE : 0));
    if (sorted) apply(sorted);
  };
  return openDialog(ctx, {
    style: 'dialog_PlaylistSortActivity', title: str('sort_s', 'Re-Sort %s').replace('%s', name),
    buttons: {positive: str('close', 'Close')},
    setup: d => {
      const group = d.find('song_sorting_group');
      if (!group) return;
      const radios = [];
      group.walk?.(v => { if (v instanceof FastRadioButton) radios.push(v); });
      for (const r of radios) {
        const tag = parseInt(String(r.tag ?? ''), 10);
        if (tag === 14 && !hasAddedTime) { r.setVisibility(GONE); continue; }
        r.onCheckedChanged = on => {
          if (!on) return;
          for (const x of radios) if (x !== r) x.setChecked(false);
          value = tag;
          run();
        };
      }
      const rev = d.find('song_sort_reverse');
      if (rev instanceof FastCheckBox) rev.onCheckedChanged = on => { reverse = on; run(); };
    },
  });
}
