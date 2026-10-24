import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {claudeChatStore, nextChange, fireClaude, recordWake, claudeKeyMatches, ChatError, LEASE_WAIT_MS, LEASE_WORK_MS, WAKE_BACKOFF_MS, STRANDED_MS} from '../claude-chat.js';

function store() {
  const db = new DatabaseSync(':memory:');
  let n = 0;
  const ctx = {storage: {
    sql: {exec: (q, ...v) => db.prepare(q).all(...v)},
    transactionSync(fn) { const s = `s${++n}`; db.exec(`SAVEPOINT ${s}`); try { const r = fn(); db.exec(`RELEASE ${s}`); return r; } catch (e) { db.exec(`ROLLBACK TO ${s}; RELEASE ${s}`); throw e; } },
  }};
  const call = (who, op, args = {}, now = 1_000_000) => claudeChatStore(ctx, {who, op, args}, now);
  call.ctx = ctx;
  return call;
}
const T = '11111111-1111-4111-8111-111111111111';
const M = i => `22222222-2222-4222-8222-${String(i).padStart(12, '0')}`;
const R = i => `33333333-3333-4333-8333-${String(i).padStart(12, '0')}`;

test('a thread and its messages: sends are idempotent, replies settle what came before', () => {
  const call = store();
  call('owner', 'thread.create', {id: T, title: 'Plans'});
  const first = call('owner', 'send', {id: M(1), threadId: T, body: 'hi Claude'});
  assert.equal(first.wake, true, 'nobody listening: wake Claude');
  assert.equal(call('owner', 'send', {id: M(1), threadId: T, body: 'hi Claude'}).wake, false, 'a retried send neither doubles nor wakes again');
  assert.throws(() => call('owner', 'send', {id: M(1), threadId: T, body: 'different'}), e => e instanceof ChatError && e.status === 409);
  call('claude', 'post', {id: R(1), threadId: T, kind: 'progress', body: 'looking…'});
  assert.equal(call('owner', 'messages', {threadId: T}).messages[0].answered, false, 'a progress note is not an answer');
  call('claude', 'post', {id: R(2), threadId: T, body: 'hello!', replyTo: M(1)});
  const {messages} = call('owner', 'messages', {threadId: T});
  assert.deepEqual(messages.map(m => [m.role, m.kind, m.body]), [['owner', 'text', 'hi Claude'], ['claude', 'progress', 'looking…'], ['claude', 'text', 'hello!']]);
  assert.equal(messages[0].answered, true);
  const list = call('owner', 'threads').threads;
  assert.deepEqual(list.map(t => [t.title, t.last.role, t.last.body]), [['Plans', 'claude', 'hello!']]);
});

test('the owner can stop Claude mid-work; Claude hears it on its next post or status, and its answer clears it', () => {
  const call = store();
  call('owner', 'thread.create', {id: T});
  call('owner', 'send', {id: M(1), threadId: T, body: 'refactor everything'});
  assert.equal(call('owner', 'stop', {threadId: T}).stopped, false, 'nobody working: nothing to stop');
  call('claude', 'take', {}, 1_000_100);
  call('claude', 'status', {state: 'working', threadId: T, note: 'Refactoring'}, 1_000_200);
  const asked = call('owner', 'stop', {threadId: T}, 1_000_300);
  assert.equal(asked.stopped, true);
  assert.equal(asked.status.stopRequested, T, 'the page can show "Stopping…"');
  assert.deepEqual(call('claude', 'post', {id: R(1), threadId: T, kind: 'progress', body: 'step 2'}, 1_000_400).stop, {threadId: T, at: 1_000_300}, 'a progress post tells Claude');
  assert.equal(call('claude', 'status', {state: 'working', threadId: T, note: 'Still going'}, 1_000_500).stop.threadId, T, 'and so does a status renewal');
  assert.equal(call('claude', 'post', {id: R(2), threadId: T, body: 'Stopped. Nothing was pushed.'}, 1_000_600).stop, null, 'the final answer clears it');
  assert.equal(call('owner', 'status', {}, 1_000_700).status.stopRequested, null);
});

