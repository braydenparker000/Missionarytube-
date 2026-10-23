// Playback model: the queue, the current track, play state and position, with
// the reference's player command/state messages on the message bus.
// bus_player_cmd carries commands in; bus_player carries state changes out.
import {trackTitle, artistLabel, albumLabel} from '../library/labels.js';
import {DeckFader, fadePrefs, gaplessPair, replayGainOf, AUTO_NONE, AUTO_NON_GAPLESS, AUTO_SHUFFLED, MANUAL_SHORT, MANUAL_CROSSFADE} from './fades.js';
import {listKeyOf, categoryKey, KEEP_TRACK} from '../library/list-memory.js';

// Reference mode enums (integers SHUFFLE_* / REPEAT_*).
export const SHUFFLE_NONE = 0, SHUFFLE_ALL = 1, SHUFFLE_SONGS = 2, SHUFFLE_CATS = 3, SHUFFLE_SONGS_AND_CATS = 4;
export const REPEAT_NONE = 0, REPEAT_ON = 1, REPEAT_ADVANCE = 2, REPEAT_SONG = 3, SINGLE_SONG = 4, REPEAT_ADVANCE_AND_STOP = 5;
export const STATE_STOPPED = 0, STATE_PLAYING = 1, STATE_PAUSED = 2;

/** Reference time label: m:ss, or h:mm:ss from an hour; "-:--" for unknown. */
export function formatTime(seconds, unknownIfZero = false) {
  if (seconds < 0 || (seconds === 0 && unknownIfZero)) return '-:--';
  const s = seconds % 60;
  let out;
  if (seconds < 3600) out = Math.trunc(seconds / 60) + ':';
  else {
    const m = Math.trunc(seconds / 60) % 60;
    out = Math.trunc(seconds / 3600) + ':' + (m < 10 ? '0' : '') + m + ':';
  }
  return out + (s < 10 ? '0' : '') + s;
}

export const msToLabelSeconds = ms => Math.trunc((ms + 500) / 1000);

