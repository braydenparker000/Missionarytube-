export const STORAGE_KEY='jarvis.shared.v1';
export const LEGACY_KEY='jarvis.hub.v2';
const sameTuple=(a,b)=>a.id===b.id&&a.role===b.role&&a.body===b.body&&(a.replyTo||null)===(b.replyTo||null);
const localLegacy=message=>{
 const local={...message,saved:false,localOnly:true,legacyHistory:true};
 delete local.sharedAcceptance;
 return local;
};
export function readState(storage){
 let old;try{old=JSON.parse(storage.getItem(LEGACY_KEY)||'null');}catch{}
 const legacy=Array.isArray(old?.messages)?old.messages.filter(m=>m.role==='user'):[];
 const raw=storage.getItem(STORAGE_KEY);
 if(raw){
  const s=JSON.parse(raw);if(s.version!==1||!['messages','posts','outbox'].every(k=>Array.isArray(s[k])))throw Error('Saved drafts could not be opened. They have not been overwritten.');
  const previous=new Map(legacy.map(m=>[m.id,m]));
  for(const m of s.messages)if(previous.has(m.id)&&!sameTuple(m,previous.get(m.id)))throw Error('The saved inbox has different content for a message in your older local history. The original history and drafts have not been overwritten.');
  const messages=s.messages.map(m=>{
   const associated=m.legacyHistory===true||previous.has(m.id)&&sameTuple(m,previous.get(m.id));
   const ambiguous=s.legacyPending===true&&!legacy.length&&m.role==='user';
   if(!associated&&!ambiguous)return m;
   return m.saved===true&&hasSharedAcceptance(m)?{...m,legacyHistory:true}:localLegacy(m);
  });
  const present=new Set(messages.map(m=>m.id));
  for(const m of legacy)if(!present.has(m.id)){messages.push(localLegacy(m));present.add(m.id);}
  return {...s,messages,...(s.legacyPending===true?{legacyPending:false}:{})};
 }
 return {version:1,messages:legacy.map(localLegacy),posts:[],outbox:[],composer:old?.composer||'',legacyPending:false,syncedAt:null};
}
export function mergeState(state,remote){
 return {...state,...mergePublicMessages(state.messages,state.outbox,remote.messages,{sharedEvidence:true}),posts:remote.partial?state.posts:remote.posts.map(x=>({...x,saved:true})),publisher:remote.publisher||state.publisher,mode:remote.mode||state.mode,syncedAt:new Date().toISOString()};
}
import {mergePublicMessages,hasSharedAcceptance} from './public-delivery-store.js';
