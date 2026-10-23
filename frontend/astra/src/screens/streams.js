// Streams for a title or episode: every add-on is asked at once and fills in
// as it answers, in the add-ons' own order. Nothing is ranked or auto-picked.

import {h, clock} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {image, longPress, sheet, toast, emptyCard} from '../ui/components.js';
import {fetchStreams, supports} from '../addons/client.js';
import {episodeCode, videoTitle} from '../app/content.js';
import {externalPlayerUrl, canOpenExternally} from '../player/external.js';

/** Gives each stream of a group a key that stays the same however the list is filtered. */
const keyed = g => ({...g, streams: g.streams ? g.streams.map((s, i) => ({...s, key: `${g.addon.url}#${i}`})) : g.streams});

const NEEDS_DEBRID = 'Torrents need a debrid add-on such as TorBox.';
/** A placeholder stream card while an add-on is asked (Nuvio's: two bars on a card). */
const skeletonStream = () => h('div', {class: 'stream-skeleton', 'aria-hidden': 'true'}, h('i', {class: 'skeleton'}), h('i', {class: 'skeleton'}));
const sizeLabel = n => !n ? '' : n >= 1e9 ? (n / 1e9).toFixed(n >= 1e10 ? 0 : 1) + ' GB' : Math.round(n / 1e6) + ' MB';

/** A best-effort size from the stream's own text ("💾 4.2 GB"). */
export function sizeFrom(stream) {
  if (stream.size) return sizeLabel(stream.size);
  const m = /(\d+(?:[.,]\d+)?)\s*(GB|MB|GiB|MiB)\b/i.exec(stream.title + ' ' + stream.name);
  return m ? `${m[1].replace(',', '.')} ${m[2].toUpperCase().replace('I', '')}` : '';
}

export class StreamsScreen {
  constructor(app, meta, video = null, {startTime = 0, headless = false} = {}) {
    this.app = app;
    this.meta = meta;
    this.video = video;
    this.startTime = startTime;
    this.groups = new Map();
    this.names = new Map();
    this.filter = app.store.get('lastAddon', 'all');
    if (headless) return;
    app.loadPlayer?.().catch(() => {});
    // "No compatible add-ons" may change when a late manifest arrives or add-ons are edited.
    this.offAddons = app.onAddons?.(() => { if (this.empty) this.load(); });
    this.el = h('div', {class: 'screen streams'});
    this.chips = h('div', {class: 'filter-chips', role: 'tablist'});
    this.list = h('div', {class: 'stream-list', 'aria-live': 'polite'});
    this.footer = h('p', {class: 'stream-footer'});
    this.el.append(...[this.hero(), h('button', {class: 'float-back solid', type: 'button', 'aria-label': 'Back', onclick: () => app.back()}, icon('back')),
      startTime > 30 ? h('div', {class: 'resume-pill'}, icon('replay', {size: 16}), `Resume from ${clock(startTime)}`) : null,
      this.chips, this.list, this.footer].filter(Boolean));
    this.load();
  }

  hero() {
    const m = this.meta, v = this.video;
    if (v) {
      return h('div', {class: 'streams-hero episode'}, h('div', {class: 'streams-art'}, image(v.thumbnail || m.background, '', 'streams-img')), h('div', {class: 'streams-shade'}),
        h('div', {class: 'streams-text'}, episodeCode(v) ? h('b', {class: 'code'}, episodeCode(v)) : null, h('h1', {}, videoTitle(v)), h('p', {}, m.name)));
    }
    return h('div', {class: 'streams-hero movie'}, h('div', {class: 'streams-art'}, image(m.background, '', 'streams-img')), h('div', {class: 'streams-shade'}),
      m.logo ? image(m.logo, m.name, 'streams-logo') : h('h1', {class: 'streams-name'}, m.name));
  }

  get id() { return this.video ? this.video.id : this.meta.id; }

