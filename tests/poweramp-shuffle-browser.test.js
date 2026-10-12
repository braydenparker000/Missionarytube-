import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {requireBrowser} from './helpers/ci-test-inventory.mjs';
import {installPowerampFixture,mobileContext,servePowerampFixture,sourceFlags} from './helpers/poweramp-fixture.js';

test('Chromium shuffle playback, history, manual queue and saved state use the same occurrence bag',{timeout:60000},async()=>{
  const fixture=await servePowerampFixture(),browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
  const errors=[];
  try{
    const context=await browser.newContext(mobileContext);await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
    await context.addInitScript(flags=>localStorage.setItem('drawercast.sources.v1',JSON.stringify(flags)),sourceFlags);
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(fixture.origin+'/drawercast/');
    await page.waitForFunction(()=>window.PA?.R2Source.manifestURL==='fixture-disabled');await page.evaluate(()=>window.__powerampBootPromise);
    await page.evaluate(installPowerampFixture,{origin:fixture.origin,count:9,art:false});
    await page.evaluate(()=>{for(const t of PA.LIB.map.values())t.remote=false;Object.assign(PA.SET,{shuffleOn:true,shuffleMode:1,repeatMode:'off',previousRestarts:false,audioMode:'transparent',crossfade:false});PA.Engine.buildOrder();});
    await page.locator('#btn-play').tap();await page.waitForFunction(()=>PA.Engine.playing&&PA.Engine.time()>.1);
    const seen=[await page.evaluate(()=>PA.Engine.current.id)];
    for(let i=0;i<3;i++){await page.evaluate(()=>PA.Engine.next());await page.waitForFunction(()=>PA.Engine.playing&&!PA.Engine._loadingRequest);seen.push(await page.evaluate(()=>PA.Engine.current.id));}
    assert.equal(new Set(seen).size,4);
    const before=await page.evaluate(()=>PA.Engine._shuffle.snapshot());
    await page.evaluate(()=>PA.Engine.prev());await page.waitForFunction(()=>PA.Engine.playing&&!PA.Engine._loadingRequest);assert.equal(await page.evaluate(()=>PA.Engine.current.id),seen[2]);
    await page.evaluate(()=>PA.Engine.next());await page.waitForFunction(()=>PA.Engine.playing&&!PA.Engine._loadingRequest);assert.deepEqual(await page.evaluate(()=>{const {recent,...navigation}=PA.Engine._shuffle.snapshot();return navigation;}),(({recent,...navigation})=>navigation)(before));
    const result=await page.evaluate(async()=>{
      const {Engine,SET,PlaybackQueue}=PA;Engine.pause();const selected=Engine.current.id;
      SET.shuffleOn=false;Engine.buildOrder();SET.shuffleOn=true;Engine.buildOrder();
      const saved=JSON.stringify(Engine._shuffle.snapshot());Engine.checkpoint();Engine._shuffle=null;
      await Engine.restoreState();Engine._syncShuffle();
      const restored=JSON.stringify(Engine._shuffle.snapshot())===saved&&Engine.current.id===selected;
      PlaybackQueue.pending=[Engine.queue[8].id];PlaybackQueue.forced=true;Engine.next();
      return {restored,manual:PlaybackQueue.active,current:Engine.current.id,expected:Engine.queue[0].id};
    });assert.equal(result.restored,true);assert.equal(result.manual,true);assert.equal(result.current,result.expected);
    await page.waitForFunction(()=>!PA.Engine._loadingRequest);await page.evaluate(()=>PA.Engine.next());await page.waitForFunction(()=>!PA.Engine._loadingRequest);assert.equal(await page.evaluate(()=>PA.PlaybackQueue.active),false);
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await fixture.close();}
});
