// User playlists, kept in the library's state store (pl:<id>): name, track
// ids in order, created and modified times. New playlists are named
// "Playlist N" (playlist_root_word), renamed from the playlist's menu.
// Adding follows the insert position (top, bottom, shuffled into the list)
// and pl_no_dups (off by default: duplicates are allowed). Playlists imported
// from files keep the file name (path) and may hold unresolved entries
// (path:<path>, playlist-files.js) that do not play.

import {autoResolve, UNRESOLVED} from './playlist-files.js';

export const INSERT_BOTTOM = 0, INSERT_TOP = 1, INSERT_SHUFFLED = 2;
export const SORT_NAME = 0, SORT_ADDED = 0x40000001, SORT_NUM_TRACKS = 0x40000002, SORT_MODIFIED = 0x40000003;

export class Playlists {
  constructor(ctx, library) {
    this.ctx = ctx;
    this.library = library;
    this.items = [];
    ctx.playlists = this;
    // pl_auto_resolve: a changed library resolves waiting entries again.
    ctx.bus.subscribe('bus_library', () => { if (this.items.length) autoResolve(ctx); });
  }

  async load() {
    const db = this.library.db;
    if (!db?.stateEntries) return;
    const rows = await db.stateEntries('pl:').catch(() => []);
    this.items = rows.map(([, v]) => v).filter(p => p && p.id && Array.isArray(p.ids));
    this.changed();
  }

  changed(pl = null) {
    this.ctx.bus.post('bus_data', 'msg_playlists_changed', this, {playlist: pl});
  }

  save(pl) {
    pl.modified = Date.now();
    this.library.db?.setState('pl:' + pl.id, pl).catch(() => {});
    this.changed(pl);
  }

  sorted(mode = SORT_NAME) {
    const list = [...this.items];
    if (mode === SORT_ADDED) return list.sort((a, b) => b.created - a.created);
    if (mode === SORT_MODIFIED) return list.sort((a, b) => b.modified - a.modified);
    if (mode === SORT_NUM_TRACKS) return list.sort((a, b) => b.ids.length - a.ids.length);
    return list.sort((a, b) => a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}));
  }

  get(id) {
    return this.items.find(p => p.id === id) ?? null;
  }

  /** A new empty playlist with the next free "Playlist N" name. */
  create(name = null) {
    const root = this.ctx.res.stringByName('playlist_root_word') ?? 'Playlist';
    if (!name) {
      let n = this.items.length + 1;
      const names = new Set(this.items.map(p => p.name));
      while (names.has(`${root} ${n}`)) n++;
      name = `${root} ${n}`;
    }
    const now = Date.now();
    const pl = {id: now.toString(36) + Math.random().toString(36).slice(2, 6), name, ids: [], created: now, modified: now};
    this.items.push(pl);
    this.save(pl);
    return pl;
  }

  rename(pl, name) {
    pl.name = name.trim() || pl.name;
    this.save(pl);
  }

  remove(pl) {
    this.items = this.items.filter(p => p !== pl);
    this.library.db?.deleteState?.('pl:' + pl.id).catch?.(() => {});
    this.changed(pl);
  }

  /** Adds tracks at the insert position; returns how many were added. */
  add(pl, tracks, pos = INSERT_BOTTOM) {
    const noDups = this.ctx.settings?.pl_no_dups === true;
    const have = new Set(pl.ids);
    const ids = tracks.map(t => t.id).filter(id => !noDups || !have.has(id));
    if (!ids.length) return 0;
    if (pos === INSERT_TOP) pl.ids.unshift(...ids);
    else if (pos === INSERT_SHUFFLED) {
      for (const id of ids) pl.ids.splice(Math.floor(Math.random() * (pl.ids.length + 1)), 0, id);
    } else pl.ids.push(...ids);
    this.save(pl);
    return ids.length;
  }

  removeAt(pl, indices) {
    const drop = new Set(indices);
    pl.ids = pl.ids.filter((_, i) => !drop.has(i));
    this.save(pl);
  }

  /** The playlist's entries in a new order (drag reordering). */
  reorder(pl, ids) {
    pl.ids = ids;
    this.save(pl);
  }

  move(pl, from, to) {
    const [id] = pl.ids.splice(from, 1);
    pl.ids.splice(to, 0, id);
    this.save(pl);
  }

  /** The playlist's tracks that are in the library (missing entries skipped). */
  tracksOf(pl) {
    const byId = this.library.byId;
    return pl.ids.map(id => byId.get(id)).filter(Boolean);
  }
}
