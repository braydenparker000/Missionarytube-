import test from 'node:test';
import assert from 'node:assert/strict';
import {LUCY_DISCOVERY_BASELINE,checkedLucyDiscoveryBaseline,expectedLucyDiscoverySettings,planLucyDiscoverySettings,checkedLucyDiscoveryCheckpoint} from '../scripts/relay-worker-release-identity.mjs';
import {settingsDigest} from '../scripts/worker-release-identity.mjs';

const flag='RELAY_AGENT_LUCY_OAUTH_ENABLED';
const settings={bindings:[{name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fixture'},
  {name:'RELAY_AGENTS_ENABLED',type:'plain_text',text:'false'},
  {name:'UNRELATED',type:'plain_text',text:'fictional-private-value'},
  {name:'EXISTING_SECRET',type:'secret_text'}]};
const enabled={bindings:[...settings.bindings,{name:flag,type:'plain_text',text:'true'}]};

test('the only permitted binding delta is the exact Lucy discovery string, with every other binding retained',()=>{
  const original=structuredClone(settings);
  assert.equal(expectedLucyDiscoverySettings(settings),settingsDigest(enabled));
  assert.deepEqual(settings,original,'must not mutate or export provider settings');
  const disabled={bindings:[...settings.bindings,{name:flag,type:'plain_text',text:'false'}]};
  assert.equal(expectedLucyDiscoverySettings(disabled),settingsDigest(enabled));
  for(const mutate of [s=>s.bindings[0].namespace_id='other',s=>s.bindings[1].text='true',
    s=>s.bindings[2].text='changed',s=>s.bindings.pop(),s=>s.bindings.push({name:'NEW_FLAG',type:'plain_text',text:'true'})]){
    const changed=structuredClone(settings);mutate(changed);
    assert.notEqual(expectedLucyDiscoverySettings(changed),expectedLucyDiscoverySettings(settings));
  }
  for(const binding of [{name:flag,type:'secret_text'},{name:flag,type:'plain_text',text:'TRUE'},
    {name:flag,type:'plain_text',text:true},{name:flag,type:'plain_text',text:'false',extra:true}])assert.throws(()=>expectedLucyDiscoverySettings({bindings:[...settings.bindings,binding]}));
  assert.throws(()=>expectedLucyDiscoverySettings({bindings:[...enabled.bindings,enabled.bindings.at(-1)]}));
});

test('activation requires the pinned live Worker and settings, never a caller-selected baseline',()=>{
  assert.doesNotThrow(()=>checkedLucyDiscoveryBaseline({...LUCY_DISCOVERY_BASELINE}));
  for(const changed of [{...LUCY_DISCOVERY_BASELINE,version:'12345678-1234-1234-1234-123456789abc'},
    {...LUCY_DISCOVERY_BASELINE,settingsDigest:'a'.repeat(64)}, {...LUCY_DISCOVERY_BASELINE,extra:true}])
    assert.throws(()=>checkedLucyDiscoveryBaseline(changed));
  assert.throws(()=>planLucyDiscoverySettings(settings,{version:LUCY_DISCOVERY_BASELINE.version,settingsDigest:settingsDigest(settings)}));
  assert.throws(()=>planLucyDiscoverySettings(settings,LUCY_DISCOVERY_BASELINE),'second provider read must match the identity read');
  const live={version:'12345678-1234-1234-1234-123456789abc',settingsDigest:settingsDigest(enabled)};
  assert.deepEqual(planLucyDiscoverySettings(enabled,live),{kind:'unchanged',expectedSettingsDigest:live.settingsDigest});
});

test('recording requires the exact expected digest, and unchanged releases retain strict equality',()=>{
  const before={live:{...LUCY_DISCOVERY_BASELINE},proof:{reuse:false},
    settingsTransition:{kind:'lucy-oauth-discovery',expectedSettingsDigest:settingsDigest(enabled)}};
  assert.equal(checkedLucyDiscoveryCheckpoint(before),settingsDigest(enabled));
  for(const mutate of [b=>b.live.version='12345678-1234-1234-1234-123456789abc',b=>b.live.settingsDigest='a'.repeat(64),
    b=>b.proof.reuse=true,b=>b.settingsTransition.kind='allow-settings-change',b=>b.settingsTransition.flag='RELAY_AGENTS_ENABLED',
    b=>b.settingsTransition.expectedSettingsDigest=b.live.settingsDigest]){
    const changed=structuredClone(before);mutate(changed);assert.throws(()=>checkedLucyDiscoveryCheckpoint(changed));
  }
  const unchanged={live:{settingsDigest:settingsDigest(enabled)},settingsTransition:{kind:'unchanged',expectedSettingsDigest:settingsDigest(enabled)}};
  assert.equal(checkedLucyDiscoveryCheckpoint(unchanged),settingsDigest(enabled));
  unchanged.settingsTransition.expectedSettingsDigest='b'.repeat(64);assert.throws(()=>checkedLucyDiscoveryCheckpoint(unchanged));
});
