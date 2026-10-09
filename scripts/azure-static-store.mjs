import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {safePath,ROOT,POINTER,LOADER} from './static-publication.mjs';
const execute=promisify(execFile);
const ORIGIN='https://missionarytube.z13.web.core.windows.net';
export function azureUploadArgs(key,file,type,condition){
  safePath(key);
  if(!(key.startsWith(ROOT)||key===POINTER||key===LOADER||key.endsWith('.html')))throw Error('Publication write outside release scope');
  const args=['storage','blob','upload','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--name',key,
    '--file',file,'--content-type',type,'--content-cache-control','no-cache','--overwrite','true','--no-progress','--only-show-errors','--output','none'];
  if(condition?.ifNoneMatch==='*'&&!condition.ifMatch)args.push('--if-none-match','*');
  else if(typeof condition?.ifMatch==='string'&&condition.ifMatch.length<128&&/^"[^"\r\n]+"$/.test(condition.ifMatch)&&!condition.ifNoneMatch)args.push('--if-match',condition.ifMatch);
  else throw Error('Exact create-only or ETag condition required');
  return args;
}
async function boundedResponse(response,limit){
  if(Number(response.headers.get('content-length'))>limit)throw Error('Unbounded static response');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit)throw Error('Unbounded static response');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
  return Buffer.concat(chunks,size);
}
export function azureStaticStore({env=process.env,runner=execute,fetcher=globalThis.fetch,temporary}={}){
  if(env.STORAGE_ACCOUNT!=='missionarytube'||!temporary)throw Error('Fixed Storage account and private transfer directory required');
  // Explicit login keeps OIDC/Entra identity. Reject alternate transport knobs;
  // never fall back after a denial and never print provider error bodies.
  for(const name of ['AZURE_STORAGE_KEY','AZURE_STORAGE_SAS_TOKEN','AZURE_STORAGE_CONNECTION_STRING','AZURE_STORAGE_BLOB_ENDPOINT','AZURE_STORAGE_SERVICE_ENDPOINT'])if(env[name])throw Error('Alternate Storage authentication or endpoint forbidden');
  const getPath=async path=>{
    try{
      const response=await fetcher(ORIGIN+'/'+path,{method:'GET',cache:'no-store',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(30000)});
      if(response.status===404){await response.body?.cancel();return null;}if(response.status!==200)throw Error();
      const etag=response.headers.get('etag'),contentType=response.headers.get('content-type');
      if(!/^"[^"\r\n]+"$/.test(etag||'')||!contentType)throw Error();
      return {bytes:await boundedResponse(response,32*1024*1024),contentType,etag};
    }catch{throw Error('Static bytes, MIME or ETag unavailable');}
  };
  return {
    get:key=>getPath(safePath(key)),
    route:key=>{if(key==='')return getPath('');if(!key.endsWith('/'))throw Error('Directory route required');safePath(key.slice(0,-1));return getPath(key);},
    async put(key,bytes,type,condition){
      // Every write has a provider precondition; public reads supply the ETag.
      await mkdir(temporary,{recursive:true});const dir=await mkdtemp(join(temporary,'transfer-')),file=join(dir,'payload');
      try{await writeFile(file,bytes,{mode:0o600});const args=azureUploadArgs(key,file,type,condition);
        args.push('--content-md5',createHash('md5').update(bytes).digest('base64'));
        await runner('az',args,{env,timeout:120000,killSignal:'SIGKILL',maxBuffer:1024*1024});
      }catch{throw Error('Conditional Storage write failed; inspect actual bytes before retry');}
      finally{await rm(dir,{recursive:true,force:true});}
    }
  };
}
