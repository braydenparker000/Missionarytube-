import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtemp,cp,writeFile,mkdir,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {createPodcastServer} from './helpers/podcasts-browser-fixture.mjs';

const chrome=[process.env.JARVIS_CHROME,process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
if(!chrome)throw Error('Podcasts browser checks require Chrome; set JARVIS_CHROME.');
let directory,built,baseline,browser;
const evidence=process.env.PODCAST_EVIDENCE_DIR;
before(async()=>{
  // Exercise the actual build recipe without mutating a concurrent root build.
  directory=await mkdtemp(join(tmpdir(),'podcasts-built-'));
  await mkdir(join(directory,'scripts'));
  await cp('frontend',join(directory,'frontend'),{recursive:true});
  for(const file of ['build-jarvis.mjs','frontend-source.mjs','source-tree.mjs','r2-player-config.mjs','private-board-pins.json'])await cp('scripts/'+file,join(directory,'scripts',file));
  await cp('jarvis-release.json',join(directory,'jarvis-release.json'));
  await writeFile(join(directory,'package.json'),'{"type":"module"}');
  const git=(...args)=>execFileSync('git',args,{cwd:directory,stdio:'pipe'});
  git('init');git('add','.');git('-c','user.name=Podcast fixture','-c','user.email=fixture@example.test','commit','-m','Isolated current frontend input');
  execFileSync(process.execPath,['scripts/build-jarvis.mjs'],{cwd:directory,stdio:'pipe'});built=join(directory,'dist');
  assert.equal(await readFile(join(built,'podcasts/app.js'),'utf8'),await readFile('frontend/podcasts/app.js','utf8'));
  // The previous v4 shell is test input from Git history, never an editable app
  // selector or a new manual release pin. CI's build checkout retains history.
  const commits=execFileSync('git',['log','-15','--format=%H','--','frontend/podcasts/sw.js'],{encoding:'utf8'}).trim().split('\n');
  let previous;
  for(const commit of commits){const sw=execFileSync('git',['show',commit+':frontend/podcasts/sw.js'],{encoding:'utf8'});if(sw.includes('jarvis-podcast-shell-v4')){previous=commit;break;}}
  assert.ok(previous,'Retain history for the actual previous offline shell');
  baseline=join(directory,'previous');await cp(built,baseline,{recursive:true});
  for(const name of ['index.html','app.js','style.css','sw.js'])await writeFile(join(baseline,'podcasts',name),execFileSync('git',['show',previous+':frontend/podcasts/'+name]));
  if(evidence)await mkdir(evidence,{recursive:true});
  browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-background-networking']});
});
after(async()=>{await browser?.close();if(directory)await rm(directory,{recursive:true,force:true});});
async function harness(t,{width=390,height=844,motion='reduce',upgrade=false,record=false}={}){
  const server=await createPodcastServer({root:built,...(upgrade?{baseline}:{})});t.after(()=>server.close());
  const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,reducedMotion:motion,...(record&&evidence?{recordVideo:{dir:evidence,size:{width,height}}}:{})});
  t.after(()=>context.close());
  // Public provider fallback is deliberately isolated; local fixture data wins.
  await context.route('**/*',route=>new URL(route.request().url()).origin===server.origin?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.setDefaultTimeout(7000);
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.podcastAudioLoads=0;window.podcastLongTasks=[];
    new PerformanceObserver(list=>window.podcastLongTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
    document.addEventListener('loadstart',e=>{if(e.target.tagName==='AUDIO')window.podcastAudioLoads++;},true);
  });
  await page.goto(server.origin+'/podcasts/');await page.locator('[data-feed]').first().waitFor();
  return {page,context,errors,...server};
}
const settle=async(page,id='player')=>page.waitForFunction(id=>document.getElementById(id).dataset.motion==='open',id);
async function show(page){await page.locator('[data-feed]').first().click();await page.locator('[data-details]').first().waitFor();}
async function listen(page){await page.locator('[data-play]').nth(1).click();await page.waitForFunction(()=>!document.querySelector('audio').paused&&document.querySelector('audio').currentTime>.15);}
async function audioSnapshot(page){return page.evaluate(()=>{const a=document.querySelector('audio');window.originalPodcastAudio??=a;return {same:a===window.originalPodcastAudio,count:document.querySelectorAll('audio').length,src:a.currentSrc,time:a.currentTime,paused:a.paused,rate:a.playbackRate,loads:window.podcastAudioLoads};});}
async function backLayer(page,id){await page.keyboard.press('Escape');await page.locator('#'+id).waitFor({state:'hidden'});}
async function touch(page,selector,steps,{hold=0,cancel=false}={}){
  const node=page.locator(selector).first();await node.scrollIntoViewIfNeeded();const r=await node.boundingBox(),x=r.x+r.width*.45,y=r.y+Math.min(r.height/2,40);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:1}]});
  if(hold)await page.waitForTimeout(hold);
  const samples=[];
  for(const [dx,dy] of steps){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x+dx,y:y+dy,id:1}]});await page.waitForTimeout(25);samples.push(await page.locator('#player').evaluate(n=>({motion:n.dataset.motion,y:getComputedStyle(n).transform==='none'?0:new DOMMatrixReadOnly(getComputedStyle(n).transform).m42})));}
  await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await cdp.detach();return samples;
}

