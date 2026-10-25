// Library list sources: the library home (category tiles) and category /
// track lists, with the reference's zoom-level geometry (pd.P0 / bk0.P0):
//   home, default (zoom 1): one column of textItemSize rows, scene_top_header header;
//   zoom 0: scene_grid, 2 columns
//   tracks/categories, zoom 0: scene_small, 1 column, itemSizeSmall rows
// Home categories follow the reference order and default visibility mask
// (library_lists = 1048511: all but "Albums by Artist").

const HOME = [
  {id: 0, title: 'all_songs', icon: '?all_songs', kind: 'all'},
  {id: 1, title: 'folders', icon: '?folders', kind: 'folders'},
  {id: 2, title: 'folders_hier', icon: '?folders_hier', kind: 'folders'},
  {id: 3, title: 'albums', icon: '?albums', kind: 'albums'},
  {id: 4, title: 'artists', icon: '?artists', kind: 'artists'},
  {id: 5, title: 'album_artists', icon: '?album_artists', kind: 'albumArtists'},
  {id: 6, title: 'albums_by_artist', icon: '?albums_by_artist', kind: 'albums'},
  {id: 7, title: 'genres', icon: '?genres', kind: 'genres'},
  {id: 17, title: 'years', icon: '?years', kind: 'years'},
  {id: 8, title: 'composers', icon: '?composers', kind: 'composers'},
  {id: 9, title: 'playlists', icon: '?playlists', kind: 'playlists'},
  {id: 18, title: 'streams', icon: '?streams', kind: 'empty'},
  {id: 10, title: 'queue', icon: '?queue', kind: 'queue'},
  {id: 19, title: 'bookmarks', icon: '?bookmarks', kind: 'empty'},
  {id: 11, title: 'most_played', icon: '?most_played', kind: 'mostPlayed'},
  {id: 13, title: 'top_rated', icon: '?top_rated', kind: 'topRated'},
  {id: 15, title: 'low_rated', icon: '?low_rated', kind: 'lowRated'},
  {id: 12, title: 'recently_played', icon: '?recently_played', kind: 'recentlyPlayed'},
  {id: 14, title: 'recently_added', icon: '?recently_added', kind: 'recent'},
  {id: 16, title: 'long_files', icon: '?long_files', kind: 'long'},
];
const DEFAULT_HOME_MASK = 1048511;
// Notes under categories in List Options (th1.c()).
const HOME_HINTS = {album_artists: 'summary_album_artists', albums_by_artist: 'summary_albums_by_artists', bookmarks: 'bookmarks_hint'};

/** A library category by id (library_home). */
export const homeCategory = id => HOME.find(c => c.id === id) ?? null;
import {applyZoom, listOpts, REVERSE, zoomGeometry} from './list-opts.js';
import {SEARCH_CATS, searchOrder} from '../widgets/search.js';
import {GONE} from '../res/values.js';
import {STATE_PLAYING} from '../player/player.js';
import {searchHistory, removeSearch, clearSearchHistory} from '../library/search-history.js';
import {listKeyOf, categoryKey, KEEP_LIST, KEEP_TRACK} from '../library/list-memory.js';

// The search categories after "All" (jj1.v1 order).
const SEARCH_KINDS = SEARCH_CATS.slice(1);

// Text order as the library's SQL collation: case-insensitive, digits by character ("Song D29" before "Song D3").
// One collator for all comparisons (localeCompare with options builds one per call).
const BASE = new Intl.Collator(undefined, {sensitivity: 'base'}), PLAIN = new Intl.Collator();
const cmpStr = (a, b) => BASE.compare(a ?? '', b ?? '');
const byTrackNo = (a, b) => (a.disc || 0) - (b.disc || 0) || (a.track || 0) - (b.track || 0);

/** Track orders by sort value (reference values; newest/most first for dates and counts). */
const TRACK_SORT = {
  0: (a, b) => (a.track || 0) - (b.track || 0) || cmpStr(a.title, b.title),
  13: (a, b) => byTrackNo(a, b) || cmpStr(a.title, b.title),
  1: (a, b) => cmpStr(a.title, b.title),
  2: (a, b) => cmpStr(a.fileName, b.fileName),
  14: (a, b) => cmpStr(a.path ?? a.fileName, b.path ?? b.fileName),
  8: (a, b) => cmpStr(a.artist, b.artist) || cmpStr(a.album, b.album) || byTrackNo(a, b),
  9: (a, b) => cmpStr(a.album, b.album) || byTrackNo(a, b),
  3: (a, b) => (a.year || 0) - (b.year || 0) || cmpStr(a.title, b.title),
  15: (a, b) => (a.year || 0) - (b.year || 0) || cmpStr(a.album, b.album) || byTrackNo(a, b),
  12: (a, b) => (b.added || 0) - (a.added || 0),
  4: (a, b) => (b.modified || b.added || 0) - (a.modified || a.added || 0),
  5: (a, b) => (b.rating || 0) - (a.rating || 0) || cmpStr(a.title, b.title),
  10: (a, b) => (a.durationMs || 0) - (b.durationMs || 0),
  7: (a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0),
  6: (a, b) => (b.plays || 0) - (a.plays || 0) || (b.lastPlayed || 0) - (a.lastPlayed || 0),
};

const gAdded = g => (g._added ??= Math.max(0, ...g.tracks.map(t => t.added || 0)));
const gYear = g => (g._year ??= Math.min(...g.tracks.map(t => t.year || 9999)));
// no_sort_field off (the default): album, artist, album artist and composer
// names sort without a leading "the", "a" or "an" (the library's sort fields).
const ARTICLE = /^(the|a|an)\s+/i;
const ARTICLE_KEYS = new Set(['cat:albums', 'cat:artists', 'cat:albumArtists', 'cat:composers', 'cat:albums_by_artist']);
// The second level's album lists sort like albums (te1).
const articled = key => ARTICLE_KEYS.has(key) || key.startsWith('sub:');
let articles = false;
const sortKey = s => (articles ? (s ?? '').replace(ARTICLE, '') : s);
const byName = (a, b) => cmpStr(sortKey(a.title), sortKey(b.title));
const GROUP_SORT = {
  0: byName,
  added: (a, b) => (b.pl?.created ?? gAdded(b)) - (a.pl?.created ?? gAdded(a)) || byName(a, b),
  count: (a, b) => (b.pl?.ids.length ?? b.tracks.length) - (a.pl?.ids.length ?? a.tracks.length) || byName(a, b),
  year: (a, b) => gYear(a) - gYear(b) || byName(a, b),
  artist: (a, b) => cmpStr(sortKey(a.artist ?? a.tracks[0]?.artist), sortKey(b.artist ?? b.tracks[0]?.artist)) || byName(a, b),
  albumArtist: (a, b) => cmpStr(sortKey(a.tracks[0]?.albumArtist || a.tracks[0]?.artist), sortKey(b.tracks[0]?.albumArtist || b.tracks[0]?.artist)) || byName(a, b),
  modified: (a, b) => (b.pl?.modified ?? gAdded(b)) - (a.pl?.modified ?? gAdded(a)) || byName(a, b),
  pathCs: (a, b) => { const x = a.path ?? a.title, y = b.path ?? b.title; return x < y ? -1 : x > y ? 1 : 0; },
  path: (a, b) => cmpStr(a.path ?? a.title, b.path ?? b.title),
};
const GROUP_SORT_FOR = {
  albums: {0: '0', 3: 'artist', 1: 'year', 2: 'added', 4: 'count'},
  albumArtists: {0: '0', 3: 'albumArtist', 1: 'year', 2: 'added', 4: 'count'},
  names: {0: '0', 1: 'added', 2: 'count'},
  folders: {0: '0', 1: 'pathCs', 5: 'path', 2: 'added', 3: 'modified', 4: 'count'},
  playlists: {0: '0', 1: 'added', 3: 'modified', 2: 'count'},
  years: {0: '0', 1: 'added', 2: 'count'},
};

