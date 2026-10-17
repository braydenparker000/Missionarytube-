import {enrichVideos} from './discovery.js';
import {savedYouTubeDate} from './metadata.js';
// My Media: Drive folder listing, file naming and watch progress.
// Pure functions only; the page wires them to the DOM in app.js.
import {folderId} from '../drawercast/drive-api.js';

const ROOT = 'https://www.googleapis.com/drive/v3/files';
const ID = /^[A-Za-z0-9_-]{10,200}$/;
const FOLDER = 'application/vnd.google-apps.folder';
export const VIDEO = /\.(mp4|m4v|webm|mkv|mov)$/i;
const SUBTITLE = /\.(vtt|srt)$/i;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const YOUTUBE_ID = /\s*\[([A-Za-z0-9_-]{11})\]$/;
export const PROGRESS_KEY = 'mymedia.progress.v1';
export const LIBRARY_KEY = 'mymedia.library.v1';
const WATCHED = 0.93;

export {folderId};

const stem = name => name.replace(/\.[^.]+$/, '');

// "Title [dQw4w9WgXcQ].mp4" → {title:'Title', youtubeId:'dQw4w9WgXcQ'}
export function parseName(name) {
  const base = stem(String(name || ''));
  const youtubeId = YOUTUBE_ID.exec(base)?.[1] || '';
  const title = base.replace(YOUTUBE_ID, '').replace(/_/g, ' ').trim() || base;
  return {title, youtubeId};
}

// yt-dlp sidecars share the video's stem: "Title [id].en.vtt", "Title [id].webp".
function sidecarsFor(video, others) {
  const base = stem(video.name), subtitles = [];
  let image = null;
  for (const f of others) {
    const other = stem(f.name);
    if (other !== base && !other.startsWith(base + '.')) continue;
    if (SUBTITLE.test(f.name)) {
      const lang = other.slice(base.length + 1) || 'und';
      subtitles.push({id:f.id, lang, format:f.name.split('.').at(-1).toLowerCase()});
    } else if (IMAGE.test(f.name) && !image) image = f.id;
  }
  subtitles.sort((a, b) => a.lang.localeCompare(b.lang));
  return {subtitles, image};
}

export function toVideo(file, folder, others = []) {
  const {title, youtubeId} = parseName(file.name);
  const meta = file.videoMediaMetadata || {};
  return {id:file.id, name:file.name, title, youtubeId, folder,
    mimeType:file.mimeType || '', size:Number(file.size) || 0,
    modified:Date.parse(file.modifiedTime) || 0, addedAt:Date.parse(file.createdTime)||0,
    duration:Math.round(Number(meta.durationMillis) / 1000) || 0,
    width:Number(meta.width) || 0, height:Number(meta.height) || 0,
    thumbnail:/^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//.test(file.thumbnailLink || '') ? file.thumbnailLink : '',
    ...sidecarsFor(file, others)};
}

