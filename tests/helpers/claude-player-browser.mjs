// Claude Player browser fixture: the real player from frontend/ in Chrome,
// with the music Worker replaced by a synthetic R2 index and range-capable
// WAV audio (CORS for the page's origin), so playback runs end to end
// through the real media elements and Web Audio graph.
import {createServer} from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {extname, resolve, sep} from 'node:path';
import {chromium} from 'playwright-core';

export const WORKER = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.otf': 'font/otf', '.gz': 'application/gzip'};

export const chrome = [process.env.JARVIS_CHROME, process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));

/**
 * A 16-bit stereo WAV: a tone (hz, dB) with 5 ms raised-cosine edges, or
 * none (edges false); from: seconds of an earlier tone it goes on from (a
 * continuous recording split into tracks).
 */
export function wav({seconds = 8, hz = 440, db = -12, rate = 48000, edges = true, from = 0} = {}) {
  const n = Math.round(seconds * rate), data = Buffer.alloc(n * 4), a = 10 ** (db / 20), edge = Math.round(rate * 0.005), f0 = Math.round(from * rate);
  for (let i = 0; i < n; i++) {
    const g = edges ? Math.min(1, i / edge, (n - 1 - i) / edge) : 1, g2 = 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, g));
    const v = Math.round(32767 * a * g2 * Math.sin(2 * Math.PI * hz * (i + f0) / rate));
    data.writeInt16LE(v, i * 4);
    data.writeInt16LE(v, i * 4 + 2);
  }
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Index records for fixture tracks ({title, seconds, hz, album, track}). */
export function libraryOf(tracks) {
  return tracks.map((t, i) => {
    const id = 'r2_native_' + String(i + 1).padStart(64, '0');
    const bytes = t.bytes ?? wav(t);
    return {
      id, bytes, record: {
        id, audioKey: 'native/audio/' + id, size: bytes.length, sha256: '0'.repeat(64), md5: '0'.repeat(32), mimeType: 'audio/wav',
        r2Identity: {lastModified: '2026-10-01T00:00:00Z'}, path: `Lab/${t.album ?? 'Tones'}/${String(t.track ?? i + 1).padStart(2, '0')} ${t.title ?? 'Tone ' + (i + 1)}.wav`, folder: 'Cloudflare R2/Lab',
        metadata: {title: t.title ?? 'Tone ' + (i + 1), artist: 'Audio Lab', album: t.album ?? 'Tones', track: t.track ?? i + 1, disc: 1, dur: t.seconds ?? 8, sr: t.rate ?? 48000, ch: 2, codec: 'wav', bits: 16},
      },
    };
  });
}

/**
 * Opens the player: frontend/ served locally, the Worker answered from the
 * fixture (index, audio with byte ranges, 404 for covers and waveforms).
 * Returns the page, page errors and the audio requests seen.
 */
export async function openPlayer(t, {tracks = [{}, {}, {}], query = '', width = 390, audioDelayMs = 0, workletDelayMs = 0, init = null} = {}) {
  // The audio network, steerable by a test: down (requests fail), hang (requests wait for release()),
  // tracks refused (any request) or refused whole (offline copy downloads), by id.
  const net = {down: false, hang: false, refuse: new Set(), refuseWhole: new Set(), held: [], release() { this.hang = false; for (const go of this.held.splice(0)) go(); }};
  if (!chrome) throw Error('Claude Player browser checks require Chrome. Set JARVIS_CHROME.');
  const root = resolve('frontend');
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      let file = resolve(root, '.' + path);
      if (!file.startsWith(root + sep)) throw Error();
      if ((await stat(file)).isDirectory()) file += '/index.html';
      // A slow audio engine module (the worklet loads after the page).
      if (workletDelayMs && file.endsWith('engine-worklet.js')) await new Promise(r => setTimeout(r, workletDelayMs));
      res.writeHead(200, {'Content-Type': TYPES[extname(file)] || 'application/octet-stream'});
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
  const browser = await chromium.launch({executablePath: chrome, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
  t.after(() => browser.close());
  // With a slow engine module the page loads it itself, not through the service worker.
  const page = await browser.newPage({viewport: {width, height: 844}, isMobile: true, hasTouch: true, reducedMotion: 'reduce', ...(workletDelayMs ? {serviceWorkers: 'block'} : {})});
  const origin = `http://127.0.0.1:${server.address().port}`, errors = [], requests = [];
  page.on('pageerror', e => errors.push(e.message));
  if (init) await page.addInitScript(init);
  const lib = libraryOf(tracks), byId = new Map(lib.map(x => [x.id, x]));
  const cors = {'Access-Control-Allow-Origin': origin, 'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges'};
  await page.route(WORKER + '/**', async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.pathname === '/music/library.json') return route.fulfill({status: 200, headers: {...cors, 'Content-Type': 'application/json'}, body: JSON.stringify({version: 1, kind: 'r2-library', tracks: lib.map(x => x.record)})});
    const m = /^\/music\/library\/audio\/(r2_[\w-]+)$/.exec(url.pathname);
    const item = m && byId.get(m[1]);
    if (!item) return route.fulfill({status: 404, headers: cors, body: ''});
    const range = /bytes=(\d+)-(\d*)/.exec(req.headers().range ?? '');
    requests.push({id: item.id, range: range ? range[0] : null, at: Date.now()});
    if (net.hang) await new Promise(go => net.held.push(go));
    if (net.down) return route.abort('internetdisconnected');
    if (net.refuse.has(item.id) || (!range && net.refuseWhole.has(item.id))) return route.fulfill({status: 500, headers: cors, body: ''});
    if (audioDelayMs) await new Promise(r => setTimeout(r, audioDelayMs));
    const size = item.bytes.length;
    if (!range) return route.fulfill({status: 200, headers: {...cors, 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Length': String(size)}, body: item.bytes});
    const a = +range[1], b = range[2] ? Math.min(+range[2], size - 1) : size - 1;
    return route.fulfill({status: 206, headers: {...cors, 'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${a}-${b}/${size}`, 'Content-Length': String(b - a + 1)}, body: item.bytes.subarray(a, b + 1)});
  });
  await page.goto(`${origin}/claude-player/${query}`);
  await page.waitForFunction(() => window.__cp?.library?.tracks?.length > 0, null, {timeout: 30000});
  return {page, errors, origin, requests, lib, net};
}
