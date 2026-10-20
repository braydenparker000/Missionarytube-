import {execFileSync} from 'node:child_process';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir, cpus, platform, release} from 'node:os';
import {resolve, join} from 'node:path';
import {chromium} from 'playwright-core';
import {createPodcastServer} from '../tests/helpers/podcasts-browser-fixture.mjs';

// Reproducible review of the actual static application, with data-only local
// providers and real PCM audio. This never uses accounts or production storage.
const args=process.argv.slice(2),option=(key,fallback)=>args.includes(key)?args[args.indexOf(key)+1]:fallback;
const baseline=args.includes('--baseline'),revision=option('--ref','HEAD');
const output=resolve(option('--out','docs/evidence/podcasts-listening-room/'+(baseline?'before':'after')));
const chrome=[process.env.JARVIS_CHROME,process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
if(!chrome)throw Error('Set JARVIS_CHROME to an installed Chromium executable.');
let temporary,server,browser,context;
await mkdir(output,{recursive:true});
try {
  let root=resolve(option('--root','frontend'));
  if(baseline){
    temporary=await mkdtemp(join(tmpdir(),'podcasts-review-'));
    const archive=execFileSync('git',['archive',revision,'frontend/podcasts','frontend/assets/shell.css','frontend/assets/premium.css'],{maxBuffer:16*1024*1024});
    execFileSync('tar',['-x','--strip-components=1','-C',temporary],{input:archive});root=temporary;
  }
  server=await createPodcastServer({root});
  browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-background-networking']});
  context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,reducedMotion:'no-preference'});
  await context.route('**/*',route=>new URL(route.request().url()).origin===server.origin?route.continue():route.abort());
  const page=await context.newPage(),errors=[],screens=[],measurements=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
    window.reviewMetrics={longTasks:[],events:[],pressFrames:[],loads:0};
    document.addEventListener('pointerdown',event=>{const node=event.target.closest('button,a');if(!node)return;const start=performance.now();requestAnimationFrame(()=>window.reviewMetrics.pressFrames.push({latencyMs:performance.now()-start,target:node.id||node.className}));},true);
    new PerformanceObserver(list=>window.reviewMetrics.longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask',buffered:true});
    if(PerformanceObserver.supportedEntryTypes.includes('event'))new PerformanceObserver(list=>window.reviewMetrics.events.push(...list.getEntries().filter(e=>e.interactionId).map(e=>({name:e.name,start:e.startTime,duration:e.duration,processing:e.processingEnd-e.processingStart,interactionId:e.interactionId})))).observe({type:'event',durationThreshold:16,buffered:true});
    document.addEventListener('loadstart',e=>{if(e.target.tagName==='AUDIO')window.reviewMetrics.loads++;},true);
  });
  const settle=async(id='player')=>page.waitForFunction(id=>document.getElementById(id).dataset.motion==='open',id);
  const top=()=>page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
  const shot=async(name,{scroll=true}={})=>{
    if(scroll)await top();
    await page.evaluate(async()=>{await document.fonts.ready;await Promise.all([...document.images].filter(i=>i.loading!=='lazy'||i.getBoundingClientRect().top<innerHeight).map(i=>i.decode().catch(()=>{})));});
    await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))));
    await page.locator('#toast').waitFor({state:'hidden',timeout:6000});
    await page.screenshot({path:join(output,name+'.png')});
    screens.push({name,viewport:page.viewportSize(),overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
  };
  const tab=async(name)=>{await page.locator(`[data-view="${name}"]`).click();await page.waitForFunction(()=>document.querySelector('#results').getAttribute('aria-busy')==='false');};
  const close=async(id='sheet')=>{await page.keyboard.press('Escape');await page.locator('#'+id).waitFor({state:'hidden'});};
  const show=async()=>{await page.locator('[data-feed]').first().click();await page.locator('[data-details]').first().waitFor();};
  const audio=()=>page.evaluate(()=>{const a=document.querySelector('audio');window.reviewAudio??=a;return {same:a===window.reviewAudio,count:document.querySelectorAll('audio').length,source:new URL(a.currentSrc||location.href).pathname,position:a.currentTime,paused:a.paused,loads:window.reviewMetrics.loads};});
  const drag=async(selector,steps,{cancel=false}={})=>{
    const target=page.locator(selector).first();await target.scrollIntoViewIfNeeded();
    const r=await target.boundingBox(),x=r.x+r.width/2,y=r.y+r.height/2,cdp=await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{id:1,x,y}]});
    for(const dy of steps){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{id:1,x,y:y+dy}]});await page.waitForTimeout(25);}
    await cdp.send('Input.dispatchTouchEvent',{type:cancel?'touchCancel':'touchEnd',touchPoints:[]});await cdp.detach();
  };
  const measure=async(name,action)=>{
    await page.evaluate(()=>{window.reviewFrameStart=performance.now();window.reviewFrames=[];const epoch=window.reviewFrameEpoch=(window.reviewFrameEpoch||0)+1;let previous;const frame=t=>{if(epoch!==window.reviewFrameEpoch)return;if(previous)window.reviewFrames.push(t-previous);previous=t;requestAnimationFrame(frame);};requestAnimationFrame(frame);});
    await action();await page.waitForTimeout(400);
    measurements.push(await page.evaluate(name=>{window.reviewFrameEpoch++;const start=window.reviewFrameStart,end=performance.now(),frames=window.reviewFrames.slice().sort((a,b)=>a-b);return {name,start,end,frameCount:frames.length,frameIntervalMedianMs:frames[Math.floor(frames.length*.5)],frameIntervalP95Ms:frames[Math.floor(frames.length*.95)],frameIntervalMaxMs:frames.at(-1),framesOver25ms:frames.filter(n=>n>25).length,longTasks:window.reviewMetrics.longTasks.filter(e=>e.start>=start&&e.start<=end),events:window.reviewMetrics.events.filter(e=>e.start>=start&&e.start<=end)};},name));
  };

  server.controls.delay=900;await page.goto(server.origin+'/podcasts/');
  await page.locator('.loading-grid').waitFor();await shot('discover-loading');server.controls.delay=0;
  await page.locator('[data-feed]').first().waitFor();await shot('discover');
  await page.locator('#query').fill('nothing');await page.locator('#search-form').evaluate(n=>n.requestSubmit());await page.getByRole('heading',{name:'No shows found',exact:true}).waitFor();await shot('discover-empty');
  await page.locator('#query').fill('Listening');await page.locator('#search-form').evaluate(n=>n.requestSubmit());await page.locator('.search-results').waitFor();await shot('search');
  await show();await shot('show');await page.locator('#follow-show').click();
  for(const index of [1,2,3]){await page.locator('[data-options]').nth(index).click();await settle('sheet');await page.getByRole('button',{name:'Add to queue',exact:true}).click();await page.locator('#sheet').waitFor({state:'hidden'});}
  await page.locator('[data-play]').first().click();await page.waitForFunction(()=>document.querySelector('audio').currentTime>.15&&!document.querySelector('audio').paused);
  await page.locator('#mini-seek').focus();await page.keyboard.press('Home');await page.keyboard.press('PageUp');
  await page.waitForFunction(()=>document.querySelector('audio').currentTime>10);
  await tab('library');await shot('library');await tab('queue');await shot('queue');
  await tab('library');await show();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await page.locator('[data-download]').first().click();await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('jarvis.podcasts.v1')).downloads).length===1);
  server.controls.audioDelay=30;await page.locator('[data-download]').nth(1).click();await tab('downloads');await page.waitForTimeout(200);await shot('downloads-active');
  await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('jarvis.podcasts.v1')).downloads).length===2,null,{timeout:20000});server.controls.audioDelay=0;await shot('downloads');
  await page.locator('#open-player').click();await settle();await shot('player',{scroll:false});
  await page.locator('#player-menu').click();await settle('sheet');await shot('options',{scroll:false});await close();await close('player');
  await tab('discover');if(await page.locator('#clear-search').isVisible()){await page.locator('#clear-search').click();await page.waitForFunction(()=>!document.querySelector('#query').value&&document.querySelector('#results').getAttribute('aria-busy')==='false');}await page.locator('#query').blur();await shot('discover-with-progress');
  for(const [width,height] of [[320,568],[360,640],[412,915],[740,360]]){
    await page.setViewportSize({width,height});await shot(`discover-${width}x${height}`);
    await page.locator('#open-player').click();await settle();await shot(`player-${width}x${height}`,{scroll:false});await close('player');
  }
  await page.setViewportSize({width:390,height:844});
  // Timing run excludes tracing/screenshot capture. These are lab samples, not
  // field INP or evidence of performance on a Galaxy A15.
  const before=await audio();
  await measure('open-player',async()=>{await page.locator('#open-player').click();await settle();});
  await measure('close-player',async()=>{await page.locator('#close-player').click();await page.locator('#player').waitFor({state:'hidden'});});
  await measure('library-tab',async()=>tab('library'));
  await measure('show-entry',show);
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  await page.locator('#open-player').click();await settle();
  await drag('#player-heading',[60,100,30]);await settle();
  await drag('#player-heading',[60],{cancel:true});await settle();
  await drag('#player-heading',[90,180,290]);await page.locator('#player').waitFor({state:'hidden'});
  await page.locator('#open-player').click();await page.locator('#close-player').evaluate(n=>{n.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:1,isPrimary:true}));n.click();});await page.locator('#player').waitFor({state:'hidden'});
  await context.tracing.stop({path:join(output,'player-journey-trace.zip')});
  const after=await audio();
  await tab('queue');
  if(await page.locator('[data-reorder]').count())await measure('queue-drag',async()=>{
    const handles=page.locator('[data-reorder]'),a=await handles.first().boundingBox(),b=await handles.last().boundingBox();
    await drag('[data-reorder]',[20,(b.y-a.y)/2,b.y-a.y]);
  });
  await context.tracing.start({screenshots:true,snapshots:true,sources:true});
  const queueBefore=await page.locator('[data-details]').allTextContents();
  const handles=page.locator('[data-reorder]');
  if(await handles.count()){
    const a=await handles.nth(0).boundingBox(),b=await handles.nth(2).boundingBox();
    await drag('[data-reorder]',[20,(b.y-a.y)/2,b.y-a.y]);
  }else{
    await page.locator('[data-options]').last().click();await settle('sheet');await page.getByRole('button',{name:'Move to top of queue',exact:true}).click();await page.locator('#sheet').waitFor({state:'hidden'});
  }
  await page.waitForTimeout(350);await shot('queue-reordered');
  const queueAfter=await page.locator('[data-details]').allTextContents();
  await context.tracing.stop({path:join(output,'queue-journey-trace.zip')});
  const metrics={revision:execFileSync('git',['rev-parse',baseline?revision:'HEAD'],{encoding:'utf8'}).trim(),workingTree:!baseline,environment:{browser:await browser.version(),node:process.version,platform:platform(),kernel:release(),cpu:cpus()[0]?.model,logicalCPUs:cpus().length,headless:true,viewport:{width:390,height:844},deviceScaleFactor:1,cpuThrottling:false,physicalPhoneVerified:false},measurementNotes:'Local deterministic data providers; real 180-second PCM audio. Timing run excludes screenshots/tracing. Event Timing entries under 16ms are not reported by Chromium. rAF gaps are lab scheduling evidence, not physical-phone smoothness or field INP.',measurements,pressFrameSamples:await page.evaluate(()=>window.reviewMetrics.pressFrames),audio:{before,after},queue:{method:await handles.count()?'touch handle':'existing menu fallback',before:queueBefore,after:queueAfter},screens,errors};
  await writeFile(join(output,'metrics.json'),JSON.stringify(metrics,null,2)+'\n');
  console.log(JSON.stringify({output,screenshots:screens.length,errors,audio:metrics.audio,measurements:measurements.map(({name,frameIntervalP95Ms,longTasks})=>({name,frameIntervalP95Ms,longTasks}))},null,2));
  if(errors.length||screens.some(s=>s.overflow)||before.source!==after.source||before.loads!==after.loads||!after.same||after.count!==1||after.paused)throw Error('Review evidence detected a browser, layout, or audio continuity failure. Inspect metrics.json.');
} finally {
  await context?.close();await browser?.close();await server?.close();if(temporary)await rm(temporary,{recursive:true,force:true});
}
