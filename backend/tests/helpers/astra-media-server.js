// Two local origins for Astra's browser tests: the frontend (the app's own
// origin) and a separate media host that serves the synthetic fixtures with
// byte ranges, like a real file host. The media host answers cross-origin
// reads under /cors/ and refuses them (no CORS headers) under /closed/.
import http from 'node:http';
import {createReadStream, statSync} from 'node:fs';
import {extname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json',
  '.mkv': 'video/x-matroska', '.mp4': 'video/mp4', '.ts': 'video/mp2t', '.avi': 'video/x-msvideo', '.webm': 'video/webm', '.srt': 'application/x-subrip', '.vtt': 'text/vtt', '.ass': 'text/x-ssa', '.m3u8': 'application/vnd.apple.mpegurl'};

function serveFile(req, res, file, {cors}) {
  let stat;
  try { stat = statSync(file); if (!stat.isFile()) throw Error(); } catch { res.writeHead(404, cors ? {'Access-Control-Allow-Origin': '*'} : {}); return res.end('not found'); }
  const headers = {'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store'};
  if (cors) Object.assign(headers, {'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Range', 'Access-Control-Expose-Headers': cors === 'expose' ? 'Content-Range, Content-Length' : 'Content-Length'});
  if (req.method === 'OPTIONS') { res.writeHead(204, headers); return res.end(); }
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range) {
    const start = range[1] ? +range[1] : stat.size - +range[2];
    const end = range[1] && range[2] ? Math.min(+range[2], stat.size - 1) : stat.size - 1;
    if (start >= stat.size) { res.writeHead(416, {...headers, 'Content-Range': `bytes */${stat.size}`}); return res.end(); }
    res.writeHead(206, {...headers, 'Content-Range': `bytes ${start}-${end}/${stat.size}`, 'Content-Length': end - start + 1});
    if (req.method === 'HEAD') return res.end();
    return createReadStream(file, {start, end}).pipe(res);
  }
  res.writeHead(200, {...headers, 'Content-Length': stat.size});
  if (req.method === 'HEAD') return res.end();
  createReadStream(file).pipe(res);
}