  destroy() { this.destroyed = true; this.abort?.abort(); this.offAddons?.(); }

  /**
   * The title's full details, when the screen was opened from a saved card
   * (Continue Watching): Play then has the episode list for the next episode,
   * and the episode's own title and art replace the saved ones.
   */
  updateMeta(meta) {
    if (!meta || this.destroyed) return;
    this.meta = {...this.meta, ...meta, videos: meta.videos || this.meta.videos || []};
    const full = this.video && this.meta.videos.find(v => v.id === this.video.id);
    if (full && (full.title !== this.video.title || full.thumbnail !== this.video.thumbnail)) {
      this.video = full;
      this.el.querySelector('.streams-hero')?.replaceWith(this.hero());
    }
  }

  /**
   * An add-on's label on this screen: its manifest's name when known, else the
   * name saved with it. Chosen once, so a chip never renames itself on answering.
   */
  nameOf(addon) {
    if (!this.names.has(addon.url)) this.names.set(addon.url, this.app.manifests.get(addon.url)?.name || addon.name || 'Add-on');
    return this.names.get(addon.url);
  }

  /** Collects every playable stream without drawing (used by the player's episode switch). */
  async collect() {
    await this.app.ready;
    await fetchStreams(this.addons(), this.meta.type, this.id, {onGroup: g => this.groups.set(g.addon.url, keyed(g))});
    return this.sources();
  }

  /** Add-ons that may have streams: those that say so, and those not reached yet (asked again). */
  addons() {
    return this.app.enabledAddons().filter(a => {
      const m = this.app.manifests.get(a.url);
      return !m || supports(m, 'stream', this.meta.type, this.id);
    });
  }

  async load() {
    this.abort?.abort();
    const abort = this.abort = new AbortController();
    this.groups.clear();
    this.loading = true;
    this.empty = false;
    await this.app.ready;
    if (abort.signal.aborted) return;
    const addons = this.addons();
    if (!this.app.enabledAddons().length) { this.renderEmpty('No add-ons installed', 'Install an add-on with streams in Settings.'); return; }
    if (!addons.length) { this.renderEmpty('No compatible add-ons', 'None of your add-ons offer streams for this title.', true); return; }
    for (const [order, a] of addons.entries()) this.groups.set(a.url, {addon: {...a, name: this.nameOf(a)}, order, streams: null});
    this.render();
    await this.ask(addons, abort.signal);
    if (abort.signal.aborted) return;
    this.loading = false;
    this.render();
  }

  /**
   * Asks these add-ons for streams; each group fills in, or fails, as its
   * add-on answers. An add-on reached only now that turns out to have no
   * streams for this title is dropped.
   */
  async ask(addons, signal) {
    await fetchStreams(addons, this.meta.type, this.id, {signal, onGroup: g => {
      const group = this.groups.get(g.addon.url);
      if (signal.aborted || !group) return;
      this.groups.set(g.addon.url, keyed({...g, addon: group.addon, order: group.order}));
      this.render();
    }});
    if (signal.aborted) return;
    for (const a of addons) if (this.groups.get(a.url)?.streams === null) this.groups.delete(a.url);
  }

  /** Asks one add-on again (its Retry), leaving the others as they are. */
  async retry(url) {
    const group = this.groups.get(url), signal = this.abort?.signal;
    if (!group || group.streams === null || !signal) return;
    this.groups.set(url, {addon: group.addon, order: group.order, streams: null});
    this.render();
    await this.ask([group.addon], signal);
    if (!signal.aborted) this.render();
  }

  sources() {
    return [...this.groups.values()].filter(g => g.streams).sort((a, b) => a.order - b.order)
      .flatMap(g => g.streams.filter(s => s.url).map(s => ({id: s.key, addonUrl: g.addon.url,
        label: `${g.addon.name} · ${(s.name || '').replace(/\s+/g, ' ')}`.trim(), detail: [s.title, sizeFrom(s)].filter(Boolean).join('\n'),
        stream: {...s, name: `${g.addon.name} ${(s.name || '').replace(/\s+/g, ' ')}`.trim()}})));
  }

