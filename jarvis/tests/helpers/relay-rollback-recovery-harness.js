import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,posix} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {c4PublicationSources,C4_SOURCE,C4_BLOBS} from './relay-c4-publication-snapshot.js';
import {createHash} from 'node:crypto';

export const ROLLBACK_NOW=Date.parse('2099-10-09T12:00:00.000Z');
export const rollbackId=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
export const rollbackStamp='2026-10-01T12:00:00.000Z';
export const rollbackMessage=n=>({id:rollbackId(n),role:'user',body:'Fictional rollback request '+n,createdAt:rollbackStamp});
export const rollbackComment=(id,payload)=>({id,user:{id:183016859},created_at:rollbackStamp,updated_at:rollbackStamp,
  issue_url:'https://api.github.com/repos/braydenparker999/jarvis/issues/2',body:JSON.stringify(payload)});
let bundled;
async function bundle(){
  if(!bundled)bundled=(async()=>{
    const sources=c4PublicationSources();
    for(const [path,source] of Object.entries(sources)){
      const bytes=Buffer.from(source);assert.equal(createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex'),C4_BLOBS[path]);
    }
    const result=await build({entryPoints:[fileURLToPath(new URL('./relay-rollback-recovery-worker.js',import.meta.url))],bundle:true,write:false,
      format:'esm',platform:'browser',target:'es2022',external:['node:crypto'],plugins:[{name:'immutable-c4',setup(plugin){
        plugin.onResolve({filter:/^c4:/},args=>({path:args.path.slice(3),namespace:'c4'}));
        plugin.onResolve({filter:/^\./,namespace:'c4'},args=>({path:posix.normalize(posix.join(posix.dirname(args.importer),args.path)),namespace:'c4'}));
        plugin.onLoad({filter:/.*/,namespace:'c4'},args=>{assert.ok(Object.hasOwn(sources,args.path));return {contents:sources[args.path],loader:args.path.endsWith('.json')?'json':'js'};});
      }}]});return result.outputFiles[0].text;
  })();return bundled;
}
export async function createRollbackHarness(t){
  const script=await bundle(),directory=await mkdtemp(join(tmpdir(),'fictional-relay-rollback-'));
  const config=JSON.parse(readFileSync(new URL('../../backend/wrangler.jsonc',import.meta.url),'utf8'));
  let mf,external=0;
  const start=()=>{
    const options=convertV4MiniflareOptions({name:'fictional-relay-rollback',modules:true,script,compatibilityDate:config.compatibility_date,
      compatibilityFlags:config.compatibility_flags||[],cf:false,telemetry:{enabled:false},
      durableObjects:{HUBS:{className:'RollbackRecoveryHub',useSQLite:true}},
      outboundService(){external++;throw Error('No live egress in rollback regression');}});
    options.resourcePersistencePath=directory;mf=new Miniflare(options);
  };
  start();let closed=false;
  const close=async()=>{if(closed)return;closed=true;await mf.dispose();await rm(directory,{recursive:true,force:true});};t.after(close);
  return {oldSource:C4_SOURCE,get external(){return external;},close,
    async restart(){await mf.dispose();start();},
    async control(input,actor='main'){
      const response=await mf.dispatchFetch('https://rollback.example.test/case?actor='+actor,{method:'POST',body:JSON.stringify(input)});
      assert.equal(response.status,200,await response.clone().text());return response.json();
    },
    async read(path,actor='main'){
      const url=new URL(path,'https://rollback.example.test');url.pathname='/internal'+url.pathname;url.searchParams.set('actor',actor);
      const response=await mf.dispatchFetch(url);const body=await response.text();
      return new Response(body,{status:response.status,headers:{'Content-Type':'application/json','Access-Control-Allow-Origin':'https://missionarytube.z13.web.core.windows.net'}});
    }};
}
