import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {servePowerampFixture,openFixturePage,reportFixtureFailure} from './helpers/poweramp-fixture.js';

// Required trusted-input target: missing or broken Chromium fails, never skips.
const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
test('Poweramp mandatory Chromium library history contracts',{timeout:120000},async t=>{
  assert.ok(executablePath,'Chromium is required: install it or set JARVIS_CHROME');
  const fixture=await servePowerampFixture();let browser;
  try{
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    const run=(name,fn,options={})=>t.test(name,async()=>{const h=await openFixturePage(browser,fixture,options);try{await fn(h);assert.deepEqual(h.errors,[]);}catch(error){await reportFixtureFailure(h,error,name);throw error;}finally{await h.close();}});
    await run('trusted row-origin right/left restores Library and its just-left category',async h=>{
      const {page,library,swipe}=h;await library();await page.evaluate(()=>{window.pageTrace=[];document.addEventListener('pointerdown',e=>pageTrace.push({trusted:e.isTrusted,row:!!e.target.closest('.trow')}),true);});
      await swipe('#list-body .trow:nth-of-type(3)',120,0);await page.waitForFunction(()=>PA.Nav.cur==='library'&&document.querySelector('#library-page-motion').hidden);
      assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.peek(1).spec.kind),'all');
      await swipe('#lib-cats .catrow:first-child',-120,0);await page.waitForFunction(()=>PA.Nav.cur==='list'&&document.querySelector('#library-page-motion').hidden);
      assert.equal(await page.evaluate(()=>PA.Views.currentSpec.kind),'all');assert.ok(await page.evaluate(()=>pageTrace.every(e=>e.trusted)));assert.ok(await page.evaluate(()=>pageTrace.some(e=>e.row)));
    });
    await run('ordinary trusted row taps and keyboard actions retain playback',async h=>{
      const {page,library,center,tap}=h;await library();await page.evaluate(()=>{window.playRowCalls=0;const set=PA.Engine.setQueue;PA.Engine.setQueue=function(...args){playRowCalls++;return set.apply(this,args);};});
      const expected=await page.locator('#list-body .trow[data-i="1"]').getAttribute('data-id'),p=await center('#list-body .trow[data-i="1"]');await tap(p.x,p.y);await page.waitForFunction(()=>playRowCalls===1);assert.equal(await page.evaluate(()=>PA.Engine.current.id),expected);
      await library();const keyboard=page.locator('#list-body .trow[data-i="2"]'),keyboardId=await keyboard.getAttribute('data-id');await keyboard.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>playRowCalls===2);assert.equal(await page.evaluate(()=>PA.Engine.current.id),keyboardId);
    });
    await run('trusted nested Back/Forward and new category branches keep exact ancestry',async h=>{
      const {page,swipe,settled}=h;await page.locator('[data-nav="library"]').tap();await settled('library');await page.getByRole('button',{name:'Artists',exact:true}).tap();await settled('list');
      const group=page.locator('#list-body .trow,#list-body .gcard').first(),name=await group.getAttribute('aria-label');await group.tap();await settled('list');assert.equal(await page.evaluate(()=>PA.Views.currentSpec.kind),'artist');
      await swipe('#list-body',120,0);await page.waitForFunction(()=>PA.Views.currentSpec.kind==='artists'&&document.querySelector('#library-page-motion').hidden);
      assert.deepEqual(await page.evaluate(()=>PA.Views.stack.map(s=>s.kind)),['artists']);
      await swipe('#list-body',-120,0);await page.waitForFunction(()=>PA.Views.currentSpec.kind==='artist'&&document.querySelector('#library-page-motion').hidden);assert.equal(await page.evaluate(()=>PA.Views.currentSpec.title),name);
      const index=await page.evaluate(()=>PA.LibraryPageHistory.index);
      // Match the failure's real label-origin contact after a horizontal swipe.
      await page.locator('#sc-list .library-back span').tap();await settled('list');assert.equal(await page.evaluate(()=>PA.Views.currentSpec.kind),'artists');assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),index-1,'one fresh Back contact goes to exactly one parent');
      await page.locator('#list-body .trow,#list-body .gcard').nth(1).tap();await settled('list');assert.equal(await page.evaluate(()=>PA.Views.currentSpec.kind),'artist');
      assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.peek(1)),null);assert.deepEqual(await page.evaluate(()=>PA.Views.stack.map(s=>s.kind)),['artists','artist']);
    });
    await run('trusted nested Back rejects moved resized and multi-touch contacts then accepts fresh input',async h=>{
      const {page,settled,center,start,move,end,tap,frame,swipe}=h;
      await page.locator('[data-nav="library"]').tap();await settled('library');await page.getByRole('button',{name:'Artists',exact:true}).tap();await settled('list');
      await page.locator('#list-body .trow,#list-body .gcard').first().tap();await settled('list');const index=await page.evaluate(()=>PA.LibraryPageHistory.index);
      await swipe('#list-body',120,0);await settled('list');await swipe('#list-body',-120,0);await settled('list');
      const p=await center('#sc-list .library-back span');await start(p.x,p.y);await move(p.x+30,p.y);await frame();await end();await frame();
      assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),index,'moved Back contact stays on the child');assert.equal(await page.evaluate(()=>PA.Views.currentSpec.kind),'artist');
      await start(p.x,p.y);await page.setViewportSize({width:394,height:852});await frame();await end();await frame();
      assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),index,'resize cancels the pending Back action');
      const fresh=await center('#sc-list .library-back span');await start(fresh.x,fresh.y);await h.send('touchStart',[h.point(fresh.x,fresh.y),h.point(fresh.x+2,fresh.y+2,2)]);await end();await frame();
      assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),index,'multi-touch cannot navigate Back');
      await tap(fresh.x,fresh.y);await settled('list');assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),index-1);assert.deepEqual(await page.evaluate(()=>PA.Views.stack.map(s=>s.kind)),['artists']);
      await swipe('#list-body',-120,0);await settled('list');await page.locator('#sc-list .library-back').focus();await page.keyboard.press('Enter');await settled('list');
      assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),index-1);assert.equal(await page.evaluate(()=>PA.Views.currentSpec.kind),'artists');assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.peek(1).spec.kind),'artist');
    });
    await run('5000-song Back/Forward restores a large viewport without mounting all tracks',async h=>{
      const {page,library,swipe}=h;await library();await page.evaluate(()=>{document.querySelector('#list-body').scrollTop=120000;});await h.frame();await h.frame();
      const saved=await page.locator('#list-body').evaluate(n=>n.scrollTop);assert.ok(saved>100000);
      const p=await h.center('#list-body');await h.start(p.x,p.y);await h.move(p.x+120,p.y);await h.frame();
      assert.ok(Math.abs((await page.evaluate(()=>PA.LibraryPageMotion.state.from.querySelector('[data-page-source-id="list-body"]').scrollTop))-saved)<2,'in-flight snapshot preserves the laid-out viewport');
      await h.end();await page.waitForFunction(()=>PA.Nav.cur==='library'&&document.querySelector('#library-page-motion').hidden);
      await swipe('#lib-cats',-120,0);await page.waitForFunction(()=>PA.Nav.cur==='list'&&document.querySelector('#library-page-motion').hidden);await h.frame();
      assert.ok(Math.abs((await page.locator('#list-body').evaluate(n=>n.scrollTop))-saved)<2);assert.ok(await page.locator('#list-body .trow').count()<100);assert.equal(await page.locator('#list-body .zoom-list').evaluate(n=>n.__items.length),5000);
    },{count:5000,art:false});
    await run('distant saved viewport survives leaving for player and visiting another category',async h=>{
      const {page,library,swipe,settled,center,tap,frame}=h;await library();
      await page.locator('#list-body').evaluate(body=>{body.scrollTop=120000;});await frame();await frame();
      const before=await page.locator('#list-body').evaluate(body=>({top:body.scrollTop,ids:Array.from(body.querySelectorAll('.trow')).map(row=>row.dataset.id)}));
      assert.ok(before.top>100000);assert.ok(before.ids.length>0&&before.ids.length<100);
      const mini=await center('#mini-title');await tap(mini.x,mini.y);await settled('player');
      assert.ok(await page.evaluate(()=>fixtureInputTrace.some(event=>event.type==='pointerdown'&&event.miniTitle&&event.trusted)),'leaving the saved viewport uses a real trusted mini title contact');
      await page.locator('[data-nav="library"]').tap();await settled('library');
      await page.getByRole('button',{name:'Albums',exact:true}).tap();await settled('list');
      assert.equal(await page.evaluate(()=>PA.Views.currentSpec.kind),'albums');
      await swipe('#list-body',120,0);await settled('library');
      await swipe('#lib-cats',120,0);await settled('list');await frame();
      assert.equal(await page.evaluate(()=>PA.Views.currentSpec.kind),'all');
      const after=await page.locator('#list-body').evaluate(body=>({top:body.scrollTop,ids:Array.from(body.querySelectorAll('.trow')).map(row=>row.dataset.id)}));
      assert.ok(Math.abs(after.top-before.top)<2,'a different category must not replace the saved distant viewport: '+JSON.stringify({before:before.top,after:after.top}));
      assert.deepEqual(after.ids,before.ids,'the same windowed rows return after the cross-scene visit');assert.ok(after.ids.length<100);
    },{count:5000,art:false});
    await run('real native vertical scrolling and long press retain the existing owners',async h=>{
      const {page,library,center,start,move,end,frame}=h;await library();const p=await center('#list-body .trow[data-i="2"]');const index=await page.evaluate(()=>PA.LibraryPageHistory.index);
      await start(p.x,p.y);for(let i=1;i<=5;i++){await move(p.x,p.y-120*i/5);await frame();}await end();await page.waitForTimeout(100);
      assert.ok(await page.locator('#list-body').evaluate(n=>n.scrollTop)>0);assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),index);
      const row=await center('#list-body .trow[data-i="5"]');await start(row.x,row.y);await page.waitForTimeout(600);await end();assert.equal(await page.evaluate(()=>PA.Selection.mode),true);assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),index);
    },{count:120,art:false});
    await run('trusted stationary row contact canceled by resize stays inert and a fresh tap works',async h=>{
      const {page,library,center,start,end,tap,frame}=h;await library();await page.evaluate(()=>{window.canceledRowCalls=0;const set=PA.Engine.setQueue;PA.Engine.setQueue=function(...args){canceledRowCalls++;return set.apply(this,args);};});
      const p=await center('#list-body .trow[data-i="2"]');await start(p.x,p.y);await page.setViewportSize({width:394,height:852});await frame();await end();assert.equal(await page.evaluate(()=>canceledRowCalls),0);
      const fresh=await center('#list-body .trow[data-i="2"]');await tap(fresh.x,fresh.y);await page.waitForFunction(()=>canceledRowCalls===1);
    });
    await run('trusted root category vertical scroll cannot become category navigation',async h=>{
      const {page,center,start,move,end,frame}=h;await page.locator('[data-nav="library"]').tap();await page.waitForFunction(()=>PA.Nav.cur==='library'&&!document.querySelector('#sc-library').inert&&!document.querySelector('#sc-library').dataset.scene);const index=await page.evaluate(()=>PA.LibraryPageHistory.index),p=await center('#lib-cats .catrow[data-k="albums"]');
      await start(p.x,p.y);for(let i=1;i<=5;i++){await move(p.x,p.y-i*24);await frame();}await end();await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>PA.Nav.cur),'library');assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),index);assert.ok(await page.locator('#lib-cats').evaluate(n=>n.scrollTop)>0);
    });
    await run('trusted horizontal intent during generic vertical arrival leaves its geometry continuous',async h=>{
      const {page,start,move,end}=h;
      // Host/CDP latency can outlive the 220ms arrival after a geometry poll.
      // Hold its real CSS transitions and fallback clock at an intermediate
      // frame so trusted input must exercise the overlapping scene owners.
      const fixtureTime=new Date('2026-10-10T00:00:00Z');
      await page.clock.install({time:fixtureTime});await page.clock.pauseAt(fixtureTime);
      await page.evaluate(()=>{
        PA.SET.animations='disabled';PA.Nav.go('settings');PA.SET.animations='normal';PA.Nav.go('library');window.crossAxisTrace=null;
        const incoming=document.querySelector('#sc-library'),animations=incoming.getAnimations();
        for(const selector of ['#sc-settings','#sc-library'])for(const animation of document.querySelector(selector).getAnimations()){
          animation.pause();animation.currentTime=Number(animation.effect.getTiming().duration)/3;
        }
        const rect=incoming.getBoundingClientRect();window.crossAxisPose={animations:animations.length,scene:incoming.dataset.scene,top:rect.top,bottom:rect.bottom};
        document.addEventListener('pointermove',e=>{if(!e.target.closest('#sc-library'))return;const n=document.querySelector('#sc-library');crossAxisTrace={trusted:e.isTrusted,read_at_ms:performance.now(),scene:n.dataset.scene,before:new DOMMatrixReadOnly(getComputedStyle(n).transform).m42};},true);
        document.addEventListener('pointermove',e=>{if(!e.target.closest('#sc-library')||!crossAxisTrace)return;const s=PA.LibraryPageMotion.state;crossAxisTrace.after=new DOMMatrixReadOnly(getComputedStyle(s?.from||document.querySelector('#sc-library')).transform).m42;crossAxisTrace.backdrop=s?.backdrop?.node.dataset.librarySnapshot;crossAxisTrace.after_at_ms=performance.now();});
      });
      const pose=await page.evaluate(()=>crossAxisPose);assert.ok(pose.animations>0);assert.equal(pose.scene,'1');assert.ok(pose.bottom>350&&pose.top<-35,JSON.stringify(pose));
      await start(120,100);await move(240,100);
      const trace=await page.evaluate(()=>crossAxisTrace);assert.ok(trace?.trusted);assert.equal(trace.scene,'1');assert.ok(trace.before<-35,JSON.stringify(trace));assert.ok(Math.abs(trace.before-trace.after)<3);assert.equal(trace.backdrop,'settings');assert.equal(await page.evaluate(()=>PA.LibraryPageMotion.state?.backdrop?.node.dataset.librarySnapshot),'settings');
      await end();await page.clock.runFor(500);await page.waitForFunction(()=>document.querySelector('#library-page-motion').hidden);assert.equal(await page.evaluate(()=>PA.Nav.cur),'library');
    });
    await run('trusted settle regrab freezes displayed pages, stays inert, and reverses once',async h=>{
      const {page,library,start,move,end,frame,center}=h;await library();const initial=await page.evaluate(()=>({index:PA.LibraryPageHistory.index}));
      // Install before release, leaving no page-evaluate round trips between
      // touchEnd and the next trusted touchStart while the CSS settle is live.
      await page.evaluate(()=>{
        window.libraryInterruption=null;
        const read=n=>{const at_ms=performance.now(),matrix=new DOMMatrixReadOnly(getComputedStyle(n).transform);return {id:n.id,x:matrix.m41,y:matrix.m42,read_at_ms:at_ms,read_done_ms:performance.now()};};
        document.addEventListener('pointerdown',e=>{if(e.target.id!=='library-page-motion')return;const s=PA.LibraryPageMotion.state;libraryInterruption={trusted:e.isTrusted,event_timestamp:e.timeStamp,contact_at_ms:performance.now(),pending:!!PA.LibraryPageMotion.finish?.pending,before:read(s.commit?s.to:s.from),pages_before:[s.from,s.to,s.backdrop?.node].filter(Boolean).map(read)};},true);
        document.addEventListener('pointerdown',e=>{if(e.target.id!=='library-page-motion'||!libraryInterruption)return;const s=PA.LibraryPageMotion.state;libraryInterruption.after=read(s.from);libraryInterruption.pages_after=[s.from,s.to,s.backdrop?.node].filter(Boolean).map(read);libraryInterruption.event_done_ms=performance.now();});
        const pause=PA.LibraryPageMotion.pause;
        PA.LibraryPageMotion.pause=function(...args){
          const evidence=window.libraryInterruption,finish=this.finish;if(!evidence||!finish?.pending)return pause.apply(this,args);
          evidence.pause_before=read(this.state.commit?this.state.to:this.state.from);
          const cancel=finish.cancel;finish.cancel=function(...cancelArgs){evidence.cancel_at_ms=performance.now();try{return cancel.apply(this,cancelArgs);}finally{evidence.cancel_done_ms=performance.now();}};
          try{const result=pause.apply(this,args);evidence.pause_returned=result;evidence.pause_after=read(this.state.from);return result;}finally{finish.cancel=cancel;}
        };
      });
      const p=await center('#list-body .trow[data-i="2"]');await start(p.x,p.y);await move(p.x+100,p.y);await frame();await page.waitForTimeout(125);await end();await start(160,200);
      assert.equal(await page.evaluate(()=>PA.Nav.cur),'library');assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),initial.index-1);const interrupted=await page.evaluate(()=>libraryInterruption),detail=JSON.stringify(interrupted);
      assert.ok(interrupted?.trusted,detail);assert.equal(interrupted.pending,true,detail);assert.equal(interrupted.pause_returned,true,detail);assert.equal(interrupted.before.id,interrupted.after.id,detail);
      assert.ok(Math.abs(interrupted.before.x-interrupted.after.x)<3,'incoming page continuity: '+detail);
      for(const before of interrupted.pages_before){const after=interrupted.pages_after.find(page=>page.id===before.id);assert.ok(after&&Math.abs(before.x-after.x)<3&&Math.abs(before.y-after.y)<3,'all painted pages retain their positions: '+detail);}
      const held=interrupted.after.x;await page.waitForTimeout(280);
      assert.ok(Math.abs((await page.evaluate(()=>new DOMMatrixReadOnly(getComputedStyle(PA.LibraryPageMotion.state.from).transform).m41))-held)<2);assert.equal(await page.evaluate(()=>document.querySelector('#sc-library').inert),true);
      await move(40,200);await frame();await end();await page.waitForFunction(()=>document.querySelector('#library-page-motion').hidden);assert.equal(await page.evaluate(()=>PA.Nav.cur),'list');assert.equal(await page.evaluate(()=>PA.LibraryPageHistory.index),initial.index);
      assert.equal(await page.evaluate(()=>{const ids=[...document.querySelectorAll('[id]')].map(n=>n.id);return new Set(ids).size===ids.length;}),true);
    });
  }finally{await browser?.close();await fixture.close();}
});