test('built browse/details/play/player/nested Back journey preserves audio, focus and browsing state',async t=>{
  const h=await harness(t,{motion:'no-preference',record:true}),{page}=h;
  if(evidence)await page.context().tracing.start({screenshots:true,snapshots:true});
  await page.locator('#query').fill('Listening');await page.locator('#search-form').evaluate(n=>n.requestSubmit());await page.locator('.search-results').waitFor();
  await page.evaluate(()=>scrollTo(0,350));const searchY=await page.evaluate(()=>scrollY);
  if(evidence)await page.screenshot({path:join(evidence,'discover.png')});
  await page.locator('[data-feed]').nth(3).click();await page.locator('[data-details]').first().waitFor();
  await page.locator('#episode-query').fill('room');await page.locator('#episode-sort').selectOption('oldest');
  await page.locator('#more-episodes').click();assert.equal(await page.locator('#episodes').getAttribute('data-visible-count'),'80');
  const row=page.locator('[data-details]').nth(3);await row.scrollIntoViewIfNeeded();
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const r=await row.boundingBox(),y=await page.evaluate(()=>scrollY);
  await page.touchscreen.tap(r.x+r.width/2,r.y+r.height/2);await settle(page,'sheet');assert.equal((await audioSnapshot(page)).paused,true,'Inspecting details never plays');
  await page.locator('#details-options').click();await settle(page,'sheet');
  await page.keyboard.press('Escape');await page.getByRole('button',{name:'More options',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'details-options');
  await page.locator('#details-play').click();await page.locator('#sheet').waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>.15);
  const initial=await audioSnapshot(page);assert.equal(initial.count,1);
  assert.ok(Math.abs((await page.evaluate(()=>scrollY))-y)<3,'Details close retains browsing scroll: '+JSON.stringify({before:y,after:await page.evaluate(()=>scrollY)}));
  if(evidence)await page.screenshot({path:join(evidence,'show.png')});
  await page.locator('#open-player').click();await settle(page);
  if(evidence)await page.screenshot({path:join(evidence,'player.png')});
  await page.locator('#speed').click();await settle(page,'sheet');await page.getByRole('button',{name:'1.5×',exact:true}).click();await page.locator('#sheet').waitFor({state:'hidden'});
  await page.locator('#sleep').click();await settle(page,'sheet');
  if(evidence)await page.screenshot({path:join(evidence,'sleep.png')});
  await page.getByRole('button',{name:'15 minutes',exact:true}).click();await page.locator('#sheet').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'sleep');
  await page.locator('#player-menu').click();await settle(page,'sheet');await page.goBack();await page.locator('#sheet').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>document.activeElement.id),'player-menu');
  await touch(page,'#player-heading',[[0,55],[0,20]]);await settle(page);
  await touch(page,'#player-heading',[[0,100],[0,220],[0,300]]);await page.locator('#player').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.activeElement.id),'open-player');
  assert.ok(Math.abs((await page.evaluate(()=>scrollY))-y)<3);
  assert.equal(await page.locator('#episode-query').inputValue(),'room');assert.equal(await page.locator('#episode-sort').inputValue(),'oldest');
  assert.equal(await page.locator('#episodes').getAttribute('data-visible-count'),'80');
  assert.match(await page.locator('#mini-sleep-label').textContent(),/^1[45]:/);
  const final=await audioSnapshot(page);assert.equal(final.src,initial.src);assert.equal(final.loads,initial.loads);assert.equal(final.same,true);assert.equal(final.paused,false);assert.equal(final.rate,1.5);assert.ok(final.time>initial.time);
  await page.goBack();await page.locator('.search-results').waitFor();assert.equal(await page.locator('#query').inputValue(),'Listening');
  assert.ok(Math.abs((await page.evaluate(()=>scrollY))-searchY)<3);
  if(evidence){await writeFile(join(evidence,'journey-metrics.json'),JSON.stringify({initial,final,longTasks:await page.evaluate(()=>window.podcastLongTasks)},null,2));await page.context().tracing.stop({path:join(evidence,'journey-trace.zip')});}
  assert.deepEqual(h.errors,[]);
});

