import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {requireBrowser} from './helpers/ci-test-inventory.mjs';
import {installPowerampFixture,mobileContext,servePowerampFixture,sourceFlags} from './helpers/poweramp-fixture.js';

test('large supported catalogs yield during initialization, restoration, reconciliation and repeat cycles',{timeout:120000},async()=>{
  const fixture=await servePowerampFixture(),browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
  try{
    const context=await browser.newContext(mobileContext);await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort());
    await context.addInitScript(flags=>localStorage.setItem('drawercast.sources.v1',JSON.stringify(flags)),sourceFlags);
    const page=await context.newPage();await page.goto(fixture.origin+'/drawercast/');await page.waitForFunction(()=>window.PA?.R2Source.manifestURL==='fixture-disabled');await page.evaluate(()=>window.__powerampBootPromise);
    await page.evaluate(installPowerampFixture,{origin:fixture.origin,count:3,art:false});
    await page.evaluate(()=>{
      const {Engine,LIB,SET}=PA,base=Engine.queue[0];Engine.pause();
      const queue=Array.from({length:50000},(_,i)=>({...base,id:'large-'+i,artist:'Artist '+i%40,album:'Album '+i%100,albumArtist:'Artist '+i%40}));
      LIB.map=new Map(queue.map(t=>[t.id,t]));LIB.ids=queue.map(t=>t.id);Engine.queue=queue;Engine.order=queue.map((_,i)=>i);Engine.current=queue[0];Engine.pos=0;Engine._shuffle=null;Engine._shuffleState=null;
      Object.assign(SET,{shuffleOn:true,shuffleMode:1,repeatMode:'all',previousRestarts:false});
    });
    const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
    const evidence=await page.evaluate(async()=>{
      const {Engine,SET}=PA,records=[],observer=new PerformanceObserver(list=>records.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask'});
      const frame=()=>new Promise(r=>requestAnimationFrame(r)),yieldTask=()=>new Promise(r=>setTimeout(r,0)),results=[];
      async function measure(label,action){
        await frame();const start=performance.now();let ticks=0,previous=start,maxGap=0;
        const timer=setInterval(()=>{const now=performance.now();maxGap=Math.max(maxGap,now-previous);previous=now;ticks++;},10);
        const promise=action();Engine.saveState();let deferred=!!Engine._shuffleBuild;await promise;if(label==='restoration')deferred=!!Engine._shuffleGenerationStats;await new Promise(r=>setTimeout(r,850));clearInterval(timer);await frame();
        results.push({label,deferred,ticks,maxGap,duration:performance.now()-start,work:label==='next cycle'?Engine._shuffleCycleStats:Engine._shuffleGenerationStats,orderLength:Engine.order.length,unique:new Set(Engine.order).size,longTasks:records.filter(e=>e.start>=start)});
      }
      await measure('initial',()=>Engine.buildOrder(0));
      const snapshot=JSON.parse(JSON.stringify(Engine._shuffle.snapshot())),savedCurrent=Engine.current.id;Engine.checkpoint();
      await measure('restoration',async()=>{Engine._shuffle=null;Engine._shuffleState=null;await Engine.restoreState();});
      const restored=JSON.stringify(Engine._shuffle.snapshot())===JSON.stringify(snapshot)&&Engine.current.id===savedCurrent;
      Engine.queue[40000]={...Engine.queue[40000],id:'replacement'};
      await measure('reconciliation',()=>Engine.buildOrder());
      SET.shuffleMode=4;await measure('album mode',()=>Engine.buildOrder());
      // Exhaust outside the measured generation action, yielding as a bulk fixture.
      const state=Engine._shuffle;let draws=0;for(let step;(step=state.peek(1));){state.select(state.indices.get(step.key),step);if(++draws%256===0)await yieldTask();}
      await measure('next cycle',async()=>{Engine._shuffleStep(1,true);await Engine._shuffleBuild.promise;});
      const cycleCount=state.pendingCycle.length,cycleUnique=new Set(state.pendingCycle).size;
      observer.disconnect();return {results,restored,cycleCount,cycleUnique};
    });
    console.log(JSON.stringify(evidence));assert.equal(evidence.restored,true);assert.equal(evidence.cycleCount,50000);assert.equal(evidence.cycleUnique,50000);
    for(const result of evidence.results){assert.equal(result.deferred,true,result.label);assert.equal(result.orderLength,50000,result.label);assert.equal(result.unique,50000,result.label);assert.ok(result.ticks>=2,result.label+' event-loop ticks');assert.deepEqual(result.longTasks,[],result.label+' must not create a task over 50ms');}
  }finally{await browser.close();await fixture.close();}
});