// A small Stremio add-on over the fixtures: catalogs, metadata, episodes,
// search and streams, with generated artwork, so the whole app can be tested
// without the internet.
const GENRES = ['Drama', 'Comedy', 'Sci-Fi', 'Thriller'];
const COLORS = ['#3b5bdb', '#c2255c', '#2b8a3e', '#e8590c', '#5f3dc4', '#0b7285'];
function fixtureTitles(type) {
  const count = type === 'movie' ? 60 : 12;
  return Array.from({length: count}, (_, i) => {
    const n = i + 1, id = `tt${type === 'movie' ? 1 : 2}${String(n).padStart(6, '0')}`;
    return {id, type, name: `${type === 'movie' ? 'Movie' : 'Show'} ${n}`, releaseInfo: String(1990 + (n % 35)) + (type === 'series' ? '–' : ''), genres: [GENRES[n % 4]]};
  });
}
function artSvg(kind, id) {
  const n = parseInt(id.replace(/\D/g, '').slice(-3), 10) || 0, c = COLORS[n % COLORS.length];
  const [w, hgt] = kind === 'p' ? [300, 444] : kind === 'l' ? [600, 230] : [1280, 720];
  if (kind === 'l') return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}"><text x="50%" y="62%" text-anchor="middle" font-family="sans-serif" font-size="120" font-weight="900" fill="#fff">${id.slice(-3)}</text></svg>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${hgt}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#111"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="55%" text-anchor="middle" font-family="sans-serif" font-size="${kind === 'p' ? 64 : 96}" font-weight="800" fill="rgba(255,255,255,.85)">${kind === 't' ? 'EP ' : ''}${id.slice(-3)}</text></svg>`;
}
const SUBTITLE_FILES = {
  en: '1\n00:00:00,300 --> 00:00:05,500\nFixture subtitle line\n',
  es: '1\n00:00:00,300 --> 00:00:05,500\nLínea de prueba\n',
};
function addonResponse(path, media, site, requests = []) {
  const json = body => ({type: 'application/json', body: JSON.stringify(body)});
  const art = (k, id) => `${media}/art/${k}/${encodeURIComponent(id)}.svg`;
  const dress = m => ({...m, poster: art('p', m.id), background: art('b', m.id), logo: Number(m.id.slice(-1)) % 3 ? art('l', m.id) : undefined});
  if (path === '/manifest.json') return json({id: 'test.fixture.addon', name: 'Fixture', version: '1.0.0', description: 'Synthetic catalogs and streams for tests.', types: ['movie', 'series'], idPrefixes: ['tt'], resources: ['catalog', 'meta', 'stream', 'subtitles'],
    catalogs: [{type: 'movie', id: 'top', name: 'Popular', extra: [{name: 'search'}, {name: 'skip'}, {name: 'genre', options: GENRES}]}, {type: 'series', id: 'top', name: 'Popular', extra: [{name: 'search'}, {name: 'skip'}]}, {type: 'movie', id: 'new', name: 'New', extra: [{name: 'skip'}]}]});
  let m = /^\/catalog\/(movie|series)\/(top|new)(?:\/([^/]+))?\.json$/.exec(path);
  if (m) {
    const extra = Object.fromEntries(new URLSearchParams((m[3] || '').replace(/&/g, '&')));
    let items = fixtureTitles(m[1]).map(dress);
    if (m[2] === 'new') items = items.slice().reverse();
    if (extra.search) items = items.filter(i => i.name.toLowerCase().includes(extra.search.toLowerCase()));
    if (extra.genre) items = items.filter(i => i.genres.includes(extra.genre));
    const skip = +extra.skip || 0;
    return json({metas: items.slice(skip, skip + 30)});
  }
  m = /^\/meta\/(movie|series)\/([^/]+)\.json$/.exec(path);
  if (m) {
    const base = fixtureTitles(m[1]).find(t => t.id === decodeURIComponent(m[2]));
    if (!base) return json({meta: null});
    const meta = {...dress(base), description: `${base.name} is a synthetic title used to test Astra. It has a long enough description to need the Show More control on a phone screen, which keeps the page tidy.`, runtime: '112 min', imdbRating: '7.8', cast: ['Ada Lovelace', 'Alan Turing', 'Grace Hopper'], director: ['Edsger Dijkstra']};
    if (m[1] === 'series') meta.videos = [1, 2].flatMap(season => [1, 2, 3, 4, 5].map(episode => ({id: `${base.id}:${season}:${episode}`, season, episode, name: `Episode ${episode} of season ${season}`, overview: 'An episode of the fixture show.', thumbnail: art('t', `${base.id}${season}${episode}`), released: new Date(Date.UTC(2020, season, episode)).toISOString()})));
    return json({meta});
  }
  m = /^\/subtitles\/(movie|series)\/([^/]+?)(?:\/([^/]+))?\.json$/.exec(path);
  if (m) {
    requests.push(path);
    const extra = Object.fromEntries(new URLSearchParams(m[3] || ''));
    return json({subtitles: [
      {id: 'fx-en', url: `${media}/subs/en.srt`, lang: 'eng', m: extra.videoHash ? 'h' : 'i', subtitleFileName: 'Fixture.en.srt'},
      {id: 'fx-es', url: `${media}/subs/es.srt`, lang: 'spa'},
    ]});
  }
  m = /^\/stream\/(movie|series)\/([^/]+)\.json$/.exec(path);
  if (m) return json({streams: [
    {name: 'Fixture\nWeb', title: 'Opens a web page', externalUrl: 'https://example.test/watch'}, // listed first: card and source numbering must still match
    {name: 'Fixture\n1080p', title: 'Multi-audio MKV\n💾 0.3 MB', url: `${media}/cors/multi-audio.mkv`, behaviorHints: {bingeGroup: 'fixture-mkv'}},
    {name: 'Fixture\nMP4', title: 'Single-track MP4', url: `${media}/cors/single.mp4`},
    {name: 'Fixture\nTorrent', title: 'Needs debrid', infoHash: 'a'.repeat(40)},
  ]});
  return null;
}

