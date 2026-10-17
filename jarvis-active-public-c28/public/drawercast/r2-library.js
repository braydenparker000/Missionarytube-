import {validateAnalysis} from './audio-analysis.js';
// Native R2 discovery. Audio, tags and identities no longer require a Drive catalog.
import {commitR2Catalog} from './r2-api.js';
export {commitR2Catalog};
export const LIBRARY_KEY='catalog/r2-library-v1.json';
export const MAX_LIBRARY_BYTES=16*1024*1024;
export const HEX=/^[a-f0-9]{64}$/;
export const SONG_ID=/^r2_(?:[A-Za-z0-9_-]{10,200}|native_[a-f0-9]{64})$/;
const AUDIO_KEY=/^(?:audio\/[A-Za-z0-9_-]{10,200}\/(?:[a-f0-9]{32}|[a-f0-9]{64})\.[a-z0-9]{1,8}|native\/audio\/[a-f0-9]{64}\.opus)$/;
const ART_KEY=/^native\/art\/[a-f0-9]{64}\.(jpg|png)$/;
const TEXT=['title','artist','album','albumArtist','genre','composer','codec'];
const NUM=['year','track','disc','dur','sr','ch','bits','rgTrack','rgAlbum','rgTrackPeak','rgAlbumPeak','r128TrackGain','r128AlbumGain','opusHeadGainDb'];
const fail=()=>{throw Error('The independent R2 library is incomplete or invalid.');};
const clean=(s,max=512)=>typeof s==='string'&&s.length<=max&&!/[\x00-\x1f\x7f]/.test(s);
export function metadata(input,{copyAnalysis=true}={}){
  if(!input||typeof input!=='object'||Array.isArray(input))fail();
  const out={};
  for(const k of TEXT){if(input[k]!=null){if(!clean(input[k]))fail();out[k]=input[k];}}
  for(const k of NUM){if(input[k]!=null){if(typeof input[k]!=='number'||!Number.isFinite(input[k]))fail();out[k]=input[k];}}
  if(!out.title?.trim()||!out.artist?.trim()||!Number.isFinite(out.dur)||out.dur<0||out.dur>86400)fail();
  for(const k of ['year','track','disc','sr','ch','bits'])if(out[k]!=null&&(out[k]<0||!Number.isInteger(out[k])))fail();
  for(const k of ['rgTrack','rgAlbum'])if(out[k]!=null&&Math.abs(out[k])>60)fail();
  for(const k of ['rgTrackPeak','rgAlbumPeak'])if(out[k]!=null&&(out[k]<=0||out[k]>1000))fail();
  for(const k of ['r128TrackGain','r128AlbumGain'])if(out[k]!=null&&(!Number.isInteger(out[k])||out[k]<-32768||out[k]>32767))fail();
  if(out.opusHeadGainDb!=null&&Math.abs(out.opusHeadGainDb)>128)fail();
  // Hash/size validation belongs to the enclosing object, not public tags.
  if(input.audioAnalysis!=null&&copyAnalysis)out.audioAnalysis=structuredClone(input.audioAnalysis);
  return out;
}
export function identityMatches(object,proof){
  return object&&object.size===proof?.size&&object.etag===proof?.etag&&object.uploaded instanceof Date&&
    Math.floor(object.uploaded.getTime()/1000)===Math.floor(Date.parse(proof?.lastModified)/1000);
}
function identity(p,size){
  if(p?.size!==size||typeof p.etag!=='string'||!/^\w+(?:-\d+)?$/.test(p.etag)||!Number.isFinite(Date.parse(p.lastModified)))fail();
}
export function validateLibrary(data,{onAlbumPruned}={}){
  if(data?.version!==1||data.kind!=='r2-library'||data.complete!==true||!Number.isFinite(Date.parse(data.generatedAt))||
    !Array.isArray(data.tracks)||data.count!==data.tracks.length||data.count>50000)fail();
  const ids=new Set(),albumTracks=[];
  for(const t of data.tracks){
    if(!SONG_ID.test(t?.id)||ids.has(t.id)||!HEX.test(t.sha256)||!AUDIO_KEY.test(t.audioKey)||
      !Number.isSafeInteger(t.size)||t.size<=0||!clean(t.path,1024)||!clean(t.folder,4096)||
      !/^(audio\/[a-z0-9.+-]+|video\/(mp4|webm)|application\/ogg)$/i.test(t.mimeType||''))fail();
    if(t.id.startsWith('r2_native_')&&(t.id!=='r2_native_'+t.sha256||t.audioKey!=='native/audio/'+t.sha256+'.opus'))fail();
    if(!t.id.startsWith('r2_native_')&&(!t.audioKey.startsWith('audio/'+t.id.slice(3)+'/')||!/^([a-f0-9]{32})$/.test(t.md5||'')))fail();
    identity(t.r2Identity,t.size);metadata(t.metadata,{copyAnalysis:false});if(t.metadata.audioAnalysis)validateAnalysis(t.metadata.audioAnalysis,t.sha256,t.size);ids.add(t.id);
    if(t.metadata.audioAnalysis?.album)albumTracks.push(t);
    if(t.coverKey!=null){if(!ART_KEY.test(t.coverKey)||!HEX.test(t.coverSha256)||!t.coverKey.includes(t.coverSha256)||
      !Number.isSafeInteger(t.coverSize)||t.coverSize<=0||!['image/jpeg','image/png'].includes(t.coverMimeType))fail();identity(t.coverIdentity,t.coverSize);}
    if(t.coverURL!=null){const u=new URL(t.coverURL);if(u.username||u.password||u.origin!=='https://missionarytube.z13.web.core.windows.net'||
      !/^\/assets\/drive-catalog-v2\/covers\/[a-f0-9]{64}\.jpg$/.test(u.pathname)||u.search||u.hash)fail();}
  }
  // A complete album must bind exactly this snapshot's album members.
  // A newly registered track immediately invalidates an old album claim.
  if(!albumTracks.length)return data;
  const groups=new Map();
  const groupKey=t=>JSON.stringify([t.metadata.albumArtist||t.metadata.artist,t.metadata.album]);
  for(const t of data.tracks){const key=groupKey(t);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(t);}
  for(const t of albumTracks){const a=t.metadata.audioAnalysis.album;
    const members=t.metadata.album?groups.get(groupKey(t)):[];
    if(!members.length||members.length!==a.members.length||!members.every(x=>a.members.some(m=>m.sha256===x.sha256&&m.size===x.size))){delete t.metadata.audioAnalysis.album;onAlbumPruned?.();}
  }
  return data;
}
export async function boundedBytes(body,max){
  const reader=body?.getReader();if(!reader)fail();const parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>max)throw Object.assign(Error('Body limit'),{status:413});parts.push(value);}}
  finally{await reader.cancel();}
  const bytes=new Uint8Array(size);let at=0;for(const p of parts){bytes.set(p,at);at+=p.byteLength;}return bytes;
}
export async function readStoredLibrary(bucket,{etagMatches}={}){
  const object=await bucket.get(LIBRARY_KEY,etagMatches?{onlyIf:{etagMatches}}:undefined);
  if(!object?.body||object.size>MAX_LIBRARY_BYTES){await object?.body?.cancel();fail();}
  const bytes=await boundedBytes(object.body,MAX_LIBRARY_BYTES);if(bytes.length!==object.size)fail();
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);let pruned=false;
  const data=validateLibrary(JSON.parse(text),{onAlbumPruned:()=>{pruned=true;}});
  return {data,etag:object.etag,text:pruned?JSON.stringify(data):text,size:object.size,uploaded:object.uploaded};
}
export function libraryMapping(data,url){
  validateLibrary(data);const endpoint=new URL(url);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.pathname!=='/music/library.json'||endpoint.search||endpoint.hash)fail();
  const base=endpoint.origin+'/music/library/',files=new Map(data.tracks.map(t=>[t.id,structuredClone(t)]));
  const matches=t=>t?.source==='r2'&&t.size===files.get(t.id)?.size&&t.sha256===files.get(t.id)?.sha256;
  const tracks=[...files.values()].map(t=>({...t.metadata,id:t.id,remoteId:t.id.slice(3),source:'r2',remote:false,
    path:t.path,folder:t.folder,size:t.size,sha256:t.sha256,md5:t.md5||'',mimeType:t.mimeType,
    ext:t.path.split('.').at(-1).toLowerCase(),missing:false,needsPerm:false,errored:false,
    coverURL:t.coverKey?base+'art/'+t.id:t.coverURL||null,added:Date.now(),rating:0,plays:0,lastPlayed:0}));
  return {tracks,mapping:Object.freeze({native:true,count:files.size,mode:'library',complete:true,
    matches:list=>Array.isArray(list)&&list.length===files.size&&new Set(list.map(t=>t.id)).size===files.size&&list.every(matches),
    mediaURL:t=>matches(t)?base+'audio/'+t.id:null})};
}
export async function readLibrary({url,signal,fetcher=fetch}){
  const endpoint=new URL(url);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.pathname!=='/music/library.json'||endpoint.search||endpoint.hash)fail();
  const r=await fetcher(endpoint.href,{signal,credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
  if(r.status!==200||r.redirected||!/^application\/json(?:;|$)/i.test(r.headers.get('content-type')||'')){await r.body?.cancel();fail();}
  return libraryMapping(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await boundedBytes(r.body,MAX_LIBRARY_BYTES))),url);
}

// Signed bytes include destination and content properties. Replays are bounded
// to five minutes and are idempotent: immutable blobs and identical registration.
export function signatureMessage({method,origin,path,type,hash,size,time,key}){
  return ['jarvis-r2-upload-v1',method,origin,path,type,hash,String(size),String(time),key].join('\n');
}
