import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {relayOwnerRpc} from '../backend/relay-owner.js';
import {relayOwnerTools} from '../backend/relay-owner-tools.js';
import {RELAY_OWNER_INBOX, RELAY_PUBLIC_SCOPES} from '../backend/relay-common.js';

const tool = 'relay_owner_job_result_correct';
async function fixture(t) {
  const h = createConversationFixture(t); t.after(() => h.close());
  const owner = await h.oauth(), phone = await h.pair(owner);
  const create = async (options = {}) => {
    const response = await h.phone('/jobs', {id: crypto.randomUUID(), title: 'Synthetic private correction request', body: 'Synthetic private request', action_kind: 'read_only', ...options}, phone.device_token);
    assert.equal(response.status, 201); return (await response.json()).job;
  };
  const read = async id => {
    const response = await h.phone('/jobs/detail?job_id=' + id, undefined, phone.device_token);
    assert.equal(response.status, 200); return response.json();
  };
  const reply = (job, body = 'Original immutable private answer') => h.rpc(owner, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: job.id, body});
  const completed = async () => {
    const job = await create(), runId = crypto.randomUUID();
    await h.rpc(owner, 'relay_owner_job_claim', {inbox_id: RELAY_OWNER_INBOX, job_id: job.id, run_id: runId, event_id: crypto.randomUUID()});
    const saved = await reply(job);
    await h.rpc(owner, 'relay_owner_job_update', {inbox_id: RELAY_OWNER_INBOX, job_id: job.id, run_id: runId, event_id: crypto.randomUUID(),
      stage: 'completed', expected_reply_id: saved.entry.id, expected_version: 1, summary: 'Fictional requested work completed by the claimed run.', outcome: 'known'});
    return {job, saved, data: await read(job.id)};
  };
  const correction = (job, replyId, overrides = {}) => ({inbox_id: RELAY_OWNER_INBOX, job_id: job.id, event_id: crypto.randomUUID(),
    expected_reply_id: replyId, expected_version: 1, body: 'Updated plain-text answer', correction_summary: 'Checked the source and corrected the stated result.', ...overrides});
  const failure = async (auth, args, status = 409) => {
    const response = await h.rpcResponse(auth, 'tools/call', {name: tool, arguments: args});
    assert.equal(response.status, 200); const data = await response.json();
    if (status === 400 && data.error?.data?.status === undefined) assert.equal(data.error?.code, -32602, 'Strict field validation uses the standard invalid-arguments error');
    else assert.equal(data.error?.data?.status, status);
    return data;
  };
  return {h, owner, phone, create, read, reply, completed, correction, failure};
}

