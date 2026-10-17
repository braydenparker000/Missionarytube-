import {API_ORIGIN} from './config.js';
import {createPublicDeliveryStore} from './public-delivery-store.js';
import {isMuseMessage} from './channels.js';
import {canonicalPublic, parsePublicCursor, validatePublicEntry, validatePublicEvent, mergePublicEvents, publicEventMessages} from './public-coordination.js';

// A complete public log lives beside the bounded display cache in the existing
// public aggregate. No owner state, credentials, drafts or pending text enter it.
const invalid=()=>Error('The public checkpoint and its immutable cache do not match. The previous cursor has been preserved.');
const object=value=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fields=(value,allowed)=>object(value)&&Object.keys(value).every(key=>allowed.includes(key));
const order=(a,b)=>a.createdAt.localeCompare(b.createdAt)||
  (a.kind==='coordination'&&b.kind==='coordination'?a.publicReport.sequence-b.publicReport.sequence:0)||a.id.localeCompare(b.id);
const timestamp=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const publicText=value=>typeof value==='string'&&value.length<=2000;
function reconciliation(value) {
  if(!fields(value,['enabled','nextAttemptAt','localCatchingUp','legacy'])||value.enabled!==true||!timestamp(value.nextAttemptAt)||typeof value.localCatchingUp!=='boolean')throw invalid();
  const legacy=value.legacy;
  if(legacy!==null){
    if(!object(legacy)||!timestamp(legacy.lastAttempt)||
      (legacy.ok===true?(!fields(legacy,['ok','catchingUp','lastAttempt'])||typeof legacy.catchingUp!=='boolean'):
        legacy.ok!==false||!fields(legacy,['ok','lastAttempt','error'])||!publicText(legacy.error)))throw invalid();
  }
  return structuredClone(value);
}
export function publicReaderMetadata(data, previous={}) {
  const metadata={};
  if(data.serviceVersion!==undefined){
    if(!Number.isSafeInteger(data.serviceVersion)||data.serviceVersion<1)throw invalid();
    metadata.serviceVersion=data.serviceVersion;
  }else if(previous.serviceVersion!==undefined)metadata.serviceVersion=previous.serviceVersion;
  const publisher=data.publisher===undefined?previous.publisher:data.publisher;
  if(publisher!==undefined){
    const allowed=['source','ok','error','lastAttempt','lastSuccessfulSync','catchingUp','pending','conflicts','morePending','moreConflicts','httpStatus','reason','retryAt','reconciliation'];
    if(!fields(publisher,allowed)||typeof publisher.ok!=='boolean'||
      ['source','error','reason'].some(key=>publisher[key]!==undefined&&!publicText(publisher[key]))||
      ['lastAttempt','lastSuccessfulSync','retryAt'].some(key=>publisher[key]!==undefined&&!timestamp(publisher[key]))||
      ['catchingUp','morePending','moreConflicts'].some(key=>publisher[key]!==undefined&&typeof publisher[key]!=='boolean')||
      publisher.httpStatus!==undefined&&(!Number.isSafeInteger(publisher.httpStatus)||publisher.httpStatus<100||publisher.httpStatus>599)||
      ['pending','conflicts'].some(key=>publisher[key]!==undefined&&(!Number.isSafeInteger(publisher[key])||publisher[key]<0)))throw invalid();
    metadata.publisher={...publisher,...(publisher.reconciliation!==undefined?{reconciliation:reconciliation(publisher.reconciliation)}:{})};
  }
  return metadata;
}

export function validatePublicReaderCache(cache, origin=API_ORIGIN) {
  if(!fields(cache,['version','origin','complete','cursor','changes','publisher','serviceVersion'])||cache.version!==2||cache.origin!==origin||
    cache.complete!==true||!Array.isArray(cache.changes))throw invalid();
  const cursor=parsePublicCursor(cache.cursor);
  if(!cursor||cursor.through!==null)throw invalid();
  const entries=new Map(),events=[];let last=0,lastEvent=0;
  for(const change of cache.changes){
    if(!fields(change,['sequence','kind','entry','event'])||!Number.isSafeInteger(change.sequence)||change.sequence<=last||change.sequence>cursor.after)throw invalid();
    last=change.sequence;
    if(change.kind==='entry'&&change.event===undefined){
      const entry=validatePublicEntry(change.entry);
      if(entries.has(entry.id))throw invalid();
      entries.set(entry.id,entry);
    }else if(change.kind==='event'&&change.entry===undefined){
      const event=validatePublicEvent(change.event);
      if(event.sequence<=lastEvent)throw invalid();
      events.push(event);lastEvent=event.sequence;
    }else throw invalid();
  }
  if(last!==cursor.after)throw invalid();
  // A bounded cold index may encounter a historical original after a newer
  // live reply/report. References must exist in the completed snapshot.
  for(const entry of entries.values())if(entry.kind==='reply'&&entries.get(entry.replyTo)?.role!=='user')throw invalid();
  for(const event of events){const original=entries.get(event.requestId);
    if(original?.role!=='user'||event.destination!==(isMuseMessage(original)?'muse':'jarvis'))throw invalid();
  }
  mergePublicEvents([],events);
  return structuredClone({version:2,origin,complete:true,cursor:cache.cursor,changes:cache.changes,...publicReaderMetadata(cache)});
}

