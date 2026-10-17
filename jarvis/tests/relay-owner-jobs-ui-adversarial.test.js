import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture, deferred, SITE, WORKER, OWNER_KEY} from './helpers/relay-conversation-browser-fixture.js';
import {createRelayOwnerApi} from '../public/assets/relay-owner-api.js';
import {createRelayOwnerController} from '../public/assets/relay-owner-ui.js';
import {RELAY_OWNER_INBOX} from '../backend/relay-common.js';

async function client(t, intercept = async (_request, response) => response) {
  const h = createConversationFixture(t); t.after(() => h.close());
  const owner = await h.oauth(), phone = await h.pair(owner), calls = [];
  const values = new Map([[OWNER_KEY, JSON.stringify({device_token: phone.device_token, device_id: phone.device.id})]]);
  const api = createRelayOwnerApi({origin: WORKER, storage: {getItem: key => values.get(key) ?? null, removeItem: key => values.delete(key)},
    fetcher: async (url, options) => {
      const request = {url, options, path: new URL(url).pathname}; calls.push(request);
      assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
      assert.equal(new URL(url).search.includes(phone.device_token), false);
      const response = await h.fixture.request(new URL(url).pathname + new URL(url).search, {...options, headers: {...options.headers, Origin: SITE}});
      return intercept(request, response);
    }});
  return {h, owner, phone, api, calls, values};
}
async function job(f, options = {}) {
  const id = options.id || crypto.randomUUID();
  const response = await f.h.phone('/jobs', {id, title: options.title || 'Synthetic client request', body: options.body || 'Synthetic private client text', action_kind: options.actionKind || 'read_only'}, f.phone.device_token);
  assert.equal(response.status, 201); return (await response.json()).job;
}

test('old reply-only completed responses remain completion unverified for acknowledgements, blockers and reports', async t => {
  for (const body of [
    'Fictional acknowledgement: I received this request.',
    'Fictional blocker: I need the source file before continuing.',
    'Fictional report excerpt without a work-completion attestation.'
  ]) await t.test(body, async t => {
    const f = await client(t, async (request, response) => {
      if (!request.path.endsWith('/jobs/detail')) return response;
      const value = await response.json();
      if (value.job.result) {
        delete value.job.completion;
        value.job.stage = 'completed'; value.job.finishedAt = value.job.result.createdAt;
        value.job.failure = null; value.job.retryAllowed = true; value.job.retryRequiresConfirmation = false;
      }
      return Response.json(value);
    });
    const saved = await job(f);
    await f.h.rpc(f.owner, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: saved.id, body});
    const detail = await f.api.jobDetail(saved.id);
    assert.equal(detail.job.stage, 'outcome_unknown');
    assert.equal(detail.job.completion, null); assert.equal(detail.job.finishedAt, null);
    assert.equal(detail.job.failure.code, 'completion_unverified'); assert.equal(detail.job.failure.outcome, 'unknown');
    assert.equal(detail.job.retryAllowed, false, 'Legacy completed flags cannot infer safe permission to repeat work');
    assert.equal(detail.job.result.body, body); assert.equal(detail.job.latestResult.body, body);
    assert.equal(detail.resultHistory[0].body, body);
  });
});

