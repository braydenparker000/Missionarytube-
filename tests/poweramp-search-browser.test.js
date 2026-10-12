import {instrumentFixtureBoot} from './helpers/poweramp-fixture.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';

const root=fileURLToPath(new URL('../public/',import.meta.url));
const executablePath=[process.env.JARVIS_CHROME,'/usr/bin/chromium','/usr/bin/chromium-browser',chromium.executablePath()].find(p=>p&&existsSync(p));
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
function wav(){const rate=8000,length=rate*20*2,b=Buffer.alloc(44+length);b.write('RIFF');b.writeUInt32LE(36+length,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(length,40);return b;}

test('production Poweramp boot and Search routing/options/playback with bounded large results',{timeout:90000},async()=>{
  assert.ok(executablePath,'Chromium is required for production browser QA');
  const audio=wav(),server=createServer(async(req,res)=>{
    try{
      const pathname=new URL(req.url,'http://localhost').pathname;
      if(pathname==='/fixture.wav'){res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':audio.length});return res.end(audio);}
      let path=resolve(root,'.'+decodeURIComponent(pathname));if(!path.startsWith(root.endsWith(sep)?root:root+sep))throw Error('Invalid path');
      if((await stat(path)).isDirectory())path=join(path,'index.html');res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});const bytes=await readFile(path);res.end(path.endsWith('/drawercast/player.js')?instrumentFixtureBoot(bytes.toString()):bytes);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  const origin='http://127.0.0.1:'+server.address().port;let browser;
  try{
    browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());if(url.origin!==origin)return route.abort('blockedbyclient');
      if(url.pathname==='/assets/r2-config.json')return route.fulfill({contentType:'application/json',body:JSON.stringify({manifestURL:'fixture-disabled',rootId:''})});return route.continue();
    });
    await context.addInitScript(()=>localStorage.setItem('drawercast.sources.v1',JSON.stringify({local:false,drive:false,r2:false,server:false})));
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/drawercast/');
    await page.waitForFunction(()=>window.PA?.R2Source.manifestURL==='fixture-disabled');await page.evaluate(()=>window.__powerampBootPromise);
    await page.evaluate(async origin=>{
      const {LIB,SourceLibrary,SET,NativeSettings,Views,R2Source,UI}=PA;SourceLibrary.flags.r2=true;SET.listZoom={search:3};SET.animations='normal';NativeSettings.values.search_track_titles_only=false;
      const tracks=Array.from({length:5000},(_,i)=>({id:'r2_search_'+i,source:'r2',remote:true,remoteId:'search_'+i,title:'The Song '+i,artist:'The Artist',album:'The Album '+i%200,albumArtist:'The Album Artist',composer:'The Composer',genre:'The Genre',year:2026,folder:'The Folder',path:'The Folder/'+i+'.wav',ext:'wav',dur:20,size:320044,added:i}));
      LIB.ids=tracks.map(t=>t.id);LIB.map=new Map(tracks.map(t=>[t.id,t]));R2Source.fileFor=()=>({__remoteURL:origin+'/fixture.wav',name:'fixture.wav',size:320044,type:'audio/wav'});
      PA.Playlists.data=[{id:'search-playlist',name:'The Playlist',ids:[tracks[0].id,tracks[1].id]}];Views.renderLibrary();UI.refreshEmpty();
    },origin);
    await page.locator('[data-nav="search"]').click();await page.waitForFunction(()=>PA.Nav.cur==='search'&&!document.querySelector('#sc-search').hidden);
    await page.locator('#q').fill('The');await page.waitForFunction(()=>PA.Search.sections.length===8);
    assert.equal(await page.locator('#q-chips .chip').count(),11);
    const sizes=await page.evaluate(()=>({songs:PA.Search.sections.find(s=>s.category.kind==='all').box.__items.length,songRows:PA.Search.sections.find(s=>s.category.kind==='all').box.querySelectorAll('.trow').length,groups:PA.Search.sections[0].box.__groups.length,groupRows:PA.Search.sections[0].box.querySelectorAll('.trow').length}));
    assert.equal(sizes.songs,5000);assert.ok(sizes.songRows<120,'complete track results must remain windowed');assert.equal(sizes.groups,200);assert.equal(sizes.groupRows,60);
    await page.locator('.search-group-list [data-search-next]').first().click();assert.equal(await page.locator('.search-group-list .trow').first().getAttribute('data-g'),'60');
    await page.locator('.search-group-list .trow').first().click();await page.waitForFunction(()=>PA.Nav.cur==='list');assert.equal(await page.evaluate(()=>PA.Views.currentSpec.kind),'album');
    await page.locator('[data-nav="search"]').click();await page.waitForFunction(()=>PA.Nav.cur==='search');
    await page.locator('#q-select').click();assert.equal(await page.evaluate(()=>PA.Selection.box.__items.length),5000);await page.locator('[data-select="close"]').click();
    await page.locator('#q-more').click();assert.equal(await page.locator('.list-options-head h3').textContent(),'List Options: Search');assert.equal(await page.locator('[data-search-category]').count(),10);
    await page.locator('[data-search-category="albums"]').uncheck();assert.equal(await page.locator('#q-chips [data-c="Albums"]').count(),0);assert.equal(await page.evaluate(()=>PA.Search.sections.some(s=>s.category.kind==='albums')),false);
    const fixed=await page.locator('.list-options-head').boundingBox();await page.locator('.list-options-body').evaluate(n=>{n.scrollTop=n.scrollHeight;});const after=await page.locator('.list-options-head').boundingBox();assert.ok(Math.abs(fixed.y-after.y)<1,'options title must remain fixed while the body scrolls');
    await page.locator('[data-search-titles]').check();await page.locator('input[name="search-view"][value="3"]').check();assert.equal(await page.evaluate(()=>PA.SET.listOptions.search.titlesOnly),true);assert.ok(await page.evaluate(()=>[...document.querySelectorAll('#q-body .zoom-list')].every(n=>n.dataset.zoom==='3'&&n.classList.contains('titles-only'))));
    await page.locator('[data-search-settings]').click();await page.waitForFunction(()=>PA.Nav.cur==='settings'&&PA.Settings.stack.at(-1)==='library_search');
    await page.locator('[data-pref="list_opts"]').click();await page.waitForFunction(()=>PA.Nav.cur==='search');assert.equal(await page.locator('.list-options-head h3').textContent(),'List Options: Search');
    await page.locator('[data-search-close]').click();await page.locator('#q-play').click();await page.waitForFunction(()=>PA.Nav.cur==='player'&&PA.Engine.queue.length===5000);
    await page.locator('[data-nav="search"]').click();await page.waitForFunction(()=>PA.Nav.cur==='search');await page.locator('#q-chips [data-c="Streams"]').click();assert.match(await page.locator('#q-body').textContent(),/Streams are unavailable/);assert.equal(await page.locator('#q-play').isDisabled(),true);
    await page.locator('#q-clear').click();assert.equal(await page.locator('#q').inputValue(),'');assert.equal(await page.locator('#q-play').isDisabled(),true);
    assert.deepEqual(errors,[],'actual production boot and routing must be free of page errors');
    if(process.env.PA_REVIEW_DIR){await mkdir(process.env.PA_REVIEW_DIR,{recursive:true});await page.screenshot({path:join(process.env.PA_REVIEW_DIR,'poweramp-search-production.png')});}
  }finally{await browser?.close();await new Promise(done=>server.close(done));}
});
