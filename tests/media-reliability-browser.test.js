import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {requireBrowser} from './helpers/ci-test-inventory.mjs';
import {serveMediaReliabilityFixture,openAstraFixture,openMyMediaFixture} from './helpers/media-reliability-fixture.js';
import {servePowerampFixture,installPowerampFixture,sourceFlags,mobileContext} from './helpers/poweramp-fixture.js';

const evidence=process.env.MEDIA_RELIABILITY_EVIDENCE_DIR;
async function record(name,h,extra={}){
  if(!evidence)return;
  await mkdir(evidence,{recursive:true});
  await writeFile(join(evidence,name+'.json'),JSON.stringify({...(await h.state()),errors:h.errors,...extra},null,2)+'\n');
  await h.page.screenshot({path:join(evidence,name+'.png')});
}
const playing=page=>page.waitForFunction(()=>{const m=document.querySelector('#mediaEl');return m&&m.readyState>=2&&!m.paused&&m.currentTime>.2});

test('Astra real native media, HTTP recovery, resume and PiP acceptance',{timeout:120000},async t=>{
  const fixture=await serveMediaReliabilityFixture();let browser;
  try{
    browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
    await t.test('video decodes, seeks, pauses and resumes after reload without autoplay',async()=>{
      const h=await openAstraFixture(browser,fixture);
      try{
        // Freeze only Date.now, not native media, timers or input. A seek and
        // Pause inside the normal four-second write interval must checkpoint
        // the live position rather than merely flushing the previous tick.
        await h.page.clock.setFixedTime(new Date());
        await h.open();await playing(h.page);
        await h.page.getByRole('button',{name:'Pause',exact:true}).click();
        await h.page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('astra.v1.progress')||'{"entries":{}}').entries).length>0);
        await h.page.getByRole('button',{name:'Play',exact:true}).click();await playing(h.page);
        await h.page.locator('#mediaEl').evaluate(media=>media.currentTime=10);
        await h.page.waitForFunction(()=>document.querySelector('#mediaEl').currentTime>=10);
        await h.page.getByRole('button',{name:'Pause',exact:true}).click();
        await h.page.waitForFunction(()=>document.querySelector('#mediaEl').paused);
        await record('astra-video-paused',h);
        await h.page.reload();
        assert.equal(await h.page.locator('#mediaEl').count(),0,'reload restores history without opening media');
        await h.open();await playing(h.page);
        assert.ok((await h.state()).media.time>=9.5,'explicit Play resumes the saved position');
        assert.ok((await h.state()).media.frames>0,'native video frames decoded');
        assert.ok(fixture.requests.some(r=>r.path==='/__media__/clip.webm'&&r.status===206&&r.finished),'native media used real HTTP Range');
        assert.deepEqual(h.errors,[]);await record('astra-video-resumed',h);
      }catch(error){await record('astra-video-resume-failure',h);console.error('ASTRA_RESUME '+JSON.stringify(await h.state()));throw error;}
      finally{await h.context.close();}
    });
    await t.test('non-silent native audio keeps its element during browsing and respects Pause across freeze/return',async()=>{
      const h=await openAstraFixture(browser,fixture);
      try{
        await h.open('music');await playing(h.page);
        await h.page.locator('#mediaEl').evaluate(media=>media.dataset.fixtureOwner='retained');
        await h.page.getByRole('button',{name:'Minimize player',exact:true}).click();
        await h.page.locator('#modalRoot [data-close]').click();
        await h.page.locator('#mobileNav [data-nav="search"]').click();
        assert.equal(await h.page.locator('#mediaEl').getAttribute('data-fixture-owner'),'retained');
        await h.page.getByRole('button',{name:'Pause',exact:true}).click();
        await h.page.waitForFunction(()=>document.querySelector('#mediaEl').paused);
        const cdp=await h.context.newCDPSession(h.page);
        await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await cdp.send('Page.setWebLifecycleState',{state:'active'});
        await h.page.waitForTimeout(1000);
        assert.equal((await h.state()).media.paused,true,'lifecycle return does not resume intentional Pause');
        await h.page.getByRole('button',{name:'Play',exact:true}).click();await playing(h.page);
        assert.ok(fixture.requests.some(r=>r.path==='/__media__/tone.wav'&&r.status===206&&r.finished));
        assert.deepEqual(h.errors,[]);await record('astra-audio-browse-resume',h);
      }finally{await h.context.close();}
    });
    await t.test('closing or leaving the page checkpoints a live seek inside the write interval',async()=>{
      for(const exit of ['close','pagehide']){
        const h=await openAstraFixture(browser,fixture);
        try{
          await h.page.clock.setFixedTime(new Date());await h.open();await playing(h.page);
          await h.page.locator('#mediaEl').evaluate(media=>media.currentTime=10);
          if(exit==='close')await h.page.locator('#playerShell [data-close-player]').click();
          else await h.page.goto(fixture.origin+'/notes/');
          const saved=await h.page.evaluate(()=>Object.values(JSON.parse(localStorage.getItem('astra.v1.progress')).entries)[0]);
          assert.ok(saved.time>=10,'the '+exit+' boundary retains the live native position');
          await h.page.goto(fixture.origin+'/media/');
          assert.equal(await h.page.locator('#mediaEl').count(),0);
          assert.deepEqual(h.errors,[]);await record('astra-checkpoint-'+exit,h);
        }finally{await h.context.close();}
      }
    });
    await t.test('a real native end stays completed after closing the player and reloading',async()=>{
      const h=await openAstraFixture(browser,fixture);
      try{
        await h.open();await playing(h.page);
        await h.page.locator('#mediaEl').evaluate(media=>media.currentTime=media.duration-.1);
        await h.page.waitForFunction(()=>document.querySelector('#mediaEl').ended&&Object.values(JSON.parse(localStorage.getItem('astra.v1.progress')).entries).some(entry=>entry.completed));
        await h.page.locator('#playerShell [data-close-player]').click();
        await h.page.reload();
        const saved=(await h.state()).savedProgress;
        assert.deepEqual(saved,[{time:30,duration:30,completed:true}]);
        assert.equal(await h.page.locator('#mediaEl').count(),0);assert.deepEqual(h.errors,[]);
        await record('astra-ended-completion',h);
      }finally{await h.context.close();}
    });
    await t.test('failed HTTP source stays bounded; explicit Retry recovers the selected source',async()=>{
      const h=await openAstraFixture(browser,fixture);fixture.controls.movie='reject';
      try{
        await h.open();await h.page.waitForFunction(()=>['failed','exhausted'].includes(document.querySelector('#playerShell')?.dataset.playbackState));
        const requests=fixture.requests.filter(r=>r.path==='/__media__/clip.webm').length;
        await h.page.waitForTimeout(1000);
        assert.equal(fixture.requests.filter(r=>r.path==='/__media__/clip.webm').length,requests,'failure does not loop HTTP requests');
        await record('astra-http-failed',h,{requests});fixture.controls.movie='ok';
        await h.page.locator('[data-player-action="retry"]').click();await playing(h.page);
        assert.deepEqual(h.errors,[]);await record('astra-http-retried',h);
      }finally{fixture.controls.movie='ok';await h.context.close();}
    });
    await t.test('real held HTTP audio respects Pause and preserves a stalled seek through explicit Retry',async()=>{
      const h=await openAstraFixture(browser,fixture);fixture.controls.music='partial';
      try{
        await h.open('music');await playing(h.page);
        await h.page.clock.install();
        await h.page.locator('#mediaEl').evaluate(media=>media.currentTime=87);
        await h.page.waitForFunction(()=>document.querySelector('#mediaEl').seeking);
        await h.page.getByRole('button',{name:'Pause',exact:true}).click();
        await h.page.clock.fastForward(50000);
        assert.equal((await h.state()).media.paused,true,'held network data cannot restart paused audio');
        assert.equal((await h.state()).playback,'playing','Pause does not turn into a source failure');
        await h.page.evaluate(()=>{
          window.fixturePlayDelivered=false;
          document.querySelector('#mediaEl').addEventListener('play',()=>{window.fixturePlayDelivered=true},{once:true});
        });
        await h.page.getByRole('button',{name:'Play',exact:true}).click();
        // Native media tasks run independently of the controlled JS clock.
        // Observe the actual Play task before advancing the app's deadline.
        await h.page.waitForFunction(()=>window.fixturePlayDelivered);
        await h.page.clock.fastForward(46000);
        await h.page.locator('[data-player-action="retry"]').waitFor();
        await record('astra-stalled-seek',h);
        fixture.controls.music='ok';await h.page.clock.resume();
        await h.page.locator('[data-player-action="retry"]').click();await playing(h.page);
        assert.ok((await h.state()).media.time>=86.5,'Retry retains the requested native seek');
        assert.deepEqual(h.errors,[]);await record('astra-stalled-seek-retried',h);
      }catch(error){
        await record('astra-held-http-failure',h,{requests:fixture.requests.filter(r=>r.path==='/__media__/tone.wav')});
        console.error('HELD_HTTP '+JSON.stringify(await h.state()));throw error;
      }finally{fixture.controls.music='ok';await h.context.close();}
    });
    await t.test('native inline and fullscreen PiP requests at one second preserve route and Pause',async()=>{
      for(const route of ['inline','fullscreen']){
        const h=await openAstraFixture(browser,fixture);
        try{
          await h.open();await playing(h.page);
          if(route==='fullscreen'){
            await h.page.getByRole('button',{name:'Fullscreen',exact:true}).click();
            await h.page.waitForFunction(()=>!!document.fullscreenElement);
          }
          await h.page.waitForTimeout(1000);const before=await h.state();
          await h.page.getByRole('button',{name:'Picture in picture',exact:true}).click();
          await h.page.waitForFunction(()=>document.pictureInPictureElement===document.querySelector('#mediaEl'));
          await h.page.waitForTimeout(1000);
          assert.equal((await h.state()).hash,before.hash);
          assert.equal((await h.state()).media.paused,false);
          await record('astra-pip-'+route,h,{entryRoute:route,dwellMilliseconds:1000,nativeExitControl:'not exercised'});
          await h.page.locator('#mediaEl').evaluate(media=>media.pause());
          await h.page.evaluate(()=>document.exitPictureInPicture());
          assert.equal((await h.state()).media.paused,true);
          assert.equal((await h.state()).hash,before.hash);
          assert.deepEqual(h.errors,[]);
        }finally{await h.context.close();}
      }
    });

  }finally{await browser?.close();await fixture.close();}
});

