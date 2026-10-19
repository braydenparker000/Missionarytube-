import test from 'node:test';
import assert from 'node:assert/strict';
import{mkdtemp,mkdir,writeFile,rm,symlink}from'node:fs/promises';
import{tmpdir}from'node:os';import{join}from'node:path';
import{inspectFrontend,ORIGIN}from'../scripts/inspect-frontend.mjs';

test('runtime inspection is GET-only, records actual differences and never fetches configured values or data',async t=>{
 const root=await mkdtemp(join(tmpdir(),'frontend-inspection-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const path of ['assets/drive-config.json','assets/quick-ai-config.json','content/jarvis.json','drawercast/catalog/current.json','release.json','same.js','changed.js','missing.js','unavailable.js']){await mkdir(join(root,path,'..'),{recursive:true});await writeFile(join(root,path),'candidate');}
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
