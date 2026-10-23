// A title's page: hero, collapsing header, Play, overview, cast, episodes.

import {h, clock, reducedMotion, scrollTimelines} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {image, longPress, liftMenu, toast} from '../ui/components.js';
import {playTarget, seasonsOf, episodeCode, videoTitle, aired, namesOf, runtimeLabel, releaseLabel} from '../app/content.js';

const validDate = value => { const d = value ? new Date(value) : null; return d && !Number.isNaN(d.getTime()) ? d : null; };
const plain = v => typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v) : ''; // text, never "[object Object]"

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
    // Until the full details arrive: what the card already knows (a catalog item
    // often carries the description), with a placeholder where Play will be.
    this.body.append(h('div', {class: 'details-actions'}, h('div', {class: 'actions-row'}, h('div', {class: 'skeleton play-ph', 'aria-hidden': 'true'}))),
      plain(item.description) ? this.overview(item) : h('div', {class: 'details-loading'}, h('div', {class: 'spinner'})));
    this.el.addEventListener('scroll', () => this.onScroll(), {passive: true});
    // Watched changes redraw at most once a frame, and only what shows them: the actions and the episodes.
    const watchedChanged = () => {
      if (!this.meta || this.watchedFrame) return;
      this.watchedFrame = requestAnimationFrame(() => {
        this.watchedFrame = 0;
        if (this.destroyed) return;
        this.renderActions();
        // The episode row is redrawn where the viewer left it, not scrolled back to the next episode.
        const row = this.body.querySelector('.episode-row'), old = row?.closest('.section');
        this.keepScroll = row ? row.scrollLeft : null;
        const fresh = old && this.episodes(this.meta);
        if (fresh) { old.replaceWith(fresh); const list = fresh.querySelector('.episode-row'); if (list) list.scrollLeft = this.keepScroll; }
        this.keepScroll = null;
      });
    };
    this.offs = [app.watched.onChange(watchedChanged), app.progress.onChange(() => this.meta && this.renderActions()), app.library.onChange(() => this.meta && this.renderActions())];
    // Details that could not load are tried again when the add-ons or the connection come back.
    const retry = () => { if (this.failed && !this.loading) this.load(); };
    addEventListener('online', retry);
    this.offs.push(() => removeEventListener('online', retry));
    if (app.onAddons) this.offs.push(app.onAddons(retry));
    this.load();
  }

  async load() {
    this.loading = true;
    const retry = this.body.querySelector('.details-error .btn');
    if (retry) { retry.disabled = true; retry.textContent = 'Retrying…'; }
    let meta = null;
    try { meta = await this.app.meta(this.item); } catch (error) { this.error = error; }
    this.loading = false;
    if (this.destroyed) return;
    // A failure keeps the poster, title and backdrop the card already had.
    this.failed = !meta;
    this.meta = meta ? {...this.item, ...meta, videos: meta.videos || []} : {...this.item, videos: []};
    this.renderHero(this.meta);
    this.renderBody();
  }

  destroy() { this.destroyed = true; for (const off of this.offs) off(); }
  onShow(first) { if (!first && this.meta) this.renderActions(); }

  /**
   * The hero, drawn at once from the card that was tapped (its art is usually
   * already in the browser) and updated in place when the full details
   * arrive: an image whose address did not change is kept, never re-faded.
   */
  renderHero(m) {
    if (!this.hero) {
      const bg = h('div', {class: 'details-bg'}), title = h('div', {class: 'details-title-slot'}), genres = h('p', {class: 'details-genres'});
      this.hero = {bg, title, genres, el: h('div', {class: 'details-hero'}, bg, h('div', {class: 'details-shade'}), h('div', {class: 'details-hero-content'}, title, genres))};
      this.body.prepend(this.hero.el);
      this.heroEl = this.hero.el;
    }
    const art = m.background || m.poster || '';
    if (art !== this.hero.art) { this.hero.art = art; this.hero.bg.replaceChildren(image(art, '', 'details-bg-img', {eager: true})); }
    const titleKey = (m.logo || '') + '\n' + (m.name || '');
    if (titleKey !== this.hero.titleKey) {
      this.hero.titleKey = titleKey;
      this.hero.title.replaceChildren(m.logo ? image(m.logo, m.name, 'details-logo', {eager: true}) : h('h1', {class: 'details-title'}, m.name || ''));
    }
    const genres = namesOf(m.genres).slice(0, 3).join(' • ');
    this.hero.genres.textContent = genres;
    this.hero.genres.hidden = !genres;
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
    if (this.heroEl && !scrollTimelines) this.heroEl.style.setProperty('--parallax', `${Math.min(y, 900) * 0.5}px`);
  }

  renderBody() {
    const m = this.meta;
    this.target = playTarget(m, this.app); // the episode row scrolls to it
    this.actionsSlot = h('div', {class: 'details-actions'});
    const sections = [this.actionsSlot, this.failed ? this.failure() : null, this.overview(m)];
    if (namesOf(m.cast).length) sections.push(this.cast(m));
    if (m.type === 'series' && m.videos.length) sections.push(this.episodes(m));
    sections.push(this.facts(m));
    this.body.replaceChildren(this.heroEl, ...sections.filter(Boolean));
    this.renderActions();
  }

  /** The add-ons could not be reached: say so, with Retry (also tried by itself when they are back). */
  failure() {
    const offline = navigator.onLine === false;
    const reason = offline ? 'This phone is offline.' : this.error?.message || 'Your add-ons did not answer.';
    return h('div', {class: 'state-card details-error', role: 'status'}, h('h3', {}, "Couldn't load details"),
      h('p', {}, `${reason} Episodes and more appear once it loads; Astra tries again when the connection is back.`),
      h('button', {class: 'btn primary wide', type: 'button', disabled: !!this.loading, onclick: () => this.load()}, this.loading ? 'Retrying…' : 'Retry'));
  }

  renderActions() {
    const m = this.meta, target = playTarget(m, this.app);
    this.target = target;
    const expanded = this.moreOpen;
    const watchedTitle = this.app.watched.has(m.type, m.id);
    // A series without its episode list would ask for streams of the whole show: wait for the episodes.
    const blocked = !!target.disabled || (this.failed && m.type === 'series');
    const play = h('button', {class: 'play-btn', type: 'button', disabled: blocked, onclick: () => this.play(target)}, icon('play', {size: 18}), h('span', {}, target.label));
    longPress(play, () => { if (!blocked) this.app.openStreams(m, target.video, {startTime: target.startTime}); });
    // The row and its More button stay in place (only what changed is swapped), so the button's turn animates.
    const row = this.actionsSlot.querySelector('.actions-row') || h('div', {class: 'actions-row'});
    const more = row.querySelector('.round-btn.more') || h('button', {class: 'round-btn more', type: 'button', onclick: () => { this.moreOpen = !this.moreOpen; this.renderActions(); }}, icon('more', {size: 22}));
    more.classList.toggle('open', !!expanded);
    more.setAttribute('aria-label', expanded ? 'Fewer actions' : 'More actions');
    more.setAttribute('aria-expanded', String(!!expanded));
    const extra = expanded ? [
      h('button', {class: 'round-btn' + (watchedTitle ? ' active' : ''), type: 'button', 'aria-label': watchedTitle ? 'Mark as unwatched' : 'Mark as watched', onclick: () => this.app.watched.set(m.type, m.id, null, !watchedTitle)}, icon('check', {size: 21})),
      this.libraryButton(m, 'round-btn'),
    ] : [];
    const resume = target.progress ? h('div', {class: 'resume-bar'}, h('i', {style: {transform: `scaleX(${Math.min(1, target.progress.time / target.progress.duration)})`}})) : null;
    for (const child of [...row.children]) if (child !== more) child.remove();
    row.prepend(play, ...extra);
    if (more.parentNode !== row) row.append(more);
    if (row.parentNode !== this.actionsSlot) this.actionsSlot.prepend(row);
    this.actionsSlot.querySelector('.resume-bar')?.remove();
    if (resume) this.actionsSlot.append(resume);
    this.header.querySelector('.icon-btn:last-child')?.replaceWith(this.libraryButton(m, 'icon-btn'));
  }

  play(target) { this.app.openStreams(this.meta, target.video, {startTime: target.startTime}); }

  overview(m) {
    const parts = [];
    const release = releaseLabel(m);
    if (release) parts.push(h('span', {}, release));
    const runtime = runtimeLabel(m.runtime);
    if (runtime) parts.push(h('span', {}, runtime));
    const age = plain(m.certification) || plain(m.ageRating), rating = plain(m.imdbRating);
    if (age) parts.push(h('span', {class: 'age-badge'}, age));
    if (rating) parts.push(h('span', {class: 'imdb'}, h('b', {}, 'IMDb'), rating));
    const desc = typeof m.description === 'string' ? m.description : '';
    // "Show more" appears only when the story is really cut at three lines (measured, at
    // any width), and the story itself toggles too, as in Nuvio.
    const text = h('p', {class: 'description', onclick: () => { if (!toggle.hidden) flip(); }}, desc);
    const flip = () => { const open = text.classList.toggle('open'); toggle.textContent = open ? 'Show less' : 'Show more'; toggle.setAttribute('aria-expanded', String(open)); };
    const toggle = h('button', {class: 'more-link', type: 'button', 'aria-expanded': 'false', hidden: true, onclick: flip}, 'Show more');
    if (desc && typeof ResizeObserver === 'function') new ResizeObserver(() => {
      if (text.classList.contains('open')) return;
      toggle.hidden = text.scrollHeight <= text.clientHeight + 1;
      text.classList.toggle('clamped', !toggle.hidden);
    }).observe(text);
    const people = [['Director', namesOf(m.director)], ['Writer', namesOf(m.writer)]].filter(([, v]) => v.length);
    return h('section', {class: 'section overview'},
      parts.length ? h('div', {class: 'meta-line'}, ...parts) : null,
      ...people.map(([k, v]) => h('p', {class: 'people'}, h('b', {}, k + ': '), v.slice(0, 3).join(', '))),
      desc ? text : null, desc ? toggle : null);
  }

  cast(m) {
    const cast = namesOf(m.cast).slice(0, 20);
    if (!cast.length) return null;
    return h('section', {class: 'section'}, h('h2', {class: 'section-title'}, 'Cast'),
      h('div', {class: 'cast-row'}, ...cast.map(name => h('div', {class: 'cast'}, h('div', {class: 'cast-photo', 'aria-hidden': 'true'}, name.split(/\s+/).map(w => w[0]).slice(0, 2).join('')), h('span', {}, name)))));
  }

  episodes(m) {
    const seasons = seasonsOf(m);
    const list = h('div', {class: 'episode-row'});
    // Channels and some anime list videos with no season at all: one flat row of the same cards.
    if (!seasons.length) {
      list.append(...m.videos.map(v => this.episodeCard(m, v)));
      this.scrollToNext(list);
      return h('section', {class: 'section'}, h('h2', {class: 'section-title'}, 'Videos'), list);
    }
    const targetSeason = this.target?.video?.season;
    this.season ??= seasons.includes(targetSeason) ? targetSeason : seasons.find(s => s > 0) ?? seasons[0];
    const chips = h('div', {class: 'season-chips', role: 'tablist'});
    const show = season => {
      this.season = season;
      chips.replaceChildren(...seasons.map(s => h('button', {class: 'chip', role: 'tab', type: 'button', 'aria-selected': String(s === season), 'aria-pressed': String(s === season), onclick: () => show(s)}, s === 0 ? 'Specials' : `Season ${s}`)));
      const videos = m.videos.filter(v => v.season === season);
      list.replaceChildren(...videos.map(v => this.episodeCard(m, v)));
      this.scrollToNext(list);
    };
    show(this.season);
    return h('section', {class: 'section'}, h('h2', {class: 'section-title'}, 'Episodes'), chips, list);
  }

  /** Scrolls an episode row so the episode Play would start is in view. */
  scrollToNext(list) {
    if (this.keepScroll != null) return;
    const next = list.querySelector('.episode-card.next');
    if (next && next !== list.firstElementChild) requestAnimationFrame(() => {
      const left = next.getBoundingClientRect().left - list.getBoundingClientRect().left + list.scrollLeft - 18;
      list.scrollTo({left, behavior: reducedMotion() ? 'auto' : 'smooth'});
    });
  }

  episodeCard(m, v) {
    const watched = this.app.watched.has(m.type, m.id, v.id);
    const p = this.app.progress.get(m.type, m.id, v.id);
    const isNext = this.target?.video?.id === v.id;
    const date = validDate(v.released); // an unreadable date is not shown
    const code = episodeCode(v);
    const runtime = runtimeLabel(v.runtime), day = date ? date.toLocaleDateString(undefined, {month: 'short', day: 'numeric', year: 'numeric'}) : '';
    // Nuvio's stack at the bottom of the art: code, title, story, then runtime left and date right.
    const card = h('button', {class: 'episode-card' + (isNext ? ' next' : '') + (aired(v) ? '' : ' unaired'), type: 'button', onclick: () => this.app.openStreams(m, v, {startTime: p && !p.completed ? p.time : 0})},
      h('div', {class: 'episode-art'}, image(v.thumbnail || m.background, '', 'episode-img'), h('div', {class: 'episode-shade'}),
        watched ? h('span', {class: 'watched-badge'}, icon('check', {size: 12})) : null,
        h('div', {class: 'episode-text'}, code ? h('span', {class: 'episode-code'}, code) : null, h('b', {}, videoTitle(v)), v.overview ? h('span', {class: 'episode-overview'}, v.overview) : null,
          runtime || day ? h('span', {class: 'episode-meta'}, h('span', {}, runtime), h('span', {}, day)) : null),
        p && !p.completed ? h('div', {class: 'episode-progress'}, h('i', {style: {transform: `scaleX(${Math.min(1, p.time / p.duration)})`}})) : null));
    card.setAttribute('aria-label', [code, v.title || (code ? '' : videoTitle(v)), watched ? 'watched' : '', p && !p.completed ? `${clock(p.time)} watched` : ''].filter(Boolean).join(', '));
    longPress(card, () => {
      const index = m.videos.indexOf(v);
      liftMenu(card.querySelector('.episode-art'), v.title || episodeCode(v), episodeCode(v), [
        watched ? {label: 'Mark as unwatched', icon: 'checkCircleOutline', run: () => this.app.watched.set(m.type, m.id, v.id, false)} : {label: 'Mark as watched', icon: 'checkCircle', run: () => this.app.watched.set(m.type, m.id, v.id, true)},
        {label: 'Mark previous as watched', icon: 'episodes', run: () => this.app.watched.setMany(m.videos.slice(0, index).filter(x => x.season !== 0).map(x => [m.type, m.id, x.id]), true)},
        v.season != null ? {label: `Mark Season ${v.season} as watched`, icon: 'checkCircle', run: () => this.app.watched.setMany(m.videos.filter(x => x.season === v.season).map(x => [m.type, m.id, x.id]), true)} : null, // a channel's videos have no season
      ].filter(Boolean));
    });
    return card;
  }

  facts(m) {
    const rows = [['Status', m.status], ['Release', m.releaseInfo || m.released?.slice?.(0, 10)], ['Runtime', runtimeLabel(m.runtime)], ['Country', m.country], ['Language', m.language], ['Genres', namesOf(m.genres).join(', ')]].filter(([, v]) => v && typeof v !== 'object');
    if (!rows.length) return null;
    return h('section', {class: 'section'}, h('h2', {class: 'section-title'}, 'Details'), h('dl', {class: 'facts'}, ...rows.map(([k, v]) => h('div', {class: 'fact'}, h('dt', {}, k), h('dd', {}, String(v))))));
  }
}
