import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';
import {RELAY_OWNER_INBOX, RELAY_INBOX, RELAY_VERSION} from '../backend/relay-common.js';
import {PRIMARY_SITE} from '../backend/origins.js';

function metric(headers, name, minimum = 0) {
  const raw = headers.get(name);
  assert.equal(typeof raw, 'string', 'Required workerd counter header is missing');
  assert.match(raw, /^(0|[1-9]\d*)$/, 'Workerd counter must be a nonnegative integer');
  const value = Number(raw);
  assert.ok(Number.isSafeInteger(value) && value >= minimum, 'Workerd counter must be finite and meet its positive-work requirement');
  return value;
}

test('workerd accounting refuses absent, malformed and zero-work read counters', () => {
  for (const raw of [null, '', 'NaN', 'Infinity', '-1', '1.5', '01', '1 1', '9007199254740992']) {
    const headers = new Headers(); if (raw !== null) headers.set('X-Fixture-Counter', raw);
    assert.throws(() => metric(headers, 'X-Fixture-Counter'));
  }
  assert.equal(metric(new Headers({'X-Fixture-Counter': '0'}), 'X-Fixture-Counter'), 0);
  assert.throws(() => metric(new Headers({'X-Fixture-Counter': '0'}), 'X-Fixture-Counter', 1));
  assert.equal(metric(new Headers({'X-Fixture-Counter': '1'}), 'X-Fixture-Counter', 1), 1);
});

