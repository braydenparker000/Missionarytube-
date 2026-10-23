// Astra's app shell: four tabs that stay alive, a floating navigation bar,
// screens pushed over them (details, streams, catalogs), and the player.
// Every pushed screen is one history entry, so Android back walks them back.

import {createStorage, importClassic, Addons, Library, Watched, Progress, SAVE_FAILED} from './store.js';
import {fetchMeta, episodeCode, aired, MANIFEST_TIMEOUT} from './content.js';
import {swr, pruneCache} from './cache.js';
import {fetchManifest, normaliseManifest} from '../addons/client.js';
import {pushLayer, startBackStack} from './back-stack.js';
import {resolveDebrid} from '../addons/debrid.js';
import {fetchSubtitles, subtitleAddons} from '../addons/subtitles.js';
import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {toast} from '../ui/components.js';

const TABS = [
  {id: 'home', label: 'Home', icon: 'home'},
  {id: 'search', label: 'Search', icon: 'search'},
  {id: 'library', label: 'Library', icon: 'library'},
  {id: 'settings', label: 'Settings', icon: 'settings'},
];
const LABEL_SCROLL = 60; // px of scroll that hides or shows the bar's labels
// "Out 3 Nov" for an episode with a date to come; "Not out yet" without one.
const outOn = v => { const t = v?.released ? new Date(v.released) : null; return t && !Number.isNaN(t.getTime()) ? 'Out ' + t.toLocaleDateString(undefined, {month: 'short', day: 'numeric'}) : 'Not out yet'; };
const SETTINGS = {showCatalogType: true, posterWidth: 126, posterRadius: 12, hero: true};

export class App {
  constructor(root, screens) {
    this.root = root;
    // A write that cannot be saved is said once, after the caller's own message (which would hide it).
    this.store = createStorage(undefined, {onFail: reason => setTimeout(() => toast(SAVE_FAILED[reason]))});
    this.imported = importClassic(this.store);
    this.addons = new Addons(this.store);
    this.library = new Library(this.store);
    this.watched = new Watched(this.store);
    this.progress = new Progress(this.store);
    this.settings = {...SETTINGS, ...this.store.get('settings', {})};
    this.manifests = new Map();
    this.unreachable = new Map(); // enabled add-ons whose manifest could not be loaded: url -> the error
    this.addonListeners = new Set();
    this.stack = [];
    this.screenTypes = screens;
    startBackStack();
    this.build();
    this.reloadAddons();
    this.player = null; // loaded on first use (it brings the playback engine): see loadPlayer()
    // Leaving saves unsaved progress; with none it writes nothing (a reload after a restore must not undo it).
    addEventListener('pagehide', () => this.progress.flush(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.progress.flush(true); });
    // Back online: try the add-ons that could not be reached.
    addEventListener('online', () => { if (this.unreachable.size) this.reloadAddons(); });
    (globalThis.requestIdleCallback || (fn => setTimeout(fn, 4000)))(() => pruneCache().catch(() => {}));
    // Another Astra window (the installed app and a tab) changed add-ons or settings: follow it.
    this.addons.onChange(() => { this.reloadAddons(); this.screens.home?.load(); });
    this.store.watch('settings', () => this.reloadSettings());
  }

  /**
   * The player screen and its engine (with Mediabunny) load on first use, so
   * they do not slow the app's start. Screens that lead to playback call this
   * early, while the viewer is still choosing.
   */
  loadPlayer() {
    return this.playerLoading ??= import('../player/player-screen.js').then(({PlayerScreen}) => {
      this.player = new PlayerScreen({parent: this.root});
      this.bindPlayer();
      return this.player;
    }).catch(error => { this.playerLoading = null; throw error; });
  }

  /** Calls fn() whenever the set of add-on manifests changes (a late answer, a refresh, an edit). */
  onAddons(fn) { this.addonListeners.add(fn); return () => this.addonListeners.delete(fn); }
  addonsChanged() {
    clearTimeout(this.addonsTimer);
    this.addonsTimer = setTimeout(() => { for (const fn of this.addonListeners) fn(); }, 50);
  }

  /** Saves a change on top of the settings stored now, so another window's are kept. */
  saveSettings(patch) {
    const saved = {...this.store.get('settings', {}), ...patch};
    Object.assign(this.settings, saved);
    this.applySettings();
    return this.store.set('settings', saved);
  }
  reloadSettings() {
    const rows = s => JSON.stringify([s.hero, s.showCatalogType, s.hiddenRows]), before = rows(this.settings);
    for (const k of Object.keys(this.settings)) delete this.settings[k]; // in place: pages hold this object
    Object.assign(this.settings, SETTINGS, this.store.get('settings', {}));
    this.applySettings();
    if (rows(this.settings) !== before) this.screens.home?.load();
  }
  applySettings() {
    const s = this.root.style;
    s.setProperty('--poster-w', this.settings.posterWidth + 'px');
    s.setProperty('--poster-r', this.settings.posterRadius + 'px');
  }

