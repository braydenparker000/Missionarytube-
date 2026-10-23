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
  '.mkv': 'video/x-matroska', '.mp4': 'video/mp4', '.webm': 'video/webm', '.srt': 'application/x-subrip', '.vtt': 'text/vtt', '.ass': 'text/x-ssa'};

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

function listen(handler) {
  return new Promise(done => { const server = http.createServer(handler); server.listen(0, '127.0.0.1', () => done(server)); });
}

/** Starts both servers. Resolves {site, media, close}. */
export async function startAstraServers({frontend = join(ROOT, 'frontend'), fixtures = join(ROOT, 'tests/fixtures/astra')} = {}) {
  const site = await listen((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = normalize(join(frontend, path));
    if (!file.startsWith(frontend)) { res.writeHead(403); return res.end(); }
    if (path.endsWith('/')) file = join(file, 'index.html');
    serveFile(req, res, file, {cors: false});
  });
  const media = await listen((req, res) => {
    const url = new URL(req.url, 'http://x');
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
  const origin = s => `http://127.0.0.1:${s.address().port}`;
  return {
    site: origin(site), media: origin(media),
    close: () => Promise.all([site, media].map(s => new Promise(r => { s.closeAllConnections?.(); s.close(r); }))),
  };
}
