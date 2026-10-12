import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {chromium} from 'playwright-core';
import {requireBrowser} from './helpers/ci-test-inventory.mjs';
import {fixtureWav, instrumentFixtureBoot, installPowerampFixture, mobileContext, servePowerampFixture, sourceFlags} from './helpers/poweramp-fixture.js';

// Generated native-R2 metadata and PCM only. No production media or catalog
// calls. The optional frozen source gives a before/after reproduction.
const soakSegments=Math.max(1,Math.min(8,Number(process.env.POWERAMP_SOAK_SEGMENTS)||1));
const frozenSource=process.env.POWERAMP_PLAYER_SOURCE?instrumentFixtureBoot(await readFile(process.env.POWERAMP_PLAYER_SOURCE,'utf8')):null;
async function evidence(h){
  return h.page.evaluate(()=>({position:PA.Engine.pos,intent:PA.Engine.wantsPlayback(),playing:PA.Engine.playing,loading:!!PA.Engine._loadingRequest,withheld:window.withheldEnds||0,
    slots:PA.Engine.els.map(a=>({time:a.currentTime,duration:a.duration,paused:a.paused,ended:a.ended,error:a.error?.code||0,readyState:a.readyState,networkState:a.networkState})),
    playback:PA.PlaybackDiagnostics.report()}));
}
async function openPage(browser,fixture){
  const context=await browser.newContext(mobileContext),errors=[];
  await context.route('**/*',route=>{
    const url=new URL(route.request().url());
    if(url.origin!==fixture.origin)return route.abort('blockedbyclient');
    if(frozenSource&&url.pathname==='/drawercast/player.js')return route.fulfill({contentType:'text/javascript',body:frozenSource});
    return route.continue();
  });
  await context.addInitScript(()=>{
    window.fixtureMediaActions=new Map();
    const register=navigator.mediaSession.setActionHandler.bind(navigator.mediaSession);
    navigator.mediaSession.setActionHandler=(name,handler)=>{window.fixtureMediaActions.set(name,handler);return register(name,handler);};
  });
  await context.addInitScript(flags=>localStorage.setItem('drawercast.sources.v1',JSON.stringify(flags)),sourceFlags);
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.goto(fixture.origin+'/drawercast/');
  await page.waitForFunction(()=>window.PA?.R2Source.manifestURL==='fixture-disabled');await page.evaluate(()=>window.__powerampBootPromise);
  await page.evaluate(installPowerampFixture,{origin:fixture.origin,count:3,art:false});
  await page.evaluate(()=>{
    for(const track of PA.LIB.map.values()){track.remote=false;track.nativeR2=true;}
    Object.assign(PA.SET,{audioMode:'transparent',gapless:true,crossfade:false,fadeOnPause:false});
    PA.NativeSettings.values.pause_on_screen_off=false;
  });
  return {context,page,errors};
}

