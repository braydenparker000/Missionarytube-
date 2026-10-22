// The EQ menu's preset commands (merge_eq_menu_layout; notebook F67):
// Save/Assign (AddEqPresetActivity: the name prefilled with the current
// preset's, existing names suggested), Rename, Share, Export, Import.
import {openDialog, editNameDialog} from './dialog.js';
import {GONE} from '../res/values.js';
import {EqPresets} from '../dsp/eq-presets.js';
import {ReverbPresets} from '../dsp/reverb-presets.js';

const str = (ctx, k, f = k) => ctx.res.stringByName(k) ?? f;

/** Save Preset: Save stores the EQ under the typed name. */
export function openSavePresetDialog(ctx) {
  const P = ctx.eqPresets;
  let input = null;
  const d = openDialog(ctx, {
    style: 'dialog_AddEqPresetActivity', title: str(ctx, 'save_preset', 'Save Preset'),
    buttons: {positive: str(ctx, 'save', 'Save'), negative: str(ctx, 'cancel', 'Cancel')},
    onButton: which => {
      if (which !== 1) return true;
      const v = (input?.value ?? '').trim();
      if (!v) return false;
      P.saveAs(v);
      return true;
    },
    setup: dd => {
      // Device and song assignment are not built (no output devices here).
      dd.find('eq_presets_assign')?.setVisibility(GONE);
    },
  });
  input = d.find('edit_text');
  if (input?.input) {
    input.hint = str(ctx, 'preset', 'Preset');
    input.setValue(P.current?.name ?? '');
    const list = document.createElement('datalist');
    list.id = 'cp-eq-preset-names';
    for (const p of P.all()) { const o = document.createElement('option'); o.value = p.name; list.appendChild(o); }
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
  el.accept = '.json,application/json';
  el.addEventListener('change', async () => {
    const n = await ctx.eqPresets.importFiles([...(el.files ?? [])]);
    if (n) ctx.bus.post('bus_gui', 'cmd_gui_show_toast', null, {title: `${str(ctx, 'pref_import', 'Import')}: ${n}`});
  });
  el.click();
}

export function installEqPresets(ctx) {
  const P = new EqPresets(ctx);
  new ReverbPresets(ctx);
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