test('Claude amends its own posts in place (a card moving from checks running to merged); never the owner\'s', () => {
  const call = store();
  call('owner', 'thread.create', {id: T});
  call('owner', 'send', {id: M(1), threadId: T, body: 'fix it'});
  call('claude', 'post', {id: R(1), threadId: T, kind: 'card', body: 'Fix podcast search', meta: {url: 'https://github.com/o/r/pull/9', state: 'checks'}});
  const {head} = call('owner', 'changes', {after: 0});
  const amended = call('claude', 'amend', {id: R(1), meta: {url: 'https://github.com/o/r/pull/9', state: 'merged'}}).message;
  assert.equal(amended.meta.state, 'merged');
  assert.equal(amended.body, 'Fix podcast search', 'an absent body is kept');
  assert.deepEqual(call('owner', 'changes', {after: head}).messages.map(m => [m.id, m.meta.state]), [[R(1), 'merged']], 'the page hears the change');
  assert.throws(() => call('claude', 'amend', {id: M(1), body: 'rewritten'}), e => e.status === 404, 'not the owner\'s messages');
  assert.throws(() => call('owner', 'amend', {id: R(1), body: 'x'}), e => e.status === 403);
});

test('roles are enforced: Claude cannot send as the owner or start threads; the owner cannot take or post', () => {
  const call = store();
  call('owner', 'thread.create', {id: T});
  for (const [who, op] of [['claude', 'send'], ['claude', 'thread.create'], ['owner', 'take'], ['owner', 'post']])
    assert.throws(() => call(who, op, {id: M(9), threadId: T, body: 'x'}), e => e.status === 403, `${who} ${op}`);
  assert.throws(() => call('stranger', 'threads'), e => e.status === 403);
});

test('the listener lease: taking holds it, working holds it longer, and while it holds no wake is fired', () => {
  const call = store();
  call('owner', 'thread.create', {id: T});
  const t0 = 1_000_000;
  const taken = call('claude', 'take', {sessionUrl: 'https://claude.ai/code/session_01Abc'}, t0);
  assert.deepEqual(taken.messages, []);
  assert.equal(call('owner', 'send', {id: M(1), threadId: T, body: 'one'}, t0 + 1000).wake, false, 'listening: no fire');
  assert.deepEqual(call('claude', 'take', {}, t0 + 2000).messages.map(m => m.body), ['one']);
  assert.deepEqual(call('claude', 'take', {}, t0 + 3000).messages, [], 'a taken message is not handed out twice');
  call('claude', 'status', {state: 'working', threadId: T, note: 'reading code'}, t0 + 4000);
  const status = call('owner', 'status', {}, t0 + 4000 + LEASE_WAIT_MS + 1).status;
  assert.equal(status.alive, true, 'working outlives a long-poll lease');
  assert.equal(status.state, 'working');
  assert.equal(status.note, 'reading code');
  assert.equal(status.sessionUrl, 'https://claude.ai/code/session_01Abc');
  assert.equal(call('owner', 'status', {}, t0 + 4000 + LEASE_WORK_MS + 1).status.alive, false, 'and still expires');
  call('claude', 'status', {state: 'stopping'}, t0 + 5000);
  assert.equal(call('owner', 'status', {}, t0 + 5001).status.alive, false, 'stopping lets go at once');
});

test('wake backoff: one fire per window; a message stranded by a dead session is handed out again', () => {
  const call = store();
  call('owner', 'thread.create', {id: T});
  const t0 = 2_000_000;
  assert.equal(call('owner', 'send', {id: M(1), threadId: T, body: 'a'}, t0).wake, true);
  recordWake(call.ctx, t0, {ok: true, sessionUrl: 'https://claude.ai/code/session_01F'});
  assert.equal(call('owner', 'status', {}, t0 + 1).status.wake.starting, true, 'the page can say Claude is starting');
  assert.equal(call('owner', 'send', {id: M(2), threadId: T, body: 'b'}, t0 + 1000).wake, false, 'inside the backoff: no second fire');
  assert.equal(call('owner', 'send', {id: M(3), threadId: T, body: 'c'}, t0 + WAKE_BACKOFF_MS).wake, true, 'the fired session never showed up: try again');
  // A session takes the three, then dies without answering.
  assert.equal(call('claude', 'take', {}, t0 + WAKE_BACKOFF_MS + 1).messages.length, 3);
  call('claude', 'status', {state: 'stopping'}, t0 + WAKE_BACKOFF_MS + 2);
  const later = t0 + WAKE_BACKOFF_MS + 1 + STRANDED_MS + 1;
  assert.equal(call('owner', 'send', {id: M(4), threadId: T, body: 'd'}, later).wake, true);
  assert.deepEqual(call('claude', 'take', {}, later + 1).messages.map(m => m.body), ['a', 'b', 'c', 'd'], 'stranded messages come back, in order');
});