test('authenticated corrections append versions while the first private chat reply, original result and execution state remain immutable', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const s = await fixture(t), {job, saved, data} = await s.completed();
  assert.equal(data.job.resultVersion, 1); assert.deepEqual(data.resultHistory, [data.job.latestResult]);
  assert.equal(data.job.latestResult.id, saved.entry.id); assert.equal(data.job.latestResult.correctionSummary, null);
  const jobsBefore = s.h.rows('SELECT * FROM relay_owner_jobs'), entriesBefore = s.h.rows('SELECT * FROM relay_owner_entries');
  const deliveryBefore = s.h.rows('SELECT * FROM relay_events'), alarmsBefore = [...s.h.fixture.object('jarvis-shared-v2').alarms];
  now += 1000;
  const args = s.correction(job, saved.entry.id), corrected = await s.h.rpc(s.owner, tool, args);
  assert.equal(corrected.newWrite, true); assert.equal(corrected.acceptedResult.version, 2);
  assert.equal(corrected.acceptedResult.id, args.event_id); assert.equal(corrected.acceptedResult.replyId, saved.entry.id);
  assert.equal(corrected.acceptedResult.authentication_source, 'owner-oauth-mcp'); assert.equal(corrected.acceptedResult.author_authenticated, true);
  assert.equal(Object.hasOwn(corrected.acceptedResult, 'verified'), false, 'Authentication never certifies factual accuracy');
  const after = await s.read(job.id);
  assert.equal(after.job.stage, 'completed'); assert.equal(after.job.finishedAt, data.job.finishedAt);
  assert.deepEqual(after.job.completion, data.job.completion); assert.equal(after.job.completion.resultVersion, 1);
  assert.equal(Date.parse(after.job.updatedAt), now); assert.ok(after.job.updatedAt > data.job.updatedAt);
  assert.deepEqual(after.job.result, data.job.result); assert.equal(after.job.result.body, saved.entry.body);
  assert.equal(after.job.resultVersion, 2); assert.deepEqual(after.job.latestResult, corrected.acceptedResult);
  assert.deepEqual(after.resultHistory.map(result => result.version), [1, 2]);
  assert.equal(after.resultHistory[0].body, saved.entry.body); assert.equal(after.resultHistory[1].body, args.body);
  assert.equal(after.events.filter(event => event.kind === 'result_corrected').length, 1);
  const list = await (await s.h.phone('/jobs', undefined, s.phone.device_token)).json();
  assert.deepEqual(list.jobs[0].latestResult, corrected.acceptedResult);
  const conversation = await s.h.rpc(s.owner, 'relay_owner_read_conversation', {inbox_id: RELAY_OWNER_INBOX, message_id: job.id});
  assert.equal(conversation.reply.id, saved.entry.id); assert.equal(conversation.reply.body, saved.entry.body);
  assert.equal((await s.reply(job, saved.entry.body)).newWrite, false);
  const conflict = await s.h.rpcResponse(s.owner, 'tools/call', {name: 'relay_owner_reply', arguments: {inbox_id: RELAY_OWNER_INBOX, message_id: job.id, body: args.body}});
  assert.equal((await conflict.json()).error.data.status, 409);
  assert.deepEqual(s.h.rows('SELECT * FROM relay_owner_jobs').map(row => ({...row})), jobsBefore.map(row => ({...row, updated_ms: now})));
  assert.deepEqual(s.h.rows('SELECT * FROM relay_owner_entries'), entriesBefore);
  assert.deepEqual(s.h.rows('SELECT * FROM relay_events'), deliveryBefore);
  assert.deepEqual(s.h.fixture.object('jarvis-shared-v2').alarms, alarmsBefore, 'Correction creates no callback wake or execution');
});

test('an available reply can be corrected without attesting completion and explicit completion must pin the current correction version', async t => {
  const s = await fixture(t), job = await s.create(), runId = crypto.randomUUID();
  await s.h.rpc(s.owner, 'relay_owner_job_claim', {inbox_id: RELAY_OWNER_INBOX, job_id: job.id, run_id: runId, event_id: crypto.randomUUID()});
  const saved = await s.reply(job, 'Fictional preliminary saved report'), corrected = await s.h.rpc(s.owner, tool, s.correction(job, saved.entry.id));
  assert.equal(corrected.job.stage, 'outcome_unknown'); assert.equal(corrected.job.completion, null); assert.equal(corrected.job.finishedAt, null);
  assert.equal(corrected.job.resultVersion, 2); assert.equal(corrected.job.result.body, saved.entry.body);
  const input = {inbox_id: RELAY_OWNER_INBOX, job_id: job.id, run_id: runId, event_id: crypto.randomUUID(), stage: 'completed', expected_reply_id: saved.entry.id,
    expected_version: 1, summary: 'Fictional work completed with the current corrected result.', outcome: 'known'};
  const rejected = await s.h.rpcResponse(s.owner, 'tools/call', {name: 'relay_owner_job_update', arguments: input});
  assert.equal((await rejected.json()).error?.data?.status, 409);
  const complete = await s.h.rpc(s.owner, 'relay_owner_job_update', {...input, expected_version: 2});
  assert.equal(complete.job.stage, 'completed'); assert.equal(complete.job.completion.resultVersion, 2);
  assert.equal(complete.job.resultVersion, 2); assert.equal(complete.job.result.replyId, saved.entry.id);
});

