import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createExecutionHarness, assertMcpRejected} from './helpers/relay-execution-harness.js';
import {RELAY_OWNER_INBOX, RELAY_OWNER_EVENT, RELAY_INBOX, RELAY_EVENT} from '../backend/relay-common.js';
import {MUSE_PREFIX} from '../public/assets/channels.js';
import {fixtureEnvelope, emptySource, emptyCorrelation, emptyFacts, emptyProofs} from '../scripts/lib/relay-execution-evidence.mjs';

const uuid = () => randomUUID();
const boundedTest = (name, fn) => test(name, {timeout: 30000}, fn);
const report = (requestId, changes = {}) => ({schema: 'jarvis-coordination-v2', eventId: uuid(), requestId,
  attemptId: uuid(), stage: 'final', resultVersion: 1, body: 'Fictional independently checked result.', artifacts: [], ...changes});
const resultArgs = id => ({inbox_id: RELAY_INBOX, message_id: id, limit: 1});
const rejectCall = (h, name, args, auth = h.auth, status = 409) => h.rpc(auth, 'tools/call', {
  name, arguments: {inbox_id: RELAY_OWNER_INBOX, ...args},
}).then(response => assertMcpRejected(response, status));
function durableSnapshot(h) {
  // Oracle queries are NOT tested operations and do not contribute to metrics.
  return ['relay_owner_entries', 'relay_owner_jobs', 'relay_owner_job_events', 'relay_owner_job_result_corrections', 'relay_events']
    .map(table => h.rows('SELECT * FROM ' + table + ' ORDER BY rowid'));
}
function dumpCosts(t, h) {
  const scenarioByName = [
    ['HTTP/MCP contract:', 'contract', 'cross-channel'], ['Lucy fixture: callback', 'lucy-absent-phone', 'lucy-private'],
    ['Muse fixture: lost hint', 'muse-lost-hint-mcp', 'muse-public'], ['Muse fixture: independent host HTTP', 'muse-lost-hint-http', 'muse-public'],
    ['Muse fixture: changes-only', 'muse-lost-hint-changes', 'muse-public'],
    ['MCP duplicate', 'duplicate-races', 'lucy-private'], ['Lucy fixture: later correction', 'later-correction', 'lucy-private'],
    ['expired', 'subscription-expired', 'lucy-private'], ['http410', 'subscription-410', 'lucy-private'], ['http413', 'subscription-413', 'lucy-private'],
    ['recovery after expired consequential', 'consequential-reconciliation', 'lucy-private'],
    ['lost claim response', 'claim-response-recovery', 'lucy-private'],
    ['lost completion response', 'completion-response-recovery', 'lucy-private'],
    ['cancellation before', 'cancellation-before-effect', 'lucy-private'], ['cancellation after', 'cancellation-after-effect', 'lucy-private'],
    ['transient delivery', 'delivery-recovery', 'lucy-private'], ['public final/correction', 'public-result-notification', 'muse-public'],
    ['warmed exact', 'steady-cost', 'cross-channel'],
  ];
  const match = scenarioByName.find(([name]) => t.name.startsWith(name));
  assert.ok(match, 'Every independent fixture case must have a named evidence scenario');
  const [, scenario, channel] = match;
  const costs = h.measurements;
  const latest = [...costs].reverse().find(item => item.ids?.requestId)?.ids || {};
  const correlation = {...emptyCorrelation(), requestId: latest.requestId || null, runId: latest.runId || null,
    originalReplyId: latest.replyId || null, latestResultId: latest.resultId || null, latestResultVersion: latest.resultVersion || null,
    completionEventId: latest.completionEventId || null, completionResultVersion: latest.completionResultVersion || null,
    publicationAttemptId: latest.publicationAttemptId || null};
  const summary = fixtureEnvelope({scenario, channel, correlation, source: emptySource(), facts: emptyFacts(), proofs: emptyProofs(),
    grantBinding: 'not-observed', costs});
  // Numeric counters only. SQLite returned/changed rows are not workerd billing
  // rowsRead/rowsWritten. Never include SQL parameters, URLs, bodies or tokens.
  const output = process.env.RELAY_EXECUTION_COST_DIR;
  if (output) {
    const name = t.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 120);
    mkdirSync(resolve(output), {recursive: true});
    writeFileSync(resolve(output, name + '.json'), JSON.stringify(summary, null, 2) + '\n', {mode: 0o600});
  }
}
async function harness(t) {
  const h = await createExecutionHarness(t);
  t.after(() => dumpCosts(t, h)); return h;
}

