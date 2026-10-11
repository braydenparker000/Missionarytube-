import {conversationMenu} from './helpers/relay-conversation-browser-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, stat, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { apps } from '../public/assets/hub.js';
import { API_ORIGIN } from '../public/assets/config.js';
import { STORAGE_KEY, LEGACY_KEY } from '../public/assets/shared-store.js';
import { MUSE_PREFIX } from '../public/assets/channels.js';

const executablePath = [process.env.JARVIS_CHROME, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', chromium.executablePath()].find(path => path && existsSync(path));
const publicRoot = fileURLToPath(new URL('../public/', import.meta.url));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };

test('launcher browser behavior', { skip: executablePath ? false : 'Install Chromium or set JARVIS_CHROME to run browser checks', timeout: 120000 }, async t => {
  const server = createServer(async (req, res) => {
    try {
      let path = resolve(publicRoot, '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
      if (path !== resolve(publicRoot) && !path.startsWith(publicRoot.endsWith(sep) ? publicRoot : publicRoot + sep)) throw Error('Invalid path');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      res.writeHead(200, { 'Content-Type': mime[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(await readFile(path));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    async function open({ viewport = { width: 390, height: 844 }, locale = 'en-US', timezoneId = 'UTC', reducedMotion = 'no-preference', storage = {}, messages = [], posts = [], offline = false, legacyMessages = [] } = {}) {
      const context = await browser.newContext({ viewport, locale, timezoneId, reducedMotion, isMobile: true, hasTouch: true });
      const api = { messages: structuredClone(messages), posts: structuredClone(posts), offline, sent: [], requests: [], mutations: [] };
      // All cloud requests are fixtures; these tests never post to the live inbox.
      await context.route('**/*', async route => {
        const request = route.request(), url = new URL(request.url());
        if (url.origin === origin) return route.continue();
        if (url.origin !== API_ORIGIN) return route.abort('blockedbyclient');
        const call = { method: request.method(), path: url.pathname };
        api.requests.push(call);
        if (!['GET', 'HEAD', 'OPTIONS'].includes(call.method)) api.mutations.push(call);
        let status = 200, body;
        if (api.offline) { status = 503; body = { error: 'Offline fixture. Your drafts are safe.' }; }
        else if (url.pathname === '/shared/changes') { status = 404; body = { error: 'This fictional legacy service does not support changes' }; }
        else if (url.pathname === '/shared/state') {
          // The old service returns immutable public entries, without the
          // browser's saved/queue flags. Keep the /state compatibility coverage.
          const wire = entry => Object.fromEntries(Object.entries(entry).filter(([key]) => ['id', 'body', 'createdAt', 'role', 'kind', 'replyTo', 'title'].includes(key)));
          body = { mode: 'github-publications', coordinationVersion: 1, messages: api.messages.map(wire), posts: api.posts.map(wire), publisher: { ok: true }, nextCursor: null,
            public_inbox: true, author_authenticated: false, execution_authorized: false };
        }
        else if (url.pathname === '/shared/messages' && request.method() === 'POST') {
          const item = request.postDataJSON();
          api.sent.push(item);
          let entry = api.messages.find(m => m.id === item.id);
          if (!entry) {
            entry = { ...item, role: 'user', createdAt: new Date().toISOString() };
            api.messages.push(entry);
            status = 201;
          }
          body = { entry };
        } else if (url.pathname === '/v1/state') body = { messages: legacyMessages, posts: [] };
        else { status = 404; body = { error: 'Unexpected fixture endpoint' }; }
        return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
      });
      await context.addInitScript(values => {
        for (const [key, value] of Object.entries(values)) if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
      }, storage);
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      return { context, page, api, errors };
    }
    async function finish(session) {
      await session.context.close();
      assert.deepEqual(session.errors, [], 'No uncaught browser errors');
    }
    const names = page => page.locator('.launcher-name').allTextContents();

    for (const [width, height] of [[360, 800], [390, 844], [430, 932]]) {
      await t.test(`Home fits ${width}px portrait with accessible touch targets and a reachable last row`, async () => {
        const session = await open({ viewport: { width, height } }), { page } = session;
        await page.goto(origin);
        await page.locator('#launcher-date').waitFor();
        assert.deepEqual(await names(page), apps.map(a => a.name));
        const layout = await page.evaluate(() => ({
          width: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          targets: [...document.querySelectorAll('.launcher-link, .launcher-topbar .icon-button')].map(a => {
            const rect = a.getBoundingClientRect();
            return { text: a.textContent.trim(), left: rect.left, right: rect.right, height: rect.height };
          }),
          clock: document.querySelector('#launcher-time').getBoundingClientRect().toJSON()
        }));
        assert.equal(layout.width, width);
        assert.ok(layout.scrollWidth <= width, 'No horizontal scrolling');
        for (const target of layout.targets) {
          assert.ok(target.height >= 48, `${target.text}: at least 48px tall`);
          assert.ok(target.left >= 0 && target.right <= width, `${target.text}: within viewport`);
        }
        assert.ok(layout.clock.right <= width);
        assert.equal(await page.locator('.bottom-nav, .shortcuts, .launcher-list small').count(), 0);
        if (process.env.JARVIS_SCREENSHOT_DIR) {
          await mkdir(process.env.JARVIS_SCREENSHOT_DIR, { recursive: true });
          await page.screenshot({ path: join(process.env.JARVIS_SCREENSHOT_DIR, `launcher-${width}.png`) });
          await page.screenshot({ path: join(process.env.JARVIS_SCREENSHOT_DIR, `launcher-${width}-full.png`), fullPage: true });
        }
        await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
        const last = await page.locator('.launcher-link[href="/settings/"]').boundingBox();
        assert.ok(last.y >= 0 && last.y + last.height <= height - 36 + 1, `Settings clears the bottom edge (allow 1px rounding): ${JSON.stringify(last)}`);
        await finish(session);
      });
    }

    await t.test('safe-area insets and reduced motion are respected', async () => {
      const session = await open({ viewport: { width: 360, height: 800 }, reducedMotion: 'reduce' }), { page, context } = session;
      // Emulate a phone with a 24px top cutout and 34px bottom inset in the real CSS formulas.
      const css = (await readFile(join(publicRoot, 'assets/shell.css'), 'utf8'))
        .replaceAll('env(safe-area-inset-top)', '24px').replaceAll('env(safe-area-inset-bottom)', '34px')
        .replaceAll('env(safe-area-inset-left)', '16px').replaceAll('env(safe-area-inset-right)', '16px');
      await context.route('**/assets/shell.css', route => route.fulfill({ contentType: 'text/css', body: css }));
      const alignedCss = (await readFile(join(publicRoot, 'assets/aligned-pages.css'), 'utf8'))
        .replaceAll('env(safe-area-inset-top)', '24px').replaceAll('env(safe-area-inset-bottom)', '34px')
        .replaceAll('env(safe-area-inset-left)', '16px').replaceAll('env(safe-area-inset-right)', '16px');
      await context.route('**/assets/aligned-pages.css*', route => route.fulfill({ contentType: 'text/css', body: alignedCss }));
      await page.goto(origin);
      await page.locator('#launcher-time').waitFor();
      const firstButton = await page.locator('#search-button').boundingBox();
      assert.ok(firstButton.y >= 24);
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      const last = await page.locator('.launcher-link[href="/settings/"]').boundingBox();
      assert.ok(last.y + last.height <= 800 - 34 - 36 + 1, `Settings clears the inset (allow 1px rounding): ${JSON.stringify(last)}`);
      assert.equal(await page.locator('.launcher-link').first().evaluate(a => getComputedStyle(a).transitionDuration), '0s');
      assert.match(await page.locator('meta[name="viewport"]').getAttribute('content'), /viewport-fit=cover/);
      await finish(session);
    });

    await t.test('local clock and date roll over at midnight without replacing search or creating history entries', async () => {
      for (const [locale, before, after] of [['en-US', '11:59PM', '12:00AM'], ['de-DE', '23:59', '0:00']]) {
        const session = await open({ locale, timezoneId: 'America/Los_Angeles' }), { page } = session;
        await page.clock.install({ time: new Date('2026-10-03T06:59:00Z') });
        await page.clock.pauseAt(new Date('2026-10-03T06:59:40Z'));
        await page.goto(origin);
        await page.locator('#launcher-time').waitFor();
        assert.equal((await page.locator('#launcher-time').textContent()).replace(/\s/g, ''), before);
        assert.equal(await page.locator('#launcher-date').getAttribute('datetime'), '2026-10-02');
        const historyLength = await page.evaluate(() => history.length);
        await page.getByRole('button', { name: 'Search apps' }).click();
        await page.getByRole('searchbox', { name: 'Find an app' }).fill('Poweramp');
        await page.evaluate(() => { window.savedSearch = document.querySelector('#app-search'); });
        await page.clock.runFor(21000);
        assert.equal((await page.locator('#launcher-time').textContent()).replace(/\s/g, ''), after);
        assert.equal(await page.locator('#launcher-date').getAttribute('datetime'), '2026-10-03');
        assert.equal(await page.evaluate(() => document.querySelector('#app-search') === window.savedSearch), true);
        assert.equal(await page.locator('#app-search').inputValue(), 'Poweramp');
        assert.deepEqual(await names(page), ['Poweramp']);
        assert.equal(await page.evaluate(() => history.length), historyLength);
        await finish(session);
      }
    });

    await t.test('each real launcher link opens its existing app URL in the independent app', async () => {
      const session = await open(), { page } = session;
      for (const app of apps) {
        await page.goto(origin);
        await page.locator('#launcher-time').waitFor();
        const link = page.locator(`.launcher-link[href="${app.href}"]`);
        assert.equal(await link.getAttribute('href'), app.href);
        await link.click();
        await page.waitForURL(origin + app.href, { waitUntil: 'domcontentloaded' });
        assert.equal(new URL(page.url()).pathname, app.href);
        assert.equal(await page.locator('body.launcher-page').count(), 0, 'Launcher styling leaves with Home');
        if (app.id === 'jarvis') {
          assert.equal(await page.title(), 'Relay · Jarvis');
          assert.equal(await page.getByRole('heading', { name: 'Relay', exact: true }).count(), 1);
        }
      }
      await finish(session);
    });

    await t.test('browser Back from shared shell apps returns Home without duplicate entries', async () => {
      const session = await open(), { page } = session;
      await page.goto(origin);
      // Standalone apps such as Poweramp own their internal Back stacks.
      for (const id of ['jarvis', 'board', 'notes', 'tools', 'server', 'settings']) {
        const app = apps.find(a => a.id === id);
        await page.locator('#launcher-time').waitFor();
        const length = await page.evaluate(() => history.length);
        await page.locator('.brand').click();
        assert.equal(await page.evaluate(() => history.length), length, 'Home link does not duplicate Home');
        await page.locator(`.launcher-link[href="${app.href}"]`).click();
        await page.waitForURL(origin + app.href, { waitUntil: 'domcontentloaded' });
        await page.goBack({ waitUntil: 'domcontentloaded' });
        assert.equal(new URL(page.url()).pathname, '/', `${app.name}: Back returns Home`);
        await page.locator('#launcher-time').waitFor();
      }
      await finish(session);
    });

    await t.test('search, old favorites, editing, Settings, and their history remain reachable', async () => {
      const session = await open({ storage: { 'jarvis.preferences.v1': JSON.stringify({ favorites: ['jarvis', 'drawercast', 'mymedia'] }) } }), { page } = session;
      await page.goto(origin);
      await page.locator('#launcher-time').waitFor();
      assert.equal(await page.locator('.favorite-mark').count(), 3);
      await page.getByRole('link', { name: 'Favorites', exact: true }).click();
      assert.equal(new URL(page.url()).pathname, '/favorites/');
      assert.deepEqual(await names(page), ['Relay', 'Poweramp', 'My Media']);
      await page.getByRole('button', { name: 'Edit favorites' }).click();
      assert.equal(await page.getByRole('checkbox', { name: 'Relay', exact: true }).isChecked(), true);
      await page.getByRole('checkbox', { name: 'Poweramp', exact: true }).uncheck();
      await page.getByRole('checkbox', { name: 'Guitar', exact: true }).check();
      await page.getByRole('button', { name: 'Save favorites' }).click();
      await page.reload();
      await page.locator('.launcher-list').waitFor();
      assert.deepEqual(await names(page), ['Relay', 'Guitar', 'My Media']);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('jarvis.preferences.v1'))), { favorites: ['jarvis', 'guitar', 'mymedia'] });
      await page.locator('.brand').click();
      assert.equal(await page.locator('.launcher-link[href="/jarvis/"] .favorite-mark').count(), 1);
      await page.getByRole('button', { name: 'Search apps' }).click();
      await page.getByRole('searchbox', { name: 'Find an app' }).fill(' PoWeRaMp ');
      assert.deepEqual(await names(page), ['Poweramp']);
      await page.locator('#app-search').fill('jarvis');
      assert.deepEqual(await names(page), ['Relay']);
      await page.locator('#app-search').fill('nothing matches');
      assert.equal(await page.getByRole('status').filter({ hasText: 'No apps match your search.' }).count(), 1);
      await page.getByRole('button', { name: 'Search apps' }).click();
      assert.deepEqual(await names(page), apps.map(a => a.name));
      await page.goBack();
      assert.equal(new URL(page.url()).pathname, '/favorites/');
      await page.getByRole('button', { name: 'Search apps' }).click();
      assert.equal(new URL(page.url()).pathname, '/');
      assert.equal(await page.locator('#app-search').isVisible(), true);
      await page.getByRole('button', { name: 'Search apps' }).click();
      await page.locator('.launcher-link[href="/settings/"]').click();
      await page.waitForURL(origin + '/settings/');
      await page.locator('#settings-favorites').click();
      for (const checkbox of await page.locator('#favorites-form input').all()) await checkbox.setChecked(false);
      await page.getByRole('button', { name: 'Save favorites' }).click();
      await page.getByRole('link', { name: 'Favorites', exact: true }).click();
      assert.equal(await page.locator('.launcher-link').count(), 0);
      assert.equal(await page.getByRole('status').filter({ hasText: 'Choose your favorite apps with Edit.' }).count(), 1);
      await finish(session);
    });

    await t.test('Relay reads saved messages and drafts, keeps JARVIS authors and channel isolation, and syncs the same schema', async () => {
      const stamp = '2026-10-02T12:00:00Z';
      const user = { id: '00000000-0000-4000-8000-000000000001', role: 'user', body: 'Earlier thought', createdAt: stamp, saved: true };
      const reply = { id: '00000000-0000-4000-8000-000000000002', role: 'assistant', kind: 'reply', replyTo: user.id, body: 'Earlier reply', createdAt: stamp, saved: true };
      const muse = { id: '00000000-0000-4000-8000-000000000003', role: 'user', body: MUSE_PREFIX + 'Muse private channel', createdAt: stamp, saved: true };
      const pending = { id: '00000000-0000-4000-8000-000000000004', role: 'user', body: 'Queued thought', createdAt: stamp, saved: false };
      const state = { version: 1, messages: [user, reply, muse, pending], posts: [], outbox: [{ ...pending, type: 'message' }], composer: 'Unfinished thought', syncedAt: null };
      const untouched = { 'jarvis.quick-ai.v1': 'quick AI data', 'jarvis.notes.v1': 'Saved notes', [LEGACY_KEY]: 'original legacy data' };
      const session = await open({ offline: true, messages: [user, reply, muse], storage: { ...untouched, [STORAGE_KEY]: JSON.stringify(state) } }), { page, api } = session;
      await page.goto(origin + '/jarvis/');
      await page.getByRole('heading', { name: 'Relay', exact: true }).waitFor();
      await page.locator('#relay-sync-error').filter({ hasText: 'Offline fixture' }).waitFor();
      assert.equal(await page.title(), 'Relay · Jarvis');
      assert.equal(await page.locator('.conversation-page').count(),1);
      assert.equal(await page.getByRole('textbox', { name: 'Message Relay' }).inputValue(), state.composer);
      assert.deepEqual(await page.locator('.bubble .message-body').allTextContents(), ['Earlier thought', 'Earlier reply', 'Queued thought']);
      assert.equal(await page.locator('.incoming .message-author').textContent(), 'Jarvis');
      const stored = await page.evaluate(({ key, pendingId }) => ({
        state: JSON.parse(localStorage.getItem(key)),
        draft: sessionStorage.getItem(key + '.composer.v1'),
        draftId: sessionStorage.getItem(key + '.composer-id.v1'),
        journalKeys: Object.keys(localStorage).filter(name => name.startsWith(key + '.pending.')),
        journal: JSON.parse(localStorage.getItem(key + '.pending.' + pendingId))
      }), { key: STORAGE_KEY, pendingId: pending.id });
      const { composerId, ...preserved } = stored.state;
      assert.match(composerId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
      assert.deepEqual(preserved, { ...state, messages: [user, reply, muse, { ...pending, type: 'message' }] }, 'The public adapter adds only draft identity and queued-message metadata');
      assert.equal(stored.draft, state.composer);
      assert.equal(stored.draftId, composerId);
      assert.deepEqual(stored.journalKeys, [STORAGE_KEY + '.pending.' + pending.id]);
      assert.deepEqual(stored.journal, state.outbox[0], 'The original queued UUID and complete body are independently durable');
      await page.locator('#message-text').fill('Draft after rename');
      await page.locator('#relay-menu-button').click();await page.getByRole('link',{name:'Jarvis home',exact:true}).click();
      await page.waitForURL(origin + '/');await page.locator('body.launcher-page #app-directory').waitFor();
      await page.goBack();
      assert.equal(new URL(page.url()).pathname, '/jarvis/');
      assert.equal(await page.locator('#message-text').inputValue(), 'Draft after rename');
      api.offline = false;
      await conversationMenu(page,'Connection details');
      await page.getByRole('button', { name: 'Refresh messages' }).click();
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).outbox.length === 0, STORAGE_KEY);
      assert.deepEqual(api.sent, [{ id: pending.id, body: pending.body }]);
      assert.equal(await page.evaluate(key => localStorage.getItem(key), STORAGE_KEY + '.pending.' + pending.id), null, 'Exact acceptance removes the original UUID journal');
      assert.equal(await page.locator('#message-text').inputValue(), 'Draft after rename');
      await page.getByRole('button', { name: 'Close connection details' }).click();
      await page.locator('#message-text').fill('New Relay thought');
      await page.getByRole('button', { name: 'Send message', exact: true }).click();
      await page.waitForFunction(key => JSON.parse(localStorage.getItem(key)).outbox.length === 0 && JSON.parse(localStorage.getItem(key)).composer === '', STORAGE_KEY);
      assert.deepEqual(Object.keys(api.sent[1]).sort(), ['body', 'id']);
      assert.equal(api.sent[1].body, 'New Relay thought');
      assert.match(api.sent[1].id, /^[a-f0-9-]{36}$/);
      assert.equal(await page.evaluate(key => sessionStorage.getItem(key + '.composer.v1'), STORAGE_KEY), '');
      assert.deepEqual(await page.evaluate(key => Object.keys(localStorage).filter(name => name.startsWith(key + '.pending.')), STORAGE_KEY), []);
      for (const [key, value] of Object.entries(untouched)) assert.equal(await page.evaluate(key => localStorage.getItem(key), key), value);
      assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => key === 'jarvis.relay.messages.v1')), false);
      await finish(session);
    });

    await t.test('legacy drafts remain readable and damaged message storage is never overwritten', async () => {
      const local = { id: 'legacy-message', role: 'user', body: 'Legacy thought', createdAt: '2026-01-01T00:00:00Z' };
      const legacy = { key: 'a'.repeat(64), messages: [local], outbox: [{ ...local, type: 'message', sendState: 'sending' }], composer: 'Legacy draft' };
      const legacyRaw = JSON.stringify(legacy);
      // A nonempty old remote inbox makes an accidental recovery/import visible.
      const remoteLegacy = { id: '00000000-0000-4000-8000-000000000006', role: 'user', body: 'Fictional earlier remote legacy thought', createdAt: local.createdAt };
      const cached = { version: 1, messages: [{ ...local, saved: false }], posts: [], outbox: [], composer: legacy.composer, syncedAt: null, legacyPending: true };
      for (const mode of ['legacy fallback', 'cached legacy flag']) {
        t.diagnostic(mode);
        const storage = { [LEGACY_KEY]: legacyRaw, ...(mode === 'cached legacy flag' ? { [STORAGE_KEY]: JSON.stringify(cached) } : {}) };
        const session = await open({ offline: true, legacyMessages: [remoteLegacy], storage }), { page, api } = session;
        await page.goto(origin + '/jarvis/');
        await page.locator('#relay-sync-error').filter({ hasText: 'Offline fixture' }).waitFor();
        assert.equal(await page.locator('#message-text').inputValue(), 'Legacy draft');
        assert.deepEqual(await page.locator('.bubble .message-body').allTextContents(), ['Legacy thought']);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), legacyRaw);
        const localTime = await page.locator('[data-message-id="legacy-message"] .message-time').textContent();
        assert.match(localTime, /local|on this device/i, 'Older readable text stays explicitly local');
        assert.doesNotMatch(localTime, /Sending to public inbox|Send unconfirmed|Queued on this device|Awaiting reply/);
        const restored = await page.evaluate(key => ({
          state: JSON.parse(localStorage.getItem(key)),
          journalKeys: Object.keys(localStorage).filter(name => name.startsWith(key + '.pending.'))
        }), STORAGE_KEY);
        assert.equal(restored.state.messages.find(message => message.id === legacy.messages[0].id)?.body, legacy.messages[0].body);
        assert.notEqual(restored.state.messages.find(message => message.id === legacy.messages[0].id)?.saved, true, 'Local legacy text is not cloud acceptance');
        assert.deepEqual(restored.state.outbox, []);
        assert.deepEqual(restored.journalKeys, []);
        assert.deepEqual(api.sent, [], 'Restoring an older non-UUID row cannot allocate or send a replacement');
        assert.deepEqual(api.mutations, [], 'Old flags cannot authorize a mutating request to any API route');
        await page.reload();
        await page.locator('#relay-sync-error').filter({ hasText: 'Offline fixture' }).waitFor();
        assert.equal(await page.locator('#message-text').inputValue(), 'Legacy draft');
        assert.deepEqual(await page.locator('.bubble .message-body').allTextContents(), ['Legacy thought']);
        assert.equal(await page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), legacyRaw);
        assert.deepEqual(api.sent, []);
        assert.deepEqual(api.mutations, []);
        api.offline = false;
        await conversationMenu(page,'Connection details');
        const sharedRead = page.waitForResponse(response => new URL(response.url()).pathname === '/shared/state' && response.request().method() === 'GET');
        await page.getByRole('button', { name: 'Refresh messages' }).click();
        await sharedRead;
        await page.waitForFunction(() => document.querySelector('#sync-now')?.disabled === false);
        assert.deepEqual(await page.locator('.bubble .message-body').allTextContents(), ['Legacy thought'], 'A complete empty public read cannot erase the older local copy');
        assert.equal(await page.locator('#message-text').inputValue(), 'Legacy draft');
        assert.equal(await page.evaluate(key => localStorage.getItem(key), LEGACY_KEY), legacyRaw);
        assert.notEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)).messages.find(message => message.id === 'legacy-message')?.saved, STORAGE_KEY), true);
        assert.deepEqual(api.sent, []);
        assert.deepEqual(api.mutations, [], 'Fresh shared GET must not trigger migration or a new public send');
        assert.ok(api.requests.some(call => call.method === 'GET' && call.path === '/shared/state'));
        assert.equal(api.requests.some(call => call.path.startsWith('/v1/') || call.path === '/shared/migrate'), false, 'Ordinary sync does not invoke old-inbox recovery');
        assert.deepEqual(await page.evaluate(key => Object.keys(localStorage).filter(name => name.startsWith(key + '.pending.')), STORAGE_KEY), []);
        await page.getByRole('button', { name: 'Close connection details' }).click();
        await finish(session);
      }
      const damaged = await open({ storage: { [STORAGE_KEY]: 'broken' } });
      await damaged.page.goto(origin + '/jarvis/');
      await damaged.page.getByRole('heading', { name: 'Unable to save on this device' }).waitFor();
      assert.equal(await damaged.page.evaluate(key => localStorage.getItem(key), STORAGE_KEY), 'broken');
      assert.deepEqual(damaged.api.mutations, []);
      await finish(damaged);
    });

    await t.test('Notes and Daily Board keep their saved content behind the launcher', async () => {
      const post = { id: '00000000-0000-4000-8000-000000000005', title: 'Existing briefing', body: 'Existing board content', createdAt: '2026-10-02T12:00:00Z' };
      const session = await open({ posts: [post], storage: { 'jarvis.notes.v1': 'Existing note' } }), { page } = session;
      await page.goto(origin);
      await page.locator('.launcher-link[href="/notes/"]').click();
      await page.waitForURL(origin + '/notes/');
      assert.equal(await page.locator('#note-text').inputValue(), 'Existing note');
      await page.locator('#note-text').fill('Updated note');
      await page.goBack();
      await page.locator('.launcher-link[href="/daily-board/"]').click();
      await page.waitForURL(origin + '/daily-board/');
      await page.getByRole('heading', { name: post.title }).waitFor();
      assert.equal(await page.locator('.board-entry p').textContent(), post.body);
      assert.equal(await page.evaluate(() => localStorage.getItem('jarvis.notes.v1')), 'Updated note');
      await finish(session);
    });
  } finally {
    await browser?.close();
    await new Promise(done => server.close(done));
  }
});