test('touch holds share visible options, cancel for scrolling/second contact, and never activate through a sheet',async t=>{
  const {page,errors}=await harness(t);await show(page);
  await touch(page,'[data-details]',[],{hold:520});await settle(page,'sheet');
  const actions=await page.locator('#sheet .sheet-action').allTextContents();
  assert.equal(await page.locator('#sheet h3').count(),0,'Hold opens options, not details');assert.equal((await audioSnapshot(page)).paused,true);
  await backLayer(page,'sheet');
  await page.locator('[data-options]').first().click();await settle(page,'sheet');assert.deepEqual(await page.locator('#sheet .sheet-action').allTextContents(),actions);await backLayer(page,'sheet');
  await touch(page,'[data-details]',[[0,-40],[0,-90]],{hold:100});await page.waitForTimeout(500);
  assert.equal(await page.locator('dialog[open]').count(),0);assert.equal((await audioSnapshot(page)).paused,true);
  const first=page.locator('[data-details]').first();await first.scrollIntoViewIfNeeded();const box=await first.boundingBox(),cdp=await page.context().newCDPSession(page);
  const points=[{id:1,x:box.x+40,y:box.y+30},{id:2,x:box.x+80,y:box.y+40}];
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points.slice(0,1)});await page.waitForTimeout(120);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:points});await page.waitForTimeout(500);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();assert.equal(await page.locator('dialog[open]').count(),0);
  await touch(page,'[data-details]',[],{hold:100,cancel:true});await page.waitForTimeout(500);assert.equal(await page.locator('dialog[open]').count(),0);
  await page.locator('[data-play]').nth(1).click();await page.waitForFunction(()=>!document.querySelector('audio').paused);assert.equal(await page.locator('dialog[open]').count(),0);
  assert.deepEqual(errors,[]);
});

test('interrupted expansion, header drag reversal/cancellation and dismissal leave controls and audio live',async t=>{
  const {page,errors}=await harness(t,{motion:'no-preference'});await show(page);await listen(page);const initial=await audioSnapshot(page);
  await page.locator('#open-player').click();await page.locator('#close-player').evaluate(n=>n.click());await page.locator('#player').waitFor({state:'hidden'});
  await page.locator('#open-player').click();await settle(page);
  const samples=await touch(page,'#player-heading',[[0,55],[0,20]]);assert.equal(samples[0].motion,'dragging');assert.ok(Math.abs(samples[0].y-55)<2);assert.ok(Math.abs(samples[1].y-20)<2);await settle(page);assert.equal(await page.locator('#player').isVisible(),true);
  await touch(page,'#player-heading',[[0,80]],{cancel:true});await settle(page);
  await page.locator('.player-notes-disclosure summary').click();
  await touch(page,'#player-notes',[[0,-50],[0,-100]]);assert.ok(await page.locator('#player-notes').evaluate(n=>n.scrollTop)>0);assert.equal(await page.locator('#player').getAttribute('data-motion'),'open');
  await page.locator('#play').click();await page.locator('#play').click();assert.equal((await audioSnapshot(page)).paused,false,'Two intentional transport taps both register');
  await page.emulateMedia({reducedMotion:'reduce'});await page.emulateMedia({reducedMotion:'no-preference'});
  // Re-grab a closing surface: this is new intent, not a duplicate callback.
  await page.evaluate(()=>new Promise(done=>{
    addEventListener('popstate',()=>{for(const a of document.querySelector('#player').getAnimations({subtree:true})){a.currentTime=60;a.pause();}done();},{once:true});
    document.querySelector('#close-player').click();
  }));
  const grip=await page.locator('#player-heading').boundingBox(),cdp=await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x:grip.x+40,y:grip.y+10}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x:grip.x+40,y:grip.y-10}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await cdp.detach();await settle(page);
  await touch(page,'#player-heading',[[0,80],[0,180],[0,280]]);await page.locator('#player').waitFor({state:'hidden'});
  const final=await audioSnapshot(page);assert.equal(final.same,true);assert.equal(final.src,initial.src);assert.equal(final.loads,initial.loads);assert.equal(final.paused,false);assert.ok(final.time>initial.time);
  assert.equal(await page.locator('dialog[open]').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.id),'open-player');assert.equal(await page.evaluate(()=>document.documentElement.classList.contains('podcast-overlay-open')),false);assert.deepEqual(errors,[]);
});

