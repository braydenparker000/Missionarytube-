import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtempSync, rmSync, writeFileSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRelayFixture} from '../backend/tests/relay-fixture.js';

const run = promisify(execFile);
const JC = new URL('./jarvis-claude/jc.mjs', import.meta.url).pathname;

// jc (the Claude session's CLI) against the real Worker, served over local HTTP.
test('jc waits for owner messages, answers, reports status, links the session and keeps the notebook', async t => {
  const key = 'k'.repeat(48);
  const objects = new Map();
  const MUSIC_R2 = {async put(k, b, o) { objects.set(k, {bytes: new Uint8Array(b), customMetadata: o.customMetadata}); return {}; },
    async get(k) { const o = objects.get(k); return o && {size: o.bytes.length, customMetadata: o.customMetadata, body: new Response(o.bytes).body}; }};
  const fixture = createRelayFixture({env: {CLAUDE_CHAT_AGENT_KEY: key, MUSIC_R2}});
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const response = await fixture.request(req.url, {method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fixture.close?.(); });
  // jc remembers the last Stop it reported in the temp directory: a fresh one per run.
  const TMPDIR = mkdtempSync(join(tmpdir(), 'jc-test-'));
  t.after(() => rmSync(TMPDIR, {recursive: true, force: true}));
  const env = {...process.env, TMPDIR, JC_API: `http://127.0.0.1:${server.address().port}`, JC_KEY: key, CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01Test'};
  const jc = (...args) => run(process.execPath, [JC, ...args], {env, timeout: 30_000}).then(r => ({code: 0, out: r.stdout, err: r.stderr}), e => ({code: e.code, out: e.stdout, err: e.stderr}));

  // The owner's side, straight into the store.
  const {claudeChatStore, CLAUDE_CHAT_OBJECT} = await import('../backend/claude-chat.js');
  const ctx = fixture.object(CLAUDE_CHAT_OBJECT).ctx;
  const thread = crypto.randomUUID(), message = crypto.randomUUID();
  claudeChatStore(ctx, {who: 'owner', op: 'thread.create', args: {id: thread, title: 'Hi'}});
  claudeChatStore(ctx, {who: 'owner', op: 'send', args: {id: message, threadId: thread, body: 'Hello Claude'}});

  const waited = await jc('wait', '--minutes', '0.2');
  assert.equal(waited.code, 0);
  assert.deepEqual(JSON.parse(waited.out).messages.map(m => m.body), ['Hello Claude']);
  assert.equal((await jc('wait', '--minutes', '0.02')).code, 3, 'nothing more: exit 3 when the time is up');

  assert.equal((await jc('status', 'working', '--thread', thread, '--note', 'Thinking')).code, 0);
  let status = claudeChatStore(ctx, {who: 'owner', op: 'status'}).status;
  assert.deepEqual([status.state, status.note, status.sessionUrl], ['working', 'Thinking', 'https://claude.ai/code/session_01Test']);
  assert.equal((await jc('link', thread)).code, 0);
  assert.equal(claudeChatStore(ctx, {who: 'owner', op: 'threads'}).threads[0].sessionUrl, 'https://claude.ai/code/session_01Test');

  assert.equal((await jc('say', thread, '--reply-to', message, 'Hello', 'owner')).code, 0);
  const history = JSON.parse((await jc('history', thread)).out).messages;
  assert.deepEqual(history.map(m => [m.role, m.body, m.answered]), [['owner', 'Hello Claude', true], ['claude', 'Hello owner', false]]);

  // A card Claude updates in place as its pull request moves.
  const card = JSON.parse((await jc('say', thread, '--kind', 'card', '--meta', '{"url":"https://github.com/o/r/pull/9","state":"checks"}', 'Fix it')).out).message;
  assert.equal((await jc('amend', card.id, '--meta', '{"url":"https://github.com/o/r/pull/9","state":"merged"}')).code, 0);
  assert.equal(claudeChatStore(ctx, {who: 'owner', op: 'messages', args: {threadId: thread}}).messages.at(-1).meta.state, 'merged');

  // The owner taps Stop while Claude works: the next status says so on stderr.
  await jc('status', 'working', '--thread', thread, '--note', 'More work');
  assert.equal(claudeChatStore(ctx, {who: 'owner', op: 'stop', args: {threadId: thread}}).stopped, true);
  const heard = await jc('status', 'working', '--thread', thread, '--note', 'Still working');
  assert.match(heard.err, /STOP: the owner asked you to stop/);
  assert.doesNotMatch((await jc('say', thread, 'Stopped.')).err, /STOP/, 'the reply clears it');

  // Claude keeps a wait running in the background while it works: a Stop ends it at once, once.
  await jc('status', 'working', '--thread', thread, '--note', 'Another job');
  claudeChatStore(ctx, {who: 'owner', op: 'stop', args: {threadId: thread}});
  const stopped = await jc('wait', '--minutes', '0.2');
  assert.equal(stopped.code, 4);
  assert.equal(JSON.parse(stopped.out).stop.threadId, thread);
  assert.equal((await jc('wait', '--minutes', '0.02')).code, 3, 'the same Stop does not end the next wait');
  status = claudeChatStore(ctx, {who: 'owner', op: 'status'}).status;
  assert.deepEqual([status.state, status.note], ['working', 'Another job'], 'and waiting did not end the work');
  await jc('say', thread, 'Stopped.');

  // Attachments both ways: Claude sends a picture; it saves one the owner sent.
  const picture = join(TMPDIR, 'chart.png');
  writeFileSync(picture, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 9]));
  const posted = JSON.parse((await jc('say', thread, '--attach', picture, 'Here is the chart')).out).message;
  assert.deepEqual(posted.attachments.map(a => [a.name, a.type, a.size]), [['chart.png', 'image/png', 9]]);
  const saved = (await jc('file', posted.attachments[0].id)).out.trim();
  assert.deepEqual(readFileSync(saved), readFileSync(picture));
  const chosen = join(TMPDIR, 'copy.png');
  assert.equal((await jc('file', posted.attachments[0].id, '--out', chosen)).out.trim(), chosen);
  assert.notEqual((await jc('file', crypto.randomUUID())).code, 0, 'an unknown attachment is an error');

  assert.equal((await jc('notebook')).code, 0);
  const written = await new Promise(resolve => {
    const child = spawn(process.execPath, [JC, 'notebook', '--write', '-', '--version', '0'], {env, stdio: ['pipe', 'ignore', 'inherit']});
    child.on('exit', resolve);
    child.stdin.end('# Owner\n- Likes short answers\n');
  });
  assert.equal(written, 0);
  const {notebook} = JSON.parse((await jc('notebook')).out);
  assert.deepEqual([notebook.version, notebook.body, notebook.by], [1, '# Owner\n- Likes short answers', 'claude']);

  const refused = await run(process.execPath, [JC, 'wait', '--minutes', '0.05'], {env: {...env, JC_KEY: 'wrong'.repeat(10)}, timeout: 30_000}).catch(e => e);
  assert.equal(refused.code, 2, 'a refused key stops at once');
});

test('jc restarts itself through the session proxy, so the network secret is added to its requests', async () => {
  const {needsProxyRestart} = await import('./jarvis-claude/jc.mjs');
  assert.equal(needsProxyRestart({HTTPS_PROXY: 'http://proxy:8080'}), true);
  assert.equal(needsProxyRestart({https_proxy: 'http://proxy:8080'}), true);
  assert.equal(needsProxyRestart({HTTPS_PROXY: 'http://proxy:8080', NODE_USE_ENV_PROXY: '1'}), false, 'already restarted');
  assert.equal(needsProxyRestart({}), false, 'no proxy: run as is');
});

test('each take ends before the session proxy cuts a request (30 s), so no handout dies with it', async () => {
  const {TAKE_WAIT_MS} = await import('./jarvis-claude/jc.mjs');
  assert.ok(TAKE_WAIT_MS <= 25_000, 'a take the proxy cuts may already hold messages');
});
