// Offline validation only. These records contain identifiers, provenance and
// numeric costs, never bodies, OAuth material, callback URLs or script content.
// Consistency validation cannot authenticate a host trace or certify its facts.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const EVIDENCE_SCHEMA = 'relay-execution-evidence-v1';
export const scenarios = ['contract', 'lucy-absent-phone', 'muse-lost-hint-mcp', 'muse-lost-hint-changes', 'muse-lost-hint-http',
  'duplicate-races', 'later-correction', 'subscription-expired', 'subscription-410', 'subscription-413',
  'consequential-reconciliation', 'delivery-recovery', 'public-result-notification', 'steady-cost', 'parent-terminal-reconciliation',
  'claim-response-recovery', 'completion-response-recovery', 'cancellation-before-effect', 'cancellation-after-effect'];
const operations = ['http', 'fixture_alarm', 'fixture_pair_start', 'host_public_result_http',
  'server/discover', 'tools/list', 'events/list', 'events/subscribe', 'events/unsubscribe',
  '/jobs', '/jobs/detail', '/jobs/retry', '/jobs/cancel', '/delivery/retry',
  'relay_owner_pairing_approve', 'relay_owner_job_read', 'relay_owner_jobs_list', 'relay_owner_read_conversation',
  'relay_owner_job_claim', 'relay_owner_job_update', 'relay_owner_reply', 'relay_owner_job_result_correct',
  'relay_owner_subscription_status', 'relay_owner_delivery_status',
  'relay_read_public_result', 'relay_read_public_changes', 'relay_read_conversation'];
const sha40 = /^[a-f0-9]{40}$/, sha256 = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const factKeys = ['callbackAccepted', 'authenticatedClaimAccepted', 'sourceIndependentlyChecked', 'immutableReplySaved',
  'typedCompletionAccepted', 'browserClosed', 'publicationHintDelivered', 'restarted', 'wrongGrantRejected',
  'wrongRunRejected', 'expiredLeaseNotRenewed', 'noConsequentialReplay'];
const proofKeys = ['hostTraceSha256', 'independentSourceEvidenceSha256', 'claimEvidenceSha256', 'replyEvidenceSha256',
  'completionEvidenceSha256', 'reviewedEvidenceSha256'];
const correlationKeys = ['requestId', 'runId', 'publicationAttemptId', 'originalReplyId', 'latestResultId', 'latestResultVersion',
  'completionEventId', 'completionResultVersion'];
const sourceKeys = ['workerSourceCommit', 'deployedSourceCommit', 'deploymentCommit', 'hostSourceSha256', 'hostToolSchemaSha256'];
const costKeys = ['operation', 'elapsedMs', 'requestBytes', 'responseBytes', 'sqlStatements', 'sqliteReturnedRows',
  'sqliteChangedRows', 'upstreamRequests', 'ids', 'httpStatus', 'rpcErrorCode', 'toolIsError', 'workerdRowsRead', 'workerdRowsWritten',
  'startedAt', 'finishedAt', 'clock', 'transportFailed', 'fixtureWorkerCommitObserved'];
