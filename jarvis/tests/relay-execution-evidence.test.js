import test from 'node:test';
import assert from 'node:assert/strict';
import {EVIDENCE_SCHEMA, emptyCorrelation, emptySource, emptyFacts, emptyProofs, validateEvidence,
  missingExecutionGates, summarizeCosts, fixtureEnvelope} from '../scripts/lib/relay-execution-evidence.mjs';

const id = suffix => '00000000-0000-4000-8000-' + String(suffix).padStart(12, '0');
const sha = length => 'a'.repeat(length);
const cost = {operation: 'relay_owner_job_read', elapsedMs: 3, requestBytes: 100, responseBytes: 200,
  sqlStatements: 12, sqliteReturnedRows: 8, sqliteChangedRows: 0, upstreamRequests: 0};
function record() {
  return {scenario: 'lucy-absent-phone', channel: 'lucy-private', scope: 'loopback-fixture', status: 'observed', level: 'none',
    correlation: emptyCorrelation(), source: emptySource(), facts: emptyFacts(), proofs: emptyProofs(), grantBinding: 'not-observed', costs: [{...cost}]};
}
function envelope(item = record()) {
  return {schema: EVIDENCE_SCHEMA, recordedAt: '2026-10-09T00:00:00.000Z', repository: 'braydenparker999/jarvis',
    sourceCommit: sha(40), harnessSha256: sha(64), nodeVersion: 'v24.19.0', cases: [item]};
}
function consistentHostRecord() {
  const item = record(); item.scope = 'genuine-host'; item.status = 'passed'; item.level = 'genuine-execution';
  item.correlation = {...emptyCorrelation(), requestId: id(1), runId: id(2), originalReplyId: id(3), latestResultId: id(3),
    latestResultVersion: 1, completionEventId: id(4), completionResultVersion: 1};
  item.source = {workerSourceCommit: sha(40), deployedSourceCommit: sha(40), deploymentCommit: sha(40), hostSourceSha256: sha(64), hostToolSchemaSha256: sha(64)};
  item.facts = {...emptyFacts(), sourceIndependentlyChecked: true, immutableReplySaved: true, authenticatedClaimAccepted: true,
    typedCompletionAccepted: true, browserClosed: true};
  item.proofs = Object.fromEntries(Object.keys(emptyProofs()).map(key => [key, sha(64)]));
  item.grantBinding = 'server-enforced-owning-grant-run'; return item;
}

test('evidence refuses bodies/secrets/URLs, unsafe identifiers and unbounded or invented accounting', () => {
  for (const key of ['body', 'request_body', 'summary', 'access_token', 'signing_secret', 'callbackUrl', 'configuredAddonUrl']) {
    const evidence = envelope(); evidence.cases[0][key] = 'PRIVATE_SENTINEL';
    assert.throws(() => validateEvidence(evidence), error => /unexpected field/.test(error.message) && !error.message.includes('PRIVATE_SENTINEL'));
  }
  for (const value of ['https://private.example/path', 'secret-token', 100]) {
    const evidence = envelope(); evidence.cases[0].correlation.runId = value;
    assert.throws(() => validateEvidence(evidence));
  }
  for (const variation of [{operation: 'send-secret'}, {elapsedMs: -1}, {sqliteReturnedRows: Infinity}, {sqliteChangedRows: -1},
    {sqlStatements: 1.5}, {ids: {secret: 'PRIVATE_SENTINEL'}}, {workerdRowsRead: 1}, {transportFailed: 'yes'}, {fixtureWorkerCommitObserved: 1},
    {clock: 'real-wall-real-monotonic'}, {startedAt: '2026-10-09T00:00:02.000Z', finishedAt: '2026-10-09T00:00:01.000Z', clock: 'real-wall-real-monotonic'}])
    assert.throws(() => validateEvidence(envelope({...record(), costs: [{...cost, ...variation}]})));
  assert.equal(validateEvidence(envelope()).cases[0].scope, 'loopback-fixture');
});

test('post-commit transport loss is a fixture observation without an invented received HTTP response', () => {
  const item = record(); item.costs = [{...cost, transportFailed: true, fixtureWorkerCommitObserved: true,
    ids: {requestId: id(1), runId: id(2), eventId: id(3)}}];
  const evidence = validateEvidence(envelope(item));
  assert.equal(evidence.cases[0].costs[0].httpStatus, undefined);
  assert.equal(evidence.cases[0].costs[0].transportFailed, true);
  for (const changes of [{httpStatus: 200}, {transportFailed: false}, {ids: {requestId: id(1)}}]) {
    const contradicted = structuredClone(item); Object.assign(contradicted.costs[0], changes);
    assert.throws(() => validateEvidence(envelope(contradicted)));
  }
  for (const scope of ['genuine-host', 'inherited-report']) {
    const promoted = structuredClone(item); promoted.scope = scope;
    assert.throws(() => validateEvidence(envelope(promoted)), /fixture commit observation scope mismatch/);
  }
});

