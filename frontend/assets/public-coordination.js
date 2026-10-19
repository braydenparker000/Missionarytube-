const uuid = value => typeof value==='string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const object = value => !!value && typeof value==='object' && !Array.isArray(value);
const timestamp = value => typeof value==='string' && Number.isFinite(Date.parse(value));
const fields = (value, allowed) => object(value) && Object.keys(value).every(key=>allowed.includes(key));
export const canonicalPublic = value => Array.isArray(value)?'['+value.map(canonicalPublic).join(',')+']':value&&typeof value==='object'
  ?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalPublic(value[key])).join(',')+'}':JSON.stringify(value);

export function validatePublicEntry(entry) {
  if (!fields(entry,['id','body','createdAt','role','kind','replyTo','title']) || !uuid(entry.id) ||
      typeof entry.body!=='string' || !entry.body.trim() || !timestamp(entry.createdAt))
    throw Error('The inbox returned an invalid immutable public entry. Saved messages and the previous cursor have been preserved.');
  const user=entry.role==='user' && entry.kind===undefined && entry.replyTo===undefined && entry.title===undefined;
  const reply=entry.role==='assistant' && entry.kind==='reply' && uuid(entry.replyTo) && entry.title===undefined;
  const post=entry.role===undefined && entry.kind===undefined && entry.replyTo===undefined &&
    typeof entry.title==='string' && !!entry.title.trim() && entry.title.length<=120;
  if (!(user||reply||post) || entry.body.length>(user?4000:reply?6000:20000))
    throw Error('The inbox returned an invalid immutable public entry. Saved messages and the previous cursor have been preserved.');
  return entry;
}

export function validatePublicEvent(event) {
  if (!fields(event,['schema','eventId','requestId','attemptId','stage','body','artifacts','resultVersion','supersedesEventId',
      'sequence','recordedAt','provenance','disposition','errorCode','destination','visibility','author_authenticated','execution_authorized']) ||
      !['jarvis-coordination-v2','jarvis-publication-v1-update'].includes(event.schema) ||
      !uuid(event.eventId) || !uuid(event.requestId) || !uuid(event.attemptId) ||
      !['receipt','progress','final','correction'].includes(event.stage) || !['accepted','conflict'].includes(event.disposition) ||
      typeof event.body!=='string' || !event.body.trim() || event.body.length>6000 ||
      !Number.isSafeInteger(event.sequence) || event.sequence<1 || !timestamp(event.recordedAt) ||
      event.visibility!=='public' || event.author_authenticated!==false || event.execution_authorized!==false ||
      !['muse','jarvis'].includes(event.destination) || !Array.isArray(event.artifacts) || event.artifacts.length>8 ||
      !fields(event.provenance,['source','repository','issue','authorId','commentId','publishedAt','legacyConflict']) ||
      event.provenance.source!=='github-issue' || event.provenance.repository!=='braydenparker999/jarvis' ||
      event.provenance.issue!==2 || event.provenance.authorId!==183016859 ||
      !Number.isSafeInteger(event.provenance.commentId) || event.provenance.commentId<1 || !timestamp(event.provenance.publishedAt) ||
      event.provenance.legacyConflict!==undefined && event.provenance.legacyConflict!==true ||
      event.disposition==='accepted' && event.errorCode!==undefined ||
      event.disposition==='conflict' && (typeof event.errorCode!=='string' || !/^[a-z_]{1,80}$/.test(event.errorCode)))
    throw Error('The inbox returned an invalid public report. Saved messages and the previous cursor have been preserved.');
  if (event.stage==='final' && (event.resultVersion!==1 || event.supersedesEventId!==undefined) ||
      event.stage==='correction' && (!Number.isSafeInteger(event.resultVersion) || event.resultVersion<2 || !uuid(event.supersedesEventId)) ||
      ['receipt','progress'].includes(event.stage) && (event.resultVersion!==undefined || event.supersedesEventId!==undefined || event.artifacts.length) ||
      event.schema==='jarvis-publication-v1-update' && (event.stage!=='final' || event.artifacts.length || event.attemptId!==event.eventId) ||
      new Set(event.artifacts.map(item=>item?.id)).size!==event.artifacts.length)
    throw Error('The inbox returned an invalid result version.');
  for (const item of event.artifacts) {
    let url;try{url=new URL(item?.url);}catch{}
    if(!fields(item,['id','revision','label','url']) || !uuid(item.id) || !Number.isSafeInteger(item.revision) || item.revision<1 ||
      typeof item.label!=='string' || !item.label.trim() || item.label.length>120 ||
      typeof item.url!=='string' || item.url.length>2048 || !url || url.protocol!=='https:' || url.username || url.password || url.port&&url.port!=='443')
      throw Error('The inbox returned an invalid artifact revision.');
  }
  return event;
}
export function mergePublicEvents(known, received) {
  const events=new Map(),sequences=new Map();
  for(const candidate of [...known,...received]){
    const event=validatePublicEvent(candidate),previous=events.get(event.eventId);
    if(previous&&canonicalPublic(previous)!==canonicalPublic(event) || sequences.has(event.sequence)&&sequences.get(event.sequence)!==event.eventId)
      throw Error('A saved immutable public report changed. The previous cursor has been preserved.');
    events.set(event.eventId,event);sequences.set(event.sequence,event.eventId);
  }
  return [...events.values()].sort((a,b)=>a.sequence-b.sequence);
}
export const publicReportLabel = message => {
  if(message.kind!=='coordination')return '';
  const report=message.publicReport;
  if(report.disposition==='conflict')return 'Public version conflict · '+report.errorCode;
  if(report.schema==='jarvis-publication-v1-update')return 'Later public reply · original kept';
  return {receipt:'Public receipt report',progress:'Public progress report',final:'Public final report',correction:'Public correction'}[report.stage]+
    (report.resultVersion?' · version '+report.resultVersion:'');
};
export function publicEventMessages(events) {
  return events.map(event=>({id:'coordination:'+event.eventId,role:'assistant',kind:'coordination',replyTo:event.requestId,
    body:event.body,createdAt:event.recordedAt,destination:event.destination,publicReport:event}));
}