test('changes feed: everything after a sequence number, with the status', () => {
  const call = store();
  call('owner', 'thread.create', {id: T});
  const start = call('owner', 'changes', {after: 0});
  call('owner', 'send', {id: M(1), threadId: T, body: 'q'});
  call('claude', 'post', {id: R(1), threadId: T, body: 'a'});
  const feed = call('owner', 'changes', {after: start.head});
  assert.deepEqual(feed.messages.map(m => m.body), ['q', 'a']);
  assert.equal(call('owner', 'changes', {after: feed.head}).messages.length, 0);
});

test('notebook: versioned edits; a stale edit is refused', () => {
  const call = store();
  assert.equal(call('owner', 'notebook').notebook.version, 0);
  const v1 = call('claude', 'notebook', {body: 'Brayden prefers short replies.', version: 0}).notebook;
  assert.equal(v1.version, 1);
  assert.throws(() => call('owner', 'notebook', {body: 'stale', version: 0}), e => e.status === 409);
  assert.equal(call('owner', 'notebook', {body: 'edited', version: 1}).notebook.body, 'edited');
});

test('session links are only claude.ai/code sessions', () => {
  const call = store();
  call('owner', 'thread.create', {id: T});
  assert.throws(() => call('claude', 'thread.update', {id: T, sessionUrl: 'https://evil.example/code/session_1'}), e => e.status === 400);
  assert.equal(call('claude', 'thread.update', {id: T, sessionUrl: 'https://claude.ai/code/session_01X?x=1'}).thread.sessionUrl, 'https://claude.ai/code/session_01X');
});

test('long poll: a reader parked on the store wakes on the next change', async () => {
  const db = new DatabaseSync(':memory:');
  const ctx = {storage: {sql: {exec: (q, ...v) => db.prepare(q).all(...v)}, transactionSync: fn => fn()}};
  claudeChatStore(ctx, {who: 'owner', op: 'thread.create', args: {id: T}});
  const started = Date.now();
  const parked = nextChange(ctx, 5000);
  setTimeout(() => claudeChatStore(ctx, {who: 'owner', op: 'send', args: {id: M(1), threadId: T, body: 'ping'}}), 50);
  await parked;
  assert.ok(Date.now() - started < 2000, 'woke on the change, not the deadline');
});

test('firing the scheduled task: only ids travel, and failures are reported, not thrown', async () => {
  const env = {CLAUDE_ROUTINE_FIRE_URL: 'https://api.anthropic.com/v1/claude_code/routines/trig_X/fire', CLAUDE_ROUTINE_TOKEN: 'tok'};
  let seen;
  const ok = await fireClaude(env, {threadId: T, messageId: M(1)}, async (url, init) => { seen = {url, init}; return Response.json({type: 'routine_fire', claude_code_session_url: 'https://claude.ai/code/session_01Y'}); });
  assert.deepEqual(ok, {ok: true, sessionUrl: 'https://claude.ai/code/session_01Y'});
  assert.equal(seen.init.headers.Authorization, 'Bearer tok');
  assert.equal(seen.init.headers['anthropic-beta'], 'experimental-cc-routine-2026-04-01');
  assert.match(JSON.parse(seen.init.body).text, new RegExp(M(1)));
  assert.doesNotMatch(seen.init.body, /hi Claude/);
  assert.deepEqual(await fireClaude({}, {threadId: T, messageId: M(1)}), {ok: false, error: 'not_configured'});
  assert.deepEqual(await fireClaude(env, {threadId: T, messageId: M(1)}, async () => new Response('no', {status: 401})), {ok: false, error: 'http_401'});
  assert.deepEqual(await fireClaude(env, {threadId: T, messageId: M(1)}, async () => { throw new TypeError('down'); }), {ok: false, error: 'network'});
});