test('Poweramp native R2 Chrome lifecycle and recovery contracts',{timeout:Math.max(300000,(soakSegments*75+120)*1000)},async t=>{
  const fixture=await servePowerampFixture(),browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
  try{
    await t.test('turning off an expired sleep fade keeps real decoded audio advancing',async()=>{
      const h=await openPage(browser,fixture);
      try{
        await h.page.locator('#btn-play').tap();
        await h.page.waitForFunction(()=>PA.Engine.playing&&PA.Engine.time()>.2);
        await h.page.evaluate(()=>PA.Engine.setSleep(.001));
        await h.page.waitForFunction(()=>PA.Engine.sleepAt===0);
        const before=await h.page.evaluate(()=>{PA.Engine.setSleep(0);return PA.Engine.time();});
        // Observe beyond the original 4.2-second completion, with real native
        // media time; no virtual clock or replacement play implementation.
        await h.page.waitForTimeout(4500);
        const after=await h.page.evaluate(()=>({time:PA.Engine.time(),intent:PA.Engine.wantsPlayback(),paused:PA.Engine.el().paused}));
        assert.equal(after.intent,true);assert.equal(after.paused,false);assert.ok(after.time>before+3);
        assert.deepEqual(h.errors,[]);
      }finally{await h.context.close();}
    });
    await t.test('deleting through the library preserves shuffled transport occurrences',async()=>{
      const h=await openPage(browser,fixture);
      try{
        await h.page.locator('#btn-play').tap();
        await h.page.waitForFunction(()=>PA.Engine.playing);
        await h.page.evaluate(async()=>{
          const {Engine,SET}=PA;SET.previousRestarts=false;
          Engine.queue.push(Engine.queue[1]);Engine.order=[2,0,3,1];
          await Engine.playIndex(3,true);
          PA.Views.push({kind:'all',title:'All Songs'});
        });
        await h.page.waitForFunction(()=>PA.Nav.cur==='list'&&!document.querySelector('.player-scene-input'));
        await h.page.evaluate(()=>PA.Selection.enter('r2_fixture_0',document.querySelector('#list-body .zoom-list')));
        await h.page.locator('[data-select="Delete"]').click();
        await h.page.locator('#sheet .actions').getByRole('button',{name:'Delete',exact:true}).click();
        await h.page.waitForFunction(()=>!PA.LIB.map.has('r2_fixture_0'));
        const state=()=>h.page.evaluate(()=>({order:PA.Engine.order,pos:PA.Engine.pos,id:PA.Engine.current.id}));
        assert.deepEqual(await state(),{order:[1,2,0],pos:1,id:'r2_fixture_1'});
        for(const [action,pos,id] of [['nexttrack',2,'r2_fixture_1'],['nexttrack',0,'r2_fixture_2'],['previoustrack',2,'r2_fixture_1']]){
          await h.page.evaluate(action=>fixtureMediaActions.get(action)(),action);
          await h.page.waitForFunction(()=>PA.Engine.playing&&PA.Engine.time()>.05);
          assert.deepEqual(await state(),{order:[1,2,0],pos,id});
        }
        assert.deepEqual(h.errors,[]);
      }finally{await h.context.close();}
    });
    await t.test('one unreadable local file does not strand scanning or block the next import',async()=>{
      const h=await openPage(browser,fixture);
      try{
        const result=await h.page.evaluate(async origin=>{
          const bytes=await (await fetch(origin+'/__fixture__/audio/0.wav')).arrayBuffer();
          const good=new File([bytes],'readable.wav',{type:'audio/wav'});
          const bad={name:'unreadable.wav',__path:'unreadable.wav',__handle:{getFile:async()=>{throw new DOMException('Unavailable','NotReadableError');}}};
          const first=await PA.addFiles([bad,good]);
          const second=await PA.addFiles([new File([bytes],'second.wav',{type:'audio/wav'})]);
          return {first,second,local:[...PA.LIB.map.values()].filter(t=>!t.source).length};
        },fixture.origin);
        assert.deepEqual(result,{first:1,second:1,local:2});assert.deepEqual(h.errors,[]);
      }finally{await h.context.close();}
    });
    await t.test('startup restoration keeps native R2 position without a mapping or media request',async()=>{
      const h=await openPage(browser,fixture);
      try{
        const result=await h.page.evaluate(async()=>{
          const {Engine,IDB,R2Source}=PA;Engine.releaseSlot(Engine.cur);
          const track=Engine.current,state={ids:[track.id],order:[0],pos:0,curId:track.id,time:67,savedAt:Date.now()};
          await IDB.set('kv','state',state);localStorage.setItem('dc.playback-checkpoint',JSON.stringify(state));
          const source=R2Source.fileFor;R2Source.fileFor=()=>null;
          const restored=await Engine.restoreState(),time=Engine.time(),src=Engine.el().getAttribute('src'),intent=Engine.wantsPlayback();
          R2Source.fileFor=source;return {restored,time,src,intent};
        });
        assert.deepEqual(result,{restored:true,time:67,src:null,intent:false});
        await h.page.locator('#btn-play').tap();
        await h.page.waitForFunction(()=>PA.Engine.playing&&PA.Engine.el().currentTime>=67&&PA.Engine.el().currentTime<70);
        assert.deepEqual(h.errors,[]);
      }catch(error){console.error('NATIVE_R2_BROWSER '+JSON.stringify(await evidence(h)));throw error;}finally{await h.context.close();}
    });

    await t.test('real native end withheld before a freeze is consumed once on a resume notification',async()=>{
      const h=await openPage(browser,fixture);
      try{
        await h.page.locator('#btn-play').tap();await h.page.waitForFunction(()=>PA.Engine.playing);
        await h.page.evaluate(()=>{
          window.withheldEnds=0;document.addEventListener('ended',event=>{if(window.withholdEnd&&event.target===PA.Engine.el()){window.withheldEnds++;event.stopImmediatePropagation();}},true);
          window.withholdEnd=true;PA.Engine.el().currentTime=PA.Engine.el().duration-.1;
        });
        await h.page.waitForFunction(()=>PA.Engine.el().ended&&window.withheldEnds===1);
        assert.equal(await h.page.evaluate(()=>PA.Engine.pos),0);
        const cdp=await h.context.newCDPSession(h.page);
        await cdp.send('Page.setWebLifecycleState',{state:'frozen'});
        await cdp.send('Page.setWebLifecycleState',{state:'active'});
        // Deliver the app's resume input after CDP freezing. This fixture
        // deliberately does not assert a particular OS notification sequence.
        await h.page.evaluate(()=>document.dispatchEvent(new Event('resume')));
        await h.page.waitForFunction(()=>PA.Engine.pos===1&&PA.Engine.playing);
        await h.page.evaluate(()=>{window.withholdEnd=false;document.dispatchEvent(new Event('resume'));window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true}));});
        assert.equal(await h.page.evaluate(()=>PA.Engine.pos),1);
        await h.page.locator('#btn-play').tap();await h.page.waitForFunction(()=>!PA.Engine.wantsPlayback()&&PA.Engine.el().paused);
        await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await cdp.send('Page.setWebLifecycleState',{state:'active'});
        const state=await h.page.evaluate(()=>({intent:PA.Engine.wantsPlayback(),playing:PA.Engine.playing,paused:PA.Engine.el().paused,pos:PA.Engine.pos}));
        assert.deepEqual(state,{intent:false,playing:false,paused:true,pos:1});assert.deepEqual(h.errors,[]);
      }catch(error){console.error('NATIVE_R2_BROWSER '+JSON.stringify(await evidence(h)));throw error;}finally{await h.context.close();}
    });

    await t.test('offline Next source error4 preserves intent and recovers the same native media online',async()=>{
      const h=await openPage(browser,fixture),failures=[];
      const cdp=await h.context.newCDPSession(h.page);await cdp.send('Network.enable');
      cdp.on('Network.loadingFailed',event=>{if(event.type==='Media')failures.push(event.errorText);});
      try{
        await h.page.locator('#btn-play').tap();await h.page.waitForFunction(()=>PA.Engine.playing&&PA.Engine.el().currentTime>.2);
        await h.context.setOffline(true);await h.page.locator('#sc-player [data-act="next"]').tap();
        await h.page.waitForFunction(()=>PA.Engine.el().error?.code===4);
        const failed=await h.page.evaluate(()=>({pos:PA.Engine.pos,intent:PA.Engine.wantsPlayback(),readyState:PA.Engine.el().readyState,networkState:PA.Engine.el().networkState,online:navigator.onLine}));
        assert.deepEqual(failed,{pos:1,intent:true,readyState:0,networkState:3,online:false});
        assert.ok(failures.includes('net::ERR_INTERNET_DISCONNECTED'),'actual native loading failed while Chromium was offline');
        await h.page.waitForFunction(()=>PA.Engine._r2Recovery?.phase==='offline');
        await h.context.setOffline(false);
        await h.page.waitForFunction(()=>PA.Engine.pos===1&&PA.Engine.playing&&PA.Engine.el().currentTime>.2);
        assert.equal(await h.page.evaluate(()=>PA.Engine.el().error),null);
        const report=await h.page.evaluate(()=>PA.PlaybackDiagnostics.report());
        assert.equal(report.events.filter(e=>e.event==='r2-retry-start').length,1);
        assert.deepEqual(h.errors,[]);
      }catch(error){console.error('NATIVE_R2_OFFLINE_SOURCE '+JSON.stringify({failures,...await evidence(h)}));throw error;}
      finally{await h.context.setOffline(false);await h.context.close();}
    });

    await t.test('Pause cancels the native offline source recovery before online',async()=>{
      const h=await openPage(browser,fixture);
      try{
        await h.page.locator('#btn-play').tap();await h.page.waitForFunction(()=>PA.Engine.playing);
        await h.context.setOffline(true);await h.page.locator('#sc-player [data-act="next"]').tap();
        await h.page.waitForFunction(()=>PA.Engine._r2Recovery?.phase==='offline');
        await h.page.locator('#btn-play').tap();await h.context.setOffline(false);
        await h.page.waitForTimeout(1000);
        const state=await h.page.evaluate(()=>({pos:PA.Engine.pos,intent:PA.Engine.wantsPlayback(),playing:PA.Engine.playing,paused:PA.Engine.el().paused,reloads:PA.PlaybackDiagnostics.report().events.filter(e=>e.event==='r2-retry-start').length}));
        assert.deepEqual(state,{pos:1,intent:false,playing:false,paused:true,reloads:0});assert.deepEqual(h.errors,[]);
      }catch(error){console.error('NATIVE_R2_OFFLINE_PAUSE '+JSON.stringify(await evidence(h)));throw error;}
      finally{await h.context.setOffline(false);await h.context.close();}
    });

    for(const initiallyOffline of [false,true])await t.test(`real unsupported media remains terminal ${initiallyOffline?'after its one offline probe':'online'}`,async()=>{
      const h=await openPage(browser,fixture);let invalidRequests=0;
      await h.context.route('**/__fixture__/audio/1.wav',route=>{invalidRequests++;return route.fulfill({contentType:'audio/wav',body:'not a supported audio container'});});
      try{
        await h.page.locator('#btn-play').tap();await h.page.waitForFunction(()=>PA.Engine.playing);
        if(initiallyOffline)await h.context.setOffline(true);
        await h.page.locator('#sc-player [data-act="next"]').tap();
        if(initiallyOffline){await h.page.waitForFunction(()=>PA.Engine._r2Recovery?.phase==='offline');await h.context.setOffline(false);}
        await h.page.waitForFunction(()=>PA.Engine.el().error?.code===4&&!PA.Engine.wantsPlayback());
        const before=invalidRequests;await h.context.setOffline(true);await h.context.setOffline(false);await h.page.waitForTimeout(1000);
        assert.equal(invalidRequests,before,'online notifications cannot renew a genuine unsupported source');
        const state=await h.page.evaluate(()=>({pos:PA.Engine.pos,intent:PA.Engine.wantsPlayback(),playing:PA.Engine.playing,reloads:PA.PlaybackDiagnostics.report().events.filter(e=>e.event==='r2-retry-start').length}));
        assert.deepEqual(state,{pos:1,intent:false,playing:false,reloads:initiallyOffline?1:0});assert.deepEqual(h.errors,[]);
      }catch(error){console.error('NATIVE_R2_UNSUPPORTED '+JSON.stringify({invalidRequests,...await evidence(h)}));throw error;}
      finally{await h.context.setOffline(false);await h.context.close();}
    });

    await t.test('registered Media Session commands survive rapid navigation, background return and prolonged native playback',async()=>{
      const h=await openPage(browser,fixture);
      try{
        await h.page.locator('#btn-play').tap();await h.page.waitForFunction(()=>PA.Engine.playing);
        // These invoke the exact registered action callbacks. They do not
        // emulate Android audio focus or a physical Bluetooth/headset event.
        for(let batch=0;batch<4;batch++){
          await h.page.evaluate(()=>{for(const action of ['nexttrack','nexttrack','previoustrack'])fixtureMediaActions.get(action)();});
          await h.page.waitForFunction(pos=>PA.Engine.pos===pos&&PA.Engine.playing&&PA.Engine.el().currentTime>.1,(batch+1)%3);
        }
        await h.page.evaluate(()=>fixtureMediaActions.get('seekto')({seekTime:20}));
        await h.page.waitForFunction(()=>PA.Engine.el().currentTime>=20&&PA.Engine.el().currentTime<25);
        await h.page.evaluate(()=>fixtureMediaActions.get('pause')());
        const paused=await h.page.evaluate(()=>({time:PA.Engine.time(),attempt:PA.Engine._playAttempt}));
        const cdp=await h.context.newCDPSession(h.page);
        await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await cdp.send('Page.setWebLifecycleState',{state:'active'});
        await h.page.evaluate(()=>document.dispatchEvent(new Event('resume')));
        assert.deepEqual(await h.page.evaluate(()=>({time:PA.Engine.time(),attempt:PA.Engine._playAttempt})),paused);
        await h.page.evaluate(()=>fixtureMediaActions.get('play')());
        await h.page.waitForFunction(()=>PA.Engine.playing&&PA.Engine.time()>21);
        // Real wall-clock soak, no fake clock or playback-rate acceleration.
        // Optional longer acceptance run repeats these continuous intervals
        // with real ends between them, exercising both persistent audio slots.
        for(let segment=0;segment<soakSegments;segment++){
          if(segment)await h.page.evaluate(()=>PA.Engine.seek(20));
          const started=await h.page.evaluate(()=>PA.Engine.time());
          await h.page.waitForFunction(at=>PA.Engine.time()>at+65,started,{timeout:75000});
          assert.equal(await h.page.evaluate(()=>PA.Engine.playing&&PA.Engine.wantsPlayback()&&PA.Engine.ctx.state==='running'),true);
          for(let end=0;end<2;end++){
            const pos=await h.page.evaluate(()=>{PA.SET.repeatMode='all';PA.Engine.seek(PA.Engine.duration()-.2);return PA.Engine.pos;});
            await h.page.waitForFunction(pos=>PA.Engine.pos===(pos+1)%3&&PA.Engine.playing,pos);
          }
          const selected=await h.page.evaluate(()=>{const pos=PA.Engine.pos;fixtureMediaActions.get('nexttrack')();fixtureMediaActions.get('previoustrack')();return pos;});
          await h.page.waitForFunction(pos=>PA.Engine.pos===pos&&PA.Engine.playing,selected);
        }
        await h.page.evaluate(()=>fixtureMediaActions.get('pause')());
        assert.equal(await h.page.evaluate(()=>PA.Engine.wantsPlayback()),false);
        assert.deepEqual(h.errors,[]);
      }catch(error){console.error('NATIVE_R2_MEDIA_ACTIONS '+JSON.stringify(await evidence(h)));throw error;}finally{await h.context.close();}
    });

    await t.test('Media Session setting changes apply before stalled artwork storage completes',async()=>{
      const h=await openPage(browser,fixture);
      try{
        const result=await h.page.evaluate(async()=>{
          const {Engine,IDB,SET}=PA,original=IDB.get;const waits=[];
          Engine.current.artKey='synthetic-pending-art';delete Engine.current.coverURL;
          IDB.get=function(store,key){if(store==='art')return new Promise(resolve=>waits.push(resolve));return original.call(this,store,key);};
          SET.headsetButtons=false;const pending=Engine.updateMediaSession();
          const disabled=fixtureMediaActions.get('nexttrack')===null;
          SET.headsetButtons=true;const second=Engine.updateMediaSession();
          const enabled=typeof fixtureMediaActions.get('nexttrack')==='function';
          // Allow the metadata lookup to reach IndexedDB before releasing it.
          for(let i=0;i<10;i++)await Promise.resolve();
          IDB.get=original;for(const resolve of waits)resolve(null);await Promise.all([pending,second]);
          return {disabled,enabled};
        });
        assert.deepEqual(result,{disabled:true,enabled:true});assert.deepEqual(h.errors,[]);
      }catch(error){console.error('NATIVE_R2_ART_CONTROLS '+JSON.stringify(await evidence(h)));throw error;}finally{await h.context.close();}
    });

    for(const scenario of ['delayed playing','missing pause event'])await t.test('native held network stream: '+scenario,async()=>{
      const h=await openPage(browser,fixture),bytes=fixtureWav(),sockets=new Set();let requests=0;
      const held=createServer((req,res)=>{
        requests++;const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||''),start=range?+range[1]:0,end=range&&range[2]?Math.min(+range[2],bytes.length-1):bytes.length-1;
        res.writeHead(range?206:200,{'Content-Type':'audio/wav','Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});
        res.flushHeaders();if(start===0)res.write(bytes.subarray(0,44+262144));
        // Keep the body open with real native metadata and no data at the seek.
      });
      held.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
      await new Promise(resolve=>held.listen(0,'127.0.0.1',resolve));
      const heldOrigin='http://127.0.0.1:'+held.address().port;
      try{
        await h.context.route(heldOrigin+'/**',route=>route.continue());
        await h.page.evaluate(({url,start})=>{
          PA.Engine.releaseSlot(PA.Engine.cur);PA.R2Source.fileFor=()=>({__remoteURL:url});
          PA.Engine._resumePosition={id:PA.Engine.current.id,time:start};
        },{url:heldOrigin+'/held.wav',start:scenario==='missing pause event'?0:87});
        await h.page.clock.install();await h.page.locator('#btn-play').tap();
        if(scenario==='missing pause event'){
          // Settle the real initial Play before the loss. Otherwise native
          // pause rejects that pending promise and masks the watchdog defect.
          await h.page.waitForFunction(()=>PA.Engine.playing&&PA.Engine.el().currentTime>.1);
          await h.page.evaluate(()=>PA.Engine.seek(87));
          await h.page.waitForFunction(()=>PA.Engine.el().readyState<3&&!!PA.Engine._stallTimer);
        }
        await h.page.waitForFunction(()=>PA.Engine.el().readyState>=1&&PA.Engine.el().currentTime===87&&PA.Engine.wantsPlayback());
        if(scenario==='missing pause event'){
          await h.page.evaluate(()=>{document.addEventListener('pause',event=>event.stopImmediatePropagation(),true);PA.Engine.el().pause();});
          await h.page.clock.fastForward(14000);
          assert.deepEqual(await h.page.evaluate(()=>({intent:PA.Engine.wantsPlayback(),paused:PA.Engine.el().paused,recovery:!!PA.Engine._r2Recovery})),{intent:false,paused:true,recovery:false});
          assert.deepEqual(h.errors,[]);return;
        }
        // Replay a delayed startup notification against the real no-data
        // element. Only notification timing is injected; readiness, Range
        // loading, seek and the subsequent recovery are native Chromium.
        const deadline=await h.page.evaluate(()=>{const timer=PA.Engine._stallTimer;PA.Engine.onPlaying(PA.Engine.cur);return {retained:timer===PA.Engine._stallTimer,ready:PA.Engine.el().readyState};});
        assert.ok(deadline.ready<3);assert.equal(deadline.retained,true);
        await h.page.clock.fastForward(13000);
        await h.page.waitForFunction(()=>PA.Engine._r2RetryId===PA.Engine.current.id);
        assert.equal(await h.page.evaluate(()=>PA.Engine.wantsPlayback()),true);
        assert.ok(requests>0,'real network body and HTMLAudioElement are exercised');
        assert.deepEqual(h.errors,[]);
      }catch(error){console.error('NATIVE_R2_HELD '+JSON.stringify({requests,...await evidence(h)}));throw error;}finally{
        await h.context.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>held.close(resolve));
      }
    });
  }finally{await browser.close();await fixture.close();}
});
