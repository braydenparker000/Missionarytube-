import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, readdir, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ownerGateClassification, ownerGateIsOff} from './relay-owner-gate.mjs';
import {readWorkerSettings, workerBindingsPreflight} from './check-music-worker-bindings.mjs';

const flag = text => ({name:'RELAY_OWNER_ENABLED',type:'plain_text',text});
const hubs = {name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fixture-namespace'};
const settings = (...bindings) => ({bindings:[hubs,...bindings]});
const account = 'a'.repeat(32), token = 'fixture-token-not-a-credential';
const response = result => ({ok:true,json:async () => ({success:true,result})});

test('only an absent flag or exact plain-text false passes the gate', () => {
  for (const [input,expected] of [[settings(),'absent'],[settings(flag('false')),'false'],[settings(flag('true')),'enabled']]) {
    assert.equal(ownerGateClassification(input),expected);
    assert.equal(ownerGateIsOff(expected),expected !== 'enabled');
  }
  for (const state of ['invalid','true',false,null,undefined]) assert.equal(ownerGateIsOff(state),false);
});

test('unexpected flag values, types, duplicate names and malformed settings fail closed', () => {
  for (const value of ['FALSE','True',' false','false ','','0','1',false,true,null,0,1,{},[]])
    assert.equal(ownerGateClassification(settings(flag(value))),'invalid');
  for (const type of ['secret_text','json',undefined])
    assert.equal(ownerGateClassification(settings({...flag('false'),type})),'invalid');
  for (const input of [settings(flag('false'),flag('false')),settings(flag('false'),flag('true')),null,{}, {bindings:{}}, {bindings:null}])
    assert.equal(ownerGateClassification(input),'invalid');
  assert.equal(ownerGateClassification(settings({...flag('true'),name:'RELAY_OWNER_ENABLED_OTHER'})),'absent');
});

test('unrelated variable/secret values are never accessed or returned', async () => {
  const unread = (name,type) => Object.defineProperty({name,type},'text',{get(){assert.fail('Unrelated value accessed');}});
  const input = settings(unread('OTHER','plain_text'),unread('SECRET','secret_text'),flag('false'));
  assert.equal(ownerGateClassification(input),'false');
  assert.deepEqual(await workerBindingsPreflight({account,token,ownerGate:true,fetcher:async () => response(input)}),
    {classification:'false',allowed:true});
  const duplicate = unread('RELAY_OWNER_ENABLED','plain_text');
  assert.equal(ownerGateClassification(settings(duplicate,duplicate)),'invalid');
  assert.equal(ownerGateClassification(settings(unread('RELAY_OWNER_ENABLED','secret_text'))),'invalid');
});

test('sealed provider access makes one fixed GET with redirect rejection and no body', async () => {
  let calls = 0;
  const result = await readWorkerSettings({account,token,fetcher:async (url,init) => {
    calls++;
    assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`);
    assert.equal(init.method,'GET');
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.Authorization,`Bearer ${token}`);
    assert.equal(init.body,undefined);
    assert.ok(init.signal instanceof AbortSignal);
    return response(settings(flag('false')));
  }});
  assert.equal(calls,1);
  assert.equal(ownerGateClassification(result),'false');
});

test('credential, HTTP, API, schema and transport failures do not become off-state proof', async () => {
  for (const input of [{account:'wrong',token},{account,token:''},{account,token:123}])
    await assert.rejects(readWorkerSettings({...input,fetcher:async () => assert.fail('Unexpected provider request')}));
  const failures = [
    async () => ({ok:false,json(){assert.fail('HTTP error body accessed');}}),
    async () => ({ok:true,json:async () => ({success:false,result:settings()})}),
    async () => ({ok:true,json:async () => ({success:'true',result:settings()})}),
    async () => ({ok:true,json:async () => ({success:true,result:{}})}),
    async () => {throw Error('Fixture transport failure');},
  ];
  for (const fetcher of failures) await assert.rejects(workerBindingsPreflight({account,token,ownerGate:true,fetcher}));
  await assert.rejects(workerBindingsPreflight({account,token,ownerGate:true,
    fetcher:async () => response({bindings:[...settings().bindings,{name:'OTHER',type:'r2_bucket',bucket_name:'other'}]})}));
});

test('ordinary binding metadata remains sanitized and preserves its existing contract', async () => {
  const result = await workerBindingsPreflight({account,token,
    fetcher:async () => response(settings({name:'SECRET',type:'secret_text',text:'fixture-value'},flag('false')))});
  assert.deepEqual(result.bindings,[hubs,{name:'SECRET',type:'secret_text'},{name:'RELAY_OWNER_ENABLED',type:'plain_text'}]);
  assert.ok(!JSON.stringify(result).includes('fixture-value'));
  assert.ok(!JSON.stringify(result).includes('"text"'));
});

test('owner-gate CLI emits only one classification, exits closed and writes no artifacts', async () => {
  const run = promisify(execFile), cwd = await mkdtemp(join(tmpdir(),'relay-owner-gate-fixture-'));
  const script = fileURLToPath(new URL('./check-music-worker-bindings.mjs',import.meta.url));
  try {
    for (const [bindings,expected,allowed] of [[settings(),'absent',true],[settings(flag('false')),'false',true],
      [settings(flag('true')),'enabled',false],[settings(flag('unexpected')),'invalid',false]]) {
      const hook = 'globalThis.fetch = async () => new Response('+JSON.stringify(JSON.stringify({success:true,result:bindings}))+');';
      const args = ['--import','data:text/javascript;base64,'+Buffer.from(hook).toString('base64'),script,'--owner-gate'];
      let result;
      try {result = await run(process.execPath,args,{cwd,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:token}});
        assert.equal(allowed,true);
      } catch (error) {assert.equal(allowed,false);assert.equal(error.code,1);result = error;}
      assert.equal(result.stdout,expected+'\n');assert.equal(result.stderr,'');
      assert.deepEqual(await readdir(cwd),[]);
    }
  } finally {await rm(cwd,{recursive:true,force:true});}
});

test('validation workflow is branch/PR-only, pinned, dependency-free and GET-only', async () => {
  const flow = await readFile(new URL('../.github/workflows/validate-relay-owner-gate.yml',import.meta.url),'utf8');
  assert.match(flow,/branches: \[fix\/relay-owner-gate-preflight\]/);
  assert.match(flow,/\n  pull_request:/);
  assert.doesNotMatch(flow,/workflow_dispatch:|pull_request_target:|\n  schedule:|branches:.*main/);
  assert.match(flow,/permissions:\n  contents: read/);
  assert.doesNotMatch(flow,/id-token:|contents: write|actions: write|wrangler-action|azure\/login|upload-artifact|npm (?:ci|install)|--var|--secrets-file/);
  assert.match(flow,/github\.actor_id == '183016859'/);
  assert.match(flow,/github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(flow,/github\.event\.pull_request\.head\.ref == 'fix\/relay-owner-gate-preflight'/);
  assert.equal([...flow.matchAll(/uses: ([^\n]+)/g)].length,4);
  for (const match of flow.matchAll(/uses: ([^\n]+)/g)) assert.match(match[1],/^actions\/(?:checkout|setup-node)@[a-f0-9]{40} # v7\./);
  assert.equal([...flow.matchAll(/persist-credentials: false/g)].length,2);
  assert.match(flow,/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(flow,/CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.R2_ACCOUNT_ID \}\}/);
  assert.match(flow,/run: node scripts\/check-music-worker-bindings\.mjs --owner-gate/);
  assert.match(flow,/group: relay-owner-gate-preflight\n      cancel-in-progress: false/);
  assert.doesNotMatch(flow,/group: (?:jarvis-worker-production|azure-production)/);
});

test('guard files avoid the existing Azure production push paths', async () => {
  const flow = await readFile(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8');
  const push = flow.slice(flow.indexOf('  push:'),flow.indexOf('\npermissions:'));
  const globs = [...push.matchAll(/^      - "([^"]+)"$/gm)].map(match => match[1]);
  assert.ok(globs.includes('tests/**'));assert.ok(globs.includes('jarvis-release.json'));
  const pattern = glob => new RegExp('^'+glob.split(/(\*\*|\*)/).map(part => part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('')+'$');
  for (const path of ['scripts/check-music-worker-bindings.mjs','scripts/relay-owner-gate.mjs','scripts/relay-owner-gate.test.mjs','.github/workflows/validate-relay-owner-gate.yml'])
    for (const glob of globs) assert.ok(!pattern(glob).test(path),`${path} must not match ${glob}`);
});