test('typed private completion binds the authenticated run, immutable reply and bounded version without replacing corrections', async t => {
  let mutation = value => value;
  const f = await client(t, async (request, response) => request.path.endsWith('/jobs/detail') ? Response.json(mutation(await response.json())) : response);
  const saved = await job(f), runId = crypto.randomUUID();
  await f.h.rpc(f.owner, 'relay_owner_job_claim', {inbox_id: RELAY_OWNER_INBOX, job_id: saved.id, run_id: runId, event_id: crypto.randomUUID()});
  const reply = await f.h.rpc(f.owner, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: saved.id, body: 'Fictional immutable available report'});
  const eventId = crypto.randomUUID(), summary = 'Fictional completion attestation for the prepared report; factual claims still need checking.';
  await f.h.rpc(f.owner, 'relay_owner_job_update', {inbox_id: RELAY_OWNER_INBOX, job_id: saved.id, run_id: runId, event_id: eventId,
    stage: 'completed', outcome: 'known', expected_reply_id: reply.entry.id, expected_version: 1, summary});
  await f.h.rpc(f.owner, 'relay_owner_job_result_correct', {inbox_id: RELAY_OWNER_INBOX, job_id: saved.id, event_id: crypto.randomUUID(),
    expected_reply_id: reply.entry.id, expected_version: 1, body: 'Fictional corrected report available after the earlier completion attestation.', correction_summary: 'Checked the fictional source and corrected the reply text.'});
  const genuine = await f.api.jobDetail(saved.id);
  assert.equal(genuine.job.stage, 'completed'); assert.equal(genuine.job.completion.eventId, eventId);
  assert.equal(genuine.job.completion.runId, runId); assert.equal(genuine.job.completion.replyId, reply.entry.id);
  assert.equal(genuine.job.completion.resultVersion, 1); assert.equal(genuine.job.resultVersion, 2);
  assert.equal(genuine.job.completion.summary, summary); assert.equal(genuine.job.finishedAt, genuine.job.completion.createdAt);
  assert.equal(genuine.job.result.body, 'Fictional immutable available report'); assert.match(genuine.job.latestResult.body, /corrected report/);
  for (const [label, alter] of [
    ['invalid completion event identity', value => {value.job.completion.eventId = 'fictional-unreadable-event';}],
    ['completion reuses the immutable reply identity', value => {value.job.completion.eventId = value.job.result.replyId;}],
    ['completion from another run', value => {value.job.completion.runId = crypto.randomUUID();}],
    ['completion of another immutable reply', value => {value.job.completion.replyId = crypto.randomUUID();}],
    ['zero completion version', value => {value.job.completion.resultVersion = 0;}],
    ['completion version beyond current correction', value => {value.job.completion.resultVersion = 3;}],
    ['unbounded completion version', value => {value.job.completion.resultVersion = 6;}],
    ['public completion evidence', value => {value.job.completion.visibility = 'public';}],
    ['unauthenticated completion evidence', value => {value.job.completion.author_authenticated = false;}],
    ['device-supplied completion evidence', value => {value.job.completion.authentication_source = 'owner-device-session';}],
    ['empty completion summary', value => {value.job.completion.summary = ' ';}],
    ['oversized completion summary', value => {value.job.completion.summary = 'x'.repeat(1001);}],
    ['invalid completion date', value => {value.job.completion.createdAt = 'fictional invalid date';}],
    ['completion time differs from terminal time', value => {value.job.finishedAt = null;}],
    ['completion lacks execution evidence', value => {value.job.execution = null;}],
    ['completion conflicts with waiting state', value => {value.job.stage = 'waiting_for_owner';}],
    ['completion conflicts with failure state', value => {value.job.stage = 'failed';}]
  ]) {
    mutation = value => {alter(value); return value;};
    await assert.rejects(() => f.api.jobDetail(saved.id), error => error.kind === 'invalid', label);
    assert.equal(f.api.hasCredential, true, 'Invalid completion evidence cannot masquerade as session expiry');
  }
  const unexpected = 'FICTIONAL-UNEXPECTED-COMPLETION-FIELD';
  mutation = value => ({...value, job: {...value.job, completion: {...value.job.completion, unexpected}}});
  assert.equal(JSON.stringify(await f.api.jobDetail(saved.id)).includes(unexpected), false, 'Only inert bounded contract fields reach the inspector');
  mutation = value => {delete value.job.completion; return value;};
  const legacy = await f.api.jobDetail(saved.id);
  assert.equal(legacy.job.stage, 'outcome_unknown'); assert.equal(legacy.job.finishedAt, null); assert.equal(legacy.job.retryAllowed, false);
  assert.equal(legacy.job.result.body, genuine.job.result.body); assert.deepEqual(legacy.job.latestResult, genuine.job.latestResult);
  assert.deepEqual(legacy.resultHistory, genuine.resultHistory, 'Legacy completion normalization never drops available original or corrected text');
});