boundedTest('HTTP/MCP contract: flat catalog, headers and stage admission fail closed with no writes', async t => {
  const h = await harness(t), {job} = await h.createJob();
  const catalog = await h.rpc(h.auth, 'tools/list');
  const schema = catalog.data.result.tools.find(tool => tool.name === 'relay_owner_job_update').inputSchema;
  for (const name of ['inbox_id', 'job_id', 'run_id', 'event_id', 'stage', 'summary', 'outcome', 'expected_reply_id', 'expected_version'])
    assert.ok(Object.hasOwn(schema.properties, name), 'Host discovery must expose ' + name);
  assert.equal(schema.oneOf, undefined); assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['inbox_id', 'job_id', 'event_id', 'stage']);
  const before = durableSnapshot(h);
  const malformed = await h.rpc(h.auth, 'tools/call', {name: 'relay_owner_job_read', arguments: {inbox_id: RELAY_OWNER_INBOX, job_id: job.id}},
    {'Mcp-Name': 'relay_owner_job_claim'});
  assert.equal(malformed.status, 400); assert.equal(malformed.data.error.code, -32020);
  for (const args of [
    {stage: 'completed', outcome: 'known'},
    {stage: 'running', run_id: uuid(), outcome: 'known'},
    {stage: 'failed', run_id: uuid(), summary: 'Fictional failure without an outcome'},
    {stage: 'completed', run_id: uuid(), expected_reply_id: uuid(), expected_version: 1, summary: 'Fictional unsafe completion', outcome: 'unknown'},
  ]) {
    const denied = await h.rpc(h.auth, 'tools/call', {name: 'relay_owner_job_update',
      arguments: {inbox_id: RELAY_OWNER_INBOX, job_id: job.id, event_id: uuid(), ...args}});
    assert.equal(denied.data.error.code, -32602); assert.equal(denied.data.result, undefined);
  }
  assert.deepEqual(durableSnapshot(h), before, 'Discovery and rejected requests never change durable execution state');
});

boundedTest('Lucy fixture: callback acceptance while phone is absent does not prove execution; checked work does', async t => {
  const h = await harness(t); await h.subscribe();
  const {job} = await h.createJob(), sourceNonce = uuid(); h.sources.set(job.id, sourceNonce);
  // No browser is launched; no phone route is read after submission. This is
  // fixture absence, not evidence of closing a genuine user's browser.
  h.clearMeasurements(); await h.alarm();
  assert.equal(h.notifications.length, 1);
  assert.equal(h.notifications[0].data.message_id, job.id);
  assert.equal(h.notifications[0].data.body_preview, undefined);
  const delivered = (await h.read(job.id)).job;
  assert.equal(delivered.delivery.state, 'callback_accepted');
  assert.equal(delivered.stage, 'queued'); assert.equal(delivered.execution, null); assert.equal(delivered.completion, null);
  assert.equal(h.effectCount(job.id), 0);
  const executed = await h.performFixtureWork(job.id);
  assert.equal(executed.job.stage, 'completed'); assert.equal(h.effectCount(job.id), 1);
  assert.ok(executed.job.result.body.includes(sourceNonce));
  assert.equal(executed.job.completion.runId, executed.job.execution.runId);
  assert.equal(executed.job.completion.replyId, executed.job.result.replyId);
  const repeated = await h.performFixtureWork(job.id);
  assert.equal(repeated.executed, false); assert.equal(h.effectCount(job.id), 1);
  assert.equal(h.measurements.some(item => item.operation.startsWith('/jobs')), false, 'No browser job reads drive execution');
});

boundedTest('Muse fixture: lost hint and absent phone recover through host MCP reads after disk/Hub restart', async t => {
  const h = await harness(t), requestId = uuid();
  assert.equal((await h.http('/shared/messages', {id: requestId, body: MUSE_PREFIX + 'Fictional closed-browser request.'})).status, 201);
  const first = report(requestId);
  // The source publication exists only in a fixed GitHub fixture. Intentionally
  // never send /shared/import-hint or read the phone's /shared/state.
  h.publish(first, 91001);
  await h.restart(); h.clearMeasurements();
  const read = await h.call(h.auth, 'relay_read_public_result', resultArgs(requestId));
  assert.ok(read.reply, 'MCP-only host read must reconcile the independently published final after a lost hint; no browser/HTTP importer may supply it');
  assert.equal(read.reply.id, first.eventId); assert.equal(read.events[0].eventId, first.eventId);
  assert.equal(read.events[0].requestId, requestId); assert.equal(read.events[0].attemptId, first.attemptId);
  assert.equal(read.events[0].execution_authorized, false); assert.equal(read.author_authenticated, false);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n, 1);
  assert.equal(h.measurements.some(item => item.operation === 'http'), false, 'No phone read or publication hint was sent');
  assert.ok(h.measurements.some(item => item.operation === 'relay_read_public_result' && item.upstreamRequests === 1));
  const second = {...first, eventId: uuid(), stage: 'correction', body: 'Fictional later correction.', resultVersion: 2, supersedesEventId: first.eventId};
  h.publish(second, 91002); h.advance(300001); await h.restart();
  const page1 = await h.call(h.auth, 'relay_read_public_result', resultArgs(requestId));
  assert.equal(page1.events.length, 1); assert.equal(page1.reply.id, first.eventId); assert.ok(page1.nextCursor);
  const page2 = await h.call(h.auth, 'relay_read_public_result', {...resultArgs(requestId), cursor: page1.nextCursor});
  assert.equal(page2.events[0].eventId, second.eventId); assert.equal(page2.events[0].resultVersion, 2); assert.equal(page2.nextCursor, null);
  assert.equal(page2.reply.id, first.eventId, 'Correction preserves the immutable initial receipt');
  const legacyRead = await h.rpc(h.auth, 'tools/call', {name: 'relay_read_conversation', arguments: {inbox_id: RELAY_INBOX, message_id: requestId}});
  assert.ok(legacyRead.data.result.content.some(item => item.text?.includes('Later public coordination reports')));
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 0, 'Public Muse reports never authenticate a private execution');
});

