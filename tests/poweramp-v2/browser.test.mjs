import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {serveV2} from '../../scripts/serve-poweramp-v2.mjs';

const evidence=resolve(process.env.V2_EVIDENCE_DIR||'.browser-check/poweramp-v2');
let browser,server;const measurements={};
before(async()=>{
  await mkdir(evidence,{recursive:true});
  server=await serveV2({root:process.env.V2_ROOT||resolve('frontend/poweramp-v2')});
  const chrome=[process.env.JARVIS_CHROME,process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
  browser=await chromium.launch({headless:true,...(chrome?{executablePath:chrome}:{})});
  measurements.browser=await browser.version();measurements.node=process.version;
});
after(async()=>{await writeFile(resolve(evidence,'measurements.json'),JSON.stringify(measurements,null,2)+'\n');await browser?.close();await server?.close();});
async function open(t,options={}){
  const context=await browser.newContext({viewport:{width:360,height:780},deviceScaleFactor:2,isMobile:true,hasTouch:true,...options});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Content Security Policy'))errors.push(m.text());});
  t.after(async()=>{assert.deepEqual(errors,[],'uncaught script/CSP errors');await context.close();});
  return {page,context,boot:async()=>{await page.goto(server.url);await page.waitForSelector('[data-ready="true"]');}};
}
const state=page=>page.evaluate(async()=>{const {engine}=await import('./app.js');const s=engine.snapshot;return {id:s.track?.id,title:s.track?.title,index:s.index,position:s.position,duration:s.duration,status:s.status,intent:s.intent,repeat:s.repeat,shuffle:s.shuffle};});
async function scene(page,name){await page.waitForSelector(`[data-scene="${name}"]`);}
const capture=(page,name)=>page.screenshot({path:resolve(evidence,`${name}.png`)});
async function touchSession(page){return page.context().newCDPSession(page);}
const point=(x,y,id=1)=>({x,y,id,radiusX:2,radiusY:2,force:1});
async function sendTouch(cdp,type,points=[]){await cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});}
async function drag(cdp,points,{cancel=false}={}){
  await sendTouch(cdp,'touchStart',[point(...points[0])]);
  for(const p of points.slice(1)){await sendTouch(cdp,'touchMove',[point(...p)]);await new Promise(ok=>setTimeout(ok,18));}
  await sendTouch(cdp,cancel?'touchCancel':'touchEnd');
}

test('V2 boots paused under its CSP; resource-derived scene geometry and actual decoded audio',async t=>{
  const {page,boot}=await open(t);await boot();
  assert.equal((await state(page)).intent,'pause');
  const geometry=await page.evaluate(()=>({
    nav:document.querySelector('#navbar').getBoundingClientRect().height,
    title:parseFloat(getComputedStyle(document.querySelector('#track-title')).fontSize),
    bg:getComputedStyle(document.querySelector('#app')).backgroundColor,
    titleRect:document.querySelector('#track-labels').getBoundingClientRect().toJSON(),
    artRect:document.querySelector('#artwork').getBoundingClientRect().toJSON()
  }));
  assert.equal(geometry.nav,52);assert.equal(geometry.title,16.5);assert.equal(geometry.bg,'rgb(34, 34, 34)');
  assert.ok(geometry.titleRect.bottom<geometry.artRect.bottom+2,'title overlays artwork');
  await capture(page,'01-player');
  await page.locator('#play').tap();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.25);
  assert.equal((await state(page)).status,'playing');
  const decoded=await page.evaluate(async()=>{
    // Monitor the actual media element's decoded stream without changing its output route.
    const element=document.querySelector('audio'),ctx=new AudioContext();await ctx.resume();
    const stream=element.captureStream(),source=ctx.createMediaStreamSource(stream),analyser=ctx.createAnalyser();source.connect(analyser);
    let peak=0;const samples=new Float32Array(analyser.fftSize);
    for(let i=0;i<12;i++){await new Promise(ok=>setTimeout(ok,20));analyser.getFloatTimeDomainData(samples);for(const x of samples)peak=Math.max(peak,Math.abs(x));}
    source.disconnect();stream.getTracks().forEach(track=>track.stop());await ctx.close();
    return {duration:element.duration,peak};
  });
  assert.equal(decoded.duration,18);assert.ok(decoded.peak>.03);measurements.decodedAudio=decoded;
  await page.locator('#play').tap();const paused=(await state(page)).position;
  await page.waitForTimeout(180);assert.ok(Math.abs((await state(page)).position-paused)<.04);
});

