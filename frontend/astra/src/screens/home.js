// Home: the hero carousel, Continue Watching, then each catalog as a row.

import {h, timeLeft, reducedMotion, scrollTimelines} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {posterCard, setWatchedBadge, image, longPress, liftMenu, skeletonRow, emptyCard, toast} from '../ui/components.js';
import {homeCatalogs, loadRows, heroItems, ROW_ITEMS, episodeCode} from '../app/content.js';

const HERO_INTERVAL = 8000;

/** Long-press actions shared by every poster. */
export function posterMenu(app) {
  return m => [
    app.library.has(m.type, m.id)
      ? {label: 'Remove from library', icon: 'check', run: () => { app.library.toggle(m); toast('Removed from library'); }}
      : {label: 'Add to library', icon: 'plus', run: () => { app.library.toggle(m); toast('Added to library'); }},
    // A circled check for watched, so it never reads as the library's plain ✓.
    app.watched.has(m.type, m.id)
      ? {label: 'Mark as unwatched', icon: 'checkCircleOutline', run: () => app.watched.set(m.type, m.id, null, false)}
      : {label: 'Mark as watched', icon: 'checkCircle', run: () => app.watched.set(m.type, m.id, null, true)},
  ];
}

export function posterContext(app) {
  return {watched: m => app.watched.has(m.type, m.id), onOpen: m => app.openTitle(m), menu: posterMenu(app)};
}

export function rowHeader(title, onAll) {
  return h('div', {class: 'row-head'}, h('h2', {}, title),
    onAll ? h('button', {class: 'row-all', type: 'button', 'aria-label': 'View all ' + title, onclick: onAll}, icon('chevronRight', {size: 16})) : h('span', {class: 'row-all placeholder', 'aria-hidden': 'true'}));
}

export class HomeScreen {
  constructor(app, view) {
    this.app = app;
    this.view = view;
    this.hero = h('div', {class: 'hero-slot'});
    this.cw = h('div', {class: 'cw-slot'});
    this.rows = h('div', {class: 'rows'});
    view.append(h('div', {class: 'home'}, this.hero, this.cw, this.rows));
    this.ctx = posterContext(app);
    app.progress.onChange(() => this.renderContinue());
    // On screen: the badges change now; under another tab or screen: when Home shows again.
    app.watched.onChange(() => { if (app.tab === 'home' && !app.covered) this.repaintBadges(); else this.dirty = true; });
    // A late add-on answer, a refreshed manifest or an edit in Settings: redraw without flashing skeletons.
    app.onAddons?.(() => this.load({quiet: true}));
    this.load();
  }

  onShow() { if (this.dirty) { this.dirty = false; this.repaintBadges(); } this.carousel?.resume(); }
  onHide() { this.carousel?.pause(); }
  onCover(covered) { if (covered) this.onHide(); else this.onShow(); }
  reselect() { this.view.scrollTo({top: 0, behavior: reducedMotion() ? 'auto' : 'smooth'}); }