boundedTest('Muse fixture: changes-only MCP recovery imports a lost final and later correction across every cursor page', async t => {
  const h = await harness(t), requestId = uuid();
  assert.equal((await h.http('/shared/messages', {id: requestId, body: MUSE_PREFIX + 'Fictional changes-only recovery.'})).status, 201);
  const first = report(requestId); h.publish(first, 91201);
  await h.restart(); h.clearMeasurements();
  const args = {inbox_id: RELAY_INBOX, limit: 1};
  const initial = await h.call(h.auth, 'relay_read_public_changes', args);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n, 1,
    'Changes-only MCP must import the lost final on a fresh fixture; no exact-result/HTTP/state/hint reader may supply it');
  assert.ok(initial.nextCursor, 'The imported final must be observed through the complete changes pagination');
  const collect = async firstPage => {
    const changes = [...firstPage.changes]; let page = firstPage, pages = 1;
    while (page.nextCursor) {
      assert.ok(pages++ < 20, 'Fixture changes pagination must terminate');
      page = await h.call(h.auth, 'relay_read_public_changes', {...args, cursor: page.nextCursor});
      changes.push(...page.changes);
    }
    return {changes, cursor: page.cursor, pages};
  };
  const final = await collect(initial);
  assert.ok(final.pages > 1);
  assert.deepEqual(final.changes.filter(item => item.kind === 'event').map(item => item.event.eventId), [first.eventId]);
  const finalEvent = final.changes.find(item => item.event?.eventId === first.eventId).event;
  assert.equal(finalEvent.requestId, requestId); assert.equal(finalEvent.attemptId, first.attemptId);
  assert.equal(finalEvent.execution_authorized, false); assert.equal(finalEvent.author_authenticated, false);
  const second = {...first, eventId: uuid(), stage: 'correction', resultVersion: 2,
    supersedesEventId: first.eventId, body: 'Fictional correction discovered only by the changes cursor.'};
  h.publish(second, 91202); h.advance(300001); await h.restart();
  const corrected = await collect(await h.call(h.auth, 'relay_read_public_changes', {...args, cursor: final.cursor}));
  assert.deepEqual(corrected.changes.filter(item => item.kind === 'event').map(item => item.event.eventId), [second.eventId]);
  const correction = corrected.changes.find(item => item.event?.eventId === second.eventId).event;
  assert.equal(correction.resultVersion, 2); assert.equal(correction.supersedesEventId, first.eventId);
  assert.equal(correction.attemptId, first.attemptId);
  const immutable = h.rows("SELECT id,body FROM shared_entries WHERE reply_to=? AND kind='reply'", requestId);
  assert.deepEqual(immutable.map(item => ({...item})), [{id: first.eventId, body: first.body}]);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM public_coordination_events')[0].n, 2);
  assert.ok(h.measurements.every(item => item.operation === 'relay_read_public_changes'),
    'Only the changes MCP tool may drive this isolated import; exact readers and phone/import hints remain absent');
  assert.equal(h.measurements.filter(item => item.upstreamRequests === 1).length, 2);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 0);
});

boundedTest('Muse fixture: independent host HTTP read reconciles a lost hint and preserves later corrected results', async t => {
  const h = await harness(t), requestId = uuid();
  assert.equal((await h.http('/shared/messages', {id: requestId, body: MUSE_PREFIX + 'Fictional host HTTP recovery.'})).status, 201);
  const first = report(requestId); h.publish(first, 91501);
  await h.restart(); h.clearMeasurements();
  const restored = await h.http('/shared/result?requestId=' + requestId, undefined, undefined, 'host_public_result_http');
  assert.equal(restored.status, 200); assert.equal(restored.data.reply.id, first.eventId);
  assert.equal(restored.data.events[0].attemptId, first.attemptId);
  const second = {...first, eventId: uuid(), stage: 'correction', resultVersion: 2, supersedesEventId: first.eventId, body: 'Fictional corrected HTTP result.'};
  h.publish(second, 91502); h.advance(300001); await h.restart();
  const page1 = await h.http('/shared/result?requestId=' + requestId + '&limit=1', undefined, undefined, 'host_public_result_http');
  assert.equal(page1.status, 200); assert.equal(page1.data.reply.id, first.eventId); assert.ok(page1.data.nextCursor);
  const page2 = await h.http('/shared/result?requestId=' + requestId + '&limit=1&cursor=' + encodeURIComponent(page1.data.nextCursor), undefined, undefined, 'host_public_result_http');
  assert.equal(page2.data.events[0].eventId, second.eventId); assert.equal(page2.data.nextCursor, null);
  const throughMcp = await h.call(h.auth, 'relay_read_public_result', {...resultArgs(requestId), limit: 100});
  assert.deepEqual(throughMcp.events.map(item => item.eventId), [first.eventId, second.eventId]);
  assert.equal(throughMcp.reply.id, first.eventId);
  assert.equal(throughMcp.execution_authorized, false);
  assert.equal(h.measurements.some(item => item.operation === 'http'), false, 'No browser state or import hint drives recovery');
});