test('the existing cached conversation read exposes a separately labeled correction while retaining the immutable original structured reply', async t => {
  const s = await fixture(t), {job, saved} = await s.completed();
  const request = {name: 'relay_owner_read_conversation', arguments: {inbox_id: RELAY_OWNER_INBOX, message_id: job.id}};
  const originalResponse = await s.h.rpcResponse(s.owner, 'tools/call', request), original = await originalResponse.json();
  const label = 'Private job lifecycle (authenticated server evidence; callback acceptance never establishes execution): ';
  const initialLifecycle = JSON.parse(original.result.content[3].text.slice(label.length));
  assert.equal(initialLifecycle.resultVersion, 1); assert.equal(Object.hasOwn(initialLifecycle, 'latestResult'), false);
  assert.equal(initialLifecycle.stage, 'completed'); assert.equal(initialLifecycle.completion.replyId, saved.entry.id);
  assert.equal(initialLifecycle.completion.resultVersion, 1); assert.equal(initialLifecycle.finishedAt, initialLifecycle.completion.createdAt);
  const args = s.correction(job, saved.entry.id, {body: '<?php corrected_plain_data(); ?> <script>inert correction</script>'});
  const correction = await s.h.rpc(s.owner, tool, args);
  const laterResponse = await s.h.rpcResponse(s.owner, 'tools/call', request), later = await laterResponse.json();
  assert.equal(later.result.content.length, 4);
  assert.deepEqual(later.result.structuredContent, original.result.structuredContent);
  assert.deepEqual(later.result.content[0], original.result.content[0]);
  assert.equal(later.result.structuredContent.reply.body, saved.entry.body);
  assert.ok(later.result.content[3].text.startsWith(label));
  const lifecycle = JSON.parse(later.result.content[3].text.slice(label.length));
  assert.equal(lifecycle.resultVersion, 2); assert.deepEqual(lifecycle.latestResult, correction.acceptedResult);
  assert.deepEqual(lifecycle.completion, initialLifecycle.completion); assert.equal(lifecycle.finishedAt, initialLifecycle.finishedAt);
  assert.match(lifecycle.resultLabel, /Authenticated correction/); assert.match(lifecycle.resultLabel, /does not certify factual accuracy/);
  assert.equal(lifecycle.latestResult.format, 'plain_text'); assert.equal(lifecycle.latestResult.body, args.body);
  assert.equal(lifecycle.latestResult.correctionSummary, args.correction_summary);
  for (const secret of [s.phone.device_token, s.owner.access, s.owner.accessHash, s.owner.grantId]) assert.ok(!later.result.content[3].text.includes(secret));
});