test('Astra pending HTTP cancellation and closed-player resurrection contracts',{timeout:30000},async t=>{
  const fixture=await serveMediaReliabilityFixture();let browser,h;
  try{
    browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
    h=await openAstraFixture(browser,fixture);fixture.controls.movie='hold';
    const firstRequestId=fixture.requests.length+1;
    await h.open();
    const pending=await fixture.waitForRequest(r=>r.id>=firstRequestId&&r.path==='/__media__/clip.webm'&&r.held);
    await h.page.waitForFunction(()=>document.querySelector('#mediaEl')?.networkState===2);
    // Retain the native element so DOM removal/GC cannot masquerade as teardown.
    await h.page.locator('#mediaEl').evaluate(media=>{window.fixtureClosedMedia=media;});
    assert.equal(pending.finished,false);assert.equal(pending.aborted,undefined);
    await h.page.locator('#playerShell [data-close-player]').click();
    await h.page.waitForFunction(()=>!document.querySelector('#playerShell'));
    await t.test('the admitted held request is cancelled before fixture completion',async()=>{
      await fixture.waitForRequest(r=>r.id===pending.id&&r.aborted);
      assert.equal(pending.finished,false,'cancellation must precede response completion');
      assert.deepEqual(pending.events.map(e=>e.event),['admitted','held','aborted']);
      await record('astra-close-pending-http',h,{request:pending});
      console.log('ASTRA_CANCEL_ORDER '+JSON.stringify(pending));
    });
    await t.test('late response release and online events cannot resurrect the closed player',async()=>{
      const mediaRequests=fixture.requests.filter(r=>r.path.startsWith('/__media__/')).length;
      fixture.controls.movie='ok';fixture.releaseHeld();
      await h.context.setOffline(true);await h.context.setOffline(false);
      await h.page.waitForTimeout(1000);
      assert.equal(await h.page.locator('#mediaEl').count(),0);
      assert.equal(await h.page.locator('#playerShell').count(),0);
      assert.equal(await h.page.evaluate(()=>window.fixtureClosedMedia.paused),true);
      assert.equal(fixture.requests.filter(r=>r.path.startsWith('/__media__/')).length,mediaRequests,'return cannot start another media request');
      assert.deepEqual(h.errors,[]);
      await record('astra-close-late-response',h,{request:pending});
    });
  }finally{await h?.context.close();await browser?.close();await fixture.close();}
});

