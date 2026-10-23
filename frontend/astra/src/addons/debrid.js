// TorBox links from add-ons, resolved to the file's direct address once, so
// range reads do not bounce through a redirect each time. Only reads the
// account's own list; never adds, removes or changes a torrent.

const API = 'https://api.torbox.app/v1/api/';
const isInt = v => /^\d+$/.test(String(v)) && Number.isSafeInteger(Number(v));
const fileName = v => String(v || '').split(/[\\/]/).pop();

/** Recognises a TorBox download link or a Torrentio TorBox resolve link. */
export function identifyTorbox(value) {
  let u;
  try { u = new URL(value); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  if (u.hostname === 'api.torbox.app' && /^\/v1\/api\/(torrents|usenet|webdl)\/requestdl$/.test(u.pathname)) {
    if (!u.searchParams.get('token') || u.searchParams.get('zip_link') === 'true') return null;
    const type = u.pathname.split('/')[3], idKey = {torrents: 'torrent_id', usenet: 'usenet_id', webdl: 'web_id'}[type];
    if (!isInt(u.searchParams.get(idKey)) || !isInt(u.searchParams.get('file_id') || 0)) return null;
    return {direct: u.href};
  }
  if (u.hostname !== 'torrentio.strem.fun') return null;
  const p = u.pathname.split('/');
  if (p[1] !== 'resolve' || p[2] !== 'torbox' || !p[3] || !/^[a-f0-9]{40}$/i.test(p[4] || '') || !p[5]) return null;
  try { return {token: decodeURIComponent(p[3]), hash: p[4].toLowerCase(), filename: fileName(decodeURIComponent(p[5]))}; } catch { return null; }
}

/** Resolves to the direct file address; returns the original link when it cannot. */
export async function resolveDebrid(url, {signal, fetchFn = (...a) => globalThis.fetch(...a)} = {}) {
  const source = identifyTorbox(url);
  if (!source) return url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  signal?.addEventListener('abort', () => controller.abort(), {once: true});
  const json = async (target, headers = {}) => {
    const r = await fetchFn(target, {signal: controller.signal, headers, credentials: 'omit', mode: 'cors', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer'});
    if (!r.ok) throw Error('TorBox lookup failed');
    const body = await r.json();
    if (body.success !== true) throw Error('TorBox lookup unavailable');
    return body.data;
  };
  try {
    let download = source.direct;
    if (!download) {
      if (/[\r\n]/.test(source.token)) return url;
      let torrent = null;
      for (let offset = 0; offset < 500 && !torrent; offset += 100) {
        const items = await json(`${API}torrents/mylist?limit=100&offset=${offset}`, {Authorization: 'Bearer ' + source.token});
        if (!Array.isArray(items)) return url;
        torrent = items.find(i => String(i.hash || '').toLowerCase() === source.hash) || null;
        if (items.length < 100) break;
      }
      if (!torrent || !isInt(torrent.id)) return url;
      const files = (torrent.files || []).filter(f => fileName(f.short_name || f.name) === source.filename);
      if (files.length !== 1 || !isInt(files[0].id)) return url;
      download = `${API}torrents/requestdl?` + new URLSearchParams({token: source.token, torrent_id: String(torrent.id), file_id: String(files[0].id)});
    }
    const target = new URL(download);
    target.searchParams.set('redirect', 'false');
    const final = new URL(String(await json(target.href)));
    return final.protocol === 'https:' && !final.username && !final.password ? final.href : url;
  } catch (error) {
    if (signal?.aborted) throw error;
    return url;
  } finally { clearTimeout(timer); }
}