test('controller API stubs cannot upgrade a saved reply to completed work or infer a safe retry', async t => {
  const f = await client(t), saved = await job(f);
  await f.h.rpc(f.owner, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: saved.id, body: 'Fictional controller reply without typed completion'});
  const raw = await (await f.h.phone('/jobs/detail?job_id=' + saved.id, undefined, f.phone.device_token)).json();
  delete raw.job.completion; raw.job.stage = 'completed'; raw.job.finishedAt = raw.job.result.createdAt;
  raw.job.failure = null; raw.job.retryAllowed = true;
  const c = createRelayOwnerController({api: {...f.api, jobs: async () => ({jobs: [structuredClone(raw.job)], nextCursor: null}), jobDetail: async () => structuredClone(raw)}});
  await c.refresh(); c.setDraft('Fictional separate controller draft');
  await c.inspectJob(saved.id);
  for (const observed of [c.snapshot().jobs[0], c.snapshot().jobDetail.job]) {
    assert.equal(observed.stage, 'outcome_unknown'); assert.equal(observed.finishedAt, null); assert.equal(observed.completion, null);
    assert.equal(observed.retryAllowed, false); assert.equal(observed.result.body, raw.job.result.body);
  }
  assert.equal(c.snapshot().draft, 'Fictional separate controller draft');
});

test('typed waiting-for-owner evidence keeps its blocker state when an immutable reply becomes available', async t => {
  const f = await client(t), saved = await job(f), runId = crypto.randomUUID();
  await f.h.rpc(f.owner, 'relay_owner_job_claim', {inbox_id: RELAY_OWNER_INBOX, job_id: saved.id, run_id: runId, event_id: crypto.randomUUID()});
  await f.h.rpc(f.owner, 'relay_owner_job_update', {inbox_id: RELAY_OWNER_INBOX, job_id: saved.id, run_id: runId, event_id: crypto.randomUUID(),
    stage: 'waiting_for_owner', outcome: 'unknown', summary: 'Fictional typed blocker: please supply the source file.'});
  await f.h.rpc(f.owner, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: saved.id, body: 'Fictional available reply with a separately attested waiting state.'});
  const detail = await f.api.jobDetail(saved.id);
  assert.equal(detail.job.stage, 'waiting_for_owner'); assert.equal(detail.job.completion, null); assert.equal(detail.job.finishedAt, null);
  assert.match(detail.job.result.body, /separately attested waiting state/); assert.equal(detail.job.retryAllowed, false);
});