test('actual local workerd HTTP/MCP boundaries record stable rows-read/written costs with 5000 background rows', {timeout: 30000}, async () => {
  const config = JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc', import.meta.url), 'utf8'));
  const bundle = await build({entryPoints: [fileURLToPath(new URL('./helpers/relay-execution-cost-worker.js', import.meta.url))],
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:crypto']});
  const sourceSha256 = createHash('sha256').update(bundle.outputFiles[0].text).digest('hex');
  const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8'}).trim();
  const costHarnessSha256 = createHash('sha256').update(readFileSync(fileURLToPath(import.meta.url))).update(bundle.outputFiles[0].text).digest('hex');
  let egress = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({name: 'local-relay-execution-cost', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: config.compatibility_date, compatibilityFlags: config.compatibility_flags || [], cf: false, telemetry: {enabled: false},
    bindings: {RELAY_MCP_ENABLED: 'true', RELAY_OWNER_ENABLED: 'true', RELAY_MCP_ORIGIN: 'https://cost.execution.test'},
    durableObjects: {HUBS: {className: 'ExecutionCostHub', useSQLite: true}}, outboundService() { egress++; throw Error('Fixture disallows all external network'); }}));
  const measurements = []; let rpcId = 0;
  const request = async (path, body, token, operation = 'setup', extra = {}) => {
    const started = performance.now();
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const response = await mf.dispatchFetch('https://cost.execution.test' + path, {method: body === undefined ? 'GET' : 'POST',
      headers: {Origin: PRIMARY_SITE, ...(payload ? {'Content-Type': 'application/json'} : {}), ...(token ? {Authorization: 'Bearer ' + token} : {}), ...extra}, body: payload});
    const text = await response.text();
    if (operation !== 'setup') measurements.push({operation, elapsedMs: Number((performance.now() - started).toFixed(3)),
      status: response.status, requestBytes: Buffer.byteLength(payload || ''), responseBytes: Buffer.byteLength(text),
      sqlStatements: metric(response.headers, 'X-Fixture-Sql-Statements', 1), rowsRead: metric(response.headers, 'X-Fixture-Rows-Read', 1),
      rowsWritten: metric(response.headers, 'X-Fixture-Rows-Written')});
    assert.equal(response.status < 400, true, 'Fixture cost boundary must succeed');
    return JSON.parse(text);
  };
  let access;
  const rpc = async (name, args, measured = false) => {
    const response = await request('/relay/mcp', {jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: {name, arguments: args,
      _meta: {'io.modelcontextprotocol/protocolVersion': RELAY_VERSION, 'io.modelcontextprotocol/clientCapabilities': {}}}}, access,
    measured ? name : 'setup', {Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': RELAY_VERSION, 'Mcp-Method': 'tools/call', 'Mcp-Name': name});
    assert.equal(response.error, undefined); assert.equal(response.result.isError, false); return response.result.structuredContent;
  };
  try {
    ({access} = await request('/__fixture/grant')); assert.ok(access);
    const pair = await request('/relay/owner/pair/start', {label: 'Fictional local workerd phone'});
    await rpc('relay_owner_pairing_approve', {request_id: pair.request_id, code: pair.code, access_days: 365, confirm: true});
    const requestId = randomUUID();
    const created = await request('/relay/owner/jobs', {id: requestId, title: 'Fictional cost request', body: 'Read the isolated fixture.', action_kind: 'read_only'}, pair.device_token);
    assert.equal(created.job.id, requestId);
    const runId = randomUUID();
    await rpc('relay_owner_job_claim', {inbox_id: RELAY_OWNER_INBOX, job_id: requestId, run_id: runId, event_id: randomUUID()});
    const reply = await rpc('relay_owner_reply', {inbox_id: RELAY_OWNER_INBOX, message_id: requestId, body: 'Fictional populated cost result.'});
    await rpc('relay_owner_job_update', {inbox_id: RELAY_OWNER_INBOX, job_id: requestId, run_id: runId, event_id: randomUUID(),
      stage: 'completed', expected_reply_id: reply.entry.id, expected_version: 1, summary: 'Fictional fixture result for local cost accounting.', outcome: 'known'});
    const ownerCorrectionId = randomUUID();
    await rpc('relay_owner_job_result_correct', {inbox_id: RELAY_OWNER_INBOX, job_id: requestId, event_id: ownerCorrectionId,
      expected_reply_id: reply.entry.id, expected_version: 1, body: 'Fictional populated cost correction.', correction_summary: 'Fictional cost fixture recheck.'});
    const publicId = randomUUID(); await request('/shared/messages', {id: publicId, body: 'Fictional public cost request.'});
    const finalEventId = randomUUID(), correctionEventId = randomUUID(), publicationAttemptId = randomUUID();
    await request('/__fixture/public-result-history', {requestId: publicId, finalEventId, correctionEventId, attemptId: publicationAttemptId});
    // Explicit warm/cooldown setup: an eventual MCP importer repair must not
    // turn this steady-state cost profile into a cold upstream request sample.
    await request('/__fixture/publication-cooldown');
    const ownerArgs = {inbox_id: RELAY_OWNER_INBOX, job_id: requestId}, publicArgs = {inbox_id: RELAY_INBOX, message_id: publicId, limit: 100};
    const ownerRead = async (measured = false) => {
      const read = await rpc('relay_owner_job_read', ownerArgs, measured);
      assert.equal(read.job.completion.runId, runId); assert.equal(read.job.completion.resultVersion, 1);
      assert.equal(read.job.result.replyId, reply.entry.id);
      assert.deepEqual(read.resultHistory.map(item => [item.id, item.version]), [[reply.entry.id, 1], [ownerCorrectionId, 2]]);
    };
    const publicRead = async (measured = false) => {
      const read = await rpc('relay_read_public_result', publicArgs, measured);
      assert.equal(read.reply.id, finalEventId); assert.equal(read.nextCursor, null);
      assert.deepEqual(read.events.map(item => [item.eventId, item.resultVersion]), [[finalEventId, 1], [correctionEventId, 2]]);
    };
    const phoneRead = async (measured = false) => {
      const read = await request('/relay/owner/jobs/detail?job_id=' + requestId, undefined, pair.device_token, measured ? 'phone_exact_job' : 'setup');
      assert.equal(read.job.result.replyId, reply.entry.id); assert.equal(read.job.latestResult.id, ownerCorrectionId);
      assert.equal(read.job.resultVersion, 2); assert.equal(read.job.completion.resultVersion, 1);
    };
    const warm = async () => {
      await ownerRead();
      await publicRead();
      await phoneRead();
    };
    await warm();
    const sample = async () => {
      for (let repeat = 0; repeat < 3; repeat++) {
        await ownerRead(true);
        await publicRead(true);
        await phoneRead(true);
      }
    };
    await sample();
    const before = measurements.splice(0);
    await request('/__fixture/background?count=5000'); await warm(); await sample();
    const after = measurements;
    const counts = items => items.map(({elapsedMs, requestBytes, responseBytes, ...rest}) => rest);
    assert.deepEqual(counts(after), counts(before), '5000 unrelated rows cannot amplify exact-read workerd row costs');
    for (const record of after) {
      assert.ok(record.rowsRead < 200, record.operation + ' exceeds exact-read rows budget');
      assert.ok(record.rowsWritten < 20, record.operation + ' exceeds warmed-write rows budget');
    }
    assert.equal(egress, 0);
    const report = {schema: 'relay-workerd-boundary-cost-v1', scope: 'local-workerd-fixture', sourceCommit, sourceSha256, costHarnessSha256, nodeVersion: process.version,
      compatibilityDate: config.compatibility_date, backgroundRows: 5000, requestId, runId, originalReplyId: reply.entry.id, ownerCorrectionId,
      publicRequestId: publicId, finalEventId, correctionEventId, publicationAttemptId, resultVersions: [1, 2], before, after, egress};
    process.stdout.write('LOCAL_BOUNDARY_COST ' + JSON.stringify(report) + '\n');
    if (process.env.RELAY_EXECUTION_COST_DIR) {
      mkdirSync(resolve(process.env.RELAY_EXECUTION_COST_DIR), {recursive: true});
      writeFileSync(resolve(process.env.RELAY_EXECUTION_COST_DIR, 'workerd-boundary-cost.json'), JSON.stringify(report, null, 2) + '\n', {mode: 0o600});
    }
  } finally { await mf.dispose(); }
});