  async load({quiet = false} = {}) {
    this.abort?.abort();
    const abort = this.abort = new AbortController();
    const showHero = this.app.settings.hero !== false;
    if (!quiet || !this.rows.childElementCount) {
      this.hero.replaceChildren(...(showHero ? [h('div', {class: 'hero skeleton-hero'}, h('div', {class: 'skeleton hero-logo-ph'}), h('div', {class: 'skeleton hero-line-ph'}), h('div', {class: 'skeleton hero-btn-ph'}))] : []));
      this.rows.replaceChildren(skeletonRow(), skeletonRow(), skeletonRow());
    }
    this.renderContinue();
    await this.app.ready;
    if (abort.signal.aborted) return;
    const hidden = Array.isArray(this.app.settings.hiddenRows) ? this.app.settings.hiddenRows : [];
    const entries = homeCatalogs(this.app.enabledAddons(), this.app.manifests).filter(e => !hidden.includes(e.key));
    if (!entries.length) {
      this.carousel?.destroy?.(); this.carousel = null;
      this.hero.replaceChildren();
      const enabled = this.app.enabledAddons().length;
      if (enabled && !this.app.manifests.size) {
        this.rows.replaceChildren(emptyCard('Can’t reach your add-ons', navigator.onLine === false ? 'This phone is offline. Astra tries again when the connection is back.' : 'They did not answer. Check the connection and try again.',
          {label: 'Retry', run: () => { this.app.reloadAddons(); this.load(); }}));
      } else {
        this.rows.replaceChildren(emptyCard('No content sources', 'Add an add-on with catalogs in Settings to fill Home.', {label: 'Open add-ons', run: () => this.openAddons()}));
      }
      return;
    }
    // A quiet reload keeps the rows already shown (and where they were scrolled to) until their fresh copy is drawn.
    const previous = new Map([...this.rows.querySelectorAll('.row[data-key]')].map(r => [r.dataset.key, r]));
    const slots = new Map(entries.map(e => [e.key, quiet && previous.get(e.key)?.entry ? previous.get(e.key) : h('section', {class: 'row'})]));
    const order = [...slots.values()];
    if (order.length !== this.rows.children.length || order.some((slot, i) => this.rows.children[i] !== slot)) this.rows.replaceChildren(...order);
    for (const slot of order) if (!slot.childElementCount) slot.append(...[...skeletonRow(6).children]);
    const loaded = [];
    let heroDone = quiet && !!this.carousel; // a quiet reload keeps the hero turning
    await loadRows(entries, (entry, items, error) => {
      const slot = slots.get(entry.key);
      if (error || !items.length) {
        if (quiet && slot.entry) { entry.items = slot.entry.items; if (!loaded.includes(entry)) loaded.push(entry); }
        else if (error) { entry.failed = true; this.renderRowError(slot, entry); } // says so, with Retry, instead of vanishing
        else slot.remove(); // an empty catalog
        return;
      }
      entry.items = items;
      if (!loaded.includes(entry)) loaded.push(entry);
      this.renderRow(slot, entry);
      const firstTwo = entries.slice(0, 2).every(e => e.items || e.failed || !slots.get(e.key).isConnected);
      if (!heroDone && firstTwo && showHero) {
        heroDone = true;
        this.renderHero(entries.filter(e => e.items));
      }
    }, {signal: abort.signal});
    if (abort.signal.aborted) return;
    if (!heroDone && showHero) this.renderHero(loaded);
    if (!showHero) { this.carousel?.destroy?.(); this.carousel = null; this.hero.replaceChildren(); }
    if (!loaded.length) this.rows.replaceChildren(emptyCard("Couldn't load Home", 'Your add-ons did not answer. Check the connection and try again.', {label: 'Retry', run: () => { this.app.reloadAddons(); this.load(); }}));
  }

  /** A row whose catalog failed: its title and a one-line note with Retry (that row only). */
  renderRowError(slot, entry) {
    const name = this.rowName(entry);
    slot.entry = null;
    slot.signature = null;
    slot.dataset.key = entry.key;
    const retry = h('button', {class: 'row-retry', type: 'button', 'aria-label': 'Retry ' + name, onclick: () => {
      retry.disabled = true;
      retry.textContent = 'Loading…';
      loadRows([entry], (e, items, error) => {
        if (!slot.isConnected) return;
        if (error) { this.renderRowError(slot, e); return; }
        if (!items.length) { slot.remove(); return; }
        e.items = items; e.failed = false;
        this.renderRow(slot, e);
      });
    }}, 'Retry');
    slot.replaceChildren(rowHeader(name, null), h('p', {class: 'row-error'}, h('span', {}, "Couldn't load this row."), retry));
  }

  rowName(entry) { return this.app.settings.showCatalogType === false ? entry.title.replace(/ - (Movie|Series|\w+)$/, '') : entry.title; }

  renderRow(slot, entry) {
    const items = entry.items.slice(0, ROW_ITEMS);
    const all = entry.items.length > ROW_ITEMS || entry.pageable ? () => this.app.openCatalog(entry) : null;
    const name = this.rowName(entry);
    // Unchanged rows are left as they are: no flash, and a row the user scrolled stays put.
    const signature = [name, !!all, ...items.map(m => m.id)].join('\n');
    slot.entry = entry;
    if (slot.signature === signature) return;
    slot.replaceChildren(rowHeader(name, all), h('div', {class: 'row-scroll'}, ...items.map(m => posterCard(m, this.ctx))));
    slot.dataset.key = entry.key;
    slot.signature = signature;
  }

  openAddons() {
    this.app.selectTab('settings');
    const settings = this.app.screens.settings;
    settings?.open?.('Add-ons', p => settings.addons(p));
  }

  /** The first loaded row's titles (Settings > Appearance previews them). */
  previewItems() { return [...this.rows.children].map(slot => slot.entry?.items).find(items => items?.length) || []; }

  /**
   * After a watched change or a Home setting: rows whose title or items
   * changed are redrawn; watched badges change in place, so the other rows
   * keep their scroll and their images.
   */
  repaintBadges() {
    for (const slot of this.rows.querySelectorAll('.row')) if (slot.entry) this.renderRow(slot, slot.entry);
    for (const card of this.rows.querySelectorAll('.poster-card[data-item]')) {
      const [type, ...rest] = card.dataset.item.split(':');
      setWatchedBadge(card, !!this.ctx.watched?.({type, id: rest.join(':')}));
    }
  }