function fail(path, reason) { throw Error('Invalid execution evidence at ' + path + ': ' + reason); }
function object(value, allowed, required, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'object required');
  // Do not echo an unrecognized property name; it could itself contain a secret.
  if (Object.keys(value).some(key => !allowed.includes(key))) fail(path, 'unexpected field');
  if (required.some(key => !Object.hasOwn(value, key))) fail(path, 'missing field');
}
function pattern(value, regex, path, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || !regex.test(value)) fail(path, 'invalid identifier');
}
function oneOf(value, choices, path) { if (!choices.includes(value)) fail(path, 'invalid enum'); }
function number(value, path, {integer = true, min = 0, max = Number.MAX_SAFE_INTEGER} = {}) {
  if (!Number.isFinite(value) || integer && !Number.isSafeInteger(value) || value < min || value > max) fail(path, 'invalid number');
}
export function emptyCorrelation() { return Object.fromEntries(correlationKeys.map(key => [key, null])); }
export function emptyFacts() { return Object.fromEntries(factKeys.map(key => [key, null])); }
export function emptyProofs() { return Object.fromEntries(proofKeys.map(key => [key, null])); }
export function emptySource() { return Object.fromEntries(sourceKeys.map(key => [key, null])); }
export function validateCost(record, path = 'cost') {
  object(record, costKeys, costKeys.slice(0, 8), path);
  oneOf(record.operation, operations, path + '.operation');
  for (const key of costKeys.slice(1, 8)) number(record[key], path + '.' + key, {integer: key !== 'elapsedMs'});
  for (const key of ['workerdRowsRead', 'workerdRowsWritten']) if (Object.hasOwn(record, key)) number(record[key], path + '.' + key);
  // The two accounting systems cannot silently be presented as equivalents.
  if (Object.hasOwn(record, 'workerdRowsRead') !== Object.hasOwn(record, 'workerdRowsWritten')) fail(path, 'both workerd counters required');
  if (record.ids !== undefined) {
    const ids = ['requestId', 'runId', 'eventId', 'replyId', 'resultId', 'resultVersion', 'completionEventId', 'completionResultVersion', 'publicationAttemptId'];
    object(record.ids, ids, [], path + '.ids');
    for (const [key, value] of Object.entries(record.ids)) {
      if (key.endsWith('Version')) number(value, path + '.ids.' + key, {max: 5});
      else pattern(value, uuid, path + '.ids.' + key);
    }
  }
  if (record.httpStatus !== undefined) number(record.httpStatus, path + '.httpStatus', {min: 100, max: 599});
  if (record.rpcErrorCode !== undefined && record.rpcErrorCode !== null) number(record.rpcErrorCode, path + '.rpcErrorCode', {min: -99999, max: -1});
  if (record.toolIsError !== undefined && record.toolIsError !== null && typeof record.toolIsError !== 'boolean') fail(path, 'invalid tool error flag');
  for (const key of ['transportFailed', 'fixtureWorkerCommitObserved'])
    if (record[key] !== undefined && typeof record[key] !== 'boolean') fail(path, 'invalid transport observation');
  if (record.transportFailed === true && record.httpStatus !== undefined) fail(path, 'failed transport cannot invent a received HTTP status');
  if (record.fixtureWorkerCommitObserved === true && (record.transportFailed !== true ||
      !record.ids?.requestId || !record.ids?.runId || !record.ids?.eventId)) fail(path, 'post-commit loss requires correlated failed transport');
  if (record.startedAt !== undefined || record.finishedAt !== undefined || record.clock !== undefined) {
    oneOf(record.clock, ['fixture-virtual-wall-real-monotonic', 'real-wall-real-monotonic'], path + '.clock');
    for (const key of ['startedAt', 'finishedAt']) {
      pattern(record[key], /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, path + '.' + key);
      if (!Number.isFinite(Date.parse(record[key]))) fail(path, 'invalid timestamp');
    }
    if (record.startedAt > record.finishedAt) fail(path, 'timestamps are reversed');
  }
  return record;
}

