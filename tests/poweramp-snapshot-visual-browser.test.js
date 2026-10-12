import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright-core';
import {fixtureCover,instrumentFixtureBoot,fixtureSceneSettled,installFixtureInputTrace,installPowerampFixture,reportFixtureFailure,servePowerampFixture,sourceFlags} from './helpers/poweramp-fixture.js';
import {compareScreenshotPNG} from './helpers/poweramp-png.js';

const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
const ownerViewport={viewport:{width:519,height:988},deviceScaleFactor:2.0818214416503906,isMobile:true,hasTouch:true};
const geometryTolerance=.05;
// Exact canonical endpoints retain the original tight rasterization allowances.
// v7's double labels/icons and ghost controls are retained as held-pose evidence,
// while the intentionally single-owner presentation is gated independently.
const pixelLimits={channelTolerance:2,changedFraction:.0005,meanChannelDelta:.05,regionChangedFraction:.003};
const rectKeys=['left','top','width','height'];
const near=(a,b,label,tolerance=geometryTolerance)=>assert.ok(Math.abs(a-b)<=tolerance,`${label}: ${a} vs ${b} (limit ${tolerance})`);
const rectNear=(a,b,label)=>{for(const key of rectKeys)near(a[key],b[key],label+'.'+key);};
async function saveEvidence(name,value){
  if(!process.env.POWERAMP_EVIDENCE_DIR)return;
  const directory=resolve(process.env.POWERAMP_EVIDENCE_DIR);await mkdir(directory,{recursive:true});await writeFile(join(directory,name),Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n');
}
async function openVisualPage(browser,fixture,{theme,baseline=false,art=true}){
  const context=await browser.newContext(ownerViewport),page=await context.newPage(),errors=[];page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort('blockedbyclient'));
  await context.addInitScript(flags=>localStorage.setItem('drawercast.sources.v1',JSON.stringify(flags)),sourceFlags);await context.addInitScript(installFixtureInputTrace);
  let playerSource=await readFile(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
  assert.equal(playerSource.split('window.PA = {').length,2,'one fixture-only motion read-access anchor');
  if(baseline){
    // Use the retained complete snapshot renderer, with cold exhaustive capture.
    // No production file is edited and no CSS sheet is disabled or fabricated.
    assert.ok(playerSource.includes('const SnapshotReferenceMotion='),'explicit snapshot reference exists');
    playerSource=playerSource.replace('const ScreenDrag={',"Object.assign(SharedPlayerMotion,SnapshotReferenceMotion,{appearanceEnabled:false,install(){},setMiniLabel(node,text){node.textContent=text;}});\nconst ScreenDrag={");
  }
  playerSource=playerSource.replace('window.PA = {','window.fixtureActualMotion=SharedPlayerMotion;window.fixtureRawScene=()=>ScreenDrag.state||ScreenDrag.settling;window.PA = {');
  await context.route('**/drawercast/player.js*',route=>route.fulfill({contentType:'application/javascript',body:instrumentFixtureBoot(playerSource)}));
  await page.goto(fixture.origin+'/drawercast/');await page.waitForFunction(()=>window.PA?.R2Source.manifestURL==='fixture-disabled');await page.evaluate(()=>window.__powerampBootPromise);await page.evaluate(installPowerampFixture,{origin:fixture.origin,count:60,art});
  await page.evaluate(async theme=>{
    PA.SET.uiTheme=theme;PA.applySettings('uiTheme');PA.UI.renderPlayState();PA.Engine.seek(42);
    PA.Waveform.accept({duration:180,peaks:Array.from({length:2880},(_,i)=>40+(i*37+i%17*13)%205)});PA.UI.renderProgress();PA.UI.drawViz();await document.fonts.ready;
    window.fixtureVisualNodes=Object.fromEntries(['mini-art','mini-title','mini-sub','mini-play','mini-seek','viz','sc-player','player-live-mask','player-live-backdrop-mask','player-live-input'].map(id=>[id,document.getElementById(id)]));
  },theme);
  assert.equal(await page.evaluate(()=>document.body.classList.contains('theme-light')),theme==='light');
  const cdp=await context.newCDPSession(page),point=(x,y)=>({id:1,x,y,radiusX:1,radiusY:1,force:1});
  const start=(x,y)=>cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(x,y)]}),move=(x,y)=>cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x,y)]}),end=()=>cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const frame=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(done)));
  const settled=async screen=>{await page.waitForFunction(fixtureSceneSettled,screen);await frame();await frame();};
  const center=async selector=>{const r=await page.locator(selector).boundingBox();assert.ok(r,'visible '+selector);return {x:r.x+r.width/2,y:r.y+r.height/2};};
  const quiet=async()=>{if(art)await page.waitForFunction(()=>!!document.querySelector('#bg-art').style.backgroundImage);await page.waitForFunction(()=>document.getAnimations().every(animation=>animation.playState==='finished'||animation.playState==='idle'));await frame();await frame();};
  const library=async()=>{await page.locator('[data-nav="library"]').tap();await settled('library');await page.getByRole('button',{name:'All Songs',exact:true}).tap();await settled('list');await quiet();};
  const diagnostics=()=>page.evaluate(()=>({theme:PA.SET.uiTheme,screen:PA.Nav.cur,time:PA.Engine.time(),scene:fixtureRawScene()?{p:fixtureRawScene().morph?.p,height:fixtureRawScene().height}:null,activeInput:!!document.querySelector('.player-scene-input'),activeMasks:document.querySelectorAll('#player-live-mask[data-active],#player-live-backdrop-mask[data-active]').length,trace:fixtureInputTrace,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio}})).then(state=>({...state,errors}));
  await settled('player');await quiet();return {context,page,errors,baseline,start,move,end,frame,settled,center,library,quiet,diagnostics,close:()=>context.close()};
}
async function canonical(h,screen){
  if(screen==='list')await h.library();else{await h.library();await h.page.locator('#mini-title').tap();await h.settled('player');await h.quiet();}
  await h.page.evaluate(()=>{PA.Engine.seek(42);PA.UI.renderProgress();PA.UI.drawViz();});await h.frame();await h.frame();
  const state=await h.page.evaluate(()=>{
    const root=document.querySelector('#sc-'+PA.Nav.cur),r=root.getBoundingClientRect();
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};
    return {screen:PA.Nav.cur,hidden:root.hidden,inert:root.inert,opacity:getComputedStyle(root).opacity,visibility:getComputedStyle(root).visibility,time:PA.Engine.time(),geometry:{surface:{left:r.left,top:r.top,width:r.width,height:r.height},art:rect(document.querySelector(PA.Nav.cur==='player'?'#artstage':'#mini-art')),title:rect(document.querySelector(PA.Nav.cur==='player'?'#p-title':'#mini-title'))},activeInput:!!document.querySelector('.player-scene-input'),activeMasks:document.querySelectorAll('#player-live-mask[data-active],#player-live-backdrop-mask[data-active]').length,orphanClones:document.querySelectorAll('.player-scene-layer,.player-scene-art,.player-scene-part').length};
  });
  assert.equal(state.screen,screen);assert.equal(state.hidden,false);assert.equal(state.inert,false);assert.equal(state.opacity,'1');assert.equal(state.visibility,'visible');assert.equal(state.time,42);assert.equal(state.activeInput,false);assert.equal(state.activeMasks,0);assert.equal(state.orphanClones,0);
  if(!h.baseline)assert.equal(await h.page.evaluate(()=>Object.entries(fixtureVisualNodes).every(([id,node])=>node===document.getElementById(id)&&node?.isConnected)),true,'all real widgets and boot-installed presenter survive retirement');
  return {label:'endpoint-'+screen,state,png:await h.page.screenshot({fullPage:false,animations:'allow',scale:'device',timeout:8000})};
}
async function snapshot(h,{label,expectedProgress}){
  const state=await h.page.evaluate(()=>{
    const scene=fixtureRawScene(),m=scene?.morph;if(!m||!document.querySelector('.player-scene-input'))throw Error('Expected actual held shared scene and contact plane');
    const rect=node=>{const r=node.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};},geometry={surface:rect(m.mask||m.surface)};
    for(const key of ['art','title','sub','play','seek'])geometry[key]=rect(key==='art'&&!m.mask?m.art:m.pairs[key].mini);
    const persistent=!!m.mask,owners=persistent?Object.fromEntries(Object.entries(m.pairs).map(([key,nodes])=>[key,{sameNode:nodes.mini===fixtureVisualNodes['mini-'+key],mini:getComputedStyle(nodes.mini).opacity,full:getComputedStyle(key==='art'?m.A:nodes.full).opacity,overflow:getComputedStyle(nodes.mini).overflow,rect:rect(nodes.mini)}])):null;
    const full=document.querySelector('#sc-player');
    return {p:m.p,geometry,endpoints:m.endpoints,persistent,owners,fullOpacity:getComputedStyle(full).opacity,mask:persistent?{overflow:getComputedStyle(m.mask).overflow,backdropOverflow:getComputedStyle(m.backgroundMask).overflow,containsFull:m.content.contains(full),layers:document.querySelectorAll('#player-live-mask[data-active],#player-live-backdrop-mask[data-active]').length,inputSame:m.input===fixtureVisualNodes['player-live-input']}:null,
      art:{image:getComputedStyle(persistent?m.pairs.art.mini:m.artNodes.mini).backgroundImage,placeholder:getComputedStyle((persistent?m.pairs.art.mini:m.artNodes.mini).querySelector('.ph')).display},
      theme:PA.SET.uiTheme,time:PA.Engine.time(),playing:PA.Engine.wantsPlayback(),track:PA.Engine.current.id,canvas:{width:document.querySelector('#viz').width,height:document.querySelector('#viz').height,sameNode:document.querySelector('#viz')===fixtureVisualNodes.viz,paintVersion:PA.UI.vizPaintVersion},
      cache:{mode:fixtureActualMotion.captureMode,ready:!!fixtureActualMotion.preparedAppearance,...fixtureActualMotion.appearanceStats},orphanClones:document.querySelectorAll('.player-scene-layer,.player-scene-art,.player-scene-part').length,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},trace:fixtureInputTrace.slice(-24)};
  });
  near(state.p,expectedProgress,label+' held progress',.00001);assert.equal(state.time,42);assert.equal(state.playing,false);assert.equal(state.cache.ready,false,'no snapshot preparation is used');
  assert.ok(state.trace.some(event=>event.type==='pointerdown'&&event.trusted));assert.ok(state.trace.every(event=>event.trusted),'genuine trusted touch input');
  for(const [key,pair] of Object.entries(state.endpoints))rectNear(state.geometry[key],Object.fromEntries(rectKeys.map(prop=>[prop,pair.mini[prop]+(pair.full[prop]-pair.mini[prop])*expectedProgress])),label+' '+key+' lerp');
  if(!h.baseline){
    assert.equal(state.persistent,true);assert.equal(state.cache.mode,'persistent');assert.equal(state.orphanClones,0);assert.equal(state.mask.layers,2);assert.equal(state.mask.inputSame,true);assert.equal(state.mask.containsFull,true);assert.equal(state.mask.overflow,'hidden');assert.equal(state.mask.backdropOverflow,'hidden');assert.equal(state.canvas.sameNode,true);
    near(Number(state.fullOpacity),Math.max(0,Math.min(1,(state.p-.8)/.2)),label+' late full-only reveal',.000001);
    for(const [key,owner] of Object.entries(state.owners)){
      assert.equal(owner.sameNode,true,key+' has the original live shared owner');assert.equal(owner.full,'0',key+' canonical full duplicate is suppressed');near(Number(owner.mini),key==='seek'?1-state.p:1,key+' single-owner visibility',.000001);
      const r=owner.rect,surface=state.geometry.surface;assert.ok(r.width>0&&r.height>0,key+' owns nonempty painted geometry');
      assert.ok(r.left>=surface.left-geometryTolerance&&r.top>=surface.top-geometryTolerance&&r.left+r.width<=surface.left+surface.width+geometryTolerance&&r.top+r.height<=surface.top+surface.height+geometryTolerance,key+' shared root fits its reveal surface without clipping');
      assert.ok(r.left>=-geometryTolerance&&r.top>=-geometryTolerance&&r.left+r.width<=state.viewport.width+geometryTolerance&&r.top+r.height<=state.viewport.height+geometryTolerance,key+' stays in viewport');
    }
  }
  const before=state.geometry.art;await h.frame();await h.frame();rectNear(await h.page.evaluate(()=>{const m=fixtureRawScene().morph,r=(m.mask?m.pairs.art.mini:m.art).getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};}),before,label+' contact holds painted geometry');
  return {label,state,png:await h.page.screenshot({fullPage:false,animations:'allow',scale:'device',timeout:8000})};
}
async function hold(h,progress){
  const origin=await h.center('#mini-title');await h.start(origin.x,origin.y);await h.move(origin.x,origin.y-16);await h.frame();const height=await h.page.locator('#sc-list').evaluate(node=>node.clientHeight);
  assert.equal(await h.page.locator('.player-scene-input').count(),1);await h.move(origin.x,origin.y-height*progress);await h.frame();await h.frame();return {origin,height};
}
async function standardSnapshots(h){
  const endpoints=[await canonical(h,'list'),await canonical(h,'player')],shots=[];await h.library();const {origin,height}=await hold(h,.25);
  for(const p of [.25,.5,.75]){if(p!==.25){await h.move(origin.x,origin.y-height*p);await h.frame();await h.frame();}shots.push(await snapshot(h,{label:'held-'+String(p).replace('.',''),expectedProgress:p}));}
  await h.end();await h.settled('player');await h.library();await hold(h,.25);
  const ending=h.end(),grabbing=h.start(3,500);await Promise.all([ending,grabbing]);
  const frozen=await h.page.evaluate(()=>{const scene=fixtureRawScene(),m=scene?.morph;if(!m)throw Error('Regrab must reach live scene');const r=(m.mask?m.pairs.art.mini:m.art).getBoundingClientRect();return {p:m.p,height:scene.height,art:{left:r.left,top:r.top,width:r.width,height:r.height}};});
  await h.page.waitForTimeout(280);rectNear(await h.page.evaluate(()=>{const m=fixtureRawScene().morph,r=(m.mask?m.pairs.art.mini:m.art).getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};}),frozen.art,'trusted regrab freezes beyond old settle duration');
  await h.move(3,520);await h.frame();await h.move(3,500+(frozen.p-.5)*frozen.height);await h.frame();await h.frame();const regrab=await snapshot(h,{label:'regrab-held-05',expectedProgress:.5});assert.ok(regrab.state.trace.some(event=>event.type==='pointerdown'&&event.target?.includes('player-scene-input')&&event.trusted));shots.push(regrab);
  const expected=await h.page.evaluate(delta=>{const scene=fixtureRawScene(),deliberate=Math.abs(delta)>Math.max(44,Math.min(scene.height,300)*.2),commit=deliberate?scene.direction*delta>0:scene.commit;return commit?scene.target:scene.fromName;},(frozen.p-.5)*frozen.height);await h.end();await h.settled(expected);shots.push(await canonical(h,expected));return {endpoints,shots};
}
async function lateArtworkSnapshot(h){
  await h.library();await h.page.evaluate(svg=>{
    const track=PA.Engine.current;track.artKey='snapshot-late-fixture';const original=PA.IDB.get,resolvers=[];window.fixtureLateArtRequested=false;
    PA.IDB.get=function(store,key){if(store==='art'&&String(key).startsWith(track.artKey)){fixtureLateArtRequested=true;return new Promise(resolve=>resolvers.push(resolve));}return original.call(this,store,key);};
    window.fixtureReleaseLateArt=()=>{const blob=new Blob([svg],{type:'image/svg+xml'});for(const resolve of resolvers)resolve(blob);PA.IDB.get=original;};window.fixtureLateRender=PA.UI.renderNowPlaying(track);
  },fixtureCover(4));
  await h.page.waitForFunction(()=>fixtureLateArtRequested);await hold(h,.5);const before=await snapshot(h,{label:'late-art-placeholder-05',expectedProgress:.5});
  await h.page.evaluate(async()=>{fixtureReleaseLateArt();await fixtureLateRender;});await h.page.waitForFunction(()=>document.querySelector('#artA').classList.contains('has')&&document.querySelector('#mini-art').classList.contains('has')&&!!document.querySelector('#bg-art').style.backgroundImage);await h.quiet();
  const after=await snapshot(h,{label:'late-art-held-05',expectedProgress:.5});rectNear(after.state.geometry.art,before.state.geometry.art,'late decoded artwork keeps the owned held pose');assert.notEqual(after.state.art.image,'none');assert.equal(after.state.art.placeholder,'none');assert.notEqual(after.state.art.image,before.state.art.image,'delayed decoded art replaces the held placeholder');
  if(!h.baseline)assert.equal(await h.page.evaluate(()=>document.querySelector('#mini-art').style.backgroundImage===document.querySelector('#artA').style.backgroundImage&&document.querySelector('.player-live-bg-art').style.backgroundImage===document.querySelector('#bg-art').style.backgroundImage),true,'live cover and backdrop receive the actual late producer art');
  await h.end();await h.settled('player');await canonical(h,'player');return after;
}
async function heldWaveformAndTheme(h){
  await h.library();const {origin,height}=await hold(h,.9);
  const paint=()=>h.page.evaluate(()=>{const canvas=document.querySelector('#viz'),bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let checksum=2166136261;for(const value of bytes)checksum=Math.imul(checksum^value,16777619)>>>0;return {checksum,width:canvas.width,height:canvas.height,version:PA.UI.vizPaintVersion,color:getComputedStyle(document.querySelector('#mini-title')).color};});
  const before=await paint(),pose=await snapshot(h,{label:'waveform-before-09',expectedProgress:.9});
  await h.page.evaluate(()=>{PA.Waveform.accept({duration:180,peaks:Array.from({length:2880},(_,i)=>i%23<3?255:9)});PA.UI.drawViz();});await h.frame();const wave=await paint();assert.ok(wave.version>before.version);assert.notEqual(wave.checksum,before.checksum,'held actual waveform canvas receives fresh renderer pixels');
  await h.page.evaluate(()=>{PA.SET.uiTheme=PA.SET.uiTheme==='dark'?'light':'dark';PA.applySettings('uiTheme');PA.UI.drawViz();});await h.frame();await h.frame();const themed=await paint(),after=await snapshot(h,{label:'waveform-theme-held-09',expectedProgress:.9});assert.notEqual(themed.color,before.color,'live owner inherits the changed theme');assert.ok(themed.version>wave.version);assert.notEqual(themed.checksum,wave.checksum,'theme repaints the real held waveform');for(const key of Object.keys(pose.state.geometry))rectNear(after.state.geometry[key],pose.state.geometry[key],'wave/theme retains '+key+' pose');assert.equal(after.state.canvas.sameNode,true);await saveEvidence('snapshot-visual-'+pose.state.theme+'-live-waveform-theme.json',{before,wave,themed,pose:pose.state,after:after.state});await saveEvidence('snapshot-visual-'+pose.state.theme+'-live-waveform-theme.png',after.png);
  // Finish using the same trusted contact, then verify no painted owner survives.
  await h.move(origin.x,origin.y-height*.95);await h.frame();await h.end();await h.settled('player');await canonical(h,'player');
}
async function compareAndRecord(baseline,candidate,theme,t,{endpoint=false}={}){
  assert.equal(candidate.label,baseline.label);const name='snapshot-visual-'+theme+'-'+baseline.label,regions=Object.fromEntries(Object.entries(baseline.state.geometry).map(([key,r])=>[key,Object.fromEntries(rectKeys.map(prop=>[prop,r[prop]*ownerViewport.deviceScaleFactor]))]));
  const pixels=compareScreenshotPNG(baseline.png,candidate.png,{channelTolerance:pixelLimits.channelTolerance,regions});
  const report={name,scope:endpoint?'Canonical endpoints: unchanged tight pixel and geometry gates.':'Held reference evidence: intentional removal of duplicate v7 labels/icons and ghost controls. Single-owner geometry, visibility, no clipping and continuity are independently gated.',limits:{geometryTolerance,pixelLimits},baseline:baseline.state,candidate:candidate.state,pixels};
  await Promise.all([saveEvidence(name+'-baseline.png',baseline.png),saveEvidence(name+'-live.png',candidate.png),saveEvidence(name+'.json',report)]);t.diagnostic('POWERAMP_SNAPSHOT_VISUAL '+JSON.stringify({name,endpoint,pixels}));
  for(const [key,r] of Object.entries(baseline.state.geometry))rectNear(candidate.state.geometry[key],r,name+' '+key);
  if(endpoint){assert.ok(pixels.changedFraction<=pixelLimits.changedFraction,name+' bounded endpoint changed pixels: '+pixels.changedFraction);assert.ok(pixels.meanChannelDelta<=pixelLimits.meanChannelDelta,name+' bounded endpoint mean delta: '+pixels.meanChannelDelta);for(const [region,result] of Object.entries(pixels.regions))assert.ok(result.changedFraction<=pixelLimits.regionChangedFraction,name+' '+region+' bounded endpoint region pixels: '+result.changedFraction);}
}