boundedTest('MCP duplicate notifications and competing reply/claim/completion races keep one grant/run/result chain', async t => {
  const h = await harness(t), other = await h.grant(); await h.subscribe();
  const {job} = await h.createJob();
  let release, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  let callbacks = 0;
  h.setCallback(async () => { if (++callbacks === 1) { entered(); await held; return new Response(null, {status: 500}); } return new Response(null, {status: 204}); });
  const firstAlarm = h.alarm(); await enteredPromise;
  await h.alarm(); release(); await firstAlarm;
  assert.equal(h.notifications.length, 2); assert.equal(h.notifications[0].eventId, h.notifications[1].eventId);
  assert.equal(h.rows('SELECT status FROM relay_outbox')[0].status, 'delivered', 'Late failure cannot undo accepted callback');
  assert.equal((await h.read(job.id)).job.stage, 'queued');
  const args = {job_id: job.id, run_id: uuid(), event_id: uuid()};
  const claims = await Promise.all([h.rpc(h.auth, 'tools/call', {name: 'relay_owner_job_claim', arguments: {inbox_id: RELAY_OWNER_INBOX, ...args}}),
    h.rpc(other, 'tools/call', {name: 'relay_owner_job_claim', arguments: {inbox_id: RELAY_OWNER_INBOX, ...args, run_id: uuid(), event_id: uuid()}})]);
  assert.equal(claims.filter(item => item.data.result?.isError === false).length, 1);
  const winner = claims[0].data.result?.isError === false ? h.auth : other;
  const loser = winner === h.auth ? other : h.auth;
  const state = (await h.read(job.id)).job, runId = state.execution.runId;
  const progress = {job_id: job.id, run_id: runId, event_id: uuid(), stage: 'running'};
  await rejectCall(h, 'relay_owner_job_update', progress, loser);
  await rejectCall(h, 'relay_owner_job_update', {...progress, run_id: uuid()}, winner);
  const heartbeat = await h.ownerCall('relay_owner_job_update', progress, winner);
  h.advance(1000);
  const duplicateProgress = await h.ownerCall('relay_owner_job_update', progress, winner);
  assert.equal(duplicateProgress.newWrite, false); assert.deepEqual(duplicateProgress.job.execution, heartbeat.job.execution);
  const replies = await Promise.all(['Fictional result A', 'Fictional conflicting result B'].map(body => h.rpc(winner, 'tools/call', {
    name: 'relay_owner_reply', arguments: {inbox_id: RELAY_OWNER_INBOX, message_id: job.id, body},
  })));
  assert.equal(replies.filter(item => item.data.result?.isError === false).length, 1);
  const available = (await h.read(job.id)).job;
  assert.equal(available.stage, 'outcome_unknown'); assert.equal(available.completion, null);
  const replyReplay = await h.ownerCall('relay_owner_reply', {message_id: job.id, body: available.result.body}, winner);
  assert.equal(replyReplay.newWrite, false); assert.equal(replyReplay.entry.id, available.result.replyId);
  const completion = {job_id: job.id, run_id: runId, event_id: uuid(), stage: 'completed', expected_reply_id: available.result.replyId,
    expected_version: 1, summary: 'Fictional explicit owning-run outcome.', outcome: 'known'};
  const before = durableSnapshot(h);
  await rejectCall(h, 'relay_owner_job_update', completion, loser);
  await rejectCall(h, 'relay_owner_job_update', {...completion, run_id: uuid()}, winner);
  await rejectCall(h, 'relay_owner_job_update', {...completion, expected_reply_id: uuid()}, winner);
  await rejectCall(h, 'relay_owner_job_update', {...completion, expected_version: 2}, winner);
  assert.deepEqual(durableSnapshot(h), before, 'Wrong grant/run/result completions fail without writes');
  const completions = await Promise.all([h.ownerCall('relay_owner_job_update', completion, winner), h.ownerCall('relay_owner_job_update', completion, winner)]);
  assert.deepEqual(completions.map(item => item.newWrite).sort(), [false, true]);
  assert.deepEqual(completions[0].job.completion, completions[1].job.completion);
  assert.equal((await h.read(job.id)).events.filter(event => event.kind === 'work_completed').length, 1);
});

