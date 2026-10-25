// List Options (dialog_ListOptsActivity): per list sort (with Reverse),
// "View as" zoom level, Show Titles Only and Compact Header, saved per list.
// The option tables are the reference's (label, value, hint) triples per list
// type; zoom levels map to item scene, columns and item size like the
// reference (pd.P0 for categories and tracks, bk0.P0 for the library home;
// search remaps its levels -3..2 onto -3, -2, -1, 0, 3, 4). Reverse is
// bit 30 of the sort value. The home adds its categories (library_lists,
// library_home), Search its searched categories, the capped lists Max Items
// and Long Files Min Duration (notebook F63). Not reproduced: list memory
// (a playlist's or folder's remembered position and per-track progress).
import {openDialog} from '../widgets/dialog.js';
import {GONE, INVISIBLE, VISIBLE} from '../res/values.js';
import {accelDecel} from '../gesture.js';
import {FastRadioButton} from '../view/text.js';
import {searchMask, setSearchMask, searchOrder, setSearchOrder} from '../widgets/search.js';
import {KEEP_LIST, KEEP_TRACK} from '../library/list-memory.js';

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
  // Track lists offer the category levels (the reference's List Options for All Songs, read in the harness).
  tracks: [T('grid_1_no_aa_extra_small', -4), T('list_1_no_aa_extra_small', -3), T('list_1_no_aa', -2), T('list_no_aa', -1), T('list_compact', 0), T('list_small', 3), T('list', 4), T('grid_extra_small', 1), T('grid_small', 2), T('grid', 5)],
  // Search (jj1): six one-column levels, -3..2, mapped onto the track scenes.
  search: [T('list_1_no_aa_extra_small', -3), T('list_1_no_aa', -2), T('list_no_aa', -1), T('list_compact', 0), T('list_small', 1), T('list', 2)],
};

const SEARCH_ZOOM = {'-3': -3, '-2': -2, '-1': -1, 0: 0, 1: 3, 2: 4};

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
  const z = kind === 'search' ? SEARCH_ZOOM[level] ?? 0 : level;
  const one = titlesOnly;
  return {...levelGeometry(d, z, one), scene1: ONE_LINE_SCENE[z] ?? 'scene_1_small'};
}

// pd.P0's d: the level's one-line scene, which rows without a second line
// take (z62.W: line 2 empty marks the row with xc.i).
const ONE_LINE_SCENE = {'-4': 'scene_1_small_no_aa', '-3': 'scene_1_small_no_aa', '-2': 'scene_1_small_no_aa', '-1': 'scene_1_small_no_aa', 0: 'scene_1_small', 1: 'scene_grid_1', 2: 'scene_grid_1', 3: 'scene_1', 4: 'scene_1_zoomed', 5: 'scene_grid_1_zoomed'};

// Lists whose adapters always take the one-line scenes (kc: o9 for artists,
// album artists, composers and genres; d61 for playlists).
const ONE_LINE_LISTS = new Set(['cat:artists', 'cat:albumArtists', 'cat:composers', 'cat:genres', 'cat:playlists']);

// kc.P0: artist, album artist and composer categories (gh1) show their grids
// with the alt one-line scenes and the human grid's extra space.
const ALT_GRID_LISTS = new Set(['cat:artists', 'cat:albumArtists', 'cat:composers']);
function altGrid(sub, z) {
  if (z === 1 || z === 2) return {scene: 'scene_grid_1_alt', scene1: 'scene_grid_1_alt', gridExtra: sub.dim('humanGridItemExtraSpace', 0)};
  if (z === 5) return {scene: 'scene_grid_1_alt_zoomed', scene1: 'scene_grid_1_alt_zoomed', gridExtra: sub.dim('humanGridZoomedItemExtraSpace', 0)};
  return null;
}