test('My Media actual native PiP transitions and navigation',{timeout:60000},async t=>{
  const fixture=await serveMediaReliabilityFixture();let browser;
  try{
    browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
    for(const entryRoute of ['inline','fullscreen'])await t.test(entryRoute+' entry, one-second comparison and real native exit',async()=>{
      const h=await openMyMediaFixture(browser,fixture);
      try{
        if(entryRoute==='fullscreen'){
          await h.page.locator('#forward-10').click();
          await h.page.locator('#video').evaluate(media=>media.requestFullscreen());
          await h.page.waitForFunction(()=>!!document.fullscreenElement);
        }
        await h.page.waitForTimeout(1000);const before=await h.state();
        if(entryRoute==='inline')await h.page.locator('#pip').click();
        else await h.page.locator('#video').evaluate(media=>media.requestPictureInPicture());
        await h.page.waitForFunction(()=>document.pictureInPictureElement===document.querySelector('#video'));
        await h.page.waitForTimeout(1000);
        const entered=await h.state();assert.equal(entered.hash,before.hash);assert.equal(entered.paused,false);
        assert.ok(entered.pip.events.some(event=>event.event==='enterpictureinpicture'));
        const other=await h.context.newPage();await other.goto(fixture.origin+'/notes/');await other.bringToFront();
        const visibility=await h.page.evaluate(()=>document.visibilityState);
        await h.page.evaluate(()=>document.exitPictureInPicture());
        await h.page.waitForFunction(()=>!document.pictureInPictureElement);
        const exited=await h.state();assert.equal(exited.hash,before.hash);
        if(visibility==='hidden')assert.equal(exited.paused,true,'a hidden My Media PiP exit pauses native playback');
        else assert.equal(exited.paused,false,'visible API exit preserves playback');
        assert.equal(exited.pip.lastExit.visibility,visibility);
        assert.equal(exited.pip.nativeExitReason,'unavailable');
        await record('mymedia-pip-'+entryRoute,h,{entered,visibilityObserved:visibility,exitControl:'document.exitPictureInPicture; Android Home/close/expand not exercised'});
        await other.close();await h.page.bringToFront();
        await h.page.locator('#back').click();
        await h.page.waitForFunction(()=>document.querySelector('#video').paused&&!document.pictureInPictureElement);
        assert.deepEqual(h.errors,[]);
      }finally{await h.context.close();}
    });
  }finally{await browser?.close();await fixture.close();}
});

