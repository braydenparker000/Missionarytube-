import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {join} from 'node:path';

const root = 'frontend/chats';
async function modules(dir) {
  const out = [];
  for (const e of await readdir(join(root, dir), {withFileTypes: true})) {
    const path = join(dir, e.name);
    if (e.isDirectory()) out.push(...await modules(path)); else if (e.name.endsWith('.js')) out.push(path);
  }
  return out;
}

test('the page preloads every module it starts with, declares its own CSP, and talks only to the Jarvis Worker', async () => {
  const html = await readFile(join(root, 'index.html'), 'utf8');
  const preloaded = [...html.matchAll(/rel="modulepreload" href="([^"]+)"/g)].map(m => m[1]).sort();
  const all = (await modules('src')).filter(p => p !== 'src/main.js').sort();
  assert.deepEqual(preloaded, all, 'index.html modulepreload list is in step with src/');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1];
  assert.ok(csp, 'explicit CSP');
  const {API_ORIGIN} = await import('../frontend/assets/config.js');
  assert.match(csp, new RegExp(`connect-src 'self' ${API_ORIGIN.replace(/[.]/g, '\\.')} `));
  assert.match(csp, /script-src 'self';/, 'no inline or remote script');
  const api = await readFile(join(root, 'src/api.js'), 'utf8');
  assert.match(api, new RegExp(`export const API_ORIGIN = '${API_ORIGIN}'`), 'api.js names the same Worker as assets/config.js');
});

test('the service worker serves the release of frontend/chats and nothing from the Worker', async () => {
  const sw = await readFile(join(root, 'sw.js'), 'utf8');
  assert.match(sw, /components\?\.chats\?\.tree/);
  assert.match(sw, /'chats-app-'/);
  assert.doesNotMatch(sw, /astra/i);
  const manifest = JSON.parse(await readFile(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.start_url, './');
  for (const icon of manifest.icons) await readFile(join(root, icon.src));
});

test('status words follow the listener lease and the wake', async () => {
  globalThis.matchMedia ??= () => ({matches: false});
  const {claudeStatus, museStatus} = await import('../frontend/chats/src/status.js');
  const now = 1_000_000_000;
  assert.equal(claudeStatus(null).detail, 'Connecting…');
  assert.equal(claudeStatus({alive: true, state: 'listening'}, 0, now).label, 'Online');
  const working = claudeStatus({alive: true, state: 'working', note: 'Running tests', threadId: 't'}, 0, now);
  assert.deepEqual([working.label, working.detail, working.threadId], ['Working', 'Running tests', 't']);
  assert.equal(claudeStatus({alive: false, wake: {at: now - 1000, ok: true, starting: true}}, 1, now).label, 'Starting up');
  assert.match(claudeStatus({alive: false, wake: {at: now - 1000, ok: false, error: 'not_configured'}}, 1, now).detail, /not set up yet · your message is waiting/);
  assert.equal(claudeStatus({alive: false, wake: null}, 2, now).label, 'Waking');
  assert.match(claudeStatus({alive: false, lastSeen: now - 5 * 60_000}, 0, now).detail, /Last seen 5 min ago/);
  assert.match(museStatus({enabled: false}).detail, /switched off/);
  assert.equal(museStatus({enabled: true, adapter: {lastFetchedAt: new Date(now - 60_000).toISOString()}}, now).tone, 'online');
});

test('previews and link labels', async () => {
  const {plain, shortUrl} = await import('../frontend/chats/src/markdown.js');
  assert.equal(plain('**Done**: see `x` and [the PR](https://github.com/o/r/pull/3)\n```js\ncode\n```'), 'Done: see x and the PR [code]');
  assert.equal(shortUrl('https://github.com/braydenparker000/Missionarytube-/pull/400'), 'Missionarytube-#400');
  assert.equal(shortUrl('https://example.com/a/'), 'example.com/a');
  assert.equal(plain('x'.repeat(200), 10).length, 10);
});
