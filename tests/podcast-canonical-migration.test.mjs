import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';
import {readTree,sha256,mimeFor} from '../scripts/static-publication.mjs';
import {podcastCanonicalContract,derivedPodcastView,migratePodcastCanonical,qualifyCanonicalChain,LocalMigrationStore,PODCAST_PAIR,PODCAST_ORDER} from '../scripts/podcast-canonical-migration.mjs';
let workspace,raw,candidate,contract;const source=resolve('.jarvis-source'),trees=[];
const binding={sourcePair:{previous:PODCAST_PAIR.previous,candidate:PODCAST_PAIR.candidate},artifactSha256:PODCAST_PAIR.artifactSha256};
const run=(file,args,options={})=>execFileSync(file,args,{timeout:30000,maxBuffer:2*1024*1024,...options});
before(async()=>{
 workspace=await mkdtemp(join(tmpdir(),'exact-podcast-migration-'));
 const release=JSON.parse(await readFile('jarvis-release.json','utf8'));
 for(const [name,commit] of [['raw',PODCAST_PAIR.previous],['candidate',PODCAST_PAIR.candidate]]){
  const tree=join(workspace,name+'-source'),build=join(workspace,name);run('git',['-C',source,'worktree','add','--detach',tree,commit],{stdio:'pipe'});trees.push(tree);
  await mkdir(join(build,'scripts'),{recursive:true});for(const path of ['scripts/build-jarvis.mjs','scripts/r2-player-config.mjs'])await copyFile(path,join(build,path));
  await writeFile(join(build,'jarvis-release.json'),JSON.stringify({...release,commit}));await symlink(tree,join(build,'.jarvis-source'),'dir');run(process.execPath,['scripts/build-jarvis.mjs'],{cwd:build});
 }
 raw=await readTree(join(workspace,'raw/dist'));candidate=await readTree(join(workspace,'candidate/dist'));contract=podcastCanonicalContract(raw,candidate,binding);
});
after(async()=>{for(const tree of trees)run('git',['-C',source,'worktree','remove','--force',tree]);if(workspace)await rm(workspace,{recursive:true,force:true});});

