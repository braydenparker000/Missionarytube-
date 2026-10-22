// List Options (dialog_ListOptsActivity): per list sort (with Reverse),
// "View as" zoom level and Show Titles Only, saved per list. The option
// tables are the reference's (label, value, hint) triples per list type;
// zoom levels map to item scene, columns and item size like the reference
// (pd.P0 for categories and tracks, bk0.P0 for the library home; track lists
// remap their levels -3..2 onto -3, -2, -1, 0, 3, 4). Reverse is bit 30 of
// the sort value. Not reproduced: Max Items / Min Duration (not offered by
// these lists), list memory and the compact header option.
import {openDialog} from '../widgets/dialog.js';
import {GONE, VISIBLE} from '../res/values.js';

const STORE = 'cp-list-opts';
export const REVERSE = 0x40000000;

const T = (label, value, hint = null) => ({label, value, hint});

/** Sort options per list type (string names; hints for the reference's notes). */
export const SORTS = {
  tracks: [T('by_track', 0), T('by_disc_and_track', 13), T('by_title', 1), T('by_filename', 2), T('by_path', 14), T('by_artist', 8), T('by_album', 9), T('by_year', 3), T('by_year_album', 15), T('by_date_added_to_lib', 12), T('by_date_added_modified', 4, 'fs_date_time'), T('by_rating', 5), T('by_duration', 10), T('by_played_at', 7, 'play_time_not_updated'), T('by_play_count', 6, 'play_count_not_updated'), T('by_shuffle', 11, 'matches_actual_shuffle_order')],
  albums: [T('by_name', 0), T('by_artist', 3), T('by_year', 1), T('by_date_added_to_lib', 2), T('by_num_tracks', 4)],
  albumArtists: [T('by_name', 0), T('by_album_artist', 3), T('by_year', 1), T('by_date_added_to_lib', 2), T('by_num_tracks', 4)],
  names: [T('by_name', 0), T('by_date_added_to_lib', 1), T('by_num_tracks', 2)],
  folders: [T('by_name', 0), T('by_path_cs', 1), T('by_path', 5), T('by_date_added_to_lib', 2), T('by_date_added_modified', 3, 'fs_date_time'), T('by_num_tracks', 4)],
  playlists: [T('by_name', 0), T('by_date_added_to_lib', 1), T('by_date_added_modified', 3), T('by_num_tracks', 2)],
  years: [T('by_year', 0), T('by_date_added_to_lib', 1), T('by_num_tracks', 2)],
};

/** "View as" levels per list kind. */
export const ZOOMS = {
  home: [T('grid_small', -1), T('grid', 0), T('list_compact', 2), T('list', 1)],
  groups: [T('grid_1_no_aa_extra_small', -4), T('list_1_no_aa_extra_small', -3), T('list_1_no_aa', -2), T('list_no_aa', -1), T('list_compact', 0), T('list_small', 3), T('list', 4), T('grid_extra_small', 1), T('grid_small', 2), T('grid', 5)],
  tracks: [T('list_1_no_aa_extra_small', -3), T('list_1_no_aa', -2), T('list_no_aa', -1), T('list_compact', 0), T('list_small', 1), T('list', 2)],
};

const TRACK_ZOOM = {'-3': -3, '-2': -2, '-1': -1, 0: 0, 1: 3, 2: 4};

function load() {
  try { return JSON.parse(localStorage.getItem(STORE) ?? '{}') ?? {}; } catch { return {}; }
}

/** The saved options for a list key: {sort, zoom, titlesOnly}. */
export function listOpts(key) {
  return load()[key] ?? {};
}

export function saveListOpts(key, patch) {
  const all = load();
  all[key] = {...(all[key] ?? {}), ...patch};
  try { localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* storage unavailable */ }
}

/**
 * Item geometry for a zoom level: {scene, columns, itemHeight, gridExtra}
 * (itemHeight -1: grid cells are square art plus gridExtra).
 */
export function zoomGeometry(sub, kind, level, titlesOnly = false) {
  const d = name => sub.dim(name, 0);
  if (kind === 'home') {
    if (level === -1) return {scene: 'scene_grid', columns: 2, itemHeight: d('compactTextItemSize')};
    if (level === 0) return {scene: 'scene_grid', columns: 2, itemHeight: d('textItemSize')};
    if (level === 2) return {scene: 'defaultScene', columns: 1, itemHeight: d('compactTextItemSize')};
    return {scene: 'defaultScene', columns: 1, itemHeight: d('textItemSize')};
  }
  const z = kind === 'tracks' ? TRACK_ZOOM[level] ?? 0 : level;
  const one = titlesOnly;
  switch (z) {
    case -4: return {scene: 'scene_1_small_no_aa', columns: 2, itemHeight: d('itemSize1SmallNoAAExtraSmall')};
    case -3: return {scene: 'scene_1_small_no_aa', columns: 1, itemHeight: d('itemSize1SmallNoAAExtraSmall')};
    case -2: return {scene: 'scene_1_small_no_aa', columns: 1, itemHeight: d('itemSize1SmallNoAA')};
    case -1: return {scene: one ? 'scene_1_small_no_aa' : 'scene_small_no_aa', columns: 1, itemHeight: d('itemSizeSmallNoAA')};
    case 1: return {scene: one ? 'scene_grid_1' : 'scene_grid', columns: 4, itemHeight: -1, gridExtra: d(one ? 'gridItem1LineExtraSpace' : 'gridItemExtraSpace')};
    case 2: return {scene: one ? 'scene_grid_1' : 'scene_grid', columns: 3, itemHeight: -1, gridExtra: d(one ? 'gridItem1LineExtraSpace' : 'gridItemExtraSpace')};
    case 3: return {scene: one ? 'scene_1' : 'defaultScene', columns: 1, itemHeight: d('itemSize')};
    case 4: return {scene: one ? 'scene_1_zoomed' : 'scene_zoomed', columns: 1, itemHeight: d('itemSizeZoomed')};
    case 5: return {scene: one ? 'scene_grid_1_zoomed' : 'scene_grid_zoomed', columns: 2, itemHeight: -1, gridExtra: d(one ? 'gridZoomedItem1LineExtraSpace' : 'gridZoomedItemExtraSpace')};
    default: return {scene: one ? 'scene_1_small' : 'scene_small', columns: 1, itemHeight: d('itemSizeSmall')};
  }
}

