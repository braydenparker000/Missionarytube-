import {validateAnalysis} from '../public/drawercast/audio-analysis.js';
import {FRONTEND_ORIGINS} from './origins.js';
import {byteRange} from './music.js';
import {publicLibrary} from './music-library-cache.js';
import {LIBRARY_KEY,MAX_LIBRARY_BYTES,HEX,SONG_ID,metadata,identityMatches,validateLibrary,boundedBytes,readStoredLibrary,signatureMessage} from '../public/drawercast/r2-library.js';
const AUDIO=/^\/music\/uploads\/audio\/([a-f0-9]{64})\.opus$/;
const ART=/^\/music\/uploads\/art\/([a-f0-9]{64})\.(jpg|png)$/;
const REGISTER='/music/uploads/register',ANALYSIS='/music/uploads/analysis';
const utf8=new TextEncoder();
const hash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
const raw=hex=>Uint8Array.from(hex.match(/../g),x=>parseInt(x,16));
const proof=o=>({etag:o.etag,size:o.size,lastModified:o.uploaded.toISOString()});
async function signed(request,env,url){
  const key=request.headers.get('X-Music-Public-Key'),sig=request.headers.get('X-Music-Signature');
  const time=request.headers.get('X-Music-Timestamp'),size=request.headers.get('X-Music-Size'),h=request.headers.get('X-Music-Sha256');
  let keys;try{keys=JSON.parse(env.MUSIC_UPLOAD_PUBLIC_KEYS||'[]');}catch{return null;}
  if(!Array.isArray(keys)||keys.length>8||!keys.every(k=>HEX.test(k))||!HEX.test(key||'')||!keys.includes(key)||
    !/^[a-f0-9]{128}$/.test(sig||'')||!/^\d{10}$/.test(time||'')||Math.abs(Date.now()/1000-Number(time))>300||
    !/^[1-9]\d{0,8}$/.test(size||'')||!HEX.test(h||''))return null;
  const type=request.headers.get('Content-Type')||'';
  const publicKey=await crypto.subtle.importKey('raw',raw(key),'Ed25519',false,['verify']);
  if(!await crypto.subtle.verify('Ed25519',publicKey,raw(sig),utf8.encode(signatureMessage({method:request.method,origin:url.origin,path:url.pathname,type,hash:h,size,time,key}))))return null;
  return {size:Number(size),hash:h,type};
}
function verifiedBlob(o,sha,size){return o?.size===size&&o.customMetadata?.['verified-sha256']===sha&&o.customMetadata?.verification==='worker-upload-sha256-v1';}
export async function nativeMusic(request,env){
  const url=new URL(request.url),p=url.pathname;
  if(p!=='/music/library.json'&&!p.startsWith('/music/library/')&&!p.startsWith('/music/uploads/'))return null;
  const origin=request.headers.get('Origin'),headers=new Headers({'Cache-Control':'private, no-store','Vary':'Origin','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
  const response=(body,status=200,extra={})=>{const h=new Headers(headers);for(const [k,v]of Object.entries(extra))h.set(k,v);return new Response(request.method==='HEAD'?null:body,{status,headers:h});};
  const json=(data,status=200)=>response(JSON.stringify(data),status,{'Content-Type':'application/json; charset=utf-8'});
  if(origin&&!FRONTEND_ORIGINS.has(origin))return json({error:'Origin not allowed'},403);
  if(origin)headers.set('Access-Control-Allow-Origin',origin);
  headers.set('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');headers.set('Access-Control-Allow-Headers','Range, If-Range, If-None-Match');
  headers.set('Access-Control-Expose-Headers','Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified');
  if(url.search)return json({error:'Query parameters are not supported'},400);
  const upload=p.startsWith('/music/uploads/');
  if(request.method==='OPTIONS')return upload||!['GET','HEAD',null].includes(request.headers.get('Access-Control-Request-Method'))?json({error:'Method not allowed'},405):response(null,204);
  if(!env.MUSIC_R2)return json({error:'Music storage is not configured'},503);
  try{
    if(upload){
      if(origin)return json({error:'Server-to-server uploads only'},403);
      const audio=AUDIO.exec(p),art=ART.exec(p);
      if(!(audio||art||(p===REGISTER||p===ANALYSIS)))return json({error:'Not found'},404);
      if(request.method!==([REGISTER,ANALYSIS].includes(p)?'POST':'PUT'))return json({error:'Method not allowed'},405);
      const auth=await signed(request,env,url);if(!auth)return json({error:'Authorized music signature required'},401);
      const max=audio?32*1024*1024:art?2*1024*1024:16384;
      if(auth.size>max)return json({error:'Upload exceeds its size limit'},413);
      if(audio&&auth.type!=='audio/ogg'||art&&auth.type!==(art[2]==='jpg'?'image/jpeg':'image/png')||[REGISTER,ANALYSIS].includes(p)&&auth.type!=='application/json')return json({error:'Unexpected content type'},415);
      // Bound streamed bytes after signature authentication; never trust Content-Length.
      const bytes=await boundedBytes(request.body,Math.min(max,auth.size));
      if(bytes.length!==auth.size||await hash(bytes)!==auth.hash)return json({error:'Uploaded bytes do not match signed proof'},422);
      if(audio||art){
        const sha=(audio||art)[1];if(sha!==auth.hash)return json({error:'Content address mismatch'},422);
        if(audio&&(new TextDecoder().decode(bytes.slice(0,4))!=='OggS'||!new TextDecoder().decode(bytes.slice(0,96)).includes('OpusHead')))return json({error:'A prepared Ogg Opus file is required'},415);
        if(art&&(art[2]==='jpg'?!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255):![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v)))return json({error:'Invalid artwork format'},415);
        const key=audio?'native/audio/'+sha+'.opus':'native/art/'+sha+'.'+art[2];
        const options={onlyIf:new Headers({'If-None-Match':'*'}),sha256:raw(sha).buffer,httpMetadata:{contentType:auth.type},customMetadata:{'verified-sha256':sha,verification:'worker-upload-sha256-v1'}};
        const o=await env.MUSIC_R2.put(key,bytes,options)||await env.MUSIC_R2.head(key);
        if(!verifiedBlob(o,sha,bytes.length))return json({error:'Existing object conflicts with verified upload'},409);
        return json({key,sha256:sha,size:o.size,r2Identity:proof(o)});
      }
      if(p===ANALYSIS){
        let body;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{return json({error:'Invalid analysis registration'},422);}
        if(!SONG_ID.test(body.id)||!HEX.test(body.sha256)||!Number.isSafeInteger(body.size)||!(body.previousAnalysisSha256===null||HEX.test(body.previousAnalysisSha256)||body.previousAnalysisSha256===undefined&&Object.hasOwn(body,'previousAnalysis')))return json({error:'Invalid analysis identity'},422);
        let analysis;try{analysis=validateAnalysis(body.audioAnalysis,body.sha256,body.size);}catch{return json({error:'Invalid audio analysis'},422);}
        for(let attempt=0;attempt<5;attempt++){
          const {data,etag}=await readStoredLibrary(env.MUSIC_R2),existing=data.tracks.find(t=>t.id===body.id);
          if(!existing||existing.sha256!==body.sha256||existing.size!==body.size||!identityMatches({size:body.r2Identity?.size,etag:body.r2Identity?.etag,uploaded:new Date(body.r2Identity?.lastModified)},existing.r2Identity))return json({error:'Analysis object identity conflict'},409);
          const object=await env.MUSIC_R2.head(existing.audioKey);
          if(!identityMatches(object,existing.r2Identity)||!(existing.audioKey.startsWith('native/')?verifiedBlob(object,existing.sha256,existing.size):object.customMetadata?.['source-sha256']===existing.sha256&&object.customMetadata?.['source-size']===String(existing.size)))return json({error:'Verified audio is unavailable'},409);
          const old=existing.metadata.audioAnalysis,revision=old?await hash(utf8.encode(JSON.stringify(old))):null;
          if(JSON.stringify(old)===JSON.stringify(analysis))return json({registered:true,analysisUpdated:false,id:existing.id,count:data.count});
          const expected=body.previousAnalysisSha256===undefined?(body.previousAnalysis?await hash(utf8.encode(JSON.stringify(body.previousAnalysis))):null):body.previousAnalysisSha256;
          if(revision!==expected)return json({error:'Analysis changed concurrently; review before retry'},409);
          existing.metadata.audioAnalysis=analysis;data.generatedAt=new Date().toISOString();validateLibrary(data);
          const text=JSON.stringify(data);if(utf8.encode(text).length>MAX_LIBRARY_BYTES)return json({error:'Music library limit reached'},413);
          if(await env.MUSIC_R2.put(LIBRARY_KEY,text,{onlyIf:{etagMatches:etag},httpMetadata:{contentType:'application/json'}}))return json({registered:true,analysisUpdated:true,id:existing.id,count:data.count});
        }
        return json({error:'Library changed concurrently; retry analysis with reviewed identity'},409);
      }
      let body,meta;try{body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));meta=metadata(body.metadata);}catch{return json({error:'Invalid track metadata'},422);}
      if(meta.audioAnalysis){try{meta.audioAnalysis=validateAnalysis(meta.audioAnalysis,body.sha256,body.size);}catch{return json({error:'Invalid audio analysis'},422);}}
      if(meta.dur<=0)return json({error:'A positive prepared duration is required'},422);
      if(!HEX.test(body.sha256)||!Number.isSafeInteger(body.size)||body.size<=0||typeof body.name!=='string'||body.name.length>512||/[\x00-\x1f\/\\]/.test(body.name)||!body.name.endsWith('.opus'))return json({error:'Invalid track registration'},422);
      const audioKey='native/audio/'+body.sha256+'.opus',o=await env.MUSIC_R2.head(audioKey);
      if(!verifiedBlob(o,body.sha256,body.size))return json({error:'Upload audio before registration'},409);
      const track={id:'r2_native_'+body.sha256,audioKey,sha256:body.sha256,size:body.size,mimeType:'audio/ogg',r2Identity:proof(o),
        metadata:meta,path:body.name,folder:'Cloudflare R2/'+meta.artist};
      if(body.cover){
        const c=body.cover;if(!HEX.test(c.sha256)||!['jpg','png'].includes(c.ext)||!Number.isSafeInteger(c.size)||c.size<=0)return json({error:'Invalid cover registration'},422);
        const key='native/art/'+c.sha256+'.'+c.ext,artObject=await env.MUSIC_R2.head(key);
        if(!verifiedBlob(artObject,c.sha256,c.size))return json({error:'Upload artwork before registration'},409);
        Object.assign(track,{coverKey:key,coverSha256:c.sha256,coverSize:c.size,coverMimeType:c.ext==='jpg'?'image/jpeg':'image/png',coverIdentity:proof(artObject)});
      }
      for(let attempt=0;attempt<5;attempt++){
        const {data,etag}=await readStoredLibrary(env.MUSIC_R2);
        const existing=data.tracks.find(t=>t.sha256===track.sha256&&t.size===track.size);
        if(existing)return json({registered:true,duplicate:true,id:existing.id,count:data.count});
        data.tracks.push(track);data.count=data.tracks.length;data.generatedAt=new Date().toISOString();validateLibrary(data);
        const text=JSON.stringify(data);if(utf8.encode(text).length>MAX_LIBRARY_BYTES)return json({error:'Music library limit reached'},413);
        const saved=await env.MUSIC_R2.put(LIBRARY_KEY,text,{onlyIf:{etagMatches:etag},httpMetadata:{contentType:'application/json'}});
        if(saved)return json({registered:true,duplicate:false,id:track.id,count:data.count});
      }
      return json({error:'Library changed concurrently; retry this registration'},409);
    }
    if(!['GET','HEAD'].includes(request.method))return json({error:'Method not allowed'},405);
    if(env.MUSIC_PUBLIC_READ!=='true')return json({error:'Public music delivery is not enabled'},403);
    const route=/^\/music\/library\/(audio|art)\/(r2_[A-Za-z0-9_-]+)$/.exec(p);
    if(p!=='/music/library.json'&&(!route||!SONG_ID.test(route[2])))return json({error:'Not found'},404);
    const library=await publicLibrary(env.MUSIC_R2);
    if(p==='/music/library.json')return response(library.text,200,{'Content-Type':'application/json; charset=utf-8'});
    const t=library.tracks.get(route[2]);if(!t)return json({error:'Not found'},404);
    const art=route[1]==='art',key=art?t.coverKey:t.audioKey;if(!key)return json({error:'Not found'},404);
    const size=art?t.coverSize:t.size,identity=art?t.coverIdentity:t.r2Identity,sha=art?t.coverSha256:t.sha256;
    const matches=o=>identityMatches(o,identity)&&(key.startsWith('native/')?verifiedBlob(o,sha,size):
      o.customMetadata?.['source-drive-id']===t.id.slice(3)&&o.customMetadata?.['source-sha256']===t.sha256&&o.customMetadata?.['source-md5']===t.md5&&o.customMetadata?.['source-size']===String(t.size));
    const head=await env.MUSIC_R2.head(key);if(!matches(head))return json({error:'Verified music object is unavailable'},503);
    headers.set('Accept-Ranges','bytes');headers.set('ETag',head.httpEtag);headers.set('Content-Type',art?t.coverMimeType:t.mimeType);headers.set('Last-Modified',head.uploaded.toUTCString());
    if(request.headers.get('If-None-Match')?.split(',').some(v=>v.trim()==='*'||v.trim().replace(/^W\//,'')===head.httpEtag))return response(null,304);
    let range=null;const ifRange=request.headers.get('If-Range');
    if(request.method==='GET'&&(!ifRange||ifRange===head.httpEtag)){try{range=byteRange(request.headers.get('Range'),size);}catch{headers.set('Content-Range','bytes */'+size);return json({error:'Range not satisfiable'},416);}}
    headers.set('Content-Length',String(range?.length??size));if(request.method==='HEAD')return response(null,200);
    const object=await env.MUSIC_R2.get(key,{onlyIf:{etagMatches:head.etag},...(range?{range}:{})});
    if(!object?.body||!matches(object)){await object?.body?.cancel();headers.delete('Content-Length');return json({error:'Object changed; retry'},503);}
    if(range)headers.set('Content-Range',`bytes ${range.offset}-${range.offset+range.length-1}/${size}`);
    return response(object.body,range?206:200);
  }catch(error){headers.delete('Content-Length');return json({error:error.status===413?'Upload exceeds its size limit':'Music upload or library temporarily unavailable'},error.status===413?413:503);}
}
