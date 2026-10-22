// Info/Tags (dialog_InfoActivity, dialog_content_info) and Album Art
// (dialog_SelectAlbumArtActivity). Info shows the file, the format line,
// ReplayGain, play statistics (with Reset), then the tags; empty tags hide
// with their labels; artist, album, album artist and genre open their lists
// and the folder button the track's folder. Tag editing is out of scope
// (owner decision). Album Art offers Pick From Gallery (an image file) for
// the track, or its whole album with "Also use for"; online search is not
// available here, so the list shows nothing to choose and the message names
// the current cover's source. Clear removes a picked image (an addition:
// the reference has no picked images to remove).
import {GONE, VISIBLE} from '../res/values.js';
import {openDialog} from './dialog.js';
import {trackMetaLabel} from '../library/library.js';
import '../view/table.js';

const str = (ctx, name, fallback = name) => ctx.res.stringByName(name) ?? fallback;

function fmtTime(ms) {
  const s = Math.round((ms || 0) / 1000);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + ':' + String(x).padStart(2, '0');
}

function fmtSize(bytes) {
  if (!bytes) return '';
  return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + ' MB' : Math.round(bytes / 1024) + ' KB';
}

/** Where the track's cover comes from, in the reference's wording. */
function artSource(ctx, t) {
  const lib = ctx.library;
  if (lib?.customArt?.size && lib.customArtFor(t)) return str(ctx, 'art_image', 'Image');
  if (t.remote) return t.artUrl ? str(ctx, 'aa_non_title', 'Album art') : str(ctx, 'embed_album_art', 'Embedded album art');
  if (t.artId) return str(ctx, 'embed_album_art', 'Embedded album art');
  return str(ctx, 'no_album_art', 'No album art');
}

export function openInfo(ctx, t) {
  if (!t) return null;
  const nav = kind => () => {
    dialog.close();
    if (kind === 'folder') ctx.listWidget?.openCurrent('folder', t);
    else ctx.listWidget?.openCurrent(kind, t);
  };
  const dialog = openDialog(ctx, {
    style: 'dialog_InfoActivity', title: str(ctx, 'info', 'Info/Tags'),
    buttons: {negative: str(ctx, 'close', 'Close')},
    setup: d => {
      const set = (id, value, labelId = id + '_label') => {
        const v = d.find(id), l = labelId ? d.find(labelId) : null;
        const has = value !== undefined && value !== null && String(value) !== '' && value !== 0;
        v?.setText(has ? String(value) : '');
        v?.setVisibility(has ? VISIBLE : GONE);
        l?.setVisibility(has ? VISIBLE : GONE);
        return v;
      };
      set('file_name', t.path || t.fileName || t.title, null);
      d.find('file_name')?.setVisibility(VISIBLE);
      const meta = [trackMetaLabel(t), t.channels ? (t.channels === 1 ? 'Mono' : t.channels === 2 ? 'Stereo' : t.channels + 'ch') : '', fmtTime(t.durationMs), fmtSize(t.size)].filter(Boolean).join('  •  ');
      d.find('meta')?.setText(meta);
      const rg = t.replayGain;
      const rgText = rg ? [rg.track != null ? `RG track ${(+rg.track).toFixed(2)} dB` : '', rg.album != null ? `album ${(+rg.album).toFixed(2)} dB` : ''].filter(Boolean).join(', ') : '';
      set('meta_rg', rgText, null);
      // Statistics: play count and last played, with Reset.
      d.find('played_times')?.setText(String(t.plays ?? 0));
      d.find('last_played')?.setText(t.lastPlayed ? new Date(t.lastPlayed).toLocaleString() : str(ctx, 'never', 'Never'));
      const reset = d.find('reset_button');
      if (reset) {
        reset.setVisibility(t.plays || t.lastPlayed ? VISIBLE : GONE);
        reset.onClick = () => {
          const lt = ctx.library?.byId.get(t.id) ?? t;
          lt.plays = 0; lt.lastPlayed = 0;
          if (ctx.library?.byId.has(lt.id)) ctx.library.saveTrack(lt);
          d.find('played_times')?.setText('0');
          d.find('last_played')?.setText(str(ctx, 'never', 'Never'));
          reset.setVisibility(GONE);
          ctx.scheduleLayout();
        };
      }
      set('title_tag', t.title, 'title_label');
      set('track', t.track ? (t.trackTotal ? `${t.track}/${t.trackTotal}` : t.track) : null);
      set('disc', t.disc || null);
      set('year', t.year || null);
      // The track/disc/year table hides as a whole when all three are empty.
      if (!t.track && !t.disc && !t.year) d.find('track_year_genre')?.parent?.setVisibility(GONE);
      for (const [id, kind] of [['genre', 'genre'], ['artist', 'artist'], ['album', 'album'], ['album_artist', null], ['composer', null]]) {
        const v = set(id, id === 'album_artist' ? t.albumArtist : t[id]);
        if (v && kind) { v.clickable = true; v.onClick = nav(kind); }
      }
      set('album_art', artSource(ctx, t));
      set('comment', t.comment);
      const folder = d.find('folder');
      if (folder) {
        folder.setVisibility(t.folder || t.path ? VISIBLE : GONE);
        folder.onClick = nav('folder');
      }
    },
  });
  return dialog;
}

/** Album Art: Pick From Gallery for the track or (Also use for) its album. */
export function openAlbumArt(ctx, t) {
  if (!t) return null;
  const lib = ctx.library;
  let useFor = null;
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f || f.size > 20 * 1024 * 1024) return;
      await lib.setCustomArt(t, f, !!useFor?.isChecked);
      dialog.close();
    };
    input.click();
  };
  const hasCustom = () => lib.customArt.has(lib.artKeys(t).track) || lib.customArt.has(lib.artKeys(t).album);
  const dialog = openDialog(ctx, {
    style: 'dialog_SelectAlbumArtActivity', title: str(ctx, 'album_art', 'Album Art'),
    setup: d => {
      d.setButton(1, str(ctx, 'pick_image', 'Pick From Gallery'), pick);
      d.setButton(2, null);
      d.setButton(3, hasCustom() ? str(ctx, 'clear', 'Clear') : null, async () => {
        const k = lib.artKeys(t);
        await lib.setCustomArt(t, null, !lib.customArt.has(k.track));
        dialog.close();
      });
      d.find('settings_button')?.setVisibility(GONE);
      d.find('progress')?.setVisibility(GONE);
      d.find('checkbox')?.setVisibility(GONE); // High Resolution applies to downloads
      d.find('list')?.setVisibility(GONE);
      useFor = d.find('use_for');
      if (useFor && t.album) {
        useFor.setVisibility(VISIBLE);
        useFor.setText((str(ctx, 'also_use_for_s', 'Also use for: %s')).replace('%s', t.album));
        useFor.setChecked(true);
      }
      const msg = d.find('message');
      msg?.setText(artSource(ctx, t));
      msg?.setVisibility(VISIBLE);
    },
  });
  return dialog;
}
