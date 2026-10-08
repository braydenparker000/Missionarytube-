import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, mkdtemp, readdir, rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {MUSE_RAW_KEY_SHA256, publicKeySummary, diagnoseMusePublicKey} from './diagnose-muse-public-key.mjs';

const key = '0123456789abcdef'.repeat(4), otherKey = 'fedcba9876543210'.repeat(4);
const rawFingerprint = createHash('sha256').update(Buffer.from(key,'hex')).digest('hex');
const textFingerprint = createHash('sha256').update(key).digest('hex');
const account = 'a'.repeat(32), token = 'fixture-bearer-must-never-appear';
const hidden = 'fixture-private-value-must-never-appear';
const binding = text => ({name:'MUSIC_UPLOAD_PUBLIC_KEYS',type:'plain_text',text});
const settings = (...bindings) => ({bindings});
const response = result => ({ok:true,json:async () => ({success:true,result})});
const unknown = (blocker, binding_present = null) => ({binding_present, parsed_public_key_count:null,
  raw_fingerprint_match:null, blocker});

test('matching hashes the exact 32 raw bytes, not the hex text, and counts allowlist entries', () => {
  assert.equal(MUSE_RAW_KEY_SHA256,'9bad5445d83597de67f864295b464616c3c00cfcfa42ce17241c4e85a4c437fd');
  assert.notEqual(rawFingerprint,textFingerprint);
  assert.deepEqual(publicKeySummary(settings(binding(JSON.stringify([otherKey,key]))),rawFingerprint),
    {binding_present:true,parsed_public_key_count:2,raw_fingerprint_match:true});
  assert.deepEqual(publicKeySummary(settings(binding(JSON.stringify([key]))),textFingerprint),
    {binding_present:true,parsed_public_key_count:1,raw_fingerprint_match:false});
  assert.deepEqual(publicKeySummary(settings(binding(JSON.stringify([otherKey]))),rawFingerprint),
    {binding_present:true,parsed_public_key_count:1,raw_fingerprint_match:false});
  assert.deepEqual(publicKeySummary(settings(binding(JSON.stringify(Array(8).fill(key)))),rawFingerprint),
    {binding_present:true,parsed_public_key_count:8,raw_fingerprint_match:true});
});

test('only a successful complete settings read proves an absent or empty allowlist', () => {
  for (const input of [settings(),settings({...binding('[]'),name:'MUSIC_UPLOAD_PUBLIC_KEYS_OTHER'})])
    assert.deepEqual(publicKeySummary(input),{binding_present:false,parsed_public_key_count:0,raw_fingerprint_match:false});
  for (const text of ['[]','', '  []  '])
    assert.deepEqual(publicKeySummary(settings(binding(text))),
      {binding_present:true,parsed_public_key_count:0,raw_fingerprint_match:false});
  for (const input of [null,{}, {bindings:null},{bindings:{}}, {bindings:undefined},settings(null),settings({foo:'bar'}),
    settings({type:'plain_text'}),settings({name:'OTHER'}),settings({name:'',type:'plain_text'}),settings({name:'OTHER',type:''})])
    assert.deepEqual(publicKeySummary(input),unknown('invalid_settings_response'));
});

test('malformed, oversized, duplicate or unavailable bindings never report a membership verdict', () => {
  for (const text of ['invalid-json', ' ', '{}', 'null', 'false', '[null]', JSON.stringify([key.toUpperCase()]),
    JSON.stringify([key.slice(2)]),JSON.stringify([key+'00']),JSON.stringify(Array(9).fill(key))])
    assert.deepEqual(publicKeySummary(settings(binding(text)),rawFingerprint),unknown('invalid_public_key_binding',true));
  for (const value of [null,undefined,0,[],{}])
    assert.deepEqual(publicKeySummary(settings(binding(value))),unknown('invalid_public_key_binding',true));
  assert.deepEqual(publicKeySummary(settings(binding('[]'),binding('[]'))),unknown('duplicate_public_key_binding',true));
  assert.deepEqual(publicKeySummary(settings({...binding('[]'),type:'json'})),unknown('invalid_public_key_binding',true));
  const secret = Object.defineProperty({...binding(''),type:'secret_text'},'text',{get(){assert.fail('Secret value accessed');}});
  assert.deepEqual(publicKeySummary(settings(secret)),unknown('public_key_binding_value_unavailable',true));
});

