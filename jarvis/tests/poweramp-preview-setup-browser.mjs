import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {buildPreview} from '../scripts/build-poweramp-preview.mjs';
import {fixtureSceneSettled,installFixtureInputTrace,reportFixtureFailure} from './helpers/poweramp-fixture.js';

// Isolated, serial CI step: absolute input-time setup, without clone-cache warming.
const profile={viewport:{width:519,height:988},deviceScaleFactor:2.0818214416503906,isMobile:true,hasTouch:true};
const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',chromium.executablePath()].find(path=>path&&existsSync(path));
const setupMaxMs=33,cpuThrottling=4;
const hash=value=>createHash('sha256').update(value).digest('hex');
async function saveEvidence(name,value){
  if(!process.env.POWERAMP_EVIDENCE_DIR)return;
  const directory=resolve(process.env.POWERAMP_EVIDENCE_DIR);await mkdir(directory,{recursive:true});await writeFile(join(directory,name+'.json'),JSON.stringify(value,null,2)+'\n');
}
function summarizeSetups(reports){
  const labels=['cold-open','cold-close','repeat-open','repeat-close','playing-open','playing-close'];
  assert.deepEqual(reports.map(report=>report.label),labels,'all cold, repeat and playing opens AND closes are measured');
  for(const report of reports){
    assert.deepEqual(report.operations.map(value=>value.operation),['shared.create','screen.create'],'one real shared setup and its inclusive caller per action');
    const shared=report.operations[0];assert.equal(shared.modelValid,!report.label.startsWith('cold'),'cold model misses are distinct from naturally prepared repeat/playing primitives');
    for(const operation of report.operations){
      assert.equal(operation.direction,report.label.endsWith('open')?'expand':'collapse');
      assert.ok(Number.isFinite(operation.ms)&&operation.ms>=0,'real synchronous setup time');
      assert.ok(operation.ms<=setupMaxMs,'absolute 4x CPU setup ceiling: '+JSON.stringify(report));
      for(const key of ['clones','deepClones','styleEnumerations','cssRulesReads'])assert.equal(operation[key],0,'no hot-path '+key);
    }
    assert.equal(report.appearance.ready,false);assert.equal(report.appearance.pending,false);
    for(const key of ['prepared','hits','cold'])assert.equal(report.appearance[key],0,'no clone appearance-cache '+key);
  }
  return {cpuThrottling,setupMaxMs,max_ms:Math.max(...reports.flatMap(report=>report.operations.map(value=>value.ms))),samples:reports.map(({label,operations})=>({label,operations}))};
}
function installSetupProbe(){
  const motion=fixtureSetupMotion,probe=window.fixtureSetupProbe={active:0,operations:[],clones:0,deepClones:0,styleEnumerations:0,cssRulesReads:0};
  const clone=Node.prototype.cloneNode;Node.prototype.cloneNode=function(deep){if(probe.active){probe.clones++;if(deep)probe.deepClones++;}return clone.call(this,deep);};
  const computed=window.getComputedStyle;window.getComputedStyle=(...args)=>{const style=computed(...args);if(!probe.active)return style;return new Proxy(style,{get(target,key){if(key==='length')probe.styleEnumerations++;const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});};
  const rules=Object.getOwnPropertyDescriptor(CSSStyleSheet.prototype,'cssRules');Object.defineProperty(CSSStyleSheet.prototype,'cssRules',{configurable:true,get(){if(probe.active)probe.cssRulesReads++;return rules.get.call(this);}});
  for(const [owner,operation] of [[motion,'shared.create'],[fixtureSetupScene,'screen.create']]){const create=owner.create;owner.create=function(...args){const scene=args[0],direction=(operation==='shared.create'?scene.target:scene)==='player'?'expand':'collapse',modelValid=!!motion.models&&motion.models.key===motion.modelKey();const before=Object.fromEntries(['clones','deepClones','styleEnumerations','cssRulesReads'].map(key=>[key,probe[key]]));probe.active++;const at=performance.now();try{return create.apply(this,args);}finally{const ms=performance.now()-at;probe.active--;probe.operations.push({operation,direction,modelValid,ms,...Object.fromEntries(Object.keys(before).map(key=>[key,probe[key]-before[key]]))});}};}
  window.fixtureSetupNodes=Object.fromEntries(['player-live-mask','player-live-backdrop-mask','player-live-input','mini-art','mini-title','mini-sub','mini-play','mini-seek','viz'].map(id=>[id,document.getElementById(id)]));
}
async function measureGroup(browser,built,count,evidence){
  const context=await browser.newContext(profile),page=await context.newPage(),errors=[],reports=[];
  const group={tracks:count,reports};evidence.groups.push(group);page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort('blockedbyclient'):route.continue());await context.addInitScript(installFixtureInputTrace);
  const diagnostics=()=>page.evaluate(()=>({screen:PA.Nav.cur,trace:fixtureInputTrace,appearance:powerampPreview.appearanceStatus(),operations:fixtureSetupProbe?.operations,playing:PA.Engine.playing,wantsPlayback:PA.Engine.wantsPlayback()})).then(state=>({...state,errors}));
  try{
    await page.goto(pathToFileURL(built.output).href);await page.waitForFunction(()=>window.powerampPreview?.ready);
    assert.equal(await page.locator('meta[name="poweramp-preview-source-sha256"]').getAttribute('content'),built.sourceHash);
    if(count===5000){await page.locator('#preview-size').tap();await page.waitForFunction(()=>powerampPreview.ready&&powerampPreview.count===5000);}
    await page.evaluate(()=>document.fonts.ready);await page.evaluate(installSetupProbe);
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cpuThrottling});
    const point=(x,y)=>({id:1,x,y,radiusX:1,radiusY:1,force:1}),start=(x,y)=>cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(x,y)]}),move=(x,y)=>cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x,y)]}),end=()=>cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    const frame=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(done)));
    const settled=async screen=>{await page.waitForFunction(fixtureSceneSettled,screen);await frame();await frame();};
    const center=selector=>page.locator(selector).evaluate(node=>{const rect=node.getBoundingClientRect(),x=rect.left+rect.width/2,y=rect.top+rect.height/2,hit=document.elementFromPoint(x,y);if(!hit||!node.contains(hit))throw Error('Real canonical hit target required: '+node.id);return {x,y};});
    await settled('player');await page.locator('[data-nav="library"]').tap();await settled('library');await page.getByRole('button',{name:'All Songs',exact:true}).tap();await settled('list');
    const track=await page.evaluate(()=>PA.Engine.current.id);
    const measure=async(label,action,screen)=>{
      if(!label.startsWith('cold'))await page.waitForFunction(()=>fixtureSetupMotion.models?.key===fixtureSetupMotion.modelKey());
      await page.evaluate(cold=>{fixtureSetupProbe.operations=[];fixtureInputTrace=[];if(cold){fixtureSetupMotion.clearAppearance();fixtureSetupMotion.models=null;}},label.startsWith('cold'));await action();await settled(screen);
      const state=await page.evaluate(()=>({operations:fixtureSetupProbe.operations.slice(),appearance:powerampPreview.appearanceStatus(),screen:PA.Nav.cur,playing:PA.Engine.playing,wantsPlayback:PA.Engine.wantsPlayback(),track:PA.Engine.current.id,trace:fixtureInputTrace.slice(),orphanClones:document.querySelectorAll('.player-scene-layer,.player-scene-art,.player-scene-part').length,activeMasks:document.querySelectorAll('#player-live-mask[data-active],#player-live-backdrop-mask[data-active]').length,inputActive:!!document.querySelector('.player-scene-input'),sameNodes:Object.entries(fixtureSetupNodes).every(([id,node])=>node===document.getElementById(id)&&node.isConnected)}));
      const report={label,...state};reports.push(report);await saveEvidence('preview-setup-persistent-'+count,evidence);
      assert.equal(state.screen,screen);assert.equal(state.track,track);assert.equal(state.orphanClones,0);assert.equal(state.activeMasks,0);assert.equal(state.inputActive,false);assert.equal(state.sameNodes,true,'boot-installed presenter and live widget identities survive every action');assert.equal(state.wantsPlayback,label.startsWith('playing'));assert.ok(state.trace.some(event=>event.type==='pointerdown'&&event.trusted));assert.ok(state.trace.every(event=>event.trusted));return report;
    };
    for(const mode of ['cold','repeat','playing']){
      if(mode==='playing'){await page.evaluate(()=>PA.Engine.play());await page.waitForFunction(()=>PA.Engine.playing&&PA.Engine.wantsPlayback()&&!PA.Engine.el().paused);}
      const origin=await center('#mini-title');
      await measure(mode+'-open',async()=>{
        await start(origin.x,origin.y);
        if(mode==='playing'){
          const height=await page.locator('#sc-list').evaluate(node=>node.clientHeight);await move(origin.x,origin.y-16);await frame();await move(origin.x,origin.y-height*.5);await frame();
          const live=()=>page.evaluate(()=>{const m=(fixtureSetupScene.state||fixtureSetupScene.settling)?.morph;if(!m)throw Error('Expected genuine held persistent scene');return {p:m.p,time:PA.Engine.time(),fill:document.querySelector('#mini-fill').style.transform,current:document.querySelector('#t-cur').textContent,play:document.querySelector('#mini-play').getAttribute('aria-label'),fullPlay:document.querySelector('#btn-play').getAttribute('aria-label'),sameOwner:m.pairs.play.mini===fixtureSetupNodes['mini-play']&&m.pairs.seek.mini===fixtureSetupNodes['mini-seek'],playing:PA.Engine.playing,wantsPlayback:PA.Engine.wantsPlayback()};});
          const before=await live();await page.waitForTimeout(180);const after=await live();group.livePlaying={before,after};assert.equal(after.playing,true);assert.equal(after.wantsPlayback,true);assert.equal(after.sameOwner,true);assert.ok(after.time>before.time,'real simulated Engine playback advances while held');assert.ok(after.fill&&after.fill!==before.fill,'actual live mini progress advances');assert.ok(after.current);assert.equal(after.play,'Pause');assert.equal(after.play,after.fullPlay,'live shared glyph shows the current real play state');assert.ok(Math.abs(after.p-.5)<.00001);
        }
        await end();
      },'player');
      const art=await center('#artA');await measure(mode+'-close',async()=>{await start(art.x,art.y);await move(art.x,art.y+169);await frame();await end();},'list');
      assert.equal(await page.evaluate(()=>{const list=document.querySelector('#sc-list'),mini=document.querySelector('#mini');return !list.hidden&&!list.inert&&getComputedStyle(list).opacity==='1'&&!mini.hidden&&getComputedStyle(mini).opacity==='1'&&!!document.querySelector('#list-body .trow');}),true,'close restores the live visible library and mini player');
    }
    group.summary=summarizeSetups(reports);await page.evaluate(()=>PA.Engine.pause());await page.waitForFunction(()=>!PA.Engine.wantsPlayback()&&PA.Engine.el().paused);assert.deepEqual(errors,[]);group.errors=errors;await saveEvidence('preview-setup-persistent-'+count,evidence);return group;
  }catch(error){group.failure={error:String(error),state:await diagnostics().catch(()=>null)};await saveEvidence('preview-setup-persistent-'+count,evidence);await reportFixtureFailure({page,diagnostics},error,'preview-setup-persistent-'+count);throw error;}
  finally{await context.close();}
}

