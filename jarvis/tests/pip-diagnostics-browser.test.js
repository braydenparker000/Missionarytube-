import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile, stat, mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join, resolve, extname} from 'node:path';
import {chromium} from 'playwright-core';

const chrome=process.env.JARVIS_CHROME,root=resolve('public');
test('My Media PiP evidence preserves playback and has a selectable copy-denied report',
  {skip:!chrome||!existsSync(chrome),timeout:60000},async()=>{
  // Reuse the repository's generated silent VP8 fixture. No external media or account is used.
  const fixtureSource=await readFile(new URL('mymedia-layout-browser.test.js',import.meta.url),'utf8');
  const encoded=/const media = Buffer\.from\('([^']+)', 'base64'\)/.exec(fixtureSource)?.[1];
  assert.ok(encoded,'local video fixture is present'); const media=Buffer.from(encoded,'base64');
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
  const server=createServer(async(req,res)=>{try{
    let path=resolve(root,'.'+new URL(req.url,'http://local').pathname);
    if(!path.startsWith(root+'/')&&path!==root)throw Error('outside public');
    if((await stat(path)).isDirectory())path=join(path,'index.html');
    res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream'});res.end(await readFile(path));
  }catch{res.writeHead(404);res.end();}});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try {
    browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url()),json=value=>route.fulfill({contentType:'application/json',body:JSON.stringify(value)});
      if(url.origin===origin){
        if(url.pathname==='/assets/drive-config.json')return json({apiKey:'AIza'+'x'.repeat(35),videoFolderId:'folder123456789'});
        return route.continue();
      }
      if(url.hostname==='www.googleapis.com'){
        if(url.searchParams.get('alt')==='media')return route.fulfill({contentType:'video/webm',body:media,headers:{'Accept-Ranges':'bytes'}});
        if(url.pathname.endsWith('/folder123456789'))return json({id:'folder123456789',name:'Test library',mimeType:'application/vnd.google-apps.folder'});
        return json({files:[{id:'video1234567890',name:'private-title-sentinel.webm',mimeType:'video/webm',modifiedTime:'2026-10-06T00:00:00Z',videoMediaMetadata:{durationMillis:'30000',width:320,height:180}}]});
      }
      return route.abort();
    });
    await page.goto(origin+'/mymedia/');await page.locator('.video-card').first().click();
    await page.waitForFunction(()=>document.querySelector('#video').readyState>=2&&!document.querySelector('#video').paused);
    const hash=await page.evaluate(()=>location.hash);
    // Synthetic lifecycle ordering exercises page callbacks; it does not emulate Android's task manager.
    await page.evaluate(()=>{
      const video=document.querySelector('#video');
      Object.defineProperty(document,'pictureInPictureElement',{configurable:true,value:video});video.dispatchEvent(new Event('enterpictureinpicture'));
      Object.defineProperty(document,'visibilityState',{configurable:true,value:'hidden'});document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document,'visibilityState',{configurable:true,value:'visible'});document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));
      Object.defineProperty(document,'pictureInPictureElement',{configurable:true,value:null});video.dispatchEvent(new Event('leavepictureinpicture'));
    });
    assert.equal(await page.locator('#video').evaluate(video=>video.paused),false,'visible native exit does not introduce a pause');
    assert.equal(await page.evaluate(()=>location.hash),hash,'no exit navigation');
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:()=>Promise.reject(Error('denied'))}}));
    await page.locator('#pip-report').click();
    const output=page.getByRole('textbox',{name:'Picture-in-picture report'}),report=JSON.parse(await output.inputValue());
    assert.equal(report.app,'mymedia');assert.equal(report.release,'0.38.0');assert.equal(report.lastExit.visibility,'visible');
    assert.equal(report.nativeExitReason,'unavailable');
    assert.ok(!JSON.stringify(report).includes('private-title-sentinel')&&!JSON.stringify(report).includes('AIza'));
    assert.equal(await output.getAttribute('readonly'),'');
    await page.getByRole('button',{name:'Copy PiP report',exact:true}).click();
    await page.getByRole('button',{name:'Copy blocked. Select the report above.',exact:true}).waitFor();
    assert.equal(await output.isVisible(),true);
    const bounds=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(bounds.scroll<=bounds.width+1,'report does not create horizontal overflow');
    const evidence=process.env.JARVIS_SCREENSHOT_DIR || (process.env.POWERAMP_EVIDENCE_DIR ? join(process.env.POWERAMP_EVIDENCE_DIR,'pip') : '');
    if(evidence){await mkdir(evidence,{recursive:true});await page.screenshot({path:join(evidence,'pip-report-copy-denied.png')});}
    await page.getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('#video').evaluate(video=>video.pause());
    await page.evaluate(()=>document.querySelector('#video').dispatchEvent(new Event('leavepictureinpicture')));
    assert.equal(await page.locator('#video').evaluate(video=>video.paused),true,'observer never automatically resumes native-paused playback');
    assert.deepEqual(errors,[]);await context.close();
  }finally{await browser?.close();await new Promise(done=>server.close(done));}
});
