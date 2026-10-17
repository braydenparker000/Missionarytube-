import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildPreview} from '../scripts/build-poweramp-preview.mjs';
import {chromium} from 'playwright-core';
import {compareScreenshotPNG} from '../tests/helpers/poweramp-png.js';
// Diagnostic-only: isolated offline preview, real Chromium touch input.
const stationary=process.argv.includes('--stationary');
const iterations=Number(process.env.POWERAMP_INPUT_ITERATIONS||20);
assert.ok(Number.isInteger(iterations)&&iterations>=1&&iterations<=50);
const profile={viewport:{width:519,height:988},deviceScaleFactor:2.0818214416503906,isMobile:true,hasTouch:true};
const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/google-chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
const names=['index.html','audio-analysis.js','audio-core.js','player.js'];
const baselineRef=process.env.POWERAMP_BASELINE_REF||'HEAD';
const evidenceDir=resolve(process.env.POWERAMP_EVIDENCE_DIR||'/tmp/poweramp-input-'+(stationary?'stationary':'fast'));
async function save(name,value){await mkdir(evidenceDir,{recursive:true});await writeFile(join(evidenceDir,name),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');}
async function build(directory,baseline){
  const inputs=baseline?names.map(name=>execFileSync('git',['show',baselineRef+':public/drawercast/'+name],{encoding:'utf8',maxBuffer:4_000_000})):await Promise.all(names.map(name=>readFile(new URL('../public/drawercast/'+name,import.meta.url),'utf8')));
  const output=join(directory,baseline?'v7.html':'persistent.html'),result=await buildPreview(output,{inputs});
  let html=await readFile(output,'utf8');html=html.replace('window.PA = {','window.fixtureMotion=SharedPlayerMotion;window.fixtureScene=ScreenDrag;window.fixtureLifecycle=InputLifecycle;window.PA = {');await writeFile(output,html);
  return result;
}
async function open(browser,built,theme){
  const context=await browser.newContext(profile),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(12000);
  // Observe native navigation input before the app installs capture guards.
  // Retain no text, and never alter, replay, or await the observed events.
  await context.addInitScript(()=>{
    const events=[];let sequence=0;
    const record=(type,phase,event)=>{
      const lifecycle=window.fixtureLifecycle,scene=window.fixtureScene,nav=document.querySelector('[data-nav="library"]');
      const replacement=lifecycle?.replacementClicks?.get(event?.pointerId);
      events.push({sequence:++sequence,type,phase,at:performance.now(),timeStamp:event?.timeStamp,pointerId:event?.pointerId,pointerType:event?.pointerType,
        cancelable:event?.cancelable,touches:[...(event?.touches||[])].map(t=>({id:t.identifier,x:t.clientX,y:t.clientY})),changedTouches:[...(event?.changedTouches||[])].map(t=>({id:t.identifier,x:t.clientX,y:t.clientY})),
        trusted:event?.isTrusted,target:event?.target?.id||event?.target?.tagName,nav:event?.target?.closest?.('[data-nav]')?.dataset.nav,
        x:event?.clientX,y:event?.clientY,screen:window.PA?.Nav.cur,focused:document.hasFocus(),
        visibility:document.visibilityState,handler:typeof nav?.onclick,version:lifecycle?.version,contacts:lifecycle?[...lifecycle.contacts]:[],
        scenePhase:scene?.phase,sceneActive:!!(scene?.state||scene?.settling),replacement:replacement?{at:replacement.at,connected:replacement.node.isConnected}:null,event});
      if(events.length>4000)events.shift();
    };
    window.fixtureNavigationTrace={record,get sequence(){return sequence;},capture:()=>events.map(({event,...entry})=>({...entry,defaultPrevented:event?.defaultPrevented}))};
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','touchstart','touchmove','touchend','touchcancel','click','mousedown','mouseup','scroll'])for(const capture of [true,false]){
      document.addEventListener(type,event=>record(type,capture?'capture':'bubble',event),{capture,passive:true});
    }
    for(const type of ['focus','blur','resize'])window.addEventListener(type,event=>record(type,'window',event),{passive:true});
    document.addEventListener('visibilitychange',event=>record('visibilitychange','document',event),{passive:true});
  });
  await context.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort('blockedbyclient'):route.continue());
  await page.goto(pathToFileURL(built.output).href);await page.waitForFunction(()=>window.powerampPreview?.ready);await page.locator('#preview-size').tap();await page.waitForFunction(()=>powerampPreview.ready&&powerampPreview.count===5000);
  await page.evaluate(theme=>{PA.SET.uiTheme=theme;PA.SET.playerLayout='classic';PA.SET.bgBlur=5;PA.SET.vizOnPlayer=false;PA.SET.animations='default';PA.NativeSettings.values.list_header_buttons=1;PA.applySettings();PA.Engine.seek(42);PA.UI.renderProgress();},theme);
  await page.evaluate(()=>document.fonts.ready);await page.waitForFunction(()=>!!document.querySelector('#bg-art').style.backgroundImage);await page.waitForTimeout(700);
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const point=(x,y)=>({id:1,x,y,radiusX:1,radiusY:1,force:1}),start=(x,y)=>cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(x,y)]}),move=(x,y)=>cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x,y)]}),end=()=>cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const frame=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(done)));
  const settled=async screen=>{try{await page.waitForFunction(screen=>PA.Nav.cur===screen&&!fixtureScene.state&&!fixtureScene.settling&&!PA.LibraryPageMotion.state&&!PA.LibraryPageMotion.finish&&!fixtureLifecycle.gesture&&!document.querySelector('.player-scene-input'),screen);await page.waitForFunction(screen=>{const root=document.querySelector('#sc-'+screen),mini=document.querySelector('#mini');return Number(getComputedStyle(root).opacity)>.9999&&(screen==='player'||Number(getComputedStyle(mini).opacity)>.9999);},screen);await frame();}catch(error){const state=await page.evaluate(expected=>{const rect=n=>{if(!n)return null;const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {hidden:n.hidden,inert:n.inert,opacity:s.opacity,visibility:s.visibility,pointerEvents:s.pointerEvents,rect:{left:r.left,top:r.top,width:r.width,height:r.height}};};const scene=s=>s?{from:s.fromName,target:s.target,progress:s.progress,shared:s.morph?.p,commit:s.commit}:null;return {expected,current:PA.Nav.cur,phase:fixtureScene.phase,state:scene(fixtureScene.state),settling:scene(fixtureScene.settling),gesture:fixtureLifecycle.gesture?{phase:fixtureLifecycle.gesture.phase,node:fixtureLifecycle.gesture.node?.id}:null,contacts:[...fixtureLifecycle.contacts],root:rect(document.querySelector('#sc-'+expected)),mini:rect(document.querySelector('#mini')),nav:rect(document.querySelector('[data-nav="library"]')),plane:!!document.querySelector('.player-scene-input'),historyState:!!PA.LibraryPageMotion.state,historyFinish:!!PA.LibraryPageMotion.finish,visibility:document.visibilityState,focused:document.hasFocus(),inputTrace:fixtureNavigationTrace.capture()};},screen);console.error('POWERAMP_PROTO_SETTLE_FAILURE '+JSON.stringify({source:built.sourceHash,theme,state}));await save('persistent-'+theme+'-'+(built.output.endsWith('v7.html')?'v7':'live')+'-settle-failure.json',state);throw error;}};
  const center=selector=>page.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
  const library=async()=>{
    const selector='[data-nav="library"]',nav=page.locator(selector);
    // Playwright trial taps dispatch an intercepted contact. Use non-input
    // actionability checks before the single browser-generated navigation click.
    await nav.scrollIntoViewIfNeeded();
    assert.equal(await nav.isVisible(),true,'Library is visible before setup contact');
    assert.equal(await nav.isEnabled(),true,'Library is enabled before setup contact');
    const point=await center(selector);
    assert.equal(await nav.evaluate((node,p)=>node.contains(document.elementFromPoint(p.x,p.y)),point),true,'Library center receives the setup contact');
    const before=await page.evaluate(()=>fixtureNavigationTrace.sequence);
    await start(point.x,point.y);await frame();await end();
    await settled('library');
    const input=await page.evaluate(before=>fixtureNavigationTrace.capture().filter(event=>event.sequence>before&&event.phase==='capture'),before);
    assert.equal(input.filter(event=>event.type==='pointercancel'||event.type==='touchcancel').length,0,'Library setup contact is not cancelled');
    const one=type=>{const found=input.filter(event=>event.type===type);assert.equal(found.length,1,'one '+type+' for Library setup');assert.equal(found[0].trusted,true,type+' is trusted');assert.equal(found[0].nav,'library',type+' targets Library');return found[0];};
    const down=one('pointerdown'),up=one('pointerup'),click=one('click');
    one('touchstart');one('touchend');
    assert.equal(down.pointerType,'touch');assert.equal(up.pointerType,'touch');assert.equal(click.pointerType,'touch');
    assert.equal(up.pointerId,down.pointerId);assert.equal(click.pointerId,down.pointerId);
    assert.equal(click.defaultPrevented,false,'Library click reaches the native navigation handler');
    await page.getByRole('button',{name:'All Songs',exact:true}).tap();await settled('list');
  };
  await page.evaluate(()=>{
    const probe=window.fixtureProbe={operations:[],active:0,clones:0,deepClones:0,styleEnumerations:0,propertyReads:0,cssRulesReads:0,creates:0};
    const clone=Node.prototype.cloneNode;Node.prototype.cloneNode=function(deep){if(probe.active){probe.clones++;if(deep)probe.deepClones++;}return clone.call(this,deep);};
    const computed=window.getComputedStyle;window.getComputedStyle=(...args)=>{const style=computed(...args);if(!probe.active)return style;return new Proxy(style,{get(target,key){if(key==='length')probe.styleEnumerations++;if(key==='getPropertyValue')return name=>{probe.propertyReads++;return target.getPropertyValue(name);};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});};
    const cssRules=Object.getOwnPropertyDescriptor(CSSStyleSheet.prototype,'cssRules');Object.defineProperty(CSSStyleSheet.prototype,'cssRules',{configurable:true,get(){if(probe.active)probe.cssRulesReads++;return cssRules.get.call(this);}});
    for(const key of ['create','paint','clean']){const original=fixtureMotion[key];fixtureMotion[key]=function(...args){const before={clones:probe.clones,deepClones:probe.deepClones,styleEnumerations:probe.styleEnumerations,propertyReads:probe.propertyReads,cssRulesReads:probe.cssRulesReads};probe.active++;const at=performance.now();try{return original.apply(this,args);}finally{const elapsed=performance.now()-at;probe.active--;probe.operations.push({operation:key,direction:args[0]?.target==='player'||args[0]?.opening?'expand':'collapse',ms:elapsed,...Object.fromEntries(Object.keys(before).map(k=>[k,probe[k]-before[k]]))});if(key==='create')probe.creates++;}};}
  });
  return {context,page,errors,cdp,start,move,end,frame,settled,center,library,slug:theme+'-'+(built.output.endsWith('v7.html')?'v7':'live')};
}
async function visible(h){
  const result=await h.page.evaluate(()=>{const n=document.querySelector('#sc-list'),s=getComputedStyle(n),r=n.getBoundingClientRect(),mini=document.querySelector('#mini'),m=getComputedStyle(mini);return {screen:PA.Nav.cur,hidden:n.hidden,inert:n.inert,visibility:s.visibility,opacity:s.opacity,transform:s.transform,covered:n.classList.contains('library-page-covered'),rows:[...document.querySelectorAll('#list-body .trow')].filter(n=>{const b=n.getBoundingClientRect();return b.width>0&&b.height>0&&b.bottom>0&&b.top<innerHeight;}).length,width:r.width,height:r.height,mini:{hidden:mini.hidden,opacity:m.opacity,visibility:m.visibility},plane:!!document.querySelector('.player-scene-input'),historyHost:document.querySelector('#library-page-motion').hidden};});
  assert.equal(result.screen,'list');assert.equal(result.hidden,false);assert.equal(result.inert,false);assert.equal(result.visibility,'visible');assert.equal(result.opacity,'1');assert.equal(result.covered,false);assert.ok(result.rows>0);assert.ok(result.width>0&&result.height>0);assert.equal(result.mini.hidden,false);assert.equal(result.mini.opacity,'1');assert.equal(result.mini.visibility,'visible');assert.equal(result.plane,false);assert.equal(result.historyHost,true);return result;
}
async function measure(h,label,perform){await h.page.evaluate(()=>{fixtureProbe.operations=[];fixtureMotion.clearAppearance();});await perform();return {label,...await h.page.evaluate(()=>({operations:fixtureProbe.operations,screen:PA.Nav.cur}))};}
async function timings(h,results=[]){
  await h.library();
  for(const label of ['first-tap','repeat-tap','repeat-playing']){
    if(label==='repeat-playing')await h.page.evaluate(()=>PA.Engine.play());
    const point=await h.center('#mini-title');results.push(await measure(h,label,async()=>{await h.start(point.x,point.y);await h.end();await h.settled('player');}));
    const art=await h.center('#artA');results.push(await measure(h,label+'-collapse',async()=>{await h.start(art.x,art.y);await h.move(art.x,art.y+169);await h.frame();if(stationary)await h.page.waitForTimeout(100);await h.end();await h.settled('list');}));await visible(h);
  }
  await h.page.evaluate(()=>{PA.Engine.pause();PA.Engine.seek(42);PA.UI.renderProgress();});
  return results;
}
async function canonical(h,screen){
  if(screen==='list')await h.library();else{await h.library();await h.page.locator('#mini-title').tap();await h.settled('player');}
  await h.page.evaluate(()=>{PA.Engine.pause();PA.Engine.seek(42);PA.UI.renderProgress();PA.UI.drawViz();});await h.frame();await h.frame();
  const state=await h.page.evaluate(()=>{const root=document.querySelector('#sc-'+PA.Nav.cur),r=root.getBoundingClientRect();return {screen:PA.Nav.cur,hidden:root.hidden,inert:root.inert,opacity:getComputedStyle(root).opacity,visibility:getComputedStyle(root).visibility,rect:{left:r.left,top:r.top,width:r.width,height:r.height},activeMask:!!document.querySelector('#player-live-mask[data-active],#player-live-backdrop-mask[data-active]'),activeInput:!!document.querySelector('.player-scene-input'),time:PA.Engine.time(),label:document.querySelector('#t-cur').textContent};});
  assert.equal(state.screen,screen);assert.equal(state.hidden,false);assert.equal(state.inert,false);assert.equal(state.opacity,'1');assert.equal(state.visibility,'visible');assert.equal(state.activeMask,false);assert.equal(state.activeInput,false);assert.equal(state.time,42);if(screen==='player')assert.equal(state.label,'0:42');
  return {state,png:await h.page.screenshot({fullPage:false,animations:'allow',scale:'device'})};
}

