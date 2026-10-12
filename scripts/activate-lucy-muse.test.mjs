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

test('only provider audit trigger may differ after exact baseline reconstruction',async()=>{
 const {checkedAuditTransition}=await import('./activate-lucy-muse.mjs');
 const {canonicalDigest}=await import('./lucy-settings-diagnostic.mjs');
 const before={'workers/triggered_by':'upload','workers/tag':'retained'},after={...before,'workers/triggered_by':'secret'};
 const old={compatibility_date:'2026-01-01',compatibility_flags:['first','second'],annotations:before},current={...old,annotations:after};
 checkedAuditTransition(current,canonicalDigest(old),before,after);
 assert.throws(()=>checkedAuditTransition({...current,compatibility_date:'2026-02-02'},canonicalDigest(old),before,after));
 assert.throws(()=>checkedAuditTransition({...current,compatibility_flags:['second','first']},canonicalDigest(old),before,after));
 assert.throws(()=>checkedAuditTransition({...current,annotations:{...after,'workers/tag':'changed'}},canonicalDigest(old),before,{...after,'workers/tag':'changed'}));
});

test('replacement changes only the exact old fingerprint; both flags and unrelated values stay exact',async()=>{
 const {replacementTransition,REPLACEMENT,bindingDigest}=await import('./activate-lucy-muse.mjs');
 const settings=structuredClone(before);settings.bindings.find(b=>b.name==='RELAY_AGENTS_ENABLED').text='true';
 settings.bindings.push({name:'RELAY_AGENT_MUSE_TOKEN_SHA256',type:'plain_text',text:FINGERPRINT});
 const original=structuredClone(settings),plan=replacementTransition(settings);assert.deepEqual(settings,original);
 assert.deepEqual(plan.bindings.filter(b=>'text'in b),[{name:'RELAY_AGENT_MUSE_TOKEN_SHA256',type:'plain_text',text:REPLACEMENT}]);
 const expected=structuredClone(settings);expected.bindings.at(-1).text=REPLACEMENT;
 assert.equal(plan.expectedDigest,bindingDigest(expected));checkedAfter(expected,plan.expectedDigest);
 for(const name of ['RELAY_AGENTS_ENABLED','RELAY_AGENT_LUCY_OAUTH_ENABLED','RELAY_MAST_TOKEN_SHA256']){
  const changed=structuredClone(expected);changed.bindings.find(b=>b.name===name).text='changed';assert.throws(()=>checkedAfter(changed,plan.expectedDigest));
 }
 const wrong=structuredClone(settings);wrong.bindings.at(-1).text='0'.repeat(64);assert.throws(()=>replacementTransition(wrong));
 assert.throws(()=>replacementTransition(expected),'cannot repeat replacement');
});
