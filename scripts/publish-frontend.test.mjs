import test from 'node:test';
import assert from 'node:assert/strict';
import {checkedFiles,checkedRun,checkedReceipt,checkedBaseline,publish,restore,sha} from './publish-frontend.mjs';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileManifest} from './qualified-artifact.mjs';

const bytes=path=>Buffer.from(path);
const file=(path,text=path)=>({path,sha256:sha(bytes(text)),bytes:bytes(text).length});
const properties={contentSettings:{contentType:'text/plain',cacheControl:'no-cache',contentMd5:'retained-md5'}};
function fixture({adoption=false}={}){
 const old=[file('assets/app.js','old app'),file('index.html','old page'),file('release.json','old release')];
 const next=[file('index.html','new page'),file('assets/app.js','new app'),file('assets/new.js','dependency'),file('release.json','new release')];
 const parent=adoption?null:{files:old};
 const candidate={commit:'a'.repeat(40),files:adoption?[old[0],old[1],next[3]]:next};
 const store=new Map(old.map((f,i)=>[f.path,{...f,exists:true,etag:'old-'+i,properties:structuredClone(properties),metadata:{reviewed:'kept'},file:'before-'+i}]));
 const paths=[...new Set([...old,...candidate.files].map(f=>f.path))].sort();
 const before=paths.map((path,i)=>({...structuredClone(store.get(path)||{path,exists:false}),...(store.has(path)?{file:'before-'+i}:{})}));
 const saved={candidate,parent,before},uploads=[],reads=[];
 const snapshot=async path=>structuredClone(store.get(path)||{path,exists:false});
 const upload=async(f,prior)=>{assert.equal(prior.etag,store.get(f.path)?.etag);uploads.push(f.path);store.set(f.path,{...f,exists:true,etag:'new-'+uploads.length,properties:structuredClone(properties),metadata:{reviewed:'kept'}});};
 const publicRead=async(path,hash,size)=>{const current=store.get(path);assert.equal(current.sha256,hash);assert.equal(current.bytes,size);reads.push(path);};
 return {saved,store,uploads,reads,snapshot,upload,publicRead,candidate:async()=>structuredClone(candidate),readBefore:async old=>bytes(old.path==='assets/app.js'?'old app':old.path==='index.html'?'old page':'old release')};
}
test('first adoption accepts only already deployed runtime bytes; protected paths never enter manifests',()=>{
 const h=fixture({adoption:true});assert.equal(checkedBaseline(h.saved.candidate,h.saved.before,null),true);
 for(const mutation of [h=>h.saved.before[0].sha256='0'.repeat(64),h=>h.saved.before[0].exists=false]){
  const h=fixture({adoption:true});mutation(h);assert.throws(()=>checkedBaseline(h.saved.candidate,h.saved.before,null));
 }
 for(const path of ['../escape','/index.html','a//b','assets/drive-config.json','assets/quick-ai-config.json','content/jarvis.json','drawercast/catalog/current.json','assets/drive-catalog-v2.json','assets/drive-catalog-v2/covers/cover.webp'])assert.throws(()=>checkedFiles([file(path)]));
 assert.throws(()=>checkedFiles([file('index.html'),file('index.html')]));
});
test('only trusted successful main workflow receipts establish a baseline',()=>{
 const run={id:12,repository:{full_name:'braydenparker000/Missionarytube-'},head_repository:{full_name:'braydenparker000/Missionarytube-'},path:'.github/workflows/deploy-azure-storage.yml',head_branch:'main',head_sha:'a'.repeat(40),event:'workflow_dispatch',status:'completed',conclusion:'success'};
 const receipt={schema:1,kind:'frontend',runId:'12',commit:run.head_sha,action:'publish',files:[file('index.html')],workerChanged:false,dataChanged:false};
 checkedReceipt(receipt,run);
 for(const patch of [{head_branch:'feature'},{event:'pull_request'},{conclusion:'failure'},{path:'.github/workflows/other.yml'},{repository:{full_name:'foreign/repo'}}])assert.throws(()=>checkedRun({...run,...patch},'12'));
 for(const patch of [{runId:'13'},{commit:'b'.repeat(40)},{workerChanged:true},{dataChanged:true}])assert.throws(()=>checkedReceipt({...receipt,...patch},run));
 checkedRun({...run,conclusion:'failure'},'12',{rollback:true});
});
test('first-release adoption accepts an existing private publication hash but normal receipts never fall back to it',async()=>{
 const pins=JSON.parse(await readFile(new URL('private-board-pins.json',import.meta.url)));
 const prior=pins.dependencies.find(f=>f.path==='mast/index.html');
 const candidate={files:[file(prior.path,'reviewed document policy repair')]};
 const before=[{...prior,exists:true,bytes:4153}];
 assert.equal(checkedBaseline(candidate,before,null),true);
 assert.throws(()=>checkedBaseline(candidate,[{...before[0],sha256:'0'.repeat(64)}],null));
 assert.throws(()=>checkedBaseline(candidate,before,{files:candidate.files}),'a known legacy hash cannot replace a newer successful normal receipt');
});
test('publication writes dependencies before documents and release metadata; verifies every uploaded byte',async()=>{
 const h=fixture();await publish(h.saved,h);
 assert.deepEqual(h.uploads,['assets/new.js','assets/app.js','index.html','release.json']);
 assert.deepEqual(h.reads,h.uploads);
 assert.deepEqual(h.store.get('index.html').properties,properties);
});
test('adoption changes metadata only and leaves all existing runtime blobs untouched',async()=>{
 const h=fixture({adoption:true});await publish(h.saved,h);assert.deepEqual(h.uploads,['release.json']);
});
test('unknown baseline bytes, missing files and unexpected new paths fail before the first upload',async()=>{
 for(const change of [h=>h.saved.before[0].sha256='0'.repeat(64),h=>h.saved.before[0].exists=false,h=>h.saved.before.find(f=>!f.exists).exists=true]){
  const h=fixture();change(h);await assert.rejects(publish(h.saved,h));assert.deepEqual(h.uploads,[]);
 }
});
test('a race anywhere in the baseline or a rebuilt candidate prevents the first upload',async()=>{
 for(const change of [h=>h.store.get('release.json').etag='foreign',h=>h.candidate=async()=>({...h.saved.candidate,commit:'b'.repeat(40)})]){
  const h=fixture();change(h);await assert.rejects(publish(h.saved,h));assert.deepEqual(h.uploads,[]);
 }
});
test('an object created after preflight cannot be overwritten',async()=>{
 const h=fixture(),read=h.snapshot;let calls=0;
 h.snapshot=async(path,...args)=>{if(++calls===h.saved.before.length+1)h.store.set('assets/new.js',{...file('assets/new.js','foreign'),exists:true,etag:'foreign'});return read(path,...args);};
 await assert.rejects(publish(h.saved,h));assert.ok(!h.uploads.includes('assets/new.js'));
});
test('rollback checks every saved byte and current object before restoring anything',async()=>{
 for(const change of [h=>h.readBefore=async()=>bytes('corrupt'),h=>h.store.get('release.json').sha256='0'.repeat(64),h=>h.store.get('release.json').properties.contentSettings.cacheControl='foreign']){
  const h=fixture();await publish(h.saved,h);h.uploads.length=0;change(h);
  await assert.rejects(restore(h.saved,h));assert.deepEqual(h.uploads,[]);
 }
});
test('rollback restores old pages and headers while retaining new immutable dependencies',async()=>{
 const h=fixture();await publish(h.saved,h);h.uploads.length=0;
 await restore(h.saved,h);
 assert.deepEqual(h.uploads,['release.json','index.html','assets/app.js']);
 assert.equal(h.store.get('index.html').sha256,sha(bytes('old page')));
 assert.equal(h.store.get('assets/new.js').sha256,sha(bytes('dependency')));
 assert.deepEqual(h.store.get('index.html').properties,properties);
});
test('an interrupted publication can restore accepted files without requiring absent new dependencies',async()=>{
 const h=fixture();h.store.set('index.html',{...h.store.get('index.html'),...file('index.html','new page')});
 await restore(h.saved,h);assert.deepEqual(h.uploads,['index.html']);assert.equal(h.store.has('assets/new.js'),false);
});