function levelGeometry(d, z, one) {
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

/**
 * The reference's zoom level of a list on a fresh install (m30 list_zoom_*,
 * read in the reference harness): track lists 3 (our level 1), except years
 * and bookmarks 0; album, folder and playlist grids 5; artist, genre and
 * composer lists 4; years 0.
 */
const DEFAULT_GROUP_ZOOM = {folders: 5, folders_hier: 3, albums: 5, albums_by_artist: 5, albumArtists: 5, playlists: 5, artists: 4, genres: 4, composers: 4, years: 0};
export function defaultZoom(kind, key) {
  const [scope, name] = key.split(':');
  if (kind === 'search') return 1;
  if (kind === 'tracks') return name === 'year' || name === 'bookmarks' ? 0 : 3;
  if (scope === 'cat') return DEFAULT_GROUP_ZOOM[name] ?? 0;
  if (scope === 'sub') return name === 'year' ? 0 : 5;
  return 0;
}

/** Applies a list's saved zoom to a source (scene, columns, item size). */
export function applyZoom(src, sub, kind, key, defaultLevel = null) {
  const o = listOpts(key);
  src.optsKey = key;
  src.zoomKind = kind;
  // Track list zooms saved before they took the category levels (zv 2) used the search levels.
  const saved = o.zoom !== undefined && kind === 'tracks' && o.zv !== 2 ? SEARCH_ZOOM[o.zoom] : o.zoom;
  src.zoomLevel = saved ?? defaultLevel ?? defaultZoom(kind, key);
  src.titlesOnly = !!o.titlesOnly;
  src.compactHeader = !!o.compactHeader;
  let g = zoomGeometry(sub, kind, src.zoomLevel, src.titlesOnly || ONE_LINE_LISTS.has(key));
  if (kind !== 'search' && ALT_GRID_LISTS.has(key)) g = {...g, ...altGrid(sub, src.zoomLevel)};
  src.itemScene = g.scene;
  src.itemScene1 = g.scene1 ?? null;
  src.columns = g.columns;
  src.itemHeight = g.itemHeight;
  src.gridExtra = g.gridExtra ?? 0;
  src.aaRatio = sub.fraction?.('aaItemRatio', 1) ?? 1;
}

const str = (ctx, k) => ctx.res.stringByName(k) ?? k;

/**
 * A hint under an option (ListOptsActivity.y): ?Hint text indented to the
 * option's text, 4dp below it.
 */
function addHint(ctx, group, button, text, index = -1) {
  const sa = ctx.inflater.styledAttributes({style: '?Hint', 'android:layout_width': 'fill_parent', 'android:layout_height': 'wrap_content', 'layout_consumeSpace': 'vertical'});
  const v = ctx.inflater.create('TextView', sa, null);
  v._attrs = sa;
  v.setText(str(ctx, text));
  v.lp = group.generateLayoutParams(sa);
  v.lp.leftMargin = button.textPaddings?.()[0] ?? 0;
  v.lp.bottomMargin = Math.round(4 * ctx.dpr);
  if (index < 0) group.addView(v); else group.addView(v, index);
  return v;
}

/** Radio buttons already in a layout (Max Items): one checked at a time. */
function radioGroup(group, onPick) {
  const radios = group.children.filter(c => c instanceof FastRadioButton);
  for (const r of radios) {
    r.onCheckedChanged = on => {
      if (!on) return;
      for (const x of radios) if (x !== r) x.setChecked(false);
      onPick(r);
    };
  }
  return radios;
}

/**
 * The library home's categories (gi1 order): a check box per category for
 * the home list (library_lists bits) and a star before it for the category
 * the library opens at (library_home). A long press on either makes that
 * category the start one, or clears it when it is already; unchecking the
 * start category clears it too. The stars fade over 250 ms.
 */
function libraryCategories(ctx, layout, categories, onChange) {
  const stars = [];
  const home = () => +(ctx.pref('library_home') ?? -1);
  const toggleHome = star => {
    const id = star.category.id;
    const was = home() === id;
    ctx.settingsUi?.setPref('library_home', String(was ? -1 : id), {recreate: false});
    if (was) onChange();
    ctx.tween(star, {alpha: was ? 0.1 : 1}, 0.25, accelDecel);
    for (const s of stars) if (s !== star) ctx.tween(s, {alpha: 0.1}, 0.25, accelDecel);
  };
  for (const c of categories) {
    const ssa = ctx.inflater.styledAttributes({style: '@style/SettingsListOptsCheckboxLibrary_Home'});
    const star = ctx.inflater.create('com.maxmpz.widget.base.FastButton', ssa, null);
    star._attrs = ssa;
    star.lp = layout.generateLayoutParams(ssa);
    star.alpha = home() === c.id ? 1 : 0.1;
    star.category = c;
    star.longClickable = true;
    stars.push(star);
    layout.addView(star);
    const csa = ctx.inflater.styledAttributes({style: '@style/SettingsListOptsCheckboxLibrary'});
    const cb = ctx.inflater.create('CheckBox', csa, null);
    cb._attrs = csa;
    cb.lp = layout.generateLayoutParams(csa);
    cb.setText(str(ctx, c.title));
    const mask = () => +(ctx.pref('library_lists') ?? 0);
    cb.setChecked((mask() & (1 << c.id)) !== 0);
    cb.onCheckedChanged = on => {
      const m = on ? mask() | (1 << c.id) : mask() & ~(1 << c.id);
      if (!on && home() === c.id) toggleHome(star);
      ctx.settingsUi?.setPref('library_lists', String(m), {recreate: false});
      onChange();
    };
    const check = () => { if (!cb.isChecked) { cb.setChecked(true); cb.onCheckedChanged(true); } };
    star.onLongClick = () => { toggleHome(star); check(); return true; };
    cb.longClickable = true;
    cb.onLongClick = () => { toggleHome(star); check(); return true; };
    layout.addView(cb);
    if (c.hint) addHint(ctx, layout, cb, c.hint);
  }
  layout.setVisibility(VISIBLE);
}

/**
 * The search categories (search_layout): a check box per searched category,
 * in the chosen order, each with a drag handle (the list's list_drag icon) on
 * its left. Dragging a handle moves its category; the chips and the result
 * sections follow (searchOrder). The reference's order is fixed.
 */
function searchCategories(ctx, layout, cats) {
  const mask = () => searchMask();
  const rows = cats.map((c, i) => {
    const hsa = ctx.inflater.styledAttributes({style: '@style/SettingsListOptsCheckboxLibrary_Home', 'android:drawable': '@drawable/list_drag'});
    const handle = ctx.inflater.create('com.maxmpz.widget.base.FastButton', hsa, null);
    handle._attrs = hsa;
    handle.lp = layout.generateLayoutParams(hsa);
    handle.el?.setAttribute('aria-label', 'Move ' + str(ctx, c.title));
    const sa = ctx.inflater.styledAttributes({'android:layout_width': 'fill_parent', 'android:layout_height': 'wrap_content', 'layout_consumeSpace': 'vertical|reset_horizontal'});
    const cb = ctx.inflater.create('CheckBox', sa, null);
    cb._attrs = sa;
    cb.lp = layout.generateLayoutParams(sa);
    cb.setText(str(ctx, c.title));
    cb.setChecked((mask() & (1 << i)) !== 0);
    cb.onCheckedChanged = on => setSearchMask(ctx, on ? mask() | (1 << i) : mask() & ~(1 << i));
    return {i, handle, cb};
  });
  let order = searchOrder();
  const place = () => {
    for (const r of rows) { layout.removeView(r.handle); layout.removeView(r.cb); }
    for (const i of order) { layout.addView(rows[i].handle); layout.addView(rows[i].cb); }
    layout.requestLayout();
  };
  place();
  // A drag moves the row with the finger; past half a row it changes places.
  for (const r of rows) {
    const {handle, cb} = r;
    handle.performClick = () => false;
    handle.onPointerDown = e => { r.drag = {y: e.rootY, dy: 0}; handle.setPressed(true); return true; };
    handle.onPointerMove = e => {
      const d = r.drag;
      if (!d) return;
      d.dy += e.rootY - d.y;
      d.y = e.rootY;
      const h = cb.height || 1, at = order.indexOf(r.i);
      const to = d.dy > h / 2 && at < order.length - 1 ? at + 1 : d.dy < -h / 2 && at > 0 ? at - 1 : at;
      if (to !== at) {
        order = order.slice();
        order.splice(at, 1);
        order.splice(to, 0, r.i);
        d.dy -= (to - at) * h;
        place();
      }
      handle.translationY = cb.translationY = d.dy;
      handle.invalidate?.();
      cb.invalidate?.();
    };
    handle.onPointerUp = () => {
      if (!r.drag) return;
      r.drag = null;
      handle.setPressed(false);
      handle.translationY = cb.translationY = 0;
      layout.requestLayout();
      if (order.join() !== searchOrder().join()) setSearchOrder(ctx, order);
    };
    handle.onPointerCancel = () => handle.onPointerUp();
  }
  layout.setVisibility(VISIBLE);
}

/** m:ss or h:mm:ss for a duration in ms (Utils.A, rounded to seconds). */
export function formatDuration(ms) {
  const t = Math.floor((ms + 500) / 1000), s = t % 60;
  if (t < 3600) return `${Math.floor(t / 60)}:${String(s).padStart(2, '0')}`;
  return `${Math.floor(t / 3600)}:${String(Math.floor(t / 60) % 60).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** The levels where rows are one line already: Show Titles Only is off there (ie.mo2079). */
const ONE_LINE_ZOOMS = new Set([-2, -3, -4]);

/**
 * Opens List Options for a source; onChange() re-creates the list with the
 * new options. With fromSettings (the library_list_opts / list_opts
 * preferences, arg1 1) the settings gear is hidden.
 */
export function openListOptions(ctx, src, onChange, {fromSettings = false, onClosed = null} = {}) {
  if (!src?.optsKey) return null;
  const key = src.optsKey;
  const sorts = src.sortKind ? SORTS[src.sortKind] : null;
  const zooms = ZOOMS[src.zoomKind];
  const title = (str(ctx, 'list_opts_s') ?? '%s').replace('%s', src.title || str(ctx, 'library'));
  const change = patch => { saveListOpts(key, patch); onChange?.(); };
  const d = openDialog(ctx, {
    style: 'dialog_ListOptsActivity', title, onClosed,
    buttons: {positive: str(ctx, 'close')},
    setup: d => {
      const gear = d.find('button');
      if (fromSettings) gear?.setVisibility(INVISIBLE);
      else if (gear) gear.onClick = () => { d.cancel(); ctx.settingsUi?.open('library'); };
      if (src.homeCategories) libraryCategories(ctx, d.find('library_layout'), src.homeCategories, () => onChange?.());
      if (src.searchCategories) searchCategories(ctx, d.find('search_layout'), src.searchCategories);
      // List Memory (ListOptsActivity over jh1: a folder's or playlist's
      // songs; F46): List Position (keep_list_pos) and Per Track Progress
      // (keep_track_pos), set as the user ticks them (cmd_data_set_list_meta).
      if (src.memoryKey && ctx.listMemory) {
        const g = d.find('list_memory_layout');
        g?.setVisibility(VISIBLE);
        const bits = ctx.listMemory.flags(src.memoryKey);
        for (const [id, bit] of [['list_pos', KEEP_LIST], ['per_track_progress', KEEP_TRACK]]) {
          const cb = g?.findViewById(id);
          if (!cb) continue;
          cb.setChecked((bits & bit) !== 0);
          cb.onCheckedChanged = on => { ctx.listMemory.setFlag(src.memoryKey, bit, on); onChange?.(); };
        }
      }
      // Max Items (ih1): 200 / 500 / 1000 / no limit.
      if (src.limitable) {
        const g = d.find('limit_group');
        g.setVisibility(VISIBLE);
        const cur = src.limit;
        for (const r of radioGroup(g, r => change({limit: parseInt(String(r.tag).replace(/^\\?\s*/, ''), 10)}))) {
          r.setChecked(parseInt(String(r.tag).replace(/^\\?\s*/, ''), 10) === cur);
        }
      }
      // Min Duration (hi1, Long Files): 2..120 minutes; saved when the drag ends.
      if (src.minDurationMs !== undefined) {
        const g = d.find('duration_group');
        g.setVisibility(VISIBLE);
        const time = g.findViewById('time'), bar = g.findViewById('seekbar');
        time?.setText(formatDuration(src.minDurationMs));
        if (bar) {
          bar.setMax(119);
          bar.setProgress(Math.max(1, Math.floor(src.minDurationMs / 60000) - 1));
          bar.onProgressChanged = (p, user) => { if (user) time?.setText(formatDuration((p + 1) * 60000)); };
          bar.onStopTrackingTouch = () => change({minDurationMs: (bar.progress + 1) * 60000});
        }
      }
      if (sorts) {
        const g = d.find('sort_group');
        g.setVisibility(VISIBLE);
        const cur = src.sortValue ?? 0;
        const made = radios(ctx, g, sorts, cur & ~REVERSE, v => change({sort: v | ((listOpts(key).sort ?? src.sortValue ?? 0) & REVERSE)}), '@style/ListOptsRadioButton', {'android:layout_width': 'fill_parent', 'android:layout_height': 'wrap_content', 'layout_consumeSpace': 'vertical'});
        // The sort radios take code-made params (r40(-1, -2)): no style margins.
        for (const r of made) r.lp.bottomMargin = 0;
        sorts.forEach((o, i) => { if (o.hint) addHint(ctx, g, made[i], o.hint, g.children.indexOf(made[i]) + 1); });
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
        const lg = d.find('layout_group');
        const titles = d.find('show_titles_only'), compact = d.find('compact_header');
        let shown = 0;
        // Show Titles Only: categories and track lists (not the home); off
        // at the one-line levels.
        if (src.zoomKind !== 'home' && titles) {
          shown++;
          titles.setChecked(!!src.titlesOnly);
          titles.setEnabled(!ONE_LINE_ZOOMS.has(src.zoomLevel));
          titles.onCheckedChanged = on => change({titlesOnly: on});
        } else titles?.setVisibility(GONE);
        // Compact Header (xh1): an entry's track list.
        if (src.compactable && compact) {
          shown++;
          compact.setChecked(!!src.compactHeader);
          compact.onCheckedChanged = on => change({compactHeader: on});
        } else compact?.setVisibility(GONE);
        if (shown) lg.setVisibility(VISIBLE);
        radios(ctx, g, zooms, src.zoomLevel, v => { change({zoom: v, zv: 2}); titles?.setEnabled(!ONE_LINE_ZOOMS.has(v)); }, '@style/ListOptsRadioButton50');
      }
    },
  });
  return d;
}

/** Radio buttons for option triples, one checked at a time. */
function radios(ctx, group, options, current, onPick, style, extra = {}) {
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
}