test('Poweramp native output interruption, browsing and full-page reload',{timeout:60000},async t=>{
  const fixture=await servePowerampFixture();let browser;
  const open=async()=>{
    const context=await browser.newContext(mobileContext),errors=[];
    await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort('blockedbyclient'));
    await context.addInitScript(flags=>{
      if(!localStorage.getItem('drawercast.sources.v1'))localStorage.setItem('drawercast.sources.v1',JSON.stringify(flags));
    },sourceFlags);
    const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
    await page.goto(fixture.origin+'/drawercast/');await page.waitForFunction(()=>window.PA?.R2Source.manifestURL==='fixture-disabled');
    await page.evaluate(installPowerampFixture,{origin:fixture.origin,count:3,art:false});
    await page.evaluate(()=>{
      for(const track of PA.LIB.map.values()){track.remote=false;track.nativeR2=true;}
      PA.setVal('audioMode','transparent');PA.setVal('crossfade',false);PA.setVal('gapless',true);PA.setVal('fadeOnPause',false);
      PA.NativeSettings.values.pause_on_screen_off=false;
    });
    const state=()=>page.evaluate(()=>({playing:PA.Engine.playing,intent:PA.Engine.wantsPlayback(),position:PA.Engine.pos,
      time:PA.Engine.time(),paused:PA.Engine.el().paused,context:PA.Engine.ctx?.state||null,screen:PA.Nav.cur,playback:PA.PlaybackDiagnostics.report()}));
    return {context,page,errors,state};
  };
  const output=page=>page.waitForFunction(()=>{
    const engine=PA.Engine;if(!engine.playing||engine.el().paused||!engine.nodes?.analyser)return false;
    const samples=new Float32Array(engine.nodes.analyser.fftSize);engine.nodes.analyser.getFloatTimeDomainData(samples);
    return samples.some(value=>Math.abs(value)>.0001);
  });
  try{
    browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
    await t.test('real context-only suspension resumes output naturally but native pause still requires Play',async()=>{
      const h=await open();
      try{
        await h.page.locator('#btn-play').tap();await output(h.page);
        await h.page.evaluate(()=>PA.Engine.el().dataset.fixtureOwner='retained');
        const selected=await h.page.evaluate(()=>PA.Engine.cur);
        await h.page.locator('[data-nav="library"]').tap();
        await h.page.waitForFunction(()=>PA.Nav.cur==='library');
        await output(h.page);
        assert.equal(await h.page.evaluate(()=>PA.Engine.cur),selected);
        await h.page.evaluate(()=>PA.Engine.ctx.suspend());
        await h.page.waitForFunction(()=>PA.Engine.wantsPlayback()&&!PA.Engine.playing&&!PA.Engine.el().paused);
        await h.page.evaluate(()=>PA.Engine.ctx.resume());
        await output(h.page);
        await h.page.evaluate(async()=>{await PA.Engine.ctx.suspend();PA.Engine.el().pause();});
        await h.page.waitForFunction(()=>!PA.Engine.wantsPlayback()&&PA.Engine.el().paused);
        await h.page.evaluate(()=>PA.Engine.ctx.resume());
        await h.page.waitForTimeout(1000);
        assert.equal((await h.state()).intent,false,'output return does not override an interruption');
        await h.page.locator('#mini-title').tap();await h.page.waitForFunction(()=>PA.Nav.cur==='player'&&!document.querySelector('.player-scene-input'));
        await h.page.locator('#btn-play').tap();await output(h.page);
        assert.equal(await h.page.evaluate(()=>PA.Engine.el().dataset.fixtureOwner),'retained');
        assert.deepEqual(h.errors,[]);await record('poweramp-context-interruption',h,{limitation:'Explicit desktop AudioContext suspension; no Android audio-focus claim.'});
      }finally{await h.context.close();}
    });
    await t.test('a real reload preserves the native R2 checkpoint without fetching or autoplay',async()=>{
      const h=await open();
      try{
        await h.page.evaluate(async()=>{
          await PA.IDB.bulk('tracks',Array.from(PA.LIB.map.values(),track=>[track.id,track]));
          localStorage.setItem('drawercast.sources.v1',JSON.stringify({local:false,drive:false,r2:true,server:false}));
        });
        await h.page.locator('#btn-play').tap();await output(h.page);
        await h.page.evaluate(()=>PA.Engine.seek(67));await h.page.waitForFunction(()=>PA.Engine.el().currentTime>=67);
        await h.page.locator('#btn-play').tap();await h.page.waitForFunction(()=>PA.Engine.el().paused&&!PA.Engine.wantsPlayback());
        await h.page.evaluate(()=>PA.IDB.get('kv','state'));
        const requests=fixture.requests.audio;await h.page.reload();
        await h.page.waitForFunction(()=>window.PA?.Engine.current&&PA.Engine.time()>=67);
        assert.equal((await h.state()).intent,false);assert.equal((await h.state()).playing,false);
        assert.equal(fixture.requests.audio,requests,'startup requests no native R2 media');
        await h.page.evaluate(origin=>{
          PA.R2Source.fileFor=track=>({__remoteURL:origin+'/__fixture__/audio/'+Number(track.remoteId.split('_').at(-1))+'.wav'});
        },fixture.origin);
        await h.page.locator('#btn-play').tap();await output(h.page);
        assert.ok((await h.state()).time>=67&&(await h.state()).time<70);
        assert.deepEqual(h.errors,[]);await record('poweramp-reload-checkpoint',h,{requestsBeforeReload:requests});
      }finally{await h.context.close();}
    });
  }finally{await browser?.close();await fixture.close();}
});