  refreshChip() {
    return h('button', {class: 'chip refresh' + (this.loading ? ' spinning' : ''), type: 'button', 'aria-label': 'Refresh streams', onclick: () => this.load()}, icon('replay', {size: 18}));
  }

  /** A state with nothing to list. Refresh stays, so a late add-on or a fixed connection can still be tried. */
  renderEmpty(title, body, retry = false) {
    this.loading = false;
    this.empty = true;
    this.chipSignature = null;
    this.sections?.clear();
    this.chips.replaceChildren(this.refreshChip());
    this.list.replaceChildren(emptyCard(title, body, retry ? {label: 'Refresh', run: () => this.load()} : null));
    this.footer.textContent = '';
  }

  /** An add-on that failed: one line with its name, the reason, and Retry for that add-on only. */
  failedRow(g) {
    return h('div', {class: 'group-error'},
      h('span', {class: 'group-error-text'}, h('b', {}, g.addon.name), " didn't answer", g.error?.message ? h('small', {}, g.error.message) : null),
      h('button', {class: 'chip', type: 'button', 'aria-label': `Retry ${g.addon.name}`, onclick: () => this.retry(g.addon.url)}, 'Retry'));
  }

  /**
   * Draws the chips and the list. Each add-on has one section, created in
   * add-on order when the screen opens (with placeholder cards while it is
   * asked) and filled in place when it answers: cards already on screen are
   * never replaced or moved by another add-on's answer, so a press in
   * progress is not lost and nothing jumps.
   */
  render() {
    const groups = [...this.groups.values()].sort((a, b) => a.order - b.order);
    // Listed: add-ons still asking, with streams, or that failed. One that answered with none is left out.
    const listed = groups.filter(g => g.streams === null || g.streams?.length || g.error);
    // The remembered add-on may have nothing for this title: show everything rather than an empty list.
    if (this.filter !== 'all' && !listed.some(g => g.addon.url === this.filter)) this.filter = 'all';
    this.renderChips(listed);
    const shown = this.filter === 'all' ? listed : listed.filter(g => g.addon.url === this.filter);
    const asking = groups.some(g => g.streams === null);
    const nothing = !this.loading && !asking && !groups.some(g => g.streams?.length);
    const failed = groups.filter(g => g.error).length;
    const state = nothing ? h('div', {class: 'state-card'}, h('h3', {}, 'No streams found'),
      h('p', {}, failed === groups.length && failed ? 'None of your add-ons answered. Check the connection and try again.' : failed ? 'The add-ons that answered had none for this title.' : 'None of your add-ons returned streams for this title.'),
      h('button', {class: 'btn primary wide', type: 'button', onclick: () => this.load()}, 'Try again')) : null;
    this.sections ??= new Map();
    const wanted = shown.map(g => this.section(g));
    for (const [url, sec] of this.sections) if (!wanted.includes(sec)) { sec.el.remove(); if (!this.groups.has(url)) this.sections.delete(url); }
    const order = [state, ...wanted.map(sec => sec.el)].filter(Boolean);
    // Only out-of-place nodes move.
    this.list.querySelector(':scope > .state-card')?.remove();
    order.forEach((el, i) => { if (this.list.children[i] !== el) this.list.insertBefore(el, this.list.children[i] || null); });
    while (this.list.children.length > order.length) this.list.lastElementChild.remove();
    this.footer.textContent = asking ? 'Checking more add-ons…' : '';
  }