for(const [width,height] of [[320,568],[360,640],[412,915],[740,360]])test(`built controls fit ${width}×${height}, with reduced motion and independent mini-player actions`,async t=>{
  const {page,errors}=await harness(t,{width,height});await show(page);await listen(page);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  const y=await page.evaluate(()=>scrollY);await page.locator('#mini-play').click();assert.equal((await audioSnapshot(page)).paused,true);
  await page.locator('#mini-play').click();await page.locator('#mini-back').click();assert.equal(await page.locator('#player').isVisible(),false);
  await page.locator('#mini-seek').focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#player').isVisible(),false);
  await page.locator('#mini-sleep').click();await settle(page,'sheet');await backLayer(page,'sheet');
  await page.locator('#open-player').click();await settle(page);
  const play=await page.locator('#play').boundingBox();assert.ok(play.width>=64&&play.height>=64);
  await page.locator('#play').scrollIntoViewIfNeeded();const rect=await page.locator('#play').boundingBox();assert.ok(rect.y>=0&&rect.y+rect.height<=height,JSON.stringify(rect));
  await page.locator('#close-player').click();await page.locator('#player').waitFor({state:'hidden'});assert.ok(Math.abs((await page.evaluate(()=>scrollY))-y)<3);
  assert.deepEqual(errors,[]);
});

test('previous controlled shell upgrades during playback; real downloaded audio, artwork and saved state survive offline reopen',async t=>{
  const {page,context,controls,errors}=await harness(t,{upgrade:true});
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await show(page);await listen(page);
  await page.locator('#follow-show').click();await page.locator('[data-download]').first().click();
  await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('jarvis.podcasts.v1')).downloads).length===1);
  await page.evaluate(async()=>{const c=await caches.open('jarvis-podcast-art-v1');await c.put('/podcasts-fixture/saved-art.svg',new Response('existing synthetic artwork'));});
  const before=await audioSnapshot(page);controls.old=false;
  await page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});
  await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.includes('jarvis-podcast-shell-v5')&&!keys.includes('jarvis-podcast-shell-v4');});
  const after=await audioSnapshot(page);assert.equal(after.same,true);assert.equal(after.src,before.src);assert.equal(after.loads,before.loads);assert.equal(after.paused,false);assert.ok(after.time>=before.time);
  await page.locator('#mini-seek').focus();await page.keyboard.press('Home');await page.keyboard.press('PageUp');await page.keyboard.press('PageUp');
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>30);
  await page.locator('#mini-play').click();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis.podcasts.v1')));
  await context.setOffline(true);await page.goto(page.url().split('#')[0]+'#downloads');await page.reload();
  await page.locator('[data-play]').first().waitFor();assert.equal(await page.locator('meta[name="podcasts-release"]').getAttribute('content'),'1.3.0');
  await page.locator('[data-play]').first().click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.15&&!document.querySelector('audio').paused);
  const position=Object.values(saved.progress)[0].position;assert.ok((await audioSnapshot(page)).time>=position,'Offline reopen resumes saved progress');
  await page.locator('#mini-seek').focus();await page.keyboard.press('ArrowRight');
  const state=await page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis.podcasts.v1')));
  assert.deepEqual(Object.keys(state.downloads),Object.keys(saved.downloads));assert.deepEqual(state.follows,saved.follows);
  assert.equal(await page.evaluate(async()=>{const r=await (await caches.open('jarvis-podcast-art-v1')).match('/podcasts-fixture/saved-art.svg');return r?.text();}),'existing synthetic artwork');
  assert.deepEqual(errors,[]);
});