  /**
   * Loads every enabled add-on's manifest; screens wait on this.ready.
   * Manifests saved from the last visit answer at once (refreshed in the
   * background). The wait ends when all have answered, or after 2.5 s once at
   * least one has; a later answer is announced through onAddons().
   */
  reloadAddons() {
    const addons = this.addons.enabled();
    const generation = this.addonGeneration = (this.addonGeneration || 0) + 1;
    const current = () => generation === this.addonGeneration;
    const manifests = new Map();
    this.manifests = manifests;
    const unreachable = this.unreachable = new Map();
    let settled = false;
    // Saved copies from before manifests were normalised are normalised on the way out too.
    const tasks = addons.map(a => swr('manifest:' + a.url, () => fetchManifest(a.url, {timeout: MANIFEST_TIMEOUT}), {maxAge: 6 * 3600 * 1000,
      onFresh: m => { if (current()) { manifests.set(a.url, normaliseManifest(m)); this.addonsChanged(); } }})
      .then(normaliseManifest)
      .then(m => { if (!current()) return; manifests.set(a.url, m); unreachable.delete(a.url); if (settled) this.addonsChanged(); },
        error => { if (current()) unreachable.set(a.url, error); }));
    const all = Promise.allSettled(tasks);
    const early = new Promise(resolve => setTimeout(() => { if (manifests.size) resolve(); }, 2500));
    this.ready = Promise.race([all, early]).then(() => { settled = true; return manifests; });
    all.then(() => { if (current() && settled) this.addonsChanged(); });
    return this.ready;
  }
  enabledAddons() { return this.addons.enabled(); }

  build() {
    this.applySettings();
    this.views = {};
    this.tabsEl = h('div', {class: 'tab-views'});
    for (const t of TABS) {
      const view = h('section', {class: 'tab-view' + (t.id === 'home' ? '' : ' off'), 'data-tab': t.id, 'aria-label': t.label});
      view.inert = t.id !== 'home';
      this.views[t.id] = view;
      this.tabsEl.append(view);
    }
    this.pill = h('span', {class: 'nav-pill', 'aria-hidden': 'true'});
    this.navButtons = TABS.map(t => h('button', {class: 'nav-item', type: 'button', 'data-tab': t.id, 'aria-label': t.label, onclick: () => this.selectTab(t.id, true)},
      icon(t.icon, {size: 26}), h('span', {class: 'nav-label'}, t.label)));
    this.nav = h('nav', {class: 'nav', 'aria-label': 'Astra'}, h('div', {class: 'nav-track'}, this.pill, ...this.navButtons));
    this.stackEl = h('div', {class: 'screen-stack'});
    this.root.append(this.tabsEl, this.nav, this.stackEl);
    this.tab = null;
    this.screens = {};
    for (const view of Object.values(this.views)) this.watchScroll(view);
  }

  start() {
    this.selectTab('home');
    if (this.imported && (this.imported.addons || this.imported.library || this.imported.progress)) {
      toast(`Brought over from classic Astra: ${[this.imported.addons && `${this.imported.addons} add-ons`, this.imported.library && `${this.imported.library} saved`, this.imported.progress && `${this.imported.progress} in progress`].filter(Boolean).join(', ')}`);
    }
  }

  /** Shows a tab. Tapping the current tab again scrolls it to the top (or focuses search). */
  selectTab(id, fromTap = false) {
    if (this.tab === id) { if (fromTap) this.screens[id]?.reselect?.(); return; }
    const first = !this.screens[id];
    if (first) this.screens[id] = new this.screenTypes[id](this, this.views[id]);
    // Hidden tabs stay laid out (content-visibility), so coming back is a repaint, not a rebuild.
    for (const [k, v] of Object.entries(this.views)) { v.classList.toggle('off', k !== id); v.inert = k !== id; }
    this.navButtons.forEach((b, i) => { const on = TABS[i].id === id; b.classList.toggle('selected', on); b.setAttribute('aria-current', on ? 'page' : 'false'); });
    this.pill.style.setProperty('--i', TABS.findIndex(t => t.id === id));
    const previous = this.tab;
    this.tab = id;
    this.screens[previous]?.onHide?.();
    this.screens[id].onShow?.(first);
    // Back from another tab returns to Home.
    if (id !== 'home' && !this.tabLayer) this.tabLayer = pushLayer('tab', () => { this.tabLayer = null; this.selectTab('home'); });
    else if (id === 'home' && this.tabLayer) { const pop = this.tabLayer; this.tabLayer = null; pop(); }
    this.setLabels(true);
  }