test('Claude key check is exact and needs a real secret', () => {
  const key = 'k'.repeat(40);
  assert.equal(claudeKeyMatches({CLAUDE_CHAT_AGENT_KEY: key}, key), true);
  assert.equal(claudeKeyMatches({CLAUDE_CHAT_AGENT_KEY: key}, key + 'x'), false);
  assert.equal(claudeKeyMatches({CLAUDE_CHAT_AGENT_KEY: 'short'}, 'short'), false);
  assert.equal(claudeKeyMatches({}, undefined), false);
});


test('over HTTP: the signed-in owner chats, Claude takes and replies with its key, strangers are refused, and a send with nobody listening fires the task', async t => {
  const {createConversationFixture} = await import('./helpers/relay-conversation-browser-fixture.js');
  const {PRIMARY_SITE} = await import('../origins.js');
  const key = 'k'.repeat(48);
  const fired = [];
  const h = createConversationFixture(t, {env: {CLAUDE_CHAT_AGENT_KEY: key, CLAUDE_ROUTINE_FIRE_URL: 'https://api.anthropic.com/v1/claude_code/routines/trig_T/fire', CLAUDE_ROUTINE_TOKEN: 'routine-token'}});
  t.after(() => h.close());
  // The fixture blocks the network; let only the routine fire through, recorded.
  const blocked = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith('https://api.anthropic.com/')) { fired.push(JSON.parse(init.body)); return Response.json({type: 'routine_fire', claude_code_session_url: 'https://claude.ai/code/session_01Fired'}); }
    return blocked(url, init);
  };
  t.after(() => { globalThis.fetch = blocked; });
  const owner = await h.pair(await h.oauth());
  const asOwner = (op, args, token = owner.device_token, origin = PRIMARY_SITE) => h.fixture.request('/claude-chat/owner', {method: 'POST', headers: {Origin: origin, 'Content-Type': 'application/json', ...(token ? {Authorization: 'Bearer ' + token} : {})}, body: JSON.stringify({op, args})});
  const asClaude = (op, args, credential = key) => h.fixture.request('/claude-chat/agent', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + credential}, body: JSON.stringify({op, args})});

  assert.equal((await asOwner('threads', {}, null)).status, 401, 'signed out');
  assert.equal((await asOwner('threads', {}, 'f'.repeat(64))).status, 401, 'an unknown device');
  assert.equal((await asOwner('threads', {}, owner.device_token, 'https://evil.example')).status, 403, 'another site');
  assert.equal((await asClaude('threads', {}, 'nope'.repeat(10))).status, 401, 'a wrong key');
  assert.equal((await asClaude('send', {})).status, 400, 'Claude cannot use owner operations');

  const thread = crypto.randomUUID();
  assert.equal((await asOwner('thread.create', {id: thread, title: 'Hello'})).status, 200);
  const sent = await (await asOwner('send', {id: crypto.randomUUID(), threadId: thread, body: 'Are you there?'})).json();
  assert.equal(sent.status.wake.ok, true, 'nobody listening: the task was fired');
  assert.equal(fired.length, 1);
  assert.doesNotMatch(fired[0].text, /Are you there/, 'only ids travel to Anthropic');

  // The fired session takes the message, says it is working, and answers.
  const taken = await (await asClaude('take', {wait: 0})).json();
  assert.deepEqual(taken.messages.map(m => m.body), ['Are you there?']);
  await asClaude('status', {state: 'working', threadId: thread, note: 'thinking'});
  // A second owner message while it works does not fire again.
  const second = await (await asOwner('send', {id: crypto.randomUUID(), threadId: thread, body: 'And another'})).json();
  assert.equal(second.wake, false);
  assert.equal(fired.length, 1);
  const reply = await asClaude('post', {id: crypto.randomUUID(), threadId: thread, body: 'Yes — here.', replyTo: taken.messages[0].id});
  assert.equal(reply.status, 200);

  // The owner's live feed: a parked request returns as soon as Claude posts.
  const {head} = await (await asOwner('changes', {after: 0})).json();
  const parked = asOwner('changes', {after: head, wait: 5000});
  setTimeout(() => asClaude('post', {id: crypto.randomUUID(), threadId: thread, kind: 'progress', body: 'Reading the repo…'}), 50);
  const live = await (await parked).json();
  assert.deepEqual(live.messages.map(m => m.body), ['Reading the repo…']);
  assert.equal(live.status.state, 'working');
});
