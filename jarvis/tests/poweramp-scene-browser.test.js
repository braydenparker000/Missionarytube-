import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {servePowerampFixture,openFixturePage,reportFixtureFailure} from './helpers/poweramp-fixture.js';

const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
const bounds=async(page,selector)=>page.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};});
const assertRectClose=(actual,expected,tolerance=3,label='shared geometry')=>{for(const key of ['left','top','width','height'])assertClose(actual[key],expected[key],tolerance,label+'.'+key);};
const assertClose=(actual,expected,tolerance=3,label='visual position')=>assert.ok(Math.abs(actual-expected)<=tolerance,`${label}: ${actual}, expected ${expected} ± ${tolerance}`);

// This suite is required. Missing/broken Chromium is a test failure, never a skip.
test('Poweramp mandatory Chromium scene, seek, and art contracts',{timeout:120000},async t=>{
  assert.ok(executablePath,'Chromium is required: install it or set JARVIS_CHROME');
  const fixture=await servePowerampFixture();let browser;
  try{
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    const run=async(name,fn,options={})=>t.test(name,async()=>{
      const h=await openFixturePage(browser,fixture,options);
      try{await fn(h);assert.deepEqual(h.errors,[]);}catch(error){await reportFixtureFailure(h,error,name);throw error;}finally{await h.close();}
    });

    await run('real upward mini swipe blocks uncovered background rows during settling',async h=>{
      const {page,start,move,end,frame,center,library}=h;await library();
      await page.evaluate(()=>{
        window.rowPlayCalls=[];const original=PA.Engine.playIndex;
        PA.Engine.playIndex=function(...args){rowPlayCalls.push(args);return original.apply(this,args);};
        window.touchTrace=[];document.addEventListener('pointerdown',e=>touchTrace.push({trusted:e.isTrusted,target:e.target.closest('[id]')?.id,row:!!e.target.closest('.trow')}),true);
      });
      const tabstops=await page.evaluate(()=>({mini:document.querySelector('#mini').getAttribute('tabindex'),play:document.querySelector('#btn-play').getAttribute('tabindex')}));
      const miniArt=await bounds(page,'#mini-art'),p=await center('#mini-title');await start(p.x,p.y);
      for(const dy of [-20,-40,-60,-90]){await move(p.x,p.y+dy);await frame();}
      const duringDrag=await page.evaluate(()=>{const r=document.querySelector('#artstage').getBoundingClientRect();return {top:document.querySelector('#sc-player').getBoundingClientRect().top,height:document.querySelector('#sc-list').clientHeight,full:{left:r.left,top:r.top,width:r.width,height:r.height},miniOpacity:document.querySelector('#mini').style.opacity,fullOpacity:document.querySelector('#sc-player').style.opacity};});
      assertClose(duringDrag.top,0,1,'the canonical player does not slide in as an unrelated screen');
      const progress=90/duringDrag.height,expected=Object.fromEntries(['left','top','width','height'].map(key=>[key,miniArt[key]+(duringDrag.full[key]-miniArt[key])*progress]));
      assertRectClose(await bounds(page,'#mini[data-shared-player] #mini-art'),expected,3,'cover follows mini-to-player geometry');
      assert.equal(duringDrag.miniOpacity,'1','the real mini widgets own the shared pixels');assert.equal(duringDrag.fullOpacity,'0','full-only controls stay hidden early in the morph');
      assert.equal(await page.locator('#artA').evaluate(n=>n.style.opacity),'0','canonical artwork cannot duplicate the shared real cover');
      assert.equal(await page.locator('#mini').evaluate(n=>n.getAttribute('tabindex')),'-1','captured mini remains event-capable without a competing keyboard stop');assert.equal(await page.locator('#btn-play').evaluate(n=>n.getAttribute('tabindex')),'-1');
      await end();
      const settling=await page.evaluate(()=>{
        const row=document.querySelector('#list-body .trow[data-i="2"]'),r=row.getBoundingClientRect(),x=r.x+r.width*.45,y=r.y+r.height/2;
        const hit=document.elementFromPoint(x,y);
        return {cur:PA.Nav.cur,listInert:document.querySelector('#sc-list').inert,morphing:!!document.querySelector('#player-live-mask[data-active]'),x,y,hitRow:!!hit?.closest('.trow'),id:PA.Engine.current.id};
      });
      assert.equal(settling.cur,'player','incoming player owns navigation as soon as release commits');
      assert.equal(settling.listInert,true,'outgoing list is inert throughout the settle');
      assert.equal(settling.morphing,true,'hit testing is checked while the shared morph is in flight');
      assert.equal(settling.hitRow,false,'uncovered outgoing rows cannot receive pointer input');
      const requests=fixture.requests.audio;await h.tap(settling.x,settling.y);
      await page.waitForFunction(()=>document.querySelector('#sc-list').hidden&&!document.querySelector('#player-live-mask[data-active]'));
      assert.equal(await page.evaluate(()=>PA.Engine.current.id),settling.id);
      assert.deepEqual(await page.evaluate(()=>rowPlayCalls),[],'settling touch cannot play a background row');
      assert.equal(fixture.requests.audio,requests,'background touch cannot load audio');
      assert.deepEqual(await page.evaluate(()=>({mini:document.querySelector('#mini').getAttribute('tabindex'),play:document.querySelector('#btn-play').getAttribute('tabindex')})),tabstops,'cleanup restores exact canonical keyboard stops');
      assert.equal(await page.evaluate(()=>touchTrace.every(e=>e.trusted)),true,'input comes from CDP touch, not synthetic JS events');
    });

    await run('mini tap and drag both start from the same mini cover and expanding surface',async h=>{
      const {page,library,center,tap}=h;await library();
      const mini=await bounds(page,'#mini'),art=await bounds(page,'#mini-art');
      await page.evaluate(()=>{window.releasePosition=null;document.addEventListener('pointerup',e=>{if(e.target.closest('#mini')){const rect=n=>{const r=n.getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};releasePosition={cur:PA.Nav.cur,cover:rect(document.querySelector('#mini[data-shared-player] #mini-art')),surface:rect(document.querySelector('#player-live-mask[data-active]')),inert:document.querySelector('#sc-list').inert,trusted:e.isTrusted};}});});
      const p=await center('#mini-title');await tap(p.x,p.y);
      const release=await page.evaluate(()=>releasePosition);
      assert.ok(release?.trusted);assert.equal(release.cur,'player');assert.equal(release.inert,true);
      assertRectClose(release.cover,art,2,'tap starts with the actual mini cover');assertRectClose(release.surface,mini,2,'tap starts with the actual mini panel');
      await page.waitForFunction(()=>document.querySelector('#sc-list').hidden&&!document.querySelector('#player-live-mask[data-active]'));
      assert.equal(await page.evaluate(()=>PA.Engine.current.id),'r2_fixture_0');
    });

    await run('real held mini drag has continuous checkpoint geometry and exact full endpoint',async h=>{
      const {page,library,center,start,move,end,frame}=h;await library();
      const miniArt=await bounds(page,'#mini-art'),miniPanel=await bounds(page,'#mini'),background=await bounds(page,'#bg'),p=await center('#mini-title');
      await start(p.x,p.y);await move(p.x,p.y-12);await frame();
      const endpoint=await page.evaluate(()=>{const r=n=>{const b=n.getBoundingClientRect();return {left:b.left,top:b.top,width:b.width,height:b.height};};return {height:document.querySelector('#sc-list').clientHeight,art:r(document.querySelector('#artstage')),surface:r(document.querySelector('#sc-player'))};});
      for(const progress of [.25,.5,.75]){
        await move(p.x,p.y-endpoint.height*progress);await frame();
        const lerp=(a,b)=>Object.fromEntries(['left','top','width','height'].map(key=>[key,a[key]+(b[key]-a[key])*progress]));
        assertRectClose(await bounds(page,'#mini[data-shared-player] #mini-art'),lerp(miniArt,endpoint.art),3,'cover@'+progress);
        assertRectClose(await bounds(page,'#player-live-mask[data-active]'),lerp(miniPanel,endpoint.surface),3,'surface@'+progress);
        for(const selector of ['#player-live-background','#sc-player']){
          assertRectClose(await bounds(page,selector),selector==='#player-live-background'?background:endpoint.surface,2,'inverse content remains viewport-stationary@'+progress);
          const mask=await page.locator(selector).evaluate(n=>{const b=n.closest('#player-live-mask,#player-live-backdrop-mask').getBoundingClientRect(),cs=getComputedStyle(n.parentElement);return {bounds:{left:b.left,top:b.top,width:b.width,height:b.height},clip:cs.clipPath,hint:cs.willChange};});
          assertRectClose(mask.bounds,lerp(miniPanel,endpoint.surface),2,'mask shares exact shell@'+progress);assert.equal(mask.clip,'none');assert.ok(mask.hint.includes('transform'),'the live content retains its compositor transform hint');
        }
        assert.equal(await page.evaluate(()=>document.querySelector('#mini').style.opacity),'1');
      }
      await end();await page.waitForFunction(()=>!document.querySelector('#player-live-mask[data-active]'));
      assertRectClose(await bounds(page,'#artstage'),endpoint.art,2,'canonical endpoint');assert.equal(await page.evaluate(()=>PA.Nav.cur),'player');
    });

    await run('shared-scene regrab freezes the painted cover and held release resumes destination',async h=>{
      const {page,library,center,start,move,end,frame}=h;await library();
      const p=await center('#mini-title');await start(p.x,p.y);await move(p.x,p.y-100);await frame();
      await page.evaluate(()=>{
        window.interruption=null;document.addEventListener('pointerdown',e=>{
          if(!e.target.closest('.player-scene-input'))return;
          const rect=()=>{const r=document.querySelector('#mini[data-shared-player] #mini-art').getBoundingClientRect();return {left:r.left,top:r.top,width:r.width,height:r.height};};
          interruption={before:rect(),trusted:e.isTrusted};
        },true);
      });
      await page.evaluate(()=>document.addEventListener('pointerdown',e=>{if(!e.target.closest('.player-scene-input')||!interruption)return;const r=document.querySelector('#mini[data-shared-player] #mini-art').getBoundingClientRect();interruption.after={left:r.left,top:r.top,width:r.width,height:r.height};}));
      const release=end(),regrab=start(3,100);await Promise.all([release,regrab]);const capture=await page.evaluate(()=>interruption);
      assert.ok(capture?.trusted,'new contact reaches the shared scene plane while settling');
      assertRectClose(capture.after,capture.before,2,'regrab preserves painted cover');
      const held=await bounds(page,'#mini[data-shared-player] #mini-art');await page.waitForTimeout(280);assertRectClose(await bounds(page,'#mini[data-shared-player] #mini-art'),held,1,'held scene remains frozen');
      assert.equal(await page.evaluate(()=>PA.Nav.cur),'player');await end();
      await page.waitForFunction(()=>!document.querySelector('#player-live-mask[data-active]'));
      assert.equal(await page.evaluate(()=>PA.Nav.cur),'player');assert.equal(await page.locator('#sc-list').evaluate(n=>n.hidden),true);
      await library();await h.swipe('#mini-title',0,-110);
      await page.waitForFunction(()=>PA.Nav.cur==='player'&&document.querySelector('#sc-list').hidden&&!document.querySelector('#player-live-mask[data-active]'));
      assert.equal(await page.evaluate(()=>PA.Engine.current.id),'r2_fixture_0');
    });

    await run('real artwork downward drag retains its captured pointer stream through inert preview',async h=>{
      const {page,library,center,tap,start,move,end,frame}=h;await library();const mini=await center('#mini-title');await tap(mini.x,mini.y);
      await page.waitForFunction(()=>PA.Nav.cur==='player'&&document.querySelector('#sc-list').hidden);
      await page.evaluate(()=>{window.artVerticalTrace=[];const art=document.querySelector('#artstage');for(const type of ['pointerdown','pointermove','pointerup','pointercancel'])art.addEventListener(type,e=>artVerticalTrace.push({type,trusted:e.isTrusted}));});
      const p=await center('#artstage');await start(p.x,p.y);for(const dy of [20,40,60,90,120]){await move(p.x,p.y+dy);await frame();}await end();
      assert.equal(await page.evaluate(()=>PA.Nav.cur),'list','the actual artstage contact commits its vertical destination');
      await page.waitForFunction(()=>document.querySelector('#sc-player').hidden);
      const trace=await page.evaluate(()=>artVerticalTrace);assert.ok(trace.some(e=>e.type==='pointerup'));assert.equal(trace.some(e=>e.type==='pointercancel'),false,'making the origin scene inert must not lose the owning capture');assert.equal(trace.every(e=>e.trusted),true);
      assert.equal(await page.evaluate(()=>PA.Engine.current.id),'r2_fixture_0');
    });

    await run('horizontal artwork swipe changes exactly one track and never changes scene',async h=>{
      const {page,swipe}=h;await page.evaluate(()=>PA.SET.previousRestarts=false);
      await swipe('#artstage',-120,0);await page.waitForFunction(()=>PA.Engine.current.id==='r2_fixture_1');
      assert.equal(await page.evaluate(()=>PA.Nav.cur),'player');
      await swipe('#artstage',120,0);await page.waitForFunction(()=>PA.Engine.current.id==='r2_fixture_0');
      assert.equal(await page.evaluate(()=>PA.Nav.cur),'player');
      assert.equal(await page.evaluate(()=>PA.Engine.wantsPlayback()),false);
    });

    await run('real paused waveform scrub commits the final move without loading audio',async h=>{
      const {page,start,move,end,center}=h;
      await page.evaluate(()=>{PA.SET.seekStyle='wave';PA.SET.nativeSeekbar=0;PA.Engine.seek(90);});
      const tr=await center('#transport'),x=tr.box.x+tr.box.width*.72,y=tr.box.y+4;
      const requests=fixture.requests.audio;await start(x,y);await move(x-20,y);await move(x-70,y);await end();
      const span=await page.evaluate(()=>PA.Waveform.span(PA.Engine.duration()));
      assertClose(await page.evaluate(()=>PA.Engine.time()),90+70/tr.box.width*span,.6,'waveform final move commit');
      assert.equal(await page.evaluate(()=>PA.Engine.el().src),'');assert.equal(await page.evaluate(()=>PA.Engine.wantsPlayback()),false);
      assert.equal(await page.evaluate(()=>PA.UI.seekDragging),false);assert.equal(fixture.requests.audio,requests);
      await page.locator('#btn-play').tap();
      await page.waitForFunction(()=>PA.Engine.el().readyState>=3&&!PA.Engine.el().paused&&PA.Engine.el().currentTime>95,null,{timeout:10000});
      assert.ok(fixture.requests.audio>requests,'only a requested Play loads audio');
    });

    await run('real transport taps advance once and moved or canceled contact cannot skip',async h=>{
      const {page,center,start,move,end,tap,send}=h;
      await page.evaluate(()=>{PA.SET.previousRestarts=false;window.transportCalls=[];for(const action of ['next','prev']){const fn=PA.Engine[action];PA.Engine[action]=function(...args){transportCalls.push(action);return fn.apply(this,args);};}});
      const next=await center('[data-act="next"]');await tap(next.x,next.y);await page.waitForFunction(()=>PA.Engine.current.id==='r2_fixture_1');
      assert.deepEqual(await page.evaluate(()=>transportCalls),['next']);
      const prev=await center('[data-act="prev"]');await tap(prev.x,prev.y);await page.waitForFunction(()=>PA.Engine.current.id==='r2_fixture_0');
      assert.deepEqual(await page.evaluate(()=>transportCalls),['next','prev']);
      await start(next.x,next.y);await move(next.x+35,next.y+30);await end();
      await start(next.x,next.y);await send('touchCancel',[]);
      assert.deepEqual(await page.evaluate(()=>transportCalls),['next','prev']);
      assert.equal(await page.evaluate(()=>PA.Engine.current.id),'r2_fixture_0');
    });

    await run('a genuine next-button-origin waveform scrub seeks without a trailing track skip',async h=>{
      const {page,center,start,move,end,frame}=h;await page.evaluate(()=>{PA.Engine.seek(60);PA.SET.seekStyle='wave';PA.SET.nativeSeekbar=0;window.scrubSkips=0;const next=PA.Engine.next;PA.Engine.next=function(...args){scrubSkips++;return next.apply(this,args);};});
      const p=await center('[data-act="next"]'),requests=fixture.requests.audio;await start(p.x,p.y);await move(p.x-30,p.y);await frame();await move(p.x-70,p.y);await end();
      assert.equal(await page.evaluate(()=>scrubSkips),0);assert.equal(await page.evaluate(()=>PA.Engine.current.id),'r2_fixture_0');
      assert.ok(await page.evaluate(()=>PA.Engine.time()>60));assert.equal(await page.evaluate(()=>PA.Engine.wantsPlayback()),false);assert.equal(fixture.requests.audio,requests);
      await page.waitForTimeout(50);await h.tap(p.x,p.y);await page.waitForFunction(()=>PA.Engine.current.id==='r2_fixture_1');assert.equal(await page.evaluate(()=>scrubSkips),1,'fresh button tap after the scrub still works');
    });

    await run('previous restart honors restored paused resume position without changing cover',async h=>{
      const {page,swipe}=h;await page.evaluate(()=>{PA.Engine._resumePosition={id:PA.Engine.current.id,time:45};PA.SET.previousRestarts=true;});
      const before=await page.locator('#artA').evaluate(n=>n.style.backgroundImage),requests=fixture.requests.audio;
      assert.ok(before.includes('/__fixture__/cover/0.svg'));
      await swipe('#artstage',120,0);await page.waitForFunction(()=>PA.Engine.time()===0);
      assert.equal(await page.evaluate(()=>PA.Engine.current.id),'r2_fixture_0');
      assert.equal(await page.locator('#artA').evaluate(n=>n.style.backgroundImage),before);
      assert.equal(fixture.requests.audio,requests);assert.equal(await page.evaluate(()=>PA.Engine.el().src),'');
    });


    for(const mode of ['opening','closing','abort','regrab']){
      await run('late canonical artwork survives '+mode+' scene cleanup',async h=>{
        const {page,library,start,move,end,frame,center,settled}=h;
        if(mode!=='closing')await library();
        else{await library();await page.locator('#mini-title').tap();await settled('player');}
        const canonicalOpacity=await page.locator('#artA').evaluate(n=>n.style.opacity);
        await page.evaluate(origin=>{
          const track=PA.Engine.current;track.coverURL=null;track.artKey='fixture-scene-late-art';
          PA.UI.setArtEl(document.querySelector('#artA'),null);PA.UI.setArtEl(document.querySelector('#mini-art'),null);
          const get=PA.IDB.get;window.lateArtRequested=false;window.lateArtResolvers=[];window.lateArtWrites={};
          const writeArt=PA.UI.setArtEl;PA.UI.setArtEl=function(node,url){if(node.id==='artA'||node.id==='mini-art')lateArtWrites[node.id]=url;return writeArt.call(this,node,url);};
          PA.IDB.get=function(store,key){
            if(store==='art'&&String(key).startsWith('fixture-scene-late-art')){
              lateArtRequested=true;return new Promise(resolve=>lateArtResolvers.push(resolve));
            }return get.call(this,store,key);
          };
          window.releaseLateArt=async()=>{const blob=await(await fetch(origin+'/__fixture__/cover/1.svg')).blob();lateArtResolvers.forEach(resolve=>resolve(blob));};
          window.lateArtRender=PA.UI.renderNowPlaying(track);
        },fixture.origin);
        await page.waitForFunction(()=>lateArtRequested);
        const p=await center(mode==='closing'?'#artstage':'#mini-title'),direction=mode==='closing'?1:-1;
        await start(p.x,p.y);for(let i=1;i<=6;i++){await move(p.x,p.y+direction*500*i/6);await frame();}
        await page.waitForFunction(()=>document.querySelector('#player-live-mask').hasAttribute('data-active'));
        let grab=null;
        if(mode==='regrab'){
          await end();await frame();grab=await center('.player-scene-input');await start(grab.x,grab.y);await frame();
        }
        await page.evaluate(async()=>{await releaseLateArt();await lateArtRender;});
        const produced=await page.evaluate(async()=>{const image=new Image();image.src=lateArtWrites.artA;await image.decode();return {full:'url("'+lateArtWrites.artA+'")',mini:'url("'+lateArtWrites['mini-art']+'")',width:image.naturalWidth,height:image.naturalHeight};});
        assert.ok(produced.width>0&&produced.height>0,'late producer returned decoded image bytes');
        assert.equal(await page.locator('#artA').evaluate(n=>n.style.backgroundImage),produced.full,'cover resolves before retirement');
        assert.equal(await page.locator('#player-live-mask').evaluate(n=>n.hasAttribute('data-active')),true,'exercise a live scene, not a post-settle write');
        if(mode==='abort'){await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await end();}
        else if(mode==='regrab'){await move(grab.x,grab.y+300);await frame();await end();}
        else await end();
        const expected=mode==='closing'||mode==='abort'||mode==='regrab'?'list':'player';await settled(expected);
        assert.equal(await page.locator('#artA').evaluate(n=>n.style.backgroundImage),produced.full,'cleanup keeps exact latest producer artwork');
        assert.equal(await page.locator('#mini-art').evaluate(n=>n.style.backgroundImage),produced.mini,'mini keeps exact latest producer artwork');
        assert.equal(await page.locator('#artA').evaluate(n=>n.style.opacity),canonicalOpacity,'restore exact borrowed canonical opacity');
        assert.equal(await page.locator('#player-live-mask').evaluate(n=>n.hasAttribute('data-active')),false);
      });
    }

    await run('committed artwork remains decoded while a later art fetch is delayed',async h=>{
      const {page,swipe}=h;
      await page.waitForFunction(()=>document.querySelector('#artA').classList.contains('has'));
      await page.evaluate(()=>{
        window.artTrace=[];const set=PA.UI.setArtEl;PA.UI.setArtEl=function(node,url){if(node.id==='artA'||node.id==='mini-art')artTrace.push({node:node.id,url,id:PA.Engine.current?.id});return set.call(this,node,url);};
      });
      await swipe('#artstage',-120,0);await page.waitForFunction(()=>PA.Engine.current.id==='r2_fixture_1');
      const committed=await page.locator('#artA').evaluate(n=>n.style.backgroundImage);
      assert.ok(committed.includes('/__fixture__/cover/1.svg'));
      await page.evaluate(async()=>{const image=new Image();image.src=PA.Engine.current.coverURL;await image.decode();if(!image.complete||!image.naturalWidth)throw Error('Committed fixture art is not decoded');});
      await page.evaluate(origin=>{
        const track=PA.Engine.current;delete track.coverURL;track.artKey='fixture-delayed-art';
        const get=PA.IDB.get;window.releaseArt=null;window.artResolvers=[];window.artFetchRequested=false;
        PA.IDB.get=function(store,key){if(store==='art'&&String(key).startsWith('fixture-delayed-art')){
          artFetchRequested=true;return new Promise(resolve=>{artResolvers.push(resolve);releaseArt=async()=>{const blob=await (await fetch(origin+'/__fixture__/cover/1.svg')).blob();artResolvers.forEach(resolve=>resolve(blob));};});
        }return get.call(this,store,key);};
        window.pendingArtRender=PA.UI.renderNowPlaying(track);
      },fixture.origin);
      await page.waitForFunction(()=>artFetchRequested);
      assert.equal(await page.locator('#artA').evaluate(n=>n.style.backgroundImage),committed,'selected-track refresh must preserve committed art during delayed fetch');
      assert.equal(await page.locator('#mini-art').evaluate(n=>n.classList.contains('has')),true);
      // A second selection supersedes the fetch; its eventual result must not overwrite the new art.
      await page.evaluate(()=>{PA.Engine.current=PA.Engine.queue[2];PA.Engine.pos=2;window.newArtRender=PA.UI.renderNowPlaying(PA.Engine.current);});
      await page.waitForFunction(()=>document.querySelector('#artA').style.backgroundImage.includes('/__fixture__/cover/2.svg'));
      await page.evaluate(async()=>{await releaseArt();await pendingArtRender;await newArtRender;});
      assert.ok((await page.locator('#artA').evaluate(n=>n.style.backgroundImage)).includes('/__fixture__/cover/2.svg'));
      assert.equal(await page.evaluate(()=>artTrace.some(x=>x.id==='r2_fixture_1'&&x.url===null)),false,'no placeholder flash at the committed-track handoff');
    });
  }finally{await browser?.close();await fixture.close();}
});
