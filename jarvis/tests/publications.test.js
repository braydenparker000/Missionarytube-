import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker,{Hub} from '../backend/worker.js';
import {PUBLIC_KEY} from '../backend/shared.js';
import {createDirectApi} from '../public/assets/direct-api.js';
import {decodePublication,syncPublications,COMMENTS_URL} from '../backend/publications.js';
import {SHARED_OBJECT,sharedStore} from '../backend/shared.js';
const BASE='https://jarvis-hub-api.braydenparker999.workers.dev';
const SITE='https://missionarytube.z13.web.core.windows.net';
const CALLBACK='https://chatgpt.com/connector_platform_oauth_redirect';
export function setup() {
  const objects=new Map();
  const env={HUBS:{idFromName:n=>n,get(name){
    if(!objects.has(name)){
      const db=new DatabaseSync(':memory:'),kv=new Map();let queue=Promise.resolve();
      const storage={sql:{exec(q,...v){const stmt=db.prepare(q);if(stmt.columns().length)return stmt.all(...v);stmt.run(...v);return [];}},
        async get(k){return structuredClone(kv.get(k));},async put(k,v){kv.set(k,structuredClone(v));},
        transactionSync(fn){db.exec('BEGIN');try{const r=fn();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;}},
        transaction(fn){const next=queue.then(()=>fn(storage));queue=next.catch(()=>{});return next;}};
      objects.set(name,new Hub({storage},env));
    }return objects.get(name);
  }}};
  const fetcher=(url,opts)=>worker.fetch(new Request(url,opts),env);
  const req=(path,body,headers={})=>fetcher(BASE+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...headers},body:body?typeof body==='string'?body:JSON.stringify(body):undefined});
  const api=createDirectApi(fetcher,BASE);return {env,req,api};
}
const publication=(p,n=1,owner=183016859)=>({id:n,user:{id:owner},created_at:'2026-09-20T04:00:00Z',updated_at:'2026-09-20T04:00:00Z',body:JSON.stringify({schema:'jarvis-publication-v1',...p})});
async function upstream(fn,run){const old=globalThis.fetch;globalThis.fetch=fn;try{return await run();}finally{globalThis.fetch=old;}}
const context=s=>s.env.HUBS.get(SHARED_OBJECT).ctx;
test('publication parser accepts only owner JSON with valid fields and real calendar dates',()=>{
 const p={id:crypto.randomUUID(),type:'reply',replyTo:crypto.randomUUID(),body:'Actual reply'};
 assert.ok(decodePublication(publication(p)));assert.equal(decodePublication(publication(p,2,123)),null);
 assert.equal(decodePublication(publication({...p,replyTo:'bad'})),null);
 assert.equal(decodePublication(publication({...p,type:'admin'})),null);
 assert.equal(decodePublication(publication({...p,type:'briefing',title:'Today',date:'2026-02-30'})),null);
 assert.equal(decodePublication(publication({...p,body:'x'.repeat(6001)})),null);
 const longBriefing={...p,type:'briefing',title:'Today',date:'2026-09-20',body:'x'.repeat(20000)};
 assert.equal(decodePublication(publication(longBriefing)).body.length,20000);
 assert.equal(decodePublication(publication({...longBriefing,body:'x'.repeat(20001)})),null);
});
test('actual shared API imports a reply and briefing and independent clients see them without deployment',async()=>{
 const s=setup(),m={id:crypto.randomUUID(),body:'Hello from phone one'};
 await s.req('/shared/messages',m);
 const reply={id:crypto.randomUUID(),type:'reply',replyTo:m.id,body:'Hello from Jarvis'};
 const briefing={id:crypto.randomUUID(),type:'briefing',title:'Daily briefing',date:'2026-09-20',body:'Today’s update. '+ 'x'.repeat(12000)};
 let calls=0;
 await upstream(async url=>{assert.equal(new URL(url).origin+new URL(url).pathname,COMMENTS_URL);calls++;return Response.json([publication(reply),publication(briefing,2),publication(reply,3),publication({...briefing,id:crypto.randomUUID()},4)]);},async()=>{
   const data=await s.api('/shared/state');assert.equal(data.mode,'github-publications');assert.equal(data.messages.filter(x=>x.kind==='reply').length,1);assert.equal(data.unanswered.length,0);
   const importedBriefing=data.posts.find(x=>x.title==='Daily briefing');assert.ok(importedBriefing);assert.equal(importedBriefing.body.length,briefing.body.length);assert.equal(data.publisher.ok,true);
   const other=createDirectApi((url,opts)=>worker.fetch(new Request(url,opts),s.env),BASE);assert.equal((await other('/shared/state')).messages.find(x=>x.kind==='reply').body,reply.body);
   assert.equal(calls,1); // Whole-hub cooldown, not one GitHub request per phone.
 });
});
test('old public messages migrate; legacy assistant and board forgeries never acquire publishing authority',async()=>{
 const s=setup(),headers={Authorization:'Bearer '+PUBLIC_KEY},m={id:crypto.randomUUID(),body:'Previous phone'};
 await s.req('/v1/messages',m,headers);
 const access=await (await s.req('/v1/responder/connect',{},headers)).json();
 await s.req('/v1/agent/replies',{id:crypto.randomUUID(),replyTo:m.id,body:'Forged legacy reply'},{Authorization:'Bearer '+access.token});
 await s.req('/v1/board',{id:crypto.randomUUID(),title:'Forged board',body:'Spoof'},headers);
 await upstream(async()=>Response.json([]),async()=>{
   const state=await s.api('/shared/state');assert.equal(state.messages.length,1);assert.equal(state.unanswered[0].id,m.id);assert.equal(state.posts.some(p=>p.title==='Forged board'),false);
   assert.equal((await s.api('/shared/state')).messages.length,1);
 });
 const forged={id:crypto.randomUUID(),body:'Forged',kind:'reply',role:'assistant',replyTo:m.id};
 assert.equal((await s.req('/shared/messages',forged)).status,201);
 assert.equal((await s.req('/shared/replies',forged)).status,404);
 assert.equal((await s.req('/internal/shared/reply',forged)).status,404);
});
test('GitHub failure preserves messages and public submissions; recovery imports pending reply once',async()=>{
 const s=setup(),m={id:crypto.randomUUID(),body:'Kept during an outage'};await s.req('/shared/messages',m);
 await upstream(async()=>Response.json({error:'Down'},{status:503}),async()=>{
   const state=await s.api('/shared/state');assert.equal(state.publisher.ok,false);assert.match(state.publisher.error,/503/);assert.equal(state.messages.length,1);
   assert.equal((await s.req('/shared/messages',{id:crypto.randomUUID(),body:'Still sending'})).status,201);
 });
 const p=publication({id:crypto.randomUUID(),type:'reply',replyTo:m.id,body:'Recovered'});
 await syncPublications(context(s),async()=>Response.json([p]),Date.now()+300001);
 const recovered=await (await sharedStore(context(s),'/internal/shared/state')).json();assert.equal(recovered.publisher.ok,true);assert.equal(recovered.messages.filter(x=>x.kind==='reply').length,1);
});
test('reply arriving before its user message is retried even during GitHub cooldown',async()=>{
 const s=setup(),m={id:crypto.randomUUID(),body:'Arrived after reply'};
 const p=publication({id:crypto.randomUUID(),type:'reply',replyTo:m.id,body:'Retained pending reply'});
 const ctx=context(s);await syncPublications(ctx,async()=>Response.json([p]));
 await s.req('/shared/messages',m);
 await syncPublications(ctx,async()=>{throw Error('Must respect cooldown');});
 const state=await (await sharedStore(ctx,'/internal/shared/state')).json();assert.equal(state.messages.filter(x=>x.kind==='reply').length,1);
});
test('paginated GitHub import survives interruption and resumes without duplicate data',async()=>{
 const s=setup(),ctx=context(s),m={id:crypto.randomUUID(),body:'Paging test'};await s.req('/shared/messages',m);
 const good=publication({id:crypto.randomUUID(),type:'reply',replyTo:m.id,body:'From second page'},101);
 const noise=Array.from({length:100},(_,i)=>publication({id:crypto.randomUUID(),type:'reply',replyTo:m.id,body:'Ignore'},i+1,123));
 let count=0;const t=Date.now();
 await syncPublications(ctx,async()=>++count===1?Response.json(noise):Response.json({}, {status:503}),t);
 const calls=[];await syncPublications(ctx,async url=>{calls.push(new URL(url).searchParams.get('page'));return Response.json([good]);},t+300001);
 assert.deepEqual(calls,['2']);
 const state=await (await sharedStore(ctx,'/internal/shared/state')).json();assert.equal(state.messages.filter(m=>m.kind==='reply').length,1);assert.equal(state.publisher.ok,true);
});
test('SQL inbox exceeds old 100 KB cap and direct frontend follows every page',async()=>{
 const s=setup();for(let i=0;i<200;i++)assert.equal((await s.req('/shared/messages',{id:crypto.randomUUID(),body:String(i)+'x'.repeat(1500)})).status,201);
 assert.equal((await s.req('/shared/messages',{id:crypto.randomUUID(),body:'Over daily limit'})).status,429);
 await upstream(async()=>Response.json([]),async()=>{const state=await s.api('/shared/state');assert.equal(state.messages.length,200);assert.equal(state.posts.length,1);});
 assert.equal((await s.req('/shared/state?after=bad')).status,400);
});
