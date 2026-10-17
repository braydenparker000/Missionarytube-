import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare, convertV4MiniflareOptions} from 'miniflare';

// Standalone local workerd instrumentation. Only this test owns the in-memory
// fictional private store; no production OAuth/device credential is fabricated.
const fixtureSource = `
import {relayOwnerSchema} from './backend/relay-owner.js';
import {relayOwnerJobsChanges} from './backend/relay-owner-jobs.js';
import {relayEventSchema} from './backend/relay-events.js';
export class PrivateJobCost {
  constructor(ctx,env){
    this.ctx=ctx;this.env=env;this.cursors=[];
    const sql={exec:(query,...values)=>{const cursor=ctx.storage.sql.exec(query,...values);this.cursors.push({query,cursor});return cursor;}};
    const storage=new Proxy(ctx.storage,{get:(target,key)=>{if(key==='sql')return sql;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
    this.measured=new Proxy(ctx,{get:(target,key)=>{if(key==='storage')return storage;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  }
  async alarm(){}
  async fetch(request){
    const path=new URL(request.url).pathname,sql=this.ctx.storage.sql;
    if(path==='/seed'){
      // The existing pre-jobs private entry schema and index, with a real cold
      // metadata/change-table migration deferred until the measured first read.
      sql.exec("CREATE TABLE relay_owner_entries (seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,kind TEXT NOT NULL CHECK(kind IN ('user','reply')),reply_to TEXT UNIQUE,body TEXT NOT NULL,created_at TEXT NOT NULL,principal TEXT NOT NULL,device_id TEXT NOT NULL,authentication_source TEXT NOT NULL)");
      sql.exec('CREATE INDEX relay_owner_entry_kind_seq ON relay_owner_entries(kind,seq)');
      sql.exec('CREATE TABLE fixture_numbers(n INTEGER PRIMARY KEY)');
      sql.exec('INSERT INTO fixture_numbers WITH RECURSIVE numbers(n) AS (VALUES(1) UNION ALL SELECT n+1 FROM numbers WHERE n<5000) SELECT n FROM numbers');
      sql.exec("INSERT INTO relay_owner_entries(id,kind,body,created_at,principal,device_id,authentication_source) SELECT printf('00000000-0000-4000-8000-%012d',n),'user','Fictional private legacy report','2026-10-08T00:00:00Z','github:183016859','fictional-legacy-device','owner-device-session' FROM fixture_numbers");
      this.after='0';return Response.json({seeded:5000});
    }
    if(path==='/complete'){
      let pages=0,done=false;
      while(!done&&pages<200){
        const value=this.measured.storage.transactionSync(()=>{relayOwnerSchema(this.measured);return relayOwnerJobsChanges(this.measured,this.env,this.after,50,undefined);});
        this.after=value.cursor;done=value.nextCursor===null&&!value.bootstrapPending;++pages;
      }
      this.cursors=[];return Response.json({done,pages,jobs:[...sql.exec('SELECT COUNT(*) AS n FROM relay_owner_jobs')][0].n});
    }
    if(path==='/recoveries'){
      relayEventSchema(this.ctx);
      sql.exec("INSERT INTO relay_subscriptions VALUES('fictional-private-sub','github:183016859','fictional-missing-grant','relay.owner.message.created','{}','https://fictional.example.test/callback','fictional-local-secret',NULL,NULL,?,0,0,'fictional-generation','active')",Date.now()+86400000);
      sql.exec("INSERT INTO relay_events(event_id,message_id,occurred_at,created_ms,data) SELECT 'fictional-event-'||n,'owner:'||printf('00000000-0000-4000-8000-%012d',n),'2026-10-08T00:00:00Z',?,'{}' FROM fixture_numbers",Date.now());
      sql.exec("INSERT INTO relay_outbox(subscription_id,event_seq,body,status,next_attempt_ms) SELECT 'fictional-private-sub',n,'{}','delivered',? FROM fixture_numbers",Date.now());
      sql.exec("INSERT INTO relay_outbox_recoveries(subscription_id,event_seq,recoveries,last_recovery_ms) SELECT 'fictional-private-sub',n,2,? FROM fixture_numbers",Date.now());
      return Response.json({recoveries:5000});
    }
    this.cursors=[];
    if(path==='/mutate')this.measured.storage.sql.exec("UPDATE relay_owner_jobs SET cancel_requested_ms=?,updated_ms=? WHERE id='00000000-0000-4000-8000-000000000001'",Date.now(),Date.now());
    const value=this.measured.storage.transactionSync(()=>{relayOwnerSchema(this.measured);return relayOwnerJobsChanges(this.measured,this.env,this.after,50,undefined);});
    this.after=value.cursor;
    const queries=this.cursors.map(({query,cursor})=>({query:query.replace(/\\s+/g,' ').trim(),rowsRead:cursor.rowsRead,rowsWritten:cursor.rowsWritten}));
    return Response.json({changes:value.changes.length,bootstrapPending:value.bootstrapPending,cursor:value.cursor,
      rowsRead:queries.reduce((n,q)=>n+q.rowsRead,0),rowsWritten:queries.reduce((n,q)=>n+q.rowsWritten,0),queries});
  }
}
export default {fetch(request,env){return env.HUBS.get(env.HUBS.idFromName('local-private-job-cost')).fetch(request);}};
`;