export function parsePublicCursor(value, requestId) {
  if(requestId!==undefined&&!uuid(requestId))return null;
  const prefix=requestId?'pr2:'+requestId+':':'pc2:';
  const match=typeof value==='string' && new RegExp('^'+prefix+'(0|[1-9]\\d{0,14})(?::(0|[1-9]\\d{0,14}))?$').exec(value);
  if(!match)return null;
  const after=Number(match[1]),through=match[2]===undefined?null:Number(match[2]);
  return through!==null&&after>through?null:{after,through,prefix};
}

export async function readPublicPages(cloud, {requestId, cursor, events=[]}={}) {
  const exact=requestId!==undefined,prefix=exact?'pr2:'+requestId+':':'pc2:';
  let token=cursor===undefined?prefix+'0':cursor;
  const initial=parsePublicCursor(token,requestId);
  const failed=()=>Error('Public update pagination failed. The previous cursor has been preserved.');
  if(!initial)throw failed();
  let snapshot=initial.through,last=initial.after,lastEvent=0,data,message,reply;
  const received=[],entries=[],changes=[],seen=new Set([token]),identities=new Set();
  do {
    const params=new URLSearchParams({cursor:token});if(exact)params.set('requestId',requestId);
    data=await cloud((exact?'/shared/result?':'/shared/changes?')+params);
    const done=parsePublicCursor(data?.cursor,requestId),next=data?.nextCursor===null?null:parsePublicCursor(data?.nextCursor,requestId);
    if(!object(data) || data.mode!=='github-publications' || data.coordinationVersion!==2 || !done || done.through!==null || done.after<last ||
      snapshot!==null&&done.after!==snapshot || data.nextCursor!==null&&(!next || next.through!==done.after || next.after<=last || next.after>=done.after || seen.has(data.nextCursor)) ||
      data.public_inbox!==true || data.author_authenticated!==false || data.execution_authorized!==false)
      throw failed();
    snapshot=done.after;
    if(exact){
      validatePublicEntry(data.message);
      if(data.message.id!==requestId || data.message.role!=='user' || !Array.isArray(data.events) || data.events.length>100 || next&&!data.events.length)
        throw Error('The public result target could not be confirmed.');
      if(data.reply!==null){validatePublicEntry(data.reply);if(data.reply.kind!=='reply'||data.reply.replyTo!==requestId)throw Error('The public result reply has a different target.');}
      if(message&&canonicalPublic(message)!==canonicalPublic(data.message) || reply!==undefined&&canonicalPublic(reply)!==canonicalPublic(data.reply))
        throw Error('The immutable public result changed between pages.');
      message=data.message;reply=data.reply;
      for(const candidate of data.events){
        const event=validatePublicEvent(candidate);
        if(event.requestId!==requestId || event.sequence<=lastEvent || identities.has(event.eventId))throw Error('The public result page skipped its target.');
        lastEvent=event.sequence;identities.add(event.eventId);received.push(event);
      }
    }else{
      if(!Array.isArray(data.changes) || data.changes.length>100)throw Error('The public change page is unreadable.');
      for(const change of data.changes){
        if(!fields(change,['sequence','kind','entry','event']) || !Number.isSafeInteger(change.sequence) || change.sequence<=last || change.sequence>snapshot)
          throw Error('Public change sequence failed. The previous cursor has been preserved.');
        last=change.sequence;
        let identity;
        if(change.kind==='event' && change.entry===undefined){
          const event=validatePublicEvent(change.event);identity='event:'+event.eventId;received.push(event);
        }else if(change.kind==='entry' && change.event===undefined){
          const entry=validatePublicEntry(change.entry);identity='entry:'+entry.id;entries.push(entry);
        }else throw Error('The public change page is unreadable.');
        if(identities.has(identity))throw Error('The public change page repeated an immutable item.');
        identities.add(identity);changes.push(change);
      }
      if(next&&next.after!==last || !next&&last!==snapshot)throw Error('The public change cursor skipped entries.');
    }
    if(next)last=next.after;
    token=data.nextCursor;seen.add(token);
  }while(token!==null);
  if(exact&&events.some(event=>event.requestId!==requestId))throw Error('The public result target could not be confirmed.');
  return {...data,events:mergePublicEvents(events,received),entries,changes};
}
