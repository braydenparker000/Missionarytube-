import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {buildPreview} from '../scripts/build-poweramp-preview.mjs';
import {mobileContext} from './helpers/poweramp-fixture.js';

// This is the downloaded HTML, its classic runtime, its production boot order,
// and Preview.prepare()/finish()/reset(). It does NOT replace app objects with
// installPowerampFixture(). Missing/unlaunchable Chromium is a failure, no skip.
const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
test('Poweramp downloaded offline HTML trusted broad library history',{timeout:120000},async t=>{
  assert.ok(executablePath,'Chromium is required: install it or set JARVIS_CHROME');
  const directory=await mkdtemp(join(tmpdir(),'poweramp-downloaded-history-'));let browser;
  try{
    const result=await buildPreview(join(directory,'preview.html'));
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    for(const count of [60,5000])await t.test(count+'-song category-click history retains transferred touch capture',async()=>{
      const context=await browser.newContext(mobileContext),page=await context.newPage(),errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      try{
        await context.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort('blockedbyclient'):route.continue());
        await page.goto(pathToFileURL(result.output).href);
        await page.waitForFunction(()=>window.powerampPreview?.ready);
        if(count===5000){await page.locator('#preview-size').tap();await page.waitForFunction(()=>powerampPreview.ready&&powerampPreview.count===5000);}
        assert.equal(await page.locator('#preview-error').isHidden(),true);
        const settled=()=>page.waitForFunction(()=>!document.querySelector('.player-scene-input')&&!PA.LibraryPageMotion.state&&!PA.LibraryPageMotion.finish&&!document.querySelector('#sc-list').dataset.scene&&!document.querySelector('#sc-library').dataset.scene);
        await page.locator('[data-nav="library"]').tap();await settled();
        await page.getByRole('button',{name:'All Songs',exact:true}).tap();await settled();
        assert.deepEqual(await page.evaluate(()=>PA.LibraryPageHistory.entries.map(entry=>[entry.screen,entry.spec?.kind||null])),[['library',null],['list','all']]);
        assert.equal(await page.evaluate(()=>PA.NativeSettings.values.list_header_buttons),1,'the real preview boot must enable the reference header actions');
        assert.equal(await page.locator('.library-header-actions').isVisible(),true);
        assert.equal(await page.locator('#list-fabs').isHidden(),true,'at the top, only the header actions are shown');
        await page.locator('#list-body').evaluate(body=>{body.scrollTop=500;});
        await page.waitForFunction(()=>!document.querySelector('#list-fabs').hidden);
        assert.equal(await page.locator('#list-fabs').isVisible(),true,'after scrolling past the header, actions dock above the mini player');
        await page.locator('#list-body').evaluate(body=>{body.scrollTop=0;});
        await page.waitForFunction(()=>document.querySelector('#list-fabs').hidden);
        assert.equal(await page.locator('.library-header-actions').isVisible(),true,'returning to the top restores the header controls');
        await page.evaluate(()=>{
          window.historyCaptureTrace=[];
          for(const type of ['pointerdown','lostpointercapture'])document.addEventListener(type,e=>historyCaptureTrace.push({type,trusted:e.isTrusted,child:!!e.target.closest('.trow,.catrow'),target:e.target.id}),true);
        });
        const cdp=await context.newCDPSession(page),point=(x,y)=>({id:1,x,y,radiusX:1,radiusY:1,force:1});
        const swipe=async(selector,dx)=>{
          const box=await page.locator(selector).boundingBox();assert.ok(box,'touch target must be rendered');
          const x=box.x+Math.min(box.width/2,180),y=box.y+box.height/2;
          await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(x,y)]});
          for(let i=1;i<=6;i++){
            await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x+dx*i/6,y)]});
            await page.evaluate(()=>new Promise(done=>requestAnimationFrame(done)));
            if(i===3){
              const motion=await page.evaluate(()=>({live:!!PA.LibraryPageMotion.state,pending:!!PA.LibraryPageMotion.finish,x:PA.LibraryPageMotion.state?.x}));
              assert.equal(motion.live,true,'old child capture loss must not end the drag');assert.equal(motion.pending,false,'no rollback while the finger is held');assert.ok(Math.abs(motion.x)>40,'broad row/category drag must follow more than the first tiny move');
            }
          }
          await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await settled();
        };
        await swipe('#list-body .trow[data-i="2"]',135);
        assert.equal(await page.evaluate(()=>PA.Nav.cur),'library');assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),0);
        await swipe('#lib-cats .catrow[data-k="all"]',-135);
        assert.equal(await page.evaluate(()=>PA.Nav.cur),'list');assert.equal(await page.evaluate(()=>PA.Views.currentSpec.kind),'all');
        assert.deepEqual(await page.evaluate(()=>PA.Views.stack.map(spec=>spec.kind)),['all']);
        const trace=await page.evaluate(()=>historyCaptureTrace);assert.ok(trace.every(event=>event.trusted));
        assert.ok(trace.some(event=>event.type==='lostpointercapture'&&event.child),'real child-to-ancestor capture transfer must occur');
        assert.ok(await page.locator('#list-body .trow').count()<100,'large catalog remains windowed');
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
  }finally{await browser?.close();await rm(directory,{recursive:true,force:true});}
});