test('real workerd bounds cold private migration and warm refresh over 5000 fictional legacy requests', {timeout: 30000}, async () => {
  const configuration = JSON.parse(readFileSync(new URL('../backend/wrangler.jsonc', import.meta.url), 'utf8'));
  const bundle = await build({stdin: {contents: fixtureSource, resolveDir: fileURLToPath(new URL('../', import.meta.url)), sourcefile: 'local-private-jobs-cost.js'},
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', external: ['node:crypto']});
  let egress = 0;
  const mf = new Miniflare(convertV4MiniflareOptions({name: 'local-private-jobs-cost', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: configuration.compatibility_date, compatibilityFlags: configuration.compatibility_flags || [], cf: false, telemetry: {enabled: false},
    bindings: {RELAY_MCP_ENABLED: 'true', RELAY_OWNER_ENABLED: 'true', RELAY_MCP_ORIGIN: 'https://fictional.example.test'},
    durableObjects: {HUBS: {className: 'PrivateJobCost', useSQLite: true}}, outboundService() {++egress; throw Error('No external fixture requests');}}));
  try {
    assert.equal((await mf.dispatchFetch('https://fictional.example.test/seed')).status, 200);
    const cold = await (await mf.dispatchFetch('https://fictional.example.test/cold')).json();
    process.stdout.write('LOCAL_PRIVATE_JOB_COST ' + JSON.stringify({phase: 'cold', changes: cold.changes, rowsRead: cold.rowsRead, rowsWritten: cold.rowsWritten}) + '\n');
    if(cold.rowsRead>=2000)process.stdout.write('LOCAL_PRIVATE_JOB_COST_QUERIES '+JSON.stringify(cold.queries.filter(query=>query.rowsRead>100))+'\n');
    assert.equal(cold.changes, 50); assert.equal(cold.bootstrapPending, true);
    assert.ok(cold.rowsRead < 2000, 'First migration read must not inspect all 5000 legacy requests');
    assert.ok(cold.rowsWritten < 1000, 'First migration write must be one bounded metadata/checkpoint page');
    const completed = await (await mf.dispatchFetch('https://fictional.example.test/complete')).json();
    assert.equal(completed.done, true); assert.equal(completed.jobs, 5000); assert.equal(completed.pages, 99);
    const warm = await (await mf.dispatchFetch('https://fictional.example.test/warm')).json();
    process.stdout.write('LOCAL_PRIVATE_JOB_COST ' + JSON.stringify({phase: 'warm', changes: warm.changes, rowsRead: warm.rowsRead, rowsWritten: warm.rowsWritten}) + '\n');
    assert.equal(warm.changes, 0); assert.equal(warm.bootstrapPending, false);
    assert.ok(warm.rowsRead < 40, 'Empty refresh must be independent of private history size');
    assert.equal(warm.rowsWritten, 0, 'Warm helper refresh must not rewrite metadata, history, checkpoints or index rows');
    assert.equal((await mf.dispatchFetch('https://fictional.example.test/recoveries')).status,200);
    assert.equal((await (await mf.dispatchFetch('https://fictional.example.test/complete')).json()).done,true);
    const mutation=await(await mf.dispatchFetch('https://fictional.example.test/mutate')).json();
    process.stdout.write('LOCAL_PRIVATE_JOB_COST '+JSON.stringify({phase:'one-old-job-with-5000-recoveries',changes:mutation.changes,rowsRead:mutation.rowsRead,rowsWritten:mutation.rowsWritten})+'\n');
    assert.equal(mutation.changes,1);
    assert.ok(mutation.rowsRead<100,'One old job mutation must not scan retained recovery rows or private requests');
    assert.ok(mutation.rowsWritten<20,'One old job mutation must not fan out writes to unrelated private jobs');
    assert.equal(egress, 0);
  } finally {await mf.dispose();}
});
