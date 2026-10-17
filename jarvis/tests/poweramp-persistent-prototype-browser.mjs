import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {buildPreview} from '../scripts/build-poweramp-preview.mjs';
import {chromium} from 'playwright-core';
import {compareScreenshotPNG} from './helpers/poweramp-png.js';
const profile={viewport:{width:519,height:988},deviceScaleFactor:2.0818214416503906,isMobile:true,hasTouch:true};
const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/google-chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
const names=['index.html','audio-analysis.js','audio-core.js','player.js'];
const baselineRef=process.env.POWERAMP_BASELINE_REF||'HEAD';
const evidenceDir=resolve(process.env.POWERAMP_EVIDENCE_DIR||'/tmp/poweramp-persistent-evidence');
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
      if(events.length>80)events.shift();
    };
    window.fixtureNavigationTrace={record,get sequence(){return sequence;},capture:()=>events.map(({event,...entry})=>({...entry,defaultPrevented:event?.defaultPrevented}))};
    for(const type of ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchend','touchcancel','click'])for(const capture of [true,false]){
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
    const art=await h.center('#artA');results.push(await measure(h,label+'-collapse',async()=>{
      await h.start(art.x,art.y);await h.move(art.x,art.y+169);await h.frame();
      // Model a drag released at rest. Chrome's emulated-touch fling can outlive
      // a touch-action:none scene and consume the next navigation tap, even
      // though its scroll updates are discarded. Its velocity tracker clears
      // movement after an 80ms stationary contact before UP (Chrome 154).
      // This is inside the original contact, not a tap retry or settle delay.
      await h.page.waitForTimeout(100);await h.end();
      const release=await h.page.evaluate(()=>{
        const events=fixtureNavigationTrace.capture().filter(e=>e.phase==='capture'),up=events.findLast(e=>e.type==='pointerup');
        const move=events.findLast(e=>e.type==='pointermove'&&e.pointerId===up?.pointerId);
        return {stationaryMs:up?.timeStamp-move?.timeStamp};
      });
      assert.ok(release.stationaryMs>=80,'native pointer samples establish a stationary release: '+JSON.stringify(release));
      await h.settled('list');
    }));await visible(h);
  }
  await h.page.evaluate(()=>{PA.Engine.pause();PA.Engine.seek(42);PA.UI.renderProgress();});
  return results;
}
async function hold(h,p){await h.library();const origin=await h.center('#mini-title'),height=await h.page.locator('#sc-list').evaluate(n=>n.clientHeight);await h.start(origin.x,origin.y);await h.move(origin.x,origin.y-16);await h.frame();await h.move(origin.x,origin.y-height*p);await h.frame();return {origin,height};}
async function snapshot(h,label){
  const state=await h.page.evaluate(()=>{const m=(fixtureScene.state||fixtureScene.settling)?.morph;if(!m)throw Error('No shared morph');const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};const geometry=m.captureMode?{}:{};
    for(const key of ['art','title','sub','play','seek']){if(m.mask){geometry[key+'-mini']=rect(m.pairs[key].mini);}else if(key==='art'){geometry['art-mini']=rect(m.art);}else geometry[key+'-mini']=rect(m.pairs[key].mini);}
    geometry.surface=rect(m.mask||m.surface);const ownership=m.mask?{singleOwner:Object.fromEntries(Object.entries(m.pairs).map(([key,nodes])=>[key,{mini:getComputedStyle(nodes.mini).opacity,full:getComputedStyle(key==='art'?m.A:nodes.full).opacity}])),sceneLayers:document.querySelectorAll('#player-live-mask[data-active],#player-live-backdrop-mask[data-active]').length}:null;return {p:m.p,endpoints:m.endpoints,geometry,ownership,track:PA.Engine.current.id,time:PA.Engine.time()};});
  const png=await h.page.screenshot({fullPage:false,animations:'allow',scale:'device'});await save('persistent-'+h.slug+'-'+label+'.png',png);await save('persistent-'+h.slug+'-'+label+'.json',state);return {label,state,png};
}
async function shots(h){
  const results=[],{origin,height}=await hold(h,.25);for(const p of [.25,.5,.75]){if(p!==.25){await h.move(origin.x,origin.y-height*p);await h.frame();}results.push(await snapshot(h,'held-'+p));}
  await h.end();await h.settled('player');await h.library();const contact=await hold(h,.25);const ending=h.end(),grabbing=h.start(3,500);await Promise.all([ending,grabbing]);
  const frozen=await h.page.evaluate(()=>(fixtureScene.state||fixtureScene.settling).morph.p);await h.move(3,500-(.5-frozen)*contact.height);await h.frame();results.push(await snapshot(h,'regrab-0.5'));const after=await snapshot(h,'regrab-held');await h.page.waitForTimeout(120);const later=await snapshot(h,'regrab-later');for(const key of ['left','top','width','height'])assert.ok(Math.abs(after.state.geometry['art-mini'][key]-later.state.geometry['art-mini'][key])<.05,'frozen regrab '+key);const expected=await h.page.evaluate(delta=>{const scene=fixtureScene.state||fixtureScene.settling,deliberate=Math.abs(delta)>Math.max(44,Math.min(scene.height,300)*.2),commit=deliberate?scene.direction*delta>0:scene.commit;return commit?scene.target:scene.fromName;},-(.5-frozen)*contact.height);await h.end();await h.settled(expected);return results;
}
async function canonical(h,screen){
  if(screen==='list')await h.library();else{await h.library();await h.page.locator('#mini-title').tap();await h.settled('player');}
  await h.page.evaluate(()=>{PA.Engine.pause();PA.Engine.seek(42);PA.UI.renderProgress();PA.UI.drawViz();});await h.frame();await h.frame();
  const state=await h.page.evaluate(()=>{const root=document.querySelector('#sc-'+PA.Nav.cur),r=root.getBoundingClientRect();return {screen:PA.Nav.cur,hidden:root.hidden,inert:root.inert,opacity:getComputedStyle(root).opacity,visibility:getComputedStyle(root).visibility,rect:{left:r.left,top:r.top,width:r.width,height:r.height},activeMask:!!document.querySelector('#player-live-mask[data-active],#player-live-backdrop-mask[data-active]'),activeInput:!!document.querySelector('.player-scene-input'),time:PA.Engine.time(),label:document.querySelector('#t-cur').textContent};});
  assert.equal(state.screen,screen);assert.equal(state.hidden,false);assert.equal(state.inert,false);assert.equal(state.opacity,'1');assert.equal(state.visibility,'visible');assert.equal(state.activeMask,false);assert.equal(state.activeInput,false);assert.equal(state.time,42);if(screen==='player')assert.equal(state.label,'0:42');
  return {state,png:await h.page.screenshot({fullPage:false,animations:'allow',scale:'device'})};
}
test('persistent single shared owner: exact endpoints, 4x CPU input budget, visibility and tracked regrab',{timeout:240000},async t=>{
  assert.ok(executablePath,'Chrome is mandatory');const directory=await mkdtemp(join(tmpdir(),'persistent-prototype-'));let browser;
  const failures=[];const report={profile,cpuThrottling:4,baselineRef,thresholds:{setupMaxMs:33,deepClones:0,styleEnumerations:0,cssRulesReads:0,geometryTolerance:.05,pixelChangedFraction:.0005,pixelMeanDelta:.05},results:[]};
  try{
    const baseline=await build(directory,true),candidate=await build(directory,false);report.sources={baseline:baseline.sourceHash,candidate:candidate.sourceHash};browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    for(const theme of ['dark','light']){
      const a=await open(browser,baseline,theme),b=await open(browser,candidate,theme);const group={theme};report.results.push(group);
      try{group.baselineTimings=[];await timings(a,group.baselineTimings);group.candidateTimings=[];await timings(b,group.candidateTimings);t.diagnostic('POWERAMP_PERSISTENT_TIMINGS '+JSON.stringify({theme,sources:report.sources,baseline:group.baselineTimings,candidate:group.candidateTimings}));await save('persistent-prototype-report.json',report);
        group.endpoints=[];for(const screen of ['list','player']){const old=await canonical(a,screen),next=await canonical(b,screen),pixels=compareScreenshotPNG(old.png,next.png);group.endpoints.push({screen,baseline:old.state,candidate:next.state,pixels});await save('persistent-'+theme+'-endpoint-'+screen+'-v7.png',old.png);await save('persistent-'+theme+'-endpoint-'+screen+'-live.png',next.png);if(pixels.changedFraction>report.thresholds.pixelChangedFraction)failures.push(theme+' endpoint '+screen+' changed fraction '+pixels.changedFraction);if(pixels.meanChannelDelta>report.thresholds.pixelMeanDelta)failures.push(theme+' endpoint '+screen+' mean delta '+pixels.meanChannelDelta);}await save('persistent-prototype-report.json',report);
        await a.page.evaluate(()=>{fixtureProbe.operations=[];});await b.page.evaluate(()=>{fixtureProbe.operations=[];});const oldShots=await shots(a),newShots=await shots(b);group.heldRegrab={baseline:await a.page.evaluate(()=>fixtureProbe.operations),candidate:await b.page.evaluate(()=>fixtureProbe.operations)};group.pairs=[];
        for(let i=0;i<oldShots.length;i++){const old=oldShots[i],next=newShots[i],pixels=compareScreenshotPNG(old.png,next.png);const pair={label:old.label,baseline:old.state,candidate:next.state,pixels};group.pairs.push(pair);await save('persistent-'+theme+'-'+old.label+'-v7.png',old.png);await save('persistent-'+theme+'-'+old.label+'-live.png',next.png);await save('persistent-prototype-report.json',report);
          for(const key of Object.keys(old.state.geometry))for(const property of ['left','top','width','height'])if(Math.abs(old.state.geometry[key][property]-next.state.geometry[key][property])>.05)failures.push(theme+' '+old.label+' '+key+'.'+property+': '+old.state.geometry[key][property]+' vs '+next.state.geometry[key][property]);
          pair.comparison='Known intentional removal of v7 duplicate shared labels/icons and ghost controls. Endpoint pixels remain gated.';for(const [key,owner] of Object.entries(next.state.ownership.singleOwner)){assert.equal(owner.full,'0',key+' original full widget must not duplicate the shared owner');assert.equal(owner.mini,key==='seek'?String(1-next.state.p):'1',key+' one visible shared owner');}assert.equal(next.state.ownership.sceneLayers,2);
        }
        const setup=group.candidateTimings.flatMap(r=>r.operations).filter(r=>r.operation==='create');assert.equal(setup.length,6);for(const value of [...setup,...group.heldRegrab.candidate.filter(r=>r.operation==='create')]){assert.equal(value.deepClones,0);assert.equal(value.styleEnumerations,0);assert.equal(value.cssRulesReads,0);assert.ok(value.ms<=33,'absolute 4x setup budget: '+JSON.stringify(value));}
        assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
      }catch(error){group.error=String(error);await save('persistent-prototype-report.json',report);await save('persistent-'+theme+'-failure.png',await b.page.screenshot());throw error;}finally{
        for(const h of [a,b])try{await save('persistent-'+h.slug+'-navigation.json',await h.page.evaluate(()=>fixtureNavigationTrace.capture()));}catch(error){console.error('POWERAMP_PROTO_TRACE_UNAVAILABLE '+h.slug+' '+String(error));}
        await a.context.close();await b.context.close();
      }
    }
    report.failures=failures;await save('persistent-prototype-report.json',report);t.diagnostic('POWERAMP_PERSISTENT_PROTOTYPE '+JSON.stringify(report));assert.deepEqual(failures,[],'canonical endpoint pixel and tracked-geometry gates remain unchanged');
  }finally{await save('persistent-prototype-report.json',report);await browser?.close();await rm(directory,{recursive:true,force:true});}
});
