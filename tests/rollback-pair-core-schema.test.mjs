import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,mkdir,writeFile,readFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,dirname,delimiter} from 'node:path';
import {createRequire} from 'node:module';
import {schemaAt} from '../scripts/rollback-pair-contracts.mjs';

const execute=promisify(execFile),repository=resolve('.'),source=join(repository,'.jarvis-source');
const LIVE='c4d62409a3b67e4e5dac88809c6a4a0290b6e39e';
const CORE=process.env.CORE_RECOVERY_CANDIDATE||'ed7bbd436689be3ac9cca1ab5f111341dd690b80';
const sqlShape=sql=>sql.replace(/--[^\n]*/g,'').replace(/\bIF NOT EXISTS\s+/g,'').replace(/;\s*$/,'').replace(/\s+/g,' ').trim();

async function lockedNativeTools(workspace,manifests,t){
  const lock=JSON.parse(manifests.get('package-lock.json')),packages=Object.entries(lock.packages).filter(([path])=>path);
  for(const [path,entry] of packages){
    assert.match(path,/^node_modules\/(?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.-]+$/);
    assert.ok(path.split('/').every(part=>part!=='.'&&part!=='..'));
    let url;try{url=new URL(entry.resolved);}catch{throw Error('Native fixture tooling requires public locked registry URLs');}
    assert.ok(url.protocol==='https:'&&url.hostname==='registry.npmjs.org'&&!url.port&&!url.username&&!url.password&&!url.search&&!url.hash,
      'Native fixture tooling requires credential-free public locked registry URLs');
    assert.match(entry.integrity,/^sha512-[A-Za-z0-9+/]+=*$/);
  }
  const applicable=(values,value)=>!values||(!values.includes('!'+value)&&(values.includes(value)||values.every(item=>item.startsWith('!'))));
  const exact=async directory=>{
    for(const [path,entry] of packages){
      if(!applicable(entry.os,process.platform)||!applicable(entry.cpu,process.arch))continue;
      try{if(JSON.parse(await readFile(join(directory,path,'package.json'),'utf8')).version!==entry.version)return false;}
      catch(error){if(error.code==='ENOENT')return false;throw error;}
    }
    return true;
  };
  // Only a complete physical source installation can be reused. Resolution
  // through the orchestration parent would select its different esbuild lock.
  if(await exact(source)){t.diagnostic('Reused exact source-locked native fixture tooling');return join(source,'node_modules');}
  const tools=join(workspace,'tools');await mkdir(tools);
  for(const [path,contents] of manifests)await writeFile(join(tools,path),contents,{mode:0o600});
  const userConfig=join(tools,'user.npmrc'),globalConfig=join(tools,'global.npmrc');
  for(const path of [userConfig,globalConfig])await writeFile(path,'',{mode:0o600});
  await mkdir(join(tools,'cache'),{mode:0o700});
  const env=Object.fromEntries(['PATH','TMPDIR','TMP','TEMP','LANG','LC_ALL','TZ','SystemRoot','WINDIR'].filter(key=>process.env[key]!==undefined).map(key=>[key,process.env[key]]));
  // Keep public-registry transport and trust configuration without inheriting
  // npm authentication, user configuration, Node hooks or provider credentials.
  for(const key of ['HTTP_PROXY','HTTPS_PROXY'])if(process.env[key]){
    let proxy;try{proxy=new URL(process.env[key]);}catch{throw Error('Native fixture proxy transport must be a credential-free URL');}
    assert.ok(['http:','https:'].includes(proxy.protocol)&&!proxy.username&&!proxy.password&&!proxy.search&&!proxy.hash,
      'Native fixture proxy transport must be a credential-free URL');
    env[key]=process.env[key];
  }
  for(const key of ['NO_PROXY','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'])if(process.env[key])env[key]=process.env[key];
  Object.assign(env,{PATH:dirname(process.execPath)+delimiter+(env.PATH||''),CI:'true',NO_UPDATE_NOTIFIER:'1'});
  try{
    await execute('npm',['ci','--ignore-scripts','--include=dev','--include=optional','--no-audit','--no-fund','--progress=false',
      '--userconfig',userConfig,'--globalconfig',globalConfig,'--registry','https://registry.npmjs.org','--cache',join(tools,'cache'),
      '--fetch-retries=0','--fetch-timeout=10000'],{cwd:tools,env,timeout:20000,maxBuffer:64*1024});
  }catch(error){
    const reason=error.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER'?'output limit':error.killed?'timeout':Number.isInteger(error.code)?'exit '+error.code:'launch failure';
    throw Error('Source-locked native fixture tooling bootstrap failed ('+reason+')');
  }
  for(const [path,contents] of manifests)assert.equal(await readFile(join(tools,path),'utf8'),contents,'Bootstrap must preserve the exact candidate manifests');
  assert.equal(await exact(tools),true,'Bootstrap must install the exact applicable locked packages');
  t.diagnostic('Provisioned isolated source-locked native fixture tooling with lifecycle scripts disabled');
  return join(tools,'node_modules');
}

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
    ['backend/relay-events.js',code=>code.replace('export function relayEventSchema(ctx) {',"export function relayEventSchema(ctx) {\n  const eventKindSQL = '0';")],
    ['backend/relay-events.js',code=>code+"\nfunction repeatedSchema(ctx) { ctx.storage.sql.exec(`CREATE INDEX IF NOT EXISTS relay_event_kind_seq ON relay_events((${eventKindSQL}),seq)`); }\n"],
    ['backend/relay-common.js',code=>code.replace("RELAY_OWNER_INBOX = 'brayden-owner'","RELAY_OWNER_INBOX = 'foreign-owner'")],
    ['backend/relay-common.js',code=>code.replace("RELAY_OWNER = 'github:183016859'","RELAY_OWNER = 'github:0'")],
    ['backend/public-coordination-tools.js',code=>code.replace("PUBLIC_RESULT_EVENT = 'relay.public.result.changed'","PUBLIC_RESULT_EVENT = 'foreign.event'")],
    ['backend/relay-owner-jobs.js',code=>code.replace("['INSERT', 'UPDATE', 'DELETE']","['INSERT', 'UPDATE']")],
    ['backend/relay-owner-jobs.js',code=>code.replace('import {RELAY_OWNER,','import {RELAY_OWNER as REVIEWED_RELAY_OWNER,')+"\nconst RELAY_OWNER = 'github:0';\n"],
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
  let worktree=false;
  t.after(async()=>{try{if(worktree)await execute('git',['-C',source,'worktree','remove','--force',checkout]);}finally{await rm(workspace,{recursive:true,force:true});}});
  const manifests=new Map();
  for(const path of ['package.json','package-lock.json']){
    const committed=(await execute('git',['-C',source,'show',CORE+':'+path],{maxBuffer:1024*1024})).stdout;
    assert.equal(await readFile(join(source,path),'utf8'),committed,'Native tooling must match the exact candidate lock');
    manifests.set(path,committed);
  }
  const modules=await lockedNativeTools(workspace,manifests,t);
  await execute('git',['-C',source,'worktree','add','--detach',checkout,CORE]);worktree=true;
  await symlink(modules,join(checkout,'node_modules'),'dir');
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