/**
 * Applies a list's saved options (List Options): zoom geometry and, with a
 * sort kind, the order of its rows. Name/title order shows the A–Z column.
 */
function withOptions(src, list, {key, zoomKind, sortKind = null, defaultSort = 0, defaultZoom = null}) {
  applyZoom(src, list.host.substyle, zoomKind, key, defaultZoom);
  if (!sortKind) return src;
  const value = listOpts(key).sort ?? defaultSort;
  src.sortKind = sortKind;
  src.sortValue = value;
  const v = value & ~REVERSE, rev = (value & REVERSE) !== 0;
  if (src.groups) {
    const cmp = GROUP_SORT[GROUP_SORT_FOR[sortKind]?.[v] ?? '0'] ?? byName;
    articles = articled(key) && !src.ctx?.pref?.('no_sort_field');
    try { src.groups = [...src.groups].sort(cmp); } finally { articles = false; }
    if (rev) src.groups.reverse();
    src.byName = v === 0 && !rev;
    // The A-Z column follows the sort field.
    if (articled(key) && !src.ctx?.pref?.('no_sort_field')) src.sectionTitle = i => (src.groups[i]?.title ?? '').replace(ARTICLE, '');
  } else if (src.tracks) {
    let t = [...src.tracks];
    if (v === 11) {
      for (let i = t.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [t[i], t[j]] = [t[j], t[i]]; }
    } else t.sort(TRACK_SORT[v] ?? TRACK_SORT[0]);
    if (rev) t.reverse();
    src.tracks = t;
    src.sortedByName = v === 1 && !rev;
  }
  return src;
}

function dims(list) {
  const sub = list.host.substyle;
  return {
    textItemSize: sub.dim('textItemSize', 0),
    compactTextItemSize: sub.dim('compactTextItemSize', 0),
    topTextHeaderSize: sub.dim('topTextHeaderSize', 0),
    textHeaderSize: sub.dim('textHeaderSize', 0),
    itemSizeSmall: sub.dim('itemSizeSmall', 0),
    itemSize: sub.dim('itemSize', 0),
    headerSize: sub.dim('headerSize', 0),
  };
}

function str(ctx, name, fallback = name) {
  return ctx.res.stringByName(name, ctx.theme) ?? fallback;
}

/** A quantity string (plurals): "one" for 1, else "other", with %d filled in. */
export function plural(ctx, name, n) {
  const e = ctx.res.entry('plurals', name);
  const raw = (n === 1 ? e?.one : null) ?? e?.other ?? '%d';
  const text = ctx.res.string(raw, ctx.theme) ?? String(raw);
  return text.replace(/%d/g, String(n));
}