boundedTest('Lucy fixture: later correction remains visible on exact HTTP/MCP reads without cursor advance or recompletion', async t => {
  const h = await harness(t), {job} = await h.createJob(); h.sources.set(job.id, uuid());
  const original = (await h.performFixtureWork(job.id)).job;
  const listed = await h.ownerCall('relay_owner_jobs_list', {limit: 1});
  const expected = {job_id: job.id, expected_reply_id: original.result.replyId, expected_version: 1};
  const corrections = await Promise.all(['Fictional corrected evidence A', 'Fictional corrected evidence B'].map(body => h.rpc(h.auth, 'tools/call', {
    name: 'relay_owner_job_result_correct', arguments: {inbox_id: RELAY_OWNER_INBOX, ...expected, event_id: uuid(), body, correction_summary: 'Fictional independent recheck.'},
  })));
  assert.equal(corrections.filter(item => item.data.result?.isError === false).length, 1);
  await h.restart();
  const read = await h.read(job.id), phone = await h.phone('/jobs/detail?job_id=' + job.id);
  assert.equal(phone.status, 200); assert.equal(phone.data.job.latestResult.version, 2);
  assert.equal(read.job.resultVersion, 2); assert.equal(read.resultHistory.length, 2);
  assert.equal(read.job.result.replyId, original.result.replyId); assert.equal(read.job.result.body, original.result.body);
  assert.deepEqual(read.job.completion, original.completion); assert.equal(read.job.completion.resultVersion, 1);
  assert.equal(h.effectCount(job.id), 1);
  const cursorAfterCorrection = String(listed.jobs[0].sequence);
  const later = await h.ownerCall('relay_owner_jobs_list', {cursor: cursorAfterCorrection, limit: 1});
  assert.equal(later.jobs.length, 0, 'Creation cursor does not discover changes to an already answered job');
  const conversation = await h.rpc(h.auth, 'tools/call', {name: 'relay_owner_read_conversation', arguments: {inbox_id: RELAY_OWNER_INBOX, message_id: job.id}});
  const lifecycle = conversation.data.result.content.find(item => item.text?.startsWith('Private job lifecycle'));
  assert.ok(lifecycle.text.includes(read.job.latestResult.id));
});

boundedTest('expired and permanently failed subscription routes are visible and cannot claim or retry work', async t => {
  for (const mode of ['expired', 'http410', 'http413']) await t.test(mode, async sub => {
    const h = await harness(sub); await h.subscribe(h.subscription(RELAY_OWNER_EVENT, RELAY_OWNER_INBOX, mode === 'expired' ? {ttlMs: 100} : {}));
    const {job} = await h.createJob();
    if (mode === 'expired') h.advance(101);
    else h.setCallback(async () => new Response(null, {status: mode === 'http410' ? 410 : 413}));
    await h.alarm();
    const state = (await h.read(job.id)).job;
    assert.equal(state.stage, 'queued'); assert.equal(state.execution, null); assert.equal(state.completion, null);
    const status = await h.ownerCall('relay_owner_subscription_status', {});
    assert.equal(status.unfilteredActive, 0);
    assert.equal(status.deliveryFailed, mode === 'http413' ? 1 : 0);
    assert.equal(state.delivery.retryable, false);
    const recovery = await h.phone('/delivery/retry', {message_id: job.id});
    assert.equal(recovery.status, 200); assert.equal(recovery.data.retried, 0, 'Ineligible delivery retry is an explicit no-op');
    assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 1);
    assert.equal(h.effectCount(job.id), 0);
  });
});

boundedTest('recovery after expired consequential execution settles the original run without replaying its local effect', async t => {
  const h = await harness(t); await h.subscribe();
  const {job} = await h.createJob({action_kind: 'consequential'}); h.sources.set(job.id, uuid());
  const first = await h.performFixtureWork(job.id, {stopAfterEffect: true});
  assert.equal(h.effectCount(job.id), 1);
  h.advance(300001); await h.restart();
  const unknown = (await h.read(job.id)).job;
  assert.equal(unknown.stage, 'outcome_unknown'); assert.equal(unknown.execution.runId, first.runId);
  const forbidden = await h.phone('/jobs/retry', {job_id: job.id, id: uuid(), confirm_duplicate_risk: true});
  assert.equal(forbidden.status, 409, 'Consequential unknown outcome cannot authorize another execution');
  await rejectCall(h, 'relay_owner_job_claim', {job_id: job.id, run_id: uuid(), event_id: uuid()});
  const recovered = await h.performFixtureWork(job.id);
  assert.equal(recovered.executed, false, 'The persisted local effect is reconciled, never repeated');
  const reconciled = recovered.job;
  assert.equal(reconciled.stage, 'completed'); assert.equal(reconciled.completion.runId, first.runId);
  assert.deepEqual(reconciled.execution, unknown.execution, 'Terminal reconciliation never renews the expired lease');
  assert.equal(h.effectCount(job.id), 1);
  const repeated = await h.performFixtureWork(job.id);
  assert.equal(repeated.executed, false); assert.equal(h.effectCount(job.id), 1);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 1);
});

boundedTest('transient delivery recovery is idempotent metadata recovery and does not repeat consequential work', async t => {
  const h = await harness(t); await h.subscribe();
  const {job} = await h.createJob({action_kind: 'consequential'}); h.sources.set(job.id, uuid());
  h.setCallback(async () => new Response(null, {status: 503}));
  for (let attempt = 0; attempt < 6; attempt++) { await h.alarm(); h.advance(32000); }
  const failed = (await h.read(job.id)).job;
  assert.equal(failed.delivery.state, 'delivery_failed'); assert.equal(failed.delivery.retryable, true);
  const subscriptionBefore = h.rows('SELECT grant_id,generation,expires_ms,callback,secret FROM relay_subscriptions');
  const recovered = await h.phone('/delivery/retry', {message_id: job.id});
  assert.equal(recovered.status, 200); assert.equal(recovered.data.retried, 1);
  const exactReplay = await h.phone('/delivery/retry', {message_id: job.id});
  assert.equal(exactReplay.status, 200); assert.equal(exactReplay.data.retried, 0);
  assert.deepEqual(h.rows('SELECT grant_id,generation,expires_ms,callback,secret FROM relay_subscriptions'), subscriptionBefore);
  assert.equal(h.effectCount(job.id), 0);
  h.setCallback(async () => new Response(null, {status: 204})); await h.alarm();
  const completed = await h.performFixtureWork(job.id);
  assert.equal(completed.job.stage, 'completed'); assert.equal(h.effectCount(job.id), 1);
  const replay = await h.phone('/delivery/retry', {message_id: job.id});
  assert.equal(replay.status, 200); assert.equal(replay.data.retried, 0);
  await h.performFixtureWork(job.id); assert.equal(h.effectCount(job.id), 1);
});

