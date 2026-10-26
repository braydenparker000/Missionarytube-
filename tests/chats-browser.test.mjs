import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const chrome = [process.env.JARVIS_CHROME, process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && existsSync(p));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
const THREAD = '0f5e6a1c-1b2d-4c3e-9f40-5a6b7c8d9e01';

// One conversation: the owner asks twice, Claude answers the first ask (linking back to it) and works through three steps.
function conversation(now) {
  let seq = 0;
  const m = (role, kind, body, ago, extra = {}) => ({ seq: ++seq, id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, threadId: THREAD, role, kind, body, meta: null,
    replyTo: null, createdAt: now - ago * 1000, attachments: [], delivered: true, answered: role !== 'owner', ...extra });
  const ask = m('owner', 'text', 'Make the chats feel premium', 900);
  return [
    ask,
    m('owner', 'text', 'And keep it fast', 890),
    m('claude', 'text', 'On it. **One update** with a new look.', 880, { replyTo: ask.id }),
    m('claude', 'progress', 'Read the chat screen', 860),
    m('claude', 'progress', 'Rewrote the styles', 600),
    m('claude', 'progress', 'Added the task card', 70),
  ];
}

test('Chats: bubbles for the owner, avatars for Claude, and a live task card that ticks and then folds away',
  { skip: !chrome && 'Set JARVIS_CHROME to run the browser check', timeout: 60000 }, async t => {
    const root = resolve('frontend');
    const now = Date.now();
    const messages = conversation(now);
    let working = true;
    const status = () => working
      ? { alive: true, state: 'working', threadId: THREAD, note: 'Added the task card', stopRequested: null, sessionUrl: null, lastSeen: now }
      : { alive: true, state: 'listening', threadId: null, note: null, stopRequested: null, sessionUrl: null, lastSeen: now };
    const sent = [];
    const ops = {
      send: args => { sent.push(args); return { message: { seq: 99, id: args.id, threadId: args.threadId, role: 'owner', kind: 'text', body: args.body, meta: null, replyTo: null, createdAt: Date.now(), attachments: [], delivered: false, answered: false } }; },
      threads: () => ({ threads: [{ id: THREAD, title: 'Premium chats', createdAt: now - 900_000, updatedAt: now - 70_000, archived: false, sessionUrl: null, last: { role: 'claude', kind: 'text', body: 'On it.' }, card: null }], head: 9 }),
      messages: () => ({ messages, more: false, head: 9 }),
      status: () => ({ status: status(), pending: 0, head: 9 }),
      changes: args => new Promise(done => setTimeout(() => done({ head: 9, changed: false, messages: [], threads: [], status: status(), pending: 0 }), Math.min(Number(args.wait) || 0, 400))),
      notebook: () => ({ notebook: { body: '', version: 1, updatedAt: now } }),
    };
    const server = createServer(async (req, res) => {
      const url = new URL(req.url, 'http://x');
      if (url.pathname.startsWith('/claude-chat/') || url.pathname.startsWith('/relay/')) {
        let body = ''; for await (const chunk of req) body += chunk;
        let out = {};
        if (url.pathname.startsWith('/relay/')) out = { messages: [], cursor: '0' };
        else { const { op, args = {} } = JSON.parse(body || '{}'); out = await (ops[op] || (() => ({})))(args); }
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
      }
      try {
        let file = resolve(root, '.' + decodeURIComponent(url.pathname));
        if (!file.startsWith(root + sep)) throw Error();
        if ((await stat(file)).isDirectory()) file += '/index.html';
        res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }); res.end(await readFile(file));
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    t.after(() => new Promise(done => { server.closeAllConnections(); server.close(done); }));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
    t.after(() => browser.close());
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    await context.addInitScript(api => {
      localStorage.setItem('chats.dev.api', api);
      localStorage.setItem('jarvis.relay.owner-session.v1', JSON.stringify({ device_token: 'a'.repeat(64), device_id: 'device' }));
    }, origin);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.goto(origin + '/chats/');
    assert.equal(await page.locator('.wordmark').textContent(), 'Jarvis');
    await page.locator('.status-line .avatar.busy').waitFor();
    // Rows carry an avatar (spinning while Claude works there); a chat grows out of the row it was opened from.
    await page.locator('.row:has-text("Premium chats") .avatar.claude.busy').waitFor();
    await page.locator('.row:has-text("Premium chats")').click();
    assert.equal(await page.locator('.page.chat-screen.zoom').count(), 1, 'opened with the zoom from its row');

    // The owner's message is a bubble on the right with its time; Claude's turn starts with an avatar.
    const bubble = page.locator('.msg.owner .bubble').first();
    await bubble.waitFor();
    const box = await bubble.boundingBox();
    assert.ok(box.x + box.width > 390 - 24, 'owner bubble sits on the right');
    assert.match(await page.locator('.msg.owner .meta time').first().textContent(), /\d/);
    assert.equal(await page.locator('.turn-head.claude .avatar').count(), 1);

    // Claude's answer to the first ask links back to it, past the second; a tap brings it into view.
    const link = page.locator('.reply-link');
    assert.equal(await link.count(), 1);
    assert.equal(await link.textContent(), 'Make the chats feel premium');
    await link.click();
    await page.locator('.msg.owner.flash', { hasText: 'Make the chats feel premium' }).waitFor();
    assert.equal(await page.locator('.chat-top .avatar.busy').count(), 1);

    // The live task card: the earlier steps ticked, the last one current (not doubled by the same status note), and a running timer.
    const card = page.locator('.work.live');
    await card.waitFor();
    assert.deepEqual(await card.locator('li.done .step-text').allTextContents(), ['Read the chat screen', 'Rewrote the styles']);
    assert.equal(await card.locator('li.now .step-text').textContent(), 'Added the task card');
    const timer = card.locator('.work-timer');
    const first = await timer.textContent();
    assert.match(first, /^\d+:\d\d$/);
    await page.waitForFunction(before => document.querySelector('.work-timer')?.textContent !== before, first, { timeout: 3000 });

    // When Claude finishes, the card folds into a summary that opens to the ticked steps.
    working = false;
    await page.locator('.work:not(.live) summary').waitFor({ timeout: 10000 });
    assert.match(await page.locator('.work summary .work-title').textContent(), /^Worked for \d+ min · 3 steps$/);
    await page.click('.work summary');
    assert.equal(await page.locator('.work li.done').count(), 3);

    // Swiping a message right picks it to reply to; ✕ lets it go.
    await page.locator('.msg.owner', { hasText: 'And keep it fast' }).evaluate(el => {
      const box = el.getBoundingClientRect(), y = box.top + box.height / 2, x = box.left + 20;
      const fire = (type, dx) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerType: 'touch', isPrimary: true, button: 0, clientX: x + dx, clientY: y }));
      fire('pointerdown', 0); for (const dx of [10, 20, 40, 60, 80]) fire('pointermove', dx); fire('pointerup', 80);
    });
    assert.equal(await page.locator('.quote-bar .quote-text').textContent(), 'You: And keep it fast');
    await page.click('[aria-label="Cancel reply"]');
    assert.equal(await page.locator('.quote-bar').isHidden(), true);

    // Reply to a message (long-press → Reply): the bar shows it, and the message carries it as a quote.
    await page.locator('.msg.reply', { hasText: 'One update' }).click({ button: 'right' });
    await page.locator('.sheet-item:has-text("Reply")').click();
    assert.equal(await page.locator('.quote-bar .quote-text').textContent(), 'Claude: On it. One update with a new look.');
    await page.fill('.composer-input', 'Love it');
    await page.click('.send');
    await page.waitForFunction(() => document.querySelector('.quote-bar').hidden);
    await page.waitForFunction(() => document.querySelectorAll('.msg.owner').length === 3);
    assert.equal(sent.at(-1).body, '> On it. One update with a new look.\n\nLove it');
    assert.equal(await page.locator('.msg.owner .bubble-quote').last().textContent(), 'On it. One update with a new look.');

    // Back shrinks the chat into its row.
    await page.goBack();
    await page.locator('.page.chat-screen').waitFor({ state: 'detached' });

    assert.deepEqual(errors, []);
  });