test('exact raw174→explicit175→candidate179 chain retains all original publication and pointer gates',async()=>{
 const result=await qualifyCanonicalChain(contract,{loader:await readFile('scripts/static-release-loader.js'),recipe:sha256('fictional-local-test'),rawProof:{kind:'reproduced-original-artifact'},candidateProof:{kind:'local-ed7-build'}});
 assert.equal(result.interruptions,8);assert.equal(result.refusals,4);assert.equal(result.defaultRawPairRefused,true);assert.equal(result.mainPromotionAndRollbackPassed,true);assert.equal(result.securityCanonicalRetained,true);assert.equal(result.perActionApprovalRefusals,8);assert.equal(result.missingHostedPairRefused,true);assert.equal(raw.size,174);assert.equal(candidate.size,179);assert.equal(derivedPodcastView(contract).size,175);assert.equal(raw.has('podcasts/directory.js'),false);
});
test('unsupported exact identity, raw/target closure, mutable envelopes and forged contracts refuse',async()=>{
 for(const path of ['podcasts/core.js','assets/config.js','podcasts/sw.js','index.html']){const altered=new Map(candidate);altered.set(path,Buffer.from('changed'));assert.throws(()=>podcastCanonicalContract(raw,altered,binding));}
 const altered=new Map(raw);altered.set('podcasts/app.js',Buffer.from('changed'));assert.throws(()=>podcastCanonicalContract(altered,candidate,binding));
 for(const bad of [{...binding,artifactSha256:'0'.repeat(64)},{...binding,sourcePair:{...binding.sourcePair,candidate:'0'.repeat(40)}}])assert.throws(()=>podcastCanonicalContract(raw,candidate,bad));
 assert.ok(Object.isFrozen(contract.envelope.delta));assert.throws(()=>contract.envelope.delta.push({}));
 await assert.rejects(migratePodcastCanonical({...contract},new LocalMigrationStore(raw),{guard:async()=>{}}),/Unrecognized/);
});
test('same-target concurrent ETag replacement refuses and a lost commit resumes from bytes',async()=>{
 const store=new LocalMigrationStore(raw),guard=async()=>{};store.raceLocal(PODCAST_ORDER[0]);
 await assert.rejects(migratePodcastCanonical(contract,store,{guard}),/Conditional/);assert.equal(store.writes.length,0);
 const identical=new LocalMigrationStore(raw);await identical.put(PODCAST_ORDER[0],candidate.get(PODCAST_ORDER[0]),mimeFor(PODCAST_ORDER[0]),{ifNoneMatch:'*'});identical.raceLocal(PODCAST_ORDER[1]);
 await assert.rejects(migratePodcastCanonical(contract,identical,{guard}),/Conditional/);assert.equal(identical.writes.length,1);
 let callbacks=0;await assert.rejects(migratePodcastCanonical(contract,{get(){callbacks++;},put(){callbacks++;}},{guard:async()=>{callbacks++;}}),/fictional local store/);assert.equal(callbacks,0);
 const branded=new LocalMigrationStore(raw);branded.get=branded.put=()=>{throw Error('Foreign adapter must never run');};assert.equal((await migratePodcastCanonical(contract,branded,{guard})).completed,true);
 const lost=new LocalMigrationStore(raw);lost.stop=2;lost.after=true;await assert.rejects(migratePodcastCanonical(contract,lost,{guard}),/after commit/);lost.stop=Infinity;assert.equal((await migratePodcastCanonical(contract,lost,{guard})).writes,1);assert.deepEqual(lost.writes,PODCAST_ORDER);
});
test('accepted directory remains data-only, bounded, credential-free and abortable',async()=>{
 const directory=await import('data:text/javascript;base64,'+candidate.get('podcasts/directory.js').toString('base64')),requests=[];
 const valid={results:[{collectionName:'Fictional show',feedUrl:'https://example.test/feed',collectionId:1,artistName:'Fixture'}]};
 const result=await directory.clientDirectory('fictional','us',undefined,async(url,init)=>{requests.push({url,init});return Response.json(valid);});
 assert.equal(result.shows.length,1);assert.equal(requests.length,1);for(const {url,init} of requests){assert.equal(new URL(url).searchParams.has('callback'),false);assert.equal(init.credentials,'omit');assert.equal(init.redirect,'error');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.mode,'cors');}
 globalThis.__podcastExecuted=false;await assert.rejects(directory.clientDirectory('x','us',undefined,async()=>new Response('globalThis.__podcastExecuted=true;callback({})',{headers:{'Content-Type':'text/javascript'}})));assert.equal(globalThis.__podcastExecuted,false);
 await assert.rejects(directory.clientDirectory('x','us',undefined,async()=>new Response('x'.repeat(1024*1024+1))));
 const controller=new AbortController();controller.abort();let calls=0;await assert.rejects(directory.clientDirectory('x','us',controller.signal,async()=>{calls++;return Response.json(valid);}));assert.equal(calls,0);delete globalThis.__podcastExecuted;
});
test('actual canonical mixed-shell migration completes SWv2→v3 with offline audio/art/storage and security layer retained',async()=>{
 const store=new LocalMigrationStore(raw),requests=[],errors=[];let online=true,unexpected=0;
 const server=createServer(async(req,res)=>{const url=new URL(req.url,'http://localhost');let path=url.pathname.slice(1);if(!path||path.endsWith('/'))path+='index.html';requests.push(path);if(!online){res.destroy();return;}const value=await store.get(path);if(!value){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':value.contentType,'Cache-Control':'no-store'});res.end(value.bytes);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
  const chrome=process.env.JARVIS_CHROME||run('sh',['-c','command -v google-chrome || command -v chromium'],{encoding:'utf8'}).trim();browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-background-networking']});assert.equal(browser.version(),'154.0.8037.97');
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const origin='http://127.0.0.1:'+server.address().port,page=await context.newPage(),externalFixtures=[];
  const dataDirectory=await import('data:text/javascript;base64,'+candidate.get('podcasts/directory.js').toString('base64'));
  const endpointPaths=dataDirectory.appleDirectoryURLs('fictional','us').map(value=>{const u=new URL(value);return u.origin+u.pathname;});
  const apiOrigin=(await import('data:text/javascript;base64,'+candidate.get('assets/config.js').toString('base64'))).API_ORIGIN;
  await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();if(route.request().method()!=='GET'||!((url.origin===apiOrigin&&['/podcasts/browse','/podcasts/search'].includes(url.pathname))||endpointPaths.includes(url.origin+url.pathname))){unexpected++;return route.abort();}externalFixtures.push({endpoint:url.origin+url.pathname,type:route.request().resourceType()});const callback=url.searchParams.get('callback');if(callback){assert.match(callback,/^__jarvis_podcast_[a-z0-9]+$/);return route.fulfill({status:200,contentType:'text/javascript',body:callback+'({results:[]})'});}return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify({shows:[]})});});
  page.on('pageerror',e=>errors.push(e.message));await page.goto(origin+'/podcasts/');await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.waitForFunction(async()=>(await caches.keys()).includes('jarvis-podcast-shell-v2'));
  await page.evaluate(async()=>{localStorage.setItem('jarvis.notes.v1','fictional-note');const core=await import('/podcasts/core.js');await core.saveFeed({show:{feedUrl:'https://example.test/fictional-feed'},episodes:[]});const audio=await caches.open('jarvis-podcast-audio-v1');await audio.put('/podcasts/offline/fictional',new Response(new Uint8Array([1,2,3,4,5]),{headers:{'Content-Type':'audio/mpeg'}}));const art=await caches.open('jarvis-podcast-art-v1');await art.put('/fictional-art',new Response('fictional-art'));});
  // Interrupt after each forward write while v2 remains active. Dependency is
  // always supplied before its importer; a premature offline module fetch may
  // fail closed and is not claimed to be an offline-ready completed migration.
  for(let stop=0;stop<3;stop++){
   store.stop=store.writes.length;store.after=true;await assert.rejects(migratePodcastCanonical(contract,store,{guard:async()=>{}}),/after commit/);
   await page.reload({waitUntil:'domcontentloaded'});await page.locator('#query').waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('jarvis.notes.v1')),'fictional-note');
   assert.ok((await page.evaluate(()=>caches.keys())).includes('jarvis-podcast-shell-v2'));assert.equal(requests.includes('podcasts/directory.js'),stop>0);
   if(stop===1){online=false;await context.setOffline(true);const interrupted=await page.evaluate(async()=>{let dependency;try{await fetch('/podcasts/directory.js',{cache:'no-store'});dependency=true;}catch{dependency=false;}const audio=await fetch('/podcasts/offline/fictional',{headers:{Range:'bytes=1-3'}});return {dependency,audio:audio.status};});assert.deepEqual(interrupted,{dependency:false,audio:206});await context.setOffline(false);online=true;}

  }
  store.stop=Infinity;await migratePodcastCanonical(contract,store,{guard:async()=>{}});await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration('/podcasts/');await r.update();});
  await page.waitForFunction(async()=>{const keys=await caches.keys();const r=await navigator.serviceWorker.getRegistration('/podcasts/'),cache=await caches.open('jarvis-podcast-shell-v3');return keys.includes('jarvis-podcast-shell-v3')&&!keys.includes('jarvis-podcast-shell-v2')&&r.active?.state==='activated'&&r.active===navigator.serviceWorker.controller&&!r.installing&&!r.waiting&&(await cache.keys()).length>=9;});await page.reload({waitUntil:'domcontentloaded'});await page.locator('#query').waitFor();
  online=false;await context.setOffline(true);await page.reload({waitUntil:'domcontentloaded'});await page.locator('#query').waitFor();await page.waitForFunction(()=>document.querySelector('#results').hasAttribute('aria-busy'));
  assert.equal(await page.evaluate(async()=>typeof(await import('/podcasts/directory.js')).clientDirectory),'function');
  const retained=await page.evaluate(async()=>{const r=await fetch('/podcasts/offline/fictional',{headers:{Range:'bytes=1-3'}}),core=await import('/podcasts/core.js');return {status:r.status,range:r.headers.get('Content-Range'),audio:[...new Uint8Array(await r.arrayBuffer())],art:await(await(await caches.open('jarvis-podcast-art-v1')).match('/fictional-art')).text(),feed:await core.storedFeed('https://example.test/fictional-feed'),note:localStorage.getItem('jarvis.notes.v1'),keys:await caches.keys(),app:(await(await(await caches.open('jarvis-podcast-shell-v3')).match('/podcasts/app.js?v=20261009')).text()).includes("./directory.js")};});
  assert.equal(retained.status,206);assert.equal(retained.range,'bytes 1-3/5');assert.deepEqual(retained.audio,[2,3,4]);assert.equal(retained.art,'fictional-art');assert.equal(retained.feed.show.feedUrl,'https://example.test/fictional-feed');assert.equal(retained.note,'fictional-note');assert.equal(retained.app,true);assert.ok(retained.keys.includes('jarvis-podcast-audio-v1'));assert.ok(retained.keys.includes('jarvis-podcast-art-v1'));assert.equal(retained.keys.includes('jarvis-podcast-shell-v2'),false);assert.deepEqual(errors,[]);assert.equal(unexpected,0);assert.ok(externalFixtures.length>0);assert.ok(externalFixtures.every(value=>endpointPaths.includes(value.endpoint)||value.endpoint.startsWith(apiOrigin+'/podcasts/')));
  // Main rollback does not touch this canonical shell; compare exact bytes.
  for(const path of PODCAST_ORDER)assert.deepEqual((await store.get(path)).bytes,candidate.get(path));await context.close();
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