boundedTest('lost claim response survives a real post-commit socket drop and executor restart; expired unused work stays blocked', async t => {
  const h = await harness(t), {job} = await h.createJob({action_kind: 'consequential'}); h.sources.set(job.id, uuid());
  h.dropNextRpcResponse('relay_owner_job_claim', job.id);
  await assert.rejects(() => h.performFixtureWork(job.id), error => error instanceof TypeError && error.cause?.code === 'UND_ERR_SOCKET');
  assert.equal(h.droppedResponses.length, 1);
  const pending = h.fixtureIntent(job.id);
  assert.equal(h.droppedResponses[0].runId, pending.runId); assert.equal(h.droppedResponses[0].eventId, pending.claimEventId);
  const lost = h.measurements.find(item => item.operation === 'relay_owner_job_claim' && item.transportFailed);
  assert.equal(lost.fixtureWorkerCommitObserved, true); assert.equal(lost.httpStatus, undefined, 'Client received no response status or body');
  assert.equal(lost.ids.eventId, pending.claimEventId);
  assert.equal(h.effectCount(job.id), 0);
  const before = (await h.read(job.id)).job.execution;
  assert.equal(before.runId, pending.runId);
  assert.equal((await h.read(job.id)).events.filter(event => event.kind === 'claimed')[0].id, pending.claimEventId);
  h.advance(1000); await h.restart();
  assert.deepEqual(h.fixtureIntent(job.id), pending);
  const resumed = await h.performFixtureWork(job.id);
  assert.equal(resumed.job.completion.runId, pending.runId);
  assert.equal(resumed.claimNewWrite, false, 'Same persisted claim/event retries after ambiguous delivery');
  assert.deepEqual(resumed.job.execution, before);
  assert.equal(h.effectCount(job.id), 1);
  assert.equal((await h.read(job.id)).events.filter(event => event.kind === 'claimed').length, 1);
  const unused = await h.createJob({action_kind: 'consequential'}); h.sources.set(unused.job.id, uuid());
  await h.performFixtureWork(unused.job.id, {stopAfterClaim: true});
  h.advance(300001); await h.restart();
  await assert.rejects(() => h.performFixtureWork(unused.job.id), /cannot start with an expired\/blocked execution lease/);
  assert.equal(h.effectCount(unused.job.id), 0);
  assert.equal((await h.read(unused.job.id)).job.stage, 'outcome_unknown');
  assert.equal((await h.read(unused.job.id)).job.completion, null);
});

boundedTest('lost completion response replays the persisted exact payload after a socket drop, correction and restart', async t => {
  const h = await harness(t), {job} = await h.createJob({action_kind: 'consequential'}); h.sources.set(job.id, uuid());
  h.dropNextRpcResponse('relay_owner_job_update', job.id, 'completed');
  await assert.rejects(() => h.performFixtureWork(job.id), error => error instanceof TypeError && error.cause?.code === 'UND_ERR_SOCKET');
  const intent = h.fixtureIntent(job.id), payload = intent.completionPayload;
  assert.ok(payload); assert.equal(h.droppedResponses.length, 1);
  assert.equal(payload.inbox_id, RELAY_OWNER_INBOX); assert.equal(payload.job_id, job.id);
  assert.equal(h.droppedResponses[0].eventId, payload.event_id);
  const lost = h.measurements.find(item => item.operation === 'relay_owner_job_update' && item.transportFailed);
  assert.equal(lost.fixtureWorkerCommitObserved, true); assert.equal(lost.httpStatus, undefined);
  assert.equal(lost.ids.eventId, payload.event_id); assert.equal(h.effectCount(job.id), 1);
  const accepted = (await h.read(job.id)).job;
  assert.equal(accepted.completion.eventId, payload.event_id); assert.equal(accepted.completion.runId, payload.run_id);
  assert.equal(accepted.completion.replyId, payload.expected_reply_id); assert.equal(accepted.completion.resultVersion, payload.expected_version);
  await h.ownerCall('relay_owner_job_result_correct', {job_id: job.id, event_id: uuid(), expected_reply_id: payload.expected_reply_id,
    expected_version: 1, body: 'Fictional harmless late correction after the dropped terminal response.', correction_summary: 'Fictional independent recheck.'});
  h.advance(300001); await h.restart();
  assert.deepEqual(h.fixtureIntent(job.id), intent, 'Disk ledger preserves the full terminal payload and original result version');
  const recovered = await h.performFixtureWork(job.id);
  assert.equal(recovered.executed, false); assert.equal(recovered.completionNewWrite, false);
  assert.equal(h.effectCount(job.id), 1); assert.deepEqual(recovered.job.execution, accepted.execution);
  assert.deepEqual(recovered.job.completion, accepted.completion); assert.equal(recovered.job.resultVersion, 2);
  const replay = h.measurements.filter(item => item.operation === 'relay_owner_job_update').at(-1);
  assert.equal(replay.ids.eventId, payload.event_id); assert.equal(replay.ids.completionResultVersion, 1);
  const journal = (await h.read(job.id)).events;
  assert.equal(journal.filter(event => event.kind === 'claimed').length, 1);
  assert.equal(journal.filter(event => event.kind === 'work_completed').length, 1);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 1);
});

