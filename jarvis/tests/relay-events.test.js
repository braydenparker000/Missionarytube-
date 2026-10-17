import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHmac} from 'node:crypto';
import worker, {Hub} from '../backend/worker.js';
import {sharedStore, SHARED_OBJECT, PUBLIC_KEY} from '../backend/shared.js';
import {relaySubscribe, relayUnsubscribe, drainRelayOutbox, scheduleRelayAlarm, webhookTransport, EVENT_RETENTION_MS, relayEventSchema,enqueueRelayMessage} from '../backend/relay-events.js';
import {relayOAuthStore} from '../backend/relay-oauth.js';
import {RELAY_OWNER, RELAY_INBOX, RELAY_EVENT, RELAY_CALLBACK, RELAY_VERSION, hash, challenge, random, RelayError} from '../backend/relay-common.js';
const BASE = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const secret = () => 'whsec_' + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
function setup() {
  const objects = new Map(), env = {RELAY_MCP_ENABLED: 'true', HUBS: {idFromName: x => x, get(name) {
    if (!objects.has(name)) {
      const db = new DatabaseSync(':memory:'), values = new Map(); let alarm = null;
      const storage = {sql: {exec(q, ...v) { const s = db.prepare(q); if (s.columns().length) return s.all(...v); s.run(...v); return []; }},
        async get(k) {return structuredClone(values.get(k));}, async put(k, v) {values.set(k, structuredClone(v));}, async transaction(fn) {return fn(storage);},
        transactionSync(fn) {db.exec('BEGIN'); try {const r = fn(); db.exec('COMMIT'); return r;} catch (e) {db.exec('ROLLBACK'); throw e;}},
        async setAlarm(t) {alarm = t;}, async deleteAlarm() {alarm = null;}, async getAlarm() {return alarm;}};
      objects.set(name, new Hub({storage}, env, {publicationFetcher:async()=>Response.json([])}));
    }
    return objects.get(name);
  }}};
  const ctx = env.HUBS.get(SHARED_OBJECT).ctx;
  const rows = (q, ...v) => [...ctx.storage.sql.exec(q, ...v)];
  const request = (path, body, headers = {}, method) => worker.fetch(new Request(BASE + path, {method: method || (body === undefined ? 'GET' : 'POST'), headers: {'Content-Type': 'application/json', ...headers}, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body)}), env);
  const add = async (text = 'Hello', id = crypto.randomUUID()) => { const result = await request('/shared/messages', {id, body: text}); assert.equal(result.status, 201); return {id, body: text}; };
  const rpc = (method, p = {}, token, headers = {}) => request('/relay/mcp', {jsonrpc: '2.0', id: 1, method, params: {...p, _meta: {'io.modelcontextprotocol/protocolVersion': RELAY_VERSION, 'io.modelcontextprotocol/clientCapabilities': {}, 'io.modelcontextprotocol/clientInfo': {name: 'relay-test', version: '1'}}}}, {'Authorization': 'Bearer ' + token, Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': RELAY_VERSION, 'Mcp-Method': method, ...(method === 'tools/call' ? {'Mcp-Name': p.name} : {}), ...headers});
  return {env, ctx, rows, request, add, rpc};
}
async function grant(s, scope = 'relay:read relay:reply relay:events') {
  const ctx = s.env.HUBS.get(SHARED_OBJECT).ctx, client = random(), grantId = random(), verifier = random(), code = random(), access = random(), refresh = random();
  const run = b => relayOAuthStore(ctx, b).json();
  await run({op: 'put', key: 'client:' + client, category: 'client', value: {redirect: RELAY_CALLBACK}, expiresAt: Date.now() + 600000});
  const params = {client_id: client, redirect_uri: RELAY_CALLBACK, code_challenge: await challenge(verifier), scope};
  await run({op: 'authorize', grantId, codeKey: 'code:' + await hash(code), params, resource: BASE + '/relay/mcp'});
  await run({op: 'exchange', key: 'code:' + await hash(code), match: {client_id: client, redirect_uri: RELAY_CALLBACK, challenge: params.code_challenge, resource: BASE + '/relay/mcp'}, accessKey: 'access:' + await hash(access), refreshKey: 'refresh:' + await hash(refresh)});
  return {principal: RELAY_OWNER, grantId, scopes: scope.split(' '), access, refresh, client, registry: run};
}
const params = (key = secret(), extra = {}) => ({name: RELAY_EVENT, arguments: {inbox_id: RELAY_INBOX}, delivery: {mode: 'webhook', url: 'https://receiver.example/callback', secret: key}, cursor: null, ...extra});
function receiver(key, outputs = []) {
  const calls = [];
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://receiver.example/callback'); assert.equal(options.redirect, 'error');
    const signed = options.headers, expected = createHmac('sha256', Buffer.from(key.slice(6), 'base64')).update(`${signed['webhook-id']}.${signed['webhook-timestamp']}.${options.body}`).digest('base64');
    assert.ok(signed['webhook-signature'].split(' ').includes('v1,' + expected));
    calls.push({url, ...options});
    const payload = JSON.parse(options.body);
    if (payload.type === 'verification') return Response.json({challenge: payload.challenge});
    const output = outputs.shift(); if (output instanceof Error) throw output;
    const status = output || 204;
    return new Response([204, 205, 304].includes(status) ? null : '', {status});
  };
  return {fetcher, calls};
}
test('disabled connector and the public browser key cannot authenticate the new endpoint', async () => {
  const s = setup(); s.env.RELAY_MCP_ENABLED = 'false'; assert.equal((await s.request('/relay/mcp')).status, 503);
  s.env.RELAY_MCP_ENABLED = 'true';
  const r = await s.rpc('server/discover', {}, PUBLIC_KEY); assert.equal(r.status, 401); assert.match(r.headers.get('WWW-Authenticate'), /oauth-protected-resource\/relay\/mcp/);
  assert.equal((await s.request('/internal/relay/rpc', {})).status, 404);
});
test('MCP 2.0 discovery, scoped catalogs, header/body version validation and no legacy handshake', async () => {
  const s = setup(), auth = await grant(s);
  const discovery = await (await s.rpc('server/discover', {}, auth.access)).json();
  assert.equal(discovery.result.resultType, 'complete'); assert.deepEqual(discovery.result.supportedVersions, [RELAY_VERSION]); assert.ok(discovery.result.capabilities.events);
  const listed = await (await s.rpc('tools/list', {}, auth.access)).json(); assert.deepEqual(listed.result.tools.map(x => x.name), ['relay_list_pending', 'relay_read_conversation', 'relay_reply', 'relay_event_access_status']); assert.ok(listed.result.tools.every(x => x.outputSchema && x.securitySchemes));
  const events = await (await s.rpc('events/list', {}, auth.access)).json(); assert.equal(events.result.events[0].name, RELAY_EVENT);
  const mismatch = await s.rpc('tools/list', {}, auth.access, {'MCP-Protocol-Version': '2025-03-26'}); assert.equal(mismatch.status, 400); assert.equal((await mismatch.json()).error.code, -32020);
  const header = await s.rpc('tools/call', {name: 'relay_list_pending', arguments: {inbox_id: RELAY_INBOX}}, auth.access, {'Mcp-Name': 'relay_reply'}); assert.equal((await header.json()).error.code, -32020);
  assert.equal((await s.rpc('initialize', {}, auth.access)).status, 404);
  const narrow = await grant(s, 'relay:read'); const catalog = await (await s.rpc('tools/list', {}, narrow.access)).json(); assert.equal(catalog.result.tools.length, 3);
  assert.deepEqual((await (await s.rpc('events/list', {}, narrow.access)).json()).result.events, []);
});
test('direct tools read the actual shared store and reply once without GitHub import or loops', async () => {
  const s = setup(), auth = await grant(s), first = await s.add('Earlier context'), message = await s.add('Please answer');
  const call = (name, arguments_) => s.rpc('tools/call', {name, arguments: {inbox_id: RELAY_INBOX, ...arguments_}}, auth.access).then(r => r.json());
  assert.equal((await call('relay_list_pending', {limit: 1})).result.structuredContent.messages[0].id, first.id);
  const context = (await call('relay_read_conversation', {message_id: message.id})).result.structuredContent; assert.equal(context.message.body, message.body); assert.equal(context.context.at(-1).id, first.id); assert.equal(context.author_authenticated, false);
  const reply = {message_id: message.id, body: 'A real direct reply'};
  const results = await Promise.all([call('relay_reply', reply), call('relay_reply', reply)]); assert.ok(results.every(x => !x.result.isError));
  assert.equal(s.rows("SELECT COUNT(*) AS n FROM shared_entries WHERE reply_to=?", message.id)[0].n, 1);
  assert.equal((await call('relay_reply', {...reply, body: 'Conflicting reply'})).result.structuredContent, undefined);
  assert.equal((await call('relay_reply', {...reply, body: 'Conflicting reply'})).result.isError, true);
  assert.equal((await call('relay_list_pending', {})).result.structuredContent.messages.length, 1);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_events')[0].n, 2);
  const publicState = await (await sharedStore(s.ctx, '/internal/shared/state')).json(); assert.equal(publicState.messages.find(x => x.replyTo === message.id).body, reply.body);
});
test('tools reject another inbox, missing/extra fields, malformed IDs, invalid cursors and unauthorized scopes', async () => {
  const s = setup(), auth = await grant(s, 'relay:read');
  const call = (name, args) => s.rpc('tools/call', {name, arguments: args}, auth.access).then(r => r.json());
  assert.equal((await call('relay_list_pending', {inbox_id: 'somebody-else'})).error.code, -32012);
  for (const args of [{}, {inbox_id: RELAY_INBOX, extra: 1}, {inbox_id: RELAY_INBOX, cursor: '-1'}, {inbox_id: RELAY_INBOX, limit: 51}]) assert.equal((await call('relay_list_pending', args)).error.code, -32602);
  assert.equal((await call('relay_read_conversation', {inbox_id: RELAY_INBOX, message_id: 'bad'})).error.code, -32602);
  assert.equal((await call('relay_reply', {inbox_id: RELAY_INBOX, message_id: crypto.randomUUID(), body: 'No scope'})).error.code, -32012);
});
test('signed challenge activates durable subscription; duplicate submissions/imports/replies never emit', async () => {
  const s = setup(), auth = await grant(s), key = secret(), r = receiver(key), p = params(key);
  const subscription = await relaySubscribe(s.ctx, auth, p, s.env, r.fetcher); assert.match(subscription.id, /^sub_/); assert.equal(subscription.cursor, 'relay1:0'); assert.equal(r.calls.length, 1);
  const m = await s.add('Inbound'); assert.equal((await s.request('/shared/messages', m)).status, 200);
  sharedStore(s.ctx, '/internal/shared/import', {messages: [{id: crypto.randomUUID(), role: 'user', body: 'Migrated'}]});
  sharedStore(s.ctx, '/internal/shared/briefing', {id: crypto.randomUUID(), title: 'Other module', body: 'No event'});
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_events')[0].n, 1); assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n, 1);
  await drainRelayOutbox(s.ctx, s.env, r.fetcher); const payload = JSON.parse(r.calls.at(-1).body);
  assert.equal(payload.eventId, 'relay_msg_' + m.id); assert.equal(payload.data.author_authenticated, false); assert.equal(payload.cursor, 'relay1:1');
  assert.equal(s.rows('SELECT status FROM relay_outbox')[0].status, 'delivered'); assert.equal(s.rows('SELECT ack_seq FROM relay_subscriptions')[0].ack_seq, 1);
});
test('callback verification failure and malformed subscription never store secrets or activate delivery', async () => {
  const s = setup(), auth = await grant(s), p = params();
  await assert.rejects(relaySubscribe(s.ctx, auth, p, s.env, async () => Response.json({challenge: 'wrong'})), e => e.code === -32015 && e.data.reason === 'challenge_failed');
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n, 0);
  for (const bad of [{...p, name: 'unknown'}, {...p, arguments: {inbox_id: 'wrong'}}, {...p, delivery: {...p.delivery, secret: 'whsec_bad'}}, {...p, delivery: {...p.delivery, url: 'http://localhost/callback'}}, {...p, delivery: {...p.delivery, mode: 'poll'}}, {...p, cursor: 'bad'}, {...p, ttlMs: 0}, {...p, maxAgeMs: -1}]) await assert.rejects(relaySubscribe(s.ctx, auth, bad, s.env, async () => {throw Error('Should not reach network');}), RelayError);
  await assert.rejects(relaySubscribe(s.ctx, {...auth, principal: 'other'}, p, s.env, async () => Response.json({})), e => e.code === -32012);
  await assert.rejects(relaySubscribe(s.ctx, auth, p, s.env, null), e => e.code === -32014);
});
test('filter matching uses full message text; unmatched events are never delivered', async () => {
  const s = setup(), auth = await grant(s), key = secret(), r = receiver(key), p = params(key, {arguments: {message_contains: 'important', inbox_id: RELAY_INBOX}});
  const sub = await relaySubscribe(s.ctx, auth, p, s.env, r.fetcher);
  const same = await relaySubscribe(s.ctx, auth, {...p, arguments: {inbox_id: RELAY_INBOX, message_contains: 'important'}}, s.env, r.fetcher); assert.equal(sub.id, same.id); assert.equal(r.calls.length, 1);
  await s.add('Does not match'); const match = await s.add('x'.repeat(300) + ' IMPORTANT');
  await drainRelayOutbox(s.ctx, s.env, r.fetcher); assert.equal(r.calls.length, 2); assert.equal(JSON.parse(r.calls.at(-1).body).data.message_id, match.id);
});
test('retry preserves event ID/body, refresh does not skip pending cursor, and accepted 204 stops retry', async tc => {
  const fixedNow = Date.now(); tc.mock.method(Date, 'now', () => fixedNow);
  const s = setup(), auth = await grant(s), key = secret(), r = receiver(key, [503, 204]), p = params(key), t = Date.now();
  await relaySubscribe(s.ctx, auth, p, s.env, r.fetcher, t); await s.add(); await drainRelayOutbox(s.ctx, s.env, r.fetcher, t + 50);
  const first = r.calls.at(-1); assert.equal(s.rows('SELECT attempts FROM relay_outbox')[0].attempts, 1);
  const renewed = await relaySubscribe(s.ctx, auth, {...p, cursor: 'relay1:1'}, s.env, r.fetcher, t + 100);
  assert.equal(renewed.cursor, 'relay1:0');
  await drainRelayOutbox(s.ctx, s.env, r.fetcher, t + 2000); const second = r.calls.at(-1);
  assert.equal(first.body, second.body); assert.equal(first.headers['webhook-id'], second.headers['webhook-id']); assert.notEqual(first.headers['webhook-timestamp'], second.headers['webhook-timestamp']);
  const count = r.calls.length; await drainRelayOutbox(s.ctx, s.env, r.fetcher, t + 10000); assert.equal(r.calls.length, count);
});
test('FIFO head backoff controls alarms while later queued occurrences remain due and recover in order',async t=>{
  const now=Date.now();t.mock.method(Date,'now',()=>now);
  const s=setup(),auth=await grant(s),key=secret(),r=receiver(key,[503,204,204]);
  await relaySubscribe(s.ctx,auth,params(key),s.env,r.fetcher,now);
  const first=await s.add('Fictional deferred head'),second=await s.add('Fictional later occurrence');
  await drainRelayOutbox(s.ctx,s.env,r.fetcher,now+50);
  const head=s.rows("SELECT * FROM relay_outbox WHERE status='pending' ORDER BY event_seq")[0];
  assert.equal(head.attempts,1);assert.equal(head.next_attempt_ms,now+1050);
  assert.equal(await s.ctx.storage.getAlarm(),head.next_attempt_ms,'Do not wake at 50ms for a later blocked item');
  await drainRelayOutbox(s.ctx,s.env,r.fetcher,now+100);
  assert.equal(r.calls.length,2,'An early wake cannot deliver the head or skip to its successor');
  assert.equal(await s.ctx.storage.getAlarm(),head.next_attempt_ms);
  await drainRelayOutbox(s.ctx,s.env,r.fetcher,head.next_attempt_ms);
  assert.equal(s.rows('SELECT ack_seq FROM relay_subscriptions')[0].ack_seq,1);
  assert.equal(await s.ctx.storage.getAlarm(),head.next_attempt_ms+50,'An eligible next occurrence still gets an immediate wake');
  await drainRelayOutbox(s.ctx,s.env,r.fetcher,head.next_attempt_ms+50);
  assert.deepEqual(r.calls.slice(1).map(call=>JSON.parse(call.body).data.message_id),[first.id,first.id,second.id]);
  assert.equal(r.calls[1].body,r.calls[2].body,'Head retry preserves its exact occurrence');
  assert.equal(s.rows('SELECT ack_seq FROM relay_subscriptions')[0].ack_seq,2);
  assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_outbox WHERE status='delivered'")[0].n,2);
});
test('failed FIFO head blocks later pending alarm time without deleting queued recovery work',async t=>{
  const now=Date.now();t.mock.method(Date,'now',()=>now);
  const s=setup(),auth=await grant(s),key=secret(),r=receiver(key);await relaySubscribe(s.ctx,auth,params(key),s.env,r.fetcher,now);
  await s.add('Fictional failed head');await s.add('Fictional blocked successor');
  s.ctx.storage.sql.exec("UPDATE relay_outbox SET status='failed' WHERE event_seq=1");
  await scheduleRelayAlarm(s.ctx,now);
  assert.ok(await s.ctx.storage.getAlarm()>now+60000,'A blocked successor cannot generate a 50ms wake loop');
  assert.deepEqual(s.rows('SELECT event_seq,status FROM relay_outbox ORDER BY event_seq').map(row=>[row.event_seq,row.status]),[[1,'failed'],[2,'pending']]);
});
test('expiration/null TTL, secret rotation, unsubscribe cleanup and account revocation', async testContext => {
  const clock=Date.now();testContext.mock.method(Date,'now',()=>clock);
  const s = setup(), auth = await grant(s), old = secret(), next = secret(), r = receiver(next), t = Date.now(), oldReceiver = receiver(old), p = params(old, {ttlMs: 5000});
  const sub = await relaySubscribe(s.ctx, auth, p, s.env, oldReceiver.fetcher, t); assert.equal(new Date(sub.refreshBefore).getTime(), t + 5000);
  const renewed = await relaySubscribe(s.ctx, auth, params(next, {ttlMs: null}), s.env, r.fetcher, t + 100); assert.notEqual(renewed.refreshBefore, null);
  await s.add(); await drainRelayOutbox(s.ctx, s.env, r.fetcher, t + 1000); assert.equal(r.calls.at(-1).headers['webhook-signature'].split(' ').length, 2);
  const stopping = {name: p.name, arguments: p.arguments, delivery: {mode: 'webhook', url: p.delivery.url}};
  await relayUnsubscribe(s.ctx, auth, stopping); await relayUnsubscribe(s.ctx, auth, stopping); assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n, 0); assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n, 0);
  await relaySubscribe(s.ctx, auth, params(next, {ttlMs: 100}), s.env, r.fetcher, t); await drainRelayOutbox(s.ctx, s.env, r.fetcher, t + 101); assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n, 0);
  await relaySubscribe(s.ctx, auth, params(next), s.env, r.fetcher, t); await auth.registry({op: 'revoke', tokenHash: await hash(auth.access), client_id: auth.client}); await drainRelayOutbox(s.ctx, s.env, r.fetcher, t + 200); assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n, 0);
  assert.equal((await s.rpc('tools/list', {}, auth.access)).status, 401);
});
test('410 unsubscribes; 413 and permanent 4xx never retry; transient attempts are bounded', async () => {
  for (const status of [410, 413, 400]) {
    const s = setup(), auth = await grant(s), key = secret(), r = receiver(key, [status]), t = Date.now(); await relaySubscribe(s.ctx, auth, params(key), s.env, r.fetcher, t); await s.add();
    await drainRelayOutbox(s.ctx, s.env, r.fetcher, t); await drainRelayOutbox(s.ctx, s.env, r.fetcher, t + 100000);
    assert.equal(r.calls.length, 2); assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n, status === 410 ? 0 : 1);
  }
  const s = setup(), auth = await grant(s), key = secret(), r = receiver(key, Array(10).fill(503)), t = Date.now(); await relaySubscribe(s.ctx, auth, params(key), s.env, r.fetcher, t); await s.add();
  for (let i = 0; i < 10; i++) await drainRelayOutbox(s.ctx, s.env, r.fetcher, t + i * 100000);
  assert.equal(r.calls.length, 7); assert.equal(s.rows('SELECT attempts,status FROM relay_outbox')[0].attempts, 6); assert.equal(s.rows('SELECT state FROM relay_subscriptions')[0].state, 'delivery_failed');
});
test('journal replays after object restart, retains stable event IDs, and reports truncated expired history', async () => {
  const s = setup(), auth = await grant(s), key = secret(), r = receiver(key), t = Date.now(); const m = await s.add('Before subscribe');
  const sub = await relaySubscribe(s.ctx, auth, params(key, {cursor: 'relay1:0'}), s.env, r.fetcher, t); assert.equal(sub.truncated, false);
  const restored = new Hub(s.ctx, s.env); await drainRelayOutbox(restored.ctx, s.env, r.fetcher, t + 100); assert.equal(JSON.parse(r.calls.at(-1).body).eventId, 'relay_msg_' + m.id);
  await drainRelayOutbox(s.ctx, s.env, r.fetcher, t + EVENT_RETENTION_MS + 1000);
  // Use a renewed fixture grant because OAuth has a finite 30-day lifetime too.
  const auth2 = await grant(s); const resumed = await relaySubscribe(s.ctx, auth2, params(key, {cursor: 'relay1:0'}), s.env, r.fetcher, Date.now());
  assert.equal(resumed.truncated, true); assert.equal(resumed.cursor, 'relay1:1');
});
test('unsubscribe while webhook is in flight cannot resurrect the subscription', async () => {
  const s = setup(), auth = await grant(s), key = secret(), r = receiver(key), p = params(key); await relaySubscribe(s.ctx, auth, p, s.env, r.fetcher); await s.add();
  let release, started; const begun = new Promise(resolve => {started = resolve;});
  const draining = drainRelayOutbox(s.ctx, s.env, async () => {started(); return new Promise(resolve => {release = () => resolve(new Response(null, {status: 204}));});});
  await begun; await relayUnsubscribe(s.ctx, auth, {name: p.name, arguments: p.arguments, delivery: {mode: 'webhook', url: p.delivery.url}}); release(); await draining;
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n, 0); assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n, 0);
});
test('egress adapter accepts a no-body 204 result', async () => {
  const old = globalThis.fetch; globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://egress.example/api/relay-egress');
    assert.equal(options.redirect, 'manual');
    return Response.json({status: 204, body: ''});
  };
  try {
    const fetcher = webhookTransport({RELAY_WEBHOOK_EGRESS_URL: 'https://egress.example/api/relay-egress', RELAY_WEBHOOK_EGRESS_TOKEN: random()});
    const response = await fetcher('https://receiver.example/callback', {signal: AbortSignal.timeout(10000), headers: {}, body: '{}'}); assert.equal(response.status, 204);
  } finally {globalThis.fetch = old;}
});
test('trusted egress redirects fail closed without forwarding bearer or signatures or activating a subscription', async t => {
  const s = setup(), auth = await grant(s), key = secret();
  s.env.RELAY_WEBHOOK_EGRESS_URL = 'https://egress.example/api/relay-egress';
  s.env.RELAY_WEBHOOK_EGRESS_TOKEN = 'fixture-egress-bearer-never-forward';
  for (const status of [301, 302, 303, 307, 308]) {
    const requests = [];
    t.mock.method(globalThis, 'fetch', async (url, options) => {
      requests.push(url);
      assert.equal(url, s.env.RELAY_WEBHOOK_EGRESS_URL);
      assert.equal(options.method, 'POST');
      assert.equal(options.redirect, 'manual', 'Workers-supported mode must not follow an egress redirect');
      assert.equal(options.headers.Authorization, 'Bearer fixture-egress-bearer-never-forward');
      const envelope = JSON.parse(options.body), payload = JSON.parse(envelope.body);
      assert.equal(envelope.url, params(key).delivery.url);
      assert.equal(payload.type, 'verification');
      const headers = envelope.headers;
      const signed = createHmac('sha256', Buffer.from(key.slice(6), 'base64'))
        .update(`${headers['webhook-id']}.${headers['webhook-timestamp']}.${envelope.body}`).digest('base64');
      assert.equal(headers['webhook-signature'], 'v1,' + signed);
      return new Response('fixture-private-redirect-body', {status,
        headers: {Location: 'https://untrusted.example.invalid/credential-sink'}});
    });
    await assert.rejects(relaySubscribe(s.ctx, auth, params(key), s.env), error =>
      error instanceof RelayError && error.code === -32015 && error.message === 'Callback endpoint verification failed'
      && error.data.reason === 'connection_refused');
    assert.deepEqual(requests, [s.env.RELAY_WEBHOOK_EGRESS_URL]);
    for (const table of ['relay_subscriptions', 'relay_activations', 'relay_verified', 'relay_outbox']) {
      assert.equal(s.rows('SELECT COUNT(*) AS n FROM ' + table)[0].n, 0);
    }
  }
});
test('revocation or access rotation during reply preparation cannot race a direct write',async t=>{
  for(const action of ['revoke','rotate']){
    const s=setup(),auth=await grant(s),m=await s.add('Race target');
    const original=crypto.subtle.digest.bind(crypto.subtle);
    const hook=t.mock.method(crypto.subtle,'digest',async(algorithm,bytes)=>{
      if(new TextDecoder().decode(bytes).startsWith('jarvis-relay-reply:')){
        if(action==='revoke')await auth.registry({op:'revoke',tokenHash:await hash(auth.access),client_id:auth.client});
        else await auth.registry({op:'exchange',key:'refresh:'+await hash(auth.refresh),match:{client_id:auth.client,resource:BASE+'/relay/mcp'},accessKey:'access:'+await hash(random()),refreshKey:'refresh:'+await hash(random())});
      }
      return original(algorithm,bytes);
    });
    try{
      const result=await(await s.rpc('tools/call',{name:'relay_reply',arguments:{inbox_id:RELAY_INBOX,message_id:m.id,body:'Must not commit'}},auth.access)).json();
      assert.equal(result.error.code,-32012);assert.equal(s.rows('SELECT COUNT(*) AS n FROM shared_entries WHERE reply_to=?',m.id)[0].n,0);
    }finally{hook.mock.restore();}
  }
});
test('scope narrowing stops an existing subscription and deletes callback secrets',async()=>{
  const s=setup(),auth=await grant(s),key=secret(),r=receiver(key);
  await relaySubscribe(s.ctx,auth,params(key),s.env,r.fetcher);await s.add();
  await auth.registry({op:'exchange',key:'refresh:'+await hash(auth.refresh),match:{client_id:auth.client,resource:BASE+'/relay/mcp'},scope:'relay:read',accessKey:'access:'+await hash(random()),refreshKey:'refresh:'+await hash(random())});
  await drainRelayOutbox(s.ctx,s.env,r.fetcher,Date.now()+100);
  assert.equal(r.calls.length,1);assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n,0);assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_outbox')[0].n,0);
});
test('bounded outbox retains overflow in journal and refills after acknowledgment',async()=>{
  const s=setup(),auth=await grant(s),key=secret(),r=receiver(key);
  sharedStore(s.ctx,'/internal/shared/state');
  await relaySubscribe(s.ctx,auth,params(key),s.env,r.fetcher);
  // Exercise internal durable queue limits without bypassing the public API's
  // 200-per-day limit: synthetic retained journal spans multiple days.
  for(let i=0;i<2005;i++){
    const id=crypto.randomUUID(),createdAt=new Date().toISOString();
    s.ctx.storage.transactionSync(()=>{
      s.ctx.storage.sql.exec("INSERT INTO shared_entries(id,kind,body,created_at) VALUES(?,'user',?,?)",id,'Journal fixture '+i,createdAt);
      enqueueRelayMessage(s.ctx,{id,body:'Journal fixture '+i,createdAt});
    });
  }
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_events')[0].n,2005);
  assert.equal(s.rows("SELECT COUNT(*) AS n FROM relay_outbox WHERE status='pending'")[0].n,2000);
  await drainRelayOutbox(s.ctx,s.env,r.fetcher,Date.now()+100);
  await drainRelayOutbox(s.ctx,s.env,r.fetcher,Date.now()+200);
  assert.ok(s.rows('SELECT MAX(event_seq) AS n FROM relay_outbox')[0].n>=2001);
  assert.ok(s.rows("SELECT COUNT(*) AS n FROM relay_outbox WHERE status='pending'")[0].n<=2000);
});
