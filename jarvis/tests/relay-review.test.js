import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayFixture} from './relay-fixture.js';
import {relayOAuthStore} from '../backend/relay-oauth.js';
import {relayRpc} from '../backend/relay-connector.js';
import {relaySubscribe, relayUnsubscribe, drainRelayOutbox} from '../backend/relay-events.js';
import {sharedStore, SHARED_OBJECT} from '../backend/shared.js';
import {RELAY_OWNER, RELAY_INBOX, RELAY_EVENT, RELAY_CALLBACK, random, hash, challenge} from '../backend/relay-common.js';

const secret = () => 'whsec_' + Buffer.alloc(32, 7).toString('base64');
const params = () => ({name: RELAY_EVENT, arguments: {inbox_id: RELAY_INBOX}, delivery: {mode: 'webhook', url: 'https://receiver.example/callback', secret: secret()}, cursor: 'relay1:0'});
const stopping = p => ({name: p.name, arguments: p.arguments, delivery: {mode: p.delivery.mode, url: p.delivery.url}});
const receiver = async (_url, init) => {
  const payload = JSON.parse(init.body);
  return payload.type === 'verification' ? Response.json({challenge: payload.challenge}) : new Response(null, {status: 204});
};
async function fixture(t) {
  const s = createRelayFixture(); t.after(() => s.close());
  s.ctx = s.object(SHARED_OBJECT).ctx;
  sharedStore(s.ctx, '/internal/shared/state');
  s.rows = (q, ...v) => [...s.ctx.storage.sql.exec(q, ...v)];
  s.registry = b => relayOAuthStore(s.ctx, b).json();
  const client = random(), grantId = random(), verifier = random(), code = random(), access = random(), refresh = random();
  const resource = s.env.RELAY_MCP_ORIGIN + '/relay/mcp', scope = 'relay:read relay:reply relay:events';
  await s.registry({op: 'put', key: 'client:' + client, category: 'client', value: {redirect: RELAY_CALLBACK}, expiresAt: Date.now() + 600000});
  const p = {client_id: client, redirect_uri: RELAY_CALLBACK, code_challenge: await challenge(verifier), scope};
  await s.registry({op: 'authorize', grantId, codeKey: 'code:' + await hash(code), params: p, resource});
  const accessHash = await hash(access);
  await s.registry({op: 'exchange', key: 'code:' + await hash(code), match: {client_id: client, redirect_uri: RELAY_CALLBACK, challenge: p.code_challenge, resource}, accessKey: 'access:' + accessHash, refreshKey: 'refresh:' + await hash(refresh)});
  s.auth = {principal: RELAY_OWNER, grantId, scopes: scope.split(' '), accessHash};
  s.revoke = () => s.registry({op: 'revoke', tokenHash: accessHash, client_id: client});
  s.rotate = async () => s.registry({op: 'exchange', key: 'refresh:' + await hash(refresh), match: {client_id: client, resource}, accessKey: 'access:' + await hash(random()), refreshKey: 'refresh:' + await hash(random())});
  s.add = () => sharedStore(s.ctx, '/internal/shared/message', {id: crypto.randomUUID(), body: 'Review fixture message'});
  return s;
}

test('review: a stale in-flight 410 must not delete an unsubscribed and recreated subscription', async t => {
  const s = await fixture(t), p = params();
  await relaySubscribe(s.ctx, s.auth, p, s.env, receiver);
  assert.equal(s.add().status, 201);
  let release, begin;
  const begun = new Promise(resolve => { begin = resolve; });
  const inFlight = drainRelayOutbox(s.ctx, s.env, async () => {
    begin();
    return new Promise(resolve => { release = () => resolve(new Response(null, {status: 410})); });
  });
  await begun;
  await relayUnsubscribe(s.ctx, s.auth, stopping(p));
  const recreated = await relaySubscribe(s.ctx, s.auth, p, s.env, receiver);
  assert.equal(s.rows('SELECT id FROM relay_subscriptions WHERE id=?', recreated.id).length, 1);
  release(); await inFlight;
  assert.equal(s.rows('SELECT id FROM relay_subscriptions WHERE id=?', recreated.id).length, 1,
    'the old-generation callback response must not delete the new subscription');
});