  watchScroll(view) {
    let last = 0, travel = 0;
    view.addEventListener('scroll', () => {
      const y = view.scrollTop, dy = y - last;
      last = y;
      if (Math.sign(dy) !== Math.sign(travel)) travel = 0;
      travel += dy;
      if (travel > LABEL_SCROLL && y > 80) this.setLabels(false);
      else if (travel < -LABEL_SCROLL || y < 20) this.setLabels(true);
    }, {passive: true});
  }
  setLabels(on) { this.nav.classList.toggle('compact', !on); }

  /** Pushes a screen over the tabs. */
  push(screen) {
    const layer = h('div', {class: 'screen-layer'}, screen.el);
    this.stackEl.append(layer);
    this.stack.push({screen, layer});
    this.root.classList.add('has-screen');
    this.setCovered(true);
    requestAnimationFrame(() => layer.classList.add('in'));
    const entry = this.stack[this.stack.length - 1];
    entry.pop = pushLayer('screen', () => this.removeScreen(entry));
    screen.onShow?.(true);
    return screen;
  }

  /** Closes the top screen (the UI's back arrow). */
  back() { const top = this.stack[this.stack.length - 1]; if (top) { top.pop(); this.removeScreen(top); } }

  removeScreen(entry) {
    const i = this.stack.indexOf(entry);
    if (i < 0) return;
    for (const e of this.stack.splice(i)) {
      e.screen.destroy?.();
      e.layer.classList.remove('in');
      e.layer.classList.add('out');
      setTimeout(() => e.layer.remove(), 220);
    }
    this.root.classList.toggle('has-screen', this.stack.length > 0);
    this.setCovered(this.stack.length > 0 || !!this.player?.isOpen);
    this.stack[this.stack.length - 1]?.screen.onShow?.(false);
  }

  /** A screen or the player is over the tabs: the tab under them can rest (Home's hero stops turning). */
  setCovered(covered) {
    if (covered === !!this.covered) return;
    this.covered = covered;
    this.root.classList.toggle('covered', covered);
    this.screens[this.tab]?.onCover?.(covered);
  }

  openTitle(meta) { return this.push(new this.screenTypes.details(this, meta)); }
  openCatalog(entry) { return this.push(new this.screenTypes.catalog(this, entry)); }
  openStreams(meta, video = null, options = {}) { return this.push(new this.screenTypes.streams(this, meta, video, options)); }