test('persistent setup summary rejects missing, slow or clone-based opens and closes',()=>{
  const labels=['cold-open','cold-close','repeat-open','repeat-close','playing-open','playing-close'];
  const samples=()=>labels.map(label=>({label,appearance:{ready:false,pending:false,prepared:0,hits:0,cold:0},operations:['shared.create','screen.create'].map(operation=>({operation,modelValid:!label.startsWith('cold'),direction:label.endsWith('open')?'expand':'collapse',ms:12,clones:0,deepClones:0,styleEnumerations:0,cssRulesReads:0}))}));
  assert.equal(summarizeSetups(samples()).max_ms,12);assert.throws(()=>summarizeSetups(samples().slice(1)),/opens AND closes/);
  for(const key of ['ms','clones','deepClones','styleEnumerations','cssRulesReads']){const reports=samples();reports[0].operations[0][key]=key==='ms'?34:1;assert.throws(()=>summarizeSetups(reports));}
  const cached=samples();cached[0].appearance.hits=1;assert.throws(()=>summarizeSetups(cached),/appearance-cache/);
});

test('Poweramp isolated persistent cold, repeat and playing open/close setup at 4x CPU',{timeout:180000},async t=>{
  assert.ok(executablePath,'Chromium is required: install it or set JARVIS_CHROME');const directory=await mkdtemp(join(tmpdir(),'poweramp-setup-persistent-'));let browser;
  try{
    const built=await buildPreview(join(directory,'preview.html'));assert.equal(hash(await readFile(built.output)),built.sha256,'canonical production preview matches its generated hash');
    let html=await readFile(built.output,'utf8');assert.equal(html.split('window.PA = {').length,2,'one fixture-only read-access anchor');html=html.replace('window.PA = {','window.fixtureSetupMotion=SharedPlayerMotion;window.fixtureSetupScene=ScreenDrag;window.PA = {');await writeFile(built.output,html);const measuredSha256=hash(await readFile(built.output));
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    const evidence={source:built.sourceHash,previewSha256:built.sha256,measuredSha256,profile,cpuThrottling,setupMaxMs,metric:'Observed synchronous SharedPlayerMotion.create and inclusive ScreenDrag.create time for trusted input; nested times overlap. No cache preparation, comparative ratio, phone FPS or touch-latency claim.',groups:[]};
    for(const count of [60,5000])await t.test(count+' tracks',async()=>{const group=await measureGroup(browser,built,count,evidence);t.diagnostic('POWERAMP_PERSISTENT_SETUP '+JSON.stringify({source:built.sourceHash,tracks:count,summary:group.summary,livePlaying:group.livePlaying}));});
    assert.equal(hash(await readFile(built.output)),measuredSha256,'instrumented measured HTML unchanged after both contexts');
  }finally{await browser?.close();await rm(directory,{recursive:true,force:true});}
});