test('new search intent wins and unavailable providers preserve retry input',async t=>{
  const {page,controls,requests,errors}=await harness(t);controls.delay=300;
  await page.locator('#query').fill('Earlier');await page.locator('#search-form').evaluate(n=>n.requestSubmit());
  await page.waitForFunction(()=>location.hash.includes('Earlier'));
  controls.delay=0;await page.locator('#query').fill('Current');await page.locator('#search-form').evaluate(n=>n.requestSubmit());
  await page.getByRole('heading',{name:'Results for “Current”'}).waitFor();await page.waitForTimeout(350);
  assert.equal(await page.locator('#query').inputValue(),'Current');assert.equal(await page.getByRole('heading',{name:'Results for “Earlier”'}).count(),0);
  controls.fail=true;await page.locator('#query').fill('Retry this');await page.locator('#search-form').evaluate(n=>n.requestSubmit());
  await page.getByRole('button',{name:'Try again',exact:true}).waitFor();assert.equal(await page.locator('#query').inputValue(),'Retry this');
  controls.fail=false;await page.getByRole('button',{name:'Try again',exact:true}).click();await page.getByRole('heading',{name:'Results for “Retry this”'}).waitFor();
  assert.ok(requests.some(r=>r.path==='/podcasts/search'));assert.deepEqual(errors,[]);
});

test('fallback without Web Animations and a mid-transition reduced-motion change retain operable layers',async t=>{
  const h=await harness(t,{motion:'no-preference'}),{page}=h;await show(page);await listen(page);
  await page.locator('#open-player').click();await page.emulateMedia({reducedMotion:'reduce'});await settle(page);await backLayer(page,'player');
  await page.evaluate(()=>{Element.prototype.animate=undefined;});await page.emulateMedia({reducedMotion:'no-preference'});
  await page.locator('#open-player').click();await settle(page);await page.locator('#sleep').click();await settle(page,'sheet');await backLayer(page,'sheet');await backLayer(page,'player');
  assert.equal((await audioSnapshot(page)).paused,false);assert.deepEqual(h.errors,[]);
});


test('library, queue ordering/played state, and cancelled/failed downloads retain existing actions',async t=>{
  const {page,controls,errors}=await harness(t);await show(page);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.locator('#follow-show').click();
  for(const index of [1,2]){await page.locator('[data-options]').nth(index).click();await page.getByRole('button',{name:'Add to queue',exact:true}).click();await page.locator('#sheet').waitFor({state:'hidden'});}
  await page.locator('[data-view="queue"]').click();assert.equal(await page.locator('.episode-row').count(),2);
  const second=await page.locator('[data-details]').nth(1).textContent();
  await page.locator('[data-options]').nth(1).click();await page.getByRole('button',{name:'Move to top of queue',exact:true}).click();await page.locator('#sheet').waitFor({state:'hidden'});
  assert.equal(await page.locator('[data-details]').first().textContent(),second);
  await page.locator('[data-options]').first().click();await page.getByRole('button',{name:'Mark played',exact:true}).click();await page.locator('#sheet').waitFor({state:'hidden'});assert.equal(await page.locator('.episode-row.played').count(),1);
  await page.locator('[data-view="library"]').click();assert.equal(await page.locator('[data-feed]').count(),1);await show(page);
  await page.locator('#episode-sort').selectOption('unplayed');const playedKey=await page.locator('[data-options]').first().getAttribute('data-options');
  await page.locator('[data-options]').first().click();await page.getByRole('button',{name:'Mark played',exact:true}).click();await page.locator('#sheet').waitFor({state:'hidden'});
  assert.equal(await page.locator('[data-details]').evaluateAll((nodes,key)=>nodes.some(n=>n.dataset.details===key),playedKey),false,'Played episode leaves Unplayed filter');
  controls.audioDelay=100;await page.locator('[data-download]').first().click();
  await page.waitForFunction(()=>document.querySelector('[data-download]').getAttribute('aria-label').startsWith('Cancel'));
  await page.locator('[data-download]').first().click();await page.waitForFunction(()=>document.querySelector('[data-download]').getAttribute('aria-label').startsWith('Download'));
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('jarvis.podcasts.v1')).downloads).length),0);
  controls.audioDelay=0;controls.failAudio=true;await page.locator('[data-download]').first().click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('could not download'));
  assert.equal(await page.evaluate(()=>Object.keys(JSON.parse(localStorage.getItem('jarvis.podcasts.v1')).downloads).length),0);
  assert.equal((await audioSnapshot(page)).paused,true);assert.deepEqual(errors,[]);
});