boundedTest('cancellation before the effect is acknowledged by the owning run after restart with zero execution', async t => {
  const h = await harness(t), {job} = await h.createJob({action_kind: 'consequential'}); h.sources.set(job.id, uuid());
  const started = await h.performFixtureWork(job.id, {stopAfterClaim: true});
  const claimed = (await h.read(job.id)).job.execution;
  assert.equal(h.effectCount(job.id), 0);
  const cancel = await h.phone('/jobs/cancel', {job_id: job.id});
  assert.equal(cancel.status, 201); assert.equal(cancel.data.job.cancelRequested, true);
  assert.equal(cancel.data.job.stage, 'running', 'Running alone cannot allow an executor to ignore cancellation');
  const requestedAt = cancel.data.job.cancelRequestedAt;
  await rejectCall(h, 'relay_owner_job_update', {job_id: job.id, run_id: started.runId, event_id: uuid(), stage: 'cancelled',
    summary: 'Fictional wrong grant cannot attest a stopped run.', outcome: 'not_started'}, await h.grant());
  h.advance(1000); await h.restart();
  const stopped = await h.performFixtureWork(job.id);
  assert.equal(stopped.executed, false); assert.equal(stopped.cancellationNewWrite, true);
  assert.equal(stopped.job.stage, 'cancelled');
  assert.equal(h.rows('SELECT outcome FROM relay_owner_jobs WHERE id=?', job.id)[0].outcome, 'not_started');
  assert.ok(Number.isFinite(Date.parse(claimed.leaseExpiresAt)));
  assert.equal(stopped.job.execution.runId, started.runId); assert.equal(stopped.job.execution.leaseExpiresAt, claimed.leaseExpiresAt);
  assert.equal(stopped.job.cancelRequested, true); assert.equal(stopped.job.cancelRequestedAt, requestedAt);
  assert.equal(stopped.job.result, null); assert.equal(stopped.job.completion, null); assert.equal(h.effectCount(job.id), 0);
  const intent = h.fixtureIntent(job.id);
  assert.equal(intent.cancellationPayload.run_id, started.runId); assert.equal(intent.cancellationPayload.outcome, 'not_started');
  const beforeReplay = durableSnapshot(h); await h.restart();
  const replay = await h.performFixtureWork(job.id);
  assert.equal(replay.executed, false); assert.equal(replay.cancellationNewWrite, false);
  assert.deepEqual(h.fixtureIntent(job.id), intent); assert.deepEqual(durableSnapshot(h), beforeReplay);
  assert.equal(h.effectCount(job.id), 0);
  const events = (await h.read(job.id)).events;
  assert.equal(events.filter(event => event.kind === 'claimed').length, 1);
  assert.equal(events.filter(event => event.kind === 'cancellation_requested').length, 1);
  assert.equal(events.filter(event => event.kind === 'cancelled').length, 1);
});

boundedTest('cancellation after the effect reconciles known completion without repeating work or clearing cancellation history', async t => {
  const h = await harness(t), {job} = await h.createJob({action_kind: 'consequential'}); h.sources.set(job.id, uuid());
  const performed = await h.performFixtureWork(job.id, {stopAfterEffect: true});
  const execution = (await h.read(job.id)).job.execution;
  assert.equal(h.effectCount(job.id), 1);
  const cancel = await h.phone('/jobs/cancel', {job_id: job.id});
  assert.equal(cancel.status, 201); const requestedAt = cancel.data.job.cancelRequestedAt;
  h.advance(300001); await h.restart();
  const known = await h.performFixtureWork(job.id);
  assert.equal(known.executed, false); assert.equal(known.job.stage, 'completed');
  assert.equal(h.rows('SELECT outcome FROM relay_owner_jobs WHERE id=?', job.id)[0].outcome, 'known');
  assert.equal(known.job.completion.runId, performed.runId); assert.deepEqual(known.job.execution, execution);
  assert.equal(known.job.cancelRequested, true); assert.equal(known.job.cancelRequestedAt, requestedAt);
  assert.equal(known.job.retryAllowed, false); assert.equal(h.effectCount(job.id), 1);
  await h.restart(); const replay = await h.performFixtureWork(job.id);
  assert.equal(replay.executed, false); assert.equal(replay.completionNewWrite, false);
  assert.deepEqual(replay.job.completion, known.job.completion); assert.equal(h.effectCount(job.id), 1);
  const events = (await h.read(job.id)).events;
  assert.equal(events.filter(event => event.kind === 'claimed').length, 1);
  assert.equal(events.filter(event => event.kind === 'cancellation_requested').length, 1);
  assert.equal(events.filter(event => event.kind === 'cancelled').length, 0);
  assert.equal(events.filter(event => event.kind === 'work_completed').length, 1);
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_owner_jobs')[0].n, 1);
});