test('library, row selection, mini expansion and mini seeking preserve a single playback owner',async t=>{
  const {page,boot}=await open(t);await boot();
  await page.locator('#nav-library').tap();await scene(page,'library');await capture(page,'02-library');
  await page.getByRole('button',{name:'All Songs',exact:false}).tap();
  await page.locator('.song-row').first().tap();await scene(page,'player');
  assert.equal((await state(page)).title,'After the Rain');
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
  await page.locator('#play').tap();
  await page.locator('#nav-library').tap();await scene(page,'library');
  const id=(await state(page)).id;
  const rect=await page.locator('#mini-seek').boundingBox();
  await page.touchscreen.tap(rect.x+rect.width*.75,rect.y+rect.height/2);
  assert.ok((await state(page)).position>12.5);assert.equal((await state(page)).intent,'pause');
  assert.equal(await page.locator('#app').getAttribute('data-scene'),'library');assert.equal((await state(page)).id,id);
  const miniArt=await page.locator('#artwork').boundingBox();assert.ok(Math.abs(miniArt.width-28)<.1);
  await page.locator('#mini-expand').tap();await scene(page,'player');assert.equal((await state(page)).id,id);assert.equal((await state(page)).intent,'pause');
});

test('centered waveform pointer mapping agrees with visible samples; cancellation restores origin',async t=>{
  const {page,boot}=await open(t);await boot();
  await page.waitForFunction(()=>document.querySelector('audio').readyState>=1);
  await page.evaluate(async()=>{(await import('./app.js')).engine.seek(11);});
  const r=await page.locator('#seek').boundingBox(),y=r.y+12;
  await page.touchscreen.tap(r.x+r.width*.5,y);assert.ok(Math.abs((await state(page)).position-11)<.08);
  await page.touchscreen.tap(r.x+r.width*.7,y);assert.ok(Math.abs((await state(page)).position-14.6)<.1);
  const cdp=await touchSession(page),origin=(await state(page)).position;
  await sendTouch(cdp,'touchStart',[point(r.x+r.width*.3,y)]);
  await sendTouch(cdp,'touchMove',[point(r.x+r.width*.2,y)]);
  assert.ok((await state(page)).position<origin-3);
  await sendTouch(cdp,'touchCancel');assert.ok(Math.abs((await state(page)).position-origin)<.08);
  assert.equal((await state(page)).intent,'pause');
});

test('real touch scene drag, reversal, cancellation and cross-target multi-touch leave no stray activation',async t=>{
  const {page,boot}=await open(t);await boot();const cdp=await touchSession(page);
  const id=(await state(page)).id;
  await drag(cdp,[[170,280],[170,200],[170,140],[170,90],[170,40]]);await scene(page,'library');
  const mini=await page.locator('#mini-expand').boundingBox();
  await drag(cdp,[[130,mini.y+22],[130,mini.y-70],[130,mini.y-150],[130,mini.y-220]]);await scene(page,'player');
  await drag(cdp,[[170,280],[170,150],[170,80],[170,200],[170,260]]);await scene(page,'player');
  await drag(cdp,[[170,280],[170,150]],{cancel:true});await scene(page,'player');
  await sendTouch(cdp,'touchStart',[point(220,190)]);await sendTouch(cdp,'touchMove',[point(110,190)]);
  const next=await page.locator('#next').boundingBox();
  await sendTouch(cdp,'touchStart',[point(110,190),point(next.x+next.width/2,next.y+next.height/2,2)]);
  await sendTouch(cdp,'touchEnd');await scene(page,'player');
  assert.equal((await state(page)).id,id);assert.equal((await state(page)).intent,'pause');
  assert.equal(await page.locator('#library').evaluate(e=>e.inert),true);
  // A new ordinary tap still works after the cancelled sequence.
  await page.locator('#nav-library').tap();await scene(page,'library');
});

