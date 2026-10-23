// A title's page: hero, collapsing header, Play, overview, cast, episodes.

import {h, clock, reducedMotion} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {image, longPress, liftMenu, toast} from '../ui/components.js';
import {playTarget, seasonsOf, episodeCode, aired, runtimeLabel, releaseLabel} from '../app/content.js';

export class DetailsScreen {
  constructor(app, item) {
    this.app = app;
    this.item = item;
    // Fetch the player while the viewer reads, so Play opens it at once.
    (globalThis.requestIdleCallback || (fn => setTimeout(fn, 1200)))(() => app.loadPlayer?.().catch(() => {}));
    this.el = h('div', {class: 'screen details'});
    this.header = h('header', {class: 'details-header', 'aria-hidden': 'true'});
    this.backBtn = h('button', {class: 'float-back', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back', {size: 24}));
    this.body = h('div', {class: 'details-body'});
    this.el.append(this.body, this.header, this.backBtn);
    this.renderHero(item);
    this.body.append(h('div', {class: 'details-loading'}, h('div', {class: 'spinner'})));
    this.el.addEventListener('scroll', () => this.onScroll(), {passive: true});
    this.offs = [app.watched.onChange(() => this.meta && this.renderBody()), app.progress.onChange(() => this.meta && this.renderActions()), app.library.onChange(() => this.meta && this.renderActions())];
    this.load();
  }

  async load() {
    const meta = await this.app.meta(this.item);
    if (!this.el.isConnected && this.destroyed) return;
    this.meta = {...this.item, ...meta, videos: meta.videos || []};
    this.renderHero(this.meta);
    this.renderBody();
  }

  destroy() { this.destroyed = true; for (const off of this.offs) off(); }
  onShow(first) { if (!first && this.meta) this.renderActions(); }

  renderHero(m) {
    const genres = (m.genres || []).slice(0, 3).join(' • ');
    const hero = h('div', {class: 'details-hero'},
      h('div', {class: 'details-bg'}, image(m.background || m.poster, '', 'details-bg-img')), h('div', {class: 'details-shade'}),
      h('div', {class: 'details-hero-content'},
        m.logo ? image(m.logo, m.name, 'details-logo') : h('h1', {class: 'details-title'}, m.name || ''),
        genres ? h('p', {class: 'details-genres'}, genres) : null));
    const old = this.body.querySelector('.details-hero');
    if (old) old.replaceWith(hero); else this.body.prepend(hero);
    this.heroEl = hero;
    this.header.replaceChildren(h('button', {class: 'icon-btn', type: 'button', 'aria-label': 'Back', onclick: () => this.app.back()}, icon('back')),
      m.logo ? image(m.logo, m.name, 'header-logo') : h('b', {class: 'header-title'}, m.name || ''),
      this.libraryButton(m, 'icon-btn'));
  }

  libraryButton(m, cls) {
    const saved = this.app.library.has(m.type, m.id);
    return h('button', {class: cls + (saved ? ' active' : ''), type: 'button', 'aria-label': saved ? 'Remove from library' : 'Add to library', 'aria-pressed': String(saved),
      onclick: () => { const on = this.app.library.toggle(this.meta || m); toast(on ? 'Added to library' : 'Removed from library'); }}, icon(saved ? 'check' : 'plus', {size: 22}));
  }

  onScroll() {
    const y = this.el.scrollTop, h0 = this.heroEl?.offsetHeight || 400;
    const collapsed = y > h0 - 80;
    if (collapsed !== this.collapsed) {
      this.collapsed = collapsed;
      this.header.classList.toggle('show', collapsed);
      this.header.setAttribute('aria-hidden', String(!collapsed));
      this.backBtn.classList.toggle('hide', collapsed);
    }
    if (this.heroEl) this.heroEl.style.setProperty('--parallax', `${Math.min(y, 900) * 0.5}px`);
  }

  renderBody() {
    const m = this.meta;
    this.target = playTarget(m, this.app); // the episode row scrolls to it
    this.actionsSlot = h('div', {class: 'details-actions'});
    const sections = [this.actionsSlot, this.overview(m)];
    if (m.cast?.length || m.director?.length) sections.push(this.cast(m));
    if (m.type === 'series' && m.videos.length) sections.push(this.episodes(m));
    sections.push(this.facts(m));
    this.body.replaceChildren(this.heroEl, ...sections.filter(Boolean));
    this.renderActions();
  }

  renderActions() {
    const m = this.meta, target = playTarget(m, this.app);
    this.target = target;
    const expanded = this.moreOpen;
    const watchedTitle = this.app.watched.has(m.type, m.id);
    const play = h('button', {class: 'play-btn', type: 'button', disabled: !!target.disabled, onclick: () => this.play(target)}, icon('play', {size: 18}), h('span', {}, target.label));
    longPress(play, () => this.app.openStreams(m, target.video, {startTime: target.startTime}));
    const more = h('button', {class: 'round-btn more' + (expanded ? ' open' : ''), type: 'button', 'aria-label': expanded ? 'Fewer actions' : 'More actions', 'aria-expanded': String(!!expanded), onclick: () => { this.moreOpen = !expanded; this.renderActions(); }}, icon('more', {size: 22}));
    const extra = expanded ? [
      h('button', {class: 'round-btn' + (watchedTitle ? ' active' : ''), type: 'button', 'aria-label': watchedTitle ? 'Mark as unwatched' : 'Mark as watched', onclick: () => this.app.watched.set(m.type, m.id, null, !watchedTitle)}, icon('check', {size: 21})),
      this.libraryButton(m, 'round-btn'),
    ] : [];
    const resume = target.progress ? h('div', {class: 'resume-bar'}, h('i', {style: {transform: `scaleX(${Math.min(1, target.progress.time / target.progress.duration)})`}})) : null;
    this.actionsSlot.replaceChildren(...[h('div', {class: 'actions-row'}, play, ...extra, more), resume].filter(Boolean));
    this.header.querySelector('.icon-btn:last-child')?.replaceWith(this.libraryButton(m, 'icon-btn'));
  }

  play(target) { this.app.openStreams(this.meta, target.video, {startTime: target.startTime}); }

  overview(m) {
    const parts = [];
    const release = releaseLabel(m);
    if (release) parts.push(h('span', {}, release));
    const runtime = runtimeLabel(m.runtime);
    if (runtime) parts.push(h('span', {}, runtime));
    if (m.certification || m.ageRating) parts.push(h('span', {class: 'age-badge'}, m.certification || m.ageRating));
    if (m.imdbRating) parts.push(h('span', {class: 'imdb'}, h('b', {}, 'IMDb'), m.imdbRating));
    const desc = m.description || '';
    const text = h('p', {class: 'description'}, desc);
    const toggle = desc.length > 180 ? h('button', {class: 'more-link', type: 'button', 'aria-expanded': 'false', onclick: () => {
      const open = text.classList.toggle('open'); toggle.textContent = open ? 'Show Less' : 'Show More ▾'; toggle.setAttribute('aria-expanded', String(open));
    }}, 'Show More ▾') : null;
    const people = [['Director', m.director], ['Writer', m.writer]].filter(([, v]) => Array.isArray(v) && v.length);
    return h('section', {class: 'section overview'},
      parts.length ? h('div', {class: 'meta-line'}, ...parts) : null,
      ...people.map(([k, v]) => h('p', {class: 'people'}, h('b', {}, k + ': '), v.slice(0, 3).join(', '))),
      desc ? text : null, toggle);
  }

  cast(m) {
    const cast = (m.cast || []).slice(0, 20);
    if (!cast.length) return null;
    return h('section', {class: 'section'}, h('h2', {class: 'section-title'}, 'Cast'),
      h('div', {class: 'cast-row'}, ...cast.map(name => h('div', {class: 'cast'}, h('div', {class: 'cast-photo', 'aria-hidden': 'true'}, String(name).split(/\s+/).map(w => w[0]).slice(0, 2).join('')), h('span', {}, name)))));
  }

  episodes(m) {
    const seasons = seasonsOf(m);
    if (!seasons.length) return null;
    const targetSeason = this.target?.video?.season;
    this.season ??= seasons.includes(targetSeason) ? targetSeason : seasons.find(s => s > 0) ?? seasons[0];
    const list = h('div', {class: 'episode-row'});
    const chips = h('div', {class: 'season-chips', role: 'tablist'});
    const show = season => {
      this.season = season;
      chips.replaceChildren(...seasons.map(s => h('button', {class: 'chip', role: 'tab', type: 'button', 'aria-selected': String(s === season), 'aria-pressed': String(s === season), onclick: () => show(s)}, s === 0 ? 'Specials' : `Season ${s}`)));
      const videos = m.videos.filter(v => v.season === season);
      list.replaceChildren(...videos.map(v => this.episodeCard(m, v)));
      const next = list.querySelector('.episode-card.next');
      if (next && next !== list.firstElementChild) requestAnimationFrame(() => {
        const left = next.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft - 18;
        list.scrollTo({left, behavior: reducedMotion() ? 'auto' : 'smooth'});
      });
    };
    show(this.season);
    return h('section', {class: 'section'}, h('h2', {class: 'section-title'}, 'Episodes'), chips, list);
  }

  episodeCard(m, v) {
    const watched = this.app.watched.has(m.type, m.id, v.id);
    const p = this.app.progress.get(m.type, m.id, v.id);
    const isNext = this.target?.video?.id === v.id;
    const date = v.released ? new Date(v.released) : null;
    const card = h('button', {class: 'episode-card' + (isNext ? ' next' : '') + (aired(v) ? '' : ' unaired'), type: 'button', onclick: () => this.app.openStreams(m, v, {startTime: p && !p.completed ? p.time : 0})},
      h('div', {class: 'episode-art'}, image(v.thumbnail || m.background, '', 'episode-img'), h('div', {class: 'episode-shade'}),
        h('span', {class: 'episode-code'}, episodeCode(v)),
        watched ? h('span', {class: 'watched-badge'}, icon('check', {size: 12})) : null,
        h('div', {class: 'episode-text'}, h('b', {}, v.title || `Episode ${v.episode}`), v.overview ? h('span', {}, v.overview) : null,
          h('small', {}, [runtimeLabel(v.runtime), date ? date.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : ''].filter(Boolean).join(' · '))),
        p && !p.completed ? h('div', {class: 'episode-progress'}, h('i', {style: {transform: `scaleX(${Math.min(1, p.time / p.duration)})`}})) : null));
    card.setAttribute('aria-label', [episodeCode(v), v.title, watched ? 'watched' : '', p && !p.completed ? `${clock(p.time)} watched` : ''].filter(Boolean).join(', '));
    longPress(card, () => {
      const index = m.videos.indexOf(v);
      liftMenu(card.querySelector('.episode-art'), v.title || episodeCode(v), episodeCode(v), [
        watched ? {label: 'Mark as unwatched', icon: 'replay', run: () => this.app.watched.set(m.type, m.id, v.id, false)} : {label: 'Mark as watched', icon: 'check', run: () => this.app.watched.set(m.type, m.id, v.id, true)},
        {label: 'Mark previous as watched', icon: 'episodes', run: () => { for (const x of m.videos.slice(0, index)) if (x.season !== 0) this.app.watched.set(m.type, m.id, x.id, true); }},
        {label: `Mark Season ${v.season} as watched`, icon: 'check', run: () => { for (const x of m.videos) if (x.season === v.season) this.app.watched.set(m.type, m.id, x.id, true); }},
      ]);
    });
    return card;
  }

  facts(m) {
    const rows = [['Status', m.status], ['Release', m.releaseInfo || m.released?.slice?.(0, 10)], ['Runtime', runtimeLabel(m.runtime)], ['Country', m.country], ['Language', m.language], ['Genres', (m.genres || []).join(', ')]].filter(([, v]) => v);
    if (!rows.length) return null;
    return h('section', {class: 'section'}, h('h2', {class: 'section-title'}, 'Details'), h('dl', {class: 'facts'}, ...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, String(v))])));
  }
}
