// Streams for a title or episode: every add-on is asked at once and fills in
// as it answers, in the add-ons' own order. Nothing is ranked or auto-picked.

import {h, clock} from '../ui/dom.js';
import {icon} from '../ui/icons.js';
import {image, longPress, sheet, toast} from '../ui/components.js';
import {fetchStreams, supports} from '../addons/client.js';
import {episodeCode} from '../app/content.js';

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
    this.filter = app.store.get('lastAddon', 'all');
    if (headless) return;
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
        h('div', {class: 'streams-text'}, h('b', {class: 'code'}, episodeCode(v)), h('h1', {}, v.title || `Episode ${v.episode}`), h('p', {}, m.name)));
    }
    return h('div', {class: 'streams-hero movie'}, h('div', {class: 'streams-art'}, image(m.background, '', 'streams-img')), h('div', {class: 'streams-shade'}),
      m.logo ? image(m.logo, m.name, 'streams-logo') : h('h1', {class: 'streams-name'}, m.name));
  }

  get id() { return this.video ? this.video.id : this.meta.id; }

  /** Collects every playable stream without drawing (used by the player's episode switch). */
  async collect() {
    await this.app.ready;
    await fetchStreams(this.addons(), this.meta.type, this.id, {onGroup: g => this.groups.set(g.addon.url, g)});
    return this.sources();
  }

  addons() {
    return this.app.enabledAddons().filter(a => {
      const m = this.app.manifests.get(a.url);
      return m && supports(m, 'stream', this.meta.type, this.id);
    });
  }

  async load() {
    this.groups.clear();
    this.loading = true;
    await this.app.ready;
    const addons = this.addons();
    if (!this.app.enabledAddons().length) { this.renderEmpty('No add-ons installed', 'Install an add-on with streams in Settings.'); return; }
    if (!addons.length) { this.renderEmpty('No compatible add-ons', 'None of your add-ons offer streams for this title.'); return; }
    this.pending = new Set(addons.map(a => a.url));
    for (const [order, a] of addons.entries()) this.groups.set(a.url, {addon: a, order, streams: null});
    this.render();
    await fetchStreams(addons, this.meta.type, this.id, {onGroup: g => {
      this.pending.delete(g.addon.url);
      this.groups.set(g.addon.url, {...g, order: addons.findIndex(a => a.url === g.addon.url)});
      this.render();
    }});
    this.loading = false;
    this.pending.clear();
    this.render();
  }

  sources() {
    return [...this.groups.values()].filter(g => g.streams).sort((a, b) => a.order - b.order)
      .flatMap(g => g.streams.filter(s => s.url).map((s, i) => ({id: `${g.addon.url}#${i}`, addonUrl: g.addon.url,
        label: `${g.addon.name} · ${(s.name || '').replace(/\s+/g, ' ')}`.trim(), detail: [s.title, sizeFrom(s)].filter(Boolean).join('\n'),
        stream: {...s, name: `${g.addon.name} ${(s.name || '').replace(/\s+/g, ' ')}`.trim()}})));
  }

  renderEmpty(title, body) {
    this.chips.replaceChildren();
    this.list.replaceChildren(h('div', {class: 'state-card'}, h('h3', {}, title), h('p', {}, body)));
    this.footer.textContent = '';
  }

  render() {
    const groups = [...this.groups.values()].sort((a, b) => a.order - b.order);
    const withStreams = groups.filter(g => g.streams === null || g.streams?.length);
    if (this.filter !== 'all' && !groups.some(g => g.addon.url === this.filter)) this.filter = 'all';
    const refresh = h('button', {class: 'chip refresh' + (this.loading ? ' spinning' : ''), type: 'button', 'aria-label': 'Refresh streams', onclick: () => this.load()}, icon('replay', {size: 18}));
    const chip = (id, label) => h('button', {class: 'chip', role: 'tab', type: 'button', 'aria-selected': String(this.filter === id), 'aria-pressed': String(this.filter === id), onclick: () => { this.filter = id; this.app.store.set('lastAddon', id); this.render(); }}, label);
    this.chips.replaceChildren(refresh, chip('all', 'All'), ...withStreams.map(g => chip(g.addon.url, g.addon.name)));
    const shown = this.filter === 'all' ? withStreams : withStreams.filter(g => g.addon.url === this.filter);
    const sources = this.sources();
    this.list.replaceChildren(...shown.flatMap(g => [
      this.filter === 'all' ? h('h3', {class: 'group-title'}, g.addon.name, g.streams === null ? h('span', {class: 'fetching'}, ' Fetching…') : null) : null,
      ...(g.streams || []).map((s, i) => this.card(g, s, i, sources)),
    ]).filter(Boolean));
    if (!this.loading && !sources.length && !groups.some(g => g.streams?.length)) {
      this.list.replaceChildren(h('div', {class: 'state-card'}, h('h3', {}, 'No streams found'), h('p', {}, groups.some(g => g.error) ? 'Some add-ons did not answer. Try again in a moment.' : 'None of your add-ons returned streams for this title.'),
        h('button', {class: 'btn primary wide', type: 'button', onclick: () => this.load()}, 'Try again')));
    }
    this.footer.textContent = this.loading && this.pending?.size ? 'Checking more add-ons…' : '';
  }

  card(group, s, i, sources) {
    const playable = !!s.url;
    const size = s.size ? sizeFrom(s) : ''; // a size already in the description is not repeated
    const id = `${group.addon.url}#${i}`;
    const card = h('button', {class: 'stream-card' + (playable ? '' : ' disabled'), type: 'button', 'aria-disabled': String(!playable),
      onclick: () => {
        if (!playable) { toast(s.infoHash ? 'Torrents need a debrid add-on such as TorBox.' : s.externalUrl ? 'This source opens outside Astra.' : 'This source has no playable link.'); return; }
        const source = sources.find(x => x.id === id);
        this.app.play({meta: this.meta, video: this.video, source, sources, startTime: this.startTime});
      }},
      h('b', {class: 'stream-name'}, (s.name || group.addon.name).replace(/\s*\n\s*/g, ' ')),
      s.title ? h('span', {class: 'stream-desc'}, s.title) : null,
      h('span', {class: 'stream-badges'}, size ? h('em', {}, size) : null, !playable && s.infoHash ? h('em', {class: 'muted'}, 'Torrent') : null));
    if (playable) longPress(card, () => sheet(s.name?.replace(/\s+/g, ' ') || group.addon.name, [
      {label: 'Copy stream link', icon: 'copy', run: () => navigator.clipboard.writeText(s.url).then(() => toast('Link copied'), () => toast('Copy failed'))},
      {label: 'Open in VLC', icon: 'play', run: () => { location.href = `intent:${s.url}#Intent;package=org.videolan.vlc;type=video/*;S.title=${encodeURIComponent(this.meta.name || '')};end`; }},
      {label: 'Check playback in the lab', icon: 'info', run: () => { location.href = `lab/?src=${encodeURIComponent(s.url)}`; }},
    ], {subtitle: group.addon.name}));
    return card;
  }
}