boundedTest('public final/correction notifications are updates only and never wake the original message subscription', async t => {
  const h = await harness(t); await h.subscribe(h.subscription(RELAY_EVENT, RELAY_INBOX));
  const requestId = uuid(); await h.http('/shared/messages', {id: requestId, body: MUSE_PREFIX + 'Fictional public report request.'});
  await h.alarm(); assert.equal(h.notifications.length, 1); assert.equal(h.notifications[0].name, RELAY_EVENT);
  const page = await h.rpc(h.auth, 'events/list'); assert.equal(page.data.result.nextCursor, 'public-coordination-v2');
  const next = await h.rpc(h.auth, 'events/list', {cursor: page.data.result.nextCursor});
  assert.equal(next.data.result.events[0].name, 'relay.public.result.changed');
  await h.subscribe(h.subscription('relay.public.result.changed', RELAY_INBOX, {arguments: {inbox_id: RELAY_INBOX, request_id: requestId}}));
  const first = report(requestId); h.publish(first, 92001);
  const imported = await h.http('/shared/import-hint', {commentId: 92001}); assert.equal(imported.status, 200);
  await h.alarm();
  const update = h.notifications.at(-1);
  assert.equal(update.name, 'relay.public.result.changed'); assert.equal(update.data.message_id, requestId);
  assert.equal(update.data.should_execute, false); assert.equal(update.data.execution_authorized, false);
  assert.equal(h.notifications.filter(item => item.name === RELAY_EVENT).length, 1);
  const second = {...first, eventId: uuid(), stage: 'correction', body: 'Fictional corrected public result.', resultVersion: 2, supersedesEventId: first.eventId};
  h.publish(second, 92002);
  assert.equal((await h.http('/shared/import-hint', {commentId: 92002})).status, 200); await h.alarm();
  assert.equal(h.notifications.at(-1).data.coordination_event_id, second.eventId);
  assert.equal(h.notifications.at(-1).data.should_execute, false);
  assert.equal(h.notifications.filter(item => item.name === RELAY_EVENT).length, 1);
});

boundedTest('warmed exact HTTP/MCP reads have stable operation counts without imported-history read amplification', async t => {
  const h = await harness(t), {job} = await h.createJob();
  const requestId = uuid(); await h.http('/shared/messages', {id: requestId, body: MUSE_PREFIX + 'Fictional warmed exact result.'});
  const first = report(requestId); h.publish(first, 93001);
  const second = {...first, eventId: uuid(), stage: 'correction', resultVersion: 2,
    supersedesEventId: first.eventId, body: 'Fictional warmed corrected result.'};
  h.publish(second, 93002);
  const imported = await h.http('/shared/result?requestId=' + requestId);
  assert.equal(imported.data.reply.id, first.eventId, 'The HTTP importer must be warmed independently of the MCP projection');
  const populatedRead = async () => {
    const result = await h.call(h.auth, 'relay_read_public_result', {...resultArgs(requestId), limit: 100});
    assert.equal(result.reply.id, first.eventId);
    assert.deepEqual(result.events.map(item => [item.eventId, item.resultVersion]), [[first.eventId, 1], [second.eventId, 2]]);
  };
  await populatedRead();
  await h.read(job.id); h.clearMeasurements();
  for (let attempt = 0; attempt < 3; attempt++) {
    await h.read(job.id); await populatedRead();
  }
  const before = h.measurements.map(({elapsedMs, requestBytes, responseBytes, ...counts}) => counts);
  // Seed only background history, outside the measured boundary. The exact
  // source result and owner job stay the same; the steady-state cooldown holds.
  const ctx = h.rows('PRAGMA table_info(imported_comments)'); assert.ok(ctx.length);
  const hostRows = 2500;
  h.rows("INSERT INTO imported_comments(comment_id,publication,imported) WITH RECURSIVE n(v) AS (VALUES(100000) UNION ALL SELECT v+1 FROM n WHERE v<100000+?) SELECT v,'{}',1 FROM n", hostRows - 1);
  h.clearMeasurements();
  for (let attempt = 0; attempt < 3; attempt++) {
    await h.read(job.id); await populatedRead();
  }
  const after = h.measurements.map(({elapsedMs, requestBytes, responseBytes, ...counts}) => counts);
  assert.deepEqual(after, before, 'Stable statement/returned-row/change/egress counts at 0 and 2500 processed comments');
  assert.equal(h.measurements.some(item => item.upstreamRequests), false);
  assert.ok(h.measurements.every(item => item.sqlStatements > 0 && item.sqliteReturnedRows > 0), 'Cost samples must contain real database work');
  assert.ok(h.measurements.every(item => item.sqliteChangedRows < 12 && item.sqliteReturnedRows < 100));
});
