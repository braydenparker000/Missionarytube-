import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../backend/relay-common.js';
import {mastAdapterStore,mastOwnerWork,mastWorkEnabled} from '../backend/relay-mast.js';
test('chat activation leaves every owner and adapter Work route denied without storage writes',async t=>{
 const token=random(),digest=await hash(token),h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:digest}});t.after(()=>h.close());
 const owner=await h.pair(await h.oauth()),env=h.fixture.env;
 const adapter=(path,body)=>h.fixture.request('/relay/mast/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
 const id=crypto.randomUUID();assert.equal((await h.phone('/mast',{id,body:'Chat only'},owner.device_token)).status,201);
 assert.equal((await adapter('messages')).status,200);
 assert.equal((await adapter('reply',{id:crypto.randomUUID(),reply_to:id,body:'Chat response'})).status,201);
 for(const value of [undefined,'false','TRUE',true]){
  env.RELAY_MAST_WORK_ENABLED=value;assert.equal(mastWorkEnabled(env),false);
  for(const path of ['work','work?job_id='+id,'work/claim','work/update','work/plan','work/correct'])assert.equal((await adapter(path,path.includes('/')?{}:undefined)).status,503,path);
  for(const [path,body]of [['',undefined],['',{id:crypto.randomUUID(),body:'Denied work',title:'Denied',action_kind:'draft'}],['/detail?job_id='+id,undefined],['/cancel',{job_id:id,event_id:crypto.randomUUID()}],['/retry',{job_id:id,id:crypto.randomUUID()}]])assert.equal((await h.phone('/mast/work'+path,body,owner.device_token)).status,503,path);
  for(const op of ['list','read','claim','update','plan','correct'])assert.equal((await mastAdapterStore(h.ctx,env,{op:'work_'+op,token_hash:digest})).status,503);
  assert.throws(()=>mastOwnerWork(h.ctx,env,{op:'mast_work_create'},{}),/Work is not activated/);
 }
 assert.equal(h.rows("SELECT COUNT(*) AS n FROM sqlite_master WHERE name IN ('relay_mast_work','relay_mast_work_events')")[0].n,0);
 assert.equal((await adapter('messages')).status,200);
});
test('Work additionally requires an exact separate flag and active chat',()=>{
 const env={RELAY_MCP_ENABLED:'true',RELAY_OWNER_ENABLED:'true',RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:'a'.repeat(64)};
 assert.equal(mastWorkEnabled(env),false);assert.equal(mastWorkEnabled({...env,RELAY_MAST_WORK_ENABLED:'true'}),true);
 assert.equal(mastWorkEnabled({...env,RELAY_MAST_ENABLED:'false',RELAY_MAST_WORK_ENABLED:'true'}),false);
});
