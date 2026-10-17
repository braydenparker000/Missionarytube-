import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright-core';
import {buildPreview} from '../scripts/build-poweramp-preview.mjs';

// Downloaded production boot, exact owner viewport/DPR, real CDP touch input.
// No app/gesture/render objects are stubbed. Chromium is mandatory; no skip.
const profile={viewport:{width:519,height:988},deviceScaleFactor:2.0818214416503906,isMobile:true,hasTouch:true};
const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',chromium.executablePath()].find(path=>path&&existsSync(path));
async function state(page){
  return page.evaluate(()=>{
    const screenDrag=PA.__blankLibrary.screen,input=PA.__blankLibrary.input;
    const rect=n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return {connected:n.isConnected,hidden:n.hidden,inert:n.inert,aria:n.getAttribute('aria-hidden'),classes:n.className,scene:n.dataset.scene||null,shared:n.dataset.sharedPlayer||null,display:s.display,visibility:s.visibility,opacity:s.opacity,transform:s.transform,overflow:s.overflow,clip:s.clipPath,zIndex:s.zIndex,translation:s.transform==='none'?{x:0,y:0}:{x:new DOMMatrixReadOnly(s.transform).m41,y:new DOMMatrixReadOnly(s.transform).m42},rect:{left:r.left,top:r.top,width:r.width,height:r.height}};};
    const selectors=['#app','#sc-player','#sc-library','#sc-list','#mini','#nav','#list-body','#lib-cats','#library-page-motion','#player-live-mask','#player-live-backdrop-mask','#player-live-input'];
    return {screen:PA.Nav.cur,body:document.body.className,history:{index:PA.LibraryPageHistory.index,visits:PA.LibraryPageHistory.entries.length},appearance:powerampPreview.appearanceStatus(),scene:!!(screenDrag.state||screenDrag.settling),horizontal:!!PA.LibraryPageMotion.state,contact:!!input.gesture,orphanPaint:document.querySelectorAll('.player-scene-layer,.player-scene-input,#player-live-mask[data-active],#player-live-backdrop-mask[data-active]').length,nodes:Object.fromEntries(selectors.map(selector=>[selector,document.querySelector(selector)?rect(document.querySelector(selector)):null])),regrabs:(window.blankLibraryRegrabs||[]).map(({pointerId,trusted,pending,closing,after})=>({pointerId,trusted,pending,closing,after})),visibleRows:[...document.querySelectorAll('#list-body .trow,#lib-cats .catrow')].filter(n=>{const r=n.getBoundingClientRect(),s=getComputedStyle(n);return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight&&s.display!=='none'&&s.visibility==='visible';}).length};
  });
}
async function visibleEndpoint(page,screen){
  await page.waitForFunction(screen=>{const drag=PA.__blankLibrary.screen,input=PA.__blankLibrary.input;return PA.Nav.cur===screen&&!drag.state&&!drag.settling&&!PA.LibraryPageMotion.state&&!PA.LibraryPageMotion.finish&&!input.gesture&&!document.querySelector('.player-scene-input');},screen);
  // Pending idle preparation must also leave the same canonical endpoint.
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const value=await state(page),active=value.nodes['#sc-'+screen],detail=JSON.stringify(value);
  assert.equal(active.connected,true,detail);assert.equal(active.hidden,false,detail);assert.equal(active.inert,false,detail);assert.equal(active.aria,'false',detail);
  assert.notEqual(active.display,'none',detail);assert.equal(active.visibility,'visible',detail);assert.ok(Number(active.opacity)>.99,detail);
  assert.ok(active.rect.width>0&&active.rect.height>0,detail);assert.ok(active.rect.left<519&&active.rect.top<988&&active.rect.left+active.rect.width>0&&active.rect.top+active.rect.height>0,detail);
  assert.ok(Math.abs(active.translation.x)<.01&&Math.abs(active.translation.y)<.01,detail);assert.ok(!active.classes.includes('library-page-covered'),detail);assert.equal(active.scene,null,detail);assert.equal(active.shared,null,detail);
  assert.equal(value.orphanPaint,0,detail);assert.equal(value.nodes['#player-live-backdrop-mask'].hidden,true,detail);assert.equal(value.nodes['#player-live-input'].hidden,true,detail);assert.equal(value.nodes['#library-page-motion'].hidden,true,detail);
  for(const name of ['player','library','list'])if(name!==screen){assert.equal(value.nodes['#sc-'+name].hidden,true,detail);assert.equal(value.nodes['#sc-'+name].inert,true,detail);}
  if(['library','list'].includes(screen)){
    assert.ok(value.visibleRows>0,detail);assert.equal(value.nodes['#mini'].hidden,false,detail);assert.equal(value.nodes['#mini'].visibility,'visible',detail);assert.ok(Number(value.nodes['#mini'].opacity)>.99,detail);
    assert.notEqual(value.nodes['#nav'].display,'none',detail);assert.ok(!value.body.split(/\s+/).includes('in-settings'),detail);
  }
  return value;
}
async function evidence(page,label,result){
  if(!process.env.POWERAMP_EVIDENCE_DIR)return;
  const directory=resolve(process.env.POWERAMP_EVIDENCE_DIR);await mkdir(directory,{recursive:true});
  const safe=label.replace(/[^a-z\d-]+/gi,'-');await writeFile(join(directory,'blank-library-'+safe+'.json'),JSON.stringify(result,null,2)+'\n');
  await page.screenshot({path:join(directory,'blank-library-'+safe+'.png'),fullPage:true});
}

