import {createHash} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readWorkerSettings} from './check-music-worker-bindings.mjs';
import {activeVersion} from './worker-release-identity.mjs';
import {SOURCE,CLIENT,summary} from './makima-provider-inspect.mjs';
const BEFORE_VERSION='f6156578-156c-49b3-8638-d11d651f00a5';
const BEFORE_CODE='883b1b431a59e7824d9eee444da5cbfe75c37e0e627613c9495d89c26e46c38e';
const ORIGIN='https://jarvis-hub-api.braydenparker999.workers.dev';
const hash=b=>createHash('sha256').update(b).digest('hex');
const stop=code=>{throw Error(code);};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const projected=value=>JSON.stringify(canonical(projectedSettings(value)));
const mutable=new Set(['RELAY_MAKIMA_CLIENT_ID','RELAY_MAKIMA_ENABLED']);
const publicFlags=new Set(['RELAY_MCP_ENABLED','RELAY_OWNER_ENABLED','RELAY_AGENTS_ENABLED','RELAY_MAST_ENABLED','RELAY_AGENT_LUCY_OAUTH_ENABLED','MUSIC_PUBLIC_READ']);
const metadataKeys=['compatibility_date','compatibility_flags','logpush','observability','placement','limits','tail_consumers','tags','cache_options'];
export function projectedSettings(settings){
 if(!Array.isArray(settings?.bindings))stop('invalid_settings');
 const names=settings.bindings.map(b=>b.name);if(new Set(names).size!==names.length)stop('duplicate_bindings');
 const resourceKeys=['name','type','namespace_id','class_name','script_name','bucket_name','jurisdiction','service','environment'];
 const bindings=settings.bindings.filter(b=>!mutable.has(b.name)).map(b=>{
  const out=Object.fromEntries(resourceKeys.filter(k=>k in b).map(k=>[k,b[k]]));
  if(publicFlags.has(b.name)&&b.type==='plain_text')out.text=b.text;
  return out;
 }).sort((a,b)=>a.name.localeCompare(b.name));
 return {bindings,...Object.fromEntries(metadataKeys.filter(k=>k in settings).map(k=>[k,settings[k]]))};
}
export function uploadMetadata(settings){
 const find=n=>settings.bindings?.find(b=>b.name===n);
 const hubs=find('HUBS');if(hubs?.type!=='durable_object_namespace'||hubs.class_name!=='Hub')stop('wrong_storage');
 if(find('RELAY_MCP_ENABLED')?.type!=='plain_text'||find('RELAY_MCP_ENABLED').text!=='true')stop('existing_relay_not_enabled');
 if(!find('RELAY_MAKIMA_GITHUB_CLIENT_ID')||find('RELAY_MAKIMA_GITHUB_CLIENT_SECRET')?.type!=='secret_text')stop('makima_secure_fields_missing');
 if(settings.compatibility_date!=='2026-09-19'||(settings.compatibility_flags||[]).length)stop('unqualified_compatibility_settings');
 const keep=[...new Set(settings.bindings.map(b=>b.type))];
 if(keep.some(type=>!['plain_text','secret_text','durable_object_namespace','r2_bucket'].includes(type)))stop('unreviewed_resource_type');
 return {main_module:'worker.js',keep_bindings:keep,keep_assets:true,
  ...Object.fromEntries(metadataKeys.filter(k=>k in settings).map(k=>[k,settings[k]])),
  bindings:[{name:'RELAY_MAKIMA_CLIENT_ID',type:'plain_text',text:CLIENT},{name:'RELAY_MAKIMA_ENABLED',type:'plain_text',text:'false'}]};
}
export function enableBindings(settings){
 const id=settings.bindings?.find(b=>b.name==='RELAY_MAKIMA_CLIENT_ID');if(id?.type!=='plain_text'||id.text!==CLIENT)stop('public_client_mismatch');
 // Existing plaintext and secret values stay server-side; retain by name/type.
 return settings.bindings.filter(b=>b.name!=='RELAY_MAKIMA_ENABLED').map(({name,type})=>({name,type})).concat({name:'RELAY_MAKIMA_ENABLED',type:'plain_text',text:'true'});
}
export async function deploy({account,token,bundle,fetcher=globalThis.fetch,onStage=()=>{},checkpoint={version:BEFORE_VERSION,code:BEFORE_CODE}}){
 const api=async(path,init={})=>{
  const r=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api${path?'/'+path:''}`,{method:'GET',...init,redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});
  if(!r.ok)stop('provider_request_failed');return r;
 };
 const readSettings=()=>readWorkerSettings({account,token,fetcher});
 const version=async()=>activeVersion(await (await api('deployments?per_page=1')).json());
 const codeHash=async()=>{const f=[...(await (await api('content/v2')).formData()).entries()].filter(([,v])=>typeof v!=='string');if(f.length!==1||f[0][0]!=='worker.js')stop('unexpected_modules');return hash(Buffer.from(await f[0][1].arrayBuffer()));};
 const before=await readSettings(),beforeVersion=await version(),beforeHash=await codeHash();
 if(beforeVersion!==checkpoint.version||beforeHash!==checkpoint.code)stop('live_identity_changed');
 const metadata=uploadMetadata(before),expected=projected(before);
 onStage({stage:'reconciled',source:SOURCE,beforeVersion,beforeCodeSha256:beforeHash,secureFieldsPresent:true});
 if(await version()!==beforeVersion)stop('live_identity_changed');
 const body=new FormData();body.set('metadata',JSON.stringify(metadata));body.set('worker.js',new Blob([bundle],{type:'application/javascript+module'}),'worker.js');
 const uploaded=await (await api('',{method:'PUT',body})).json();if(uploaded.success!==true)stop('upload_failed');
 const after=await readSettings(),afterVersion=await version();
 if(await codeHash()!==hash(bundle))stop('uploaded_code_mismatch');
 if(projected(after)!==expected)stop('preserved_settings_changed');
 onStage({stage:'code_deployed_disabled',source:SOURCE,version:afterVersion,codeSha256:hash(bundle),bindingsPreserved:true,credentialsCopied:false});
 // A normal unauthenticated probe is used once. No custom UA/proxy or retry.
 const inactive=await fetcher(ORIGIN+'/.well-known/oauth-protected-resource/relay/makima/mcp',{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(inactive.status!==503)stop(inactive.status===403?'public_access_denied_before_enable':'disabled_route_unverified');
 if(await version()!==afterVersion)stop('live_identity_changed');
 if(projected(await readSettings())!==expected)stop('preserved_settings_changed');
 const patch=new FormData();patch.set('settings',JSON.stringify({bindings:enableBindings(after)}));
 if((await (await api('settings',{method:'PATCH',body:patch})).json()).success!==true)stop('enable_failed');
 const enabled=await readSettings();
 if(projected(enabled)!==expected||summary(enabled).enabled!==true||summary(enabled).publicClientMatches!==true)stop('enable_verification_failed');
 const enabledVersion=await version();if(await codeHash()!==hash(bundle))stop('code_changed_during_enable');
 onStage({stage:'enabled',source:SOURCE,version:enabledVersion,scope:'relay:makima',otherBindingsPreserved:true});
 const get=async path=>fetcher(ORIGIN+path,{method:'GET',redirect:'error',signal:AbortSignal.timeout(15000)});
 const protectedResponse=await get('/.well-known/oauth-protected-resource/relay/makima/mcp');
 if(protectedResponse.status!==200)stop(protectedResponse.status===403?'public_access_denied_after_enable':'metadata_unavailable');
 const protectedData=await protectedResponse.json();
 if(JSON.stringify(protectedData.authorization_servers)!==JSON.stringify([ORIGIN+'/relay/makima'])||protectedData.resource!==ORIGIN+'/relay/makima/mcp'||JSON.stringify(protectedData.scopes_supported)!=='["relay:makima"]')stop('metadata_scope_mismatch');
 const authorization=await get('/.well-known/oauth-authorization-server/relay/makima');if(authorization.status!==200)stop('authorization_metadata_unavailable');
 const auth=await authorization.json();if(auth.registration_endpoint||JSON.stringify(auth.scopes_supported)!=='["relay:makima"]'||JSON.stringify(auth.code_challenge_methods_supported)!=='["S256"]')stop('authorization_policy_mismatch');
 const denied=await get('/relay/makima/oauth/authorize?'+new URLSearchParams({client_id:CLIENT,redirect_uri:ORIGIN+'/relay/makima/invalid-callback',response_type:'code',resource:ORIGIN+'/relay/makima/mcp',scope:'relay:makima',state:'synthetic-diagnostic-state',code_challenge_method:'S256',code_challenge:'a'.repeat(43)}));
 if(denied.status!==400||denied.headers.has('Location')||(await denied.json()).error_description!=='redirect_uri_mismatch')stop('strict_callback_unverified');
 const challenge=await get('/relay/makima/mcp');if(challenge.status!==401)stop('oauth_challenge_unverified');
 return {stage:'endpoint_ready',source:SOURCE,version:enabledVersion,codeSha256:hash(bundle),url:protectedData.resource,client_id:CLIENT,scope:'relay:makima',strictCallbackVerified:true,realGrokConnection:false,grantCreated:false,webhookOrRoutineCreated:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 let stage='not_started';
 try{
  if(process.argv.length!==2||process.env.SOURCE_COMMIT!==SOURCE||execFileSync('git',['-C','.jarvis-source','rev-parse','HEAD'],{encoding:'utf8'}).trim()!==SOURCE)stop('source_not_approved');
  const sourceConfig=JSON.parse(await readFile('.jarvis-source/backend/wrangler.jsonc','utf8'));if(sourceConfig.name!=='jarvis-hub-api'||sourceConfig.compatibility_date!=='2026-09-19')stop('source_not_approved');
  const qualification=await fetch('https://api.github.com/repos/braydenparker999/jarvis/actions/runs/38388559662',{headers:{Accept:'application/vnd.github+json'},redirect:'error'});
  if(!qualification.ok)stop('qualification_unavailable');const q=await qualification.json();if(q.repository?.full_name!=='braydenparker999/jarvis'||q.head_repository?.fork===true||q.head_sha!==SOURCE||q.event!=='push'||q.head_branch!=='release/astra-live-backport-20261009'||q.path!=='.github/workflows/validate-r2.yml'||q.status!=='completed'||q.conclusion!=='success')stop('qualification_unavailable');
  const {build}=await import(pathToFileURL(resolve('.jarvis-source/node_modules/esbuild/lib/main.js')));
  const compiled=await build({absWorkingDir:resolve('.jarvis-source'),entryPoints:['backend/worker.js'],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',external:['node:crypto'],logLevel:'silent'});
  if(compiled.outputFiles.length!==1)stop('unexpected_bundle');
  const result=await deploy({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN,bundle:compiled.outputFiles[0].contents,onStage:record=>{stage=record.stage;console.log(JSON.stringify(record));}});
  await writeFile('makima-endpoint-ready.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
 }catch(error){const allowed=new Set(['source_not_approved','qualification_unavailable','live_identity_changed','makima_secure_fields_missing','wrong_storage','existing_relay_not_enabled','unqualified_compatibility_settings','unreviewed_resource_type','preserved_settings_changed','uploaded_code_mismatch','unexpected_modules','public_access_denied_before_enable','public_access_denied_after_enable','disabled_route_unverified','strict_callback_unverified','public_client_mismatch']);console.error(JSON.stringify({stage,stopped:true,reason:allowed.has(error.message)?error.message:'provider_or_validation_failed',secretValuesLogged:false}));process.exitCode=1;}
}