test('private job client rejects forged provenance and executable result formats while dropping unexpected nested secrets', async t => {
  let mutation = value => value;
  const f = await client(t, async (request, response) => request.path.endsWith('/jobs/detail') ? Response.json(mutation(await response.json())) : response);
  const saved = await job(f);
  for (const mutate of [
    value => ({...value, job: {...value.job, visibility: 'public'}}),
    value => ({...value, job: {...value.job, author_authenticated: false}}),
    value => ({...value, job: {...value.job, principal: 'github:999'}}),
    value => ({...value, job: {...value.job, messageId: crypto.randomUUID()}}),
    value => ({...value, job: {...value.job, stage: 'running', execution: null}}),
    value => ({...value, job: {...value.job, stage: 'completed', result: null}}),
    value => ({...value, job: {...value.job, result: {format: 'html', body: '<script>unsafe</script>', replyId: crypto.randomUUID(), createdAt: new Date().toISOString()}}}),
    value => ({...value, events: value.events.map(event => ({...event, jobId: crypto.randomUUID()}))}),
  ]) {
    mutation = mutate;
    await assert.rejects(() => f.api.jobDetail(saved.id), error => error.kind === 'invalid');
    assert.equal(f.api.hasCredential, true, 'Malformed lifecycle evidence cannot masquerade as logout');
  }
  await f.h.rpc(f.owner, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: saved.id, body: 'Fictional saved result'});
  const secret = 'SYNTHETIC-EXTRA-SECRET-2354';
  mutation = value => ({...value, credential: secret, job: {...value.job, html: secret, device_token: secret,
    execution: {runId: crypto.randomUUID(), acknowledgedAt: value.job.createdAt, leaseExpiresAt: value.job.createdAt, secret},
    result: {...value.job.result, secret}, latestResult: {...value.job.latestResult, secret},
    failure: {code: 'synthetic', message: 'Fictional failure summary', outcome: 'not_started', secret},
    delivery: {...value.job.delivery, callback_url: secret}}, events: value.events.map(event => ({...event, secret})),
    resultHistory: value.resultHistory.map(record => ({...record, secret}))});
  const projected = await f.api.jobDetail(saved.id);
  assert.equal(JSON.stringify(projected).includes(secret), false, 'Unexpected nested credentials/transport/HTML fields stay outside controller data');
  assert.equal(projected.job.result.body, 'Fictional saved result');
});

test('private corrections require bounded associated history, exact latest evidence and authenticated provenance', async t => {
  let mutation = value => value;
  const f = await client(t, async (request, response) => request.path.endsWith('/jobs/detail') ? Response.json(mutation(await response.json())) : response);
  const saved = await job(f), original = 'PRIVATE-CORRECTION-ORIGINAL-1168';
  const reply = await f.h.rpc(f.owner, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: saved.id, body: original});
  for (const version of [1, 2]) {
    const accepted = await f.h.rpc(f.owner, 'relay_owner_job_result_correct', {inbox_id: RELAY_OWNER_INBOX, job_id: saved.id,
      expected_reply_id: reply.entry.id, expected_version: version, event_id: crypto.randomUUID(),
      body: `Fictional authenticated correction ${version + 1}`, correction_summary: `Checked synthetic source ${version} and corrected its interpretation.`});
    assert.equal(accepted.newWrite, true); assert.equal(accepted.job.resultVersion, version + 1);
  }
  const genuine = await f.api.jobDetail(saved.id);
  assert.equal(genuine.job.result.body, original);
  assert.equal(genuine.job.latestResult.body, 'Fictional authenticated correction 3');
  assert.deepEqual(genuine.resultHistory.map(record => record.version), [1, 2, 3]);
  const cases = [
    ['unbounded revision count', value => {value.job.resultVersion = 6;}],
    ['completed result concealed as version zero', value => {value.job.resultVersion = 0;}],
    ['latest revision number mismatch', value => {value.job.latestResult.version = 2;}],
    ['latest correction reuses original reply identifier', value => {value.job.latestResult.id = value.job.result.replyId;}],
    ['another original reply association', value => {value.job.latestResult.replyId = crypto.randomUUID();}],
    ['public correction provenance', value => {value.job.latestResult.visibility = 'public';}],
    ['unauthenticated correction provenance', value => {value.job.latestResult.author_authenticated = false;}],
    ['device session pretending to author correction', value => {value.job.latestResult.authentication_source = 'owner-device-session';}],
    ['executable correction format', value => {value.job.latestResult.format = 'html';}],
    ['oversized correction body', value => {value.job.latestResult.body = 'x'.repeat(6001);}],
    ['empty correction rationale', value => {value.job.latestResult.correctionSummary = ' ';}],
    ['oversized correction rationale', value => {value.job.latestResult.correctionSummary = 'x'.repeat(1001);}],
    ['missing original history', value => {value.resultHistory.shift();}],
    ['history over five results', value => {value.resultHistory.push(...value.resultHistory);}],
    ['reordered history', value => {value.resultHistory.reverse();}],
    ['duplicate history version', value => {value.resultHistory[1] = {...value.resultHistory[0]};}],
    ['reused immutable history identifier', value => {value.resultHistory[1].id = value.resultHistory[0].id;}],
    ['historical correction for another reply', value => {value.resultHistory[1].replyId = crypto.randomUUID();}],
    ['unauthenticated historical correction', value => {value.resultHistory[1].author_authenticated = false;}],
    ['changed original immutable body', value => {value.resultHistory[0].body = 'A replacement initial answer';}],
    ['latest body differs from final history record', value => {value.resultHistory[2].body = 'A stale correction';}],
    ['latest rationale differs from final history record', value => {value.resultHistory[2].correctionSummary = 'A different rationale';}],
  ];
  for (const [label, alter] of cases) {
    mutation = value => {alter(value); return value;};
    await assert.rejects(() => f.api.jobDetail(saved.id), error => error.kind === 'invalid', label);
    assert.equal(f.api.hasCredential, true, 'Invalid revision evidence is not authentication failure');
  }
  const secret = 'SYNTHETIC-CORRECTION-UNEXPECTED-SECRET-9903';
  mutation = value => ({...value, secret, job: {...value.job, latestResult: {...value.job.latestResult, secret}},
    resultHistory: value.resultHistory.map(record => ({...record, secret}))});
  const projected = await f.api.jobDetail(saved.id);
  assert.equal(JSON.stringify(projected).includes(secret), false);
  assert.equal(projected.job.result.body, original);
  assert.equal(projected.job.resultVersion, 3);
  assert.deepEqual(projected.job.latestResult, projected.resultHistory.at(-1));
  assert.equal(JSON.stringify([...f.values.values()]).includes(original), false, 'Result history remains outside persistent credential storage');
});