// Add-ons that misbehave, for the robustness tests: `broken` has a malformed
// manifest and a catalog that fails, `flaky` answers streams with errors, and
// `small` pages its catalog five at a time and has a channel whose videos have
// no seasons. `control` switches the failures off (tests change it directly).
function oddAddonResponse(kind, path, media, control) {
  const json = (body, status = 200) => ({status, type: 'application/json', body: JSON.stringify(body)});
  const poster = id => `${media}/art/p/${encodeURIComponent(id)}.svg`;
  if (kind === 'broken') {
    if (path === '/manifest.json') return json({id: 'test.broken', name: 'Broken', version: '0.1.0', types: 'movie', resources: ['catalog', 42, {nope: true}],
      catalogs: [{type: 'movie', id: 'odd', name: 'Odd', extra: {name: 'skip'}}, 'junk', null, {id: 'no-type'}]});
    if (path === '/catalog/movie/odd.json') return control.brokenCatalog ? json({err: 'down'}, 500)
      : json({metas: [{id: 'tt1000001', name: 'Movie 1', poster: poster('tt1000001'), genres: 'Drama'}, {id: 'tt1000002', poster: poster('tt1000002')}, {name: 'No id'}]});
  }
  if (kind === 'flaky') {
    if (path === '/manifest.json') return json({id: 'test.flaky', name: 'Flaky', version: '1.0.0', types: ['movie', 'series'], idPrefixes: ['tt'], resources: ['stream'], catalogs: []});
    if (/^\/stream\//.test(path)) return control.flakyStreams ? json({err: 'down'}, 500) : json({streams: [{name: 'Flaky\n720p', title: 'Answers the second time', url: `${media}/cors/single.mp4`}]});
  }
  if (kind === 'small') {
    if (path === '/manifest.json') return json({id: 'test.small', name: 'Small pages', version: '1.0.0', types: ['movie', 'series'], idPrefixes: ['sm', 'ch'], resources: ['catalog', 'meta'],
      catalogs: [{type: 'movie', id: 'tiny', name: 'Tiny pages', extra: [{name: 'skip'}]}, {type: 'series', id: 'channels', name: 'Channels'}]});
    const page = /^\/catalog\/movie\/tiny(?:\/skip=(\d+))?\.json$/.exec(path);
    if (page) {
      const skip = +page[1] || 0;
      return json({metas: Array.from({length: 23}, (_, i) => `sm${String(i + 1).padStart(3, '0')}`).slice(skip, skip + 5).map(id => ({id, type: 'movie', name: `Small ${id.slice(2)}`, poster: poster(id)}))});
    }
    if (path === '/catalog/series/channels.json') return json({metas: [{id: 'ch1', type: 'series', name: 'A channel', poster: poster('ch1')}]});
    if (path === '/meta/series/ch1.json') return json({meta: {id: 'ch1', type: 'series', name: 'A channel', genres: 'Vlogs', cast: 'Ada Lovelace', videos: [
      {id: 'ch1:v1', title: 'First upload', released: '2024-01-01'}, {id: 'ch1:v2', title: 'Second upload', released: 'sometime'}, {id: 'ch1:v3', title: 'Third upload', released: '2024-03-01'}]}});
    const meta = /^\/meta\/movie\/(sm\d+)\.json$/.exec(path);
    if (meta) return json({meta: {id: meta[1], type: 'movie', name: `Small ${meta[1].slice(2)}`}});
  }
  return null;
}

const origin = s => `http://127.0.0.1:${s.address().port}`;
function listen(handler) {
  return new Promise(done => { const server = http.createServer(handler); server.listen(0, '127.0.0.1', () => done(server)); });
}

/**
 * Starts both servers. Resolves {site, media, addon, subtitleRequests, control, close}.
 * `release`, when given, is called for each /release.json (the site's
 * release manifest, which the service worker reads) and returns its body.
 */
export async function startAstraServers({frontend = join(ROOT, 'frontend'), fixtures = join(ROOT, 'tests/fixtures/astra'), release = null} = {}) {
  const site = await listen((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (release && path === '/release.json') { res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); return res.end(JSON.stringify(release())); }
    let file = normalize(join(frontend, path));
    if (!file.startsWith(frontend)) { res.writeHead(403); return res.end(); }
    if (path.endsWith('/')) file = join(file, 'index.html');
    serveFile(req, res, file, {cors: false});
  });
  const subtitleRequests = [];
  const control = {brokenCatalog: true, flakyStreams: true, metaFails: false, manifestDelay: 0, streamDelay: 0};
  const media = await listen((req, res) => {
    const url = new URL(req.url, 'http://x');
    const subs = /^\/subs\/(\w+)\.srt$/.exec(url.pathname);
    if (subs && SUBTITLE_FILES[subs[1]]) { res.writeHead(200, {'Content-Type': 'application/x-subrip; charset=utf-8', 'Access-Control-Allow-Origin': '*'}); return res.end(SUBTITLE_FILES[subs[1]]); }
    const odd = /^\/(broken|flaky|small)(\/.*)$/.exec(url.pathname);
    if (odd) {
      const out = oddAddonResponse(odd[1], decodeURIComponent(odd[2]), origin(media), control);
      const send = () => { res.writeHead(out ? out.status : 404, {'Content-Type': out?.type || 'text/plain', 'Access-Control-Allow-Origin': '*'}); res.end(out?.body || 'not found'); };
      const delay = odd[2] === '/manifest.json' ? control.manifestDelay : odd[2].startsWith('/stream/') ? control.streamDelay : 0;
      return delay ? setTimeout(send, delay) : send();
    }
    if (control.metaFails && url.pathname.startsWith('/addon/meta/')) { res.writeHead(503, {'Access-Control-Allow-Origin': '*'}); return res.end('busy'); }
    if (url.pathname.startsWith('/addon/')) {
      const out = addonResponse(decodeURIComponent(url.pathname.slice(6)), origin(media), null, subtitleRequests);
      res.writeHead(out ? 200 : 404, {'Content-Type': out?.type || 'text/plain', 'Access-Control-Allow-Origin': '*'});
      return res.end(out?.body || 'not found');
    }
    const art = /^\/art\/([pblt])\/(.+)\.svg$/.exec(decodeURIComponent(url.pathname));
    if (art) { res.writeHead(200, {'Content-Type': 'image/svg+xml', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=3600'}); return res.end(artSvg(art[1], art[2])); }
    const [, mode, ...rest] = decodeURIComponent(url.pathname).split('/');
    const file = normalize(join(fixtures, rest.join('/')));
    if (!file.startsWith(fixtures)) { res.writeHead(403); return res.end(); }
    if (mode === 'norange') { // a host that ignores Range and always sends the whole file
      const stat = statSync(file);
      res.writeHead(200, {'Access-Control-Allow-Origin': '*', 'Content-Type': TYPES[extname(file)], 'Content-Length': stat.size});
      return createReadStream(file).pipe(res);
    }
    serveFile(req, res, file, {cors: mode === 'cors' ? true : mode === 'expose' ? 'expose' : false});
  });
  return {
    site: origin(site), media: origin(media), addon: origin(media) + '/addon/manifest.json', subtitleRequests, control,
    close: () => Promise.all([site, media].map(s => new Promise(r => { s.closeAllConnections?.(); s.close(r); }))),
  };
}
