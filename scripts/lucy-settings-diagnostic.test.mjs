import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {canonical,canonicalDigest,compareBindings,FLAG,checkedCheckpoint,settingsDigest as diagnosticDigest} from './lucy-settings-diagnostic.mjs';
import {settingsDigest} from './worker-release-identity.mjs';

const privateValue='fictional-private-value-never-output';
const baseline={bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fixture'},
  {name:'RELAY_AGENTS_ENABLED',type:'plain_text',text:'false'},
  {name:'PRIVATE',type:'plain_text',text:privateValue},{name:'EXISTING_SECRET',type:'secret_text'}]};
const oldExpected={bindings:[...baseline.bindings,{name:FLAG,type:'plain_text',text:'true'}]};
const actual={bindings:[...baseline.bindings,{name:FLAG,text:'true',type:'plain_text'}]};
const options={baselineDigest:settingsDigest(baseline),expectedDigest:settingsDigest(oldExpected),
  baselineBindings:baseline.bindings.map(({name,type,...rest})=>({name,type,...(name==='HUBS'?rest:{})}))};

test('live-equivalent target key ordering is proven against both retained hashes before canonical acceptance',()=>{
  assert.equal(diagnosticDigest(baseline),settingsDigest(baseline));
  assert.notEqual(settingsDigest(actual),options.expectedDigest);
  const report=compareBindings(actual,options);
  assert.equal(report.verified,true);assert.equal(report.baselineReconstructed,true);
  assert.equal(report.objectOrderingExplainsMismatch,true);assert.equal(report.priorFlag,'absent');
  assert.equal(report.actualCanonicalDigest,report.expectedCanonicalDigest);
  assert.deepEqual(report.otherSemanticDifferences,[]);
  assert.ok(!JSON.stringify(report).includes(privateValue));
  assert.equal(actual.bindings.at(-1).text,'true','diagnostic never changes the input');
});
test('canonical object ordering preserves array order and does not authorize unproven private-value differences',()=>{
  assert.deepEqual(canonical({b:[{z:1,a:2},3],a:0}),{a:0,b:[{a:2,z:1},3]});
  assert.notEqual(canonicalDigest({values:[1,2]}),canonicalDigest({values:[2,1]}));
  for(const mutate of [s=>s.bindings[2].text='changed-private-value',s=>s.bindings[1].text='true',
    s=>s.bindings[0].namespace_id='other',s=>s.bindings.splice(3,1),
    s=>s.bindings.push({name:'OTHER',type:'plain_text',text:'private-new-value'})]){
    const changed=structuredClone(actual);mutate(changed);const report=compareBindings(changed,options);
    assert.equal(report.verified,false);assert.equal(report.reason,'pinned_baseline_not_reconstructed');
    assert.ok(!JSON.stringify(report).includes('changed-private-value'));assert.ok(!JSON.stringify(report).includes('private-new-value'));
  }
  assert.equal(compareBindings(actual,{...options,expectedDigest:'a'.repeat(64)}).verified,false);
  assert.equal(compareBindings(actual,{...options,baselineDigest:'b'.repeat(64)}).verified,false);
  const unexpected=structuredClone(actual);unexpected.bindings.push({name:'UNEXPECTED_RESOURCE',type:'kv_namespace',namespace_id:'private-resource-id'});
  const report=compareBindings(unexpected,options);assert.equal(report.verified,false);
  assert.deepEqual(report.knownDifferences,[{binding:'UNEXPECTED_RESOURCE',change:'added'}]);
  assert.ok(!JSON.stringify(report).includes('private-resource-id'));
});
test('only the approved flag is accepted; a prior false value can be reconstructed without mutation',()=>{
  const disabled={bindings:[...baseline.bindings,{name:FLAG,text:'false',type:'plain_text'}]};
  const report=compareBindings(actual,{...options,baselineDigest:settingsDigest(disabled)});
  assert.equal(report.verified,true);assert.equal(report.priorFlag,'false');
  for(const mutate of [s=>s.bindings.at(-1).text='false',s=>s.bindings.at(-1).type='secret_text',
    s=>s.bindings.push({...s.bindings.at(-1)}),s=>delete s.bindings.at(-1).text]){
    const changed=structuredClone(actual);mutate(changed);assert.equal(compareBindings(changed,options).verified,false);
  }
  assert.throws(()=>checkedCheckpoint({}));
});
test('the existing workflow excludes deployment and restricts the diagnostic to main with fixed provenance',async()=>{
  const flow=await readFile(new URL('../.github/workflows/deploy-music-worker.yml',import.meta.url),'utf8');
  assert.match(flow,/github.ref == 'refs\/heads\/main' && inputs.verify_lucy_discovery_only == true/);
  assert.match(flow,/inputs.confirm_public_music == true && inputs.verify_lucy_discovery_only != true/);
  const diagnostic=flow.slice(flow.indexOf('  verify-lucy-discovery:'));
  assert.doesNotMatch(diagnostic,/wrangler-action|wrangler deploy|secret put|upload-batch/);
  assert.match(diagnostic,/run-id: 38165680255/);assert.match(diagnostic,/11712500345/);
  assert.match(diagnostic,/fc35e7b6dc914ac34543ef5e3f511a3f3829ac2635a28015f4e9299867e354f9/);
  const script=await readFile(new URL('./lucy-settings-diagnostic.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(script,/method:\s*['"](?:POST|PUT|PATCH|DELETE)['"]|writeFile|appendFile|execFile|spawn/);
});