export function readPublicReaderCache(cache, origin=API_ORIGIN) {
  try{return validatePublicReaderCache(cache,origin);}catch{return null;}
}

export function mergePublicReaderCaches(first, second, origin=API_ORIGIN) {
  const a=readPublicReaderCache(first,origin),b=readPublicReaderCache(second,origin);
  if(!a)return b;if(!b)return a;
  const older=parsePublicCursor(a.cursor).after<=parsePublicCursor(b.cursor).after?a:b,newer=older===a?b:a;
  if(older.changes.length>newer.changes.length||older.changes.some((change,index)=>canonicalPublic(change)!==canonicalPublic(newer.changes[index])))throw invalid();
  // Publication health can change without a new chat entry. Keep its newest
  // observed attempt even when a stale tab commits the same public cursor.
  const attempt=cache=>Date.parse(cache.publisher?.lastAttempt||cache.publisher?.lastSuccessfulSync||'')||0;
  const health=attempt(a)===attempt(b)?(a.cursor===b.cursor?a:newer):attempt(a)>attempt(b)?a:b,metadata=publicReaderMetadata(health,newer);
  if(a.serviceVersion!==undefined||b.serviceVersion!==undefined)metadata.serviceVersion=Math.max(a.serviceVersion||0,b.serviceVersion||0);
  return {...newer,...metadata};
}

export function extendPublicReaderCache(previous, updates, origin=API_ORIGIN) {
  const cache=previous?validatePublicReaderCache(previous,origin):null;
  return validatePublicReaderCache({version:2,origin,complete:true,cursor:updates.cursor,
    changes:[...(cache?.changes||[]),...updates.changes],...publicReaderMetadata(updates,cache||{})},origin);
}

export function publicReaderInbox(cache) {
  const snapshot=structuredClone(cache);
  const entries=snapshot.changes.filter(change=>change.kind==='entry').map(change=>change.entry);
  const events=snapshot.changes.filter(change=>change.kind==='event').map(change=>change.event);
  const messages=[...entries.filter(entry=>entry.role),...publicEventMessages(events)].sort(order),posts=entries.filter(entry=>!entry.role).sort(order);
  const answered=new Set(messages.filter(message=>message.kind==='reply').map(message=>message.replyTo));
  return {mode:'github-publications',coordinationVersion:2,coordinationCursor:cache.cursor,messages,posts,
    unanswered:messages.filter(message=>message.role==='user'&&!answered.has(message.id)),public_inbox:true,
    author_authenticated:false,execution_authorized:false,...publicReaderMetadata(snapshot),publicRead:true,publicReader:snapshot};
}

export function mergePublicReaderInbox(state, remote, merge) {
  // Cached/delta history is display data. Only an exact POST receipt or exact
  // request probe can consume a queued intent, even when its UUID is in a delta.
  const pending=new Map(state.outbox.map(message=>[message.id,message]));
  const received=remote.publicRead?remote.messages.filter(message=>{
    const queued=pending.get(message.id);if(!queued)return true;
    const proof=remote.publicAcceptance;
    return proof?.version===1&&proof.id===message.id&&proof.role==='user'&&message.role==='user'&&
      proof.body===queued.body&&message.body===queued.body&&message.replyTo===undefined&&
      ['post-receipt','exact-target'].includes(proof.source);
  }):remote.messages;
  const result=merge(state,{...remote,messages:received});
  const cache=mergePublicReaderCaches(remote.publicReader,state.publicReader);
  return {...result,...(cache?{publicReader:cache}:{})};
}

export function createPublicReaderDeliveryStore(options) {
  const store=createPublicDeliveryStore(options),origin=options.origin||API_ORIGIN;
  const checkpoint=(state,other)=>{const cache=mergePublicReaderCaches(state.publicReader,other?.publicReader,origin);
    return {...state,publicReader:cache||undefined,...(cache?.publisher?{publisher:{...cache.publisher}}:{})};};
  return {...store,
    restore(state){return checkpoint(store.restore(state));},
    commit(next){
      // Read immediately before the aggregate write: a slower tab must retain a
      // newer complete checkpoint already committed by another tab.
      const stored=options.read(options.storage);
      return store.commit(checkpoint(next,stored));
    },
    external(current){const incoming=options.read(options.storage);return checkpoint(store.external(current),incoming);}
  };
}