test('scene settlement is interruptible and sampled shared-art positions remain continuous',async t=>{
  const {page,boot}=await open(t);await boot();
  const points=[];
  for(const p of [0,.25,.5,.75,1]){
    await page.evaluate(async p=>{const {motion}=await import('./app.js');motion.interrupt();motion.set(p);},p);
    points.push({p,...await page.locator('#artwork').boundingBox()});await capture(page,`motion-${Math.round(p*100)}`);
  }
  assert.ok(points.every((p,i)=>i===0||p.width<points[i-1].width));
  await page.evaluate(async()=>{const {motion}=await import('./app.js');motion.set(0);motion.settle(1);});
  await page.waitForFunction(()=>{const p=Number(document.querySelector('#app').dataset.progress);return p>.05&&p<.95;});
  const continuity=await page.evaluate(async()=>{const {motion}=await import('./app.js');const before=motion.progress;motion.settle(0);return {before,after:motion.progress};});
  assert.equal(continuity.before,continuity.after);await scene(page,'player');
  measurements.sharedArtwork=points;
});

test('search gets focus from settled library and with reduced motion; menu traps focus',async t=>{
  const {page,boot}=await open(t,{reducedMotion:'reduce'});await boot();
  await page.locator('#nav-library').tap();await scene(page,'library');
  await page.locator('#nav-search').tap();assert.equal(await page.evaluate(()=>document.activeElement.id),'search-input');
  await page.locator('#search-input').fill('rain');assert.equal(await page.locator('.song-row').count(),1);
  await page.locator('#search-input').fill('does-not-exist');assert.equal(await page.locator('#empty').isVisible(),true);
  await page.locator('#nav-menu').tap();assert.equal(await page.locator('#menu').evaluate(e=>e.open),true);
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement.closest('dialog'))),true);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#menu').evaluate(e=>e.open),false);
});

test('real end progression, shuffle/repeat controls, long-press Stop and reload never invent play intent',async t=>{
  const {page,boot}=await open(t);await boot();
  await page.locator('#play').tap();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.05);
  await page.evaluate(async()=>{(await import('./app.js')).engine.seek(17.85);});
  await page.waitForFunction(()=>document.querySelector('#track-title').textContent==='Glass Horizon');
  assert.equal((await state(page)).intent,'play');
  const play=await page.locator('#play').boundingBox(),cdp=await touchSession(page);
  await sendTouch(cdp,'touchStart',[point(play.x+play.width/2,play.y+play.height/2)]);await page.waitForTimeout(600);await sendTouch(cdp,'touchEnd');
  assert.equal((await state(page)).intent,'pause');assert.ok((await state(page)).position<.1);
  await page.locator('#repeat').tap();await page.locator('#shuffle').tap();
  await page.evaluate(async()=>{(await import('./app.js')).engine.seek(7);});
  await page.locator('#nav-library').tap();await scene(page,'library');
  await page.reload();await page.waitForSelector('[data-ready="true"]');await page.waitForFunction(()=>document.querySelector('audio').readyState>=1);
  const s=await state(page);assert.equal(s.id,'demo-02');assert.equal(s.repeat,'all');assert.equal(s.shuffle,true);assert.equal(s.intent,'pause');assert.ok(Math.abs(s.position-7)<.15);
});