test('password-origin requests preserve exact provenance through existing pending, conversation and immutable final-reply tools', async t => {
  const s = await fixture(t), username = 'synthetic.compatibility.owner', password = 'synthetic compatibility passphrase 59';
  const prepared = await s.h.phone('/credentials/prepare', {purpose: 'setup'}, s.phone.device_token);
  assert.equal(prepared.status, 200); const consent = await prepared.json();
  const configured = await s.h.phone('/credentials', {username, password, password_confirmation: password,
    consent_token: consent.consent_token, confirm: true, access_days: 365, preserve_existing_sessions: true}, s.phone.device_token);
  assert.equal(configured.status, 201);
  const login = await s.h.phone('/login', {username, password, label: 'Synthetic password-origin compatibility browser'});
  assert.equal(login.status, 201); const signed = await login.json();
  assert.equal(signed.device.authentication_source, 'owner-password-session');
  const id = crypto.randomUUID(), body = 'Synthetic password-origin owner request';
  const created = await s.h.phone('/messages', {id, body}, signed.device_token);
  assert.equal(created.status, 201); assert.equal((await created.json()).entry.authentication_source, 'owner-password-session');
  const pending = await s.h.rpc(s.owner, 'relay_owner_list_pending', {inbox_id: RELAY_OWNER_INBOX});
  assert.deepEqual(pending.messages.map(entry => entry.id), [id]);
  assert.equal(pending.messages[0].authentication_source, 'owner-password-session');
  const request = {name: 'relay_owner_read_conversation', arguments: {inbox_id: RELAY_OWNER_INBOX, message_id: id}};
  const response = await s.h.rpcResponse(s.owner, 'tools/call', request), read = await response.json();
  assert.equal(read.result.isError, false); assert.equal(read.result.structuredContent.message.authentication_source, 'owner-password-session');
  assert.deepEqual(JSON.parse(read.result.content[0].text), read.result.structuredContent);
  assert.equal(read.result.structuredContent.message.device_id, signed.device.id);
  const pendingEnum = relayOwnerTools.find(tool => tool.name === 'relay_owner_list_pending').outputSchema.properties.messages.items.properties.authentication_source.enum;
  const readEnum = relayOwnerTools.find(tool => tool.name === 'relay_owner_read_conversation').outputSchema.properties.message.properties.authentication_source.enum;
  assert.ok(pendingEnum.includes(pending.messages[0].authentication_source));
  assert.ok(readEnum.includes(read.result.structuredContent.message.authentication_source));
  const knownCachedHostEnum = ['owner-device-session', 'owner-oauth-mcp'];
  assert.equal(knownCachedHostEnum.includes(read.result.structuredContent.message.authentication_source), false,
    'A two-value cached host schema cannot be represented as compatible with this preserved password provenance');
  const label = 'Private job lifecycle (authenticated server evidence; callback acceptance never establishes execution): ';
  const lifecycle = JSON.parse(read.result.content[3].text.slice(label.length));
  assert.equal(lifecycle.stage, 'queued'); assert.equal(lifecycle.execution, null); assert.equal(lifecycle.resultVersion, 0);
  const saved = await s.h.rpc(s.owner, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: id, body: 'Synthetic final owner answer'});
  assert.equal(saved.entry.authentication_source, 'owner-oauth-mcp');
  const final = await s.h.rpc(s.owner, 'relay_owner_read_conversation', request.arguments);
  assert.equal(final.message.authentication_source, 'owner-password-session');
  assert.equal(final.reply.authentication_source, 'owner-oauth-mcp'); assert.equal(final.reply.id, saved.entry.id);
  const detail = await s.h.phone('/jobs/detail?job_id=' + id, undefined, signed.device_token), job = (await detail.json()).job;
  assert.equal(detail.status, 200); assert.equal(job.authentication_source, 'owner-password-session');
  assert.equal(job.stage, 'outcome_unknown'); assert.equal(job.finishedAt, null); assert.equal(job.completion, null);
  assert.equal(job.result.replyId, saved.entry.id); assert.equal(job.resultVersion, 1);
  assert.deepEqual((await s.h.rpc(s.owner, 'relay_owner_list_pending', {inbox_id: RELAY_OWNER_INBOX})).messages, []);
});

test('expected-version compare-and-swap resolves racing corrections without replacing either the original or accepted revision', async t => {
  const s = await fixture(t), {job, saved} = await s.completed(), other = await s.h.oauth();
  const a = s.correction(job, saved.entry.id, {body: 'First competing correction'}), b = s.correction(job, saved.entry.id, {body: 'Second competing correction'});
  const responses = await Promise.all([s.h.rpcResponse(s.owner, 'tools/call', {name: tool, arguments: a}), s.h.rpcResponse(other, 'tools/call', {name: tool, arguments: b})]);
  const results = await Promise.all(responses.map(response => response.json()));
  assert.equal(results.filter(result => result.result?.structuredContent?.newWrite).length, 1);
  assert.equal(results.filter(result => result.error?.data?.status === 409).length, 1);
  const accepted = results.find(result => result.result)?.result.structuredContent.acceptedResult;
  const read = await s.read(job.id); assert.equal(read.resultHistory.length, 2); assert.deepEqual(read.job.latestResult, accepted);
  assert.equal(read.job.result.replyId, saved.entry.id); assert.equal(s.h.rows('SELECT COUNT(*) AS n FROM relay_owner_job_result_corrections')[0].n, 1);
});

