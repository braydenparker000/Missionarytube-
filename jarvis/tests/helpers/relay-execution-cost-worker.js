import worker, {Hub} from '../../backend/worker.js';
import {SHARED_OBJECT, sharedSchema, sharedStore} from '../../backend/shared.js';
import {relayOAuthStore} from '../../backend/relay-oauth.js';
import {publicationSchema} from '../../backend/publications.js';
import {RELAY_CALLBACK, RELAY_SCOPES, hash, challenge} from '../../backend/relay-common.js';

// Measurement gateway for LOCAL workerd only. The exported production Worker
// still validates the external HTTP/MCP request. Fixtures may seed data through
// reserved endpoints; none of these endpoints are application entrypoints.
export class ExecutionCostHub extends Hub {
  constructor(ctx, env) {
    super(ctx, env); this.cursors = [];
    const sql = {exec: (query, ...values) => {
      const cursor = ctx.storage.sql.exec(query, ...values); this.cursors.push(cursor); return cursor;
    }};
    const storage = new Proxy(ctx.storage, {get(target, key) {
      if (key === 'sql') return sql;
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    }});
    this.ctx = new Proxy(ctx, {get(target, key) {
      if (key === 'storage') return storage;
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    }});
  }
  async alarm() {} // No timed callbacks or host execution during cost sampling.
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/__fixture/reset') { this.cursors = []; return Response.json({ok: true}); }
    if (url.pathname === '/__fixture/cost') {
      return Response.json({sqlStatements: this.cursors.length, rowsRead: this.cursors.reduce((n, cursor) => n + cursor.rowsRead, 0),
        rowsWritten: this.cursors.reduce((n, cursor) => n + cursor.rowsWritten, 0)});
    }
    if (url.pathname === '/__fixture/grant') {
      const access = '1'.repeat(64), client = '2'.repeat(64), grantId = '3'.repeat(64), code = '4'.repeat(64);
      const resource = this.env.RELAY_MCP_ORIGIN + '/relay/mcp';
      const params = {client_id: client, redirect_uri: RELAY_CALLBACK, code_challenge: await challenge('fixture-verifier'), scope: RELAY_SCOPES.join(' ')};
      const registry = value => relayOAuthStore(this.ctx, value).json();
      await registry({op: 'put', key: 'client:' + client, category: 'client', value: {redirect: RELAY_CALLBACK}, expiresAt: Date.now() + 600000});
      await registry({op: 'authorize', grantId, codeKey: 'code:' + await hash(code), params, resource});
      const issued = await registry({op: 'exchange', key: 'code:' + await hash(code), match: {client_id: client, redirect_uri: RELAY_CALLBACK, challenge: params.code_challenge, resource},
        accessKey: 'access:' + await hash(access), refreshKey: 'refresh:' + await hash('5'.repeat(64))});
      return Response.json({access: issued.scope ? access : null});
    }
    if (url.pathname === '/__fixture/publication-cooldown') {
      publicationSchema(this.ctx);
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)', 'publisher-next-attempt', JSON.stringify(Date.now() + 300000));
      return Response.json({ok: true});
    }
    if (url.pathname === '/__fixture/public-result-history') {
      // Populated result projection setup only. This is deliberately distinct
      // from the isolated lost-hint tests, which must use the real importer.
      const {requestId, finalEventId, correctionEventId, attemptId} = await request.json();
      const first = {schema: 'jarvis-coordination-v2', requestId, eventId: finalEventId, attemptId,
        stage: 'final', resultVersion: 1, body: 'Fictional local workerd final result.', artifacts: []};
      const correction = {...first, eventId: correctionEventId, stage: 'correction', resultVersion: 2,
        supersedesEventId: finalEventId, body: 'Fictional local workerd corrected result.'};
      for (const [index, payload] of [first, correction].entries()) {
        const response = sharedStore(this.ctx, '/internal/shared/coordination', {payload,
          provenance: {source: 'github-issue', repo: 'fictional/cost-fixture', issue: 2, authorId: 183016859,
            commentId: 90001 + index, publishedAt: new Date().toISOString()}});
        if (!response.ok) throw Error('Fictional result-history setup must succeed');
        const accepted = await response.json();
        if (accepted.event?.disposition !== 'accepted') throw Error('Fictional result-history setup must be accepted');
      }
      return Response.json({ok: true, requestId, finalEventId, correctionEventId, attemptId});
    }
    if (url.pathname === '/__fixture/background') {
      const count = Number(url.searchParams.get('count')); const sql = this.ctx.storage.sql;
      publicationSchema(this.ctx); sharedSchema(this.ctx);
      // Unrelated processed history should not make an exact MCP/HTTP read scan
      // more rows. No user body, credential or OAuth family is fabricated here.
      sql.exec('CREATE TABLE IF NOT EXISTS fixture_numbers(n INTEGER PRIMARY KEY)');
      sql.exec('DELETE FROM fixture_numbers');
      sql.exec('INSERT INTO fixture_numbers WITH RECURSIVE n(v) AS (VALUES(1) UNION ALL SELECT v+1 FROM n WHERE v<?) SELECT v FROM n', count);
      sql.exec("INSERT INTO imported_comments(comment_id,publication,imported) SELECT 100000+n,'{}',1 FROM fixture_numbers");
      sql.exec("INSERT INTO shared_entries(id,kind,body,created_at) SELECT printf('00000000-0000-4000-8000-%012d',n),'user','Fictional unrelated source','2026-10-09T00:00:00.000Z' FROM fixture_numbers");
      // Prevent upstream reconciliation in this isolated steady-state sample.
      sql.exec('INSERT OR REPLACE INTO shared_meta VALUES(?,?)', 'publisher-next-attempt', JSON.stringify(Date.now() + 300000));
      return Response.json({count});
    }
    return super.fetch(request);
  }
}
export default {
  async fetch(request, env) {
    const object = env.HUBS.get(env.HUBS.idFromName(SHARED_OBJECT));
    if (new URL(request.url).pathname.startsWith('/__fixture/')) return object.fetch(request);
    await object.fetch(new Request('https://internal/__fixture/reset'));
    const response = await worker.fetch(request, env);
    const costs = await (await object.fetch(new Request('https://internal/__fixture/cost'))).json();
    const headers = new Headers(response.headers);
    headers.set('X-Fixture-Sql-Statements', String(costs.sqlStatements));
    headers.set('X-Fixture-Rows-Read', String(costs.rowsRead));
    headers.set('X-Fixture-Rows-Written', String(costs.rowsWritten));
    return new Response(response.body, {status: response.status, headers});
  },
};
