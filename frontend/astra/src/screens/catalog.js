// "View all": one catalog as a three-column grid that loads more near the end.

import {h} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {posterCard} from '../ui/components.js';
import {fetchCatalog} from '../app/content.js';
import {posterContext} from './home.js';

export class CatalogScreen {
  constructor(app, entry) {
    this.app = app;
    this.entry = entry;
    this.items = [];
    this.seen = new Set();
    this.done = false;
    this.grid = h('div', {class: 'grid'});
    this.footer = h('div', {class: 'grid-footer'});
    this.el = h('div', {class: 'screen catalog'},
      // Nuvio's catalog header: back, then the title and its add-on stacked under it; it stays while the grid scrolls.
      h('header', {class: 'catalog-head'}, h('button', {class: 'round-btn small', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back', {size: 24})),
        h('h1', {}, entry.title), entry.addonName ? h('p', {}, entry.addonName) : null),
      this.grid, this.footer);
    this.ctx = posterContext(app);
    this.grid.append(...Array.from({length: 9}, () => h('div', {class: 'skeleton skeleton-tile'})));
    this.observer = new IntersectionObserver(([e]) => { if (e.isIntersecting) this.more(); }, {root: this.el, rootMargin: '600px'});
    this.add(entry.items || []);
    if (!this.items.length) this.more(); else this.observer.observe(this.footer);
  }

  add(items) {
    const fresh = items.filter(m => !this.seen.has(m.id) && this.seen.add(m.id));
    if (!this.items.length) this.grid.replaceChildren();
    this.items.push(...fresh);
    this.grid.append(...fresh.map(m => posterCard(m, this.ctx)));
    return fresh.length;
  }

  async more() {
    if (this.busy || this.done) return;
    if (!this.entry.pageable && this.items.length) { this.done = true; this.footer.replaceChildren(); return; }
    this.busy = true;
    this.footer.replaceChildren(h('div', {class: 'spinner'}));
    try {
      const page = await fetchCatalog(this.entry, {skip: this.items.length});
      if (!this.add(page)) this.done = true;
    } catch {
      this.footer.replaceChildren(h('button', {class: 'btn', type: 'button', onclick: () => { this.busy = false; this.more(); }}, 'Retry'));
      this.busy = false;
      return;
    }
    this.busy = false;
    this.footer.replaceChildren();
    // A short page can leave the footer in view, and an observer only reports changes: observing
    // again reports where it is now, so the next page loads while the footer is still near.
    if (!this.done) { this.observer.unobserve(this.footer); this.observer.observe(this.footer); }
  }

  destroy() { this.observer.disconnect(); }
}