export function createVideoApi(key, fetcher = fetch) {
  if (!/^AIza[A-Za-z0-9_-]{30,}$/.test(key || '')) throw Error('The shared Drive API key is not configured.');
  async function get(path, params, signal) {
    const url = new URL(ROOT + path);
    for (const [name, value] of Object.entries({...params, key})) url.searchParams.set(name, value);
    const response = await fetcher(url.href, {signal, credentials:'omit', cache:'no-store'});
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = data.error?.errors?.[0]?.reason || '';
      if (response.status === 404) throw Error('Drive folder not found. Set it to Anyone with the link → Viewer.');
      if (response.status === 429 || /rateLimit|quota/i.test(reason)) throw Error('Drive is limiting requests. Wait a moment, then refresh.');
      if (response.status === 403) throw Error('Drive refused access. Check that the folder is shared as Anyone with the link → Viewer.');
      throw Error('Drive could not be read (HTTP ' + response.status + ').');
    }
    return data;
  }
  // Walks every subfolder and page. Nothing is returned unless the whole read succeeds.
  async function list(folder, signal) {
    const root = folderId(folder);
    const info = await get('/' + root, {fields:'id,name,mimeType'}, signal);
    if (info.mimeType !== FOLDER) throw Error('The configured video folder is not a folder.');
    const queue = [{id:root, path:info.name}], visited = new Set(), videos = [];
    let metadataFile=null;
    while (queue.length) {
      if (visited.size >= 500) throw Error('This folder has too many subfolders.');
      const current = queue.shift();
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      const files = [], seen = new Set();
      let token = '';
      do {
        const page = await get('', {q:"'" + current.id + "' in parents and trashed = false", pageSize:'1000',
          fields:'nextPageToken,files(id,name,mimeType,size,modifiedTime,createdTime,thumbnailLink,videoMediaMetadata(width,height,durationMillis),capabilities(canDownload))',
          ...(token ? {pageToken:token} : {})}, signal);
        if (!Array.isArray(page.files)) throw Error('Drive returned an incomplete folder listing.');
        for (const f of page.files) {
          if (!ID.test(f.id || '') || typeof f.name !== 'string') continue;
          if (f.mimeType === FOLDER) queue.push({id:f.id, path:current.path + '/' + f.name});
          else if (f.capabilities?.canDownload !== false) files.push(f);
        }
        token = page.nextPageToken || '';
        if (token && seen.has(token)) throw Error('Drive pagination repeated.');
        seen.add(token);
      } while (token);
      if(current.id===root)metadataFile=files.find(f=>f.name==='jarvis-video-metadata.json'&&Number(f.size||0)<2000000);
      const others = files.filter(f => !VIDEO.test(f.name));
      for (const f of files) if (VIDEO.test(f.name)) videos.push(toVideo(f, current.path, others));
      if (videos.length > 20000) throw Error('Choose a folder with fewer than 20,000 videos.');
    }
    let enriched=videos;
    if(metadataFile){try{const manifest=await get('/'+metadataFile.id,{alt:'media'},signal);enriched=enrichVideos(videos,manifest);}catch{if(signal?.aborted)throw signal.reason;}}
    return {id:root, name:info.name, videos:enriched, fetched:Date.now()};
  }
  return {list, mediaURL:id => mediaURL(id, key)};
}

export function mediaURL(id, key) {
  if (!ID.test(id || '')) throw Error('Invalid Drive file ID.');
  const url = new URL(ROOT + '/' + id);
  url.searchParams.set('alt', 'media');
  url.searchParams.set('key', key);
  return url.href;
}

// Ordered image candidates; the page falls through on load errors.
export function thumbnails(video, key) {
  const list = [];
  if (video.image && key) list.push(mediaURL(video.image, key));
  if (video.youtubeId) list.push('https://i.ytimg.com/vi/' + video.youtubeId + '/mqdefault.jpg');
  if (video.thumbnail) list.push(video.thumbnail);
  return list;
}

export function parseLibrary(raw, expectedFolder = '') {
  try {
    const data = JSON.parse(raw);
    if (!data || !ID.test(data.id || '') || expectedFolder && data.id !== expectedFolder ||
        typeof data.name !== 'string' || !Array.isArray(data.videos) || data.videos.length > 20000) return null;
    const videos = data.videos.filter(v => v && ID.test(v.id || '') &&
      typeof v.title === 'string' && typeof v.folder === 'string' && typeof v.name === 'string')
      .map(v => ({...v,
        ...savedYouTubeDate(v),
        image:ID.test(v.image || '') ? v.image : null,
        youtubeId:/^[A-Za-z0-9_-]{11}$/.test(v.youtubeId || '') ? v.youtubeId : '',
        thumbnail:/^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//.test(v.thumbnail || '') ? v.thumbnail : '',
        duration:Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0,
        subtitles:Array.isArray(v.subtitles)
        ? v.subtitles.filter(s => s && ID.test(s.id || '') && typeof s.lang === 'string' && ['vtt','srt'].includes(s.format))
        : []}));
    return {...data, videos};
  } catch {}
  return null;
}

