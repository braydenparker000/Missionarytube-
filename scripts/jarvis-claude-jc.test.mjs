import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile, spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createRelayFixture} from '../backend/tests/relay-fixture.js';

const run = promisify(execFile);
const JC = new URL('./jarvis-claude/jc.mjs', import.meta.url).pathname;

// jc (the Claude session's CLI) against the real Worker, served over local HTTP.
test('jc waits for owner messages, answers, reports status, links the session and keeps the notebook', async t => {
  const key = 'k'.repeat(48);
  const fixture = createRelayFixture({env: {CLAUDE_CHAT_AGENT_KEY: key}});
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const response = await fixture.request(req.url, {method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined});
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); fixture.close?.(); });
  const env = {...process.env, JC_API: `http://127.0.0.1:${server.address().port}`, JC_KEY: key, CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01Test'};
  const jc = (...args) => run(process.execPath, [JC, ...args], {env, timeout: 30_000}).then(r => ({code: 0, out: r.stdout}), e => ({code: e.code, out: e.stdout, err: e.stderr}));

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