  /** The chips, rebuilt only when what they show changes (so their scroll stays put). */
  renderChips(listed) {
    const signature = [this.filter, this.loading, ...listed.map(g => g.addon.url + (g.error ? '!' : ''))].join('|');
    if (signature === this.chipSignature) return;
    this.chipSignature = signature;
    const chip = (id, label, failed = false) => h('button', {class: 'chip' + (failed ? ' failed' : ''), role: 'tab', type: 'button', 'aria-selected': String(this.filter === id), 'aria-pressed': String(this.filter === id),
      'aria-label': failed ? `${label}, didn't answer` : null, onclick: () => { this.filter = id; this.app.store.set('lastAddon', id); this.render(); }}, label);
    this.chips.replaceChildren(this.refreshChip(), chip('all', 'All'), ...listed.map(g => chip(g.addon.url, g.addon.name, !!g.error)));
  }

  /** One add-on's section, updated in place: its title, then placeholders, its cards, or its error row. */
  section(g) {
    let sec = this.sections.get(g.addon.url);
    if (!sec) {
      const fetching = h('span', {class: 'fetching'}, ' Fetching…');
      const head = h('h3', {class: 'group-title'}, g.addon.name, fetching);
      const body = h('div', {class: 'group-body'});
      sec = {el: h('section', {class: 'stream-group', 'data-addon': g.addon.url}, head, body), head, fetching, body, shows: undefined};
      this.sections.set(g.addon.url, sec);
    }
    sec.head.hidden = this.filter !== 'all' || !!g.error;
    sec.fetching.hidden = g.streams !== null;
    // What the body shows: placeholders, an error, or this exact list of streams.
    const shows = g.error ? g.error : g.streams === null ? 'asking' : g.streams;
    if (sec.shows !== shows) {
      sec.shows = shows;
      sec.body.replaceChildren(...(g.error ? [this.failedRow(g)]
        : g.streams === null ? [skeletonStream(), skeletonStream()]
        : g.streams.map((s, i) => this.card(g, s, i))));
    }
    return sec;
  }

  card(group, s, i) {
    const playable = !!s.url;
    const size = s.size ? sizeFrom(s) : ''; // a size already in the description is not repeated
    const card = h('button', {class: 'stream-card' + (playable ? '' : ' disabled'), type: 'button', 'aria-disabled': String(!playable),
      onclick: () => {
        if (!playable && s.externalUrl && /^https?:/i.test(s.externalUrl)) { window.open(s.externalUrl, '_blank', 'noopener'); return; }
        if (!playable) { toast(s.infoHash ? NEEDS_DEBRID : 'This source has no playable link.'); return; }
        // The sources as they are now (more add-ons may have answered since this card was drawn).
        const sources = this.sources(), source = sources.find(x => x.id === s.key);
        if (!source) return;
        this.app.play({meta: this.meta, video: this.video, source, sources, startTime: this.startTime});
      }},
      h('b', {class: 'stream-name'}, (s.name || group.addon.name).replace(/\s*\n\s*/g, ' ')),
      s.title ? h('span', {class: 'stream-desc'}, s.title) : null,
      h('span', {class: 'stream-badges'}, size ? h('em', {}, size) : null, !playable && s.infoHash ? h('em', {class: 'muted'}, 'Torrent') : null));
    if (playable) longPress(card, () => sheet(s.name?.replace(/\s+/g, ' ') || group.addon.name, [
      {label: 'Copy stream link', icon: 'copy', run: () => navigator.clipboard.writeText(s.url).then(() => toast('Link copied'), () => toast('Copy failed'))},
      canOpenExternally() ? {label: 'Play in another app', icon: 'play', run: () => { const url = externalPlayerUrl(s.url, {title: this.meta.name || ''}); if (url) location.href = url; }} : null,
      {label: 'Open in VLC', icon: 'play', run: () => { location.href = `intent:${s.url}#Intent;package=org.videolan.vlc;type=video/*;S.title=${encodeURIComponent(this.meta.name || '')};end`; }},
      {label: 'Check playback in the lab', icon: 'info', run: () => { location.href = `lab/?src=${encodeURIComponent(s.url)}`; }},
    ].filter(Boolean), {subtitle: group.addon.name}));
    return card;
  }
}
