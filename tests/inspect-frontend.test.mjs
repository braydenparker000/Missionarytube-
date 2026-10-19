import test from 'node:test';
import assert from 'node:assert/strict';
import{mkdtemp,mkdir,writeFile,rm,symlink}from'node:fs/promises';
import{tmpdir}from'node:os';import{join}from'node:path';
import{inspectFrontend,ORIGIN}from'../scripts/inspect-frontend.mjs';

test('runtime inspection is GET-only, records actual differences and never fetches configured values or data',async t=>{
 const root=await mkdtemp(join(tmpdir(),'frontend-inspection-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const path of ['assets/drive-config.json','assets/quick-ai-config.json','content/jarvis.json','drawercast/catalog/current.json','assets/drive-catalog-v2.json','assets/drive-catalog-v2/covers/cover.webp','release.json','same.js','changed.js','missing.js','unavailable.js']){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),'candidate');}
 const reads=[];
 const report=await inspectFrontend(root,{fetcher:async(url,options)=>{
  reads.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');assert.ok(!options.headers);
  if(url.endsWith('unavailable.js'))throw Error('sensitive provider response');
  if(url.endsWith('missing.js'))return new Response('not retained',{status:404});
  return new Response(url.endsWith('same.js')?'candidate':'live');
 }});
 assert.deepEqual(reads.sort(),['changed.js','missing.js','same.js','unavailable.js'].map(p=>ORIGIN+'/'+p));
 assert.equal(report.matched,1);assert.equal(report.files.find(f=>f.path==='changed.js').matched,false);
 assert.equal(report.files.find(f=>f.path==='missing.js').status,404);assert.equal(report.files.find(f=>f.path==='unavailable.js').status,'unavailable');
 assert.ok(!JSON.stringify(report).includes('sensitive provider response'));assert.ok(!JSON.stringify(report).includes('not retained'));
 await symlink(join(root,'same.js'),join(root,'alias.js'));await assert.rejects(()=>inspectFrontend(root),/symlinks/);
});
test('component inspection keeps the fixed public origin and refuses escaping prefixes',async t=>{
 const root=await mkdtemp(join(tmpdir(),'music-inspection-'));t.after(()=>rm(root,{recursive:true,force:true}));await writeFile(join(root,'player.js'),'candidate');
 const report=await inspectFrontend(root,{prefix:'drawercast/',fetcher:async url=>{assert.equal(url,ORIGIN+'/drawercast/player.js');return new Response('candidate');}});
 assert.equal(report.matched,1);assert.equal(report.files[0].path,'drawercast/player.js');
 for(const prefix of ['../','/drawercast/','https://wrong.invalid/'])await assert.rejects(inspectFrontend(root,{prefix}),/Invalid runtime path prefix/);
});

test('publication inspection verifies restored bytes independently of newer editable filenames',async()=>{
 const {inspectRuntimeFiles}=await import('../scripts/inspect-frontend.mjs');
 const {createHash}=await import('node:crypto');
 const f={path:'drawercast/player.previous.js',bytes:8,sha256:createHash('sha256').update('restored').digest('hex')};
 const result=await inspectRuntimeFiles([f],{fetcher:async url=>{assert.equal(url,ORIGIN+'/'+f.path);return new Response('restored');}});
 assert.equal(result.matched,1);
 for(const path of ['../escape.js','https://wrong.invalid/','assets/drive-config.json','drawercast/catalog/owner.json'])await assert.rejects(inspectRuntimeFiles([{...f,path}]),/Invalid runtime file/);
 const flow=await import('node:fs/promises').then(fs=>fs.readFile('.github/workflows/verify-music-sources.yml','utf8'));
 assert.doesNotMatch(flow,/\n  push:/);assert.match(flow,/MUSIC_PUBLICATION_RECEIPT:/);assert.match(flow,/frontend-evidence-/);
});
