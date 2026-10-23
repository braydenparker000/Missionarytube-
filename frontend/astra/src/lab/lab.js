// The playback lab: pick a stream, see what the file holds and how the new
// engine plays it, switch audio and subtitles, and copy a report.
// Address parameters: ?src=<url>&t=<seconds>&autoplay=1

import {AstraPlayer} from '../engine/player.js';
import {TUNING} from '../engine/remux.js';
import {PlayerScreen} from '../player/player-screen.js';
import {deviceReport} from '../engine/capabilities.js';
import {describeInfo} from '../engine/probe.js';
import {channelName} from '../engine/labels.js';
import {languageName} from '../engine/languages.js';
import {classicAddons, searchCatalogs, fetchMeta, fetchStreams} from '../addons/client.js';

const $ = id => document.getElementById(id);
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c);
  return el;
}
const ICON_BACK = () => { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = '<path d="M15.4 7.4 14 6l-6 6 6 6 1.4-1.4L10.8 12z"/>'; return s; };
const bytes = n => !n ? '' : n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB';
const clock = s => { if (!(s >= 0)) return ''; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };

const video = $('video');
const player = new AstraPlayer(video, $('subtitles'));
window.astraLab = {player, tuning: TUNING};

const MODE_TEXT = {
  native: 'Chrome plays this file directly.',
  remux: 'Astra unpacks this file and hands Chrome the video and your chosen audio.',
  hls: 'Adaptive HLS stream (hls.js).',
  dash: 'Adaptive DASH stream (dash.js).',
  unsupported: 'This file cannot play on this device.',
};

function setStatus(text, error = false) {
  const s = $('status');
  s.hidden = !text; s.textContent = text || ''; s.classList.toggle('error', error);
}
player.addEventListener('status', e => setStatus(e.detail));
player.addEventListener('error', e => { setStatus(e.detail.message, true); renderPlan(); });
player.addEventListener('ready', () => { setStatus(''); renderPlan(); renderTracks(); });
player.addEventListener('tracks', renderTracks);
video.addEventListener('waiting', () => { if (player.mode) setStatus('Buffering…'); });
video.addEventListener('playing', () => setStatus(''));

async function play(stream) {
  $('placeholder').hidden = true;
  $('tracks').hidden = true;
  $('plan').hidden = true;
  setStatus('Opening…');
  window.scrollTo({top: 0, behavior: 'smooth'});
  await player.load({url: stream.url, headers: stream.headers || {}, startTime: stream.startTime || 0, autoplay: stream.autoplay !== false, subtitles: stream.subtitles || [], prefs: stream.languages ? {languages: stream.languages} : {}});
}
window.astraLab.play = play;

function renderTracks() {
  if (!player.mode) return;
  $('tracks').hidden = false;
  const audio = player.audioOptions();
  $('audio').replaceChildren(...(audio.length ? audio.map(a => h('button', {
    class: 'chip' + (a.supported ? '' : ' unavailable'), 'aria-pressed': String(a.selected), disabled: !a.supported, title: a.reason || '',
    dataset: {audio: a.id}, onclick: () => player.selectAudio(a.id),
  }, a.label, a.delivery === 'rebuilt' ? h('small', {}, ' converted') : null)) : [h('p', {class: 'hint'}, player.mode === 'native' ? 'Chrome does not let pages choose audio when it plays a file directly.' : 'No audio track.')]));
  const subs = player.subtitleOptions();
  $('subs').replaceChildren(
    h('button', {class: 'chip', 'aria-pressed': String(!subs.some(s => s.selected)), onclick: () => player.selectSubtitle(null)}, 'Off'),
    ...subs.map(s => h('button', {class: 'chip' + (s.supported ? '' : ' unavailable'), 'aria-pressed': String(s.selected), disabled: !s.supported, title: s.reason || '', dataset: {sub: s.id}, onclick: () => player.selectSubtitle(s.id)}, s.label)),
  );
  $('sub-style').hidden = !subs.length;
}

