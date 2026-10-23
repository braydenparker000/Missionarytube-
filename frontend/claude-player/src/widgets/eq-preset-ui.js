// The EQ menu's preset commands (merge_eq_menu_layout; notebook F67):
// Save/Assign (AddEqPresetActivity: the name prefilled with the current
// preset's, existing names suggested), Rename, Share, Export, Import.
import {openDialog, editNameDialog} from './dialog.js';
import {GONE, VISIBLE} from '../res/values.js';
import {EqPresets} from '../dsp/eq-presets.js';
import {ReverbPresets} from '../dsp/reverb-presets.js';

const str = (ctx, k, f = k) => ctx.res.stringByName(k) ?? f;

// The playing song's category for "Apply to songs" (EqPresetsBehavior: the
// category entity's singular quantity name and micro icon; none for lists
// that are not a category entry, sf1).
const CAT_PLURALS = {album: 'album', artist: 'artist', albumArtist: 'album_artist', genre: 'genre', composer: 'composer', year: 'year', folder: 'folder', playlist: 'playlist'};
const CAT_ICONS = {album: '?micro_albums', artist: '?micro_artists', albumArtist: '?micro_album_artists', genre: '?micro_genres', composer: '?micro_composers', year: '?micro_years', folder: '?micro_folders', playlist: '?micro_playlists'};

/**
 * merge_eq_preset_assign (EqPresetsBehavior; F81) inside a dialog: the
 * output devices are hidden (outputs cannot be identified on the web); under
 * "Apply to songs" the playing song (checked when bound to presetId()) and
 * its category. Returns commit(id), which applies the boxes to a preset.
 */
function setupAssign(ctx, dd, presetId) {
  const box = dd.find('eq_presets_assign');
  if (!box) return () => {};
  const keep = new Set(['songs_label', 'per_song_preset_hint', 'song', '__bind_to_track', 'cat', '__bind_to_cat']);
  for (const v of box.children) if (!keep.has(v.id)) v.setVisibility?.(GONE);
  const p = ctx.player, t = p?.track, P = ctx.eqPresets;
  const song = dd.find('__bind_to_track'), cat = dd.find('__bind_to_cat'), catIcon = dd.find('cat');
  if (!t || !ctx.library?.byId?.has(t.id)) {
    for (const id of keep) dd.find(id)?.setVisibility?.(GONE);
    return () => {};
  }
  song?.setText((ctx.res.stringByName('song_s') ?? 'Song: %s').replace('%s', t.title ?? ''));
  song?.setChecked(P.presetForTrack(t.id) === presetId() && presetId() != null);
  const c = p.category, g = c?.source?.groups?.[c.index];
  const kind = g?.pl ? 'playlist' : g?.byArtist ? null : g?.kind;
  const plural = kind ? ctx.res.entry('plurals', CAT_PLURALS[kind]) : null;
  if (!plural) { cat?.setVisibility(GONE); catIcon?.setVisibility(GONE); }
  else {
    cat?.setText(ctx.res.string(plural.one ?? plural.other ?? '', ctx.theme) ?? '');
    cat?.setChecked(false);
    catIcon?.setDrawable?.(ctx.drawables.fromValue(CAT_ICONS[kind], ctx.theme));
  }
  return id => {
    if (!id) return;
    if (song) P.assignTracks(id, [t.id], !!song.state?.checked);
    if (cat?.visibility === VISIBLE && cat.state?.checked) P.assignTracks(id, (c.source.tracksAt(c.index) ?? []).map(x => x.id), true);
    // The bound song plays on with its preset.
    P.onTrack(t);
  };
}

/**
 * Assign Preset (EqPresetAssignActivity, from the preset list's selection):
 * OK applies the boxes, Unassign removes the preset from every song.
 */
export function openAssignPresetDialog(ctx, preset) {
  const P = ctx.eqPresets;
  let commit = () => {};
  const d = openDialog(ctx, {
    style: 'dialog_EqPresetAssignActivity', title: str(ctx, 'assign_preset', 'Assign Preset'),
    buttons: {positive: str(ctx, 'OK', 'OK'), negative: str(ctx, 'cancel', 'Cancel')},
    onButton: which => {
      if (which === 1) commit(preset.id);
      return true;
    },
    setup: dd => {
      commit = setupAssign(ctx, dd, () => preset.id);
      dd.setButton(3, str(ctx, 'unassign', 'Unassign'), () => { P.unassignAll(preset.id); P.onTrack(ctx.player?.track); dd.close(); });
    },
  });
  return d;
}

