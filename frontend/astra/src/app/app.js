// Astra's app shell: four tabs that stay alive, a floating navigation bar,
// screens pushed over them (details, streams, catalogs), and the player.
// Every pushed screen is one history entry, so Android back walks them back.

import {createStorage, importClassic, Addons, Library, Watched, Progress} from './store.js';
import {loadManifests, fetchMeta, episodeCode} from './content.js';
import {pushLayer} from './back-stack.js';
import {PlayerScreen} from '../player/player-screen.js';
import {resolveDebrid} from '../addons/debrid.js';
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

export class App {
  constructor(root, screens) {
    this.root = root;
    this.store = createStorage();
    this.imported = importClassic(this.store);
    this.addons = new Addons(this.store);
    this.library = new Library(this.store);
    this.watched = new Watched(this.store);
    this.progress = new Progress(this.store);
    this.settings = {showCatalogType: true, posterWidth: 126, posterRadius: 12, hero: true, ...this.store.get('settings', {})};
    this.manifests = new Map();
    this.stack = [];
    this.screenTypes = screens;
    this.build();
    this.reloadAddons();
    this.player = new PlayerScreen({parent: root});
    this.bindPlayer();
    addEventListener('pagehide', () => this.progress.flush(true));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') this.progress.flush(true); });
  }

  saveSettings(patch) { Object.assign(this.settings, patch); this.store.set('settings', this.settings); this.applySettings(); }
  applySettings() {
    const s = this.root.style;
    s.setProperty('--poster-w', this.settings.posterWidth + 'px');
    s.setProperty('--poster-r', this.settings.posterRadius + 'px');
  }

  /** Fetches every enabled add-on's manifest; screens wait on this.ready. */
  reloadAddons() {
    this.ready = loadManifests(this.addons.enabled()).then(m => { this.manifests = m; return m; });
    return this.ready;
  }
  enabledAddons() { return this.addons.enabled(); }

  build() {
    this.applySettings();
    this.views = {};
    this.tabsEl = h('div', {class: 'tab-views'});
    for (const t of TABS) {
      const view = h('section', {class: 'tab-view', 'data-tab': t.id, hidden: t.id !== 'home', 'aria-label': t.label});
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
    for (const [k, v] of Object.entries(this.views)) v.hidden = k !== id;
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
    this.stack[this.stack.length - 1]?.screen.onShow?.(false);
  }

  openTitle(meta) { return this.push(new this.screenTypes.details(this, meta)); }
  openCatalog(entry) { return this.push(new this.screenTypes.catalog(this, entry)); }
  openStreams(meta, video = null, options = {}) { return this.push(new this.screenTypes.streams(this, meta, video, options)); }

  /** Full metadata for a card (catalog items carry only part of it). */
  async meta(item) {
    await this.ready;
    return await fetchMeta(this.enabledAddons(), this.manifests, item.type, item.id).catch(() => null) || {...item, videos: []};
  }

  /**
   * Plays a stream from the streams screen. Must run from a tap: the player
   * goes full screen before anything awaits.
   */
  play({meta, video = null, source, sources, startTime = 0}) {
    this.playing = {meta, video};
    const videos = meta.videos || [];
    const index = video ? videos.findIndex(v => v.id === video.id) : -1;
    const next = index >= 0 ? videos.slice(index + 1).find(v => v.season !== 0) || null : null;
    this.playing.next = next;
    const options = {
      stream: {...source.stream, url: source.stream.url}, sourceId: source.id, sources, startTime,
      meta: {
        title: meta.name, episodeLine: video ? `${episodeCode(video)}${video.title ? ' • ' + video.title : ''}` : '',
        release: [String(meta.releaseInfo || '').slice(0, 4), (meta.genres || [])[0]].filter(Boolean).join(' · '),
        description: video?.overview || meta.description || '', logo: meta.logo || '', background: video?.thumbnail || meta.background || '', poster: meta.poster || '',
      },
      episodes: video ? {seasons: [...new Set(videos.map(v => v.season))].filter(s => s != null), season: video.season, current: video.id,
        items: videos.filter(v => v.season != null).map(v => ({id: v.id, season: v.season, episode: v.episode, title: v.title, thumbnail: v.thumbnail, video: v}))} : null,
      next: next ? {label: episodeCode(next), title: next.title, thumbnail: next.thumbnail, hasAired: !next.released || new Date(next.released) <= new Date()} : null,
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
    this.player.addEventListener('progress', e => save(e.detail.time, e.detail.duration));
    this.player.addEventListener('close', () => { this.progress.flush(true); this.playing = null; });
    this.player.addEventListener('episode', e => this.switchEpisode(e.detail.episode.video));
    this.player.addEventListener('next', () => { if (this.playing?.next) this.switchEpisode(this.playing.next); });
    this.player.addEventListener('source', e => { if (this.playing) this.playing.sourceId = e.detail.source.id; });
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
