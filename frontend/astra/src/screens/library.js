// Library: saved titles, one row per type, or a sortable grid.

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {posterCard, emptyCard, sheet} from '../ui/components.js';
import {posterContext, rowHeader} from './home.js';

const SORTS = {
  recent: {label: 'Recently added', fn: (a, b) => b.added - a.added},
  oldest: {label: 'Oldest added', fn: (a, b) => a.added - b.added},
  title: {label: 'Title A–Z', fn: (a, b) => a.name.localeCompare(b.name)},
  titleDesc: {label: 'Title Z–A', fn: (a, b) => b.name.localeCompare(a.name)},
  released: {label: 'Recently released', fn: (a, b) => String(b.releaseInfo || '').localeCompare(String(a.releaseInfo || ''))},
};

export class LibraryScreen {
  constructor(app, view) {
    this.app = app;
    this.view = view;
    this.ctx = posterContext(app);
    this.layout = app.store.get('libraryLayout', 'rows');
    this.sort = app.store.get('librarySort', 'recent');
    if (!Object.hasOwn(SORTS, this.sort)) this.sort = 'recent'; // a sort this version does not have
    this.typeFilter = 'all';
    this.body = h('div', {class: 'library-body'});
    this.toggle = h('button', {class: 'icon-btn layout-toggle', type: 'button', onclick: () => { this.layout = this.layout === 'rows' ? 'grid' : 'rows'; app.store.set('libraryLayout', this.layout); this.render(); }});
    view.append(h('div', {class: 'library'}, h('div', {class: 'page-head'}, h('h1', {class: 'page-title'}, 'Library'), this.toggle), this.body));
    app.library.onChange(() => this.render());
    app.watched.onChange(() => { this.dirty = true; });
    this.render();
  }

  onShow() { if (this.dirty) { this.dirty = false; this.render(); } }
  reselect() { this.view.scrollTo({top: 0}); }

  render() {
    // The icon shows the layout a tap switches to: a grid, or stacked rows.
    this.toggle.replaceChildren(icon(this.layout === 'rows' ? 'grid' : 'agenda', {size: 22}));
    this.toggle.setAttribute('aria-label', this.layout === 'rows' ? 'Show as grid' : 'Show as rows');
    const items = this.app.library.list();
    if (!items.length) {
      this.body.replaceChildren(emptyCard('Your library is empty', 'Saved titles appear here after you tap + on a title or long-press a poster.'));
      return;
    }
    if (this.layout === 'rows') {
      const types = [...new Set(items.map(i => i.type))];
      this.body.replaceChildren(...types.map(t => {
        const list = items.filter(i => i.type === t);
        return h('section', {class: 'row'}, rowHeader(`${t === 'series' ? 'Series' : t === 'movie' ? 'Movies' : t} (${list.length})`, () => { this.layout = 'grid'; this.typeFilter = t; this.render(); }),
          h('div', {class: 'row-scroll'}, ...list.map(m => posterCard(m, this.ctx))));
      }));
      return;
    }
    const types = ['all', ...new Set(items.map(i => i.type))];
    const shown = items.filter(i => this.typeFilter === 'all' || i.type === this.typeFilter).sort(SORTS[this.sort].fn);
    const label = t => t === 'all' ? 'All' : t === 'series' ? 'Series' : t === 'movie' ? 'Movies' : t;
    this.body.replaceChildren(
      h('div', {class: 'filter-chips'},
        ...types.map(t => h('button', {class: 'chip', type: 'button', 'aria-pressed': String(this.typeFilter === t), onclick: () => { this.typeFilter = t; this.render(); }}, label(t))),
        h('button', {class: 'chip dropdown', type: 'button', onclick: () => sheet('Sort', Object.entries(SORTS).map(([k, v]) => ({label: v.label, selected: k === this.sort, run: () => { this.sort = k; this.app.store.set('librarySort', k); this.render(); }})))}, SORTS[this.sort].label, icon('chevronRight', {size: 16}))),
      h('div', {class: 'grid'}, ...shown.map(m => posterCard(m, this.ctx))));
  }
}
