// Runs in Actions with owner Drive OAuth (or explicit public-key mode) and Azure OIDC.
// No credentials or catalog contents are printed or committed to git.
import {readFile,writeFile,mkdir,mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import vm from 'node:vm';
import {createDriveApi} from '../public/drawercast/drive-api.js';
import {drivePublisherAuth,DrivePublisherStopped} from './drive-publisher-auth.mjs';
import {buildCatalog,readCatalog,sha256,BASE,POINTER} from '../public/drawercast/drive-catalog.js';
const exec=promisify(execFile);
const ORIGIN='https://missionarytube.z13.web.core.windows.net';
const runSignal=AbortSignal.timeout(20*60*1000);
export async function retryFetch(url,options={}){
  for(let attempt=0;;attempt++){
    let response;
    try{
      response=await fetch(url,{...options,signal:AbortSignal.any([options.signal||runSignal,runSignal,AbortSignal.timeout(30000)])});
      let transient=response.status===429||response.status>=500;
      if(!transient||attempt>=3)return response;
    }catch(e){if(options.signal?.aborted||runSignal.aborted||attempt>=3)throw Error('Catalog network request failed.');}
    await response?.body?.cancel();
    await new Promise(resolve=>setTimeout(resolve,Math.min(8000,500*2**attempt)+Math.random()*300));
  }
}
function metadata(raw,file){
  const out={md5:file.md5Checksum||'',size:Number(file.size)};
  for(const k of ['title','artist','album','albumArtist','genre','composer','codec'])if(typeof raw?.[k]==='string')out[k]=raw[k].slice(0,4096);
  for(const k of ['year','track','disc','dur','sr','ch','bits','rgTrack','rgAlbum','rgTrackPeak','rgAlbumPeak'])if(Number.isFinite(raw?.[k]))out[k]=raw[k];
  return out;
}
async function main(){
  if(process.env.AZURE_STORAGE_ACCOUNT!=='missionarytube')throw Error('Unexpected Azure account.');
  const config=JSON.parse(await readFile(new URL('../public/assets/drive-config.json',import.meta.url),'utf8'));
  const auth=drivePublisherAuth({fetcher:retryFetch});
  const api=createDriveApi(auth.key,auth.fetcher,{authenticated:auth.authenticated});
  let previous=null;
  // A missing pointer is a first enrollment. Other failures must not silently
  // discard prior metadata or publish over an unreadable last generation.
  const probe=await retryFetch(ORIGIN+POINTER,{signal:runSignal});const missing=probe.status===404;await probe.body?.cancel();
  if(!missing)previous=await readCatalog({root:config.folderId,fetcher:retryFetch,signal:runSignal,pointerURL:ORIGIN+POINTER,baseURL:ORIGIN+BASE});
  console.log('Reconciling the complete Drive inventory in the publisher.');
  const [listing,prepared]=await Promise.all([api.list(config.folderId,runSignal),api.manifest(config.folderId,runSignal).catch(error=>{if(error instanceof DrivePublisherStopped)throw error;return {};} )]);
  console.log('Inventory complete: '+listing.files.length+' songs.');
  const old=new Map(previous?.records.map(r=>[r.id,r])||[]);
  const records=listing.files.map(file=>{
    const cached=old.get(file.id),same=cached&&cached.md5Checksum===file.md5Checksum&&Number(cached.size)===Number(file.size);
    const match=prepared[file.id]?.md5===file.md5Checksum&&prepared[file.id]?.size===Number(file.size);
    return {id:file.id,name:file.name,folder:file.folder,mimeType:file.mimeType,size:Number(file.size),md5Checksum:file.md5Checksum||'',modifiedTime:file.modifiedTime,availability:file.availability,
      prepared:metadata(match?prepared[file.id]:same?cached.prepared:{},file),
      ...(same&&cached.cover?{cover:cached.cover}:{}),...(same&&cached.metadataCheckedAt?{metadataCheckedAt:cached.metadataCheckedAt}:{}),...(same&&cached.metadataReady?{metadataReady:true}:{})};
  });
  // Empty or very large removals require an explicit manual confirmation. A
  // transient sharing mistake must not wipe everyone's cached catalog.
  if(previous?.pointer.count&&records.length<previous.pointer.count*0.8&&process.env.ALLOW_LARGE_REMOVAL!=='true')throw Error('Catalog shrank by more than 20%; review Drive sharing and run with allow_large_removal after confirming the change.');
  const work=await mkdtemp(join(tmpdir(),'poweramp-catalog-'));
  try{
    const source=await readFile(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
    const start=source.indexOf("const TD=new TextDecoder('utf-8');"),end=source.indexOf('\n/* ---------------------------------------------------------------------\n   TAG WORKER POOL',start);
    if(start<0||end<0)throw Error('Tag parser boundaries changed.');
    // Reuse the tested parser from this pinned source revision. This evaluates
    // only repository code; downloaded tags are data passed to readTags.
    const parse=vm.runInNewContext(source.slice(start,end)+'\nreadTags;', {TextDecoder,atob,performance});
    await mkdir(join(work,'covers'));await mkdir(join(work,'g'));
    const candidates=records.filter(r=>r.availability==='ready'&&!r.metadataReady&&(!r.metadataCheckedAt||Date.now()-r.metadataCheckedAt>86400000))
      .sort((a,b)=>(a.metadataCheckedAt||0)-(b.metadataCheckedAt||0)).slice(0,250);
    console.log('Preparing up to '+candidates.length+' changed metadata records.');
    let preparedCount=0;
    for(let i=0;i<candidates.length;i+=4){await Promise.all(candidates.slice(i,i+4).map(async r=>{
      r.metadataCheckedAt=Date.now();
      try{
        const tags=await parse(api.metadataFile({remoteId:r.id,size:r.size},AbortSignal.any([runSignal,AbortSignal.timeout(20000)])),{remote:true,throwErrors:true});
        r.prepared=metadata({...r.prepared,...tags,dur:tags.tagDur||r.prepared.dur,sr:tags.sampleRate||r.prepared.sr,ch:tags.channels||r.prepared.ch},r);
        if(tags.pic?.data?.length>100&&tags.pic.data.length<=2*1024*1024){
          const input=join(work,r.id+'.image'),output=join(work,r.id+'.jpg');await writeFile(input,tags.pic.data);
          await exec('ffmpeg',['-v','error','-y','-i',input,'-vf','scale=320:320:force_original_aspect_ratio=decrease','-frames:v','1',output],{timeout:15000,maxBuffer:10000});
          const bytes=await readFile(output);if(bytes.length>256*1024)throw Error('Cover exceeds budget.');
          r.cover=await sha256(bytes);await writeFile(join(work,'covers',r.cover+'.jpg'),bytes);await rm(input);await rm(output);
        }
        r.metadataReady=true;preparedCount++;
      }catch(error){if(error instanceof DrivePublisherStopped)throw error;/* Optional tags retry later; the complete file inventory remains valid. */}
    }));}
    console.log('Metadata preparation complete. Building verified shards.');
    const catalog=await buildCatalog(records,{root:listing.id,name:listing.name});
    if(catalog.pointer.generation===previous?.pointer.generation){console.log('Catalog unchanged: '+records.length+' songs.');return;}
    catalog.pointer.previous=previous?.pointer.generation||null;
    const genDir=join(work,'g',catalog.pointer.generation);await mkdir(genDir);
    for(let i=0;i<catalog.shards.length;i++)await writeFile(join(genDir,i+'.json'),catalog.shards[i]);
    const pointerFile=join(work,'pointer.json');await writeFile(pointerFile,JSON.stringify(catalog.pointer)+'\n');
    console.log('Catalog validated: '+catalog.shards.length+' shards. Uploading immutable files.');
    const az=async args=>exec('az',['storage','blob',...args,'--account-name','missionarytube','--auth-mode','login','--only-show-errors','--no-progress','--output','none'],{timeout:180000,maxBuffer:2*1024*1024});
    // Cover and shard names are content addressed. Pointer is the sole mutable
    // commit marker and is uploaded only after all public reads verify.
    if(records.some(r=>r.cover)&&candidates.length)await az(['upload-batch','--destination','$web','--destination-path','assets/drive-catalog-v2/covers','--source',join(work,'covers'),'--overwrite','true','--content-type','image/jpeg','--content-cache-control','public,max-age=31536000,immutable']);
    await az(['upload-batch','--destination','$web','--destination-path','assets/drive-catalog-v2/g','--source',join(work,'g'),'--overwrite','true','--content-type','application/json','--content-cache-control','public,max-age=31536000,immutable']);
    console.log('Immutable files uploaded. Verifying public shard reads.');
    for(const name of await readdir(join(work,'covers'))){
      const response=await retryFetch(ORIGIN+BASE+'covers/'+name,{signal:runSignal});
      if(!response.ok)throw Error('Published cover is unavailable.');
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length>256*1024||await sha256(bytes)!==name.slice(0,-4))throw Error('Published cover verification failed.');
    }
    const stagedFetch=(url,options)=>url===ORIGIN+POINTER?Promise.resolve(Response.json(catalog.pointer)):retryFetch(url,options);
    await readCatalog({root:listing.id,fetcher:stagedFetch,signal:runSignal,pointerURL:ORIGIN+POINTER,baseURL:ORIGIN+BASE});
    await az(['upload','--container-name','$web','--name','assets/drive-catalog-v2/g/'+catalog.pointer.generation+'/pointer.json','--file',pointerFile,'--overwrite','true','--content-type','application/json','--content-cache-control','public,max-age=31536000,immutable']);
    await az(['upload','--container-name','$web','--name',POINTER.slice(1),'--file',pointerFile,'--overwrite','true','--content-type','application/json','--content-cache-control','no-cache']);
    const verified=await readCatalog({root:listing.id,fetcher:retryFetch,signal:runSignal,pointerURL:ORIGIN+POINTER,baseURL:ORIGIN+BASE});
    if(verified.pointer.generation!==catalog.pointer.generation)throw Error('Published pointer verification failed.');
    console.log('Published verified catalog: '+records.length+' songs, '+catalog.shards.length+' shards, '+preparedCount+' metadata records prepared. Generation '+catalog.pointer.generation);
  }finally{await rm(work,{recursive:true,force:true});}
}
if(process.argv[1]===fileURLToPath(import.meta.url))main().catch(error=>{const detail=String(error.stderr||error.message||'Unknown failure').replace(/AIza[A-Za-z0-9_-]+/g,'[redacted]').slice(-2000);console.error(detail);console.error('Catalog publication failed; inspect source availability, Azure permissions, or the large-removal guard. The previous pointer remains valid unless final verification alone failed.');process.exitCode=1;});
