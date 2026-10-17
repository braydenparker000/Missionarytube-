import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {buildPreview} from '../scripts/build-poweramp-preview.mjs';
import {fixtureSceneSettled,installFixtureInputTrace,mobileContext,reportFixtureFailure} from './helpers/poweramp-fixture.js';

// Match the owner's report geometry/raster scale for timing evidence. The
// mandatory scene contracts retain their independent 393×852 touch coverage.
const previewProfile={...mobileContext,viewport:{width:519,height:988},deviceScaleFactor:2.0818214416503906};

const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',chromium.executablePath()].find(p=>p&&existsSync(p));

// Real generated HTML and trusted CDP contacts. These reports measure inclusive
// synchronous runtime work and RAF callback gaps, never phone FPS/input latency.
test('Poweramp downloaded preview trusted mini motion and operation evidence',{timeout:120000},async t=>{
  assert.ok(executablePath,'Chromium is required: install it or set JARVIS_CHROME');
  const directory=await mkdtemp(join(tmpdir(),'poweramp-preview-motion-'));let browser;
  try{
    const built=await buildPreview(join(directory,'preview.html'));
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    for(const count of [60,5000])await t.test(count+'-song first and repeated mini opens, held drag, and regrab',async()=>{
      const context=await browser.newContext(previewProfile),page=await context.newPage(),errors=[],reports=[];
      let failureName='preview-mini-motion-'+count;
      page.setDefaultTimeout(5000);page.on('pageerror',error=>errors.push(error.message));
      await context.addInitScript(installFixtureInputTrace);
      const diagnostics=()=>page.evaluate(()=>({screen:PA.Nav.cur,preview:powerampPreview.count,mini:{inert:document.querySelector('#mini').inert,hidden:document.querySelector('#mini').hidden},
        sharedPlane:!!document.querySelector('.player-scene-input'),history:{active:!!PA.LibraryPageMotion.state,pending:!!PA.LibraryPageMotion.finish},
        viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},sheet:{open:PA.Sheets.open,inert:document.querySelector('#sheet').inert,on:document.querySelector('#sheet').classList.contains('on')},help:{text:document.querySelector('#preview-help').textContent,handler:typeof document.querySelector('#preview-help').onclick},trace:window.fixtureInputTrace}));
      try{
        await context.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort('blockedbyclient'):route.continue());
        await page.goto(pathToFileURL(built.output).href);await page.waitForFunction(()=>window.powerampPreview?.ready);
        if(count===5000){await page.locator('#preview-size').tap();await page.waitForFunction(()=>powerampPreview.ready&&powerampPreview.count===5000);}
        const frame=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(done)));
        const settled=async screen=>{await page.waitForFunction(fixtureSceneSettled,screen);await frame();await frame();};
        const library=async()=>{await page.locator('[data-nav="library"]').tap();await settled('library');await page.getByRole('button',{name:'All Songs',exact:true}).tap();await settled('list');};
        const cdp=await context.newCDPSession(page),point=(x,y)=>({id:1,x,y,radiusX:1,radiusY:1,force:1});
        const start=(x,y)=>cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(x,y)]});
        const move=(x,y)=>cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x,y)]});
        const end=()=>cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        const target=async()=>{
          const result=await page.locator('#mini-title').evaluate(n=>{const r=n.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,hit:hit?.id||hit?.tagName,reachable:!!hit&&n.contains(hit),mini:!!hit?.closest('#mini')};});
          assert.equal(result.reachable,true,'mini-title geometry must hit its real title, got '+result.hit);assert.equal(result.mini,true);return result;
        };
        const measure=async(label,perform)=>{
          await page.locator('#preview-help').tap();await page.getByRole('button',{name:'Measure 30 seconds',exact:true}).tap();
          await page.waitForFunction(()=>document.getElementById('preview-help').textContent==='●');
          await page.evaluate(()=>{window.fixtureInputTrace=[];});await frame();
          await perform();await settled('player');
          // Inspect through the actual dialog using trusted native mouse clicks,
          // keeping post-drag touch compatibility-click timing out of the motion
          // report. A separate trusted touch Help path is checked below.
          await page.locator('#preview-help').click();await page.getByRole('button',{name:'Show diagnostics',exact:true}).click();
          const report=JSON.parse(await page.locator('#preview-diagnostics-report').inputValue());
          await page.getByRole('button',{name:'Close',exact:true}).click();
          assert.ok(report.operations?.some(operation=>operation.operation==='shared.create'&&operation.phase==='shared:setup:expand'),'report includes the real shared-player setup work');
          assert.equal(report.final.screen,'player');assert.equal(report.final.scene,null);
          const trace=await page.evaluate(()=>fixtureInputTrace);assert.ok(trace.some(event=>event.type==='pointerdown'&&event.miniTitle&&event.trusted));assert.ok(trace.every(event=>event.trusted));
          assert.ok(trace.some(event=>event.type==='click'&&event.target.includes('#preview-help')&&event.trusted),'readback uses a real trusted Help click');
          reports.push({label,...report});
        };
        const id=await page.evaluate(()=>PA.Engine.current.id);
        for(const label of ['first-mini-tap','repeated-mini-tap']){
          await library();const p=await target();await measure(label,async()=>{await start(p.x,p.y);await end();assert.equal(await page.evaluate(()=>PA.Nav.cur),'player');});
        }
        await library();let p=await target();
        await measure('held-mini-drag',async()=>{
          await start(p.x,p.y);for(const dy of [16,40,75,110]){await move(p.x,p.y-dy);await frame();}
          assert.equal(await page.locator('#mini[data-shared-player] #mini-art').count(),1,'held drag keeps exactly one real shared artwork owner');
          assert.equal(await page.evaluate(()=>PA.Nav.cur),'list');await end();assert.equal(await page.evaluate(()=>PA.Nav.cur),'player');
        });
        await library();p=await target();
        await measure('regrab-mini-settle',async()=>{
          await start(p.x,p.y);await move(p.x,p.y-110);await frame();const release=end(),regrab=start(3,100);await Promise.all([release,regrab]);
          assert.equal(await page.evaluate(()=>PA.Nav.cur),'player');
          const frozen=await page.locator('#mini[data-shared-player] #mini-art').boundingBox();assert.ok(frozen);
          await page.waitForTimeout(280);const held=await page.locator('#mini[data-shared-player] #mini-art').boundingBox();assert.ok(held);
          for(const key of ['x','y','width','height'])assert.ok(Math.abs(frozen[key]-held[key])<2,'regrab freezes '+key);
          const trace=await page.evaluate(()=>fixtureInputTrace);assert.ok(trace.some(event=>event.type==='pointerdown'&&event.target.includes('player-scene-input')&&event.trusted),'regrab hits the actual shared scene plane');await end();
        });
        assert.equal(await page.evaluate(()=>PA.Engine.current.id),id);assert.deepEqual(errors,[]);
        const evidence={source:built.sourceHash,tracks:count,profile:previewProfile,metric:'Synchronous inclusive operation times and RAF callback gaps. Nested costs overlap; these are not phone FPS or touch latency.',reports};
        if(process.env.POWERAMP_EVIDENCE_DIR){const output=resolve(process.env.POWERAMP_EVIDENCE_DIR);await mkdir(output,{recursive:true});await writeFile(join(output,'preview-mini-motion-'+count+'.json'),JSON.stringify(evidence,null,2)+'\n');}
        // This control regression is distinct from timing readback. It uses
        // the same trusted held mini drag followed by a fresh real touch tap,
        // without a sleep, synthetic click, retry, or direct Help invocation.
        failureName='preview-help-touch-'+count;await library();p=await target();await page.evaluate(()=>{window.fixtureInputTrace=[];});
        await start(p.x,p.y);for(const dy of [16,40,75,110]){await move(p.x,p.y-dy);await frame();}await end();await settled('player');
        const sheetRequest=await page.evaluate(()=>PA.Sheets.request);
        await page.locator('#preview-help').tap();await page.waitForFunction(()=>PA.Sheets.open==='sheet'&&!document.querySelector('#sheet').inert&&document.querySelector('#sheet').classList.contains('on'));
        assert.ok(await page.evaluate(()=>fixtureInputTrace.some(event=>event.type==='pointerup'&&event.target.includes('#preview-help')&&event.pointerType==='touch'&&event.trusted&&event.observation==='bubble'&&event.prevented&&event.after.sheet==='sheet')),'post-drag trusted Help touch release opens the real sheet without depending on a compatibility click');
        assert.equal(await page.evaluate(()=>PA.Sheets.request),sheetRequest+1,'one real Help touch opens one sheet');
        await page.getByRole('button',{name:'Show diagnostics',exact:true}).tap();await page.locator('#preview-diagnostics-report').waitFor({state:'visible'});await page.getByRole('button',{name:'Close',exact:true}).tap();assert.deepEqual(errors,[]);
        t.diagnostic('POWERAMP_BROWSER_TIMINGS '+JSON.stringify({source:built.sourceHash,tracks:count,reports:reports.map(report=>({label:report.label,operations:report.operations,phase_gap_ms:report.phase_gap_ms,raf_gap_ms:report.raf_gap_ms}))}));
      }catch(error){await reportFixtureFailure({page,diagnostics},error,failureName);throw error;}
      finally{await context.close();}
    });
  }finally{await browser?.close();await rm(directory,{recursive:true,force:true});}
});
