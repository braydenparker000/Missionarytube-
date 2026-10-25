// The music catalog's single writer: a Durable Object (MUSIC_CATALOG_OBJECT)
// that holds one row per track and publishes the R2 catalog file from them.
//
// - One writer: every change (register, analysis, patch, replace, delete)
//   runs here, one at a time, so changes never collide, and a change is a
//   row update instead of a 13 MB read-modify-write of the whole file.
// - Published, not edited: after each change the catalog file
//   (catalog/r2-library-v1.json) is regenerated from the rows, validated, and
//   written with a conditional put; a failed write is retried by an alarm.
//   The file carries no waveforms: they live here, one row each, and are
//   served per track. Readers (phones, the Worker's read path) are unchanged.
// - Edits from outside: if the file was replaced by someone else while
//   nothing here was waiting to be published, the rows adopt that file
//   (a direct edit keeps working). If something was waiting, that is a
//   conflict: changes are refused until `reimport` or `publish {force}`.
// - Stable ids: replacing a track's audio keeps its id (and so its plays
//   and ratings in the player).

import {LIBRARY_KEY,MAX_LIBRARY_BYTES,HEX,SONG_ID,metadata,validateLibrary,readStoredLibrary,boundedBytes} from '../frontend/drawercast/r2-library.js';
import {validateAnalysis} from '../frontend/drawercast/audio-analysis.js';
import {waveBytes} from './music-library-cache.js';

export const MUSIC_CATALOG_OBJECT='music-catalog-v1';
export const WAVE_BATCH_MAX=200;
export const BATCH_MAX=100;
const LOG_KEEP=20000,AUDIT_SAMPLES=100;
const RETRY_MS=2000;
const utf8=new TextEncoder();

export class MusicError extends Error{constructor(status,message,extra={}){super(message);this.status=status;this.extra=extra;}}
const fail=(status,message,extra)=>{throw new MusicError(status,message,extra);};

export const proof=o=>({etag:o.etag,size:o.size,lastModified:o.uploaded.toISOString()});
export function verifiedBlob(o,sha,size){return o?.size===size&&o.customMetadata?.['verified-sha256']===sha&&o.customMetadata?.verification==='worker-upload-sha256-v1';}

const rows=(ctx,q,...v)=>[...ctx.storage.sql.exec(q,...v)];
const one=(ctx,q,...v)=>rows(ctx,q,...v)[0]||null;
const getState=(ctx,key,fallback=null)=>{const r=one(ctx,'SELECT value FROM music_state WHERE key=?',key);return r?JSON.parse(r.value):fallback;};
const setState=(ctx,key,value)=>ctx.storage.sql.exec('INSERT OR REPLACE INTO music_state(key,value) VALUES(?,?)',key,JSON.stringify(value));