test('a stale private inspector after server expiry cannot revive jobs/results; only the existing unsent draft remains', async t => {
  const entered = deferred(), release = deferred(); let hold = false;
  const f = await client(t, async (request, response) => {
    if (hold && request.path.endsWith('/jobs/detail')) { entered.resolve(); await release.promise; }
    return response;
  });
  t.after(() => release.resolve());
  const saved = await job(f, {body: 'PRIVATE-STALE-INSPECTOR-1463'}), c = createRelayOwnerController({api: f.api});
  await c.refresh(); c.setDraft('PRIVATE-STALE-INSPECTOR-DRAFT-3546'); c.setJobTitle('PRIVATE-STALE-TITLE-1114');
  hold = true; const pending = c.inspectJob(saved.id); await entered.promise;
  f.h.ctx.storage.sql.exec('UPDATE relay_owner_sessions SET expires_ms=? WHERE device_id=?', Date.now() - 1, f.phone.device.id);
  await c.refresh();
  assert.equal(c.status, 'expired'); assert.equal(f.values.has(OWNER_KEY), false);
  release.resolve(); await pending;
  const state = c.snapshot();
  assert.deepEqual(state.messages, []); assert.deepEqual(state.jobs, []); assert.equal(state.jobDetail, null);
  assert.equal(state.jobDetailId, null); assert.equal(state.draft, 'PRIVATE-STALE-INSPECTOR-DRAFT-3546'); assert.equal(state.jobTitle, '');
  assert.equal(f.calls.some(call => ['/shared/messages', '/v1/messages'].includes(call.path)), false);
});