/** Save Preset: Save stores the EQ under the typed name. */
export function openSavePresetDialog(ctx) {
  const P = ctx.eqPresets;
  let input = null, commit = () => {};
  const d = openDialog(ctx, {
    style: 'dialog_AddEqPresetActivity', title: str(ctx, 'save_preset', 'Save Preset'),
    buttons: {positive: str(ctx, 'save', 'Save'), negative: str(ctx, 'cancel', 'Cancel')},
    onButton: which => {
      if (which !== 1) return true;
      const v = (input?.value ?? '').trim();
      if (!v) return false;
      commit(P.saveAs(v));
      return true;
    },
    setup: dd => { commit = setupAssign(ctx, dd, () => P.data.current); },
  });
  input = d.find('edit_text');
  if (input?.input) {
    input.hint = str(ctx, 'preset', 'Preset');
    input.setValue(P.current?.name ?? '');
    const list = document.createElement('datalist');
    list.id = 'cp-eq-preset-names';
    // Name suggestions: the user and built-in presets (not the 17k AutoEq ones).
    for (const p of [...P.users(), ...P.builtIns()]) { const o = document.createElement('option'); o.value = p.name; list.appendChild(o); }
    document.getElementById(list.id)?.remove();
    document.body.appendChild(list);
    input.input.setAttribute('list', list.id);
    input.input.addEventListener('keydown', e => { if (e.key === 'Enter') d.find('button1')?.onClick?.(); });
    setTimeout(() => { input.input.focus({preventScroll: true}); input.input.select(); }, (ctx.res.integer('?animTime', d.theme) ?? 350) + 30);
  }
  return d;
}

/**
 * Save Reverb Preset (AddReverbPresetActivity, dialog_content_add_reverb_preset):
 * the current preset's name prefilled, existing names suggested.
 */
export function openSaveReverbPresetDialog(ctx) {
  const R = ctx.reverbPresets;
  let input = null;
  const d = openDialog(ctx, {
    style: 'dialog_AddReverbPresetActivity', title: str(ctx, 'save_preset', 'Save Preset'),
    buttons: {positive: str(ctx, 'save', 'Save'), negative: str(ctx, 'cancel', 'Cancel')},
    onButton: which => {
      if (which !== 1) return true;
      const v = (input?.value ?? '').trim();
      if (!v) return false;
      R.saveAs(v);
      return true;
    },
  });
  input = d.find('edit_text');
  if (input?.input) {
    input.hint = str(ctx, 'preset', 'Preset');
    input.setValue(R.current?.id ? R.current.name : '');
    const list = document.createElement('datalist');
    list.id = 'cp-reverb-preset-names';
    for (const p of R.all()) { const o = document.createElement('option'); o.value = p.name; list.appendChild(o); }
    document.getElementById(list.id)?.remove();
    document.body.appendChild(list);
    input.input.setAttribute('list', list.id);
    input.input.addEventListener('keydown', e => { if (e.key === 'Enter') d.find('button1')?.onClick?.(); });
    setTimeout(() => { input.input.focus({preventScroll: true}); input.input.select(); }, (ctx.res.integer('?animTime', d.theme) ?? 350) + 30);
  }
  return d;
}

/** Picks preset files and imports them. */
export function importPresetFiles(ctx) {
  const el = document.createElement('input');
  el.type = 'file';
  el.multiple = true;
  el.accept = '.json,.txt,application/json,text/plain';
  el.addEventListener('change', async () => {
    // qf1.V0: the parametric count, else the graphic one; one preset adds its name.
    const r = await ctx.eqPresets.importFiles([...(el.files ?? [])]);
    const fmt = (key, n) => (ctx.res.stringByName(key) ?? '%d').replace('%d', n);
    let title, line2 = null;
    if (r.parametric) { title = fmt('imported_parametric_presets_d', r.parametric); if (r.parametric === 1) line2 = r.name; }
    else if (r.graphic) { title = fmt('imported_graphic_presets_d', r.graphic); if (r.graphic === 1) line2 = r.name; }
    else { title = fmt('imported_parametric_presets_d', 0); line2 = fmt('imported_graphic_presets_d', 0); }
    ctx.bus.post('bus_gui', 'cmd_gui_show_toast', null, {title, line2});
  });
  el.click();
}

export function installEqPresets(ctx) {
  const P = new EqPresets(ctx);
  new ReverbPresets(ctx);
  // A song with its own preset loads it as it starts (F81).
  ctx.bus.subscribe('bus_player', (msg, src, d) => { if (msg === 'msg_player_track_changed' && !d?.meta) P.onTrack(d?.track ?? ctx.player?.track); });
  P.install(msg => {
    const cur = P.current;
    switch (msg) {
      case 'cmd_data_add_eq_preset_dialog': openSavePresetDialog(ctx); break;
      case 'cmd_data_eq_preset_rename':
        if (cur) editNameDialog(ctx, {title: str(ctx, 'rename', 'Rename'), value: cur.name, onDone: name => P.rename(cur.id, name)});
        break;
      case 'cmd_data_eq_preset_share': P.share([cur ?? {name: str(ctx, 'preset', 'Preset'), params: P.capture()}]); break;
      case 'cmd_data_eq_preset_export': P.exportFile([cur ?? {name: str(ctx, 'preset', 'Preset'), params: P.capture()}]); break;
      case 'cmd_data_eq_preset_import': importPresetFiles(ctx); break;
      case 'cmd_data_add_reverb_preset_dialog': if (ctx.reverbPresets) openSaveReverbPresetDialog(ctx); break;
    }
  });
  return P;
}