const directory=await mkdtemp(join(tmpdir(),'touch-causal-'));
const built=await build(directory,false);
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
const trace=await browser.newBrowserCDPSession(),traceEvents=[];
trace.on('Tracing.dataCollected',event=>traceEvents.push(...event.value));
await trace.send('Tracing.start',{categories:'input,latencyInfo,disabled-by-default-devtools.timeline.inputs',transferMode:'ReportEvents'});
const runs=[];
try {
 for(let iteration=0;iteration<iterations;iteration++) {
  const h=await open(browser,built,'light');
  const run={iteration,source:built.sourceHash,stationary};runs.push(run);
  try {await timings(h);await canonical(h,'list');run.passed=true;}
  catch(error){run.error=String(error);process.exitCode=1;}
  finally {run.events=await h.page.evaluate(()=>fixtureNavigationTrace.capture());await h.context.close();await save('short-input-runs.json',runs);}
  console.log(JSON.stringify({iteration,passed:run.passed,error:run.error}));
  if(run.error)break;
 }
} finally {
 const finished=new Promise(done=>trace.once('Tracing.tracingComplete',done));await trace.send('Tracing.end');await finished;await save('short-input-trace.json',{traceEvents});console.log(JSON.stringify({source:built.sourceHash,stationary,iterations:runs.length,passed:runs.filter(r=>r.passed).length,flings:traceEvents.filter(e=>e.name==='RenderInputRouter::ForwardGestureEvent'&&e.args?.type==='GestureFlingStart').length,tapSuppressions:traceEvents.filter(e=>e.name==='FilterTapSuppression').length,evidenceDir}));await browser.close();await rm(directory,{recursive:true,force:true});
}
