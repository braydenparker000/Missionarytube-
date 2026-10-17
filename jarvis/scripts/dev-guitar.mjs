import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { songsterr } from '../backend/songsterr.js';
const root = resolve('public');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.otf': 'font/otf', '.json': 'application/json', '.txt': 'text/plain' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const harness = { '/guitar/qa-mobile.html': 'tests/guitar-browser.html', '/guitar/qa-mobile.js': 'tests/guitar-browser.js' }[url.pathname];
    if (harness) { res.setHeader('Content-Type', types[extname(harness)]); res.end(await readFile(harness)); return; }
    if (url.pathname === '/assets/config.js') { res.setHeader('Content-Type', types['.js']); res.end('export const API_ORIGIN = location.origin; export const DIRECT_API_ENABLED = false;'); return; }
    if (url.pathname.startsWith('/guitar/search') || url.pathname.startsWith('/guitar/songs/')) {
      const result = await songsterr(new Request(url, { method: req.method }), (body, status = 200) => Response.json(body, { status }));
      res.writeHead(result.status, { 'Content-Type': 'application/json' }); res.end(await result.text()); return;
    }
    const file = resolve(root, '.' + decodeURIComponent(url.pathname) + (url.pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(root + '/')) { res.writeHead(403).end(); return; }
    res.setHeader('Content-Type', types[extname(file)] || 'application/octet-stream'); res.end(await readFile(file));
  } catch (e) { res.writeHead(500, { 'Content-Type': 'text/plain' }); res.end(e.message); }
});
server.listen(8787, '0.0.0.0', () => console.log('Guitar test server: http://localhost:8787/guitar/'));
