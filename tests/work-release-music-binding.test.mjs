import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedMusicBindingPreservation} from '../scripts/check-work-release-music-binding.mjs';
import {preservedConfig} from '../scripts/deploy-private-wake.mjs';

const source = () => ({name:'jarvis-hub-api',main:'worker.js',keep_vars:true,
  durable_objects:{bindings:[{name:'HUBS',class_name:'Hub'}]},
  vars:{RELAY_MAST_WORK_ENABLED:'true'}});
const settings = () => ({bindings:[
  {name:'HUBS',type:'durable_object_namespace',class_name:'Hub',namespace_id:'fixture'},
  {name:'MUSIC_R2',type:'r2_bucket',bucket_name:'jarvis-music'},
  {name:'PRIVATE',type:'secret_text'}]});

test('actual chat/tasks config generator preserves existing music without activating Work',()=>{
  const live=settings(), input=source(), config=preservedConfig(input);
  const before=structuredClone({live,input,config});
  checkedMusicBindingPreservation(live,config);
  assert.deepEqual(config.r2_buckets,[{binding:'MUSIC_R2',bucket_name:'jarvis-music'}]);
  assert.deepEqual(config.vars,{});
  assert.deepEqual({live,input,config},before);
  Object.defineProperty(live.bindings[2],'text',{get(){throw Error('secret accessed');}});
  checkedMusicBindingPreservation(live,config);
});

test('keep_vars alone and missing, duplicated or changed R2 configuration fail before upload',()=>{
  assert.throws(()=>checkedMusicBindingPreservation(settings(),source()));
  for (const mutate of [
    c=>delete c.r2_buckets, c=>c.r2_buckets=[],
    c=>c.r2_buckets.push({...c.r2_buckets[0]}),
    c=>c.r2_buckets[0].binding='OTHER', c=>c.r2_buckets[0].bucket_name='other',
    c=>c.r2_buckets[0].jurisdiction='eu', c=>c.r2_buckets[0].remote=true,
    c=>c.r2_buckets[0].preview_bucket_name='other',
    c=>c.r2_buckets.push({binding:'NEW',bucket_name:'other'}),
    c=>c.keep_vars=false, c=>c.name='other-worker',
    c=>c.vars.RELAY_MAST_WORK_ENABLED='true', c=>c.env={production:{}},
  ]) {
    const config=preservedConfig(source());mutate(config);
    assert.throws(()=>checkedMusicBindingPreservation(settings(),config));
  }
});

test('absent or different live music binding cannot be turned into new access',()=>{
  for (const mutate of [
    s=>s.bindings.splice(1,1), s=>s.bindings.push({...s.bindings[1]}),
    s=>s.bindings[1].type='plain_text', s=>s.bindings[1].bucket_name='other',
    s=>s.bindings[1].jurisdiction='eu',
  ]) {
    const live=settings();mutate(live);
    assert.throws(()=>checkedMusicBindingPreservation(live,preservedConfig(source())));
  }
  const live=settings(),config=preservedConfig(source());
  live.bindings[1].jurisdiction='eu';config.r2_buckets[0].jurisdiction='eu';
  checkedMusicBindingPreservation(live,config);
});

test('chat/tasks pre-upload checkpoint validates the same generated config it records',()=>{
  const script=readFileSync(new URL('../scripts/publish-simple-chat-tasks.mjs',import.meta.url),'utf8');
  const checkpoint=script.slice(script.indexOf("if(command==='checkpoint')"),script.indexOf("const c=await local(OUT+'/checkpoint.json')"));
  assert.match(checkpoint,/const config=await local\(resolve\(ROOT,'backend\/wrangler\.music\.generated\.json'\)\);checkedMusicBindingPreservation\(settings,config\)/);
  assert.match(checkpoint,/canonicalDigest\(\{closure,config,wrangler:/);
  const workflow=readFileSync(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8').split('  simple-chat-tasks:')[1];
  const gate=workflow.indexOf('node scripts/publish-simple-chat-tasks.mjs checkpoint');
  const upload=workflow.indexOf('npx wrangler deploy --config');
  assert.ok(gate>=0&&upload>gate);
  assert.match(workflow.slice(upload,upload+160),/wrangler\.music\.generated\.json/);
});
