// Search: one row per search-capable catalog, 350 ms after typing stops.
// With an empty field: recent searches while focused, and Discover below.

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {posterCard, skeletonRow, emptyCard, sheet} from '../ui/components.js';
import {getJson, resourceUrl, fetchManifest} from '../addons/client.js';
import {posterContext, rowHeader} from './home.js';
import {fetchCatalog, catalogItems, eachManifest, MANIFEST_TIMEOUT} from '../app/content.js';

const DEBOUNCE = 350;
const MAX_RECENT = 10;

export function searchCatalogsOf(addons, manifests) {
  const out = [];
  eachManifest(addons, manifests, (addon, manifest, order) => {
    const found = [];
    for (const catalog of manifest.catalogs || []) {
      const extras = catalog.extra || [];
      const search = extras.some(e => e.name === 'search') || (catalog.extraSupported || []).includes('search');
      if (!search || extras.some(e => e.isRequired && e.name !== 'search')) continue;
      found.push({addon, order, manifest, catalog, title: `${catalog.name || catalog.id} • ${catalog.type === 'series' ? 'Series' : catalog.type === 'movie' ? 'Movie' : catalog.type}`});
    }
    out.push(...found);
  });
  return out;
}

/** Discover's catalogs: those whose only required extras are genre and paging. */
export function discoverCatalogsOf(addons, manifests) {
  const out = [];
  eachManifest(addons, manifests, (addon, manifest, order) => {
    const found = [];
    for (const catalog of manifest.catalogs || []) {
      const extras = catalog.extra || [];
      if (extras.some(e => e.isRequired && !['genre', 'skip'].includes(e.name))) continue;
      found.push({addon, order, catalog, addonName: manifest.name || addon.name, title: catalog.name || catalog.id,
        pageable: extras.some(e => e.name === 'skip') || (catalog.extraSupported || []).includes('skip'),
        genres: (extras.find(e => e.name === 'genre')?.options) || catalog.genres || []});
    }
    out.push(...found);
  });
  return out;
}

export class SearchScreen {
  constructor(app, view) {
    this.app = app;
    this.view = view;
    this.ctx = posterContext(app);
    this.input = h('input', {class: 'search-input', type: 'search', placeholder: 'Search movies, shows...', autocomplete: 'off', enterkeyhint: 'search', 'aria-label': 'Search'});
    this.clear = h('button', {class: 'search-clear', type: 'button', 'aria-label': 'Clear search', hidden: true, onclick: () => { this.input.value = ''; this.input.focus(); this.run(''); }}, icon('close', {size: 20}));
    this.title = h('h1', {class: 'page-title'}, 'Search');
    this.results = h('div', {class: 'search-results'});
    this.recent = h('div', {class: 'recent', hidden: true});
    this.discover = h('div', {class: 'discover'});
    view.append(h('div', {class: 'search-page'},
      h('div', {class: 'sticky-head'}, this.title, h('form', {class: 'search-box', role: 'search', onsubmit: e => { e.preventDefault(); clearTimeout(this.timer); this.run(this.input.value, true); this.input.blur(); }},
        this.input, this.clear)),
      this.recent, this.results, this.discover));
    this.input.addEventListener('input', () => { this.clear.hidden = !this.input.value; clearTimeout(this.timer); this.timer = setTimeout(() => this.run(this.input.value), DEBOUNCE); this.showRecent(); });
    this.input.addEventListener('focus', () => this.showRecent());
    this.input.addEventListener('blur', () => setTimeout(() => { this.recent.hidden = true; }, 150));
    view.addEventListener('scroll', () => {
      const title = view.scrollTop > 40 && !this.input.value ? 'Discover' : 'Search';
      if (this.title.textContent !== title) this.title.textContent = title; // only when it changes: a write per scroll event costs a relayout
    }, {passive: true});
    this.discoverState = {type: 'movie', catalog: null, genre: null};
    app.onAddons?.(() => this.addonsChanged());
    this.renderDiscover();
  }

  reselect() { this.view.scrollTo({top: 0}); this.input.focus(); }

  recents() { return this.app.store.get('recentSearches', []); }