// This is an assessment of REQUIRED metadata, not a real-world acceptance
// certificate. A human must check the referenced redacted artifacts themselves.
export function missingExecutionGates(record) {
  const missing = [];
  if (record.scope !== 'genuine-host') missing.push('genuine-host-observation');
  for (const key of ['workerSourceCommit', 'deployedSourceCommit', 'deploymentCommit', 'hostSourceSha256', 'hostToolSchemaSha256'])
    if (!record.source[key]) missing.push(key);
  if (record.source.workerSourceCommit !== record.source.deployedSourceCommit) missing.push('matching-deployed-source');
  for (const key of ['hostTraceSha256', 'independentSourceEvidenceSha256', 'replyEvidenceSha256', 'reviewedEvidenceSha256'])
    if (!record.proofs[key]) missing.push(key);
  for (const key of ['sourceIndependentlyChecked', 'immutableReplySaved']) if (record.facts[key] !== true) missing.push(key);
  for (const key of ['requestId', 'runId', 'originalReplyId', 'latestResultId', 'latestResultVersion'])
    if (!record.correlation[key]) missing.push(key);
  if (record.channel === 'lucy-private') {
    for (const key of ['authenticatedClaimAccepted', 'typedCompletionAccepted']) if (record.facts[key] !== true) missing.push(key);
    for (const key of ['claimEvidenceSha256', 'completionEvidenceSha256']) if (!record.proofs[key]) missing.push(key);
    for (const key of ['completionEventId', 'completionResultVersion']) if (!record.correlation[key]) missing.push(key);
    if (record.grantBinding !== 'server-enforced-owning-grant-run') missing.push('owning-grant-run-binding');
    // Corrections can advance latestResultVersion; original completion remains
    // bound to the earlier result version. Never silently upgrade the attestation.
    if (record.correlation.completionResultVersion > record.correlation.latestResultVersion) missing.push('valid-completion-version');
    if (record.correlation.latestResultVersion === 1 && record.correlation.latestResultId !== record.correlation.originalReplyId)
      missing.push('original-result-identity');
    if (record.correlation.latestResultVersion > 1 && record.correlation.latestResultId === record.correlation.originalReplyId)
      missing.push('distinct-correction-identity');
    if (record.correlation.completionEventId && record.correlation.completionEventId === record.correlation.originalReplyId)
      missing.push('distinct-completion-event');
  } else if (record.channel === 'muse-public') {
    if (!record.correlation.publicationAttemptId) missing.push('publicationAttemptId');
    if (record.facts.typedCompletionAccepted === true) missing.push('public-report-is-not-private-completion');
  } else missing.push('single-host-channel');
  if (record.scenario === 'lucy-absent-phone' && record.facts.browserClosed !== true) missing.push('browserClosed');
  if (record.scenario.startsWith('muse-lost-hint')) {
    if (record.facts.browserClosed !== true) missing.push('browserClosed');
    if (record.facts.publicationHintDelivered !== false) missing.push('publicationHintDelivered-false');
  }
  if (record.scenario === 'consequential-reconciliation' || record.scenario === 'parent-terminal-reconciliation') {
    if (record.facts.noConsequentialReplay !== true) missing.push('noConsequentialReplay');
    if (record.facts.expiredLeaseNotRenewed !== true) missing.push('expiredLeaseNotRenewed');
  }
  return missing;
}
export function validateEvidence(evidence) {
  object(evidence, ['schema', 'recordedAt', 'repository', 'sourceCommit', 'harnessSha256', 'nodeVersion', 'cases'],
    ['schema', 'recordedAt', 'repository', 'sourceCommit', 'harnessSha256', 'nodeVersion', 'cases'], 'root');
  oneOf(evidence.schema, [EVIDENCE_SCHEMA], 'schema');
  oneOf(evidence.repository, ['braydenparker999/jarvis'], 'repository');
  pattern(evidence.sourceCommit, sha40, 'sourceCommit'); pattern(evidence.harnessSha256, sha256, 'harnessSha256');
  pattern(evidence.nodeVersion, /^v\d+\.\d+\.\d+$/, 'nodeVersion');
  pattern(evidence.recordedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, 'recordedAt');
  if (!Number.isFinite(Date.parse(evidence.recordedAt))) fail('recordedAt', 'invalid timestamp');
  if (!Array.isArray(evidence.cases) || !evidence.cases.length || evidence.cases.length > 100) fail('cases', 'bounded nonempty array required');
  for (const [index, record] of evidence.cases.entries()) {
    const path = 'cases[' + index + ']';
    const keys = ['scenario', 'channel', 'scope', 'status', 'level', 'correlation', 'source', 'facts', 'proofs', 'grantBinding', 'costs'];
    object(record, keys, keys, path);
    oneOf(record.scenario, scenarios, path + '.scenario');
    oneOf(record.channel, ['lucy-private', 'muse-public', 'cross-channel'], path + '.channel');
    oneOf(record.scope, ['loopback-fixture', 'genuine-host', 'inherited-report'], path + '.scope');
    oneOf(record.status, ['passed', 'failed', 'blocked', 'observed'], path + '.status');
    oneOf(record.level, ['none', 'transport-only', 'server-contract', 'fixture-execution', 'genuine-execution'], path + '.level');
    oneOf(record.grantBinding, ['not-observed', 'server-enforced-owning-grant-run'], path + '.grantBinding');
    object(record.correlation, correlationKeys, correlationKeys, path + '.correlation');
    for (const [key, value] of Object.entries(record.correlation)) {
      if (value === null) continue;
      if (key.endsWith('Version')) number(value, path + '.correlation.' + key, {min: 1, max: 5});
      else pattern(value, uuid, path + '.correlation.' + key);
    }
    object(record.source, sourceKeys, sourceKeys, path + '.source');
    for (const [key, value] of Object.entries(record.source)) pattern(value, key.endsWith('Commit') ? sha40 : sha256, path + '.source.' + key, true);
    object(record.facts, factKeys, factKeys, path + '.facts');
    for (const value of Object.values(record.facts)) if (value !== null && typeof value !== 'boolean') fail(path + '.facts', 'nullable booleans required');
    object(record.proofs, proofKeys, proofKeys, path + '.proofs');
    for (const [key, value] of Object.entries(record.proofs)) pattern(value, sha256, path + '.proofs.' + key, true);
    if (!Array.isArray(record.costs) || record.costs.length > 10000) fail(path + '.costs', 'bounded costs array required');
    record.costs.forEach((cost, costIndex) => validateCost(cost, path + '.costs[' + costIndex + ']'));
    if (record.scope !== 'loopback-fixture' && record.costs.some(cost => Object.hasOwn(cost, 'fixtureWorkerCommitObserved')))
      fail(path, 'fixture commit observation scope mismatch');
    if (record.level === 'genuine-execution') {
      if (record.status !== 'passed' || missingExecutionGates(record).length) fail(path, 'genuine execution gates are incomplete');
    }
    if (record.level === 'fixture-execution' && record.scope !== 'loopback-fixture') fail(path, 'fixture execution scope mismatch');
    if (record.scope === 'inherited-report' && record.status === 'passed') fail(path, 'inherited reports cannot establish current acceptance');
  }
  return evidence;
}

