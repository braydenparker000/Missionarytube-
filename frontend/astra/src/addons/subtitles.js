// Subtitles from add-ons (the Stremio "subtitles" resource). Astra also asks
// OpenSubtitles v3, Stremio's own subtitle add-on, unless the viewer turns
// that off in Settings. Lists only: files are downloaded when chosen.

import {fetchManifest, getJson, resourceUrl, supports} from './client.js';
import {baseLanguage} from '../engine/languages.js';

export const OPENSUBTITLES = 'https://opensubtitles-v3.strem.io/manifest.json';

// OpenSubtitles' own codes that are not ISO 639.
const ALIASES = {pob: 'pt-BR', pb: 'pt-BR', zht: 'zh-Hant', zhe: 'zh', ze: 'zh', zhs: 'zh-Hans', spn: 'es', ea: 'es-419', sx: 'sat', mne: 'sr-ME'};

export function subtitleLanguage(code) {
  const raw = String(code || '').trim();
  return ALIASES[raw.toLowerCase()] || raw;
}

/** The add-ons to ask: every enabled add-on with subtitles, plus OpenSubtitles when on and not installed. */
export function subtitleAddons(addons, {builtIn = true} = {}) {
  const list = addons.map(a => ({url: a.url, name: a.name}));
  if (builtIn && !list.some(a => a.url === OPENSUBTITLES)) list.push({url: OPENSUBTITLES, name: 'OpenSubtitles'});
  return list;
}

/**
 * Asks every subtitle add-on at once. onList(entries) is called as each
 * answers. Entries: {url, language, label, source, exact, name}.
 * `facts` may carry {videoHash, videoSize, filename}.
 */
export async function fetchSubtitles(addons, type, id, facts = {}, {signal, onList = () => {}, timeout = 12000} = {}) {
  const extra = {};
  if (facts.videoHash) extra.videoHash = facts.videoHash;
  if (facts.videoSize) extra.videoSize = String(facts.videoSize);
  if (facts.filename) extra.filename = facts.filename;
  const seen = new Set();
  const all = [];
  await Promise.allSettled(addons.map(async addon => {
    const manifest = await fetchManifest(addon.url, {signal, timeout});
    if (!supports(manifest, 'subtitles', type, id)) return;
    const data = await getJson(resourceUrl(addon.url, 'subtitles', type, id, extra), {signal, timeout});
    const source = manifest.name || addon.name || 'Add-on';
    const entries = (Array.isArray(data?.subtitles) ? data.subtitles : []).filter(s => s && typeof s.url === 'string' && /^https?:/i.test(s.url) && !seen.has(s.url) && seen.add(s.url))
      .map(s => ({url: s.url, language: subtitleLanguage(s.lang), label: typeof s.label === 'string' ? s.label : '', source, exact: s.m === 'h', name: String(s.subtitleFileName || s.releaseName || s.movieReleaseName || '').slice(0, 120)}));
    if (entries.length) { all.push(...entries); onList(entries); }
  }));
  return all;
}

/** A subtitle file's text: UTF-8, UTF-16 by mark, else the language's legacy code page. */
export function decodeSubtitleBytes(bytes, language = '') {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch {}
  // UTF-16 without a mark: every other byte is zero in Latin text.
  let zeros = 0;
  for (let i = 1; i < Math.min(bytes.length, 400); i += 2) if (bytes[i] === 0) zeros++;
  if (zeros > 150) return new TextDecoder('utf-16le').decode(bytes);
  // Add-ons send three-letter codes ('gre', 'bul', 'rum'): their first two letters are not the language.
  const lang = baseLanguage(language) || String(language).toLowerCase().slice(0, 2);
  const legacy = {ru: 'windows-1251', uk: 'windows-1251', bg: 'windows-1251', sr: 'windows-1251', mk: 'windows-1251', be: 'windows-1251',
    ar: 'windows-1256', fa: 'windows-1256', ur: 'windows-1256', he: 'windows-1255', el: 'windows-1253', tr: 'windows-1254',
    pl: 'windows-1250', cs: 'windows-1250', sk: 'windows-1250', hu: 'windows-1250', ro: 'windows-1250', hr: 'windows-1250', sl: 'windows-1250', bs: 'windows-1250',
    th: 'windows-874', vi: 'windows-1258', zh: 'gb18030', ja: 'shift_jis', ko: 'euc-kr', lt: 'windows-1257', lv: 'windows-1257', et: 'windows-1257'}[lang] || 'windows-1252';
  try { return new TextDecoder(legacy).decode(bytes); } catch { return new TextDecoder('windows-1252').decode(bytes); }
}