export function parseProgress(raw) {
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const clean = {};
      for (const [id, p] of Object.entries(data)) {
        if (ID.test(id) && p && Number.isFinite(p.t) && Number.isFinite(p.d)) {
          clean[id] = {t:Math.max(0, p.t), d:Math.max(0, p.d), done:!!p.done, at:Number(p.at) || 0};
        }
      }
      return clean;
    }
  } catch {}
  return {};
}

// Returns the new entry for one video. Watched stays set once reached.
export function recordProgress(previous, time, duration, ended = false, now = Date.now()) {
  const t = Number.isFinite(time) ? Math.max(0, time) : 0;
  const d = Number.isFinite(duration) && duration > 0 ? duration : previous?.d || 0;
  const done = !!previous?.done || ended || (d > 0 && t >= d * WATCHED);
  return {t:ended ? 0 : t, d, done, at:now};
}

// Where to start: resume unless barely started or essentially finished.
export function resumeTime(entry) {
  if (!entry || !entry.d) return 0;
  return entry.t > 10 && entry.t < entry.d * WATCHED ? entry.t : 0;
}

export function continueWatching(videos, progress, limit = 10) {
  return videos
    .filter(v => resumeTime(progress[v.id]) > 0)
    .sort((a, b) => progress[b.id].at - progress[a.id].at)
    .slice(0, limit);
}

export function searchVideos(videos, query) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return videos;
  return videos.filter(v => {
    const text = (v.title + ' ' + v.folder+' '+(v.creator||'')+' '+(v.topics||[]).join(' ')).toLowerCase();
    return words.every(w => text.includes(w));
  });
}

const titleOrder = (a, b) => a.title.localeCompare(b.title, undefined, {numeric:true, sensitivity:'base'}) || String(a.id || '').localeCompare(String(b.id || ''));
const knownFirst = (a, b, field, descending = false) => {
  const left = Number.isFinite(a[field]) && a[field] > 0 ? a[field] : 0;
  const right = Number.isFinite(b[field]) && b[field] > 0 ? b[field] : 0;
  return !left !== !right ? (left ? -1 : 1) : (descending ? right - left : left - right) || titleOrder(a, b);
};
export const SORTS = {
  newest:(a, b) => (b.addedAt||b.modified||0) - (a.addedAt||a.modified||0),
  oldest:(a, b) => (a.addedAt||a.modified||0) - (b.addedAt||b.modified||0),
  'youtube-newest':(a,b) => knownFirst(a,b,'youtubeAt',true),
  'youtube-oldest':(a,b) => knownFirst(a,b,'youtubeAt'),
  title:(a, b) => a.title.localeCompare(b.title, undefined, {numeric:true, sensitivity:'base'}),
  longest:(a,b) => knownFirst(a,b,'duration',true),
  shortest:(a,b) => knownFirst(a,b,'duration')
};

export function sortVideos(videos, mode) {
  return [...videos].sort(SORTS[mode] || SORTS.newest);
}

// Sections in folder order: the root folder first, then subfolders by name.
export function groupByFolder(videos, rootName) {
  const groups = new Map();
  for (const v of videos) {
    if (!groups.has(v.folder)) groups.set(v.folder, []);
    groups.get(v.folder).push(v);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === rootName ? -1 : b === rootName ? 1 : a.localeCompare(b, undefined, {numeric:true})))
    .map(([path, items]) => ({path, label:path === rootName ? 'All videos' : path.slice(rootName.length + 1), items}));
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = String(s % 60).padStart(2, '0');
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + r : m + ':' + r;
}

export function srtToVtt(text) {
  const body = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');
  return /^WEBVTT/.test(body) ? body : 'WEBVTT\n\n' + body;
}
