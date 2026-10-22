// Library list sources: the library home (category tiles) and category /
// track lists, with the reference's zoom-level geometry (pd.P0 / bk0.P0):
//   home, zoom 0: scene_grid, 2 columns, textItemSize rows, scene_top_header header
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
import {applyZoom, listOpts, REVERSE} from './list-opts.js';

const cmpStr = (a, b) => (a ?? '').localeCompare(b ?? '', undefined, {sensitivity: 'base', numeric: true});
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
const ARTICLE_KEYS = new Set(['cat:albums', 'cat:artists', 'cat:albumArtists', 'cat:composers']);
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
function withOptions(src, list, {key, zoomKind, sortKind = null, defaultSort = 0, defaultZoom = 0}) {
  applyZoom(src, list.host.substyle, zoomKind, key, defaultZoom);
  if (!sortKind) return src;
  const value = listOpts(key).sort ?? defaultSort;
  src.sortKind = sortKind;
  src.sortValue = value;
  const v = value & ~REVERSE, rev = (value & REVERSE) !== 0;
  if (src.groups) {
    const cmp = GROUP_SORT[GROUP_SORT_FOR[sortKind]?.[v] ?? '0'] ?? byName;
    articles = ARTICLE_KEYS.has(key) && !src.ctx?.pref?.('no_sort_field');
    try { src.groups = [...src.groups].sort(cmp); } finally { articles = false; }
    if (rev) src.groups.reverse();
    src.byName = v === 0 && !rev;
    // The A-Z column follows the sort field.
    if (ARTICLE_KEYS.has(key) && !src.ctx?.pref?.('no_sort_field')) src.sectionTitle = i => (src.groups[i]?.title ?? '').replace(ARTICLE, '');
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

/** The library home: category tiles. */
export class HomeSource {
  constructor(ctx, list, nav) {
    this.ctx = ctx;
    this.nav = nav;
    const mask = ctx.settings.library_lists ?? DEFAULT_HOME_MASK;
    this.items = HOME.filter(c => (mask & (1 << c.id)) !== 0);
    const d = dims(list);
    this.title = '';
    this.itemType = 'text';
    this.itemScene = 'scene_grid';
    this.columns = 2;
    this.itemHeight = d.textItemSize;
    this.header = {type: 'text', scene: 'scene_top_header'};
    // addStatusBarHeightToHeaders: the header grows by the top inset.
    this.headerHeight = d.topTextHeaderSize + ctx.windowInsets.top;
    withOptions(this, list, {key: 'home', zoomKind: 'home'});
    this.homeCategories = HOME.map(c => ({...c, hint: HOME_HINTS[c.title] ?? null}));
    this.rebuild = () => new HomeSource(ctx, list, nav);
  }

  get count() { return this.items.length; }

  get menuLayout() { return 'merge_menu_items_lib'; }

  bindHeader(v) {
    v.findViewById('title')?.setText(this.title);
    v.findViewById('line2')?.setText('');
    v.findViewById('aa_image')?.setDrawable?.(null);
  }

  bindItem(v, i) {
    const c = this.items[i];
    v.findViewById('title')?.setText(str(this.ctx, c.title));
    v.findViewById('line2')?.setText('');
    const icon = v.findViewById('aa_image');
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
  return [...map.values()].sort((a, b) => a.title.localeCompare(b.title));
}

// Statistics lists (from play counts, play times and ratings; like = 5, unlike = 1).
const byTitle = (a, b) => (a.title ?? '').localeCompare(b.title ?? '');
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
  else if (cat.kind === 'long') {
    const min = listOpts('tracks:long').minDurationMs ?? DEFAULT_LONG_MS;
    src = tracks(lib.tracks.filter(t => t.durationMs >= min), 'long');
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
    v.bind({id: 'group:' + g.kind + ':' + g.title, group: true, title: g.title, artist: g.kind === 'album' ? albumRowArtist(this.ctx, g) : `${g.tracks.length}`, art: first?.art, thumb: first?.thumb, artId: first?.artId, meta: ''});
  }

  onItemClick(i) {
    const g = this.groups[i];
    this.nav.open(groupTracksSource(this.ctx, this.nav.list, this.nav, g, this.icon));
  }
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
    else p.setQueue(this.tracks, i, category);
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
  // Compact Header (xh1, layout_header_compact): the header takes
  // compactTextHeaderSize.
  src.compactable = true;
  if (src.compactHeader) src.headerHeight = list.host.substyle.dim('compactTextHeaderSize', 0) + ctx.windowInsets.top;
  src.icon = {artist: '?artists', album: '?albums', folder: '?folders', genre: '?genres'}[kind];
  return src;
}

/**
 * Search results for a query in a category: songs match title, artist or
 * album; other categories list matching groups (each opens its tracks).
 */
/** Search categories in chip order (the bits of the search mask). */
const SEARCH_KINDS = ['songs', 'albums', 'artists', 'genres', 'folders', 'composers'];

/**
 * Search results for a query over a category mask (bit i = SEARCH_KINDS[i];
 * -1 all): songs matching title, artist or album, then each selected
 * category's matching entries, in chip order, as one list. Category
 * subheaders between the parts are not drawn.
 */
export function searchSource(ctx, list, nav, query, mask = -1) {
  const q = query.trim().toLocaleLowerCase();
  const lib = ctx.library;
  const pool = lib?.tracks?.length ? lib.tracks : ctx.player?.queue ?? [];
  const has = s => !!s && s.toLocaleLowerCase().includes(q);
  const title = ctx.res.stringByName('search') ?? 'Search';
  const bare = src => { src.header = null; src.headerHeight = 0; return src; };
  if (!q || !mask) return bare(new TrackSource(ctx, list, nav, title, []));
  const on = kind => (mask & (1 << SEARCH_KINDS.indexOf(kind))) !== 0;
  const tracks = on('songs') ? pool.filter(t => has(t.title) || has(t.artist) || has(t.album)) : [];
  const groups = [];
  for (const kind of SEARCH_KINDS.slice(1)) {
    if (!on(kind)) continue;
    const gs = (lib?.tracks?.length ? groupsFor(lib, kind) : null) ?? group(pool, {
      albums: t => t.album || 'Unknown album', artists: t => t.artist || 'Unknown artist',
      genres: t => t.genre || 'Unknown genre', folders: t => t.folder || '/', composers: t => t.composer || 'Unknown composer',
    }[kind], kind);
    groups.push(...gs.filter(g => has(g.title)));
  }
  if (!groups.length) return bare(new TrackSource(ctx, list, nav, title, tracks));
  if (!tracks.length) return bare(new GroupSource(ctx, list, nav, title, groups));
  // Songs and entries in one list: rows below tracks.length are entries.
  const src = bare(new GroupSource(ctx, list, nav, title, groups));
  const n = tracks.length;
  src.tracks = tracks;
  Object.defineProperty(src, 'count', {get: () => n + groups.length});
  src.tracksAt = i => (i < n ? [tracks[i]] : groups[i - n]?.tracks ?? []);
  src.sectionTitle = i => (i < n ? tracks[i].title : groups[i - n]?.title);
  const bindGroup = src.bindItem.bind(src), openGroup = src.onItemClick.bind(src);
  src.bindItem = (v, i) => (i < n ? v.bind(tracks[i]) : bindGroup(v, i - n));
  src.onItemClick = i => {
    if (i >= n) { openGroup(i - n); return; }
    ctx.player.setQueue(tracks, i);
    ctx.player.play();
    if ((ctx.settings.list_item_action ?? 1) === 1) ctx.bus.post('bus_gui', 'cmd_nav_to_main', src);
  };
  return src;
}

/** Playlists category: each playlist (name, track count) opens its tracks. */
export function playlistsSource(ctx, list, nav) {
  const P = ctx.playlists;
  const groups = (P?.sorted() ?? []).map(pl => ({kind: 'playlist', title: pl.name, tracks: P.tracksOf(pl), pl}));
  const src = withOptions(new GroupSource(ctx, list, nav, str(ctx, 'playlists'), groups), list, {key: 'cat:playlists', zoomKind: 'groups', sortKind: 'playlists'});
  src.icon = '?playlists';
  src.isPlaylists = true;
  src.onItemClick = i => { const s2 = playlistSource(ctx, list, nav, src.groups[i].pl); if (s2) nav.open(s2); };
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

/** A category entry's tracks (album, artist, ...), with that list kind's options. */
export function groupTracksSource(ctx, list, nav, g, icon) {
  const kind = g.kind ?? 'group';
  const src = withOptions(new TrackSource(ctx, list, nav, g.title, g.tracks), list, {key: 'tracks:' + kind, zoomKind: 'tracks', sortKind: 'tracks', defaultSort: TRACKS_DEFAULT_SORT[kind] ?? 0});
  src.icon = icon;
  src.group = g;
  src.rebuild = () => groupTracksSource(ctx, list, nav, g, icon);
  src.numbered = kind === 'album' || kind === 'folder';
  // Compact Header (xh1, layout_header_compact): the header takes
  // compactTextHeaderSize.
  src.compactable = true;
  if (src.compactHeader) src.headerHeight = list.host.substyle.dim('compactTextHeaderSize', 0) + ctx.windowInsets.top;
  src.albumArtistList = kind === 'albumArtist';
  return src;
}