// Runtime evidence is mandatory: missing or broken Chrome is never a skip.
test('Poweramp persistent live-owner visuals, exact canonical endpoints and dynamic held producers',{timeout:180000},async t=>{
  assert.ok(executablePath,'Chromium is required: install it or set JARVIS_CHROME');const fixture=await servePowerampFixture();let browser;
  try{
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    for(const theme of ['dark','light'])await t.test(theme+' endpoint pixels, tracked/regrab ownership, delayed art and waveform/theme',async()=>{
      const paired={baseline:[],live:[]},endpoints={baseline:[],live:[]};
      for(const baseline of [true,false])for(const art of [true,false]){
        const mode=baseline?'baseline':'live',h=await openVisualPage(browser,fixture,{theme,baseline,art});
        try{if(art){const result=await standardSnapshots(h);endpoints[mode]=result.endpoints;paired[mode].push(...result.shots.slice(0,4));if(!baseline)await heldWaveformAndTheme(h);}else paired[mode].push(await lateArtworkSnapshot(h));assert.deepEqual(h.errors,[]);assert.equal(await h.page.evaluate(()=>PA.Engine.wantsPlayback()),false);}
        catch(error){await reportFixtureFailure(h,error,'snapshot-visual-'+theme+'-'+mode+'-'+(art?'standard':'late-art'));throw error;}finally{await h.close();}
      }
      assert.equal(paired.baseline.length,5);assert.equal(paired.live.length,5);const failures=[];
      for(const [old,next,endpoint] of [...endpoints.baseline.map((shot,index)=>[shot,endpoints.live[index],true]),...paired.baseline.map((shot,index)=>[shot,paired.live[index],false])])try{await compareAndRecord(old,next,theme,t,{endpoint});}catch(error){failures.push({case:old.label,error:String(error)});}
      assert.deepEqual(failures,[],theme+' endpoint pixel and single-owner geometry gates');
    });
    assert.equal(fixture.requests.audio,0,'visual QA never fetches or plays audio');
  }finally{await browser?.close();await fixture.close();}
});