test('unrelated variable and secret values are never inspected or returned', async () => {
  const unread = (name,type) => Object.defineProperty({name,type},'text',{get(){assert.fail('Unrelated value accessed');}});
  const input = settings(unread('OTHER','plain_text'),unread('SECRET','secret_text'),binding(JSON.stringify([key])));
  const result = await diagnoseMusePublicKey({account,token,fetcher:async () => response(input)});
  assert.deepEqual(result,{binding_present:true,parsed_public_key_count:1,raw_fingerprint_match:false});
  const serialized = JSON.stringify(result);
  for (const value of [key,otherKey,account,token,hidden,'OTHER','SECRET','text','Authorization'])
    assert.ok(!serialized.includes(value));
});

test('provider access makes exactly one fixed GET, rejects redirects, and has no request body', async () => {
  let calls = 0;
  const result = await diagnoseMusePublicKey({account,token,fetcher:async (url,init) => {
    calls++;
    assert.equal(url,`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`);
    assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
    assert.deepEqual(init.headers,{Authorization:`Bearer ${token}`});
    assert.equal(init.body,undefined);assert.ok(init.signal instanceof AbortSignal);
    return response(settings(binding('[]')));
  }});
  assert.equal(calls,1);
  assert.deepEqual(result,{binding_present:true,parsed_public_key_count:0,raw_fingerprint_match:false});
});

test('credential failures stop before fetch and expose only fixed configuration blockers', async () => {
  for (const [input,blocker] of [
    [{account:undefined,token},'missing_r2_account_id'],[{account:'invalid-'+hidden,token},'invalid_r2_account_id'],
    [{account,token:undefined},'missing_cloudflare_api_token'],[{account,token:123},'missing_cloudflare_api_token'],
  ]) assert.deepEqual(await diagnoseMusePublicKey({...input,fetcher:async () => assert.fail('Unexpected provider call')}),unknown(blocker));
});

test('HTTP, API, JSON and transport failures redact provider messages and preserve unknown match', async () => {
  for (const [status,blocker] of [[401,'cloudflare_authentication_failed'],[403,'cloudflare_settings_read_forbidden'],
    [404,'cloudflare_worker_settings_not_found'],[429,'cloudflare_settings_http_failure'],[500,'cloudflare_settings_http_failure']]) {
    const result = await diagnoseMusePublicKey({account,token,fetcher:async () => ({ok:false,status,
      json(){assert.fail('HTTP error body accessed');},text(){assert.fail('HTTP error body accessed');}})});
    assert.deepEqual(result,unknown(blocker));
  }
  for (const [fetcher,blocker] of [
    [async () => {throw Error(token+' '+hidden);},'cloudflare_transport_failure'],
    [async () => ({ok:true,json:async () => {throw Error(token+' '+hidden);}}),'cloudflare_response_unreadable'],
    [async () => ({ok:true,json:async () => ({success:false,errors:[{message:token+' '+hidden}],result:settings()})}),'cloudflare_settings_api_failure'],
    [async () => ({ok:true,json:async () => ({success:'true',result:settings()})}),'cloudflare_settings_api_failure'],
    [async () => response({}) ,'invalid_settings_response'],
  ]) {
    const result = await diagnoseMusePublicKey({account,token,fetcher});
    assert.deepEqual(result,unknown(blocker));
    assert.ok(!JSON.stringify(result).includes(token));assert.ok(!JSON.stringify(result).includes(hidden));
  }
});

