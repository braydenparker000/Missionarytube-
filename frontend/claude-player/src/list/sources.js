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
    case 'albumArtists': return group(lib.tracks, t => t.albumArtist || t.artist || 'Unknown artist', 'artist');
    case 'genres': return lib.genres();
    case 'years': return group(lib.tracks, t => (t.year ? String(t.year) : 'Unknown year'), 'year');
    case 'composers': return group(lib.tracks, t => t.composer || 'Unknown composer', 'composer');
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
const STAT_LISTS = {
  mostPlayed: {keep: t => t.plays > 0, order: (a, b) => b.plays - a.plays || (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0)},
  recentlyPlayed: {keep: t => t.lastPlayed > 0, order: (a, b) => b.lastPlayed - a.lastPlayed},
  topRated: {keep: t => t.rating >= 4, order: (a, b) => b.rating - a.rating || byTitle(a, b)},
  lowRated: {keep: t => t.rating > 0 && t.rating <= 2, order: (a, b) => a.rating - b.rating || byTitle(a, b)},
};

function categorySource(ctx, list, nav, cat) {
  const lib = ctx.library;
  const title = str(ctx, cat.title);
  let src;
  if (cat.kind === 'all') {
    src = new TrackSource(ctx, list, nav, title, [...lib.tracks].sort((a, b) => (a.title ?? '').localeCompare(b.title ?? '')));
    src.sortedByName = true;
  }
  else if (cat.kind === 'recent') src = new TrackSource(ctx, list, nav, title, [...lib.tracks].sort((a, b) => (b.added ?? 0) - (a.added ?? 0)));
  else if (cat.kind === 'queue') {
    src = new TrackSource(ctx, list, nav, title, [...(ctx.player?.userQueue ?? [])]);
    src.kind = 'queue';
    src.rebuild = () => categorySource(ctx, list, nav, cat);
  }
  else if (STAT_LISTS[cat.kind]) {
    const {keep, order} = STAT_LISTS[cat.kind];
    src = new TrackSource(ctx, list, nav, title, lib.tracks.filter(keep).sort(order));
  }
  else if (cat.kind === 'playlists') return playlistsSource(ctx, list, nav);
  else if (cat.kind === 'long') src = new TrackSource(ctx, list, nav, title, lib.tracks.filter(t => t.durationMs >= 20 * 60000));
  else {
    const groups = groupsFor(lib, cat.kind);
    src = groups ? new GroupSource(ctx, list, nav, title, groups) : new TrackSource(ctx, list, nav, title, []);
  }
  src.icon = cat.icon;
  return src;
}

/** Category header: title, second line and the category icon. */
function bindCategoryHeader(src, v, line2) {
  v.findViewById('title')?.setText(src.title);
  v.findViewById('line2')?.setText(line2);
  v.findViewById('aa_image')?.setDrawable?.(src.icon ? src.ctx.drawables.fromValue(src.icon, src.ctx.theme) : null);
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

  // Groups are sorted by name: the scroller shows A–Z.
  get sortedByName() { return true; }
  sectionTitle(i) { return this.groups[i]?.title; }

  bindHeader(v) {
    bindCategoryHeader(this, v, '');
  }

  bindItem(v, i) {
    const g = this.groups[i];
    const first = g.tracks[0];
    v.bind({id: 'group:' + g.kind + ':' + g.title, title: g.title, artist: g.kind === 'album' ? g.artist : `${g.tracks.length}`, art: first?.art, thumb: first?.thumb, artId: first?.artId, meta: ''});
  }

  onItemClick(i) {
    const g = this.groups[i];
    const src = new TrackSource(this.ctx, this.nav.list, this.nav, g.title, g.tracks);
    src.icon = this.icon;
    this.nav.open(src);
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
    v.bind(this.tracks[i]);
  }

  onItemClick(i) {
    const p = this.ctx.player;
    p.setQueue(this.tracks, i);
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
  const tracks = pool.filter(x => key(x) === k);
  const title = kind === 'album' ? t.album || 'Unknown album' : kind === 'folder' ? (k.split('/').pop() || k) : k;
  const src = new TrackSource(ctx, list, nav, title, tracks);
  src.icon = {artist: '?artists', album: '?albums', folder: '?folders', genre: '?genres'}[kind];
  return src;
}

/**
 * Search results for a query in a category: songs match title, artist or
 * album; other categories list matching groups (each opens its tracks).
 */
export function searchSource(ctx, list, nav, query, kind = 'all') {
  const q = query.trim().toLocaleLowerCase();
  const lib = ctx.library;
  const pool = lib?.tracks?.length ? lib.tracks : ctx.player?.queue ?? [];
  const has = s => !!s && s.toLocaleLowerCase().includes(q);
  const title = ctx.res.stringByName('search') ?? 'Search';
  const bare = src => { src.header = null; src.headerHeight = 0; return src; };
  if (!q) return bare(new TrackSource(ctx, list, nav, title, []));
  if (kind === 'all' || kind === 'songs') {
    return bare(new TrackSource(ctx, list, nav, title, pool.filter(t => has(t.title) || has(t.artist) || has(t.album) || (kind === 'all' && (has(t.genre) || has(t.composer))))));
  }
  const groups = (lib?.tracks?.length ? groupsFor(lib, kind) : null) ?? group(pool, {
    albums: t => t.album || 'Unknown album', artists: t => t.artist || 'Unknown artist',
    genres: t => t.genre || 'Unknown genre', folders: t => t.folder || '/', composers: t => t.composer || 'Unknown composer',
  }[kind] ?? (t => t.title), kind);
  return bare(new GroupSource(ctx, list, nav, title, groups.filter(g => has(g.title))));
}

/** Playlists category: each playlist (name, track count) opens its tracks. */
export function playlistsSource(ctx, list, nav) {
  const P = ctx.playlists;
  const groups = (P?.sorted() ?? []).map(pl => ({kind: 'playlist', title: pl.name, tracks: P.tracksOf(pl), pl}));
  const src = new GroupSource(ctx, list, nav, str(ctx, 'playlists'), groups);
  src.icon = '?playlists';
  src.isPlaylists = true;
  src.onItemClick = i => { const s2 = playlistSource(ctx, list, nav, groups[i].pl); if (s2) nav.open(s2); };
  return src;
}

/** A playlist's tracks in playlist order. */
export function playlistSource(ctx, list, nav, pl) {
  const P = ctx.playlists;
  if (!P || !pl) return null;
  // Entries whose track left the library are skipped; entryIndex maps rows to entries.
  const tracks = [], entryIndex = [];
  pl.ids.forEach((id, i) => { const t = ctx.library.byId.get(id); if (t) { tracks.push(t); entryIndex.push(i); } });
  const src = new TrackSource(ctx, list, nav, pl.name, tracks);
  src.icon = '?playlists';
  src.playlist = pl;
  src.entryIndex = entryIndex;
  return src;
}
