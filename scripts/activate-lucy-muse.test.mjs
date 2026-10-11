import test from 'node:test';
import assert from 'node:assert/strict';
import {transition,checkedAfter,FINGERPRINT} from './activate-lucy-muse.mjs';
const before={bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fixture'},
 {name:'RELAY_AGENT_LUCY_OAUTH_ENABLED',type:'plain_text',text:'true'},
 {name:'RELAY_AGENTS_ENABLED',type:'plain_text',text:'false'},
 {name:'RELAY_MAST_TOKEN_SHA256',type:'plain_text',text:'unrelated-fixture'},
 {name:'PRIVATE',type:'secret_text'}]};
test('exact two-value transition preserves all unrelated bindings and secret references',()=>{
 const original=structuredClone(before),plan=transition(before);assert.deepEqual(before,original);
 assert.deepEqual(plan.bindings.find(b=>b.name==='PRIVATE'),{name:'PRIVATE',type:'secret_text'});
 const after={bindings:before.bindings.filter(b=>b.name!=='RELAY_AGENTS_ENABLED').concat(plan.bindings.filter(b=>b.text))};
 checkedAfter(after,plan.expectedDigest);
 checkedAfter({bindings:after.bindings.map(b=>Object.fromEntries(Object.entries(b).reverse()))},plan.expectedDigest);
 for(const mutate of [s=>s.bindings[0].namespace_id='changed',s=>s.bindings[2].text='changed',s=>s.bindings.pop(),s=>s.bindings.push({name:'OTHER',type:'plain_text',text:'true'})]){
 const changed=structuredClone(after);mutate(changed);assert.throws(()=>checkedAfter(changed,plan.expectedDigest));
 }
 assert.throws(()=>transition({bindings:[...before.bindings,{name:'RELAY_AGENT_MUSE_TOKEN_SHA256',type:'plain_text',text:FINGERPRINT}]}));
});
