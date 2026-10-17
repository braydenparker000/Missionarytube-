// Directory responses are JSON data, including Apple's text/javascript MIME.
// Never request a callback, install a script or evaluate a provider response.
const endpoints = ['https://itunes.apple.com/search', 'https://itunes.apple.com/WebObjects/MZStoreServices.woa/ws/wsSearch'];
const country = value => /^[a-z]{2}$/i.test(value || '') ? value.toLowerCase() : 'us';
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
function publicURL(value) {
  if (typeof value !== 'string' || value.length > 2000) return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
export function appleDirectoryURLs(query, region) {
  return endpoints.map(endpoint => {
    const url = new URL(endpoint);
    for (const [key, value] of Object.entries({term: query, media: 'podcast', entity: 'podcast', limit: '36', country: country(region)})) url.searchParams.set(key, value);
    return url.href;
  });
}
export function normalizeDirectory(data, provider = 'apple', validateURL = publicURL) {
  const results = provider === 'gpodder' ? data : data?.results;
  if (!Array.isArray(results)) throw Error('Invalid directory results.');
  const shows = [];
  for (const item of results.slice(0, 100)) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const gpodder = provider === 'gpodder';
    const title = text(gpodder ? item.title : item.collectionName, 300);
    const feedUrl = validateURL(gpodder ? item.url : item.feedUrl);
    if (!title || !feedUrl) continue;
    const id = gpodder ? feedUrl : String(item.collectionId ?? feedUrl);
    shows.push({id, title, feedUrl, author: text(gpodder ? item.author : item.artistName, 200),
      artwork: validateURL(gpodder ? item.scaled_logo_url || item.logo_url : item.artworkUrl600 || item.artworkUrl100),
      ...(gpodder ? {website: validateURL(item.website)} : {directoryUrl: validateURL(item.collectionViewUrl)}),
      genres: gpodder || !Array.isArray(item.genres) ? [] : item.genres.filter(value => typeof value === 'string').slice(0, 8).map(value => text(value, 100))});
    if (shows.length === 36) break;
  }
  return {shows};
}
export async function clientDirectory(query, region, signal, fetcher = fetch) {
  let empty;
  for (const url of appleDirectoryURLs(query, region)) {
    try {
      signal?.throwIfAborted();
      const response = await fetcher(url, {mode: 'cors', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
        headers: {Accept: 'application/json'}, signal: AbortSignal.any([AbortSignal.timeout(7000), ...(signal ? [signal] : [])])});
      if (!response.ok) { await response.body?.cancel(); continue; }
      const reader = response.body?.getReader(), parts = []; let bytes = 0;
      if (!reader) continue;
      for (;;) {
        const {done, value} = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) { await reader.cancel(); throw Error('Invalid directory results.'); }
        parts.push(value);
      }
      const joined = new Uint8Array(bytes); let offset = 0;
      for (const part of parts) { joined.set(part, offset); offset += part.byteLength; }
      const data = normalizeDirectory(JSON.parse(new TextDecoder().decode(joined)));
      signal?.throwIfAborted();
      if (data.shows.length) return data;
      empty = data;
    } catch (error) { if (signal?.aborted) throw error; }
  }
  if (empty) return empty;
  throw Error('Podcast search is unavailable. Please try again.');
}