test('the actual CLI adopts, updates and rolls back through conditional Azure commands without touching configured values',async t=>{
 const root=await mkdtemp(join(tmpdir(),'frontend-publisher-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const p of ['scripts','frontend/assets','.runtime-parent','bin'])await mkdir(join(root,p),{recursive:true});
 for(const name of ['publish-frontend.mjs','publish-daily-board.mjs','daily-board-navigation.mjs','frontend-source.mjs','qualified-artifact.mjs','inspect-frontend.mjs','check-jarvis-import.mjs','build-jarvis.mjs','r2-player-config.mjs','private-board-pins.json'])await cp(new URL(name,import.meta.url),join(root,'scripts',name));
 await writeFile(join(root,'package.json'),'{"type":"module"}');
 await writeFile(join(root,'jarvis-release.json'),JSON.stringify({repository:'braydenparker999/jarvis',commit:'a'.repeat(40)}));
 await writeFile(join(root,'frontend/index.html'),`<html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'"></head><body>Fixture</body></html>`);
 await writeFile(join(root,'frontend/assets/app.js'),'old application');
 await writeFile(join(root,'frontend/assets/drive-config.json'),'placeholder');
 await writeFile(join(root,'.gitignore'),'dist/\n.runtime-parent/\n.runtime-release/\nstore.json\ntrace.json\nmock.mjs\nbin/\n');
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:'pipe'}).trim();
 const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','fixture');return git('rev-parse','HEAD');};
 git('init');let head=commit();
 const run=(script,args=[],env={})=>execFileSync(process.execPath,[script,...args],{cwd:root,encoding:'utf8',stdio:'pipe',env:{...process.env,...env}});
 run('scripts/build-jarvis.mjs');
 const store={};
 for(const f of await fileManifest(join(root,'dist'))){const data=f.path==='release.json'?Buffer.from('historical release'):await readFile(join(root,'dist',f.path));store[f.path]={body:data.toString('base64'),etag:'original-'+f.path,properties:{contentSettings:{contentType:'text/plain',cacheControl:'no-cache'}},metadata:{retained:'yes'}};}
 store['assets/drive-config.json'].body=Buffer.from('provider-owned configuration').toString('base64');
 await writeFile(join(root,'store.json'),JSON.stringify(store));await writeFile(join(root,'trace.json'),'[]');
 await writeFile(join(root,'bin/az'),`#!/usr/bin/env node
import {readFileSync,writeFileSync,copyFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const args=process.argv.slice(2),op=args[2],get=k=>args[args.indexOf(k)+1],has=k=>args.includes(k);
const store=JSON.parse(readFileSync('store.json')),trace=JSON.parse(readFileSync('trace.json')),path=has('--name')?get('--name'):null,old=store[path];
const fail=()=>{process.exitCode=1;throw Error('Fixture conditional request refused');};
const row=(path,v)=>({path,etag:v.etag,bytes:Buffer.from(v.body,'base64').length,properties:v.properties,metadata:v.metadata});
let result={};
if(op==='list')result=Object.entries(store).map(([p,v])=>row(p,v)).map(v=>get('--query').includes('properties:properties')?v:({path:v.path,etag:v.etag,bytes:v.bytes}));
else if(op==='exists')result={exists:!!old};
else if(op==='show'){if(!old)fail();result={properties:{...old.properties,etag:old.etag,contentLength:Buffer.from(old.body,'base64').length},metadata:old.metadata};}
else if(op==='download'){if(!old||get('--if-match')!==old.etag)fail();writeFileSync(get('--file'),Buffer.from(old.body,'base64'));}
else if(op==='upload'){
 if(old?get('--if-match')!==old.etag:!has('--if-none-match')||get('--if-none-match')!=='*')fail();
 const bytes=readFileSync(get('--file')),settings={};
 for(const [key,flag] of Object.entries({contentType:'--content-type',cacheControl:'--content-cache-control',contentDisposition:'--content-disposition',contentEncoding:'--content-encoding',contentLanguage:'--content-language'}))settings[key]=has(flag)?get(flag):'';
 settings.contentMd5=createHash('md5').update(bytes).digest('base64');if(has('--content-md5')&&get('--content-md5')!==settings.contentMd5)fail();
 const metadata={};if(has('--metadata'))for(let i=args.indexOf('--metadata')+1;i<args.length&&!args[i].startsWith('--');i++){const [k,...v]=args[i].split('=');metadata[k]=v.join('=');}
 store[path]={body:bytes.toString('base64'),etag:'written-'+(trace.length+1),properties:{contentSettings:settings},metadata};trace.push(path);
 writeFileSync('store.json',JSON.stringify(store));writeFileSync('trace.json',JSON.stringify(trace));result={etag:store[path].etag};
}else if(op==='update'){
 if(!old||get('--if-match')!==old.etag)fail();
 delete old.properties.contentSettings.contentMd5;old.etag+='-properties';writeFileSync('store.json',JSON.stringify(store));
}else fail();
process.stdout.write(JSON.stringify(result));
`,{mode:0o755});
 await writeFile(join(root,'mock.mjs'),`import {readFileSync} from 'node:fs';globalThis.fetch=async(url,options)=>{if(!String(url).startsWith('https://missionarytube.z13.web.core.windows.net/'))throw Error('Unexpected fixture request');const path=new URL(url).pathname.slice(1);if(path==='assets/drive-config.json')throw Error('Configuration must not be fetched');const item=JSON.parse(readFileSync('store.json'))[path];return new Response(item?Buffer.from(item.body,'base64'):null,{status:item?200:404});};`);
 const env={PATH:join(root,'bin')+':'+process.env.PATH,NODE_OPTIONS:'--import='+join(root,'mock.mjs'),FRONTEND_EXPECTED_COMMIT:head,GITHUB_SHA:head,GITHUB_RUN_ID:'101'};
 const cli=mode=>run('scripts/publish-frontend.mjs',[mode],env);
 await writeFile(join(root,'.runtime-parent/run.json'),'null');cli('prepare');cli('publish');
 const first=JSON.parse(await readFile(join(root,'.runtime-release/receipt.json')));
 assert.deepEqual(JSON.parse(await readFile(join(root,'trace.json'))),['release.json']);
 await writeFile(join(root,'frontend/assets/app.js'),'updated application');head=commit();env.FRONTEND_EXPECTED_COMMIT=head;env.GITHUB_SHA=head;env.GITHUB_RUN_ID='102';run('scripts/build-jarvis.mjs');
 const runRecord={id:101,repository:{full_name:'braydenparker000/Missionarytube-'},head_repository:{full_name:'braydenparker000/Missionarytube-'},path:'.github/workflows/deploy-azure-storage.yml',head_branch:'main',head_sha:first.commit,event:'workflow_dispatch',status:'completed',conclusion:'success'};
 await mkdir(join(root,'.runtime-parent/evidence'));await writeFile(join(root,'.runtime-parent/run.json'),JSON.stringify(runRecord));await writeFile(join(root,'.runtime-parent/evidence/receipt.json'),JSON.stringify(first));
 cli('prepare');cli('publish');
 const updated=JSON.parse(await readFile(join(root,'store.json')));assert.equal(Buffer.from(updated['assets/app.js'].body,'base64').toString(),'updated application');
 assert.equal(Buffer.from(updated['assets/drive-config.json'].body,'base64').toString(),'provider-owned configuration');assert.deepEqual(updated['assets/app.js'].metadata,{retained:'yes'});
 await writeFile(join(root,'.runtime-parent/run.json'),JSON.stringify({...runRecord,id:102,head_sha:head,conclusion:'failure'}));env.FRONTEND_ROLLBACK_RUN_ID='102';env.GITHUB_RUN_ID='103';cli('rollback');
 const restored=JSON.parse(await readFile(join(root,'store.json')));assert.equal(Buffer.from(restored['assets/app.js'].body,'base64').toString(),'old application');assert.equal(restored['assets/drive-config.json'].etag,store['assets/drive-config.json'].etag);
 assert.equal(JSON.parse(await readFile(join(root,'.runtime-release/receipt.json'))).action,'rollback');
});
