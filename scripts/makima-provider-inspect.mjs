import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readWorkerSettings} from './check-music-worker-bindings.mjs';
import {activeVersion} from './worker-release-identity.mjs';
export const SOURCE='099ec1a0b2b621a3799f4f8346490903f212a912';
export const CLIENT='b6bf3d2688484111e45ab58a644208918b875ad6fccc16f3ef65ad986aab4def';
const NAMES=['RELAY_MAKIMA_GITHUB_CLIENT_ID','RELAY_MAKIMA_GITHUB_CLIENT_SECRET','RELAY_MAKIMA_CLIENT_ID','RELAY_MAKIMA_ENABLED'];
export function summary(settings){
 if(!Array.isArray(settings?.bindings))throw Error('invalid_settings');
 const bindings=settings.bindings;
 if(new Set(bindings.map(b=>b.name)).size!==bindings.length)throw Error('duplicate_bindings');
 const find=name=>bindings.find(b=>b.name===name),flag=find('RELAY_MAKIMA_ENABLED'),id=find('RELAY_MAKIMA_CLIENT_ID');
 return {fields:NAMES.map(name=>({name,present:!!find(name),type:find(name)?.type||null})),publicClientMatches:id?.type==='plain_text'&&id.text===CLIENT,enabled:flag?.type==='plain_text'&&flag.text==='true',githubSecretStoredAsSecret:find('RELAY_MAKIMA_GITHUB_CLIENT_SECRET')?.type==='secret_text',bindingNames:bindings.map(({name,type})=>({name,type}))};
}
export async function inspect({account,token,fetcher=globalThis.fetch}){
 const settings=await readWorkerSettings({account,token,fetcher});
 const api=async path=>{const r=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/${path}`,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error('provider_read_failed');return r;};
 const version=activeVersion(await (await api('deployments?per_page=1')).json());
 const metadata=await (await api('versions/'+version)).json();
 if(metadata.success!==true||metadata.result?.id!==version)throw Error('invalid_version_metadata');
 const content=await api('content/v2'),files=[...(await content.formData()).entries()].filter(([,v])=>typeof v!=='string');
 if(files.length!==1||files[0][0]!=='worker.js')throw Error('unexpected_worker_modules');
 const bytes=Buffer.from(await files[0][1].arrayBuffer());
 const second=await readWorkerSettings({account,token,fetcher});
 if(JSON.stringify(summary(settings))!==JSON.stringify(summary(second)))throw Error('settings_changed');
 if(activeVersion(await (await api('deployments?per_page=1')).json())!==version)throw Error('version_changed');
 const code=bytes.toString('utf8');
 return {readOnly:true,worker:'jarvis-hub-api',activeVersion:version,codeSha256:createHash('sha256').update(bytes).digest('hex'),makimaHandlerPresent:code.includes('Makima adapter is not activated')&&code.includes('makima_channel_send'),compatibilityDate:settings.compatibility_date,compatibilityFlags:settings.compatibility_flags||[],...summary(settings)};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{
  if(process.argv.length!==2||process.env.SOURCE_COMMIT!==SOURCE)throw Error('source_not_approved');
  if(execFileSync('git',['-C','.jarvis-source','rev-parse','HEAD'],{encoding:'utf8'}).trim()!==SOURCE)throw Error('source_not_approved');
  console.log(JSON.stringify(await inspect({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN})));
 }catch{console.error('Makima provider inspection failed; no mutation was attempted and provider/secret values were not logged.');process.exitCode=1;}
}