$('sub-style').addEventListener('click', e => {
  const b = e.target.closest('[data-step]');
  if (b) {
    const by = +b.dataset.by;
    if (b.dataset.step === 'size') player.subtitles.setStyle({size: Math.min(2.5, Math.max(0.5, Math.round((player.subtitles.style.size + by) * 10) / 10))});
    else player.subtitles.setDelay(Math.max(-60, Math.min(60, player.subtitles.delay + by)));
    $('size-value').textContent = Math.round(player.subtitles.style.size * 100) + '%';
    $('delay-value').textContent = player.subtitles.delay.toFixed(1) + ' s';
  }
});
$('sub-box').addEventListener('click', () => {
  const on = player.subtitles.style.background === 0;
  player.subtitles.setStyle({background: on ? 0.55 : 0});
  $('sub-box').setAttribute('aria-pressed', String(on));
});

function fact(label, value, cls = '') { return h('div', {class: 'fact'}, h('b', {}, label), h('span', {class: cls}, value)); }

function renderPlan() {
  const plan = player.plan;
  if (!plan) return;
  $('plan').hidden = false;
  $('plan-mode').textContent = plan.mode === 'unsupported' ? plan.reason : MODE_TEXT[plan.mode];
  $('plan-notes').replaceChildren(...(plan.notes || []).map(n => h('li', {}, n)));
  const info = describeInfo(player.info);
  const rows = [];
  if (info) {
    rows.push(fact('Format', [info.container, bytes(info.size), clock(info.duration)].filter(Boolean).join(' · ')));
    for (const v of info.video || []) rows.push(fact('Video', [v.label, v.width && `${v.width}×${v.height}`, v.hdr && 'HDR', v.codecString].filter(Boolean).join(' · ')));
    for (const a of info.audio || []) {
      const option = plan.audioOptions?.find(o => o.track.id === a.id);
      const how = option?.delivery === 'direct' ? 'plays as-is' : option?.delivery === 'rebuilt' ? 'converted to Opus' : option?.reason || 'not playable';
      rows.push(fact('Audio', `${languageName(a.language) || a.language || 'Unknown'} · ${a.label} ${channelName(a.channels)}${a.name && a.name !== languageName(a.language) ? ' · ' + a.name : ''} — ${how}`, option?.delivery === 'unsupported' ? 'bad' : ''));
    }
    for (const s of info.subtitles || []) rows.push(fact('Subtitles', `${languageName(s.language) || 'Unknown'} · ${s.format ? s.format.toUpperCase() : s.image || s.codecId}${s.name ? ' · ' + s.name : ''}${s.forced ? ' · forced' : ''}`, s.format ? '' : 'bad'));
  } else rows.push(fact('File', 'Not read by Astra (the host blocks web pages); Chrome opens it directly.'));
  $('facts').replaceChildren(...rows);
}

$('copy-report').addEventListener('click', async () => {
  const report = JSON.stringify(await player.report(), null, 2);
  try { await navigator.clipboard.writeText(report); $('copy-hint').textContent = 'Report copied. It contains no links or account details.'; }
  catch { $('copy-hint').textContent = 'Copy failed; long-press to select the report below.'; $('copy-hint').append(h('pre', {}, report)); }
});

// Finding something to play, through the add-ons classic Astra already has.
const addons = classicAddons();
$('addon-hint').textContent = `Searching with ${addons.length} add-on${addons.length === 1 ? '' : 's'} from Astra on this phone.`;
let searchAbort = null;
const browse = $('browse');

