import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {createRequire} from 'node:module';
import {schemaAt} from '../scripts/rollback-pair-contracts.mjs';

const execute=promisify(execFile),repository=resolve('.'),source=join(repository,'.jarvis-source');
const LIVE='c4d62409a3b67e4e5dac88809c6a4a0290b6e39e';
const CORE=process.env.CORE_RECOVERY_CANDIDATE||'a77ed42ba659010c477a4808a37d9d9d96896f4f';
const sqlShape=sql=>sql.replace(/--[^\n]*/g,'').replace(/\bIF NOT EXISTS\s+/g,'').replace(/;\s*$/,'').replace(/\s+/g,' ').trim();

test('the exact finite CORE manifest preserves all original DDL and survives every populated native SQLite interruption',async()=>{
  assert.match(CORE,/^[a-f0-9]{40}$/);
  const [before,after]=await Promise.all([schemaAt(source,LIVE),schemaAt(source,CORE)]);
  assert.equal(before.length,33);assert.equal(after.length,77);
  const triggers=after.filter(row=>row.sql.startsWith('CREATE TRIGGER'));
  assert.equal(triggers.length,20);assert.equal(new Set(triggers.map(row=>row.sql.match(/EXISTS ([a-z_]+)/)[1])).size,20);
  assert.equal(after.filter(row=>row.sql.includes('CREATE INDEX IF NOT EXISTS relay_event_kind_seq')).length,1);
  assert.ok(after.slice(-20).every(row=>row.path==='backend/relay-owner-jobs.js'),'Source tables precede the finite trigger expansion');
  const directory=await mkdtemp(join(tmpdir(),'core-schema-recovery-'));
  try{
    for(const [name,rows] of [['live',before],['candidate',after]])await writeFile(join(directory,name+'-schema.sql'),rows.map(row=>row.sql).join('\n'));
    const result=JSON.parse((await execute('python3',[join(repository,'tests/fixtures/release-recovery/schema-recovery.py'),directory],{timeout:30000,maxBuffer:1024*1024})).stdout);
    assert.equal(result.ddlInterruptionPoints,after.length+1);assert.equal(result.pendingRowsPreserved,4);
    assert.equal(result.runningLeasePreserved,true);assert.equal(result.immutableReplyPreserved,true);
    assert.equal(result.sqliteRestoreLossWindowDemonstrated,true);assert.equal(result.providerRestoreVerified,false);
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('changed CORE generators, routing constants, call sites and arbitrary trigger/expression SQL are refused',async()=>{
  const mutations=[
    ['backend/relay-events.js',code=>code.replace("'$.inbox_id'","'$.unknown_inbox'")],
    ['backend/relay-common.js',code=>code.replace("RELAY_OWNER_INBOX = 'brayden-owner'","RELAY_OWNER_INBOX = 'foreign-owner'")],
    ['backend/relay-common.js',code=>code.replace("RELAY_OWNER = 'github:183016859'","RELAY_OWNER = 'github:0'")],
    ['backend/public-coordination-tools.js',code=>code.replace("PUBLIC_RESULT_EVENT = 'relay.public.result.changed'","PUBLIC_RESULT_EVENT = 'foreign.event'")],
    ['backend/relay-owner-jobs.js',code=>code.replace("['INSERT', 'UPDATE', 'DELETE']","['INSERT', 'UPDATE']")],
    ['backend/relay-owner-jobs.js',code=>code.replace("NEW.recoveries<2","NEW.recoveries<99")],
    ['backend/relay-owner-jobs.js',code=>code+"\nchangeTrigger(ctx,'unreviewed','AFTER INSERT ON relay_owner_jobs','','SELECT 1;');\n"],
    ['backend/relay-owner-jobs.js',code=>code+"\nctx.storage.sql.exec('CREATE TRIGGER IF NOT EXISTS unreviewed AFTER INSERT ON relay_owner_jobs BEGIN SELECT 1; END');\n"],
    ['backend/relay-events.js',code=>code+"\nctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS unreviewed ON relay_events((${unknown}),seq)`);\n"],
    ['backend/relay-events.js',code=>code+"\nctx.storage.sql.exec('DROP TABLE relay_events');\n"],
    ['backend/relay-events.js',code=>code+"\nconst hidden='CREATE TABLE IF NOT EXISTS unreviewed(id TEXT)';ctx.storage.sql.exec(hidden);\n"],
  ];
  for(const [path,mutate] of mutations){
    let edited=false;
    const runner=async(binary,args,options)=>{
      const value=await execute(binary,args,options);
      if(args.at(-1)===CORE+':'+path&&args.includes('show')){const changed=mutate(value.stdout);assert.notEqual(changed,value.stdout,path);edited=true;return {...value,stdout:changed};}
      return value;
    };
    await assert.rejects(schemaAt(source,CORE,{runner}),/requires migration review/,path);assert.equal(edited,true,path);
  }
});

test('native workerd actual CORE schema installs exactly the independently enumerated expression index and twenty private-feed triggers', {timeout:30000},async t=>{
  const workspace=await mkdtemp(join(tmpdir(),'native-core-schema-source-')),checkout=join(workspace,'source');
  await execute('git',['-C',source,'worktree','add','--detach',checkout,CORE]);
  t.after(async()=>{await execute('git',['-C',source,'worktree','remove','--force',checkout]);await rm(workspace,{recursive:true,force:true});});
  for(const path of ['package.json','package-lock.json']){
    const committed=(await execute('git',['-C',source,'show',CORE+':'+path],{maxBuffer:1024*1024})).stdout;
    assert.equal(await readFile(join(source,path),'utf8'),committed,'Native tooling must match the exact candidate lock');
  }
  await symlink(join(source,'node_modules'),join(checkout,'node_modules'),'dir');
  const require=createRequire(join(checkout,'package.json')),{build}=require('esbuild'),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
  const fixture=`
    import {DurableObject} from 'cloudflare:workers';
    import {sharedSchema} from './backend/shared.js';
    import {relayEventSchema} from './backend/relay-events.js';
    import {relayOwnerSchema} from './backend/relay-owner.js';
    export class CoreSchemaFixture extends DurableObject{
      async fetch(){
        sharedSchema(this.ctx);relayEventSchema(this.ctx);relayOwnerSchema(this.ctx);
        const cursor=this.ctx.storage.sql.exec("SELECT name,type,sql FROM sqlite_master WHERE type IN ('trigger','index') ORDER BY name");
        const installed=[...cursor];
        return Response.json({installed,nativeRowsRead:cursor.rowsRead,nativeRowsWritten:cursor.rowsWritten});
      }
    }
    export default {fetch(request,env){return env.HUBS.get(env.HUBS.idFromName('fictional-core-schema')).fetch(request);}};
  `;
  const bundle=await build({stdin:{contents:fixture,resolveDir:checkout,sourcefile:'fictional-core-schema.js'},bundle:true,write:false,format:'esm',platform:'browser',target:'es2022',external:['node:crypto','cloudflare:workers']});
  const configuration=JSON.parse(await readFile(join(checkout,'backend/wrangler.jsonc'),'utf8'));let egress=0;
  const mf=new Miniflare(convertV4MiniflareOptions({name:'fictional-core-schema',modules:true,script:bundle.outputFiles[0].text,
    compatibilityDate:configuration.compatibility_date,compatibilityFlags:configuration.compatibility_flags||[],cf:false,telemetry:{enabled:false},
    durableObjects:{HUBS:{className:'CoreSchemaFixture',useSQLite:true}},outboundService(){++egress;throw Error('External fixture egress refused');}}));
  t.after(async()=>{await mf.dispose();assert.equal(egress,0);});
  const response=await mf.dispatchFetch('https://fictional-core-schema.test/');assert.equal(response.status,200);
  const actual=await response.json(),expected=await schemaAt(source,CORE),actualTriggers=actual.installed.filter(row=>row.name.startsWith('relay_owner_job_change_'));
  assert.equal(actualTriggers.length,20);
  assert.deepEqual(actualTriggers.map(row=>sqlShape(row.sql)).sort(),expected.filter(row=>row.sql.startsWith('CREATE TRIGGER')).map(row=>sqlShape(row.sql)).sort());
  assert.equal(sqlShape(actual.installed.find(row=>row.name==='relay_event_kind_seq').sql),sqlShape(expected.find(row=>row.sql.includes('CREATE INDEX IF NOT EXISTS relay_event_kind_seq')).sql));
  assert.ok(Number.isSafeInteger(actual.nativeRowsRead));assert.equal(actual.nativeRowsWritten,0);assert.equal(egress,0);
});