/** "m:ss" or "h:mm:ss" (the library's dur_meta). */
function durationMeta(ms) {
  const sec = Math.round((ms || 0) / 1000), h = Math.floor(sec / 3600), m = Math.floor(sec / 60) % 60, ss = String(sec % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

// Category rows and entry headers (xc.e / mo1881 over the categories'
// columns; notebook F79): line 2 is the category's C0 column (an album's
// artist, a folder's parent; none for names and playlists), the meta its m0
// "files | duration" (albums add " | year"; playlists pad the bar with two
// spaces) after the meta icon (wa1.M): the songs icon, or a folder's /
// playlist's List Memory flags (F46; playlist rows show List Position only).
const META_ICONS = ['?meta_songs_12dp', '?keep_list_pos_12dp', '?keep_track_pos_12dp', '?keep_list_track_pos_12dp'];
const groupMs = g => g.tracks.reduce((sum, t) => sum + (t.durationMs || 0), 0);

/** An album's year (album_year; none when no track has one). Inferred: the earliest. */
function albumYear(g) {
  let y = 0;
  for (const t of g.tracks) if (t.year && (!y || t.year < y)) y = t.year;
  return y;
}

export function groupMeta(g) {
  const n = g.tracks.length, dur = durationMeta(groupMs(g));
  if (g.pl) return `${n}  |  ${dur}`;
  const y = g.kind === 'album' ? albumYear(g) : 0;
  return `${n} | ${dur}` + (y ? ` | ${y}` : '');
}

/** The parent folder of a folder path (folders.parent_label). */
const parentLabel = path => (path ?? '').replace(/\/+$/, '').split('/').slice(0, -1).join('/');

function groupLine2(ctx, g) {
  if (g.kind === 'album') return g.byArtist ? g.artist : albumRowArtist(ctx, g);
  if (g.kind === 'folder') return parentLabel(g.path);
  return '';
}

/** The meta icon of a category row (rows: true) or entry header. */
function metaIconOf(ctx, g, rows) {
  let bits = ctx.listMemory?.flags(listKeyOf(g)) ?? 0;
  if (rows && g.pl) bits &= KEEP_LIST;
  return META_ICONS[bits];
}

/** The library home: category tiles. */
export class HomeSource {
  constructor(ctx, list, nav) {
    this.ctx = ctx;
    this.nav = nav;
    const mask = ctx.settings.library_lists ?? DEFAULT_HOME_MASK;
    this.items = HOME.filter(c => (mask & (1 << c.id)) !== 0);
    const d = dims(list);
    // The header's title (bk0: the Library string).
    this.title = str(ctx, 'library');
    this.itemType = 'text';
    this.itemScene = 'scene_grid';
    this.columns = 2;
    this.itemHeight = d.textItemSize;
    this.header = {type: 'text', scene: 'scene_top_header'};
    // The home's toolbar has only its menu (bk0: no songs of its own to play or select).
    this.menuOnlyToolbar = true;
    // addStatusBarHeightToHeaders: the header grows by the top inset.
    this.headerHeight = d.topTextHeaderSize + ctx.windowInsets.top;
    // No stored zoom: bk0.P0's default case, one column of textItemSize rows (level 1).
    withOptions(this, list, {key: 'home', zoomKind: 'home', defaultZoom: 1});
    this.homeCategories = HOME.map(c => ({...c, hint: HOME_HINTS[c.title] ?? null}));
    this.rebuild = () => new HomeSource(ctx, list, nav);
  }

  get count() { return this.items.length; }

  get menuLayout() { return 'merge_menu_items_lib'; }

  bindHeader(v) {
    v.findViewById('title')?.setText(this.title);
    v.findViewById('line2')?.setText('');
    v.track = null;
    v.findViewById('aa_image')?.setArt?.(null);
    v.findViewById('aa_image')?.setDrawable?.(null);
  }

  bindItem(v, i) {
    const c = this.items[i];
    v.findViewById('title')?.setText(str(this.ctx, c.title));
    // The Queue row's counter (merge_item_queue_counter) takes the line-2 place.
    v.findViewById('line2')?.setText(c.kind === 'queue' ? this.ctx.player?.queueCounter?.(str(this.ctx, '_empty')) ?? '' : '');
    // The row shows its category icon: no track's cover (nor one still loading for it).
    v.track = null;
    const icon = v.findViewById('aa_image');
    icon?.setArt?.(null);
    icon?.setDrawable?.(this.ctx.drawables.fromValue(c.icon, this.ctx.theme));
  }

  onItemClick(i) {
    this.nav.open(categorySource(this.ctx, this.nav.list, this.nav, this.items[i]));
  }
}

function groupsFor(lib, kind) {
  switch (kind) {
    case 'albums': return lib.albums();
    case 'artists': return lib.artists();
    case 'albumArtists': return lib.albumArtists();
    case 'genres': return lib.genres();
    case 'years': return group(lib.tracks, t => (t.year ? String(t.year) : 'Unknown year'), 'year');
    case 'composers': return lib.composers();
    case 'folders': return lib.folders();
    default: return null;
  }
}

function group(tracks, keyOf, kind) {
  const map = new Map();
  for (const t of tracks) {
    const k = keyOf(t);
    (map.get(k) ?? map.set(k, {kind, title: k, tracks: []}).get(k)).tracks.push(t);
  }
  return [...map.values()].sort((a, b) => PLAIN.compare(a.title, b.title));
}

// Statistics lists (from play counts, play times and ratings; like = 5, unlike = 1).
const byTitle = (a, b) => PLAIN.compare(a.title ?? '', b.title ?? '');
// The statistics lists as the reference queries them (oi1, zi1, yi1, sj1,
// ii1): a filter, the order the cap applies in, Max Items (*_files_limit,
// 200 from the first-run defaults, m30.d) and, for the lists with Clear /
// Show All (ch1), the time they start from (*_from; 0 shows all).
const STAT_LISTS = {
  mostPlayed: {keep: (t, from) => t.plays > 0 && (t.lastPlayed ?? 0) > from, order: (a, b) => b.plays - a.plays, clearable: true},
  recentlyPlayed: {keep: (t, from) => (t.lastPlayed ?? 0) > from, order: (a, b) => b.lastPlayed - a.lastPlayed, clearable: true},
  recent: {keep: (t, from) => !from || (t.added ?? 0) > from, order: (a, b) => (b.added || 0) - (a.added || 0), clearable: true},
  topRated: {keep: t => t.rating > 1, order: (a, b) => b.rating - a.rating},
  lowRated: {keep: t => t.rating === 1, order: null},
};
const DEFAULT_LIMIT = 200, NO_LIMIT = 2147483647;
// Long Files: at least long_files_min_duration (15 minutes from the first run).
const DEFAULT_LONG_MS = 900000;

// Sort kinds and default track orders of the categories.
const GROUP_SORT_KIND = {albums: 'albums', artists: 'names', albumArtists: 'names', genres: 'names', composers: 'names', years: 'years', folders: 'folders'};
const TRACKS_DEFAULT_SORT = {all: 1, recent: 12, long: 10, mostPlayed: 6, recentlyPlayed: 7, topRated: 5, lowRated: 5 | REVERSE, album: 13, artist: 9, albumArtist: 9, genre: 8, composer: 8, year: 15, folder: 2};

/** The All Songs list (the source list of a queue that came from no list). */
export function allSongsSource(ctx, list, nav) {
  return categorySource(ctx, list, nav, HOME[0]);
}

export function categorySource(ctx, list, nav, cat) {
  const lib = ctx.library;
  const title = str(ctx, cat.title);
  const tracks = (tracksIn, kind) => withOptions(new TrackSource(ctx, list, nav, title, tracksIn), list, {key: 'tracks:' + kind, zoomKind: 'tracks', sortKind: 'tracks', defaultSort: TRACKS_DEFAULT_SORT[kind] ?? 0});
  let src;
  if (cat.kind === 'all') src = tracks(lib.tracks, 'all');
  else if (cat.kind === 'queue') {
    src = withOptions(new TrackSource(ctx, list, nav, title, [...(ctx.player?.userQueue ?? [])]), list, {key: 'tracks:queue', zoomKind: 'tracks'});
    src.kind = 'queue';
    reorderable(src, map => ctx.player?.reorderQueue(map));
  }
  else if (STAT_LISTS[cat.kind]) {
    const stat = STAT_LISTS[cat.kind], o = listOpts('tracks:' + cat.kind);
    const from = stat.clearable ? o.from ?? 0 : 0, limit = Math.max(2, o.limit ?? DEFAULT_LIMIT);
    let picked = lib.tracks.filter(t => stat.keep(t, from));
    if (stat.order) picked.sort(stat.order);
    if (limit !== NO_LIMIT) picked = picked.slice(0, limit);
    src = tracks(picked, cat.kind);
    src.limitable = true;
    src.limit = limit;
    src.clearable = !!stat.clearable;
  }
  else if (cat.kind === 'playlists') return playlistsSource(ctx, list, nav);
  else if (cat.title === 'albums_by_artist') src = albumsByArtistSource(ctx, list, nav, title);
  else if (cat.title === 'folders_hier') return folderLevelSource(ctx, list, nav, lib.hierRoot(), cat);
  else if (cat.kind === 'long') {
    const min = listOpts('tracks:long').minDurationMs ?? DEFAULT_LONG_MS;
    src = tracks(lib.tracks.filter(t => t.durationMs >= min), 'long');
    src.kind = 'long';
    src.minDurationMs = min;
  }
  else {
    const groups = groupsFor(lib, cat.kind);
    src = groups
      ? withOptions(new GroupSource(ctx, list, nav, title, groups), list, {key: 'cat:' + cat.kind, zoomKind: 'groups', sortKind: GROUP_SORT_KIND[cat.kind] ?? 'names'})
      : new TrackSource(ctx, list, nav, title, []);
    src.groupKind = cat.kind;
  }
  src.icon = cat.icon;
  src.rebuild = () => categorySource(ctx, list, nav, cat);
  // kc / b32: the up-nav title over the text header names the library.
  src.backDecor = 'item_top_text_back_decor';
  return src;
}

/** Category header: title, second line and the category icon. */
function bindCategoryHeader(src, v, line2) {
  v.findViewById('title')?.setText(src.title);
  v.findViewById('line2')?.setText(line2);
  v.findViewById('aa_image')?.setDrawable?.(src.icon ? src.ctx.drawables.fromValue(src.icon, src.ctx.theme) : null);
}

/**
 * An album row's artist (te1.C0): the album artist with
 * use_albumartist_albums, else the artist of its tracks.
 */
function albumRowArtist(ctx, g) {
  const t = g.tracks[0];
  if (ctx.pref?.('use_albumartist_albums') && t?.albumArtist) return t.albumArtist;
  return t?.artist || ctx.res?.stringByName('unknown_artist_name') || 'Unknown artist';
}

/** A category's entries (albums, artists, ...) as track-item rows. */
export class GroupSource {
  constructor(ctx, list, nav, title, groups) {
    this.ctx = ctx;
    this.nav = nav;
    this.title = title;
    this.groups = groups;
    const d = dims(list);
    this.itemType = 'track';
    this.itemScene = 'scene_small';
    this.columns = 1;
    this.itemHeight = d.itemSizeSmall;
    this.header = {type: 'text', scene: 'scene_header'};
    this.headerHeight = d.textHeaderSize + ctx.windowInsets.top;
  }

  get count() { return this.groups.length; }

  get menuLayout() { return this.isPlaylists ? 'merge_menu_items_playlists' : 'merge_menu_items_lib'; }

  get selectionLayout() { return this.isPlaylists ? 'merge_selection_menu_playlist_items' : 'merge_selection_menu_list_items_w_aa'; }
  tracksAt(i) { return this.groups[i]?.tracks ?? []; }

  // Groups sorted by name show the A–Z scroller.
  get sortedByName() { return this.byName !== false; }
  sectionTitle(i) { return this.groups[i]?.title; }

  bindHeader(v) {
    bindCategoryHeader(this, v, '');
  }

  bindItem(v, i) {
    const g = this.groups[i];
    const first = g.tracks[0];
    v.bind({id: 'group:' + g.kind + ':' + (g.artist ?? '') + ':' + g.title, group: true, title: g.title, artist: groupLine2(this.ctx, g), art: first?.art, thumb: first?.thumb, artId: first?.artId, meta: groupMeta(g), metaIcon: metaIconOf(this.ctx, g, true)});
  }

  onItemClick(i) {
    const g = this.groups[i];
    // he.a(): artists, album artists, genres, composers and years open the entry's albums (u3).
    if (ALL_SONGS[g.kind]) this.nav.open(subAlbumsSource(this.ctx, this.nav.list, this.nav, g, this.icon));
    else this.nav.open(groupTracksSource(this.ctx, this.nav.list, this.nav, g, this.icon, this.parentGroup ?? null));
  }
}

// The second level's "All ... Songs" row per category (df1 / qe1 / ig1 / ... F0()).
const ALL_SONGS = {artist: 'all_artist_songs', albumArtist: 'all_album_artist_songs', genre: 'all_genre_songs', composer: 'all_composer_songs', year: 'all_year_songs'};

/** Albums from the library that hold some of the given tracks (only those tracks). */
function albumsOf(ctx, tracks) {
  const own = new Set(tracks);
  const out = [];
  for (const a of ctx.library.albums()) {
    const mine = a.tracks.filter(t => own.has(t));
    if (mine.length) out.push({kind: 'album', title: a.title, artist: a.artist, artId: a.artId, tracks: mine});
  }
  return out;
}

/**
 * An entry's albums (u3 over re1, the 2nd level category): an "All <category>
 * Songs" row (allTracksSubheadSize, scene_1, "N songs") under the header,
 * then the albums holding the entry's tracks, sorted like albums
 * (<category>_albums_sort). Its menu is the tracks menu (v3.n).
 */
class SubAlbumsSource extends GroupSource {
  get menuLayout() { return 'merge_menu_items_tracks'; }
}

export function subAlbumsSource(ctx, list, nav, g, icon) {
  const src = withOptions(new SubAlbumsSource(ctx, list, nav, g.title, albumsOf(ctx, g.tracks)), list, {key: 'sub:' + g.kind, zoomKind: 'groups', sortKind: 'albums'});
  src.groupKind = 'albums';
  src.secondLevel = true;
  src.parentGroup = g;
  src.icon = icon;
  src.subhead = {type: 'track', scene: 'scene_1', height: list.host.substyle.dim('allTracksSubheadSize', 0)};
  src.bindSubhead = v => {
    const first = g.tracks.find(t => t.artId || t.art || t.thumb) ?? g.tracks[0];
    v.bind({id: 'all:' + g.kind + ':' + g.title, group: true, title: str(ctx, ALL_SONGS[g.kind]), artist: plural(ctx, 'songs_d', g.tracks.length), meta: '', art: first?.art, thumb: first?.thumb, artId: first?.artId});
  };
  // u3.f(-103): the entry's own files list.
  src.onSubheadClick = () => nav.open(groupTracksSource(ctx, list, nav, g, icon));
  src.rebuild = () => subAlbumsSource(ctx, list, nav, g, icon);
  // u3: the entry's header (scene_header_1, the parents being tg1); year
  // albums (ug1) take the human sizes, the others headerSize / compactHeaderSize.
  entryHeader(ctx, list, src, g, {scene1: true, human: g.kind === 'year', compactW: g.kind === 'year', backDecor: 'item_text_back_decor'});
  return src;
}

/**
 * Albums by Artist (ue1: the artist_albums table): one row per album and
 * artist (a track's artist, unsplit), the album with that artist's tracks;
 * album sorts (albums_by_artist_sort). A row opens those tracks (ve1).
 */
export function albumsByArtistSource(ctx, list, nav, title) {
  const unknown = ctx.res?.stringByName('unknown_artist_name') ?? 'Unknown artist';
  const rows = [];
  for (const a of ctx.library.albums()) {
    const byArtist = new Map();
    for (const t of a.tracks) {
      const name = t.artist || unknown, k = name.toLowerCase();
      let r = byArtist.get(k);
      if (!r) byArtist.set(k, r = {kind: 'album', byArtist: true, title: a.title, artist: name, artId: t.artId, tracks: []});
      r.tracks.push(t);
      r.artId ||= t.artId;
    }
    rows.push(...byArtist.values());
  }
  const src = withOptions(new GroupSource(ctx, list, nav, title, rows), list, {key: 'cat:albums_by_artist', zoomKind: 'groups', sortKind: 'albums'});
  src.groupKind = 'albumsByArtist';
  return src;
}

/** Tracks as rows; a tap plays from that track (List Item Action: play and go to main UI). */
export class TrackSource {
  constructor(ctx, list, nav, title, tracks) {
    this.ctx = ctx;
    this.nav = nav;
    this.title = title;
    this.tracks = tracks;
    const d = dims(list);
    this.itemType = 'track';
    this.itemScene = 'scene_small';
    this.columns = 1;
    this.itemHeight = d.itemSizeSmall;
    this.header = {type: 'text', scene: 'scene_header'};
    this.headerHeight = d.textHeaderSize + ctx.windowInsets.top;
  }

  get count() { return this.tracks.length; }

  get menuLayout() { return 'merge_menu_items_tracks'; }

  sectionTitle(i) { return this.tracks[i]?.title; }

  get selectionLayout() { return 'merge_selection_menu_list_tracks_items'; }
  tracksAt(i) { return this.tracks[i] ? [this.tracks[i]] : []; }

  bindHeader(v) {
    bindCategoryHeader(this, v, String(this.tracks.length));
  }

  bindItem(v, i) {
    v.bind(this.tracks[i], !!this.numbered, !!this.albumArtistList);
  }

  onItemClick(i) {
    const p = this.ctx.player;
    // This list becomes the playing track's source list (album-art tap / swipe down).
    this.ctx.listWidget?.rememberQueueSource(this);
    const category = this.ctx.listWidget?.categoryFor(this) ?? null;
    // list_action_resets off: the playing track goes on in its new list.
    if (p.track && this.tracks[i] === p.track && !this.ctx.pref?.('list_action_resets')) p.adoptQueue(this.tracks, i, category);
    // A manual track change: it crossfades per fade_manual_advance while playing.
    else if (!p.selectInList(this.tracks, i, category)) p.setQueue(this.tracks, i, category, p.state === STATE_PLAYING);
    p.play();
    if ((this.ctx.settings.list_item_action ?? 1) === 1) this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
  }
}

/**
 * The current track's artist / album / folder / genre as a track list
 * (track menu actions; the library's own tracks, else the play queue).
 */
export function currentCategorySource(ctx, list, nav, kind, track = null) {
  const t = track ?? ctx.player?.track;
  if (!t) return null;
  const lib = ctx.library;
  const pool = lib?.tracks?.length ? lib.tracks : ctx.player.queue;
  const key = {
    artist: x => x.artist || 'Unknown artist',
    album: x => (x.album || '') + '\u0000' + (x.albumArtist || x.artist || ''),
    folder: x => x.folder || '/',
    genre: x => x.genre || 'Unknown genre',
  }[kind];
  if (!key) return null;
  const k = key(t);
  let tracks = pool.filter(x => key(x) === k);
  let title = kind === 'album' ? t.album || 'Unknown album' : kind === 'folder' ? (k.split('/').pop() || k) : k;
  // The library's own entry (album keys, split artists and genres): the one holding the track.
  const groups = lib?.tracks?.includes(t) ? {album: () => lib.albums(), artist: () => lib.artists(), genre: () => lib.genres()}[kind]?.() : null;
  if (groups) {
    const first = kind === 'album' ? null : lib.namesOf(t, kind).names[0].toLowerCase();
    const g = groups.find(x => x.tracks.includes(t) && (first === null || x.title.toLowerCase() === first || (!first && x.tracks.includes(t))));
    if (g) { tracks = g.tracks; title = g.title; }
  }
  const src = withOptions(new TrackSource(ctx, list, nav, title, tracks), list, {key: 'tracks:' + kind, zoomKind: 'tracks', sortKind: 'tracks', defaultSort: TRACKS_DEFAULT_SORT[kind] ?? 0});
  src.rebuild = () => currentCategorySource(ctx, list, nav, kind, t);
  // Track numbers belong to album and folder track lists (wf1 entities).
  src.numbered = kind === 'album' || kind === 'folder';
  const g = {kind, title, tracks, path: kind === 'folder' ? k : undefined, artist: kind === 'album' ? t.albumArtist || t.artist || '' : undefined};
  if (ALL_SONGS_CATEGORY[kind]) {
    entryHeader(ctx, list, src, g, {scene1: true, human: HUMAN_SONGS.has(kind), compactW: HUMAN_SONGS.has(kind)});
    src.backTitle = str(ctx, ALL_SONGS_CATEGORY[kind]);
  } else entryHeader(ctx, list, src, g);
  src.group = g;
  src.icon = {artist: '?artists', album: '?albums', folder: '?folders', genre: '?genres'}[kind];
  return src;
}

/**
 * Search results for a query in a category: songs match title, artist or
 * album; other categories list matching groups (each opens its tracks).
 */
/** Search categories in chip order (the bits of the search mask). */
/**
 * The empty search: the search history (item_search_history rows) and, after
 * them, Clear Search History. A tap on a term searches it; its clear button
 * removes it.
 */
// The search list's header (merge_item_text_header, scene_search_header):
// searchHeaderSize (targetSearchHeaderSize when targeted) tall, under the
// search panel, with the list buttons at its foot and no title.
function searchHeader(ctx, list, src, targeted) {
  const sub = list.host.substyle, d = dims(list);
  src.header = {type: 'text', scene: 'scene_search_header'};
  src.isSearch = true;
  src.headerHeight = sub.dim(targeted ? 'targetSearchHeaderSize' : 'searchHeaderSize', d.textHeaderSize) + ctx.windowInsets.top;
}

function historySource(ctx, list, nav, title) {
  const terms = searchHistory();
  const src = new TrackSource(ctx, list, nav, title, []);
  searchHeader(ctx, list, src, false);
  src.isHistory = true;
  if (!terms.length) return src;
  const rerun = () => ctx.listWidget?.showSearch?.();
  const n = terms.length;
  Object.defineProperty(src, 'count', {get: () => n + 1});
  src.typeAt = i => (i < n ? 'history' : 'clearHistory');
  src.isSeparator = () => false;
  src.tracksAt = () => [];
  src.sectionTitle = i => terms[i] ?? '';
  src.selectable = false;
  src.bindItem = (v, i) => {
    const b = v.findViewById('line2');
    if (i < n) {
      v.findViewById('title')?.setText(terms[i]);
      b?.setText('');
      if (b && !b._clearIcon) { b._clearIcon = ctx.drawables.fromValue('?clear', ctx.theme); }
      b?.setDrawable?.(b._clearIcon);
      if (b) b.onClick = () => { removeSearch(terms[i]); rerun(); };
    } else {
      b?.setText(str(ctx, 'clear_search_history'));
      if (b) b.onClick = () => { clearSearchHistory(); rerun(); };
    }
  };
  src.onItemClick = i => { if (i < n) ctx.bus.post('list', 'cmd_list_search_text', src, {string: terms[i]}); };
  return src;
}

/**
 * Search (jj1 / kj1 / vo1; notebook F64): the categories the chips select, in
 * jj1.v1 order, each with its matches under a subheader row
 * (item_separator_button, separatorSize high) and sorted by its name, case
 * folded (COLLATE NOCASE). The query splits on whitespace, ":", "-" and "_";
 * every word must occur in the entry's fields joined together (l2.B: LIKE
 * %word% over field||field); more than 64 words find nothing. Fields:
 * Albums album and artist, All Songs title, album and artist (title only
 * with search_track_titles_only; the file name for the title with
 * title_filename), the others their name. Streams are not built (owner
 * decision) and find nothing.
 */
// Search caches: items' lower-cased search texts, and the last query's hits per kind.
const SEARCH_TEXT = new WeakMap();
const LAST_SEARCH = {q: null, mode: -1, hits: null};

export function searchSource(ctx, list, nav, query, mask = -1, target = null) {
  const lib = ctx.library;
  const pool = lib?.tracks?.length ? lib.tracks : ctx.player?.queue ?? [];
  const title = str(ctx, 'search', 'Search');
  // list_zoom_search (jj1): the six one-column levels of track lists; the
  // one-line scenes when the search covers one one-line category alone.
  const oneLine = target ? !!target.groups?.[0] && ONE_LINE_KINDS.has(target.groups[0].kind) : SEARCH_KINDS.filter((c, i) => mask & (1 << i)).every(c => ONE_LINE_KINDS.has(c.kind)) && SEARCH_KINDS.some((c, i) => mask & (1 << i));
  const bare = src => {
    searchHeader(ctx, list, src, !!target);
    const sub = list.host.substyle;
    applyZoom(src, sub, 'search', 'search');
    if (oneLine) { const g = zoomGeometry(sub, 'search', src.zoomLevel, true); src.itemScene = g.scene; src.itemHeight = g.itemHeight; }
    src.rebuild = () => searchSource(ctx, list, nav, query, mask, target);
    src.searchTarget = target;
    return src;
  };
  // At least two characters (one in a targeted search, or for Japanese,
  // Korean and Chinese); shorter, an untargeted search lists its history and
  // a targeted one nothing (kj1.B).
  const q = String(query ?? '').trim();
  const minLen = target || /^(ja|ko|zh)\b/i.test(globalThis.navigator?.language ?? '') ? 1 : 2;
  const words = q.split(/[\s:\-_]+/).filter(Boolean).map(w => w.toLowerCase());
  if (!words.length || q.length < minLen) return target ? bare(new TrackSource(ctx, list, nav, title, [])) : historySource(ctx, list, nav, title);
  if (words.length > 64 || (!target && !mask)) return bare(new TrackSource(ctx, list, nav, title, []));
  const has = (...fields) => { const s = fields.map(f => f ?? '').join('').toLowerCase(); return words.every(w => s.includes(w)); };
  const fileTitles = !!ctx.pref?.('title_filename'), titlesOnly = !!ctx.pref?.('search_track_titles_only');
  const fileName = t => { const p = t.fileName || t.path || ''; return p.slice(p.lastIndexOf('/') + 1); };
  const line1 = t => (fileTitles ? fileName(t) : t.title);
  // Each item's lower-cased search text is made once (per field set);
  // sorting compares precomputed keys.
  const mode = (fileTitles ? 1 : 0) | (titlesOnly ? 2 : 0);
  const textOf = (o, make) => {
    const c = SEARCH_TEXT.get(o);
    if (c?.mode === mode) return c.s;
    const v = make().toLowerCase();
    SEARCH_TEXT.set(o, {mode, s: v});
    return v;
  };
  const matches = s => words.every(w => s.includes(w));
  const byKey = (list, keyOf) => list.map(x => [(keyOf(x) ?? '').toLowerCase(), x]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(x => x[1]);
  const trackText = t => textOf(t, () => (titlesOnly ? line1(t) ?? '' : (line1(t) ?? '') + (t.album ?? '') + (t.artist ?? '')));
  const groupText = (g, withArtist) => textOf(g, () => (g.title ?? '') + (withArtist ? g.artist ?? '' : ''));
  // Typing on: a query that extends the last one narrows its hits (every
  // word of the longer query holds a word of the shorter one).
  const prev = LAST_SEARCH.mode === mode && LAST_SEARCH.q != null && q.toLowerCase().startsWith(LAST_SEARCH.q) ? LAST_SEARCH.hits : null;
  const hits = new Map();
  const narrow = (kind, all, text) => {
    // Only hits taken from this very list (the library's tracks or groups as now).
    const p = prev?.get(kind);
    const out = (p?.all === all ? p.out : all).filter(x => matches(text(x)));
    hits.set(kind, {all, out});
    return out;
  };
  const found = kind => {
    switch (kind) {
      case 'songs': return byKey(narrow(kind, pool, trackText), line1);
      case 'albums': return byKey(narrow(kind, groupsFor(lib, 'albums') ?? [], g => groupText(g, true)), g => g.title);
      case 'playlists': return byKey((ctx.playlists?.sorted() ?? []).map(pl => ({kind: 'playlist', title: pl.name, tracks: ctx.playlists.tracksOf(pl), pl})).filter(g => has(g.title)), g => g.title);
      case 'streams': return [];
      default: return byKey(narrow(kind, lib?.tracks?.length ? groupsFor(lib, kind) ?? [] : [], g => groupText(g, false)), g => g.title);
    }
  };
  if (target) return bare(targetedRows(ctx, list, nav, title, target, {has, line1, titlesOnly}));
  const rows = [], separators = [];
  // Sections in the chosen category order (searchOrder); bit i stays category i.
  searchOrder().forEach(i => {
    const c = SEARCH_KINDS[i];
    if ((mask & (1 << i)) === 0) return;
    const kindHits = found(c.kind);
    if (!kindHits.length) return;
    separators.push(rows.length);
    rows.push({sep: str(ctx, c.title)});
    for (const h of kindHits) rows.push(c.kind === 'songs' ? {track: h} : {group: h, kind: c.kind});
  });
  Object.assign(LAST_SEARCH, {q: q.toLowerCase(), mode, hits});
  if (!rows.length) return bare(new TrackSource(ctx, list, nav, title, []));
  const src = bare(new GroupSource(ctx, list, nav, title, rows.filter(r => r.group).map(r => r.group)));
  src.rebuild = () => searchSource(ctx, list, nav, query, mask, target);
  const d = dims(list);
  src.rows = rows;
  src.separators = separators;
  src.separatorHeight = list.host.substyle.dim('separatorSize', d.itemSizeSmall);
  src.tracks = rows.filter(r => r.track).map(r => r.track);
  src.byName = false;
  Object.defineProperty(src, 'count', {get: () => rows.length});
  src.isSeparator = i => !!rows[i]?.sep;
  src.typeAt = i => (rows[i]?.sep ? 'separator' : undefined);
  src.tracksAt = i => (rows[i]?.track ? [rows[i].track] : rows[i]?.group?.tracks ?? []);
  src.sectionTitle = i => rows[i]?.track?.title ?? rows[i]?.group?.title ?? rows[i]?.sep;
  const groupIndex = new Map(rows.filter(r => r.group).map((r, k) => [r, k]));
  const bindGroup = src.bindItem.bind(src), openGroup = src.onItemClick.bind(src);
  src.bindItem = (v, i) => {
    const r = rows[i];
    if (r.sep) { v.findViewById('title')?.setText(r.sep); v.findViewById('line2')?.setVisibility(GONE); return; }
    if (r.track) v.bind(r.track);
    else bindGroup(v, groupIndex.get(r));
  };
  // A tap on an entry opens it; a tap on a song plays the found songs from
  // it (vo1.f: the songs category filtered by the search).
  src.onItemClick = i => {
    const r = rows[i];
    if (!r || r.sep) return;
    if (r.group) { openGroup(groupIndex.get(r)); return; }
    ctx.player.setQueue(src.tracks, src.tracks.indexOf(r.track));
    ctx.player.play();
    if ((ctx.settings.list_item_action ?? 1) === 1) ctx.bus.post('bus_gui', 'cmd_nav_to_main', src);
  };
  return src;
}

/** Playlists category: each playlist (name, track count) opens its tracks. */
// One-line category types (tg1): their search rows take the one-line scenes.
const ONE_LINE_KINDS = new Set(['playlists', 'genres', 'years', 'composers', 'playlist', 'genre', 'year', 'composer']);

/**
 * A search within one list (targeted search, ste; vo1.T0 / kj1.B): the
 * list's own rows that match, in the list's own order. Folders Hierarchy
 * searches its subfolders (by name) and the songs directly in it, the songs
 * under a "Folder Songs" header (a header shows only before a second
 * category); a category list its entries (albums by album and artist); a
 * track list its songs. Each row is the target's own row: it binds, opens
 * and plays as in that list (a song plays the list from it).
 */
function targetedRows(ctx, list, nav, title, target, {has, line1, titlesOnly}) {
  const songHit = t => (titlesOnly ? has(line1(t)) : has(line1(t), t.album, t.artist));
  const cats = [];
  if (target.folders) {
    cats.push({items: target.folders.flatMap((f, i) => (has(f.name) ? [{group: {tracks: subtreeFiles(f)}, at: i}] : []))});
    cats.push({title: str(ctx, 'folder_songs'), items: target.tracks.flatMap((t, k) => (songHit(t) ? [{track: t, at: target.folders.length + k}] : []))});
  } else if (target.groups) {
    cats.push({items: target.groups.flatMap((g, i) => (has(g.title, g.kind === 'album' || g.kind === 'albums' ? g.artist : '') ? [{group: g, at: i}] : []))});
  } else {
    cats.push({items: (target.tracks ?? []).flatMap((t, k) => (songHit(t) ? [{track: t, at: k}] : []))});
  }
  const rows = [], separators = [];
  cats.forEach((c, n) => {
    if (!c.items.length) return;
    if (n > 0 && c.title) { separators.push(rows.length); rows.push({sep: c.title}); }
    rows.push(...c.items);
  });
  const src = new GroupSource(ctx, list, nav, title, []);
  src.rows = rows;
  src.separators = separators;
  src.separatorHeight = list.host.substyle.dim('separatorSize', dims(list).itemSizeSmall);
  src.tracks = rows.filter(r => r.track).map(r => r.track);
  src.byName = false;
  Object.defineProperty(src, 'count', {get: () => rows.length});
  src.isSeparator = i => !!rows[i]?.sep;
  src.typeAt = i => (rows[i]?.sep ? 'separator' : undefined);
  src.tracksAt = i => (rows[i]?.sep ? [] : target.tracksAt?.(rows[i].at) ?? []);
  src.sectionTitle = i => rows[i]?.sep ?? target.sectionTitle?.(rows[i].at);
  src.bindItem = (v, i) => {
    const r = rows[i];
    if (r.sep) { v.findViewById('title')?.setText(r.sep); v.findViewById('line2')?.setVisibility(GONE); return; }
    target.bindItem(v, r.at);
  };
  src.onItemClick = i => { const r = rows[i]; if (r && !r.sep) target.onItemClick(r.at); };
  return src;
}

export function playlistsSource(ctx, list, nav) {
  const P = ctx.playlists;
  const groups = (P?.sorted() ?? []).map(pl => ({kind: 'playlist', title: pl.name, tracks: P.tracksOf(pl), pl}));
  const src = withOptions(new GroupSource(ctx, list, nav, str(ctx, 'playlists'), groups), list, {key: 'cat:playlists', zoomKind: 'groups', sortKind: 'playlists'});
  src.icon = '?playlists';
  src.isPlaylists = true;
  src.backDecor = 'item_top_text_back_decor';
  src.onItemClick = i => { const s2 = playlistSource(ctx, list, nav, src.groups[i]?.pl); if (s2) nav.open(s2); };
  src.rebuild = () => playlistsSource(ctx, list, nav);
  return src;
}

/** A playlist's tracks in playlist order. */
export function playlistSource(ctx, list, nav, pl) {
  const P = ctx.playlists;
  if (!P || !pl) return null;
  // Entries whose track left the library are skipped; entryIndex maps rows to entries.
  const tracks = [], entryIndex = [];
  pl.ids.forEach((id, i) => { const t = ctx.library.byId.get(id); if (t) { tracks.push(t); entryIndex.push(i); } });
  // Playlist order (no sort options; zoom applies).
  const src = withOptions(new TrackSource(ctx, list, nav, pl.name, tracks), list, {key: 'tracks:playlist', zoomKind: 'tracks'});
  src.icon = '?playlists';
  src.playlist = pl;
  src.entryIndex = entryIndex;
  // si1: under Playlists (tg1), title only.
  entryHeader(ctx, list, src, {kind: 'playlist', title: pl.name, tracks, pl}, {scene1: true});
  src.rebuild = () => playlistSource(ctx, list, nav, pl);
  // Rows move between the shown entries' places; missing entries stay put.
  reorderable(src, map => {
    const ids = pl.ids.slice();
    entryIndex.forEach((at, slot) => { ids[at] = pl.ids[entryIndex[map[slot]]]; });
    // The shown list already has the new order; it is not rebuilt.
    src.ownChange = true;
    P.reorder(pl, ids);
    src.ownChange = false;
  });
  return src;
}

/**
 * Drag reordering in selection mode (the playlist and queue lists, F59):
 * applyOrder(map) puts row map[slot] at each slot and stores the order.
 */
function reorderable(src, store) {
  src.reorderable = true;
  src.applyOrder = map => {
    const old = src.tracks;
    src.tracks = map.map(i => old[i]);
    store(map);
  };
}

/**
 * Entry headers (c32 / g32, u3, h60; notebook F79). A category entry's songs,
 * an entry's albums and a Folders Hierarchy folder show the track item as
 * their header: in scene_header the entry's art fills it with the title,
 * line 2 and meta (with its icon) at its foot; scene_header_1 (title only)
 * when the parent category is a "human" one (tg1: artists, album artists,
 * genres, composers, years, playlists). Height (g32.F0, u3.F0, h60.F0; plus
 * the top inset): headerSize, or humanCatHeaderSize (at most the list's
 * width) for the artist-like lists (gh1). Compact Header (xh1.W0) takes
 * compactHeaderSize, or compactHumanCatHeaderSize where the reference picks
 * it (compactW). Over it lies the back decor (backDecor): the up-nav title.
 */
function entryHeader(ctx, list, src, g, {scene1 = false, human = false, compactW = false, backDecor = 'item_back_decor', line2 = null, meta = null, metaIcon = null} = {}) {
  const sub = list.host.substyle, compact = !!src.compactHeader;
  const humanSize = Math.min(sub.dim('humanCatHeaderSize', 0), list.host.width || Infinity);
  const size = compact ? sub.dim(compactW ? 'compactHumanCatHeaderSize' : 'compactHeaderSize', 0) : human ? humanSize : sub.dim('headerSize', 0);
  src.header = {type: 'track', scene: scene1 ? 'scene_header_1' : 'scene_header'};
  src.headerHeight = size + ctx.windowInsets.top;
  src.compactable = true;
  src.backDecor = backDecor;
  // List Memory belongs to folders and playlists (jh1).
  src.memoryKey = listKeyOf(g);
  src.bindHeader = v => {
    const first = g.tracks.find(t => t.artId || t.art || t.thumb) ?? g.tracks[0];
    v.bind({id: 'hdr:' + g.kind + ':' + (g.path ?? g.pl?.id ?? g.artist ?? '') + ':' + g.title, group: true, title: g.title, artist: line2 ?? groupLine2(ctx, g), meta: meta ?? groupMeta(g), metaIcon: metaIcon ?? metaIconOf(ctx, g, false), art: first?.art, thumb: first?.thumb, artId: first?.artId});
  };
  return src;
}

// The categories of the "All … Songs" lists (their back decor names them, df1.j0()).
const ALL_SONGS_CATEGORY = {artist: 'artists', albumArtist: 'album_artists', genre: 'genres', composer: 'composers', year: 'years'};
// gh1 lists: the artist-like entries' songs (df1, qe1, kf1) and albums of album artists and composers (pe1, jf1).
const HUMAN_SONGS = new Set(['artist', 'albumArtist', 'composer']);

/**
 * A category entry's tracks (album, artist, ...), with that list kind's
 * options; parentGroup is the entry whose albums list it came from.
 */
export function groupTracksSource(ctx, list, nav, g, icon, parentGroup = null) {
  const kind = g.kind ?? 'group';
  const src = withOptions(new TrackSource(ctx, list, nav, g.title, g.tracks), list, {key: 'tracks:' + kind, zoomKind: 'tracks', sortKind: 'tracks', defaultSort: TRACKS_DEFAULT_SORT[kind] ?? 0});
  src.icon = icon;
  src.group = g;
  src.rebuild = () => groupTracksSource(ctx, list, nav, g, icon, parentGroup);
  src.numbered = kind === 'album' || kind === 'folder';
  if (ALL_SONGS_CATEGORY[kind]) {
    // df1 / qe1 / ig1 / kf1 / zj1: under the category itself (tg1).
    const human = HUMAN_SONGS.has(kind);
    entryHeader(ctx, list, src, g, {scene1: true, human, compactW: human});
    src.backTitle = str(ctx, ALL_SONGS_CATEGORY[kind]);
  } else entryHeader(ctx, list, src, g, {human: !!parentGroup && (parentGroup.kind === 'albumArtist' || parentGroup.kind === 'composer')});
  src.albumArtistList = kind === 'albumArtist';
  return src;
}

/**
 * Folders Hierarchy (h60, FoldersAndFilesPage over cg1; notebook F76). The
 * top level (the root, or with root_hier_immediate the first folder with
 * tracks or several subfolders) lists its subfolders; a folder lists its
 * subfolders (name, parent folder, "files | duration" of the whole subtree)
 * and then its own files. A subfolder opens the next level, a file plays the
 * folder with the hierarchy's folders as categories (in path order). With
 * hier_files_zoom a folder with files only takes the Folders files zoom
 * level. Header Play starts at the folder (or its first folder with files)
 * and, unless hier_no_advance, sets Play All Categories; header Shuffle with
 * hier_flat_shf shuffles every song of the subtree, else songs and
 * categories with the subtree's folders first (cg1.W).
 */
class FolderLevelSource {
  constructor(ctx, list, nav, node, cat) {
    this.ctx = ctx;
    this.nav = nav;
    this.node = node;
    this.cat = cat;
    const lib = ctx.library, tree = lib.folderTree();
    this.tree = tree;
    this.isRoot = node === lib.hierRoot();
    this.title = this.isRoot ? str(ctx, 'folders_hier') : node.name;
    this.folders = node.folders;
    const d = dims(list);
    this.header = {type: 'text', scene: 'scene_header'};
    this.headerHeight = d.textHeaderSize + ctx.windowInsets.top;
    this.backDecor = 'item_top_text_back_decor';
    this.itemType = 'track';
    this.icon = '?folders_hier';
    const filesOnly = !this.folders.length && node.files.length > 0;
    // hier_files_zoom (m30.k0): a folder with files only takes the folder files zoom.
    const filesZoom = filesOnly && !!ctx.pref?.('hier_files_zoom');
    const files = withOptions({ctx, tracks: [...node.files]}, list, {key: 'tracks:folders_hier', zoomKind: 'tracks', sortKind: 'tracks', defaultSort: TRACKS_DEFAULT_SORT.folder});
    this.tracks = files.tracks;
    this.numbered = true;
    applyZoom(this, list.host.substyle, filesZoom ? 'tracks' : 'groups', filesZoom ? 'tracks:folder' : 'cat:folders_hier');
    // h60.e0: a folder has the track header (headerSize / compactHeaderSize)
    // with the parent folder's name as its up-nav title (item_back_decor), or
    // under the top level the hierarchy's (item_text_back_decor).
    if (!this.isRoot) {
      const g = {kind: 'folder', title: node.name, path: node.path, tracks: subtreeFiles(node)};
      entryHeader(ctx, list, this, g, {backDecor: node.parent === lib.hierRoot() ? 'item_text_back_decor' : 'item_back_decor', line2: node.parent?.name ?? '', meta: hierMeta(node)});
    }
    this.rebuild = () => folderLevelSource(ctx, list, nav, lib.folderTree().nodes.get(node.path) ?? lib.hierRoot(), cat);
  }

  get count() { return this.folders.length + this.tracks.length; }

  get menuLayout() { return 'merge_menu_items_lib'; }

  get selectionLayout() { return 'merge_selection_menu_list_tracks_items'; }

  isFolder(i) { return i < this.folders.length; }

  indexOfTrack(t) {
    const i = this.tracks.findIndex(x => x.id === t.id);
    return i < 0 ? -1 : this.folders.length + i;
  }

  tracksAt(i) {
    if (!this.isFolder(i)) return this.tracks[i - this.folders.length] ? [this.tracks[i - this.folders.length]] : [];
    return subtreeFiles(this.folders[i]);
  }

  sectionTitle(i) {
    return this.isFolder(i) ? this.folders[i].name : this.tracks[i - this.folders.length]?.title;
  }

  bindHeader(v) {
    bindCategoryHeader(this, v, '');
  }

  bindItem(v, i) {
    if (this.isFolder(i)) {
      const f = this.folders[i], first = f.files[0] ?? subtreeFiles(f)[0];
      // h60: folder rows show the folder category icon (?folder_cat_icon) at their end.
      v.bind({id: 'hier:' + f.path, group: true, title: f.name, artist: f.parent?.name ?? '', meta: hierMeta(f), metaIcon: META_ICONS[this.ctx.listMemory?.flags('folder:' + f.path) ?? 0], catIcon: '?folder_cat_icon', art: first?.art, thumb: first?.thumb, artId: first?.artId});
    } else v.bind(this.tracks[i - this.folders.length], true, false);
  }

  onItemClick(i) {
    if (this.isFolder(i)) { this.nav.open(folderLevelSource(this.ctx, this.nav.list, this.nav, this.folders[i], this.cat)); return; }
    const p = this.ctx.player, k = i - this.folders.length;
    this.ctx.listWidget?.rememberQueueSource(this);
    const category = hierCategory(this, this.node);
    if (p.track && this.tracks[k] === p.track && !this.ctx.pref?.('list_action_resets')) p.adoptQueue(this.tracks, k, category);
    else if (!p.selectInList(this.tracks, k, category)) p.setQueue(this.tracks, k, category, p.state === STATE_PLAYING);
    p.play();
    if ((this.ctx.settings.list_item_action ?? 1) === 1) this.ctx.bus.post('bus_gui', 'cmd_nav_to_main', this);
  }

  /** Header Play (g0(0)) and Shuffle (g0(4) through h60.V). */
  play(shuffle) {
    const ctx = this.ctx, p = ctx.player, flat = !!ctx.pref?.('hier_flat_shf');
    const bus = (m, a) => ctx.bus.post('bus_player_cmd', m, this, {arg1: a});
    if (shuffle && flat) {
      // shs=h: every song of the subtree, shuffled.
      const all = subtreeFiles(this.node);
      if (!all.length) return false;
      bus('cmd_player_set_shuffle', 2);
      p.setQueue(all, Math.floor(Math.random() * all.length), null);
    } else {
      // cg1.M: the folder, or the next folder with files in path order.
      const order = this.tree.withFiles;
      const inside = order.filter(n => n === this.node || n.path.startsWith(this.node.path ? this.node.path + '/' : ''));
      if (!inside.length) return false;
      const start = shuffle ? inside[Math.floor(Math.random() * inside.length)] : inside[0];
      bus('cmd_player_set_shuffle', shuffle ? 4 : 0);
      // sd.g0(0): Play All Categories unless hier_no_advance (b40.W).
      if (!shuffle && !ctx.pref?.('hier_no_advance')) bus('cmd_player_set_repeat_mode', 2);
      const category = hierCategory(this, start);
      const tracks = category.source.tracksAt(category.index);
      const dflt = shuffle ? Math.floor(Math.random() * tracks.length) : 0;
      p.setQueue(tracks, ctx.listMemory?.start(categoryKey(category), tracks, dflt) ?? dflt, category);
    }
    p.play();
    return true;
  }
}

function hierMeta(n) {
  return `${n.hierFiles} | ${durationMeta(n.hierMs)}`;
}

/** Every file in a folder's subtree, folder by folder in path order. */
function subtreeFiles(n) {
  const out = [...n.files];
  for (const c of n.folders) out.push(...subtreeFiles(c));
  return out;
}

/**
 * The hierarchy's categories: every folder with files in path order; in the
 * category shuffle modes the playing level's subtree comes first (cg1.W).
 */
function hierCategory(src, node) {
  const order = src.tree.withFiles, index = order.indexOf(node);
  if (index < 0) return null;
  const level = src.node, prefix = level.path ? level.path + '/' : '';
  const first = new Set(order.filter(n => n === level || n.path.startsWith(prefix)).map(n => order.indexOf(n)));
  const files = n => withOptions({ctx: src.ctx, tracks: [...n.files]}, src.nav.list, {key: 'tracks:folders_hier', zoomKind: 'tracks', sortKind: 'tracks', defaultSort: TRACKS_DEFAULT_SORT.folder}).tracks;
  return {source: {count: order.length, groups: order.map(n => ({kind: 'folder', title: n.name, path: n.path, tracks: n.files})), tracksAt: j => (order[j] ? files(order[j]) : []), shuffleFirst: first}, index};
}

export function folderLevelSource(ctx, list, nav, node, cat = homeCategory(2)) {
  const src = new FolderLevelSource(ctx, list, nav, node, cat);
  src.kind = 'hier';
  return src;
}
