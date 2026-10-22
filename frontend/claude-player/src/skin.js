// Built-in skin model and theme composition (xml/poweramp_builtin_skins).
// A skin is a base style plus ordered options; each selected option applies an
// overlapStyle, or resolves an overlapAttr in the theme composed so far.
import {Theme} from './res/resources.js';
import {parseRef} from './res/values.js';

const OPTION_TAGS = new Set(['option', 'radio', 'multiSwitch', 'popup', 'seekbarOptions', 'msg']);

function styleRefName(v) {
  const r = parseRef(v);
  return r && r.kind === 'res' && r.type === 'style' ? r.name : null;
}

function attrRefName(v) {
  const r = parseRef(v);
  if (r && r.kind === 'res' && r.type === 'attr') return r.name;
  if (r && r.kind === 'attr') return r.name;
  return null;
}

/** Parses the skins XML tree into plain skin descriptors. */
export function parseSkins(res) {
  const tree = res.entry('xml', 'poweramp_builtin_skins');
  if (!tree) return [];
  const skins = [];
  for (const node of tree[2] ?? []) {
    if (!Array.isArray(node) || node[0] !== 'skin') continue;
    const a = node[1] || {};
    const skin = {
      name: res.string(a.name) ?? 'Skin',
      style: styleRefName(a.style),
      darkMode: styleRefName(a.darkMode),
      lightMode: styleRefName(a.lightMode),
      description: a.description ? res.string(a.description) : '',
      options: [],
      globalOptions: [],
    };
    for (const o of node[2] ?? []) {
      if (!Array.isArray(o)) continue;
      const oa = o[1] || {};
      if (o[0] === 'globalOption') {
        skin.globalOptions.push({option: attrRefName(oa.option), overlapAttr: attrRefName(oa.overlapAttr)});
        continue;
      }
      if (!OPTION_TAGS.has(o[0])) continue;
      const opt = {
        kind: o[0], key: oa.key, name: oa.name ? res.string(oa.name) : oa.key,
        summary: oa.summary ? res.string(oa.summary) : '',
        dependency: oa.dependency ?? null,
        minSdk: oa.minSdk ? parseInt(oa.minSdk) : 0, maxSdk: oa.maxSdk ? parseInt(oa.maxSdk) : 0,
        defaultValue: oa.defaultValue ?? null,
        checkedByDefault: oa.checkedByDefault === 'true',
        // msg: a note (line1, then its smaller lines) under the option before it.
        lines: o[0] === 'msg' ? [oa.line1, oa.smallLine1, oa.smallLine2, oa.smallLine3].filter(Boolean).map(r => res.string(r) ?? '') : null,
        overlapStyle: oa.overlapStyle ? styleRefName(oa.overlapStyle) : null,
        overlapAttr: oa.overlapAttr ? attrRefName(oa.overlapAttr) : null,
        choices: [],
      };
      if (o[0] !== 'option') {
        for (const c of o[2] ?? []) {
          if (!Array.isArray(c) || c[0] !== 'option') continue;
          const ca = c[1] || {};
          opt.choices.push({
            name: ca.name ? res.string(ca.name) : '',
            summary: ca.summary ? res.string(ca.summary) : '',
            overlapStyle: ca.overlapStyle ? styleRefName(ca.overlapStyle) : null,
            overlapAttr: ca.overlapAttr ? attrRefName(ca.overlapAttr) : null,
            rawStyle: ca.overlapStyle ?? null,
            rawAttr: ca.overlapAttr ?? null,
            icon: ca.icon ?? null,
          });
        }
      }
      skin.options.push(opt);
    }
    skins.push(skin);
  }
  return skins;
}

/** Index of the default choice: the one whose overlap matches defaultValue, else 0. */
export function defaultChoice(opt) {
  if (opt.defaultValue === null || opt.defaultValue === undefined) return 0;
  const i = opt.choices.findIndex(c => (c.rawStyle ?? '') === opt.defaultValue || (c.rawAttr ?? '') === opt.defaultValue);
  return i >= 0 ? i : 0;
}

/** Current value of an option: boolean for switches, choice index for the others. */
export function optionValue(opt, prefs) {
  const v = prefs?.[opt.key];
  if (opt.kind === 'option') return v === undefined ? opt.checkedByDefault : !!v;
  if (v === undefined || v === null || v < 0 || v >= opt.choices.length) return defaultChoice(opt);
  return v;
}