  showRecent() {
    const list = this.recents();
    this.recent.hidden = !(document.activeElement === this.input && !this.input.value && list.length && this.app.settings.recentSearches !== false);
    this.recent.replaceChildren(h('h2', {class: 'section-label'}, 'Recent searches'), ...list.map(q => h('div', {class: 'recent-row'},
      h('button', {class: 'recent-q', type: 'button', onclick: () => { this.input.value = q; this.clear.hidden = false; this.run(q, true); }}, q),
      h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Remove ' + q, onclick: () => { this.app.store.set('recentSearches', this.recents().filter(x => x !== q)); this.showRecent(); this.input.focus(); }}, icon('close', {size: 18})))));
  }

  /** Saves a query as a recent search: on Enter, a tapped recent search or a tapped result, never while typing. */
  remember(q) {
    if (q.length < 2 || this.app.settings.recentSearches === false) return;
    this.app.store.set('recentSearches', [q, ...this.recents().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT));
  }

  /**
   * Searches every search catalog, one block per add-on in add-on order. An
   * add-on whose manifest has not arrived yet is fetched and searched too.
   * Skeletons stand in only until the first answer; after that a line names
   * the add-ons still being waited for.
   */
  async run(raw, submit = false) {
    const q = raw.trim();
    this.abort?.abort();
    this.query = q;
    this.searchFailed = false;
    this.discover.hidden = !!q;
    if (submit) this.remember(q);
    if (!q) { this.results.replaceChildren(); return; }
    if (q.length < 2) { this.results.replaceChildren(h('p', {class: 'search-hint'}, 'Keep typing: search starts at two letters.')); return; }
    const abort = this.abort = new AbortController(), {signal} = abort;
    const loading = h('div', {class: 'search-loading', 'aria-hidden': 'true'}, skeletonRow(6), skeletonRow(6));
    this.results.replaceChildren(loading);
    await this.app.ready;
    if (signal.aborted) return;
    const addons = this.app.enabledAddons();
    const blocks = addons.map(() => h('div', {class: 'search-block'}));
    const waiting = h('p', {class: 'search-waiting', role: 'status'});
    this.results.replaceChildren(loading, ...blocks, waiting);
    const ctx = {...this.ctx, onOpen: m => { this.remember(q); this.app.openTitle(m); }};
    const state = {asked: 0, answered: 0, found: 0, unreachable: 0, settled: 0};
    const pending = new Map(); // one key per unanswered request -> its add-on's name
    const update = () => {
      if (signal.aborted || !state.settled) return;
      loading.remove();
      const names = [...new Set(pending.values())];
      waiting.textContent = names.length ? `Still waiting for ${names.join(', ')}…` : '';
    };
    const searchOne = async (c, block) => {
      const key = {};
      state.asked++;
      pending.set(key, c.manifest.name || c.addon.name);
      const slot = h('section', {class: 'row', hidden: true});
      block.append(slot);
      try {
        const data = await getJson(resourceUrl(c.addon.url, 'catalog', c.catalog.type, c.catalog.id, {search: q}), {signal});
        if (signal.aborted) return;
        state.answered++;
        const items = catalogItems(data, c.catalog.type);
        if (!items.length) { slot.remove(); return; }
        state.found++;
        slot.hidden = false;
        slot.replaceChildren(rowHeader(c.title, null), h('div', {class: 'row-scroll'}, ...items.slice(0, 30).map(m => posterCard(m, ctx))));
      } catch { slot.remove(); } finally { pending.delete(key); state.settled++; update(); }
    };
    await Promise.allSettled(addons.map(async (addon, i) => {
      let manifest = this.app.manifests.get(addon.url);
      if (!manifest) {
        const key = {};
        pending.set(key, addon.name || 'an add-on');
        try { manifest = await fetchManifest(addon.url, {timeout: MANIFEST_TIMEOUT}); } catch { state.unreachable++; state.settled++; return; } finally { pending.delete(key); update(); }
        if (signal.aborted) return;
      }
      await Promise.allSettled(searchCatalogsOf([addon], new Map([[addon.url, manifest]])).map(c => searchOne(c, blocks[i])));
    }));
    if (signal.aborted) return;
    loading.remove();
    waiting.remove();
    if (state.found) return;
    if (!state.asked && !state.unreachable) this.results.replaceChildren(emptyCard('No search catalogs', 'None of your add-ons can search. Add one in Settings.'));
    else if (!state.answered) {
      // Every add-on failed: that is a connection problem, not "no results". Tried again when add-ons come back.
      this.searchFailed = true;
      this.results.replaceChildren(emptyCard("Couldn't search", navigator.onLine === false ? 'This phone is offline. Check your connection and try again.' : 'Your add-ons did not answer. Check your connection and try again.',
        {label: 'Retry', run: () => this.run(this.input.value)}));
    } else this.results.replaceChildren(emptyCard('No results', `Nothing matched “${q}”.`));
  }

  /** Re-runs a failed search and refreshes Discover when the add-ons change (a late manifest, an edit, back online). */
  addonsChanged() {
    const key = discoverKey(discoverCatalogsOf(this.app.enabledAddons(), this.app.manifests));
    if (key !== this.discoverKey) this.renderDiscover();
    if (this.searchFailed && this.query === this.input.value.trim()) this.run(this.input.value);
  }

  /** Discover: type, catalog and genre pickers over a three-column grid. */
  async renderDiscover() {
    await this.app.ready;
    const all = discoverCatalogsOf(this.app.enabledAddons(), this.app.manifests);
    this.discoverKey = discoverKey(all);
    this.discoverObserver?.disconnect();
    this.discoverToken = null;
    if (!all.length) { this.discover.replaceChildren(); return; }
    const st = this.discoverState;
    const types = [...new Set(all.map(c => c.catalog.type))];
    if (!types.includes(st.type)) st.type = types[0];
    const ofType = all.filter(c => c.catalog.type === st.type);
    const entry = ofType.find(c => `${c.addon.url}|${c.catalog.id}` === st.catalog) || ofType[0];
    st.catalog = `${entry.addon.url}|${entry.catalog.id}`;
    if (st.genre && !entry.genres.includes(st.genre)) st.genre = null;
    const typeName = t => t === 'series' ? 'Series' : t === 'movie' ? 'Movies' : t[0].toUpperCase() + t.slice(1);
    const pick = (label, value, options, apply) => h('button', {class: 'chip dropdown', type: 'button', onclick: () => sheet(label, options.map(o => ({label: o.label, selected: o.value === value, run: () => { apply(o.value); this.renderDiscover(); }})))}, options.find(o => o.value === value)?.label || label, icon('chevronRight', {size: 16}));
    const grid = h('div', {class: 'grid'}, ...Array.from({length: 9}, () => h('div', {class: 'skeleton skeleton-tile'})));
    const footer = h('div', {class: 'grid-footer'});
    this.discover.replaceChildren(h('h2', {class: 'section-head'}, 'Discover'),
      h('div', {class: 'filter-chips'},
        pick('Type', st.type, types.map(t => ({label: typeName(t), value: t})), v => { st.type = v; st.catalog = null; st.genre = null; }),
        pick('Catalog', st.catalog, ofType.map(c => ({label: `${c.title} (${c.addonName})`, value: `${c.addon.url}|${c.catalog.id}`})), v => { st.catalog = v; st.genre = null; }),
        entry.genres.length ? pick('Genre', st.genre, [{label: 'All genres', value: null}, ...entry.genres.map(g => ({label: g, value: g}))], v => { st.genre = v; }) : null),
      grid, footer);
    const token = this.discoverToken = {};
    const seen = new Set();
    let skip = 0, done = false, busy = false;
    const io = this.discoverObserver = new IntersectionObserver(([e]) => { if (e.isIntersecting) load(); }, {root: this.view, rootMargin: '600px'});
    const load = async () => {
      if (busy || done || token !== this.discoverToken) return;
      busy = true;
      try {
        const page = await fetchCatalog(entry, {skip, genre: st.genre});
        if (token !== this.discoverToken) return;
        if (!skip) grid.replaceChildren();
        const fresh = page.filter(m => !seen.has(m.id) && seen.add(m.id));
        skip += page.length;
        grid.append(...fresh.map(m => posterCard(m, this.ctx)));
        if (!fresh.length || !entry.pageable) done = true;
      } catch { done = true; if (!skip) grid.replaceChildren(emptyCard("Couldn't load", 'This catalog did not answer.', {label: 'Retry', run: () => this.renderDiscover()})); }
      busy = false;
      // A short page can leave the footer in view, and an observer only reports changes: observing
      // again reports where it is now, so the next page loads if it is still near.
      if (!done && token === this.discoverToken) { io.unobserve(footer); io.observe(footer); }
    };
    await load();
  }
}

const discoverKey = catalogs => catalogs.map(c => `${c.addon.url}|${c.catalog.type}|${c.catalog.id}|${c.title}`).join('\n');