test('storage denial does not prevent boot or playback',async t=>{
  const {page,boot}=await open(t);
  await page.addInitScript(()=>Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Storage disabled','SecurityError');}}));
  await boot();await page.locator('#play').tap();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
  assert.equal((await state(page)).status,'playing');
});

test('unavailable actual media produces a safe error; pause survives offline/online',async t=>{
  const {page,context,boot}=await open(t);await boot();
  await page.evaluate(async()=>{const {useCatalog}=await import('./app.js');useCatalog({tracks:[{id:'unavailable',title:'Unavailable fixture',artist:'Test',album:'Test',duration:3,src:location.origin+'/poweramp-v2/missing.wav?private=do-not-log'}],dispose(){}});});
  await page.locator('#play').tap();await page.waitForFunction(()=>document.querySelector('#app').dataset.playback==='error');
  const s=await state(page);assert.equal(s.intent,'pause');
  assert.doesNotMatch(await page.locator('#status').textContent(),/private|http|missing/);
  await context.setOffline(true);await context.setOffline(false);assert.equal((await state(page)).intent,'pause');
});

test('5,000-track catalog keeps DOM bounded and input/playback functional at the end of the list',async t=>{
  const {page,boot}=await open(t);await boot();
  const setup=await page.evaluate(async()=>{
    const {useCatalog}=await import('./app.js'),{createDemoCatalog}=await import('./sources.js');const catalog=await createDemoCatalog();
    const start=performance.now();useCatalog({tracks:Array.from({length:5000},(_,i)=>({...catalog.tracks[0],id:`fixture-${String(i).padStart(4,'0')}`,source:'fixture',title:`Track ${String(i).padStart(4,'0')} <long metadata & text only>`,album:'Synthetic 5,000-track fixture'})),dispose:catalog.dispose});return performance.now()-start;
  });
  await page.locator('#nav-library').tap();await scene(page,'library');await page.getByRole('button',{name:'All Songs',exact:false}).tap();
  await page.locator('#track-list').evaluate(e=>{e.scrollTop=e.scrollHeight;});
  await page.waitForSelector('[data-track-id="fixture-4999"]');
  const count=await page.locator('.song-row').count();assert.ok(count<=32);assert.ok(count>=3);
  await capture(page,'03-large-library');
  await page.locator('[data-track-id="fixture-4999"]').tap();await scene(page,'player');await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
  assert.equal((await state(page)).id,'fixture-4999');
  measurements.largeLibrary={tracks:5000,renderedRows:count,setupMs:setup};
});

test('small portrait, landscape and large viewports keep transport/navigation inside the viewport',async t=>{
  const {page,boot}=await open(t);await boot();
  for(const viewport of [{width:320,height:568},{width:780,height:360},{width:430,height:932}]){
    await page.setViewportSize(viewport);await page.waitForTimeout(35);
    for(const id of ['play','nav-library','nav-menu']){
      const r=await page.locator('#'+id).boundingBox();assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=viewport.width+1&&r.y+r.height<=viewport.height+1,`${id} fits ${viewport.width}x${viewport.height}`);
    }
    await capture(page,`viewport-${viewport.width}x${viewport.height}`);
  }
});

test('local file import plays actual selected audio and does not persist its name or blob URL',async t=>{
  const {page,boot}=await open(t);await boot();
  const buffer=Buffer.alloc(44+44100*2);buffer.write('RIFF',0);buffer.writeUInt32LE(buffer.length-8,4);buffer.write('WAVEfmt ',8);buffer.writeUInt32LE(16,16);buffer.writeUInt16LE(1,20);buffer.writeUInt16LE(1,22);buffer.writeUInt32LE(44100,24);buffer.writeUInt32LE(88200,28);buffer.writeUInt16LE(2,32);buffer.writeUInt16LE(16,34);buffer.write('data',36);buffer.writeUInt32LE(buffer.length-44,40);
  for(let i=0;i<44100;i++)buffer.writeInt16LE(Math.round(Math.sin(i/44100*Math.PI*440*2)*4000),44+i*2);
  await page.locator('#files').setInputFiles({name:'Local-fixture.wav',mimeType:'audio/wav',buffer});await scene(page,'library');
  await page.locator('.song-row').first().tap();await scene(page,'player');await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
  assert.equal((await state(page)).title,'Local-fixture');
  await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide')));
  assert.doesNotMatch(await page.evaluate(()=>JSON.stringify(localStorage)),/Local-fixture|blob:|http/);
});