test('Poweramp downloaded 5000-track mini round trips restore visible library UI',{timeout:180000},async t=>{
  assert.ok(executablePath,'Chromium is required: install it or set JARVIS_CHROME');
  const directory=await mkdtemp(join(tmpdir(),'poweramp-blank-library-'));let browser;
  try{
    const built=await buildPreview(join(directory,'preview.html'));
    // The real app and preview keep these controllers inside an IIFE. Expose
    // read-only inspection aliases only in this disposable test artifact.
    const html=await readFile(built.output,'utf8'),anchor='window.PA = {';
    assert.equal(html.split(anchor).length-1,1,'one private-controller fixture injection anchor');
    await writeFile(built.output,html.replace(anchor,'window.PA = {__blankLibrary:{screen:ScreenDrag,input:InputLifecycle},'),'utf8');
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    for(const destination of ['list','library'])await t.test(destination+' ordinary, canceled and regrabbed mini round trips',async()=>{
      const context=await browser.newContext(profile),page=await context.newPage(),errors=[],endpoints=[];
      page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
      try{
        await context.route('**/*',route=>/^https?:/.test(route.request().url())?route.abort('blockedbyclient'):route.continue());
        await page.goto(pathToFileURL(built.output).href);await page.waitForFunction(()=>window.powerampPreview?.ready);
        await page.locator('#preview-size').tap();await page.waitForFunction(()=>powerampPreview.ready&&powerampPreview.count===5000);
        await page.evaluate(()=>{PA.SET.animations='default';PA.SET.playerLayout='classic';PA.SET.bgBlur=5;PA.SET.vizOnPlayer=false;PA.NativeSettings.values.list_header_buttons=1;PA.applySettings();});
        await page.locator('[data-nav="library"]').tap();await visibleEndpoint(page,'library');
        if(destination==='list'){await page.getByRole('button',{name:'All Songs',exact:true}).tap();await visibleEndpoint(page,'list');}
        await page.evaluate(()=>document.fonts.ready);
        await page.evaluate(()=>{
          window.blankLibraryRegrabs=[];
          document.addEventListener('pointerdown',e=>{
            if(!e.target.classList?.contains('player-scene-input'))return;
            const drag=PA.__blankLibrary.screen,scene=drag.state||drag.settling;
            blankLibraryRegrabs.push({pointerId:e.pointerId,trusted:e.isTrusted,pending:!!drag.finish?.pending,closing:!!scene?.morph&&!scene.morph.opening,scene,after:null});
          },true);
          document.addEventListener('pointerdown',e=>{
            const contact=blankLibraryRegrabs.at(-1);if(!contact||contact.pointerId!==e.pointerId||!e.target.classList?.contains('player-scene-input'))return;
            const drag=PA.__blankLibrary.screen;
            contact.after={paused:drag.finish===null,sameScene:(drag.state||drag.settling)===contact.scene,ownerMatches:PA.__blankLibrary.input.gesture?.node===e.target};
          });
        });
        const cdp=await context.newCDPSession(page),point=(x,y)=>({id:1,x,y,radiusX:1,radiusY:1,force:1});
        const start=(x,y)=>cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[point(x,y)]});
        const move=(x,y)=>cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[point(x,y)]});
        const end=()=>cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
        const cancel=()=>cdp.send('Input.dispatchTouchEvent',{type:'touchCancel',touchPoints:[]});
        const frame=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(done)));
        const center=selector=>page.locator(selector).evaluate(n=>{const r=n.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};});
        const close=async(dy=169,canceled=false,regrab=false)=>{
          const p=await center('#artA');await start(p.x,p.y);
          for(let i=1;i<=5;i++){await move(p.x,p.y+dy*i/5);await frame();}
          if(canceled)await cancel();
          else if(regrab){
            // Queue trusted release and new contact back-to-back on one CDP
            // session. No DOM wait or host round trip can consume the settle.
            const ending=end(),grabbing=start(260,240);await Promise.all([ending,grabbing]);
          }else await end();
        };
        const open=async()=>{await page.locator('#mini-sub').tap();await visibleEndpoint(page,'player');};
        for(const mode of ['ordinary','repeat','under-threshold','canceled','regrab','reverse','cancel-regrab']){
          await open();
          if(mode==='under-threshold'){
            await close(15);await visibleEndpoint(page,'player');await close();
          }else if(mode==='canceled'){
            await close(124,true);await visibleEndpoint(page,'player');await close();
          }else{
            const regrab=['regrab','reverse','cancel-regrab'].includes(mode);
            await close(mode==='repeat'?90:169,false,regrab);
            if(regrab){
              const captured=await page.evaluate(()=>{const event=blankLibraryRegrabs.at(-1);return event?{trusted:event.trusted,pending:event.pending,closing:event.closing,after:event.after}:null;});
              assert.deepEqual(captured,{trusted:true,pending:true,closing:true,after:{paused:true,sameScene:true,ownerMatches:true}},'trusted regrab must pause the live pending collapse');
              await move(260,mode==='reverse'?75:280);await frame();
              if(mode==='cancel-regrab')await cancel();else await end();
              if(mode==='reverse'){await visibleEndpoint(page,'player');await close();}
            }
          }
          const settled=await visibleEndpoint(page,destination);endpoints.push({mode,...settled});
          // Exercise any pending appearanceStage slices and re-check stability.
          await page.waitForTimeout(280);endpoints.push({mode:mode+'-idle',...await visibleEndpoint(page,destination)});
          assert.deepEqual(errors,[],'runtime error after '+mode);
        }
        await evidence(page,destination+'-success',{sourceHash:built.sourceHash,profile,endpoints,errors});
      }catch(error){await evidence(page,destination+'-failure',{sourceHash:built.sourceHash,profile,endpoints,errors,failure:String(error),final:await state(page)});throw error;}
      finally{await context.close();}
    });
  }finally{await browser?.close();await rm(directory,{recursive:true,force:true});}
});