export function optionEnabled(opt, skin, prefs, sdk) {
  if (opt.minSdk && sdk < opt.minSdk) return false;
  if (opt.maxSdk && sdk > opt.maxSdk) return false;
  if (opt.dependency) {
    const dep = skin.options.find(o => o.key === opt.dependency);
    if (dep) {
      const dv = optionValue(dep, prefs);
      if (dv === false || dv === 0) return false;
    }
  }
  return true;
}

// Global settings that restyle the UI through theme overlays (applied before
// and after the skin options, as the reference's theme manager does).
function applyGlobalOptions(theme, settings, map, force, applied) {
  const apply = (attr, f = true) => {
    const name = theme.styleName('?' + map(attr));
    if (name) {
      theme.applyStyle(name, f);
      applied.push(name);
    }
  };
  const rating = settings.rating_type ?? 1;
  if (rating === 0) apply('OptionRatingDisabled', force);
  else if (rating === 2) apply('OptionRatingStars', force);
  else if (rating === 3) apply('OptionRatingStarsMenu', force);
  else apply('OptionRatingLikeUnlike', force);
  if (settings.hide_menu) apply('OptionHideMenu');
  if ((settings.main_lyrics_button ?? 1) === 0) apply('OptionHideLyricsButton');
  const aspect = settings.aa_aspect ?? 1;
  if (aspect === 1) apply('OptionAAKeepAspect');
  else if (aspect === 2) apply('OptionAACrop');
  const cc = settings.cc_button ?? 1;
  apply(cc === 0 ? 'OptionCCDisabled' : cc === 2 ? 'OptionCCInMenu' : cc === 3 ? 'OptionCCMainUIAndInMenu' : cc === 4 ? 'OptionCCMainUIButton' : 'OptionCCMainUI');
  if (settings.headers_meta ?? true) apply('OptionHeaderMeta', force);
  if ((settings.vis_frs_type ?? 2) === 2) apply('OptionEquFRSRounded');
  if ((settings.list_header_buttons ?? 1) === 0) apply('OptionNoHeaderButtons');
  if (settings.localized_az) apply('OptionLocalizedAZScroll');
  if ((settings.anim_long_labels ?? true) && (settings.anim_long_labels_in_lists ?? true)) apply('OptionAnimLongLabelsInLists');
}

/**
 * Composes the theme for a skin, its option values and global settings:
 * skin style, global options, skin options, skin-mapped global options, then
 * (activity level) rounded screen corners and the powerui default styles.
 */
export function composeTheme(res, skin, prefs = {}, {sdk = 35, settings = {}, roundedScreenCorners = true} = {}) {
  const theme = new Theme(res);
  if (skin.style) theme.applyStyle(skin.style);
  const applied = [skin.style];
  applyGlobalOptions(theme, settings, a => a, true, applied);
  const applyOverlap = (style, attr) => {
    let name = style;
    if (!name && attr) name = theme.styleName('?' + attr);
    if (name) {
      theme.applyStyle(name);
      applied.push(name);
    }
  };
  for (const opt of skin.options) {
    if (opt.kind === 'msg' || !optionEnabled(opt, skin, prefs, sdk)) continue;
    if (opt.kind === 'option') {
      if (optionValue(opt, prefs)) applyOverlap(opt.overlapStyle, opt.overlapAttr);
    } else {
      const c = opt.choices[optionValue(opt, prefs)];
      if (c) applyOverlap(c.overlapStyle, c.overlapAttr);
    }
  }
  if (skin.globalOptions.length) {
    const map = new Map(skin.globalOptions.map(g => [g.option, g.overlapAttr]));
    applyGlobalOptions(theme, settings, a => map.get(a) ?? '__none__', true, applied);
  }
  if (roundedScreenCorners && sdk >= 31) {
    const rc = theme.styleName('?OptionRoundedScreenCorners');
    if (rc) {
      theme.applyStyle(rc, true);
      applied.push(rc);
    }
  }
  for (const attr of ['TopPoweruiStyles', 'BasePoweruiStyles']) {
    const name = theme.styleName('?' + attr);
    if (name) {
      theme.applyStyle(name, false);
      applied.push(name + '(defaults)');
    }
  }
  return {theme, applied};
}