test('lost correction responses retry the same event and version without duplicate records or silently accepting changed payloads', async t => {
  let now = Date.now(); t.mock.method(Date, 'now', () => now);
  const s = await fixture(t), {job, saved} = await s.completed(), args = s.correction(job, saved.entry.id);
  const discardedResponse = await s.h.rpcResponse(s.owner, 'tools/call', {name: tool, arguments: args});
  assert.equal(discardedResponse.status, 200); // The caller loses the returned body after the committed save.
  const observed = (await s.read(job.id)).job.latestResult; now += 1000;
  const retried = await s.h.rpc(s.owner, tool, args);
  assert.equal(retried.newWrite, false); assert.deepEqual(retried.acceptedResult, observed);
  const next = await s.h.rpc(s.owner, tool, s.correction(job, saved.entry.id, {expected_version: 2, body: 'A subsequent authenticated correction'}));
  assert.equal(next.acceptedResult.version, 3); now += 1000;
  const oldRetry = await s.h.rpc(s.owner, tool, args);
  assert.equal(oldRetry.newWrite, false); assert.equal(oldRetry.acceptedResult.version, 2); assert.equal(oldRetry.job.latestResult.version, 3);
  assert.equal(oldRetry.acceptedResult.createdAt, observed.createdAt);
  assert.equal(oldRetry.job.updatedAt, next.job.updatedAt, 'Old event retries do not advance updatedAt');
  await s.failure(s.owner, {...args, body: 'Changed under the old event UUID'});
  await s.failure(s.owner, {...args, correction_summary: 'Different checking rationale'});
  await s.failure(await s.h.oauth(), args);
  assert.equal(s.h.rows('SELECT COUNT(*) AS n FROM relay_owner_job_result_corrections')[0].n, 2);
  assert.equal((await s.read(job.id)).events.filter(event => event.kind === 'result_corrected').length, 2);
});

test('public OAuth, phone sessions, public claims and non-private target IDs cannot write result corrections', async t => {
  const s = await fixture(t), {job, saved} = await s.completed(), ordinary = await s.h.oauth(RELAY_PUBLIC_SCOPES.join(' '));
  const args = s.correction(job, saved.entry.id), before = s.h.rows('SELECT * FROM relay_owner_job_result_corrections');
  const challengeResponse = await s.h.rpcResponse(ordinary, 'tools/call', {name: tool, arguments: args});
  const challenge = await challengeResponse.json(); assert.equal(challenge.result.isError, true); assert.ok(challenge.result._meta['mcp/www_authenticate']);
  assert.ok(!JSON.stringify(challenge).includes(job.body));
  const phoneCredential = await s.h.rpcResponse(s.phone.device_token, 'tools/call', {name: tool, arguments: args});
  assert.equal(phoneCredential.status, 401);
  const inventedRoute = await s.h.phone('/jobs/correct', args, s.phone.device_token); assert.equal(inventedRoute.status, 404);
  await s.failure(s.owner, {...args, inbox_id: 'brayden-relay'}, 403);
  await s.failure(s.owner, {...args, job_id: crypto.randomUUID()}, 404);
  await s.failure(s.owner, {...args, expected_reply_id: crypto.randomUUID()});
  await s.failure(s.owner, {...args, public_muse_authorized: true}, 400);
  await s.failure(s.owner, {...args, verified: true}, 400);
  assert.deepEqual(s.h.rows('SELECT * FROM relay_owner_job_result_corrections'), before);
});

test('corrections require a genuine available private reply and cannot finish, resume or revise failed or cancelled work', async t => {
  const s = await fixture(t), queued = await s.create();
  const empty = await s.read(queued.id); assert.equal(empty.job.resultVersion, 0); assert.equal(empty.job.latestResult, null); assert.deepEqual(empty.resultHistory, []);
  await s.failure(s.owner, s.correction(queued, crypto.randomUUID()));
  for (const stage of ['failed', 'cancelled']) {
    const job = await s.create(), runId = crypto.randomUUID();
    await s.h.rpc(s.owner, 'relay_owner_job_claim', {inbox_id: RELAY_OWNER_INBOX, job_id: job.id, run_id: runId, event_id: crypto.randomUUID()});
    if (stage === 'cancelled') await s.h.phone('/jobs/cancel', {job_id: job.id}, s.phone.device_token);
    await s.h.rpc(s.owner, 'relay_owner_job_update', {inbox_id: RELAY_OWNER_INBOX, job_id: job.id, run_id: runId, event_id: crypto.randomUUID(), stage,
      summary: 'Synthetic explicit terminal execution evidence.', outcome: 'not_started'});
    const saved = await s.reply(job, 'Explanation of the terminal state');
    await s.failure(s.owner, s.correction(job, saved.entry.id));
    assert.equal((await s.read(job.id)).job.stage, stage);
  }
  assert.equal(s.h.rows('SELECT COUNT(*) AS n FROM relay_owner_job_result_corrections')[0].n, 0);
});