export function summarizeCosts(costs) {
  costs.forEach((record, index) => validateCost(record, 'costs[' + index + ']'));
  const groups = new Map();
  for (const record of costs) {
    if (!groups.has(record.operation)) groups.set(record.operation, []);
    groups.get(record.operation).push(record);
  }
  const range = values => ({min: Math.min(...values), max: Math.max(...values)});
  return Object.fromEntries([...groups].map(([name, samples]) => {
    const times = samples.map(item => item.elapsedMs).sort((a, b) => a - b);
    const percentile = q => times[Math.max(0, Math.ceil(times.length * q) - 1)];
    return [name, {samples: samples.length, p50Ms: percentile(0.5), p95Ms: percentile(0.95),
      ...Object.fromEntries(costKeys.slice(2, 8).map(key => [key, range(samples.map(item => item[key]))])),
      ...(samples.every(item => Object.hasOwn(item, 'workerdRowsRead')) ? {
        workerdRowsRead: range(samples.map(item => item.workerdRowsRead)),
        workerdRowsWritten: range(samples.map(item => item.workerdRowsWritten)),
      } : {})}];
  }));
}

export function fixtureEnvelope(record) {
  // Deliberately hard-code the scope/level. A measurement exporter cannot turn a
  // fixture into a genuine host pass through an environment flag or label.
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim();
  const digest = createHash('sha256');
  for (const name of ['scripts/lib/relay-execution-evidence.mjs', 'scripts/check-relay-execution-evidence.mjs', 'tests/helpers/relay-execution-harness.js',
    'tests/helpers/relay-execution-cost-worker.js', 'tests/relay-execution-acceptance.test.js', 'tests/relay-execution-evidence.test.js', 'tests/relay-execution-workerd-cost.test.js']) {
    digest.update(name + '\0'); digest.update(readFileSync(new URL('../../' + name, import.meta.url))); digest.update('\0');
  }
  return validateEvidence({schema: EVIDENCE_SCHEMA, recordedAt: new Date().toISOString(), repository: 'braydenparker999/jarvis',
    sourceCommit, harnessSha256: digest.digest('hex'), nodeVersion: process.version,
    cases: [{...record, source: {...record.source, workerSourceCommit: sourceCommit,
      hostSourceSha256: createHash('sha256').update(readFileSync(new URL('../../tests/helpers/relay-execution-harness.js', import.meta.url))).digest('hex')},
      scope: 'loopback-fixture', status: 'observed', level: 'none'}]});
}
