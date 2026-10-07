import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import * as esbuild from 'esbuild';
import {backendInputIdentity,checkedReuse} from '../scripts/worker-release-identity.mjs';

async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'worker-closure-'));
  const files={
    '.gitignore':'backend/wrangler.music.generated.json\n',
    'package.json':'{"type":"module"}', 'package-lock.json':'{"lockfileVersion":3}',
    'backend/worker.js':"import {value} from './module.js'; export default {fetch(){return new Response(value)}};",
    'backend/module.js':"import {value} from '../public/shared.js'; import data from '../public/content.json' with {type:'json'}; export {value}; export const other=data;",
    'backend/wrangler.jsonc':'{"main":"worker.js"}',
    'public/shared.js':"export {value} from './nested.js';",
    'public/nested.js':"export const value='qualified';",
    'public/content.json':'{"public":"qualified"}',
    'public/unrelated.js':"export const value='unrelated frontend';"
  };
  for(const [name,value] of Object.entries(files)){await mkdir(join(root,name,'..'),{recursive:true});await writeFile(join(root,name),value);}
  const git=(...args)=>execFileSync('git',['-C',root,...args],{stdio:'pipe'});
  git('init');git('add','.');git('-c','user.name=Worker fixture','-c','user.email=fixture@example.test','commit','-m','fixture');
  await writeFile(join(root,'backend/wrangler.music.generated.json'),' {"main":"worker.js"}');
  const identity=()=>backendInputIdentity(root,{bundler:esbuild});
  const change=async(path,value)=>{await writeFile(join(root,path),value);git('add',path);git('-c','user.name=Worker fixture','-c','user.email=fixture@example.test','commit','-m','new qualified input');};
  return {root,git,identity,change,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('actual bundler metadata binds transitive public modules, JSON and resolver manifests',async()=>{
  const f=await fixture();try{
    const before=f.identity();assert.equal(before.reusable,true);assert.equal(before.bundled,true);
    for(const path of ['public/shared.js','public/nested.js','public/content.json','package.json','package-lock.json'])assert.ok(before.inputs.some(item=>item.path===path));
    assert.ok(!before.inputs.some(item=>item.path==='public/unrelated.js'));
    const expected=esbuild.buildSync({absWorkingDir:f.root,entryPoints:['backend/worker.js'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',target:'es2022',logLevel:'silent',external:['cloudflare:workers','node:*']});
    assert.equal(before.bundleSha256,createHash('sha256').update(expected.outputFiles[0].contents).digest('hex'),'Digest seals actual bundle bytes, not their JSON serialization');
    await f.change('public/nested.js',"export const value='new qualified value';");assert.notDeepEqual(f.identity(),before);
  }finally{await f.cleanup();}
});
test('every imported shared input and resolver change invalidates identity; unrelated frontend stays reusable',async()=>{
  for(const [path,value] of [['public/shared.js',"export const value='shared edit';"],['public/content.json','{"public":"changed"}'],['package.json','{"type":"module","browser":{}}'],['package-lock.json','{"lockfileVersion":3,"packages":{}}']]){
    const f=await fixture();try{const before=f.identity();await f.change(path,value);assert.notDeepEqual(f.identity(),before);}finally{await f.cleanup();}
  }
  const f=await fixture();try{const before=f.identity();await f.change('public/unrelated.js',"export const value='new frontend only';");assert.deepEqual(f.identity(),before);}finally{await f.cleanup();}
});
test('unknown, literal dynamic and unresolved dynamic imports cannot authorize Worker reuse',async()=>{
  for(const body of ["export const load=()=>import('../public/nested.js');", "export const load=name=>import(name);", "export const load=name=>import /*comment*/ (name);", "import value from 'unknown-fixture-package';export default value;"]){
    const f=await fixture();try{await f.change('backend/worker.js',body);assert.equal(f.identity().reusable,false);}finally{await f.cleanup();}
  }
});
test('unsupported external builtins force fresh deployment; reviewed Worker builtins remain bound',async()=>{
  const f=await fixture();try{
    await f.change('backend/worker.js',"import {scrypt} from 'node:crypto';export {scrypt};");assert.equal(f.identity().reusable,true);
    await f.change('backend/worker.js',"import fs from 'node:fs';export {fs};");assert.equal(f.identity().reusable,false);
  }finally{await f.cleanup();}
});
test('unsupported Wrangler build, alias, rules, assets and additional-module semantics force fresh publication',async()=>{
  for(const [key,value] of [['build',{command:'fixture build'}],['alias',{'fixture':'./public/other.js'}],['rules',[]],['assets',{directory:'public'}],['site',{bucket:'public'}],['find_additional_modules',true],['no_bundle',true],['unknown_future_option',true]]){
    const f=await fixture();try{await writeFile(join(f.root,'backend/wrangler.music.generated.json'),JSON.stringify({main:'worker.js',[key]:value}));assert.equal(f.identity().reusable,false,key);}finally{await f.cleanup();}
  }
});
test('package conditional resolvers and aliased dynamic-code references cannot authorize a skip',async()=>{
  for(const key of ['imports','exports','browser','main','module']){
    const f=await fixture();try{await f.change('package.json',JSON.stringify({type:'module',[key]:{}}));assert.equal(f.identity().reusable,false,key);}finally{await f.cleanup();}
  }
  for(const code of ["const run=eval;export {run};","const Factory=Function;export {Factory};"]){
    const f=await fixture();try{await f.change('backend/worker.js',code);assert.equal(f.identity().reusable,false);}finally{await f.cleanup();}
  }
});
test('compiler and nested package resolver files are bound and conservatively invalidate reuse',async()=>{
  for(const path of ['tsconfig.json','jsconfig.json','public/tsconfig.json','public/package.json']){
    const f=await fixture();try{await f.change(path,'{}');const result=f.identity();assert.equal(result.reusable,false);assert.ok(result.inputs.some(input=>input.path===path));}finally{await f.cleanup();}
  }
});
test('untracked compiler/resolver configs and imported application modules are rejected before upload',async()=>{
  for(const path of ['tsconfig.json','public/jsconfig.json','public/package.json']){
    const f=await fixture();try{await writeFile(join(f.root,path),'{ invalid config');assert.throws(f.identity,/not qualified/);}finally{await f.cleanup();}
  }
  const f=await fixture();try{
    await f.change('backend/worker.js',"import value from '../public/untracked.js';export default value;");
    await writeFile(join(f.root,'public/untracked.js'),"export default 'not qualified';");assert.throws(f.identity,/not qualified/);
  }finally{await f.cleanup();}
});
test('modified or mode-changed source after qualification is rejected instead of redeployed as qualified',async()=>{
  const f=await fixture();try{
    await writeFile(join(f.root,'public/nested.js'),"export const value='unqualified';");assert.throws(f.identity,/differs from/);
    f.git('add','public/nested.js');assert.throws(f.identity,/differs from/);
  }finally{await f.cleanup();}
});
test('real immutable source closure includes all known bundled public dependencies',()=>{
  const actual=backendInputIdentity(resolve('.jarvis-source'),{bundler:esbuild,workerConfig:JSON.parse(execFileSync('git',['-C','.jarvis-source','show','HEAD:backend/wrangler.jsonc'],{encoding:'utf8'}))});
  assert.equal(actual.reusable,true);assert.equal(actual.bundled,true);
  for(const path of ['public/drawercast/audio-analysis.js','public/drawercast/r2-library.js','public/drawercast/r2-api.js','public/content/jarvis.json','package.json','package-lock.json'])assert.ok(actual.inputs.some(item=>item.path===path));
});
test('non-reusable closure flag cannot satisfy even an otherwise matching prior receipt',()=>{
  assert.throws(()=>checkedReuse({schema:1,backendReusable:false},{backendReusable:true},{},null,null,null),/does not match/);
  assert.throws(()=>checkedReuse({schema:1,backendReusable:true},{backendReusable:false},{},null,null,null),/does not match/);
});