test('empty catalogs and keyboard list navigation remain coherent',async t=>{
  const {page,boot}=await open(t);await boot();
  await page.locator('#nav-library').tap();await scene(page,'library');await page.getByRole('button',{name:'All Songs',exact:false}).tap();
  await page.locator('#track-list').focus();await page.keyboard.press('End');
  assert.equal(await page.evaluate(()=>document.activeElement.dataset.trackId),'demo-01');
  await page.keyboard.press('Enter');await scene(page,'player');assert.equal((await state(page)).id,'demo-01');
  await page.evaluate(async()=>{(await import('./app.js')).useCatalog({tracks:[],dispose(){}});});
  assert.equal((await state(page)).intent,'pause');assert.equal(await page.locator('#play').isDisabled(),true);
  await page.locator('#nav-library').tap();await scene(page,'library');await page.getByRole('button',{name:'All Songs',exact:false}).tap();
  assert.equal(await page.locator('#empty').isVisible(),true);assert.equal(await page.locator('.song-row').count(),0);
});

test('track replacement during a seek contact cannot apply old seek coordinates to the new track',async t=>{
  const {page,boot}=await open(t);await boot();await page.waitForFunction(()=>document.querySelector('audio').readyState>=1);
  const r=await page.locator('#seek').boundingBox(),cdp=await touchSession(page);
  await sendTouch(cdp,'touchStart',[point(r.x+r.width*.7,r.y+10)]);
  await page.evaluate(async()=>{(await import('./app.js')).engine.next();});
  await sendTouch(cdp,'touchMove',[point(r.x+r.width*.9,r.y+10)]);await sendTouch(cdp,'touchEnd');
  const s=await state(page);assert.equal(s.id,'demo-02');assert.ok(s.position<.1);assert.equal(s.intent,'pause');
});

test('records animation/frame and long-task observations during six real navigation cycles at 4x CPU slowdown',async t=>{
  const {page,boot}=await open(t);await boot();const cdp=await touchSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  await page.evaluate(()=>{
    window.v2Measure={frames:[],longTasks:[],last:0,running:true};
    const m=window.v2Measure;m.observer=new PerformanceObserver(list=>{m.longTasks.push(...list.getEntries().map(e=>e.duration));});m.observer.observe({type:'longtask'});
    const tick=now=>{if(m.last)m.frames.push(now-m.last);m.last=now;if(m.running)requestAnimationFrame(tick);};requestAnimationFrame(tick);
  });
  await page.locator('#play').tap();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
  for(let i=0;i<6;i++) {await page.locator('#nav-library').tap();await scene(page,'library');await page.locator('#mini-expand').tap();await scene(page,'player');}
  measurements.navigationAt4x=await page.evaluate(()=>{
    const m=window.v2Measure;m.running=false;m.observer.disconnect();const frames=m.frames.sort((a,b)=>a-b);
    return {samples:frames.length,p50ms:frames[Math.floor(frames.length*.5)],p95ms:frames[Math.floor(frames.length*.95)],maxMs:frames.at(-1),over34ms:frames.filter(x=>x>34).length,longTasks:m.longTasks,domNodes:document.querySelectorAll('*').length,audioTime:document.querySelector('audio').currentTime};
  });
  assert.ok(measurements.navigationAt4x.samples>30);assert.equal((await state(page)).intent,'play');assert.ok(measurements.navigationAt4x.audioTime>2);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
});