export function musicCatalogSchema(ctx){
  ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS music_tracks (ord INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
    sha256 TEXT NOT NULL, size INTEGER NOT NULL, audio_key TEXT NOT NULL, cover_key TEXT, record TEXT NOT NULL, waveform TEXT, updated_ms INTEGER NOT NULL)`);
  ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS music_tracks_content ON music_tracks(sha256,size)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS music_state (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS music_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, at_ms INTEGER NOT NULL, op TEXT NOT NULL, track_id TEXT, before TEXT)');
}
/** Whether this Durable Object instance is the music catalog (for the shared alarm). */
export function isMusicCatalog(ctx){
  return rows(ctx,"SELECT name FROM sqlite_master WHERE type='table' AND name='music_state'").length>0;
}

const count=ctx=>one(ctx,'SELECT COUNT(*) AS n FROM music_tracks').n;
const trackRow=(ctx,id)=>one(ctx,'SELECT * FROM music_tracks WHERE id=?',id);
const recordOf=r=>JSON.parse(r.record);
function log(ctx,now,op,id,before){
  ctx.storage.sql.exec('INSERT INTO music_log(at_ms,op,track_id,before) VALUES(?,?,?,?)',now,op,id,before?JSON.stringify(before):null);
  ctx.storage.sql.exec('DELETE FROM music_log WHERE seq<=(SELECT MAX(seq) FROM music_log)-?',LOG_KEEP);
}
function changed(ctx,now){
  const s=getState(ctx,'publish',{});
  setState(ctx,'publish',{...s,generation:(s.generation||0)+1,changedAt:now,dirty:true});
}
function put(ctx,record,waveform,now){
  const stored={...record,metadata:{...record.metadata}};delete stored.metadata.waveform;delete stored.waveformBars;
  ctx.storage.sql.exec(`INSERT INTO music_tracks(id,sha256,size,audio_key,cover_key,record,waveform,updated_ms) VALUES(?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET sha256=excluded.sha256,size=excluded.size,audio_key=excluded.audio_key,cover_key=excluded.cover_key,record=excluded.record,waveform=excluded.waveform,updated_ms=excluded.updated_ms`,
    stored.id,stored.sha256,stored.size,stored.audioKey,stored.coverKey||null,JSON.stringify(stored),waveform??null,now);
}
/** A single track checked on its own (album claims are checked when publishing). */
function checkTrack(t){
  try{validateLibrary({version:1,kind:'r2-library',complete:true,count:1,generatedAt:new Date(0).toISOString(),tracks:[structuredClone(t)]});}
  catch{fail(422,'The track would make the catalog invalid');}
}
function checkSize(ctx,extra){
  const p=getState(ctx,'publish',{});
  if((p.bytes||0)+extra>MAX_LIBRARY_BYTES)fail(413,'Music library limit reached');
}
const waveOrFail=w=>{if(w==null)return null;if(!waveBytes(w))fail(422,'A waveform is base64 of 16 to 1000 bytes, one per bar');return w;};
// What a waveform's bytes measure: "rms" (loudness bins, scripts/audio/waveform.py) or "peak" (the
// older peak bars). The record carries it as waveformKind; the player draws each its own way.
const WAVE_KINDS=['peak','rms'];
const kindOrFail=k=>{if(k===undefined)return 'peak';if(!WAVE_KINDS.includes(k))fail(422,'waveformKind is "rms" or "peak"');return k;};
function withKind(record,waveform,kind){
  const next={...record};
  if(waveform&&kind==='rms')next.waveformKind='rms';else delete next.waveformKind;
  return next;
}

// ——— The catalog, as published ———
function catalogData(ctx,{waveforms=false}={}){
  const tracks=rows(ctx,'SELECT record,waveform FROM music_tracks ORDER BY ord').map(r=>{
    const t=JSON.parse(r.record);
    if(r.waveform){if(waveforms)t.metadata.waveform=r.waveform;else t.waveformBars=true;}
    return t;
  });
  const p=getState(ctx,'publish',{});
  return validateLibrary({version:1,kind:'r2-library',complete:true,count:tracks.length,generatedAt:new Date(p.changedAt||Date.now()).toISOString(),tracks});
}

const queues=new WeakMap();
/**
 * Writes the catalog file from the rows. Publishes run one at a time; one
 * waiting publish covers every change made before it starts.
 */
export function publish(ctx,env,options={}){
  const q=queues.get(ctx)||{running:null,waiting:null};queues.set(ctx,q);
  if(q.waiting&&!options.force)return q.waiting;
  const run=async()=>{q.waiting=null;try{return await publishNow(ctx,env,options);}finally{q.running=null;}};
  const next=(q.running||Promise.resolve()).then(()=>(q.running=run()));
  q.waiting=next;
  return next;
}
async function publishNow(ctx,env,{force=false}={}){
  const bucket=env.MUSIC_R2,p=getState(ctx,'publish',{}),generation=p.generation||0;
  if(!p.dirty&&!force)return {published:true,generation,etag:p.etag||null,unchanged:true};
  let text;
  try{text=JSON.stringify(catalogData(ctx));}
  catch{setState(ctx,'publish',{...getState(ctx,'publish',{}),problem:'The rows do not make a valid catalog'});return {published:false,generation,problem:'invalid'};}
  for(let attempt=0;attempt<3;attempt++){
    const head=await bucket.head(LIBRARY_KEY);
    const s=getState(ctx,'publish',{});
    if(head&&s.etag&&head.etag!==s.etag&&!force){
      setState(ctx,'publish',{...s,conflict:{etag:head.etag,at:new Date().toISOString()}});
      return {published:false,generation,conflict:true};
    }
    let saved=null;
    try{saved=await bucket.put(LIBRARY_KEY,text,{onlyIf:head?{etagMatches:head.etag}:new Headers({'If-None-Match':'*'}),httpMetadata:{contentType:'application/json'}});}catch{}
    if(saved){
      const now=getState(ctx,'publish',{});
      setState(ctx,'publish',{...now,etag:saved.etag,bytes:utf8.encode(text).length,publishedAt:new Date().toISOString(),publishedGeneration:generation,
        dirty:(now.generation||0)>generation,conflict:null,problem:null});
      // A change made while this was writing has queued its own publish.
      return {published:true,generation,etag:saved.etag};
    }
  }
  // R2 refused (busy key, network): the alarm tries again.
  try{await ctx.storage.setAlarm?.(Date.now()+RETRY_MS);}catch{}
  return {published:false,generation,retrying:true};
}
export async function musicCatalogAlarm(ctx,env){
  musicCatalogSchema(ctx);
  if(getState(ctx,'publish',{}).dirty)await publish(ctx,env);
}

// ——— Taking in the file (first use, an outside edit, or reimport) ———
async function adopt(ctx,env,now,{keepWaveforms=true}={}){
  const head=await env.MUSIC_R2.head(LIBRARY_KEY);
  let data={tracks:[]},etag=null,bytes=0;
  if(head){const stored=await readStoredLibrary(env.MUSIC_R2);data=stored.data;etag=stored.etag;bytes=stored.size;}
  ctx.storage.transactionSync(()=>{
    const waves=keepWaveforms?new Map(rows(ctx,'SELECT id,waveform FROM music_tracks WHERE waveform IS NOT NULL').map(r=>[r.id,r.waveform])):new Map();
    ctx.storage.sql.exec('DELETE FROM music_tracks');
    for(const t of data.tracks){const w=waveBytes(t.metadata?.waveform)?t.metadata.waveform:waves.get(t.id)??null;put(ctx,t,w,now);}
    const s=getState(ctx,'publish',{});
    setState(ctx,'publish',{...s,etag,bytes,dirty:false,conflict:null,problem:null,changedAt:Date.parse(data.generatedAt)||now,adoptedAt:new Date(now).toISOString()});
    setState(ctx,'imported',{etag,count:data.tracks.length,at:new Date(now).toISOString()});
    log(ctx,now,'adopt',null,null);
  });
}
/**
 * Before a change: take in the file on first use or after an outside edit.
 * The operations that resolve or inspect a conflict (reimport, publish,
 * export, audit) only need the first import.
 */
const RESOLVING=new Set(['reimport','publish','export','audit']);
async function ready(ctx,env,now,op){
  musicCatalogSchema(ctx);
  const p=getState(ctx,'publish',{});
  if(!getState(ctx,'imported'))return adopt(ctx,env,now);
  if(RESOLVING.has(op))return;
  const head=await env.MUSIC_R2.head(LIBRARY_KEY);
  if(!head||head.etag===p.etag)return;
  if(p.dirty||p.conflict)fail(409,'The catalog file was replaced outside the Worker while changes here were unpublished. Call reimport (take the file) or publish with force (keep these changes).',{conflict:true});
  await adopt(ctx,env,now);
}

// ——— Operations ———
async function verifiedCover(env,c){
  if(!c||!HEX.test(c.sha256)||!['jpg','png'].includes(c.ext)||!Number.isSafeInteger(c.size)||c.size<=0)fail(422,'Invalid cover registration');
  const key='native/art/'+c.sha256+'.'+c.ext,o=await env.MUSIC_R2.head(key);
  if(!verifiedBlob(o,c.sha256,c.size))fail(409,'Upload artwork before registration');
  return {coverKey:key,coverSha256:c.sha256,coverSize:c.size,coverMimeType:c.ext==='jpg'?'image/jpeg':'image/png',coverIdentity:proof(o)};
}
async function verifiedAudio(env,sha256,size){
  if(!HEX.test(sha256)||!Number.isSafeInteger(size)||size<=0)fail(422,'Invalid track registration');
  const audioKey='native/audio/'+sha256+'.opus',o=await env.MUSIC_R2.head(audioKey);
  if(!verifiedBlob(o,sha256,size))fail(409,'Upload audio before registration');
  return {audioKey,sha256,size,mimeType:'audio/ogg',r2Identity:proof(o)};
}

/** A registration body to a new track record (and its waveform), checked against R2. */
async function prepare(env,body){
  let meta;try{meta=metadata(body?.metadata);}catch{fail(422,'Invalid track metadata');}
  if(meta.audioAnalysis){try{meta.audioAnalysis=validateAnalysis(meta.audioAnalysis,body.sha256,body.size);}catch{fail(422,'Invalid audio analysis');}}
  if(meta.dur<=0)fail(422,'A positive prepared duration is required');
  if(typeof body.name!=='string'||body.name.length>512||/[\x00-\x1f\/\\]/.test(body.name)||!body.name.endsWith('.opus'))fail(422,'Invalid track registration');
  const audio=await verifiedAudio(env,body.sha256,body.size);
  const track={id:'r2_native_'+body.sha256,...audio,metadata:meta,path:body.name,folder:'Cloudflare R2/'+meta.artist};
  if(body.cover)Object.assign(track,await verifiedCover(env,body.cover));
  const waveform=waveOrFail(body.waveform);
  return {track:withKind(track,waveform,kindOrFail(body.waveformKind)),waveform};
}
function insert(ctx,{track,waveform},now){
  const existing=one(ctx,'SELECT id FROM music_tracks WHERE sha256=? AND size=?',track.sha256,track.size);
  if(existing){
    // The same audio again: a waveform it brings fills a missing one.
    const row=trackRow(ctx,existing.id);
    if(waveform&&!row.waveform){put(ctx,withKind(recordOf(row),waveform,track.waveformKind??'peak'),waveform,now);changed(ctx,now);}
    return {registered:true,duplicate:true,id:existing.id};
  }
  if(trackRow(ctx,track.id))fail(409,'A track with this id holds other audio');
  checkTrack(track);checkSize(ctx,utf8.encode(JSON.stringify(track)).length+32);
  put(ctx,track,waveform,now);log(ctx,now,'register',track.id,null);changed(ctx,now);
  return {registered:true,duplicate:false,id:track.id};
}

const ops={
  async register(ctx,env,body,now){
    const prepared=await prepare(env,body);
    const result=ctx.storage.transactionSync(()=>insert(ctx,prepared,now));
    return {...result,count:count(ctx)};
  },
  async 'register-batch'(ctx,env,body,now){
    if(!Array.isArray(body?.tracks)||!body.tracks.length||body.tracks.length>BATCH_MAX)fail(422,`A batch is 1 to ${BATCH_MAX} registrations`);
    const results=[];
    for(const item of body.tracks){
      try{const prepared=await prepare(env,item);results.push(ctx.storage.transactionSync(()=>insert(ctx,prepared,now)));}
      catch(error){if(!(error instanceof MusicError))throw error;results.push({registered:false,sha256:item?.sha256??null,status:error.status,error:error.message});}
    }
    return {results,registered:results.filter(r=>r.registered&&!r.duplicate).length,count:count(ctx)};
  },
  async analysis(ctx,env,body,now){
    if(!SONG_ID.test(body.id)||!HEX.test(body.sha256)||!Number.isSafeInteger(body.size)||!(body.previousAnalysisSha256===null||HEX.test(body.previousAnalysisSha256)||body.previousAnalysisSha256===undefined&&Object.hasOwn(body,'previousAnalysis')))fail(422,'Invalid analysis identity');
    let analysis;try{analysis=validateAnalysis(body.audioAnalysis,body.sha256,body.size);}catch{fail(422,'Invalid audio analysis');}
    const row=trackRow(ctx,body.id),existing=row&&recordOf(row);
    const proofMatches=existing&&existing.sha256===body.sha256&&existing.size===body.size&&body.r2Identity?.size===existing.r2Identity.size&&body.r2Identity?.etag===existing.r2Identity.etag&&
      Math.floor(Date.parse(body.r2Identity?.lastModified)/1000)===Math.floor(Date.parse(existing.r2Identity.lastModified)/1000);
    if(!proofMatches)fail(409,'Analysis object identity conflict');
    const object=await env.MUSIC_R2.head(existing.audioKey);
    const identityOk=object&&object.size===existing.r2Identity.size&&object.etag===existing.r2Identity.etag&&Math.floor(object.uploaded.getTime()/1000)===Math.floor(Date.parse(existing.r2Identity.lastModified)/1000);
    if(!identityOk||!(existing.audioKey.startsWith('native/')?verifiedBlob(object,existing.sha256,existing.size):object.customMetadata?.['source-sha256']===existing.sha256&&object.customMetadata?.['source-size']===String(existing.size)))fail(409,'Verified audio is unavailable');
    const hash=async v=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',utf8.encode(JSON.stringify(v))))].map(x=>x.toString(16).padStart(2,'0')).join('');
    const old=existing.metadata.audioAnalysis,revision=old?await hash(old):null;
    if(JSON.stringify(old)===JSON.stringify(analysis))return {registered:true,analysisUpdated:false,id:existing.id,count:count(ctx)};
    const expected=body.previousAnalysisSha256===undefined?(body.previousAnalysis?await hash(body.previousAnalysis):null):body.previousAnalysisSha256;
    if(revision!==expected)fail(409,'Analysis changed concurrently; review before retry');
    return ctx.storage.transactionSync(()=>{
      const current=trackRow(ctx,body.id);if(!current||current.record!==row.record)fail(409,'Analysis changed concurrently; review before retry');
      const next=recordOf(current);next.metadata.audioAnalysis=analysis;checkTrack(next);
      put(ctx,next,current.waveform,now);log(ctx,now,'analysis',next.id,recordOf(current));changed(ctx,now);
      return {registered:true,analysisUpdated:true,id:next.id,count:count(ctx)};
    });
  },
  /** Change a track's tags, path or folder, waveform or cover, in place. */
  async patch(ctx,env,body,now){
    const row=SONG_ID.test(body?.id)&&trackRow(ctx,body.id);if(!row)fail(404,'No such track');
    const cover=body.cover===undefined?undefined:body.cover===null?null:await verifiedCover(env,body.cover);
    const waveform=body.waveform===undefined?undefined:waveOrFail(body.waveform),kind=kindOrFail(body.waveformKind);
    return ctx.storage.transactionSync(()=>{
      const current=trackRow(ctx,body.id),before=recordOf(current);
      let next=structuredClone(before);
      if(waveform!==undefined)next=withKind(next,waveform,kind);
      if(body.metadata!==undefined){
        if(!body.metadata||typeof body.metadata!=='object'||Array.isArray(body.metadata))fail(422,'metadata is an object of changes');
        const merged={...next.metadata};
        for(const [k,v] of Object.entries(body.metadata)){if(k==='audioAnalysis'||k==='waveform')fail(422,`Change ${k} with its own operation`);if(v===null)delete merged[k];else merged[k]=v;}
        try{next.metadata=metadata(merged);}catch{fail(422,'Invalid track metadata');}
      }
      for(const k of ['path','folder'])if(body[k]!==undefined){if(typeof body[k]!=='string'||!body[k]||body[k].length>(k==='path'?1024:4096)||/[\x00-\x1f\x7f]/.test(body[k]))fail(422,`Invalid ${k}`);next[k]=body[k];}
      if(cover!==undefined){for(const k of ['coverKey','coverSha256','coverSize','coverMimeType','coverIdentity','coverURL'])delete next[k];if(cover)Object.assign(next,cover);}
      checkTrack(next);
      put(ctx,next,waveform===undefined?current.waveform:waveform,now);log(ctx,now,'patch',next.id,before);changed(ctx,now);
      return {patched:true,id:next.id,count:count(ctx)};
    });
  },
  /** New audio for a track, keeping its id (plays and ratings stay with it). */
  async 'replace-audio'(ctx,env,body,now){
    const row=SONG_ID.test(body?.id)&&trackRow(ctx,body.id);if(!row)fail(404,'No such track');
    const audio=await verifiedAudio(env,body.sha256,body.size);
    if(body.name!==undefined&&(typeof body.name!=='string'||body.name.length>512||/[\x00-\x1f\/\\]/.test(body.name)||!body.name.endsWith('.opus')))fail(422,'Invalid file name');
    const waveform=body.waveform===undefined?null:waveOrFail(body.waveform),kind=kindOrFail(body.waveformKind);
    const result=ctx.storage.transactionSync(()=>{
      const current=trackRow(ctx,body.id),before=recordOf(current);
      const other=one(ctx,'SELECT id FROM music_tracks WHERE sha256=? AND size=? AND id<>?',audio.sha256,audio.size,body.id);
      if(other)fail(409,'That audio is already another track',{id:other.id});
      const next=withKind({...structuredClone(before),...audio},waveform,kind);delete next.md5;
      // The old waveform and analysis describe the old audio.
      delete next.metadata.audioAnalysis;
      if(body.name)next.path=next.path.includes('/')?next.path.replace(/[^/]*$/,body.name):body.name;
      checkTrack(next);
      put(ctx,next,waveform,now);log(ctx,now,'replace-audio',next.id,before);changed(ctx,now);
      return {replaced:true,id:next.id,oldAudioKey:before.audioKey};
    });
    const removed=body.deleteOld===false?[]:await deleteUnreferenced(ctx,env,[result.oldAudioKey]);
    return {replaced:true,id:result.id,deletedObjects:removed,count:count(ctx)};
  },
  /** Waveforms for many tracks at once (a backfill): items [{id, waveform, kind}], 1 to WAVE_BATCH_MAX. */
  async waveforms(ctx,env,body,now){
    if(!Array.isArray(body?.items)||!body.items.length||body.items.length>WAVE_BATCH_MAX)fail(422,`items is 1 to ${WAVE_BATCH_MAX} waveforms`);
    const items=body.items.map((item,i)=>{
      if(!item||!SONG_ID.test(item.id)||item.kind===undefined)fail(422,`items[${i}] needs id, waveform and kind`);
      return {id:item.id,waveform:waveOrFail(item.waveform),kind:kindOrFail(item.kind)};
    });
    return ctx.storage.transactionSync(()=>{
      const notFound=[];let updated=0;
      for(const {id,waveform,kind} of items){
        const row=trackRow(ctx,id);if(!row){notFound.push(id);continue;}
        const before=recordOf(row);
        put(ctx,withKind(before,waveform,kind),waveform,now);log(ctx,now,'waveform',id,{waveform:row.waveform,waveformKind:before.waveformKind??null});updated++;
      }
      if(updated)changed(ctx,now);
      return {updated,notFound,count:count(ctx)};
    });
  },
  /** Remove tracks; with deleteObjects (the default), their audio and art too, when nothing else uses them. */
  async delete(ctx,env,body,now){
    if(!Array.isArray(body?.ids)||!body.ids.length||body.ids.length>BATCH_MAX||!body.ids.every(id=>SONG_ID.test(id)))fail(422,`ids is 1 to ${BATCH_MAX} track ids`);
    const {keys,deleted}=ctx.storage.transactionSync(()=>{
      const keys=[],deleted=[];
      for(const id of new Set(body.ids)){
        const row=trackRow(ctx,id);if(!row)continue;
        keys.push(row.audio_key);if(row.cover_key)keys.push(row.cover_key);deleted.push(id);
        ctx.storage.sql.exec('DELETE FROM music_tracks WHERE id=?',id);log(ctx,now,'delete',id,{...recordOf(row),waveform:row.waveform});
      }
      if(deleted.length)changed(ctx,now);
      return {keys,deleted};
    });
    const removed=body.deleteObjects===false?[]:await deleteUnreferenced(ctx,env,keys);
    return {deleted,notFound:body.ids.filter(id=>!deleted.includes(id)),deletedObjects:removed,count:count(ctx)};
  },
  /** The whole catalog with waveforms inline, for backups and tools. */
  async export(ctx){return {catalog:catalogData(ctx,{waveforms:true})};},
  async publish(ctx,env,body){return {...await publish(ctx,env,{force:body?.force===true}),count:count(ctx)};},
  /** Take the file in R2 as the truth (after an outside edit); waveforms here are kept for tracks the file has none for. */
  async reimport(ctx,env,body,now){
    if(body?.confirm!==true)fail(422,'reimport replaces every row with the catalog file; send {"confirm":true}');
    await adopt(ctx,env,now);return {reimported:true,count:count(ctx)};
  },
  /** Compare the bucket with the catalog: entries whose objects are missing, objects no entry uses. */
  async audit(ctx,env,body,now){
    const referenced=new Map();
    for(const r of rows(ctx,'SELECT id,audio_key,cover_key,size FROM music_tracks')){referenced.set(r.audio_key,{id:r.id,size:r.size});if(r.cover_key)referenced.set(r.cover_key,{id:r.id});}
    const seen=new Map();
    for(const prefix of ['native/audio/','native/art/','audio/']){
      let cursor;do{const page=await env.MUSIC_R2.list({prefix,cursor,limit:1000});for(const o of page.objects)seen.set(o.key,o.size);cursor=page.truncated?page.cursor:undefined;}while(cursor);
    }
    const missing=[],wrongSize=[],orphans=[];
    for(const [key,ref] of referenced){if(!seen.has(key))missing.push({id:ref.id,key});else if(ref.size&&seen.get(key)!==ref.size)wrongSize.push({id:ref.id,key});}
    for(const key of seen.keys())if(!referenced.has(key))orphans.push(key);
    const summary={at:new Date(now).toISOString(),tracks:count(ctx),objects:seen.size,missing:missing.length,wrongSize:wrongSize.length,orphans:orphans.length,
      withoutWaveform:one(ctx,'SELECT COUNT(*) AS n FROM music_tracks WHERE waveform IS NULL').n};
    setState(ctx,'audit',summary);
    return {...summary,samples:{missing:missing.slice(0,AUDIT_SAMPLES),wrongSize:wrongSize.slice(0,AUDIT_SAMPLES),orphans:orphans.slice(0,AUDIT_SAMPLES)}};
  },
};
const READS={
  waveform(ctx,args){const r=SONG_ID.test(args?.id)&&one(ctx,'SELECT waveform FROM music_tracks WHERE id=?',args.id);return {waveform:r?.waveform||null};},
  status(ctx){
    const p=getState(ctx,'publish',{});
    return {ready:!!getState(ctx,'imported'),count:count(ctx),generation:p.generation||0,publishedGeneration:p.publishedGeneration??null,
      pendingPublish:!!p.dirty,conflict:p.conflict||null,problem:p.problem||null,publishedAt:p.publishedAt||null,
      withoutWaveform:one(ctx,'SELECT COUNT(*) AS n FROM music_tracks WHERE waveform IS NULL').n,lastAudit:getState(ctx,'audit')};
  },
};
export const WRITE_OPS=new Set(Object.keys(ops));

async function deleteUnreferenced(ctx,env,keys){
  const out=[];
  for(const key of new Set(keys)){
    if(one(ctx,'SELECT 1 AS x FROM music_tracks WHERE audio_key=? OR cover_key=?',key,key))continue;
    try{await env.MUSIC_R2.delete(key);out.push(key);}catch{}
  }
  return out;
}

/** The Durable Object's entry: {op, args} → JSON. */
export async function musicCatalogInternal(ctx,env,input,now=Date.now()){
  try{
    if(!env.MUSIC_R2)fail(503,'Music storage is not configured');
    musicCatalogSchema(ctx);
    const {op,args}=input||{};
    if(READS[op])return Response.json(READS[op](ctx,args));
    if(!ops[op])fail(400,'Unknown music operation');
    await ready(ctx,env,now,op);
    const result=await ops[op](ctx,env,args||{},now);
    if(['export','publish','audit'].includes(op))return Response.json(result);
    const published=await publish(ctx,env);
    return Response.json({...result,published:published.published,...(published.conflict?{conflict:true}:{})});
  }catch(error){
    if(error instanceof MusicError)return Response.json({error:error.message,...error.extra},{status:error.status});
    return Response.json({error:'Music catalog temporarily unavailable'},{status:503});
  }
}

/** From the Worker: one call to the catalog object. */
export async function musicCatalog(env,op,args={}){
  const stub=env.HUBS.get(env.HUBS.idFromName(MUSIC_CATALOG_OBJECT));
  const response=await stub.fetch(new Request('https://internal/internal/music',{method:'POST',body:JSON.stringify({op,args})}));
  return {status:response.status,body:await response.json()};
}
export {boundedBytes};
