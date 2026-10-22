// List memory (folders / playlists keep_list_pos and keep_track_pos;
// notebook F46). Each folder and playlist has two flags, set in its List
// Options (List Memory: List Position, Per Track Progress):
// - List Position (keep_list_pos): a list started without a picked track
//   (header Play / Shuffle, a category list's Play, previous / next category)
//   starts at its most recently played entry (zf1 / ri1.h0: MAX(played_at)
//   of folder_files / playlist_entries; pi1.moveFilesCursorToListMemorizedPosition).
// - Per Track Progress (keep_track_pos): its tracks start where they were
//   left (pi1.shouldRestorePerTrackPos), whatever restore_pos says.
// Folder rows show the flags as their meta icon ((keep_track_pos << 1) +
// keep_list_pos); playlist rows show List Position only (d61: column 5).
// Keys: 'folder:<path>' and 'pl:<id>'. Stored in the library's state store
// (lm:<key>) as {bits, played} (played: the playlist entry's track id last
// played from that playlist, its playlist_entries.played_at).

export const KEEP_LIST = 1, KEEP_TRACK = 2;

/** The memory key of a category entry (a folder or playlist group, a hierarchy folder), or null. */
export function listKeyOf(g) {
  if (!g) return null;
  if (g.pl) return 'pl:' + g.pl.id;
  if (g.kind === 'folder' && g.path != null) return 'folder:' + g.path;
  return null;
}

/** The memory key of the entry a play category points at. */
export function categoryKey(category) {
  return listKeyOf(category?.source?.groups?.[category.index]);
}

export class ListMemory {
  constructor(ctx, library) {
    this.ctx = ctx;
    this.library = library;
    this.items = new Map();
    ctx.listMemory = this;
  }

  get db() { return this.library?.db; }

  async load() {
    if (!this.db?.stateEntries) return;
    const rows = await this.db.stateEntries('lm:').catch(() => []);
    for (const [k, v] of rows) if (v && typeof v === 'object') this.items.set(k.slice(3), v);
  }

  save(key) {
    const v = this.items.get(key);
    this.db?.setState?.('lm:' + key, v ?? null)?.catch?.(() => {});
  }

  flags(key) {
    return key ? (this.items.get(key)?.bits ?? 0) : 0;
  }

  /** cmd_data_set_list_meta: sets or clears one flag. */
  setFlag(key, bit, on) {
    if (!key) return;
    const v = this.items.get(key) ?? {bits: 0, played: null};
    v.bits = on ? v.bits | bit : v.bits & ~bit;
    this.items.set(key, v);
    this.save(key);
    this.ctx.bus.post('bus_data', 'msg_data_list_meta_changed', this, {key});
  }

  /** A track started from a playlist (playlist_entries.played_at). */
  played(key, t) {
    if (!key?.startsWith('pl:') || !t) return;
    const v = this.items.get(key) ?? {bits: 0, played: null};
    if (v.played === t.id) return;
    v.played = t.id;
    this.items.set(key, v);
    this.save(key);
  }

  /**
   * The memorized entry of a list's tracks: a playlist's last played entry,
   * a folder's most recently played file; -1 without List Position or a
   * played entry.
   */
  position(key, tracks) {
    if (!(this.flags(key) & KEEP_LIST) || !tracks?.length) return -1;
    if (key.startsWith('pl:')) {
      const id = this.items.get(key)?.played;
      return id ? tracks.findIndex(t => t.id === id) : -1;
    }
    let best = -1, at = 0;
    tracks.forEach((t, i) => { if ((t.lastPlayed ?? 0) > at) { at = t.lastPlayed; best = i; } });
    return best;
  }

  /** Where a list started without a picked track begins: the memorized entry, else dflt. */
  start(key, tracks, dflt = 0) {
    const i = this.position(key, tracks);
    return i >= 0 ? i : dflt;
  }
}