  renderHero(rows) {
    const items = heroItems(rows);
    this.carousel?.destroy();
    if (!items.length) { this.hero.replaceChildren(); return; }
    this.carousel = new Hero(items, m => this.app.openTitle(m), this.view);
    this.hero.replaceChildren(this.carousel.el);
  }

  renderContinue() {
    const items = this.app.progress.continueWatching();
    this.view.classList.toggle('has-cw', items.length > 0);
    if (!items.length) { this.cw.replaceChildren(); return; }
    this.cw.replaceChildren(h('section', {class: 'row cw'}, rowHeader('Continue Watching', null),
      h('div', {class: 'row-scroll'}, ...items.map(e => this.continueCard(e)))));
  }

  /**
   * Opens a Continue Watching entry's streams once its metadata is in. One at
   * a time: a second tap while it loads does nothing, and if the viewer moved
   * on meanwhile (another tab, another screen) the streams are not pushed.
   */
  /**
   * Opens a Continue Watching entry's streams at once, from what was saved
   * with it; the full details (the episode list the player's next episode
   * needs) arrive behind the screen. A second tap while it opens does nothing.
   */
  resume(e, m, card, startTime) {
    if (this.resuming) return;
    this.resuming = true;
    setTimeout(() => { this.resuming = false; }, 600);
    const video = e.videoId && e.videoId !== m.id ? {id: e.videoId, season: e.season, episode: e.episode, title: e.title || '', thumbnail: e.thumbnail} : null;
    const screen = this.app.openStreams(m, video, {startTime});
    this.app.meta(m).then(meta => screen.updateMeta?.(meta), () => {}); // without the add-ons the saved card still plays: streams are asked by id
  }

  continueCard(e) {
    const m = e.meta || {id: e.id, type: e.type, name: ''};
    const code = episodeCode(e);
    const status = e.kind === 'next' ? 'Next Up' : e.duration ? timeLeft(e.duration - e.time) : '';
    const art = e.thumbnail || m.background || m.poster;
    const open = () => this.resume(e, m, card, e.kind === 'resume' ? e.time : 0);
    const card = h('button', {class: 'cw-card', type: 'button', onclick: open, 'aria-label': [m.name, code, status].filter(Boolean).join(', ')},
      h('div', {class: 'cw-art'}, image(art, '', 'cw-img'), h('div', {class: 'cw-shade'}),
        status ? h('span', {class: 'cw-chip'}, status) : null,
        h('div', {class: 'cw-text'}, code ? h('small', {}, code) : null, h('b', {}, m.name || ''), e.title ? h('span', {}, e.title) : null),
        e.kind === 'resume' ? h('div', {class: 'cw-progress'}, h('i', {style: {transform: `scaleX(${Math.min(1, e.time / e.duration)})`}})) : null));
    longPress(card, () => liftMenu(card.querySelector('.cw-art'), m.name, code, [
      {label: 'Go to details', icon: 'info', run: () => this.app.openTitle(m)},
      e.kind === 'resume' ? {label: 'Start from beginning', icon: 'replay', run: () => this.resume(e, m, card, 0)} : null,
      {label: 'Remove', icon: 'close', destructive: true, run: () => { this.app.progress.remove(e.type, e.id); toast('Removed from Continue Watching'); }},
    ].filter(Boolean)));
    return card;
  }
}

/** The hero: swipeable, loops, advances every 8 s while visible and untouched. */
class Hero {
  constructor(items, onOpen, scroller) {
    this.items = items;
    this.index = 0;
    this.onOpen = onOpen;
    this.track = h('div', {class: 'hero-track'});
    this.slides = items.map((m, i) => this.slide(m, i));
    this.track.append(...this.slides);
    this.dots = h('div', {class: 'hero-dots', role: 'tablist'}, ...items.map((m, i) => h('button', {class: 'hero-dot', type: 'button', role: 'tab', 'aria-label': `${i + 1} of ${items.length}: ${m.name}`, onclick: () => { this.go(i); this.restart(); }})));
    this.el = h('div', {class: 'hero', 'aria-roledescription': 'carousel', 'aria-label': 'Featured'}, this.track, this.dots);
    this.bindSwipe();
    this.onScroll = () => { const y = scroller.scrollTop; this.el.style.setProperty('--parallax', `${Math.min(y, 800) * 0.3}px`); };
    this.scroller = scroller;
    if (!scrollTimelines) scroller.addEventListener('scroll', this.onScroll, {passive: true});
    this.observer = new IntersectionObserver(([e]) => { this.visible = e.isIntersecting; if (this.visible) this.resume(); else this.pause(); }, {threshold: 0.3});
    this.observer.observe(this.el);
    this.onVisibility = () => (document.hidden ? this.pause() : this.resume());
    document.addEventListener('visibilitychange', this.onVisibility);
    this.go(0, false);
    this.resume();
  }