test('CLI emits one bounded result, redacts injected failures, and writes no artifacts', async () => {
  const run = promisify(execFile), cwd = await mkdtemp(join(tmpdir(),'muse-public-key-fixture-'));
  const script = fileURLToPath(new URL('./diagnose-muse-public-key.mjs',import.meta.url));
  try {
    const fixtures = [
      ['globalThis.fetch = async () => new Response('+JSON.stringify(JSON.stringify({success:true,result:settings(binding(JSON.stringify([key])),{name:'OTHER',type:'plain_text',text:hidden})}))+');',
        {binding_present:true,parsed_public_key_count:1,raw_fingerprint_match:false},0],
      ['globalThis.fetch = async () => {throw Error('+JSON.stringify(token+' '+hidden)+');};',unknown('cloudflare_transport_failure'),1],
      ['globalThis.fetch = async () => ({ok:true,json:async () => {throw Error('+JSON.stringify(token+' '+hidden)+');}});',unknown('cloudflare_response_unreadable'),1],
      ['globalThis.fetch = async () => new Response('+JSON.stringify(token+' '+hidden)+',{status:403});',unknown('cloudflare_settings_read_forbidden'),1],
      ['globalThis.fetch = async () => new Response('+JSON.stringify(JSON.stringify({success:true,result:settings({...binding(''),type:'secret_text',text:hidden})}))+');',unknown('public_key_binding_value_unavailable',true),1],
    ];
    for (const [hook,expected,code] of fixtures) {
      const args = ['--import','data:text/javascript;base64,'+Buffer.from(hook).toString('base64'),script];
      let result;
      try {result = await run(process.execPath,args,{cwd,env:{CLOUDFLARE_ACCOUNT_ID:account,CLOUDFLARE_API_TOKEN:token}});assert.equal(code,0);}
      catch (error) {assert.equal(error.code,code);assert.notEqual(code,0);result = error;}
      assert.equal(result.stdout,JSON.stringify(expected)+'\n');assert.equal(result.stderr,'');
      for (const value of [key,otherKey,account,token,hidden]) assert.ok(!result.stdout.includes(value));
      assert.deepEqual(await readdir(cwd),[]);
    }
    await assert.rejects(run(process.execPath,[script,'--worker='+hidden],{cwd,env:{}}), error => {
      assert.equal(error.code,1);assert.equal(error.stdout,JSON.stringify(unknown('unexpected_diagnostic_arguments'))+'\n');
      assert.equal(error.stderr,'');return true;
    });
  } finally {await rm(cwd,{recursive:true,force:true});}
});

test('workflow has one isolated branch trigger and passes focused tests before using existing credentials', async () => {
  const flow = await readFile(new URL('../.github/workflows/diagnose-muse-public-key.yml',import.meta.url),'utf8');
  assert.match(flow,/branches: \[fix\/muse-upload-key-diagnostic-20261008\]/);
  assert.doesNotMatch(flow,/workflow_dispatch:|pull_request:|pull_request_target:|\n  schedule:|branches:.*main/);
  assert.match(flow,/permissions:\n  contents: read/);
  assert.doesNotMatch(flow,/id-token:|contents: write|actions: write|wrangler-action|azure\/login|upload-artifact|npm (?:ci|install)|--var|--secrets-file|set -x/);
  assert.match(flow,/needs: unit-validation/);
  assert.match(flow,/github\.repository == 'braydenparker000\/Missionarytube-'/);
  assert.match(flow,/github\.actor_id == '183016859'/);
  assert.match(flow,/github\.event_name == 'push'/);
  assert.match(flow,/github\.ref == 'refs\/heads\/fix\/muse-upload-key-diagnostic-20261008'/);
  assert.equal([...flow.matchAll(/uses: ([^\n]+)/g)].length,4);
  for (const match of flow.matchAll(/uses: ([^\n]+)/g)) assert.match(match[1],/^actions\/(?:checkout|setup-node)@[a-f0-9]{40} # v7\./);
  assert.equal([...flow.matchAll(/persist-credentials: false/g)].length,2);
  assert.match(flow,/CLOUDFLARE_API_TOKEN: \$\{\{ secrets\.CLOUDFLARE_API_TOKEN \}\}/);
  assert.match(flow,/CLOUDFLARE_ACCOUNT_ID: \$\{\{ secrets\.R2_ACCOUNT_ID \}\}/);
  assert.match(flow,/run: node scripts\/diagnose-muse-public-key\.mjs/);
  assert.match(flow,/group: muse-public-key-diagnostic\n      cancel-in-progress: false/);
  assert.doesNotMatch(flow,/group: (?:jarvis-worker-production|azure-production)/);
});

test('diagnostic paths are outside existing production push paths', async () => {
  const flow = await readFile(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8');
  const push = flow.slice(flow.indexOf('  push:'),flow.indexOf('\npermissions:'));
  const globs = [...push.matchAll(/^      - "([^"]+)"$/gm)].map(match => match[1]);
  assert.ok(globs.includes('tests/**'));assert.ok(globs.includes('jarvis-release.json'));
  const pattern = glob => new RegExp('^'+glob.split(/(\*\*|\*)/).map(part => part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('')+'$');
  for (const path of ['scripts/diagnose-muse-public-key.mjs','scripts/diagnose-muse-public-key.test.mjs','.github/workflows/diagnose-muse-public-key.yml'])
    for (const glob of globs) assert.ok(!pattern(glob).test(path),`${path} must not match ${glob}`);
});
