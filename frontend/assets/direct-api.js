import {API_ORIGIN} from './config.js';
import {readPublicPages, validatePublicEntry, canonicalPublic} from './public-coordination.js';
import {mergePublicReaderCaches, extendPublicReaderCache, publicReaderInbox} from './public-reader-cache.js';
// Enabled only after the deployed Worker and authenticated assistant pass live tests.
export function createDirectApi(fetcher=fetch,origin=API_ORIGIN) {
  let publicReader=null,protocol=null,legacySnapshot=null,reads=Promise.resolve();
  const initializationPage=data=>data&&typeof data==='object'&&!Array.isArray(data)&&
    Object.keys(data).every(key=>['error','code','readiness','mode','serviceVersion','coordinationVersion','public_inbox','author_authenticated','execution_authorized'].includes(key))&&
    typeof data.error==='string'&&!!data.error.trim()&&data.code==='public_history_initializing'&&data.readiness===false&&
    data.mode==='github-publications'&&data.serviceVersion===7&&data.coordinationVersion===1&&data.public_inbox===true&&
    data.author_authenticated===false&&data.execution_authorized===false;
  async function cloud(path,body,headers={}) {
    let r;
    try{r=await fetcher(origin+path,{method:body?'POST':'GET',headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});}
    catch{throw Error('Could not reach the public inbox. Your draft and queued messages stay on this device.');}
    let data;try{data=await r.json();}catch{throw Error('The public inbox returned an unreadable response. Your draft and queued messages are still here.');}
    if(!r.ok){const error=Error(data?.error||'Cloud unavailable. Your draft is saved.');error.status=r.status;
      error.initializing=initializationPage(data);throw error;}return data;
  }
  const legacyPage = data => data?.mode==='github-publications' && data.coordinationVersion!==2 &&
    Array.isArray(data.messages) && Array.isArray(data.posts);
  async function loadLegacy(first) {
    const messages=[],posts=[],seen=new Set();let cursor='0',state=first;
    do {
      state=state||await cloud('/shared/state?after='+encodeURIComponent(cursor));
      if(state?.mode==='github-publications'&&state.coordinationVersion===2){
        const error=Error('The public inbox changed history protocol. Your drafts are safe.');error.upgraded=true;throw error;
      }
      if(!legacyPage(state)||state.messages.length+state.posts.length>200)throw Error('Cloud inbox returned invalid data. Your drafts are safe.');
      for(const entry of [...state.messages,...state.posts])validatePublicEntry(entry);
      if(state.messages.some(entry=>!entry.role)||state.posts.some(entry=>entry.role))throw Error('Cloud inbox returned invalid data. Your drafts are safe.');
      messages.push(...state.messages);posts.push(...state.posts);
      if(state.nextCursor!==null && (typeof state.nextCursor!=='string'||!/^(0|[1-9]\d{0,14})$/.test(state.nextCursor)||seen.has(state.nextCursor)||Number(state.nextCursor)<=Number(cursor)))
        throw Error('Inbox pagination failed. Your drafts are safe.');
      cursor=state.nextCursor;seen.add(cursor);if(cursor!==null)state=null;
    } while(cursor!==null);
    const unique=items=>{
      const entries=new Map();
      for(const entry of items){const previous=entries.get(entry.id);if(previous&&canonicalPublic(previous)!==canonicalPublic(entry))throw Error('An immutable inbox entry changed between pages. Your drafts are safe.');entries.set(entry.id,entry);}
      return [...entries.values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id));
    };
    state.messages=unique(messages);state.posts=unique(posts);
    const answered=new Set(state.messages.filter(m=>m.kind==='reply').map(m=>m.replyTo));
    return {...state,unanswered:state.messages.filter(m=>m.role==='user'&&!answered.has(m.id)),publicRead:true};
  }
  async function loadNow(savedCache) {
    const previous=mergePublicReaderCaches(publicReader,savedCache,origin);
    if(previous)protocol=2;
    let upgraded=false;
    if(protocol==='legacy'){
      // A failed snapshot must leave the next refresh free to negotiate again.
      // An upgraded state page permits one v2 probe in this refresh.
      try{return await loadLegacy();}
      catch(error){protocol=null;if(!error.upgraded)throw error;upgraded=true;}
    }
    let first;
    try {
      const updates=await readPublicPages(async path=>{
        const data=await cloud(path);
        if(protocol===null&&!previous&&legacyPage(data)){
          const error=Error('This public backend uses legacy history reads.');error.unsupported=true;
          error.legacyPage=legacyPage(data)?data:undefined;throw error;
        }
        return data;
      },{cursor:previous?.cursor});
      // Publish a new checkpoint only after every fenced page and the complete
      // immutable cache validate. Partial failures retry the old committed token.
      const next=extendPublicReaderCache(previous,updates,origin);
      publicReader=next;protocol=2;
      return publicReaderInbox(next);
    }catch(error){
      const initializing=error.status===503&&error.initializing;
      if(!upgraded&&!previous&&[null,'initializing'].includes(protocol)&&initializing){
        // The older snapshot remains usable while a bounded backend upgrade is
        // in progress. Read it once; existing refreshes probe v2 readiness.
        legacySnapshot=legacySnapshot||await loadLegacy();protocol='initializing';return structuredClone(legacySnapshot);
      }
      if(upgraded||protocol!==null||previous||!(error.unsupported||[404,405,501].includes(error.status)))throw error;
      first=error.legacyPage;
    }
    // Commit fallback only after the entire immutable snapshot validates.
    const legacy=await loadLegacy(first);protocol='legacy';return legacy;
  }
  function load(savedCache) {
    const result=reads.then(()=>loadNow(savedCache));reads=result.catch(()=>{});return result;
  }
  const acceptance=(entry,source)=>({messages:[entry],posts:[],mode:'github-publications',partial:true,publicRead:true,
    publicAcceptance:{version:1,id:entry.id,role:'user',body:entry.body,source}});
  async function exactAcceptance(body) {
    try {
      const result=await readPublicPages(cloud,{requestId:body.id});
      if(result.message.body===body.body.trim())return acceptance(result.message,'exact-target');
      const conflict=Error('This message ID has different saved content. Your original text is queued here; copy it before creating a separate message.');
      conflict.status=409;throw conflict;
    }catch(error){if(error.status===404)return null;throw error;}
  }
  return async function request(path,body,headers={}) {
    if(path==='/shared/result')return readPublicPages(cloud,{requestId:body.requestId,cursor:body.cursor});
    if(path==='/shared/state')return load(body?.publicReader);
    if(path==='/shared/messages'){
      if(body.retry&&protocol===2){const proved=await exactAcceptance(body);if(proved)return proved;}
      let data;
      try{data=await cloud(path,{id:body.id,body:body.body});}
      catch(error){
        if(error.status!==409)throw error;
        // A 409 is acceptance only when an exact target read proves the original
        // UUID, user role and exact text. Never allocate a replacement UUID.
        if(protocol!== 'legacy'){
          const proved=await exactAcceptance(body);if(proved)return proved;
        }else{
          const remote=await load(),entry=remote.messages.find(m=>m.id===body.id&&m.role==='user'&&m.body===body.body.trim());
          if(entry)return acceptance(entry,'exact-target');
        }
        error.message='This message ID has different saved content. Your original text is queued here; copy it before creating a separate message.';throw error;
      }
      let entry;
      try{entry=validatePublicEntry(data?.entry);}catch{throw Error('The send receipt could not confirm your message. Its original text and ID remain queued on this device.');}
      if(entry.id!==body.id||entry.role!=='user'||entry.body!==body.body.trim())throw Error('The send receipt could not confirm your message. Its original text and ID remain queued on this device.');
      // Consume the actual save receipt immediately. A subsequent read may be
      // stale or unavailable and must not turn a proved acceptance into loss.
      return acceptance(entry,'post-receipt');
    }
    if(path==='/shared/migrate'){
      if(!/^Bearer [a-f0-9]{64}$/.test(headers.Authorization||''))throw Error('Previous inbox credential unavailable.');
      const old=await cloud('/v1/state',null,headers);
      for(const m of old.messages.filter(m=>m.role==='user'))await cloud('/shared/messages',{id:m.id,body:m.body});
      return load();
    }
    throw Error('Unsupported inbox action');
  };
}