const fisherYates = a => {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/**
 * Shuffle order (ie.W): with shuffle_random_factor y < 1 and more than 4
 * tracks, the tracks played longest ago come first — those with played_at at
 * or below a threshold (the played_at at offset round(n·y) in played_at
 * order; from 10000 tracks min + (max − min)·y), each part shuffled.
 * y = 1 shuffles fully.
 */
/** A CUE track's start in its disc image (F77); 0 for other tracks. */
const rangeStart = t => t?.startMs || 0;

export function shuffleOrder(tracks, factor) {
  const n = tracks.length, idx = [...Array(n).keys()];
  const y = Math.max(0, Math.min(1, Number.isFinite(+factor) ? +factor : 0.5));
  if (y >= 1 || n <= 4) return fisherYates(idx);
  const played = i => +(tracks[i].lastPlayed || 0);
  let thr;
  if (n >= 10000) {
    let lo = Infinity, hi = -Infinity;
    for (const i of idx) { const p = played(i); if (p < lo) lo = p; if (p > hi) hi = p; }
    thr = lo + Math.trunc((hi - lo) * y);
  } else {
    const sorted = idx.map(played).sort((a, b) => a - b);
    thr = sorted[Math.min(n - 1, Math.round(n * y))];
  }
  const older = idx.filter(i => played(i) <= thr), newer = idx.filter(i => played(i) > thr);
  return [...fisherYates(older), ...fisherYates(newer)];
}

export class Player {
  constructor(ctx) {
    this.ctx = ctx;
    this.queue = [];
    this.index = -1;
    // The Queue (ui1; notebook F65): entries {track, created, played}. An
    // entry is unplayed until its track starts playing after it was added.
    // In queue mode the entries are the playing list and savedNP is the list
    // to return to.
    this.entries = [];
    this.queueMode = false;
    this.savedNP = null;
    this.state = STATE_STOPPED;
    this.shuffle = 0;
    this.repeat = 1;
    // Two media elements (decks): a crossfade plays the next track on the
    // other one while this one fades out. this.audio is the current deck.
    this.decks = typeof Audio === 'function' ? [new Audio(), new Audio()] : [];
    this.audio = this.decks[0] ?? null;
    this.fader = new DeckFader(ctx);
    // Tracks without a media source play on a virtual clock (demo content).
    this.virtualStart = 0;
    this.virtualPos = 0;
    for (const el of this.decks) {
      el.preload = 'auto';
      // CORS media so the DSP and visualization can process remote streams.
      el.crossOrigin = 'anonymous';
      el.addEventListener('ended', () => { if (el === this.audio) this.trackEnded(); });
      el.addEventListener('timeupdate', () => { if (el === this.audio) { this.checkRangeEnd(); this.checkPlayed(); this.checkCrossfade(); } });
      el.addEventListener('loadedmetadata', () => {
        if (el !== this.audio) return;
        const t = this.track;
        const ms = Number.isFinite(el.duration) ? Math.round(el.duration * 1000) : 0;
        // A CUE track's length is its range; the last one ends with the image.
        if (t?.cueOf) {
          if (!t.endMs && ms) { t.durationMs = Math.max(0, ms - rangeStart(t)); this.post('msg_player_track_changed', {track: t, meta: true}); }
          return;
        }
        // The decoder's length, as the reference's Duration shows it, whenever the label would differ.
        if (t && ms && (Math.abs((t.durationMs || 0) - ms) > 1000 || msToLabelSeconds(t.durationMs || 0) !== msToLabelSeconds(ms))) {
          t.durationMs = ms;
          this.ctx.library?.rememberDuration(t, ms);
          this.post('msg_player_track_changed', {track: t, meta: true});
        }
      });
    }
    ctx.bus.subscribe('bus_player_cmd', (msg, src, data) => this.command(msg, data ?? {}));
    // A picked cover for the playing track shows at once.
    ctx.bus.subscribe('bus_data', (msg, src, d) => {
      const t = this.track;
      if (msg !== 'msg_data_art_changed' || !t || !d?.tracks?.some(x => x.id === t.id)) return;
      t.art = null;
      ctx.library?.artFor(t).then(art => { if (this.track === t) { t.art = art; this.post('msg_player_track_changed', {track: t, meta: true}); } });
    });
    // ReplayGain settings apply to the playing track at once.
    ctx.bus.subscribe('bus_app', (msg, src, d) => {
      if (msg === 'msg_app_setting_changed' && /^rg_/.test(d?.key ?? '') && this.audio && this.isMedia(this.track)) this.ctx.dsp?.setReplayGain?.(this.audio, replayGainOf(this.ctx, this.track));
    });
    ctx.player = this;
  }

  get track() {
    return this.queue[this.index] ?? null;
  }

  /** The Queue's tracks in entry order (the Queue list). */
  get userQueue() {
    return this.entries.map(e => e.track);
  }

  /**
   * state_player_queue_counter (k51): "position / total" while the Queue
   * plays, else "played / total" (ui1.w1), "empty" without entries.
   */
  queueCounter(emptyText) {
    const n = this.entries.length;
    if (!n) return emptyText;
    if (this.queueMode) {
      const at = this.entries.findIndex(e => e.track === this.track);
      if (at >= 0) return `${at + 1} / ${n}`;
    }
    return `${n - this.unplayedCount} / ${n}`;
  }

  get unplayedCount() {
    return this.entries.reduce((n, e) => n + (e.played ? 0 : 1), 0);
  }

  /** Unplayed Queue entries wait while another list plays (mHasPendingQueue). */
  get pendingQueue() {
    return !this.queueMode && this.unplayedCount > 0;
  }

  /** queue_start: 1 immediately, 2 after the current song (default), 3 after the current list. */
  get queueStart() {
    return +(this.ctx.pref?.('queue_start') ?? 2) || 2;
  }

  /**
   * Repeat modes that wrap the list: repeat on, and advance when there is no
   * category to advance to (the reference's next(): a plain files list).
   */
  get wraps() {
    return this.repeat === REPEAT_ON || (this.repeat === REPEAT_ADVANCE && !this.category);
  }

  /** Category navigation: a queue from a category's list, not in shuffle-all mode. */
  get categoryNavigable() {
    return this.queueMode || (!!this.category && this.shuffle !== SHUFFLE_ALL);
  }

  /** Title of the category rel steps away (wrapping), or null. */
  categoryTitle(rel) {
    const c = this.category;
    if (!this.categoryNavigable) return null;
    // In the Queue the neighbouring "category" is leaving it (qq0.n: exit_queue).
    if (this.queueMode) return rel === 0 ? this.ctx.res?.stringByName('queue') ?? 'Queue' : this.ctx.res?.stringByName('exit_queue') ?? 'Leave queue';
    const n = c.source.count;
    if (n < 2 && rel !== 0) return null;
    const order = this.categoryOrder(), pos = order.indexOf(c.index);
    const i = order[((pos + rel) % n + n) % n];
    return c.source.groups?.[i]?.title ?? c.source.sectionTitle?.(i) ?? null;
  }

  /**
   * Plays the next category's first track (nextCategory): wraps to the first
   * category when wrap and there are at least two; returns false at the end.
   */
  nextCategory(wrap = true) {
    const c = this.category;
    if (this.queueMode) return this.exitQueue();
    if (!this.categoryNavigable) return false;
    const n = c.source.count, order = this.categoryOrder();
    let pos = order.indexOf(c.index) + 1;
    if (pos >= n) { if (!wrap || n <= 1) return false; pos = 0; }
    return this.loadCategory(order[pos], false);
  }

  /** Plays the previous category (prevCategory, always wrapping), from its last track when last. */
  prevCategory(last = false) {
    const c = this.category;
    if (this.queueMode) return this.exitQueue();
    if (!this.categoryNavigable) return false;
    const n = c.source.count;
    if (n <= 0) return false;
    const order = this.categoryOrder(), pos = order.indexOf(c.index);
    return this.loadCategory(order[pos > 0 ? pos - 1 : n - 1], last);
  }

  /**
   * Plays the first or last category (playFirstCategory / playLastCategory)
   * and tells so with a toast.
   */
  edgeCategory(last) {
    const c = this.category;
    if (!c || !this.categoryNavigable || c.source.count <= 0) return false;
    if (!this.loadCategory(last ? c.source.count - 1 : 0, false)) return false;
    const name = last ? 'jumped_to_last_category' : 'jumped_to_first_category';
    this.ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {title: this.ctx.res?.stringByName(name) ?? name});
    return true;
  }

  loadCategory(i, last) {
    const c = this.category, tracks = c.source.tracksAt(i);
    if (!tracks?.length) return false;
    const playing = this.state === STATE_PLAYING;
    // A folder or playlist with List Position starts at its memorized entry
    // (pi1.loadFilesCursorFromCatCursor → moveFilesCursorToListMemorizedPosition; F46).
    const first = last ? tracks.length - 1 : this.ctx.listMemory?.start(listKeyOf(c.source.groups?.[i]), tracks, 0) ?? 0;
    this.setQueue(tracks, first, {source: c.source, index: i});
    if (playing) this.play();
    return true;
  }

  /** Songs play shuffled in Shuffle All / Songs / Songs and Categories (Shuffle Categories keeps them in order). */
  get songsShuffled() {
    return this.shuffle !== SHUFFLE_NONE && this.shuffle !== SHUFFLE_CATS;
  }

  /** Categories advance in a shuffled order in Shuffle Categories / Songs and Categories. */
  get catsShuffled() {
    return this.shuffle === SHUFFLE_CATS || this.shuffle === SHUFFLE_SONGS_AND_CATS;
  }

  /** Play order: the queue order, or a permutation when shuffling (current track first). */
  ensureOrder() {
    const n = this.queue.length;
    if (this.order?.length === n && this.orderShuffle === this.shuffle && this.orderQueueMode === this.queueMode) return;
    let order = [...Array(n).keys()];
    // queue_no_shuffle: the Queue always plays in order.
    if (this.songsShuffled && !(this.queueMode && this.ctx.pref?.('queue_no_shuffle'))) {
      order = shuffleOrder(this.queue, +(this.ctx.pref?.('shuffle_random_factor') ?? 0.5));
      const at = order.indexOf(this.index);
      if (at > 0) [order[0], order[at]] = [order[at], order[0]];
    }
    this.order = order;
    this.orderShuffle = this.shuffle;
    this.orderQueueMode = this.queueMode;
  }

  /** Category play order: shuffled (current first) in the category shuffle modes, else in order. */
  categoryOrder() {
    const c = this.category, n = c?.source.count ?? 0;
    const key = c ? `${n}|${this.shuffle}` : null;
    if (this.catOrder && this.catOrderKey === key && this.catOrderSource === c?.source) return this.catOrder;
    let order = [...Array(n).keys()];
    if (this.catsShuffled && n > 1) {
      const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
      // A source may put some categories first (cg1.W: the playing level's folders), the current one leading.
      const first = c.source.shuffleFirst;
      order = first ? [...shuffle([...first].filter(i => i !== c.index)), ...shuffle(order.filter(i => !first.has(i) && i !== c.index))] : shuffle(order.filter(i => i !== c.index));
      order.unshift(c.index);
    }
    this.catOrder = order;
    this.catOrderKey = key;
    this.catOrderSource = c?.source ?? null;
    return order;
  }

  /** Queue index rel steps away in play order (null past the ends unless wrapping). */
  indexAt(rel, wrap = this.wraps) {
    const n = this.queue.length;
    if (!n) return null;
    this.ensureOrder();
    const pos = this.order.indexOf(this.index) + rel;
    if (pos < 0 || pos >= n) return wrap && n > 1 ? this.order[(pos % n + n) % n] : null;
    return this.order[pos];
  }

  /**
   * Track rel steps away in play order: queued tracks come right after the
   * current one. The pagers ask with list = true: the list's own neighbours,
   * which do not wrap (the reference's art and mini player pages end at the
   * list's ends whatever the repeat mode).
   */
  trackAt(rel, list = false) {
    if (rel === 0) return this.track;
    const wrap = list ? false : this.wraps;
    const at = i => (i === null ? null : this.queue[i] ?? null);
    // The Queue starts after the current song (queue_start 1 or 2): its
    // unplayed entries come next.
    if (rel > 0 && this.pendingQueue && this.queueStart !== 3 && !list) {
      const next = this.entries.filter(e => !e.played);
      if (rel <= next.length) return next[rel - 1].track;
      return at(this.indexAt(rel - next.length, wrap));
    }
    return at(this.indexAt(rel, wrap));
  }

  post(msg, data) {
    this.ctx.bus.post('bus_player', msg, this, data);
  }

  /**
   * Sets the play queue. category is the list of categories the tracks came
   * from ({source, index}: a library list with tracksAt(i) and titles) for
   * category navigation, or null.
   */
  setQueue(tracks, index = 0, category = null, autoplay = false) {
    this.queue = tracks;
    this.category = category;
    // Another list leaves queue mode (the files entity is no longer the Queue).
    if (!this.enteringQueue) { this.queueMode = false; this.savedNP = null; }
    this.post('msg_player_category_changed');
    this.order = null;
    this.load(Math.max(0, Math.min(index, tracks.length - 1)), autoplay);
  }

  /**
   * A track picked from the playing list (onItemClick): the shuffle order is
   * kept with no_reshuffle, and for lists over 20000 tracks with
   * no_reshuffle_for_large_lists; otherwise the list starts over (a new
   * shuffle). Returns false when the list is not the playing one.
   */
  selectInList(tracks, index, category) {
    const same = tracks === this.queue || (tracks.length === this.queue.length && tracks.every((t, i) => t.id === this.queue[i]?.id));
    if (!same || this.queueMode || !this.songsShuffled || !this.order) return false;
    const keep = !!this.ctx.pref?.('no_reshuffle') || (this.ctx.pref?.('no_reshuffle_for_large_lists') !== false && tracks.length > 20000);
    if (!keep) return false;
    this.category = category ?? this.category;
    this.load(index, this.state === STATE_PLAYING);
    return true;
  }

  /**
   * A new list around the playing track without restarting it (a list tap on
   * the playing track without list_action_resets): the queue, category and
   * shuffle order change, playback goes on.
   */
  adoptQueue(tracks, index, category = null) {
    this.queue = tracks;
    this.category = category;
    this.index = Math.max(0, Math.min(index, tracks.length - 1));
    this.order = null;
    this.queueMode = false;
    this.savedNP = null;
    this.post('msg_player_category_changed');
    this.post('msg_player_track_changed', {track: this.track, meta: true});
  }

  load(index, autoplay) {
    // A playing media track crossfades into the next one when the fade
    // settings ask for it (automatic advance armed by checkCrossfade, or a
    // manual change per fade_manual_advance).
    const prev = this.track, old = this.audio;
    // last_pos: the position the track is left at (0 within 2 s of its end).
    if (prev && this.isMedia(prev) && index !== this.index) {
      const pos = this.positionMs(), dur = prev.durationMs || 0;
      this.ctx.library?.rememberPosition?.(prev, pos >= 0 && dur && pos < dur - 2000 ? pos : 0);
    }
    const sounding = this.state === STATE_PLAYING && autoplay && this.isMedia(prev) && !!old?.src && !old.paused;
    const fadeMs = sounding ? this.transitionMs() : 0;
    this.xfadeAuto = 0;
    this.seekTarget = null;
    clearTimeout(this.silenceTimer);
    this.index = index;
    this.virtualPos = 0;
    this.virtualStart = performance.now();
    const t = this.track;
    const token = this.loadToken = (this.loadToken ?? 0) + 1;
    // restore_pos (p21 / shouldRestorePerTrackPos): a long track (or one from
    // the Long list) starts where it was left, unless an automatic crossfade
    // would begin right away.
    if (t && !this.pendingSeek && (t.lastPos ?? 0) > 0 && this.shouldRestorePos(t)) {
      const f = fadePrefs(this.ctx);
      if (!(f.auto !== AUTO_NONE && t.lastPos >= (t.durationMs || 0) - f.crossfadeMs - 2000)) this.pendingSeek = t.lastPos;
    }
    // The next contiguous CUE track of the playing image goes on without reloading (gapless).
    const onward = t?.cueOf && prev?.cueOf === t.cueOf && !fadeMs && !this.pendingSeek && old === this.audio && !!old?.src && !old.paused
      && Math.abs(old.currentTime * 1000 - rangeStart(t)) < 1500;
    if (onward) t.src = prev.src;
    if (this.audio && !onward) {
      const media = t && (t.src || t.libraryId || this.ctx.library?.byId.has(t.id));
      let fadeIn = 0;
      if (fadeMs > 0 && media && this.decks.length > 1) {
        const next = this.decks.find(d => d !== old);
        this.fader.stop(next);
        next.pause();
        next.removeAttribute('src');
        this.audio = next;
        this.fader.set(next, 0);
        this.fader.ramp(old, 0, fadeMs, () => {
          if (old === this.audio) return;
          old.pause();
          old.removeAttribute('src');
          this.fader.set(old, 1);
        });
        fadeIn = fadeMs;
      } else {
        for (const d of this.decks) if (d !== this.audio) { this.fader.stop(d); d.pause(); d.removeAttribute('src'); }
        this.fader.set(this.audio, 1);
        this.audio.removeAttribute('src');
      }
      if (media) {
        const el = this.audio;
        this.ctx.dsp?.setReplayGain?.(el, replayGainOf(this.ctx, t));
        const ready = t.src ? Promise.resolve(t.src) : this.ctx.library.mediaUrl(t);
        ready.then(url => {
          if (token !== this.loadToken || !url) return;
          t.src = url;
          el.src = url;
          // A CUE track starts at its range.
          const at = (this.pendingSeek || 0) + rangeStart(t);
          if (at) el.currentTime = at / 1000;
          this.pendingSeek = 0;
          if (this.state === STATE_PLAYING) {
            this.ctx.dsp?.attach(el);
            el.play().catch(() => {});
            if (fadeIn) this.fader.ramp(el, 1, fadeIn);
          }
        });
      }
    }
    if (t && !t.art && (t.artId || this.ctx.library?.customArt?.size) && this.ctx.library) {
      this.ctx.library.artFor(t).then(art => {
        if (!art || token !== this.loadToken) return;
        t.art = art;
        this.post('msg_player_track_changed', {track: t, meta: true});
      });
    }
    this.ctx.library?.ensureWave?.(t);
    this.armRange();
    // playlist_entries.played_at: the entry List Position returns to.
    this.ctx.listMemory?.played(this.listKey, t);
    this.post('msg_player_track_changed', {track: t});
    if (autoplay) this.setState(STATE_PLAYING);
    if (this.state === STATE_PLAYING) this.markQueuePlayed(t);
    if (t && !t.wave && this.ctx.library?.byId.has(t.id)) {
      this.ctx.library.waveFor(t).then(w => {
        if (w && token === this.loadToken) this.post('msg_player_track_wave', {track: t});
      });
    }
  }

  /** The memory key of the playing folder or playlist (List Memory, F46), or null. */
  get listKey() {
    return this.queueMode ? null : categoryKey(this.category);
  }

  shouldRestorePos(t) {
    if (this.ctx.listWidget?.queueStack?.at(-1)?.kind === 'long') return true;
    // Per Track Progress (keep_track_pos) overrides restore_pos.
    if (this.ctx.listMemory?.flags(this.listKey) & KEEP_TRACK) return true;
    return !!this.ctx.pref?.('restore_pos') && (t.durationMs || 0) > (+(this.ctx.pref?.('restore_pos_min_dur') ?? 45) || 0) * 60000;
  }

  /**
   * The crossfade length of this track change: an armed automatic advance
   * (crossfade_auto_advance), none for other automatic advances, else
   * fade_manual_advance (short crossfade or crossfade).
   */
  transitionMs() {
    if (this.xfadeAuto) return this.xfadeAuto;
    if (this.advancing) return 0;
    const f = fadePrefs(this.ctx);
    return f.manual === MANUAL_SHORT ? f.shortXfadeMs : f.manual === MANUAL_CROSSFADE ? f.crossfadeMs : 0;
  }

  /** The track an automatic advance would play next (null when it would stop or is unknown). */
  predictNext() {
    if (this.sleepWaitsForEnd || this.repeat === REPEAT_SONG || this.repeat === SINGLE_SONG) return null;
    if (this.pendingQueue && (this.queueStart !== 3 || this.indexAt(1, false) === null)) return this.entries.find(e => !e.played)?.track ?? null;
    const i = this.queueMode ? this.indexAt(1, false) : this.indexAt(1);
    return i === null ? null : this.queue[i] ?? null;
  }

  /**
   * Automatic crossfade (crossfade_auto_advance): within crossfade_length_ms
   * of the end the next track starts on the other deck. Modes: all songs;
   * shuffled songs only with shuffle on; "non-gapless/cue" except gapless
   * pairs. A track no longer than the crossfade is not cut (inferred).
   */
  checkCrossfade() {
    const el = this.audio, t = this.track;
    if (this.state !== STATE_PLAYING || this.decks.length < 2 || !this.isMedia(t) || this.xfadeToken === this.loadToken) return;
    const f = fadePrefs(this.ctx);
    if (f.auto === AUTO_NONE || (f.auto === AUTO_SHUFFLED && !this.shuffle)) return;
    // A CUE track's own range (F77).
    const dur = (t.endMs ?? el.duration * 1000) - rangeStart(t), pos = el.currentTime * 1000 - rangeStart(t);
    if (!Number.isFinite(dur) || dur <= f.crossfadeMs || dur - pos > f.crossfadeMs) return;
    const next = this.predictNext();
    if (!next || (f.auto === AUTO_NON_GAPLESS && gaplessPair(t, next))) return;
    this.xfadeToken = this.loadToken;
    this.checkPlayed(true);
    this.xfadeAuto = Math.max(50, Math.round((dur - pos) / (el.playbackRate || 1)));
    this.onEnded();
    this.xfadeAuto = 0;
  }

  positionMs() {
    const t = this.track;
    if (!t) return 0;
    if (this.seekTarget !== null && this.seekTarget !== undefined) return this.seekTarget;
    if (this.isMedia(t)) return Math.max(0, Math.round(this.audio.currentTime * 1000) - rangeStart(t));
    const pos = this.state === STATE_PLAYING ? this.virtualPos + (performance.now() - this.virtualStart) : this.virtualPos;
    if (t.durationMs && pos >= t.durationMs) {
      queueMicrotask(() => this.onEnded());
      return t.durationMs;
    }
    return Math.round(pos);
  }

  /**
   * Play statistics: a track counts as played once played_dur percent of it
   * (default 50) has played, once per load.
   */
  checkPlayed(ended = false) {
    const t = this.track;
    if (!t || this.playedToken === this.loadToken || this.state !== STATE_PLAYING && !ended) return;
    const pct = Math.max(0, Math.min(100, +(this.ctx.settings?.played_dur ?? 50)));
    const dur = t.durationMs || 0;
    if (!ended && (!dur || this.positionMs() < (dur * pct) / 100)) return;
    this.playedToken = this.loadToken;
    this.ctx.library?.markPlayed(t);
  }

  /** True when the track plays through the media element (not the demo clock). */
  isMedia(t) {
    return !!(t && this.audio && (t.src || this.ctx.library?.byId.has(t.id)));
  }

  setState(s) {
    if (this.state === s) return;
    if (!this.isMedia(this.track)) {
      if (s === STATE_PLAYING) this.virtualStart = performance.now();
      else this.virtualPos = this.positionMs();
    }
    this.state = s;
    if (s === STATE_PLAYING) this.markQueuePlayed(this.track);
    // A sleep timer set while not playing starts with playback (k21: an.B pending).
    if (s === STATE_PLAYING && this.sleep && this.sleep.end === null) this.startSleepTimer();
    this.post('msg_player_playing_state_changed', {arg1: s, playing: s === STATE_PLAYING});
    this.post('msg_player_status_changed', {playing: s === STATE_PLAYING});
  }

  play() {
    if (!this.track) return;
    const resume = this.state !== STATE_PLAYING;
    // The DSP graph needs a user gesture; play is the first one that matters.
    if (this.audio && this.isMedia(this.track)) {
      for (const d of this.decks) this.ctx.dsp?.attach(d);
      this.ctx.dsp?.resume();
    }
    if (this.track.src && this.audio?.src) {
      // fade_play_pause: resuming fades in over fade_short_ms.
      const f = fadePrefs(this.ctx);
      // A seek left by a pause fade-out (Stop, then Play) lands before resuming.
      if (resume && this.seekTarget !== null && this.seekTarget !== undefined) { this.audio.currentTime = (this.seekTarget + rangeStart(this.track)) / 1000; this.seekTarget = null; }
      if (resume && f.playPause) {
        if (this.audio.paused) this.fader.set(this.audio, 0);
        this.fader.ramp(this.audio, 1, f.shortMs);
      } else this.fader.set(this.audio, 1);
      this.audio.play().catch(() => {});
    }
    this.setState(STATE_PLAYING);
  }

  pause() {
    if (this.isMedia(this.track)) {
      const el = this.audio, f = fadePrefs(this.ctx);
      // A crossfade's outgoing deck stops at once.
      for (const d of this.decks) if (d !== el) { this.fader.stop(d); d.pause(); }
      // fade_play_pause: pausing fades out over fade_short_ms, then pauses.
      if (f.playPause && this.state === STATE_PLAYING && !el.paused) {
        this.fader.ramp(el, 0, f.shortMs, () => {
          if (this.state === STATE_PLAYING || el !== this.audio) return;
          el.pause();
          // A seek made while fading out (Stop) lands now.
          if (this.seekTarget !== null && this.seekTarget !== undefined) { el.currentTime = (this.seekTarget + rangeStart(this.track)) / 1000; this.seekTarget = null; }
        });
      } else el.pause();
    }
    this.setState(STATE_PAUSED);
  }

  seek(ms) {
    const t = this.track;
    if (!t) return;
    ms = Math.max(0, Math.min(ms, t.durationMs || ms));
    if (this.isMedia(t)) {
      const el = this.audio, f = fadePrefs(this.ctx);
      if (!el.src) this.pendingSeek = ms;
      else if (f.seek && this.state === STATE_PLAYING && !el.paused) {
        // fade_seek: out over fade_seek_ms, the jump, then back in.
        this.seekTarget = ms;
        const token = this.loadToken;
        this.fader.ramp(el, 0, f.seekMs, () => {
          if (token !== this.loadToken || el !== this.audio) return;
          el.currentTime = (this.seekTarget + rangeStart(t)) / 1000;
          this.seekTarget = null;
          this.fader.ramp(el, 1, f.seekMs);
        });
      } else if (!el.paused && this.state !== STATE_PLAYING) {
        // Still fading out after a pause: the jump waits for the silence.
        this.seekTarget = ms;
      } else {
        this.seekTarget = null;
        el.currentTime = (ms + rangeStart(t)) / 1000;
      }
    } else {
      this.virtualPos = ms;
      this.virtualStart = performance.now();
    }
    this.post('msg_player_track_seek', {arg1: ms});
  }

  step(dir) {
    const playing = this.state === STATE_PLAYING;
    if (!this.queue.length && !this.pendingQueue) return;
    if (dir > 0) {
      // queue_start 1 / 2: the Queue starts on the next song.
      if (this.pendingQueue && this.queueStart !== 3) { this.startQueue(playing); return; }
      if (this.queueMode) { this.queueNext(playing, true); return; }
      // At the list's end the Queue starts before any repeat or advance (startQueueIfNeededOnList).
      if (this.pendingQueue && this.indexAt(1, false) === null) { this.startQueue(playing); return; }
    }
    let i = this.indexAt(dir);
    // Past the ends of a category's list: the next category's first track, or
    // the previous category's last one (the reference's next() / prev()).
    if (i === null && !this.queueMode && (dir > 0 ? this.nextCategory(this.repeat !== REPEAT_ADVANCE_AND_STOP) : this.prevCategory(true))) return;
    if (i === null) i = this.indexAt(0);
    this.load(i, playing);
  }

  /**
   * Next in queue mode: the next entry; at the end, queue_end 1 returns to
   * the list the Queue interrupted and goes on from it; 0 stays in the Queue,
   * repeating it with repeat on. Returns false at an end that stops.
   */
  queueNext(playing, manual) {
    const i = this.indexAt(1, false);
    if (i !== null) { this.load(i, playing); return true; }
    if (+(this.ctx.pref?.('queue_end') ?? 1) === 1) { this.exitQueue(playing); return true; }
    if (this.repeat === REPEAT_ON) { this.load(this.indexAt(0, false) === null ? 0 : this.order?.[0] ?? 0, playing); return true; }
    if (manual) this.load(this.index, playing);
    return false;
  }

  /** The Queue's entries in play order: entry order, or shuffled unless queue_no_shuffle. */
  queueOrderTracks() {
    return this.entries.map(e => e.track);
  }

  /**
   * Starts the Queue (startQueueImpl): the playing list is saved, the
   * entries become the list, playback goes to the first unplayed entry (or
   * the last), and a toast tells so.
   */
  startQueue(playing = this.state === STATE_PLAYING) {
    if (!this.unplayedCount) return false;
    if (!this.queueMode) this.savedNP = {queue: this.queue, index: this.index, category: this.category, order: this.order, orderShuffle: this.orderShuffle};
    const first = this.entries.findIndex(e => !e.played);
    this.enteringQueue = true;
    try {
      this.queue = this.queueOrderTracks();
      this.category = null;
      this.queueMode = true;
      this.order = null;
      this.post('msg_player_category_changed');
      this.load(first >= 0 ? first : this.entries.length - 1, playing);
    } finally { this.enteringQueue = false; }
    this.queueToast(true);
    this.postQueueChanged();
    return true;
  }

  /** Leaves the Queue (exitQueueImpl): back to the saved list, then on to its next track. */
  exitQueue(playing = this.state === STATE_PLAYING) {
    const np = this.savedNP;
    this.queueMode = false;
    this.savedNP = null;
    if (!np?.queue?.length) { this.pause(); this.postQueueChanged(); return false; }
    this.queue = np.queue;
    this.index = np.index;
    this.category = np.category;
    this.order = np.order;
    this.orderShuffle = np.orderShuffle;
    this.post('msg_player_category_changed');
    this.queueToast(false);
    this.postQueueChanged();
    let i = this.indexAt(1);
    if (i === null && this.nextCategory(this.repeat !== REPEAT_ADVANCE_AND_STOP)) return true;
    if (i === null) { i = this.index; playing = false; }
    this.load(i, playing);
    return true;
  }

  queueToast(started) {
    const name = started ? 'started_queue' : 'exited_queue';
    this.ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {title: this.ctx.res?.stringByName(name) ?? name, icon: '?toast_queue', ms: 1000});
  }

  /** msg_player_queue_changed with the reference's stats: unplayed and total entries. */
  postQueueChanged() {
    this.post('msg_player_queue_changed', {arg1: this.unplayedCount, arg2: this.entries.length});
  }

  /** A track starting to play marks its waiting Queue entries played. */
  markQueuePlayed(t) {
    if (!t || !this.entries.length) return;
    let changed = false;
    for (const e of this.entries) if (!e.played && e.track.id === t.id) { e.played = true; changed = true; }
    if (changed) this.postQueueChanged();
  }

  /** The playing track reached its end (the media's, or a CUE range's). */
  trackEnded() {
    this.checkPlayed(true);
    // track_end_silence_ms: silence after the track before the next one.
    const gap = fadePrefs(this.ctx).endSilenceMs;
    if (gap > 0) { clearTimeout(this.silenceTimer); this.silenceTimer = setTimeout(() => this.onEnded(), gap); } else this.onEnded();
  }

  /**
   * The end of a CUE track's range (F77): the next contiguous track of the
   * same image plays on from here (gapless); anything else stops the image
   * first.
   */
  checkRangeEnd() {
    const t = this.track, el = this.audio;
    if (!t?.endMs || !el || el.paused || this.rangeEnded === this.loadToken) return;
    if (el.currentTime * 1000 < t.endMs - 15) return;
    this.rangeEnded = this.loadToken;
    const next = this.predictNext();
    const onward = next?.cueOf === t.cueOf && next.startMs === t.endMs && !(fadePrefs(this.ctx).endSilenceMs > 0);
    if (!onward) { this.fader.stop(el); el.pause(); }
    this.trackEnded();
  }

  /** Polls a CUE track's range end between timeupdate events. */
  armRange() {
    clearInterval(this.rangeTimer);
    this.rangeTimer = this.track?.endMs ? setInterval(() => this.checkRangeEnd(), 30) : 0;
  }

  onEnded() {
    if (this.state !== STATE_PLAYING) return;
    // Track changes from here are automatic advances (no manual fade).
    this.advancing = true;
    try { this.advance(); } finally { this.advancing = false; }
  }

  advance() {
    if (this.sleepWaitsForEnd) {
      this.sleepWaitsForEnd = false;
      this.sleep = null;
      this.pause();
      this.step(1);
      this.sleepPaused();
      return;
    }
    if (this.repeat === REPEAT_SONG) { this.seek(0); return; }
    // The Queue: started after the song or the list; in queue mode, its end.
    if (this.pendingQueue && (this.queueStart !== 3 || this.indexAt(1, false) === null)) { this.startQueue(true); return; }
    if (this.queueMode) {
      if (this.repeat === SINGLE_SONG) { this.pause(); this.queueNext(false, false); return; }
      if (!this.queueNext(true, false)) { this.pause(); this.seek(0); }
      return;
    }
    // Advance modes go on to the next category at the end of the list.
    if (this.indexAt(1) === null && (this.repeat === REPEAT_ADVANCE || this.repeat === REPEAT_ADVANCE_AND_STOP)
      && this.nextCategory(this.repeat !== REPEAT_ADVANCE_AND_STOP)) return;
    // Single song: play one and pause; otherwise stop at the end unless the mode wraps.
    if (this.repeat === SINGLE_SONG || this.indexAt(1) === null) {
      this.pause();
      if (this.repeat !== SINGLE_SONG) this.seek(0);
      else this.step(1);
      return;
    }
    this.step(1);
  }

  command(msg, d) {
    switch (msg) {
      case 'cmd_player_toggle_playing':
        if (this.state === STATE_PLAYING) this.pause(); else this.play();
        break;
      case 'cmd_player_stop_playing':
        this.pause();
        this.seek(0);
        this.setState(STATE_STOPPED);
        break;
      case 'cmd_player_play_next_track': this.step(1); break;
      case 'cmd_player_play_prev_track':
        // previous_resets: past 5 s into a seekable track that is playing or paused, Previous restarts it.
        if (this.ctx.pref?.('previous_resets') && this.track && this.state !== STATE_STOPPED && this.positionMs() > 5000) this.seek(0);
        else this.step(-1);
        break;
      case 'cmd_player_play_next_category': this.nextCategory(true); break;
      case 'cmd_player_play_prev_category': this.prevCategory(false); break;
      case 'cmd_player_seek': this.seek(d.arg1 ?? 0); break;
      case 'cmd_player_play_first_category': this.edgeCategory(false); break;
      case 'cmd_player_play_last_category': this.edgeCategory(true); break;
      // A jump of 10 s, or d.ms while a jump button is held (10 s, then 20 s after 3 s).
      case 'cmd_player_seek_jump': this.seek(this.positionMs() + (d.arg1 ? 1 : -1) * (d.ms ?? 10000)); break;
      // Held ±10 s buttons: jumps every 250 ms, 10 s for 3 s, then 20 s, until the end command.
      case 'cmd_player_begin_seek_jumps': {
        clearTimeout(this.jumpTimer);
        const t0 = performance.now(), dir = d.arg1 ? 1 : -1;
        const step = () => {
          this.seek(this.positionMs() + dir * (performance.now() - t0 < 3000 ? 10000 : 20000));
          this.jumpTimer = setTimeout(step, 250);
        };
        step();
        break;
      }
      case 'cmd_player_end_seek_jumps': clearTimeout(this.jumpTimer); break;
      case 'cmd_player_set_shuffle_mode':
      case 'cmd_player_set_shuffle': this.shuffle = d.arg1 ?? 0; this.order = null; this.post('msg_player_shuffle_mode_changed', {arg1: this.shuffle}); break;
      // The reference's id (layouts post it) and this app's shorter one.
      case 'cmd_player_set_repeat_mode':
      case 'cmd_player_set_repeat': this.repeat = d.arg1 ?? 0; this.post('msg_player_repeat_mode_changed', {arg1: this.repeat}); break;
      case 'cmd_player_set_sleep_timer': this.setSleepTimer(d.arg1 ?? 0, !!d.arg2); break;
    }
  }

  /**
   * Adds tracks to the Queue (hs.y / pi1.onQueueUpdated):
   * - Play Next with q_next_forces_after_song sets queue_start to "after
   *   the current song";
   * - queue_clear_on_add clears the Queue first (keeping the playing entry,
   *   unless the Queue starts immediately); a Queue whose entries have all
   *   played is cleared too, unless queue_never_clear_on_add;
   * - Play Next inserts after the playing entry (queue mode) or before the
   *   other unplayed entries; Add appends; insert mode 2 shuffles the tracks
   *   added (enqueue_modes_args1);
   * - queue_start 1 starts the Queue now.
   */
  enqueue(tracks, next = false, mode = 0, {cleanAndPlay = false} = {}) {
    if (!tracks.length) return;
    const add = [...tracks];
    if (mode === 2) {
      for (let i = add.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [add[i], add[j]] = [add[j], add[i]];
      }
    }
    const pref = k => this.ctx.pref?.(k);
    if (next && pref('q_next_forces_after_song') !== false && this.queueStart !== 2) this.ctx.settingsUi?.setPref('queue_start', '2');
    const playingEntry = this.queueMode ? this.entries[this.index] : null;
    const clearOnAdd = !!pref('queue_clear_on_add');
    if (cleanAndPlay || clearOnAdd) {
      const keep = cleanAndPlay || (clearOnAdd && this.queueStart === 1) ? null : playingEntry;
      this.entries = keep ? [keep] : [];
    } else if (!playingEntry && !this.unplayedCount && !pref('queue_never_clear_on_add')) {
      this.entries = [];
    }
    const now = Date.now();
    const added = add.map(track => ({track, created: now, played: false}));
    if (next) {
      const at = playingEntry && this.entries.includes(playingEntry) ? this.entries.indexOf(playingEntry) + 1 : Math.max(0, this.entries.findIndex(e => !e.played));
      this.entries.splice(at === -1 ? this.entries.length : at, 0, ...added);
    } else this.entries.push(...added);
    if (!this.track && !this.queue.length) { this.startQueue(false); return; }
    this.queueUpdated(true);
  }

  /** The entries changed: the queue-mode list follows, and queue_start 1 starts the Queue now. */
  queueUpdated(added = false) {
    if (this.queueMode) {
      const t = this.track;
      const cur = this.entries.findIndex(e => e.track === t);
      this.queue = this.queueOrderTracks();
      this.order = null;
      if (cur >= 0) this.index = cur;
      else if (this.entries.length) { this.load(Math.max(0, this.entries.findIndex(e => !e.played)), this.state === STATE_PLAYING); }
    }
    this.postQueueChanged();
    if (added && this.pendingQueue && this.queueStart === 1) this.startQueue(this.state === STATE_PLAYING || !this.track);
  }

  /**
   * Plays tracks through a fresh Queue (clean_and_play: search results'
   * Play / Shuffle): the Queue is cleared, filled and started.
   */
  playAsQueue(tracks, shuffle = 0) {
    if (!tracks.length) return;
    this.command('cmd_player_set_shuffle', {arg1: shuffle});
    this.enqueue(tracks, false, 0, {cleanAndPlay: true});
    if (!this.queueMode) this.startQueue(true);
    else this.play();
  }

  /** Clears the Queue (cmd_data_clear_q); in queue mode the playing entry stays. */
  clearQueue() {
    const keep = this.queueMode ? this.entries[this.index] : null;
    this.entries = keep ? [keep] : [];
    if (this.queueMode) { this.queue = this.queueOrderTracks(); this.index = keep ? 0 : -1; this.order = null; }
    this.postQueueChanged();
  }

  /** The Queue in a new order (drag reordering: entry map[i] goes to place i). */
  reorderQueue(map) {
    const q = this.entries;
    if (map.length !== q.length) return;
    this.entries = map.map(i => q[i]);
    this.queueUpdated(false);
  }

  /** Back in queue mode after a restart, at the entry with trackId (the list is the saved one). */
  resumeQueueMode(trackId) {
    if (!this.entries.length) return;
    this.savedNP = {queue: this.queue, index: this.index, category: this.category, order: null};
    this.enteringQueue = true;
    try {
      this.queue = this.queueOrderTracks();
      this.category = null;
      this.queueMode = true;
      this.order = null;
      this.load(Math.max(0, this.entries.findIndex(e => e.track.id === trackId)), false);
    } finally { this.enteringQueue = false; }
  }

  /** Restores saved entries ({id, created, played}) with their tracks. */
  restoreQueue(saved, byId) {
    this.entries = (saved ?? []).map(e => (typeof e === 'string' ? {id: e, created: 0, played: false} : e))
      .map(e => ({track: byId.get(e.id), created: e.created ?? 0, played: !!e.played})).filter(e => e.track);
  }

  /**
   * Sleep timer (an.B; cmd_player_set_sleep_timer: arg1 seconds, arg2 play
   * the last song to its end). Set while playing, it counts in real time
   * (pausing does not stop it); set otherwise, it waits and starts its full
   * time when playback starts (end null meanwhile). On expiry (k21 21):
   * not playing, it just clears; playing, it pauses (or, playing to the end,
   * stops at the track's end) with the "Sleep Timer / Paused" toast (an.m1066).
   */
  setSleepTimer(seconds, playToEnd) {
    clearTimeout(this.sleepTimeout);
    this.sleepWaitsForEnd = false;
    this.sleep = seconds > 0 ? {seconds, end: null, playToEnd} : null;
    if (this.sleep && this.state === STATE_PLAYING) this.startSleepTimer();
    this.post('msg_player_sleep_timer', {arg1: seconds});
  }

  startSleepTimer() {
    const s = this.sleep;
    s.end = performance.now() + s.seconds * 1000;
    this.sleepTimeout = setTimeout(() => this.onSleepTimer(), s.seconds * 1000);
  }

  onSleepTimer() {
    const s = this.sleep;
    if (!s) return;
    if (this.state !== STATE_PLAYING) {
      this.sleep = null;
      this.post('msg_player_sleep_timer', {arg1: 0});
      return;
    }
    // Waits for the current track to end (advance pauses).
    if (s.playToEnd) { this.sleepWaitsForEnd = true; return; }
    this.sleep = null;
    this.pause();
    this.sleepPaused();
  }

  /** an.m1066: the timer ends with a toast. */
  sleepPaused() {
    const str = k => this.ctx.res?.stringByName(k) ?? k;
    this.post('msg_player_sleep_timer', {arg1: 0});
    this.ctx.bus.post('bus_gui', 'cmd_gui_show_toast', this, {title: str('sleep_timer'), line2: str('paused')});
  }

  /** Lock screen / headset controls through the Media Session API. */
  installMediaSession() {
    const ms = navigator.mediaSession;
    if (!ms) return;
    const handlers = {
      play: () => this.play(), pause: () => this.pause(),
      nexttrack: () => this.step(1), previoustrack: () => this.command('cmd_player_play_prev_track', {}),
      seekto: d => this.seek((d.seekTime ?? 0) * 1000),
      seekforward: () => this.seek(this.positionMs() + 10000), seekbackward: () => this.seek(this.positionMs() - 10000),
    };
    for (const [k, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(k, fn); } catch { /* unsupported action */ }
    }
    this.ctx.bus.subscribe('bus_player', (msg) => {
      const t = this.track;
      if (msg === 'msg_player_track_changed' && t && typeof MediaMetadata === 'function') {
        // The reference's media API labels (g30: m3733, m3740, y).
        ms.metadata = new MediaMetadata({title: trackTitle(this.ctx, t), artist: artistLabel(this.ctx, t), album: albumLabel(this.ctx, t), artwork: t.art ? [{src: t.art.url, sizes: `${t.art.width}x${t.art.height}`}] : []});
      } else if (msg === 'msg_player_playing_state_changed') {
        ms.playbackState = this.state === STATE_PLAYING ? 'playing' : 'paused';
      }
    });
  }
}