test('uncertain request receipt preserves its original UUID and mutable lifecycle refreshes independently of message history', async t => {
  let lose = true;
  const f = await client(t, async (request, response) => {
    if (lose && request.path.endsWith('/jobs') && request.options.method === 'POST') { lose = false; assert.equal(response.status, 201); return Response.json({ok: true}); }
    return response;
  });
  const id = crypto.randomUUID(), c = createRelayOwnerController({api: f.api, uuid: () => id});
  await c.refresh(); c.setJobMode(true); c.setJobTitle('Fictional request title'); c.setJobKind('draft'); c.setDraft('PRIVATE-UNCERTAIN-JOB-BODY-6874');
  await c.send();
  const unconfirmed = c.snapshot(); assert.equal(unconfirmed.sendUnconfirmed, true);
  assert.equal(unconfirmed.draft, 'PRIVATE-UNCERTAIN-JOB-BODY-6874'); assert.equal(unconfirmed.jobTitle, 'Fictional request title'); assert.equal(unconfirmed.jobMode, true);
  await c.send();
  const requests = f.calls.filter(call => call.path.endsWith('/jobs') && call.options.method === 'POST').map(call => JSON.parse(call.options.body));
  assert.equal(requests.length, 2); assert.equal(requests[0].id, requests[1].id);
  assert.equal(f.h.rows('SELECT COUNT(*) AS n FROM relay_owner_entries WHERE id=?', id)[0].n, 1);
  assert.equal(c.snapshot().draft, ''); assert.equal(c.snapshot().jobs[0].stage, 'queued', 'Successful storage does not imply assistant execution');
  await f.h.rpc(f.owner, 'relay_owner_job_claim', {inbox_id: RELAY_OWNER_INBOX, job_id: id, run_id: crypto.randomUUID(), event_id: crypto.randomUUID()});
  await c.refresh(); assert.equal(c.snapshot().jobs[0].stage, 'running', 'Mutable progress remains visible after the message cursor advances');
  await f.h.rpc(f.owner, 'relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: id, body: 'Fictional immutable final answer'});
  await c.refresh();
  assert.equal(c.snapshot().jobs[0].stage, 'outcome_unknown'); assert.equal(c.snapshot().jobs[0].completion, null);
  assert.equal(c.snapshot().jobs[0].result.body, 'Fictional immutable final answer');
  assert.equal(JSON.stringify([...f.values.values()]).includes('PRIVATE-UNCERTAIN-JOB-BODY-6874'), false);
});

test('a failed conversation read marks retained jobs stale while local title validation and fresh recovery preserve honest evidence', async t => {
  let unavailable = false, detailUnavailable = false;
  const f = await client(t, async (request, response) => {
    if (unavailable && request.path.endsWith('/messages') && request.options.method === 'GET' || detailUnavailable && request.path.endsWith('/jobs/detail'))
      return Response.json({code: 'temporary_fixture_failure'}, {status: 503});
    return response;
  });
  const saved = await job(f), c = createRelayOwnerController({api: f.api});
  await f.h.rpc(f.owner, 'relay_owner_job_claim', {inbox_id: RELAY_OWNER_INBOX, job_id: saved.id, run_id: crypto.randomUUID(), event_id: crypto.randomUUID()});
  await c.refresh(); assert.equal(c.snapshot().jobs[0].stage, 'running'); assert.equal(c.snapshot().syncStale, false);
  const start = f.calls.length; unavailable = true;
  await c.refresh();
  assert.equal(c.snapshot().syncStale, true, 'A failure before job reads makes retained lifecycle data explicitly stale');
  assert.equal(c.snapshot().jobs[0].stage, 'running', 'Network failure supplies no new execution stage');
  assert.equal(c.status, 'approved'); assert.equal(f.api.hasCredential, true);
  assert.equal(f.calls.slice(start).some(request => request.path.endsWith('/jobs')), false, 'The failed messages read prevents a fresh job proof');
  unavailable = false; await c.refresh(); assert.equal(c.snapshot().syncStale, false);
  c.setJobMode(true); c.setJobTitle(''); c.setDraft('PRIVATE-BLANK-TITLE-DRAFT-6925');
  const beforeLocal = f.calls.length; await c.send();
  assert.equal(f.calls.length, beforeLocal, 'Missing request title is local validation');
  assert.match(c.snapshot().error, /short title/); assert.equal(c.snapshot().syncStale, false);
  assert.equal(c.snapshot().draft, 'PRIVATE-BLANK-TITLE-DRAFT-6925');
  await c.inspectJob(saved.id); assert.equal(c.snapshot().jobDetailStale, false);
  detailUnavailable = true; await c.inspectJob(saved.id, {refresh: true});
  assert.equal(c.snapshot().jobDetailStale, true); assert.equal(c.snapshot().jobDetail.job.stage, 'running');
  assert.equal(c.snapshot().syncStale, false, 'One failed inspector read does not invalidate a separately fresh full inbox');
  detailUnavailable = false; await c.inspectJob(saved.id, {refresh: true});
  assert.equal(c.snapshot().jobDetailStale, false);
  assert.equal(JSON.stringify([...f.values.values()]).includes('PRIVATE-BLANK-TITLE-DRAFT-6925'), false);
});


test('nonempty private work search is cleared on authorization loss and session replacement',async t=>{
  for(const transition of ['disconnect','expired','revoked','unauthorized','replacement','removal'])await t.test(transition,async t=>{
    const f=await client(t),saved=await job(f,{title:'Fictional private search target'}),draft='Fictional unsent private draft';
    const c=createRelayOwnerController({api:f.api,draftStore:{read:()=>'',save:()=>true}});await c.refresh();assert.equal(c.beginTask({projectTitle:'Fictional private prefill project',goalTitle:'Fictional private prefill goal'}),true);c.setJobTitle('Fictional private prefill title');c.toggleRequests();c.setQuery('Fictional prior project progress and result search');c.setWorkFilter('queued');c.setDraft(draft);
    assert.equal(c.snapshot().jobsEnabled,true);assert.equal(c.snapshot().requestsOnly,true);assert.notEqual(c.snapshot().query,'');assert.equal(c.snapshot().jobs[0].id,saved.id);
    if(transition==='disconnect')await c.disconnect();
    else if(transition==='replacement'){
      const replacement=await f.h.pair(f.owner,'Fictional replacement phone');f.values.set(OWNER_KEY,JSON.stringify({device_token:replacement.device_token,device_id:replacement.device.id}));await c.storedSessionChanged();assert.equal(c.snapshot().device.id,replacement.device.id);assert.equal(c.status,'approved');
    }else if(transition==='removal'){f.values.delete(OWNER_KEY);await c.storedSessionChanged();assert.equal(c.status,'none');}
    else{
      if(transition==='expired')f.h.ctx.storage.sql.exec('UPDATE relay_owner_sessions SET expires_ms=? WHERE device_id=?',Date.now()-1,f.phone.device.id);
      if(transition==='revoked')f.h.ctx.storage.sql.exec('UPDATE relay_owner_sessions SET revoked_ms=? WHERE device_id=?',Date.now(),f.phone.device.id);
      if(transition==='unauthorized')f.h.ctx.storage.sql.exec('DELETE FROM relay_owner_sessions WHERE device_id=?',f.phone.device.id);
      await c.refresh();assert.notEqual(c.status,'approved');
    }
    const state=c.snapshot();assert.equal(state.query,'','A private search cannot cross a session boundary');assert.equal(state.requestsOnly,false);assert.equal(state.workFilter,'all');assert.equal(state.jobDetail,null);
    assert.equal(state.jobMode,false);assert.equal(state.jobTitle,'');assert.equal(state.jobProject,'');assert.equal(state.jobGoal,'');assert.equal(state.sendNotice,'','Private composer prefills and notices cannot cross a session boundary');
    assert.equal(state.draft,transition==='expired'?draft:'','Only expiry preserves the explicitly intended unsent draft');
    if(transition!=='replacement'){assert.deepEqual(state.jobs,[]);assert.deepEqual(state.messages,[]);}
    assert.equal(f.calls.some(call=>call.path==='/shared/messages'||call.path==='/v1/messages'),false);
  });
});