/** Applies a list's saved zoom to a source (scene, columns, item size). */
export function applyZoom(src, sub, kind, key, defaultLevel = 0) {
  const o = listOpts(key);
  src.optsKey = key;
  src.zoomKind = kind;
  src.zoomLevel = o.zoom ?? defaultLevel;
  src.titlesOnly = !!o.titlesOnly;
  const g = zoomGeometry(sub, kind, src.zoomLevel, src.titlesOnly);
  src.itemScene = g.scene;
  src.columns = g.columns;
  src.itemHeight = g.itemHeight;
  src.gridExtra = g.gridExtra ?? 0;
  src.aaRatio = sub.fraction?.('aaItemRatio', 1) ?? 1;
}

const str = (ctx, k) => ctx.res.stringByName(k) ?? k;

/**
 * Opens List Options for the shown source; onChange() re-creates the list
 * with the new options.
 */
export function openListOptions(ctx, src, onChange) {
  if (!src?.optsKey) return null;
  const key = src.optsKey;
  const sorts = src.sortKind ? SORTS[src.sortKind] : null;
  const zooms = ZOOMS[src.zoomKind];
  const title = (str(ctx, 'list_opts_s') ?? '%s').replace('%s', src.title || str(ctx, 'library'));
  const change = patch => { saveListOpts(key, patch); onChange?.(); };
  return openDialog(ctx, {
    style: 'dialog_ListOptsActivity', title,
    buttons: {positive: str(ctx, 'close')},
    setup: d => {
      d.find('button')?.setVisibility(GONE); // settings gear: no per-list settings page here
      const radios = (group, options, current, onPick, style, extra = {}) => {
        const made = [];
        for (const o of options) {
          const sa = ctx.inflater.styledAttributes({style, ...extra});
          const r = ctx.inflater.create('RadioButton', sa, null);
          r._attrs = sa;
          r.setText(str(ctx, o.label));
          r.setChecked(o.value === current);
          r.lp = group.generateLayoutParams(sa);
          r.onCheckedChanged = on => {
            if (!on) return;
            for (const x of made) if (x !== r) x.setChecked(false);
            onPick(o.value);
          };
          group.addView(r);
          made.push(r);
        }
        return made;
      };
      if (sorts) {
        const g = d.find('sort_group');
        g.setVisibility(VISIBLE);
        const cur = src.sortValue ?? 0;
        radios(g, sorts, cur & ~REVERSE, v => change({sort: v | ((listOpts(key).sort ?? src.sortValue ?? 0) & REVERSE)}), '@style/ListOptsRadioButton', {'android:layout_width': 'fill_parent', 'android:layout_height': 'wrap_content', 'layout_consumeSpace': 'vertical'});
        const sa = ctx.inflater.styledAttributes({});
        const rev = ctx.inflater.create('CheckBox', sa, null);
        rev._attrs = sa;
        rev.setText(str(ctx, 'reverse'));
        rev.setChecked((cur & REVERSE) !== 0);
        rev.lp = g.generateLayoutParams(ctx.inflater.styledAttributes({'android:layout_width': 'fill_parent', 'android:layout_height': 'wrap_content', 'layout_consumeSpace': 'vertical'}));
        rev.onCheckedChanged = on => change({sort: ((listOpts(key).sort ?? src.sortValue ?? 0) & ~REVERSE) | (on ? REVERSE : 0)});
        g.addView(rev);
      }
      if (zooms) {
        const g = d.find('zoom_group');
        g.setVisibility(VISIBLE);
        radios(g, zooms, src.zoomLevel, v => change({zoom: v}), '@style/ListOptsRadioButton50');
        // Show Titles Only: categories and track lists (not the home).
        const lg = d.find('layout_group');
        const titles = d.find('show_titles_only');
        d.find('compact_header')?.setVisibility(GONE);
        if (src.zoomKind !== 'home' && titles) {
          lg.setVisibility(VISIBLE);
          titles.setChecked(!!src.titlesOnly);
          titles.onCheckedChanged = on => change({titlesOnly: on});
        }
      }
    },
  });
}