test('review: rotating access during callback verification must prevent a stale subscription write', async t => {
  const s = await fixture(t);
  s.env.RELAY_WEBHOOK_EGRESS_URL = 'https://egress.example/api/relay-egress';
  s.env.RELAY_WEBHOOK_EGRESS_TOKEN = random();
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    const envelope = JSON.parse(init.body), payload = JSON.parse(envelope.body);
    assert.equal(payload.type, 'verification');
    await s.rotate();
    return Response.json({status: 200, body: JSON.stringify({challenge: payload.challenge})});
  });
  await assert.rejects(relayRpc(s.ctx, s.env, s.auth, {method: 'events/subscribe', params: params()}),
    error => error.code === -32012);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n, 0);
});

test('review: revocation during asynchronous signing must stop before callback transmission', async t => {
  const s = await fixture(t), p = params();
  await relaySubscribe(s.ctx, s.auth, p, s.env, receiver); s.add();
  const original = crypto.subtle.sign.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'sign', async (...args) => { await s.revoke(); return original(...args); });
  let delivered = 0;
  await drainRelayOutbox(s.ctx, s.env, async () => { delivered++; return new Response(null, {status: 204}); });
  assert.equal(delivered, 0, 'no application callback may start after committed revocation');
});

test('review: expiration during asynchronous signing must stop before callback transmission', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const s = await fixture(t), p = {...params(), ttlMs: 50};
  await relaySubscribe(s.ctx, s.auth, p, s.env, receiver); s.add();
  const original = crypto.subtle.sign.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'sign', async (...args) => { now += 100; return original(...args); });
  let delivered = 0;
  await drainRelayOutbox(s.ctx, s.env, async () => { delivered++; return new Response(null, {status: 204}); });
  assert.equal(delivered, 0, 'no application callback may start after its granted expiration');
});

test('review: unsubscribe during callback verification must cancel the pending subscription activation', async t => {
  const s = await fixture(t), p = params();
  let release, begin;
  const begun = new Promise(resolve => { begin = resolve; });
  const subscribing = relaySubscribe(s.ctx, s.auth, p, s.env, async (_url, init) => {
    const payload = JSON.parse(init.body); begin();
    return new Promise(resolve => { release = () => resolve(Response.json({challenge: payload.challenge})); });
  });
  await begun;
  await relayUnsubscribe(s.ctx, s.auth, stopping(p));
  release();
  await assert.rejects(subscribing, error => error.code === -32012);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions')[0].n, 0,
    'a completed unsubscribe must not be undone by a verification started earlier');
});

test('review: rotating access during unsubscribe preparation must prevent a stale subscription deletion', async t => {
  const s = await fixture(t), p = params();
  const created = await relaySubscribe(s.ctx, s.auth, p, s.env, receiver);
  const original = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, 'digest', async (algorithm, bytes) => {
    const input = new TextDecoder().decode(bytes);
    if (input.startsWith('[') && input.includes(RELAY_EVENT)) await s.rotate();
    return original(algorithm, bytes);
  });
  await assert.rejects(relayRpc(s.ctx, s.env, s.auth, {method: 'events/unsubscribe', params: stopping(p)}),
    error => error.code === -32012);
  assert.equal(s.rows('SELECT id FROM relay_subscriptions WHERE id=?', created.id).length, 1);
});

test('review: renewing an expired row must enforce the active eight-subscription cap', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const s = await fixture(t), expired = {...params(), ttlMs: 50};
  await relaySubscribe(s.ctx, s.auth, expired, s.env, receiver);
  for (let i = 1; i < 8; i++) {
    const p = params(); p.delivery.url += '?subscription=' + i;
    await relaySubscribe(s.ctx, s.auth, p, s.env, receiver);
  }
  now += 100;
  const ninth = params(); ninth.delivery.url += '?subscription=9';
  await relaySubscribe(s.ctx, s.auth, ninth, s.env, receiver);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions WHERE expires_ms>?', now)[0].n, 8);
  await assert.rejects(relaySubscribe(s.ctx, s.auth, {...expired, ttlMs: 10000}, s.env, receiver),
    error => error.code === -32013);
  assert.equal(s.rows('SELECT COUNT(*) AS n FROM relay_subscriptions WHERE expires_ms>?', now)[0].n, 8);
});