async function search(query) {
  searchAbort?.abort(); searchAbort = new AbortController();
  if (query.trim().length < 2) { browse.replaceChildren(); return; }
  browse.replaceChildren(h('div', {class: 'results'}, ...Array.from({length: 6}, () => h('div', {class: 'poster'}, h('div', {class: 'art skeleton'})))));
  const results = await searchCatalogs(addons, query.trim(), {signal: searchAbort.signal}).catch(() => []);
  if (searchAbort.signal.aborted) return;
  browse.replaceChildren(results.length ? h('div', {class: 'results'}, ...results.slice(0, 30).map(m => h('button', {class: 'poster', onclick: () => openTitle(m)},
    m.poster ? h('img', {src: m.poster, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer'}) : h('div', {class: 'art'}),
    h('span', {}, m.name || m.id), h('small', {}, [m.type === 'series' ? 'Series' : 'Movie', m.releaseInfo || m.year].filter(Boolean).join(' · '))))) : h('p', {class: 'hint'}, 'Nothing found.'));
}
let timer = 0;
$('search').addEventListener('input', e => { clearTimeout(timer); timer = setTimeout(() => search(e.target.value), 350); });
$('search-form').addEventListener('submit', e => { e.preventDefault(); clearTimeout(timer); search($('search').value); $('search').blur(); });

const header = (title, back) => h('div', {class: 'browse-head'}, h('button', {class: 'icon-btn', 'aria-label': 'Back', onclick: back}, ICON_BACK()), h('h3', {}, title));

async function openTitle(m) {
  const back = () => search($('search').value);
  if (m.type !== 'series') {
    const meta = await fetchMeta(addons, 'movie', m.id).catch(() => null) || m;
    return openStreams({item: m, meta, type: 'movie', id: m.id, title: m.name, back});
  }
  browse.replaceChildren(header(m.name, back), h('p', {class: 'hint'}, 'Loading episodes…'));
  const meta = await fetchMeta(addons, 'series', m.id).catch(() => null);
  const videos = (meta?.videos || []).filter(v => v.season != null).sort((a, b) => a.season - b.season || a.episode - b.episode);
  const seasons = [...new Set(videos.map(v => v.season))].sort((a, b) => (a || 99) - (b || 99));
  const show = season => browse.replaceChildren(header(m.name, back),
    h('div', {class: 'seasons'}, ...seasons.map(s => h('button', {class: 'chip', 'aria-pressed': String(s === season), onclick: () => show(s)}, s === 0 ? 'Specials' : 'Season ' + s))),
    h('div', {class: 'episodes'}, ...videos.filter(v => v.season === season).map(v => h('button', {class: 'episode', onclick: () => openStreams({item: m, meta, videos, video: v, type: 'series', id: v.id, title: `${m.name} S${v.season} E${v.episode}`, back: () => show(season)})},
      h('b', {}, `${v.episode}. ${v.name || v.title || 'Episode ' + v.episode}`), h('span', {}, v.released ? new Date(v.released).toLocaleDateString() : '')))));
  if (seasons.length) show(seasons.find(s => s > 0) ?? seasons[0]); else browse.replaceChildren(header(m.name, back), h('p', {class: 'hint'}, 'No episodes listed.'));
}

/** Streams of one title or episode, in add-on order, each playable in the full player. */
function collectStreams(type, id, onUpdate) {
  const groups = new Map();
  const done = fetchStreams(addons, type, id, {onGroup: g => { groups.set(g.addon.url, g); onUpdate?.(groups); }});
  const sources = () => [...groups.values()].sort((a, b) => a.order - b.order)
    .flatMap(g => g.streams.filter(s => s.url).map((s, i) => ({id: g.addon.url + '#' + i, label: (s.name || g.addon.name).replace(/\n/g, ' '), detail: s.title, stream: {...s, name: `${g.addon.name} ${s.name || ''}`.trim()}})));
  return {groups, done, sources};
}

function openStreams(ctx) {
  const list = h('div', {class: 'streams'});
  const status = h('p', {class: 'hint'}, 'Asking your add-ons…');
  browse.replaceChildren(header(ctx.title, ctx.back), status, list);
  const render = groups => {
    const ordered = [...groups.values()].sort((a, b) => a.order - b.order);
    list.replaceChildren(...ordered.flatMap(g => [
      h('p', {class: 'group-head'}, g.addon.name, g.error ? h('span', {class: 'loading'}, ' — failed') : null),
      ...g.streams.map((s, i) => {
        const playable = !!s.url;
        return h('div', {class: 'stream-row'},
          h('button', {class: 'stream' + (playable ? '' : ' disabled'), disabled: !playable, onclick: () => openPlayer(ctx, collected, g.addon.url + '#' + i)},
            h('b', {}, (s.name || g.addon.name).replace(/\n/g, ' ')), h('span', {}, s.title + (playable ? '' : s.infoHash ? '\nTorrent: needs a debrid add-on' : '\nNot a direct link'))),
          playable ? h('button', {class: 'chip analyse', onclick: () => play({...s, title: ctx.title})}, 'Analyse') : null);
      }),
    ]));
  };
  const collected = collectStreams(ctx.type, ctx.id, render);
  collected.done.then(() => { status.textContent = collected.groups.size ? '' : 'None of your add-ons returned streams.'; });
}

// The full player, opened from a tap on a stream.
let screen = null;
function playerScreen() {
  if (screen) return screen;
  screen = new PlayerScreen();
  window.astraLab.screen = screen;
  screen.addEventListener('progress', e => { window.astraLab.lastProgress = e.detail; });
  screen.addEventListener('episode', e => switchEpisode(e.detail.episode.video));
  screen.addEventListener('next', () => { const n = screen.lab?.nextVideo; if (n) switchEpisode(n); });
  return screen;
}

function playerOptions(ctx, collected, sourceId) {
  const {meta = {}, item = {}, videos, video} = ctx;
  const sources = collected.sources();
  const source = sources.find(s => s.id === sourceId) || sources[0];
  const index = video ? videos.indexOf(video) : -1;
  const nextVideo = index >= 0 ? videos[index + 1] : null;
  const year = meta.releaseInfo || item.releaseInfo || meta.year || '';
  return {
    lab: {ctx, nextVideo},
    stream: source.stream, sourceId: source.id, sources,
    meta: {
      title: meta.name || item.name || ctx.title,
      episodeLine: video ? `S${video.season} E${video.episode}${video.name || video.title ? ' • ' + (video.name || video.title) : ''}` : '',
      release: [year, (meta.genres || item.genres || [])[0]].filter(Boolean).join(' · '),
      description: (video?.overview || video?.description || meta.description || ''),
      logo: meta.logo || item.logo || '', background: meta.background || item.background || '', poster: meta.poster || item.poster || '',
    },
    episodes: video ? {seasons: [...new Set(videos.map(v => v.season))], season: video.season, current: video.id,
      items: videos.map(v => ({id: v.id, season: v.season, episode: v.episode, title: v.name || v.title || '', thumbnail: v.thumbnail || '', video: v}))} : null,
    next: nextVideo ? {label: `S${nextVideo.season} E${nextVideo.episode}`, title: nextVideo.name || nextVideo.title || '', thumbnail: nextVideo.thumbnail || '', hasAired: !nextVideo.released || new Date(nextVideo.released) <= new Date()} : null,
  };
}

function openPlayer(ctx, collected, sourceId) {
  const s = playerScreen();
  const options = playerOptions(ctx, collected, sourceId);
  s.lab = options.lab;
  s.open(options);
}

/** Next or chosen episode: the same release group if it has one, otherwise the sources list. */
async function switchEpisode(video) {
  const s = screen, ctx = {...s.lab.ctx, video, id: video.id, title: `${s.lab.ctx.item.name} S${video.season} E${video.episode}`};
  const group = s.stream?.bingeGroup;
  s.showLoading(true);
  const collected = collectStreams('series', video.id);
  await collected.done;
  const sources = collected.sources();
  if (!sources.length) return s.showError('None of your add-ons returned streams for this episode.');
  const same = group && sources.find(x => x.stream.bingeGroup === group);
  const options = playerOptions(ctx, collected, (same || sources[0]).id);
  s.lab = options.lab;
  s.open(options);
  if (!same) s.openPanel('sources');
}

$('link-form').addEventListener('submit', e => { e.preventDefault(); const url = $('link').value.trim(); if (url) play({url}); });

deviceReport().then(d => {
  $('device').replaceChildren(
    ...Object.entries(d.mse).map(([k, v]) => fact(k, v ? 'Supported' : 'Not supported', v ? 'good' : 'bad')),
    fact('Opus encoder', d.opusEncoder ? 'Available (used to convert Dolby and DTS audio)' : 'Missing', d.opusEncoder ? 'good' : 'bad'),
  );
});

const params = new URLSearchParams(location.search);
if (params.get('src')) play({url: params.get('src'), startTime: +params.get('t') || 0, autoplay: params.get('autoplay') !== '0', languages: params.get('lang') ? params.get('lang').split(',') : null});

/** For tests and pasted links: the full player on one stream. */
window.astraLab.openPlayer = (stream, meta = {title: 'Test video'}, extra = {}) => {
  const s = playerScreen();
  s.lab = null;
  s.open({stream, meta, sources: [], ...extra});
  return s;
};
