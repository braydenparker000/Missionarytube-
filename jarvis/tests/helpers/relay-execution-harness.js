import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {AsyncLocalStorage} from 'node:async_hooks';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash, createHmac, randomUUID} from 'node:crypto';
import worker, {Hub} from '../../backend/worker.js';
import {relayOAuthStore} from '../../backend/relay-oauth.js';
import {PRIMARY_SITE} from '../../backend/origins.js';
import {SHARED_OBJECT} from '../../backend/shared.js';
import {RELAY_CALLBACK, RELAY_OWNER_INBOX, RELAY_OWNER_EVENT, RELAY_SCOPES, RELAY_VERSION,
  challenge, hash, random} from '../../backend/relay-common.js';

// This is an independent, loopback HTTP host with disk-backed SQLite. OAuth
// grants are seeded fixture identities, NOT real consent. No live credential,
// subscription, public request, host schedule or Muse script is ever used.
export async function createExecutionHarness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'relay-execution-'));
  const networkFetch = globalThis.fetch.bind(globalThis), objects = new Map();
  const measurements = [], context = new AsyncLocalStorage();
  let now = Date.parse('2026-10-09T00:00:00Z'), transaction = 0, rpcId = 0;
  t.mock.method(Date, 'now', () => now);
  const signingSecret = 'whsec_' + Buffer.alloc(32, 29).toString('base64');
  const env = {RELAY_MCP_ENABLED: 'true', RELAY_OWNER_ENABLED: 'true',
    RELAY_MCP_ORIGIN: 'https://relay.execution.test',
    RELAY_GITHUB_CLIENT_ID: 'fictional-client', RELAY_GITHUB_CLIENT_SECRET: 'fictional-secret',
    RELAY_WEBHOOK_EGRESS_URL: 'https://egress.execution.test/callback',
    RELAY_WEBHOOK_EGRESS_TOKEN: 'fictional-egress-token'};
  const comments = new Map(), notifications = [], sources = new Map(), responseDrops = [], droppedResponses = [];
  let callback = async () => new Response(null, {status: 204});
  let upstream = null;
  const cost = (key, value = 1) => { const active = context.getStore(); if (active) active[key] += value; };
  function object(name) {
    if (objects.has(name)) return objects.get(name);
    const db = new DatabaseSync(join(directory, createHash('sha256').update(name).digest('hex') + '.sqlite'));
    // Fixture bookkeeping is excluded from production-operation counters.
    db.exec('CREATE TABLE IF NOT EXISTS fixture_storage(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    const storage = {
      sql: {exec(query, ...values) {
        cost('sqlStatements');
        const result = db.prepare(query).all(...values);
        cost('sqliteReturnedRows', result.length);
        if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(query))
          cost('sqliteChangedRows', Number(db.prepare('SELECT changes() AS n').get().n));
        return result;
      }},
      transactionSync(fn) {
        const name = 'execution_fixture_' + ++transaction;
        db.exec('SAVEPOINT ' + name);
        try {
          const value = fn();
          if (value?.then) throw Error('Fixture synchronous transaction must not await');
          db.exec('RELEASE ' + name); return value;
        } catch (error) {
          db.exec('ROLLBACK TO ' + name); db.exec('RELEASE ' + name); throw error;
        }
      },
      async get(key) {
        const row = db.prepare('SELECT value FROM fixture_storage WHERE key=?').get(key);
        return row ? JSON.parse(row.value) : undefined;
      },
      async put(key, value) { db.prepare('INSERT OR REPLACE INTO fixture_storage VALUES(?,?)').run(key, JSON.stringify(value)); },
      async delete(key) { return db.prepare('DELETE FROM fixture_storage WHERE key=?').run(key).changes > 0; },
      async transaction(fn) { return fn(storage); },
      async setAlarm(value) { await storage.put('fixture-alarm', Number(value)); },
      async getAlarm() { return await storage.get('fixture-alarm') ?? null; },
      async deleteAlarm() { await storage.delete('fixture-alarm'); },
    };
    const ctx = {storage, blockConcurrencyWhile: fn => fn(), waitUntil() {}};
    const host = {db, ctx, hub: new Hub(ctx, env)};
    objects.set(name, host); return host;
  }
  env.HUBS = {idFromName: name => name, get: name => object(name).hub};
  const openLedger = () => new DatabaseSync(join(directory, 'fictional-executor.sqlite'));
  let ledger = openLedger();
  ledger.exec('CREATE TABLE runs(request_id TEXT PRIMARY KEY,run_id TEXT NOT NULL,claim_event_id TEXT NOT NULL,reply_body TEXT,effects INTEGER NOT NULL DEFAULT 0,completion_payload TEXT,cancellation_payload TEXT)');

  const server = createServer(async (incoming, outgoing) => {
    // Never print bodies or exception messages: they can contain private input.
    try {
      const chunks = []; for await (const chunk of incoming) chunks.push(chunk);
      const bytes = Buffer.concat(chunks), path = new URL(incoming.url, 'http://loopback').pathname;
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(name, item);
        else if (value !== undefined) headers.set(name, value);
      }
      let response;
      if (path === '/__fixture/egress') {
        assert.equal(headers.get('authorization'), 'Bearer ' + env.RELAY_WEBHOOK_EGRESS_TOKEN);
        const delivery = JSON.parse(bytes.toString());
        assert.equal(delivery.url, 'https://host.execution.test/callback');
        const received = await networkFetch(base + '/__fixture/callback', {method: 'POST', headers: delivery.headers, body: delivery.body});
        response = Response.json({status: received.status, body: await received.text()});
      } else if (path === '/__fixture/callback') {
        const body = bytes.toString(), id = headers.get('webhook-id'), time = headers.get('webhook-timestamp');
        const signature = 'v1,' + createHmac('sha256', Buffer.from(signingSecret.slice(6), 'base64')).update(`${id}.${time}.${body}`).digest('base64');
        assert.ok(headers.get('webhook-signature')?.split(' ').includes(signature), 'Fake host independently checks callback HMAC');
        const notification = JSON.parse(body);
        if (notification.type === 'verification') response = Response.json({challenge: notification.challenge});
        else { notifications.push(notification); response = await callback(notification); }
      } else if (path.startsWith('/__fixture/source/')) {
        const key = path.slice('/__fixture/source/'.length);
        assert.ok(sources.has(key), 'Only fictional isolated sources may be read');
        response = Response.json({nonce: sources.get(key)});
      } else {
        const request = new Request(new URL(incoming.url, env.RELAY_MCP_ORIGIN), {
          method: incoming.method, headers, ...(bytes.length ? {body: bytes} : {}),
        });
        response = await worker.fetch(request, env);
      }
      if (path === '/relay/mcp' && responseDrops.length) {
        const rpc = JSON.parse(bytes.toString()), args = rpc.params?.arguments;
        const index = responseDrops.findIndex(drop => rpc.method === 'tools/call' && rpc.params.name === drop.tool
          && args?.job_id === drop.requestId && (!drop.stage || args.stage === drop.stage));
        if (index >= 0) {
          // Awaiting worker.fetch completes its transaction; inspect a cloned
          // successful result solely as the fixture oracle, before sending ANY
          // HTTP headers/body to the client. This is a real socket failure, not
          // a fabricated error after a successful ownerCall return.
          const committed = await response.clone().json();
          assert.equal(response.status, 200); assert.equal(committed.result?.isError, false);
          assert.equal(committed.result?.structuredContent?.newWrite, true, 'Response drop requires a fresh committed operation');
          responseDrops.splice(index, 1);
          droppedResponses.push({tool: rpc.params.name, requestId: args.job_id, runId: args.run_id, eventId: args.event_id});
          const measured = context.getStore(); if (measured) measured.fixtureWorkerCommitObserved = true;
          outgoing.destroy(); return;
        }
      }
      const responseBytes = Buffer.from(await response.arrayBuffer());
      outgoing.writeHead(response.status, Object.fromEntries(response.headers)); outgoing.end(responseBytes);
    } catch { outgoing.writeHead(500, {'Content-Type': 'application/json'}); outgoing.end('{"error":"Fixture boundary failed"}'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  // Production fetches can reach only fixture egress or fixed GitHub endpoints.
  // Unknown network destinations fail closed; there is no fallback to the web.
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    cost('upstreamRequests');
    if (url.href === env.RELAY_WEBHOOK_EGRESS_URL)
      return networkFetch(base + '/__fixture/egress', options);
    assert.equal(url.origin, 'https://api.github.com', 'Unexpected external network destination');
    assert.equal(options?.redirect, 'manual');
    const list = '/repos/braydenparker999/jarvis/issues/2/comments';
    const exact = '/repos/braydenparker999/jarvis/issues/comments/';
    assert.ok(url.pathname === list || url.pathname.startsWith(exact));
    if (upstream) return upstream(url, options);
    if (url.pathname === list) {
      const page = Number(url.searchParams.get('page') || 1);
      return Response.json([...comments.values()].sort((a, b) => a.id - b.id).slice((page - 1) * 100, page * 100));
    }
    const item = comments.get(Number(url.pathname.slice(exact.length)));
    return item ? Response.json(item) : Response.json({}, {status: 404});
  });
  function metric(operation) { return {operation: operation.split('?')[0], elapsedMs: 0, requestBytes: 0, responseBytes: 0,
    sqlStatements: 0, sqliteReturnedRows: 0, sqliteChangedRows: 0, upstreamRequests: 0}; }
  async function measure(operation, fn) {
    const record = {...metric(operation), startedAt: new Date(now).toISOString(), clock: 'fixture-virtual-wall-real-monotonic'}, start = performance.now();
    try { return await context.run(record, () => fn(record)); }
    finally { record.elapsedMs = Number((performance.now() - start).toFixed(3)); record.finishedAt = new Date(now).toISOString(); measurements.push(record); }
  }
  // The client and server have distinct asynchronous contexts. Include each
  // Worker request's SQL cost by passing an in-memory measurement lookup key.
  const pendingMeasurements = new Map();
  const originalEmit = server.emit.bind(server);
  server.emit = function (event, ...args) {
    if (event === 'request') {
      const key = args[0].headers['x-fixture-measurement'];
      const record = pendingMeasurements.get(key);
      if (record) return context.run(record, () => originalEmit(event, ...args));
    }
    return originalEmit(event, ...args);
  };
  async function http(path, body, token, operation = 'http', extra = {}) {
    return measure(operation, async record => {
      const key = randomUUID(), payload = body === undefined ? undefined : JSON.stringify(body);
      pendingMeasurements.set(key, record);
      try {
        record.requestBytes = Buffer.byteLength(payload || '');
        const intent = body?.params?.arguments || {};
        record.ids = Object.fromEntries(Object.entries({requestId: intent.job_id || intent.message_id, runId: intent.run_id,
          eventId: intent.event_id, replyId: intent.expected_reply_id, resultVersion: intent.expected_version}).filter(([, value]) => value !== undefined));
        let response;
        try {
          response = await networkFetch(base + path, {method: body === undefined ? 'GET' : 'POST',
            headers: {Origin: PRIMARY_SITE, ...(body === undefined ? {} : {'Content-Type': 'application/json'}),
              ...(token ? {Authorization: 'Bearer ' + token} : {}), 'X-Fixture-Measurement': key, ...extra}, body: payload});
        } catch (error) { record.transportFailed = true; throw error; }
        const text = await response.text(); record.responseBytes = Buffer.byteLength(text);
        const data = JSON.parse(text), args = body?.params?.arguments || {}, structured = data.result?.structuredContent || data;
        const job = structured.job;
        const publicEvent = structured.events?.at(-1) || structured.changes?.findLast(item => item.event)?.event;
        const publicEntry = structured.changes?.findLast(item => item.entry)?.entry;
        const candidate = {requestId: args.job_id || args.message_id || job?.id || structured.message?.id ||
          publicEvent?.requestId || publicEntry?.replyTo || (publicEntry?.role === 'user' ? publicEntry.id : undefined) ||
          (path.split('?')[0] === '/shared/messages' ? body?.id : undefined) || new URL(path, base).searchParams.get('requestId') || undefined,
          runId: args.run_id || job?.execution?.runId, eventId: args.event_id,
          replyId: job?.result?.replyId || structured.reply?.id || (structured.entry?.kind === 'reply' ? structured.entry.id : undefined),
          resultId: job?.latestResult?.id || publicEvent?.eventId,
          resultVersion: job?.resultVersion ?? publicEvent?.resultVersion,
          completionEventId: job?.completion?.eventId, completionResultVersion: job?.completion?.resultVersion,
          publicationAttemptId: publicEvent?.attemptId};
        record.ids = Object.fromEntries(Object.entries(candidate).filter(([, value]) => value !== undefined && value !== null));
        record.httpStatus = response.status; record.rpcErrorCode = data.error?.code ?? null;
        record.toolIsError = data.result?.isError ?? null;
        return {status: response.status, data};
      } finally { pendingMeasurements.delete(key); }
    });
  }
  async function rpc(auth, method, params = {}, overrides = {}) {
    return http('/relay/mcp', {jsonrpc: '2.0', id: ++rpcId, method, params: {...params,
      _meta: {'io.modelcontextprotocol/protocolVersion': RELAY_VERSION, 'io.modelcontextprotocol/clientCapabilities': {}}}},
    auth.access, method === 'tools/call' ? params.name : method, {Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': RELAY_VERSION, 'Mcp-Method': method, ...(method === 'tools/call' ? {'Mcp-Name': params.name} : {}), ...overrides});
  }
  async function call(auth, name, args) {
    const response = await rpc(auth, 'tools/call', {name, arguments: args});
    assert.equal(response.status, 200, 'MCP HTTP status');
    assert.equal(response.data.error, undefined, 'MCP JSON-RPC error');
    assert.equal(response.data.result?.isError, false, 'MCP tool admission');
    assert.ok(response.data.result.structuredContent, 'MCP structured result required');
    return response.data.result.structuredContent;
  }
  async function grant() {
    // Setup only: issuer state for a fictional OAuth identity. All tested
    // claims/progress/replies/subscriptions use external HTTP/MCP afterwards.
    const ctx = object(SHARED_OBJECT).ctx, client = random(), grantId = random(), code = random(), access = random(), refresh = random();
    const registry = value => relayOAuthStore(ctx, value).json(), resource = env.RELAY_MCP_ORIGIN + '/relay/mcp';
    const params = {client_id: client, redirect_uri: RELAY_CALLBACK, code_challenge: await challenge(random()), scope: RELAY_SCOPES.join(' ')};
    await registry({op: 'put', key: 'client:' + client, category: 'client', value: {redirect: RELAY_CALLBACK}, expiresAt: now + 600000});
    await registry({op: 'authorize', grantId, codeKey: 'code:' + await hash(code), params, resource});
    const issued = await registry({op: 'exchange', key: 'code:' + await hash(code), match: {client_id: client, redirect_uri: RELAY_CALLBACK, challenge: params.code_challenge, resource},
      accessKey: 'access:' + await hash(access), refreshKey: 'refresh:' + await hash(refresh)});
    assert.ok(issued.scope, 'Fictional OAuth setup must issue an actual fixture token');
    return {access, grantId};
  }
  t.after(close);
  const auth = await grant();
  const pending = await http('/relay/owner/pair/start', {label: 'Fictional acceptance phone'}, null, 'fixture_pair_start');
  assert.equal(pending.status, 201);
  await call(auth, 'relay_owner_pairing_approve', {request_id: pending.data.request_id, code: pending.data.code, access_days: 365, confirm: true});
  const token = pending.data.device_token;
  const phone = (path, body) => http('/relay/owner' + path, body, token, path);
  const ownerCall = (name, args, principal = auth) => call(principal, name, {inbox_id: RELAY_OWNER_INBOX, ...args});
  const read = id => ownerCall('relay_owner_job_read', {job_id: id});
  async function createJob(options = {}) {
    const payload = {id: randomUUID(), title: 'Fictional acceptance request', body: 'Inspect only the isolated fictional source.', action_kind: 'read_only', ...options};
    const response = await phone('/jobs', payload); assert.equal(response.status, 201);
    return {payload, ...response.data};
  }
  const subscription = (name = RELAY_OWNER_EVENT, inbox = RELAY_OWNER_INBOX, options = {}) => ({name, arguments: {inbox_id: inbox},
    delivery: {mode: 'webhook', url: 'https://host.execution.test/callback', secret: signingSecret}, cursor: 'relay1:0', ...options});
  async function subscribe(params = subscription()) {
    const response = await rpc(auth, 'events/subscribe', params);
    assert.equal(response.status, 200); assert.equal(response.data.error, undefined);
    return response.data.result;
  }
  function publish(payload, commentId) {
    const stamp = new Date(now).toISOString();
    comments.set(commentId, {id: commentId, user: {id: 183016859}, issue_url: 'https://api.github.com/repos/braydenparker999/jarvis/issues/2',
      body: JSON.stringify(payload), created_at: stamp, updated_at: stamp});
  }
  async function restart() {
    for (const host of objects.values()) host.db.close(); objects.clear();
    // Reopen the on-disk SQLite data and fixture KV/alarm; replace every Hub.
    object(SHARED_OBJECT);
    ledger.close(); ledger = openLedger();
  }
  async function alarm() { return measure('fixture_alarm', () => object(SHARED_OBJECT).hub.alarm()); }
  function rows(query, ...values) { return object(SHARED_OBJECT).db.prepare(query).all(...values); }
  function executeOnce(requestId, runId, replyBody) {
    // The only consequential fixture action is recording a marker in a separate
    // local SQLite ledger. Nothing is uploaded, published or sent elsewhere.
    ledger.prepare('UPDATE runs SET effects=effects+1,reply_body=? WHERE request_id=? AND run_id=? AND effects=0').run(replyBody, requestId, runId);
    const saved = ledger.prepare('SELECT * FROM runs WHERE request_id=?').get(requestId);
    assert.equal(saved.effects, 1); assert.equal(saved.run_id, runId); return saved;
  }
  async function performFixtureWork(requestId, {stopAfterEffect = false, stopAfterClaim = false} = {}) {
    let saved = ledger.prepare('SELECT * FROM runs WHERE request_id=?').get(requestId);
    const state = await read(requestId);
    if (state.job.completion) {
      if (!saved?.completion_payload) return {job: state.job, executed: false};
      const payload = JSON.parse(saved.completion_payload);
      assert.equal(state.job.completion.eventId, payload.event_id);
      assert.equal(state.job.completion.runId, payload.run_id);
      assert.equal(state.job.completion.replyId, payload.expected_reply_id);
      assert.equal(state.job.completion.resultVersion, payload.expected_version);
      const replay = await ownerCall('relay_owner_job_update', payload);
      assert.equal(replay.newWrite, false, 'Persisted terminal event must replay without another write');
      return {job: replay.job, executed: false, completionNewWrite: replay.newWrite};
    }
    if (state.job.stage === 'cancelled') {
      if (!saved?.cancellation_payload) return {job: state.job, executed: false};
      const replay = await ownerCall('relay_owner_job_update', JSON.parse(saved.cancellation_payload));
      assert.equal(replay.newWrite, false, 'Persisted cancellation must replay without another write');
      return {job: replay.job, executed: false, cancellationNewWrite: replay.newWrite};
    }
    await ownerCall('relay_owner_read_conversation', {message_id: requestId});
    if (!saved) {
      const runId = randomUUID(), eventId = randomUUID();
      // Persist request/run/event BEFORE attempting the claim. A lost claim
      // response must never induce another run UUID or a second execution.
      ledger.prepare('INSERT INTO runs(request_id,run_id,claim_event_id) VALUES(?,?,?)').run(requestId, runId, eventId);
      saved = ledger.prepare('SELECT * FROM runs WHERE request_id=?').get(requestId);
    }
    if (state.job.execution) assert.equal(state.job.execution.runId, saved.run_id, 'A different authenticated run must not execute fixture work');
    // A running stage is insufficient permission to start an effect. After
    // restart, inspect the pending cancellation before replaying any claim.
    if (!saved.effects && state.job.cancelRequested) {
      const payload = saved.cancellation_payload ? JSON.parse(saved.cancellation_payload) : {
        inbox_id: RELAY_OWNER_INBOX, job_id: requestId, run_id: saved.run_id, event_id: randomUUID(), stage: 'cancelled',
        summary: 'Fictional executor stopped before its source read or local marker; no action started.', outcome: 'not_started'};
      if (!saved.cancellation_payload) ledger.prepare('UPDATE runs SET cancellation_payload=? WHERE request_id=?').run(JSON.stringify(payload), requestId);
      const cancellation = await ownerCall('relay_owner_job_update', payload);
      return {job: cancellation.job, executed: false, cancellationNewWrite: cancellation.newWrite};
    }
    let claimNewWrite;
    if (!saved.effects) {
      const claim = await ownerCall('relay_owner_job_claim', {job_id: requestId, run_id: saved.run_id, event_id: saved.claim_event_id});
      claimNewWrite = claim.newWrite;
    }
    if (stopAfterClaim) return {runId: saved.run_id, executed: false};
    const executed = !saved.effects;
    if (!saved.effects) {
      const current = (await read(requestId)).job;
      assert.equal(current.stage, 'running', 'Recovered work cannot start with an expired/blocked execution lease');
      assert.equal(current.cancelRequested, false, 'Pending owner cancellation prevents the fixture effect');
      assert.ok(sources.has(requestId));
      const source = await (await networkFetch(base + '/__fixture/source/' + requestId)).json();
      assert.equal(source.nonce, sources.get(requestId), 'Fixture work result is checked against the separate fictional source');
      saved = executeOnce(requestId, saved.run_id, 'Fictional independently read source: ' + source.nonce);
    }
    if (stopAfterEffect) return {runId: saved.run_id, executed: true};
    const reply = await ownerCall('relay_owner_reply', {message_id: requestId, body: saved.reply_body});
    const current = await read(requestId);
    const payload = saved.completion_payload ? JSON.parse(saved.completion_payload) : {
      inbox_id: RELAY_OWNER_INBOX, job_id: requestId, run_id: saved.run_id, event_id: randomUUID(), stage: 'completed', expected_reply_id: reply.entry.id,
      expected_version: current.job.resultVersion, summary: 'Fictional isolated source read and local marker are verified.', outcome: 'known'};
    // Persist the ENTIRE exact intent before the call. Never regenerate its
    // event UUID, version or summary after an ambiguous transport failure.
    if (!saved.completion_payload) ledger.prepare('UPDATE runs SET completion_payload=? WHERE request_id=?').run(JSON.stringify(payload), requestId);
    const completion = await ownerCall('relay_owner_job_update', payload);
    return {job: completion.job, executed, claimNewWrite, completionNewWrite: completion.newWrite};
  }
  async function close() {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    for (const host of objects.values()) host.db.close(); objects.clear(); ledger.close();
    rmSync(directory, {recursive: true, force: true});
  }
  return {auth, grant, env, http, rpc, call, ownerCall, phone, read, createJob, subscribe, subscription, publish,
    rows, restart, alarm, notifications, sources, measurements, performFixtureWork, droppedResponses,
    dropNextRpcResponse: (tool, requestId, stage) => {
      assert.ok(['relay_owner_job_claim', 'relay_owner_job_update'].includes(tool));
      responseDrops.push({tool, requestId, stage});
    },
    fixtureIntent: id => {
      const saved = ledger.prepare('SELECT request_id,run_id,claim_event_id,completion_payload,cancellation_payload FROM runs WHERE request_id=?').get(id);
      return saved ? {requestId: saved.request_id, runId: saved.run_id, claimEventId: saved.claim_event_id,
        completionPayload: saved.completion_payload ? JSON.parse(saved.completion_payload) : null,
        cancellationPayload: saved.cancellation_payload ? JSON.parse(saved.cancellation_payload) : null} : null;
    },
    effectCount: id => ledger.prepare('SELECT effects FROM runs WHERE request_id=?').get(id)?.effects || 0,
    advance: ms => { assert.ok(ms >= 0); now += ms; },
    setCallback: fn => { callback = fn; }, setUpstream: fn => { upstream = fn; },
    clock: () => now, clearMeasurements: () => { measurements.length = 0; },
  };
}

export function assertMcpRejected(response, status = 409) {
  // HTTP 200 and callback 2xx must never accidentally satisfy a failed tool.
  assert.equal(response.status, 200);
  assert.equal(response.data.result?.structuredContent, undefined);
  assert.ok(response.data.error || response.data.result?.isError === true);
  if (response.data.error) assert.equal(response.data.error.data?.status, status);
}
