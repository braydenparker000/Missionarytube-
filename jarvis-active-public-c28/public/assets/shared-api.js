import {API_ORIGIN,DIRECT_API_ENABLED} from './config.js';
import {createDirectApi} from './direct-api.js';
// Public namespace identifier, deliberately shipped to every visitor.
// It grants no trusted publishing authority: ALL Worker assistant/board rows
// are ignored. Only the GitHub-deployed, same-origin publication file is trusted.
const PUBLIC_INBOX='2d9a0d0d4254cd5774d2d4e7806cbadae306271ffc1f31fef0d44cd7e226c2a5';
const validId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
export function combineInbox(raw,feed){
 if(!Array.isArray(raw.messages)||feed.version!==1||!Array.isArray(feed.replies)||!Array.isArray(feed.posts))throw Error('Inbox data could not be read. Your drafts are safe.');
 const users=raw.messages.filter(m=>m.role==='user');
 const targets=new Set(users.map(m=>m.id)),answered=new Set(),ids=new Set(users.map(m=>m.id)),replies=[];
 for(const r of feed.replies){
  if(!validId(r.id)||!validId(r.replyTo)||typeof r.body!=='string'||!Number.isFinite(Date.parse(r.createdAt)))throw Error('Published reply could not be read.');
  if(targets.has(r.replyTo)&&!answered.has(r.replyTo)&&!ids.has(r.id)){replies.push({...r,role:'assistant',kind:'reply'});answered.add(r.replyTo);ids.add(r.id);}
 }
 if(feed.posts.some(p=>!validId(p.id)||typeof p.title!=='string'||typeof p.body!=='string'||!Number.isFinite(Date.parse(p.createdAt))))throw Error('Published briefing could not be read.');
 return {messages:[...users,...replies].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)),posts:feed.posts,unanswered:users.filter(m=>!answered.has(m.id)),publisher:{ok:true,source:'GitHub → Azure'},mode:'one-shared-inbox'};
}
export function createSharedApi(fetcher=fetch,origin=API_ORIGIN){
 async function cloud(path,body,key=PUBLIC_INBOX){
  const r=await fetcher(origin+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:AbortSignal.timeout(15000)});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Cloud unavailable. Your draft is saved.');return data;
 }
 async function load(raw){
  const r=await fetcher('/content/jarvis.json',{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('Published replies are temporarily unavailable. Please refresh.');
  return combineInbox(raw||await cloud('/v1/state'),await r.json());
 }
 return async function request(path,body,headers={}){
  if(path==='/shared/messages')return load(await cloud('/v1/messages',{id:body.id,body:body.body}));
  if(path==='/shared/migrate'){
   const key=headers.Authorization?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!key)throw Error('Previous inbox credential unavailable.');
   const old=await cloud('/v1/state',null,key);
   for(const m of old.messages.filter(x=>x.role==='user'))await cloud('/v1/messages',{id:m.id,body:m.body});
   return load();
  }
  if(path==='/shared/state')return load();
  throw Error('Unsupported inbox action');
 };
}
export const request=DIRECT_API_ENABLED?createDirectApi():createSharedApi();