  /**
   * Full metadata for a card (catalog items carry only part of it), over what
   * the card already had. When no add-on has the title, the card itself with
   * no videos. Rejects when the add-ons could not be reached, so a screen can
   * say so instead of showing a stub.
   */
  async meta(item) {
    await this.ready;
    const meta = await fetchMeta(this.enabledAddons(), this.manifests, item.type, item.id);
    if (!meta) return {...item, videos: []};
    const known = Object.entries(meta).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length));
    return {...item, ...Object.fromEntries(known), videos: meta.videos};
  }

  /**
   * Plays a stream from the streams screen. Must run from a tap: the player
   * goes full screen before anything awaits.
   */
  play(options) {
    if (this.player) return this.playNow(options);
    // First play of the visit: the engine is still loading (the tap's user
    // activation lasts long enough for full screen once it has). The player's
    // black loading screen shows at once, so the tap is answered.
    const veil = h('div', {class: 'player-veil', role: 'status', 'aria-label': 'Opening the player'}, h('div', {class: 'spinner'}));
    this.root.append(veil);
    this.loadPlayer().then(() => this.playNow(options), () => toast('The player could not load. Check the connection.'))
      .finally(() => setTimeout(() => veil.remove(), 150));
  }

  playNow({meta, video = null, source, sources, startTime = 0}) {
    this.setCovered(true);
    this.playing = {meta, video, stream: source.stream};
    const videos = meta.videos || [];
    const index = video ? videos.findIndex(v => v.id === video.id) : -1;
    const next = index >= 0 ? videos.slice(index + 1).find(v => v.season !== 0) || null : null;
    this.playing.next = next;
    const options = {
      stream: {...source.stream, url: source.stream.url}, sourceId: source.id, sources, startTime,
      meta: {
        title: meta.name, episodeLine: video ? [episodeCode(video), video.title].filter(Boolean).join(' • ') : '',
        release: [String(meta.releaseInfo || '').slice(0, 4), (meta.genres || [])[0]].filter(Boolean).join(' · '),
        description: video?.overview || meta.description || '', logo: meta.logo || '', background: video?.thumbnail || meta.background || '', poster: meta.poster || '',
      },
      // The player's episode panel lists seasons; videos without one (a channel's uploads) have no panel.
      episodes: video && video.season != null ? {seasons: [...new Set(videos.map(v => v.season))].filter(s => s != null), season: video.season, current: video.id,
        items: videos.filter(v => v.season != null).map(v => ({id: v.id, season: v.season, episode: v.episode, title: v.title, thumbnail: v.thumbnail, video: v}))} : null,
      next: next ? {label: episodeCode(next), title: next.title, thumbnail: next.thumbnail, hasAired: aired(next), status: aired(next) ? '' : outOn(next)} : null,
    };
    const resolving = resolveDebrid(source.stream.url).catch(() => source.stream.url);
    this.player.open({...options, stream: {...options.stream, url: null}, deferred: true});
    resolving.then(url => { if (this.player.isOpen && this.playing?.meta === meta) this.player.load({...options.stream, url}, startTime); });
  }

  bindPlayer() {
    const save = (time, duration) => {
      const p = this.playing;
      if (!p) return;
      const v = p.video;
      const entry = this.progress.save({type: p.meta.type, id: p.meta.id, videoId: v ? v.id : p.meta.id, season: v?.season ?? null, episode: v?.episode ?? null, time, duration, meta: p.meta,
        next: p.next ? {videoId: p.next.id, season: p.next.season, episode: p.next.episode, title: p.next.title, thumbnail: p.next.thumbnail} : null});
      if (entry?.completed && !this.watched.has(p.meta.type, p.meta.id, v ? v.id : null)) this.watched.set(p.meta.type, p.meta.id, v ? v.id : null, true);
    };
    this.player.addEventListener('progress', e => { save(e.detail.time, e.detail.duration); if (e.detail.final) this.progress.flush(true); });
    this.player.addEventListener('close', () => { this.progress.flush(true); this.playing = null; this.subtitleSearch?.abort(); this.subtitleSearch = null; this.setCovered(this.stack.length > 0); });
    this.player.addEventListener('episode', e => this.switchEpisode(e.detail.episode.video));
    this.player.addEventListener('next', () => { if (this.playing?.next) this.switchEpisode(this.playing.next); });
    this.player.addEventListener('source', e => { if (this.playing) { this.playing.sourceId = e.detail.source.id; this.playing.stream = e.detail.source.stream; } });
    this.player.addEventListener('fileinfo', e => this.findSubtitles(e.detail));
  }

  /**
   * Asks subtitle add-ons (and OpenSubtitles unless turned off) for the
   * title playing, with the file's hash and size when Astra could read them.
   */
  async findSubtitles({load, hash, size}) {
    const p = this.playing;
    if (!p) return;
    this.subtitleSearch?.abort();
    const search = this.subtitleSearch = new AbortController();
    const addons = subtitleAddons(this.enabledAddons(), {builtIn: this.settings.openSubtitles !== false});
    const stream = p.stream || {};
    this.player.setSubtitleSearch(true);
    try {
      await fetchSubtitles(addons, p.meta.type, p.video ? p.video.id : p.meta.id, {videoHash: hash || stream.videoHash, videoSize: size || stream.size, filename: stream.filename},
        {signal: search.signal, onList: list => { if (!search.signal.aborted) this.player.addSubtitles(list, load); }});
    } catch {} finally {
      if (this.subtitleSearch === search) { this.subtitleSearch = null; this.player.setSubtitleSearch(false); }
    }
  }

  /** Another episode from inside the player: same release group when there is one, else its sources list. */
  async switchEpisode(video) {
    const {meta} = this.playing || {};
    if (!meta) return;
    const group = this.player.stream?.bingeGroup;
    this.player.showLoading(true);
    const streams = new this.screenTypes.streams(this, meta, video, {headless: true});
    const sources = await streams.collect();
    if (!sources.length) return this.player.showError('None of your add-ons returned a playable stream for this episode.');
    const same = group && sources.find(s => s.stream.bingeGroup === group);
    this.play({meta, video, source: same || sources[0], sources});
    if (!same) this.player.openPanel('sources');
  }
}
