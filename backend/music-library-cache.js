import {LIBRARY_KEY,MAX_LIBRARY_BYTES,readStoredLibrary} from '../frontend/drawercast/r2-library.js';

// One validated snapshot per current R2 binding. Never retain a request, body,
// or pending I/O promise across Worker requests. Each read still checks R2 HEAD:
// new uploads, replacements and deletions are seen at once.
//
// What phones download is the public index: the stored catalog without its
// per-track waveforms (three quarters of its compressed size), which are
// served one track at a time from /music/library/waveform/<id>.
//
// Last known good: a stored catalog that is invalid (a bad direct edit, an
// oversized file) does not take music down. The last valid catalog keeps
// being served, from memory or from its copy in R2 (LAST_GOOD_KEY), and the
// problem is reported at /music/health until a valid catalog replaces it.
export const LAST_GOOD_KEY='catalog/r2-library-last-good-v1.json';
export const PUBLIC_FORMAT='p1';
const WAVE_MIN=16,WAVE_MAX=1000;
const states=new WeakMap();

const headValid=h=>h&&Number.isSafeInteger(h.size)&&h.size>0&&h.size<=MAX_LIBRARY_BYTES&&typeof h.etag==='string'&&h.etag&&
  h.uploaded instanceof Date&&Number.isFinite(h.uploaded.getTime());

/** Base64 bars (one byte per bar) to bytes, or null when not a waveform. */
export function waveBytes(value){
  if(typeof value!=='string'||value.length<20||value.length>1400)return null;
  let text;try{text=atob(value);}catch{return null;}
  if(text.length<WAVE_MIN||text.length>WAVE_MAX)return null;
  return Uint8Array.from(text,c=>c.charCodeAt(0));
}

function snapshot(stored,sourceEtag){
  const waves=new Map(),tracks=new Map();
  const index={...stored.data,tracks:stored.data.tracks.map(t=>{
    tracks.set(t.id,t);
    const {waveform,...metadata}=t.metadata,bytes=waveBytes(waveform);
    if(!bytes)return t;
    waves.set(t.id,bytes);
    return {...t,metadata,waveformBars:true};
  })};
  const text=JSON.stringify(index);
  return {etag:sourceEtag,size:stored.size,modified:stored.uploaded?.getTime()??0,storedText:stored.text,
    text,publicEtag:`"${sourceEtag}-${PUBLIC_FORMAT}"`,tracks,waves,count:index.count,generatedAt:index.generatedAt};
}

async function saveLastGood(bucket,snap){
  try{
    const prior=await bucket.head(LAST_GOOD_KEY);
    if(prior?.customMetadata?.['source-etag']===snap.etag)return;
    await bucket.put(LAST_GOOD_KEY,snap.storedText,{httpMetadata:{contentType:'application/json'},customMetadata:{'source-etag':snap.etag}});
  }catch{}
}
async function loadLastGood(bucket){
  try{
    const stored=await readStoredLibrary(bucket,{key:LAST_GOOD_KEY});
    const object=await bucket.head(LAST_GOOD_KEY);
    return snapshot(stored,object?.customMetadata?.['source-etag']||stored.etag);
  }catch{return null;}
}

/**
 * The catalog to serve: {etag, text (public index), publicEtag, tracks, waves,
 * count, generatedAt, stale, problem}. Throws only when nothing valid exists,
 * or when the catalog was replaced mid-read (retry).
 */
export async function publicLibrary(bucket){
  const head=await bucket.head(LIBRARY_KEY);
  const state=states.get(bucket)||{};states.set(bucket,state);
  const current=state.current;
  if(headValid(head)&&current&&current.etag===head.etag&&current.size===head.size&&current.modified===head.uploaded.getTime())return current;
  state.current=null;
  let problem;
  // A catalog already found invalid is not read again until it is replaced.
  if(headValid(head)&&state.bad?.etag===head.etag&&state.lastGood)return {...state.lastGood,stale:true,problem:state.problem};
  if(!headValid(head))problem=!head?'The stored catalog is missing':head.size>MAX_LIBRARY_BYTES?'The stored catalog is over the size limit':'The stored catalog is unreadable';
  else{
    try{
      // Bind the loaded bytes to the version checked above.
      const stored=await readStoredLibrary(bucket,{etagMatches:head.etag});
      if(stored.etag!==head.etag||stored.size!==head.size||stored.uploaded?.getTime()!==head.uploaded.getTime())throw Error('Music library changed');
      const snap=snapshot(stored,head.etag);
      state.current=state.lastGood=snap;state.problem=state.bad=null;
      await saveLastGood(bucket,snap);
      return snap;
    }catch(error){
      // A replacement between HEAD and GET is not a broken catalog: retry.
      const now=await bucket.head(LIBRARY_KEY);
      if(now?.etag!==head.etag)throw Error('Music library changed');
      problem=error.message==='Music library changed'?'The stored catalog changed while reading':'The stored catalog is invalid';
    }
  }
  const good=state.lastGood||await loadLastGood(bucket);
  state.problem={reason:problem,etag:head?.etag||null,size:head?.size??null,at:new Date().toISOString()};
  state.bad=headValid(head)?{etag:head.etag}:null;
  if(!good)throw Error('Invalid music library');
  state.lastGood=good;
  return {...good,stale:true,problem:state.problem};
}

/** What /music/health reports: never message bodies, keys or credentials. */
export function libraryHealth(snap){
  return {ok:!snap.stale,servingLastGood:!!snap.stale,problem:snap.problem||null,
    catalog:{etag:snap.etag,count:snap.count,generatedAt:snap.generatedAt,storedBytes:snap.size,limitBytes:MAX_LIBRARY_BYTES,
      usedPercent:Math.round(snap.size/MAX_LIBRARY_BYTES*1000)/10,publicBytes:snap.text.length,waveforms:snap.waves.size}};
}