test('correction bounds, exact association and plain-text format prevent forged authority and unbounded revision history', async t => {
  const s = await fixture(t), {job, saved} = await s.completed();
  for (const change of [{body: ''}, {body: 'x'.repeat(6001)}, {correction_summary: ' '}, {correction_summary: 'x'.repeat(1001)},
    {expected_version: 0}, {expected_version: 5}, {expected_version: '1'}, {event_id: saved.entry.id}, {format: 'html'}]) {
    await s.failure(s.owner, s.correction(job, saved.entry.id, change), 400);
  }
  const inert = '<?php system("touch /tmp/private-unsafe"); ?> <script>globalThis.unsafe=true</script> <iframe src=javascript:alert(1)>';
  for (let version = 1; version <= 4; version++) {
    const result = await s.h.rpc(s.owner, tool, s.correction(job, saved.entry.id, {expected_version: version, body: inert, correction_summary: 'Plain data; authentication does not certify this claim.'}));
    assert.equal(result.acceptedResult.format, 'plain_text'); assert.equal(result.acceptedResult.body, inert);
    assert.equal(result.acceptedResult.version, version + 1);
  }
  await s.failure(s.owner, s.correction(job, saved.entry.id, {expected_version: 4}), 429);
  const read = await s.read(job.id); assert.deepEqual(read.resultHistory.map(result => result.version), [1, 2, 3, 4, 5]);
  const serialized = JSON.stringify(read);
  for (const secret of [s.phone.device_token, s.owner.access, s.owner.accessHash, s.owner.grantId]) assert.ok(!serialized.includes(secret));
  assert.equal(globalThis.unsafe, undefined); assert.equal(read.job.result.body, saved.entry.body);
});

test('correction journal and version insertion roll back together on storage failure', async t => {
  const s = await fixture(t), {job, saved} = await s.completed(), args = s.correction(job, saved.entry.id);
  const before = s.h.rows('SELECT * FROM relay_owner_job_events'), exec = s.h.ctx.storage.sql.exec;
  s.h.ctx.storage.sql.exec = (query, ...values) => {
    if (query.startsWith('INSERT INTO relay_owner_job_result_corrections')) throw Error('Synthetic correction storage failure');
    return exec(query, ...values);
  };
  const response = await s.h.rpcResponse(s.owner, 'tools/call', {name: tool, arguments: args});
  assert.equal((await response.json()).error.code, -32603);
  s.h.ctx.storage.sql.exec = exec;
  assert.deepEqual(s.h.rows('SELECT * FROM relay_owner_job_events'), before);
  assert.equal(s.h.rows('SELECT COUNT(*) AS n FROM relay_owner_job_result_corrections')[0].n, 0);
  assert.equal((await s.read(job.id)).job.resultVersion, 1);
  assert.equal((await s.h.rpc(s.owner, tool, args)).acceptedResult.version, 2);
});

test('live owner authorization is revalidated immediately before the correction transaction', async t => {
  const s = await fixture(t), {job, saved} = await s.completed(), args = s.correction(job, saved.entry.id);
  const transaction = s.h.ctx.storage.transactionSync.bind(s.h.ctx.storage); let once = true;
  s.h.ctx.storage.transactionSync = fn => {
    if (once) {
      once = false; const key = 'grant:' + s.owner.grantId, row = s.h.rows('SELECT value FROM relay_oauth WHERE key=?', key)[0], value = JSON.parse(row.value);
      value.revoked = true; s.h.rows('UPDATE relay_oauth SET value=? WHERE key=?', JSON.stringify(value), key);
    }
    return transaction(fn);
  };
  await assert.rejects(relayOwnerRpc(s.h.ctx, s.h.fixture.env, s.owner, tool, args), error => error.data?.status === 403);
  assert.equal(s.h.rows('SELECT COUNT(*) AS n FROM relay_owner_job_result_corrections')[0].n, 0);
  assert.equal((await s.read(job.id)).job.resultVersion, 1);
});