  slide(m, i = 1) {
    const meta = [m.type === 'series' ? 'Series' : 'Movie', (m.genres || [])[0], String(m.releaseInfo || m.year || '').slice(0, 4)].filter(Boolean);
    return h('article', {class: 'hero-slide', 'aria-roledescription': 'slide', 'aria-label': m.name},
      h('div', {class: 'hero-bg'}, image(m.background || m.poster, '', 'hero-img', {eager: i === 0})), h('div', {class: 'hero-shade'}),
      h('div', {class: 'hero-content'},
        m.logo ? h('button', {class: 'hero-logo', type: 'button', onclick: () => this.onOpen(m), 'aria-label': m.name}, image(m.logo, m.name, 'hero-logo-img')) : h('button', {class: 'hero-title', type: 'button', onclick: () => this.onOpen(m)}, m.name),
        h('p', {class: 'hero-meta'}, ...meta.flatMap((t, i) => i ? [h('i', {class: 'dot', 'aria-hidden': 'true'}), t] : [t])),
        h('button', {class: 'hero-cta', type: 'button', onclick: () => this.onOpen(m)}, 'View Details')));
  }

  go(i, animate = true) {
    const n = this.items.length;
    this.index = ((i % n) + n) % n;
    this.track.style.transition = animate && !reducedMotion() ? 'transform 450ms cubic-bezier(.2,0,0,1)' : 'none';
    this.track.style.transform = `translateX(${-this.index * 100}%)`;
    [...this.dots.children].forEach((d, k) => { d.classList.toggle('on', k === this.index); d.setAttribute('aria-selected', String(k === this.index)); });
    this.slides.forEach((s, k) => s.setAttribute('aria-hidden', String(k !== this.index)));
    // The art either side is fetched now, so a swipe or the next turn never shows it arriving.
    for (const k of [this.index - 1, this.index + 1]) {
      const img = this.slides[((k % n) + n) % n]?.querySelector('img[loading="lazy"]');
      if (img) img.loading = 'eager';
    }
  }

  bindSwipe() {
    let start = null;
    this.track.addEventListener('pointerdown', e => { if (e.button !== 0) return; start = {x: e.clientX, y: e.clientY, t: performance.now(), dx: 0, horizontal: null}; this.pause(); });
    this.track.addEventListener('pointermove', e => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (start.horizontal == null && Math.hypot(dx, dy) > 8) { start.horizontal = Math.abs(dx) > Math.abs(dy); if (start.horizontal) this.track.setPointerCapture(e.pointerId); }
      if (!start.horizontal) return;
      start.dx = dx;
      this.track.style.transition = 'none';
      this.track.style.transform = `translateX(calc(${-this.index * 100}% + ${dx}px))`;
    });
    const end = () => {
      if (!start) return;
      const {dx, t, horizontal} = start;
      start = null;
      if (horizontal) {
        const w = this.el.clientWidth, v = Math.abs(dx) / Math.max(1, performance.now() - t) * 1000;
        if (Math.abs(dx) > w * 0.16 || v > 300) this.go(this.index + (dx < 0 ? 1 : -1)); else this.go(this.index);
        this.suppressClick = Math.abs(dx) > 8;
      }
      this.restart();
    };
    this.track.addEventListener('pointerup', end);
    this.track.addEventListener('pointercancel', end);
    this.track.addEventListener('click', e => { if (this.suppressClick) { e.stopPropagation(); e.preventDefault(); this.suppressClick = false; } }, true);
  }

  pause() { clearInterval(this.timer); this.timer = 0; }
  resume() {
    if (this.timer || reducedMotion() || document.hidden || this.visible === false || this.items.length < 2 || !this.el.isConnected || this.el.closest('[hidden], .off, .covered')) return;
    this.timer = setInterval(() => this.go(this.index + 1), HERO_INTERVAL);
  }
  restart() { this.pause(); this.resume(); }
  destroy() { this.pause(); this.observer.disconnect(); this.scroller.removeEventListener('scroll', this.onScroll); document.removeEventListener('visibilitychange', this.onVisibility); }
}

export {episodeCode};