test('callback/reply/producer reports and fixture passes cannot satisfy genuine execution gates', () => {
  const fixture = record(); fixture.status = 'passed'; fixture.level = 'fixture-execution';
  fixture.facts.callbackAccepted = true; fixture.facts.immutableReplySaved = true;
  assert.ok(missingExecutionGates(fixture).includes('genuine-host-observation'));
  assert.ok(missingExecutionGates(fixture).includes('typedCompletionAccepted'));
  const promoted = structuredClone(fixture); promoted.level = 'genuine-execution';
  assert.throws(() => validateEvidence(envelope(promoted)), /genuine execution gates/);
  promoted.scope = 'genuine-host';
  assert.throws(() => validateEvidence(envelope(promoted)), /genuine execution gates/);
  const report = record(); report.scope = 'inherited-report'; report.status = 'passed';
  assert.throws(() => validateEvidence(envelope(report)), /inherited reports/);
});

test('genuine execution metadata requires exact deployed source, owning claim, result and independent checked artifacts', () => {
  // Synthetic metadata exercise ONLY. No host is contacted and these hashes
  // deliberately reference nothing; a validator pass cannot authenticate them.
  const candidate = consistentHostRecord(); assert.deepEqual(missingExecutionGates(candidate), []);
  assert.equal(validateEvidence(envelope(candidate)).cases[0].level, 'genuine-execution');
  for (const [group, key, value] of [
    ['source', 'deployedSourceCommit', 'b'.repeat(40)], ['source', 'hostToolSchemaSha256', null],
    ['facts', 'typedCompletionAccepted', false], ['facts', 'sourceIndependentlyChecked', null], ['facts', 'browserClosed', false],
    ['correlation', 'runId', null], ['correlation', 'originalReplyId', null], ['proofs', 'completionEvidenceSha256', null],
    ['proofs', 'reviewedEvidenceSha256', null], ['correlation', 'latestResultId', id(8)], ['correlation', 'completionEventId', id(3)],
  ]) {
    const changed = structuredClone(candidate); changed[group][key] = value;
    assert.throws(() => validateEvidence(envelope(changed)), /genuine execution gates/);
  }
  const wrongBinding = structuredClone(candidate); wrongBinding.grantBinding = 'not-observed';
  assert.throws(() => validateEvidence(envelope(wrongBinding)), /genuine execution gates/);
});

test('later corrections preserve the original completed version without retroactively certifying the new text', () => {
  const corrected = consistentHostRecord(); corrected.correlation.latestResultId = id(5); corrected.correlation.latestResultVersion = 2;
  assert.equal(validateEvidence(envelope(corrected)).cases[0].correlation.completionResultVersion, 1);
  corrected.correlation.completionResultVersion = 3;
  assert.throws(() => validateEvidence(envelope(corrected)), /genuine execution gates/);
});

test('Muse public reports require a genuine run and publication attempt and never become private completion', () => {
  const muse = consistentHostRecord(); muse.channel = 'muse-public'; muse.scenario = 'muse-lost-hint-http';
  muse.correlation.publicationAttemptId = id(6); muse.facts.typedCompletionAccepted = false; muse.facts.publicationHintDelivered = false;
  assert.deepEqual(missingExecutionGates(muse), []);
  muse.facts.typedCompletionAccepted = true;
  assert.throws(() => validateEvidence(envelope(muse)), /genuine execution gates/);
});

test('cost summaries keep monotonic latency samples and returned/changed rows separate from workerd accounting', () => {
  const samples = [5, 1, 10, 3].map(elapsedMs => ({...cost, elapsedMs, workerdRowsRead: 22, workerdRowsWritten: 2}));
  const report = summarizeCosts(samples).relay_owner_job_read;
  assert.equal(report.samples, 4); assert.equal(report.p50Ms, 3); assert.equal(report.p95Ms, 10);
  assert.deepEqual(report.sqliteReturnedRows, {min: 8, max: 8}); assert.deepEqual(report.workerdRowsRead, {min: 22, max: 22});
  assert.deepEqual(report.sqliteChangedRows, {min: 0, max: 0}); assert.deepEqual(report.workerdRowsWritten, {min: 2, max: 2});
});

test('fixture exporter pins actual local source/harness bytes and cannot elevate scope through caller labels', () => {
  const caller = consistentHostRecord();
  const exported = fixtureEnvelope(caller);
  assert.equal(exported.cases[0].scope, 'loopback-fixture'); assert.equal(exported.cases[0].status, 'observed'); assert.equal(exported.cases[0].level, 'none');
  assert.match(exported.sourceCommit, /^[a-f0-9]{40}$/); assert.match(exported.harnessSha256, /^[a-f0-9]{64}$/);
});
