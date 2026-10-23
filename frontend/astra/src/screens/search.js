// Search: one row per search-capable catalog, 350 ms after typing stops.
// With an empty field: recent searches while focused, and Discover below.

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {posterCard, skeletonRow, emptyCard, sheet} from '../ui/components.js';
import {getJson, resourceUrl} from '../addons/client.js';
import {posterContext, rowHeader} from './home.js';
import {fetchCatalog} from '../app/content.js';

const DEBOUNCE = 350;
const MAX_RECENT = 10;

export function searchCatalogsOf(addons, manifests) {
  const out = [];
  addons.forEach((addon, order) => {
    const manifest = manifests.get(addon.url);
    for (const catalog of manifest?.catalogs || []) {
      const extras = catalog.extra || [];
      const search = extras.some(e => e.name === 'search') || (catalog.extraSupported || []).includes('search');
      if (!search || extras.some(e => e.isRequired && e.name !== 'search')) continue;
      out.push({addon, order, manifest, catalog, title: `${catalog.name || catalog.id} • ${catalog.type === 'series' ? 'Series' : catalog.type === 'movie' ? 'Movie' : catalog.type}`});
    }
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
        icon('search', {size: 20}), this.input, this.clear)),
      this.recent, this.results, this.discover));
    this.input.addEventListener('input', () => { this.clear.hidden = !this.input.value; clearTimeout(this.timer); this.timer = setTimeout(() => this.run(this.input.value), DEBOUNCE); this.showRecent(); });
    this.input.addEventListener('focus', () => this.showRecent());
    this.input.addEventListener('blur', () => setTimeout(() => { this.recent.hidden = true; }, 150));
    view.addEventListener('scroll', () => { this.title.textContent = view.scrollTop > 40 && !this.input.value ? 'Discover' : 'Search'; }, {passive: true});
    this.discoverState = {type: 'movie', catalog: null, genre: null};
    this.renderDiscover();
  }

  reselect() { this.view.scrollTo({top: 0}); this.input.focus(); }

  recents() { return this.app.store.get('recentSearches', []); }

  showRecent() {
    const list = this.recents();
    this.recent.hidden = !(document.activeElement === this.input && !this.input.value && list.length && this.app.settings.recentSearches !== false);
    this.recent.replaceChildren(h('h2', {class: 'section-label'}, 'Recent searches'), ...list.map(q => h('div', {class: 'recent-row'},
      h('button', {class: 'recent-q', type: 'button', onclick: () => { this.input.value = q; this.clear.hidden = false; this.run(q, true); }}, icon('search', {size: 18}), q),
      h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Remove ' + q, onclick: () => { this.app.store.set('recentSearches', this.recents().filter(x => x !== q)); this.showRecent(); this.input.focus(); }}, icon('close', {size: 18})))));
  }

  remember(q) {
    if (q.length < 2 || this.app.settings.recentSearches === false) return;
    this.app.store.set('recentSearches', [q, ...this.recents().filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT));
  }

  async run(raw, submit = false) {
    const q = raw.trim();
    this.abort?.abort();
    this.discover.hidden = !!q;
    if (q.length < 2) { this.results.replaceChildren(); return; }
    const abort = this.abort = new AbortController();
    await this.app.ready;
    const catalogs = searchCatalogsOf(this.app.enabledAddons(), this.app.manifests);
    if (!catalogs.length) { this.results.replaceChildren(emptyCard('No search catalogs', 'None of your add-ons can search. Add one in Settings.')); return; }
    const slots = catalogs.map(() => h('section', {class: 'row'}, ...skeletonRow(6).children));
    this.results.replaceChildren(...slots.slice(0, 2), ...slots.slice(2).map(s => { s.hidden = true; return s; }));
    let found = 0, settled = 0;
    await Promise.allSettled(catalogs.map(async (c, i) => {
      const slot = slots[i];
      try {
        const data = await getJson(resourceUrl(c.addon.url, 'catalog', c.catalog.type, c.catalog.id, {search: q}), {signal: abort.signal});
        if (abort.signal.aborted) return;
        const items = (data?.metas || []).filter(m => m?.id).map(m => ({...m, type: m.type || c.catalog.type}));
        if (!items.length) { slot.remove(); return; }
        found++;
        slot.hidden = false;
        slot.replaceChildren(rowHeader(c.title, null), h('div', {class: 'row-scroll'}, ...items.slice(0, 30).map(m => posterCard(m, this.ctx))));
      } catch { slot.remove(); } finally {
        settled++;
        if (!abort.signal.aborted && settled === catalogs.length && !found) this.results.replaceChildren(emptyCard('No results', `Nothing matched “${q}”.`));
      }
    }));
    if (found && !abort.signal.aborted) this.remember(q);
    if (submit) this.remember(q);
  }

  /** Discover: type, catalog and genre pickers over a three-column grid. */
  async renderDiscover() {
    await this.app.ready;
    const all = [];
    this.app.enabledAddons().forEach((addon, order) => {
      const manifest = this.app.manifests.get(addon.url);
      for (const catalog of manifest?.catalogs || []) {
        const extras = catalog.extra || [];
        if (extras.some(e => e.isRequired && !['genre', 'skip'].includes(e.name))) continue;
        all.push({addon, order, catalog, addonName: manifest.name, title: catalog.name || catalog.id, pageable: extras.some(e => e.name === 'skip'),
          genres: (extras.find(e => e.name === 'genre')?.options) || catalog.genres || []});
      }
    });
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
      } catch { done = true; if (!skip) grid.replaceChildren(emptyCard("Couldn't load", 'This catalog did not answer.')); }
      busy = false;
    };
    await load();
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) load(); }, {root: this.view, rootMargin: '600px'});
    io.observe(footer);
  }
}
