import {instrumentFixtureBoot} from './helpers/poweramp-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome',chromium.executablePath()].find(p=>p&&existsSync(p));
const root=fileURLToPath(new URL('../public/',import.meta.url));
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
function wav(){
  const rate=8000,length=rate*180*2,b=Buffer.alloc(44+length);
  b.write('RIFF');b.writeUInt32LE(36+length,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(length,40);return b;
}

test('Poweramp real Chrome touch and large-library regressions',{timeout:120000},async t=>{
  assert.ok(executablePath,'Chromium is required: install it or set JARVIS_CHROME');
  const audio=wav();let audioRequests=0;
  const server=createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/fixture.wav'){
        audioRequests++;const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');
        const start=range?+range[1]:0,end=range&&range[2]?Math.min(+range[2],audio.length-1):audio.length-1;
        res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${audio.length}`}:{})});return res.end(audio.subarray(start,end+1));
      }
      let path=resolve(root,'.'+decodeURIComponent(pathname));if(!path.startsWith(root.endsWith(sep)?root:root+sep))throw Error('Invalid path');
      if((await stat(path)).isDirectory())path=join(path,'index.html');
      res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});const bytes=await readFile(path);res.end(path.endsWith('/drawercast/player.js')?instrumentFixtureBoot(bytes.toString()):bytes);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${server.address().port}`;let browser,context;
  try{
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
    // External sources are disabled and intercepted. Only the local WAV fixture can play.
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin!==origin)return route.abort('blockedbyclient');
      if(url.pathname==='/assets/r2-config.json')return route.fulfill({contentType:'application/json',body:JSON.stringify({manifestURL:'fixture-disabled',rootId:''})});
      return route.continue();
    });
    await context.addInitScript(()=>localStorage.setItem('drawercast.sources.v1',JSON.stringify({local:false,drive:false,r2:false,server:false})));
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('Poweramp browser error:',e.message);});
    await page.goto(origin+'/drawercast/');
    await page.waitForFunction(()=>window.PA?.R2Source.manifestURL==='fixture-disabled');await page.evaluate(()=>window.__powerampBootPromise);
    await page.evaluate(async origin=>{
      const {LIB,SET,SourceLibrary,Engine,R2Source,UI,Views,NativeSettings}=PA;
      SourceLibrary.flags.r2=true;SET.animations='normal';SET.listZoom={files:3};SET.keepQueue=true;
      const tracks=Array.from({length:5000},(_,i)=>({id:'r2_fixture_'+i,source:'r2',remote:true,remoteId:'fixture_'+i,
        title:String.fromCharCode(65+Math.floor(i*26/5000))+' '+String(i).padStart(5,'0'),artist:'Fixture artist',album:'Fixture album',
        path:'Fixture/'+i+'.wav',ext:'wav',dur:180,size:2880044,track:0,rating:0,added:i,plays:0}));
      LIB.ids=tracks.map(t=>t.id);LIB.map=new Map(tracks.map(t=>[t.id,t]));
      R2Source.fileFor=()=>({__remoteURL:origin+'/fixture.wav',name:'fixture.wav',size:2880044,type:'audio/wav'});
      Engine.queue=tracks;Engine.order=tracks.map((_,i)=>i);Engine.pos=0;Engine.current={...tracks[0],dur:0};Engine.dur=0;
      Engine.els.forEach(a=>{a.pause();a.removeAttribute('src');a.load();});
      SET.playerButtons=['viz','queue','lyrics','repeat','shuffle'];NativeSettings.apply();
      await UI.renderNowPlaying(Engine.current);Views.renderLibrary();UI.renderProgress();
    },origin);
    const cdp=await context.newCDPSession(page);
    const point=(id,x,y)=>({id,x,y,radiusX:1,radiusY:1,force:1});
    const send=(type,points)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});
    const tap=async(x,y)=>{await send('touchStart',[point(1,x,y)]);await send('touchEnd',[]);};
    const nextFrame=()=>page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>done())));
    const library=async()=>{await page.locator('[data-nav="library"]').tap();await page.getByRole('button',{name:'All Songs',exact:true}).tap();await nextFrame();};

    await t.test('touch seeking on an unloaded paused song previews immediately and resumes from that position',async()=>{
      await library();const rail=await page.locator('#mini-seek').boundingBox();assert.ok(rail);
      await page.evaluate(()=>{window.pointerTrace=[];for(const type of ['pointerdown','pointerup','pointercancel','click'])document.addEventListener(type,e=>{pointerTrace.push({type,target:e.target.closest('[id]')?.id,id:e.pointerId,x:e.clientX,y:e.clientY});},true);});
      assert.equal(await page.locator('#mini-seek').getAttribute('aria-valuemax'),'180');
      await send('touchStart',[point(1,rail.x+rail.width*.2,rail.y+rail.height/2)]);
      assert.ok(Math.abs(Number(await page.locator('#mini-seek').getAttribute('aria-valuenow'))-36)<=1);
      for(const fraction of [.3,.4,.5,.6,.7]){await send('touchMove',[point(1,rail.x+rail.width*fraction,rail.y+rail.height/2)]);await nextFrame();}
      assert.ok(Math.abs(Number(await page.locator('#mini-seek').getAttribute('aria-valuenow'))-126)<=1);
      await send('touchEnd',[]);
      assert.equal(await page.evaluate(()=>PA.Engine.current.id),'r2_fixture_0');
      assert.ok(Math.abs(await page.evaluate(()=>PA.Engine.time())-126)<1);
      assert.equal(await page.evaluate(()=>PA.Engine.el().src),'');assert.equal(audioRequests,0);
      await page.locator('#mini-play').tap();
      try{await page.waitForFunction(()=>PA.Engine.el().readyState>=3&&!PA.Engine.el().paused&&PA.Engine.el().currentTime>=125,null,{timeout:10000});}
      catch(error){const state=await page.evaluate(()=>{const a=PA.Engine.el(),r=document.querySelector('#mini-play').getBoundingClientRect();return {id:PA.Engine.current.id,src:a.src,time:a.currentTime,duration:a.duration,paused:a.paused,ready:a.readyState,error:a.error?.code,requested:PA.Engine._requestedSeek,pending:PA.Engine._pendingSeek?.time,resume:PA.Engine._resumePosition,playing:PA.Engine.playing,loading:PA.Engine._loadingRequest,button:document.querySelector('#mini-play').getAttribute('aria-label'),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[id]')?.id,events:pointerTrace,toast:document.querySelector('#toast')?.textContent};});throw Error('Seek-resume state '+JSON.stringify({audioRequests,...state}),{cause:error});}
      await page.locator('#mini-play').tap();await page.waitForFunction(()=>PA.Engine.el().paused);
    });
    await t.test('all ten layouts keep a bounded DOM, reach the final track, and support keyboard navigation',async()=>{
      for(let id=-4;id<=5;id++){
        await page.evaluate(id=>{const box=document.querySelector('#list-body .zoom-list');PA.ListZoom.set(box,id,box.querySelector('.trow'));document.querySelector('#list-body').scrollTop=0;},id);
        await page.waitForFunction(()=>!!document.querySelector('#list-body .trow[data-i="0"]'));
        const count=await page.locator('#list-body .trow').count();assert.ok(count<220,`layout ${id}: ${count} mounted rows for 5000 songs`);
        await page.evaluate(()=>{const body=document.querySelector('#list-body');body.scrollTop=body.scrollHeight;});
        await page.waitForFunction(()=>!!document.querySelector('#list-body .trow[data-i="4999"]'));
        const last=await page.locator('#list-body .trow[data-i="4999"]').boundingBox();assert.ok(last.y<852&&last.y+last.height>58,`last song reachable in layout ${id}`);
      }
      await page.locator('#list-body .trow[data-i="4999"]').press('Home');
      assert.equal(await page.evaluate(()=>document.activeElement.dataset.i),'0');
      await page.locator('#list-body .trow[data-i="0"]').press('End');
      assert.equal(await page.evaluate(()=>document.activeElement.dataset.i),'4999');
    });
    await t.test('native single-finger scrolling does not select a song and two-finger pinch still changes layout',async()=>{
      await page.evaluate(()=>{const box=document.querySelector('#list-body .zoom-list');PA.ListZoom.set(box,3,box.querySelector('.trow'));document.querySelector('#list-body').scrollTop=0;});
      await nextFrame();await cdp.send('Emulation.setCPUThrottlingRate',{rate:6});
      await send('touchStart',[point(1,160,560)]);
      for(let y=540;y>=220;y-=20){await send('touchMove',[point(1,160,y)]);await nextFrame();}
      await send('touchEnd',[]);
      await page.waitForFunction(()=>document.querySelector('#list-body').scrollTop>150);
      assert.equal(await page.evaluate(()=>PA.Engine.current.id),'r2_fixture_0');
      await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
      await send('touchStart',[point(1,120,330),point(2,220,330)]);
      await send('touchMove',[point(1,95,330),point(2,245,330)]);await nextFrame();await send('touchEnd',[]);
      await page.waitForFunction(()=>document.querySelector('#list-body .zoom-list').dataset.zoom==='4');
      assert.equal(await page.evaluate(()=>PA.Engine.current.id),'r2_fixture_0');
      assert.equal(await page.evaluate(()=>visualViewport.scale),1,'pinch changes the list, not browser zoom');
      await send('touchStart',[point(1,150,480)]);
      await send('touchMove',[point(1,150,410)]);await nextFrame();
      await send('touchStart',[point(1,150,410),point(2,250,410)]);
      await send('touchMove',[point(1,125,410),point(2,275,410)]);await nextFrame();await send('touchEnd',[]);
      await page.waitForFunction(()=>document.querySelector('#list-body .zoom-list').dataset.zoom==='5');
      assert.equal(await page.evaluate(()=>PA.Engine.current.id),'r2_fixture_0','adding a second finger after scrolling does not activate a song');
    });
    await t.test('A–Z and selection operate on the complete list beyond the mounted window',async()=>{
      const z=await page.locator('#alpha span').filter({hasText:/^Z$/}).boundingBox();assert.ok(z);await tap(z.x+z.width/2,z.y+z.height/2);
      await page.waitForFunction(()=>[...document.querySelectorAll('#list-body .trow')].some(r=>r.querySelector('.t1').textContent.startsWith('Z ')));
      await page.evaluate(()=>PA.Selection.enter(null,document.querySelector('#list-body .zoom-list')));
      await page.locator('[data-select="all"]').tap();
      assert.equal(await page.evaluate(()=>PA.Selection.tracks().length),5000);
      await page.evaluate(()=>document.querySelector('#list-body').scrollTop=0);
      await page.waitForFunction(()=>document.querySelector('#list-body .trow[data-i="0"]')?.classList.contains('sel'));
      await page.locator('[data-select="close"]').tap();
    });
    await t.test('rapid navigation keeps the selected paused song and existing controls without global settings work',async()=>{
      await page.evaluate(()=>{const apply=PA.NativeSettings.apply;window.settingsCalls=0;PA.NativeSettings.apply=function(...args){window.settingsCalls++;return apply.apply(this,args);};window.queueButton=document.querySelector('[data-extra-button="queue"]');});
      const title=await page.locator('#mini-title').boundingBox();assert.ok(title);
      await tap(title.x+title.width/2,title.y+title.height/2);await tap(title.x+title.width/2,title.y+title.height/2);
      await page.waitForFunction(()=>PA.Nav.cur==='player');
      assert.equal(await page.evaluate(()=>PA.Engine.current.id),'r2_fixture_0');assert.equal(await page.evaluate(()=>PA.Engine.el().paused),true);
      for(const name of ['library','player','library','player']){
        if(name==='player')await page.locator('#mini-title').tap();else await page.locator('[data-nav="library"]').tap();
      }
      assert.equal(await page.evaluate(()=>settingsCalls),0);
      assert.equal(await page.evaluate(()=>queueButton===document.querySelector('[data-extra-button="queue"]')),true);
      assert.deepEqual(errors,[]);
    });
  }finally{await context?.close();await browser?.close();await new Promise(done=>server.close(done));}
});
