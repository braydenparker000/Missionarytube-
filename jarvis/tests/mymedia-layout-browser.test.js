import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {readFile, stat, mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join, resolve, extname} from 'node:path';
import {chromium} from 'playwright-core';

const chrome = process.env.JARVIS_CHROME;
const root = resolve('public');
const folder = 'folder123456789', channel = 'channel123456789';
const stamp = '2026-10-05T12:00:00Z';
const videoId = n => 'video0000000' + String(n).padStart(3, '0');
const files = Array.from({length:72}, (_, i) => ({id:videoId(i),
  name:'Preview channel - ' + ['Building something remarkable', 'A quiet place to explore', 'Learning a new technique', 'An introduction to rhythm'][i % 4] + ' ' + (i+1) + ' [abcdefghijk].webm',
  mimeType:'video/webm', createdTime:stamp, modifiedTime:stamp,
  videoMediaMetadata:{durationMillis:String((i % 8 + 1) * 120000), width:640, height:360}
}));
const archiveSamples=[
 ['The Backlogs','Can You Beat WUCHANG: FALLEN FEATHERS With Only Magic?','5UjIOB5UgNY'],
 ['The Spiffing Brit','Can I Beat An Impossible Game?','7p3rAN0xQOg'],
 ['kAN Gaming','I Drove Through a Tornado for Science... (Scrap Mechanic Chapter 2)','rBWmZWXAt7k'],
 ['ScrapMan','We Used the CLAY GUN to Play PICTIONARY!','LbV5_lS_RGI'],
 ["Let’s Game It Out",'I Built a Nightmare Factory That Manufactures Only Chaos - Chocolate Factory','DieroEYfD9Y'],
 ['WhyBeAre','WhyBeAre Still Alive','y4bqCk_obbg']
];
const mime = {'.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css'};

test('My Media video-feed layout and preserved browsing/playback flows',
  {skip:!chrome || !existsSync(chrome), timeout:120000}, async t => {
  // A generated, silent 30-second VP8 WebM fixture; no external download or encoder dependency.
  const media = Buffer.from('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', 'base64');
  const policy = JSON.parse(await readFile(join(root, 'staticwebapp.config.json'), 'utf8'));
  const server = createServer(async (req,res) => {
    try {
      let path = resolve(root, '.' + new URL(req.url,'http://local').pathname);
      if (!path.startsWith(root + '/') && path !== root) throw Error('outside public');
      if ((await stat(path)).isDirectory()) path = join(path,'index.html');
      let content = await readFile(path);
      if (extname(path) === '.html') {
        const routePath = '/' + path.slice(root.length + 1);
        const csp = (policy.routes.find(r=>routePath.startsWith(r.route.replace('*','')))?.headers?.['Content-Security-Policy'] || policy.globalHeaders['Content-Security-Policy']).replace(/frame-ancestors[^;]*(;|$)/g,'');
        content = content.toString().replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);
      }
      res.writeHead(200, {'Content-Type':mime[extname(path)] || 'application/octet-stream'});res.end(content);
    } catch { res.writeHead(404);res.end(); }
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try { browser = await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']}); }
  catch (error) { await new Promise(done=>server.close(done));throw error; }

  async function session(width=390, seeded=false, archivePreview=false, dated=false, beforeLoad=null) {
    const activeFiles=archivePreview?files.map((file,i)=>({...file,name:archiveSamples[i%archiveSamples.length][0]+' - '+archiveSamples[i%archiveSamples.length][1]+' ['+archiveSamples[i%archiveSamples.length][2]+'].webm'})):files;
    const context = await browser.newContext({viewport:{width,height:844},isMobile:width<600,hasTouch:width<600});
    if(beforeLoad)await context.addInitScript(beforeLoad);
    if (seeded) await context.addInitScript(({id})=>localStorage.setItem('mymedia.progress.v1',JSON.stringify({[id]:{t:120,d:600,done:false,at:10}})), {id:videoId(1)});
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const json = data => route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if (url.origin === origin) {
        if (url.pathname === '/assets/drive-config.json') return json({apiKey:'AIza'+'x'.repeat(35),videoFolderId:folder});
        return route.continue();
      }
      if (url.hostname === 'www.googleapis.com') {
        if (url.searchParams.get('alt') === 'media') {
          if(url.pathname.endsWith('/metadata0000000'))return json({videos:activeFiles.map((file,i)=>({id:file.id,creator:archivePreview?archiveSamples[i%archiveSamples.length][0]:'Preview channel',...(dated&&i<3?{youtubeUploadDate:['2010-02-03','2024-01-02','2018-05-06'][i]}:{})}))});
          if(url.pathname.endsWith('/subtitle0000000'))return route.fulfill({contentType:'text/vtt',body:'WEBVTT\n\n00:00.000 --> 00:29.000\nPreview caption\n'});
          const range = request.headers().range;
          const match = /bytes=(\d+)-(\d*)/.exec(range || '');
          const start = match ? Number(match[1]) : 0, end = match?.[2] ? Math.min(Number(match[2]),media.length-1) : media.length-1;
          return route.fulfill({status:match?206:200,contentType:'video/webm',body:media.subarray(start,end+1),headers:{'Accept-Ranges':'bytes',...(match?{'Content-Range':`bytes ${start}-${end}/${media.length}`}:{})}});
        }
        if (url.pathname.endsWith('/'+folder)) return json({id:folder,name:archivePreview?'Archive layout preview':'Preview library',mimeType:'application/vnd.google-apps.folder'});
        const q = url.searchParams.get('q') || '';
        if (q.includes(folder)) return json({files:[{id:channel,name:'Preview channel',mimeType:'application/vnd.google-apps.folder'},activeFiles[0],activeFiles[1],...(archivePreview||dated?[{id:'metadata0000000',name:'jarvis-video-metadata.json',mimeType:'application/json',size:'10000'}]:[]),{id:'subtitle0000000',name:activeFiles[0].name.replace(/\.webm$/,'.en.vtt'),mimeType:'text/vtt'}]});
        return json({files:activeFiles.slice(2)});
      }
      if(archivePreview && url.hostname==='i.ytimg.com')return route.continue();
      // Deliberately exercise missing-thumbnail fallback. Screenshots show test data.
      return route.abort();
    });
    const page = await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error' && m.text().includes('Content Security Policy'))errors.push(m.text());});
    await page.goto(origin+'/mymedia/');
    await page.locator('.feed-grid .video-tile').first().waitFor();
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent.startsWith('72 videos'));
    return {context,page,errors};
  }
  async function screenshot(page,name) {
    const directory=process.env.JARVIS_SCREENSHOT_DIR || (process.env.POWERAMP_EVIDENCE_DIR ? join(process.env.POWERAMP_EVIDENCE_DIR,'my-media-layout') : '');
    if (!directory) return;
    await mkdir(directory,{recursive:true});
    await page.screenshot({path:join(directory,name+'.png')});
  }
  async function layout(page) {
    const dimensions = await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));
    assert.ok(dimensions.scroll<=dimensions.width+1,'no document-level horizontal overflow');
  }
  async function waitForBrowseScreen(page,url,title,timeout=5000) {
    await page.waitForURL(url);
    // Native fragment navigation changes the URL before the hashchange route
    // restores the screen. Search/sort assertions need the destination render.
    await page.waitForFunction(title=>!document.querySelector('#library-view').hidden &&
      document.querySelector('#view-title').textContent===title,title,{timeout});
  }
  try {
    for (const [width,columns] of [[360,1],[390,1],[430,1],[768,2],[1200,4]]) {
      await t.test('feed fits '+width+'px with '+columns+' columns',async()=>{
        const {page,context,errors}=await session(width,true);
        assert.equal(await page.locator('#search').isVisible(),true);
        assert.equal(await page.locator('.feed-grid .video-tile').count(),60);
        assert.equal(await page.locator('.feed-grid').evaluate(n=>getComputedStyle(n).gridTemplateColumns.split(' ').length),columns);
        assert.equal(await page.locator('#continue-grid .video-tile').count(),1);
        if(width<600)assert.ok(await page.locator('.feed-grid .thumb').first().evaluate(n=>n.getBoundingClientRect().bottom)<775,'the first complete video thumbnail fits above mobile navigation even with watch progress');
        assert.equal(await page.locator('.feed-grid .card-creator').first().textContent(),'Preview channel');
        assert.ok(!(await page.locator('.feed-grid strong').first().textContent()).startsWith('Preview channel - '));
        assert.equal(await page.locator('body').evaluate(n=>getComputedStyle(n).getPropertyValue('--accent').trim()),'#dce3eb');
        assert.equal(await page.locator('body').evaluate(n=>getComputedStyle(n).fontFamily),'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif');
        await layout(page);await screenshot(page,'my-media-feed-'+width);
        await page.locator('#load-more').click();assert.equal(await page.locator('.feed-grid .video-tile').count(),72);
        assert.equal(await page.locator('#load-more').isVisible(),false);
        assert.deepEqual(errors,[]);await context.close();
      });
    }
    await t.test('search, creator screens, save, queue, folder controls and navigation are retained',async()=>{
      const {page,context,errors}=await session();
      await page.locator('#creator-strip .creator-link').first().click();await page.waitForURL('**/#creator=*');
      await page.waitForFunction(()=>document.querySelector('#creator-title').textContent==='Preview channel');
      assert.equal(await page.locator('#creator-header').isVisible(),true);
      assert.equal(await page.locator('#creator-summary').textContent(),'72 videos in your library');
      assert.equal(await page.locator('#sections .video-tile').count(),60,'channel includes matching root files');
      await page.locator('#search').fill('quiet');assert.equal(await page.locator('#sections .video-tile').count(),18);
      await page.locator('#time-filter').click();await page.getByRole('button',{name:'Under 10 minutes',exact:true}).click();
      assert.equal(await page.locator('#sections .video-tile').count(),9);
      await page.locator('.video-menu').first().click();await page.getByRole('button',{name:'Save for later',exact:true}).click();
      await page.locator('[data-view="saved"]').click();await page.waitForURL('**/#saved');await page.waitForFunction(()=>document.querySelector('#view-title').textContent==='Saved');assert.equal(await page.locator('#sections .video-tile').count(),1);
      await page.locator('#search').fill('');await page.locator('#all-videos').click();
      await page.locator('[data-view="explore"]').click();await page.waitForURL('**/#explore');await page.waitForFunction(()=>document.querySelector('#view-title').textContent==='Explore');
      await page.locator('.video-menu').first().click();await page.getByRole('button',{name:'Add to queue',exact:true}).click();
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mymedia.queue.v1')).length),1);
      await page.locator('[data-view="library"]').click();await page.waitForURL('**/#library');await page.locator('.folder-shelf').first().waitFor();
      assert.equal(await page.locator('.folder-shelf').count(),2);
      await page.locator('#toggle-folders').click();assert.equal(await page.locator('.folder-shelf[open]').count(),2);
      await page.locator('#toggle-folders').click();assert.equal(await page.locator('.folder-shelf[open]').count(),0);
      await page.goBack();await page.waitForURL('**/#explore');await page.locator('.feed-grid').waitFor();assert.equal(await page.locator('.feed-grid .video-tile').count(),60);
      await page.locator('#search').fill('no possible match');assert.equal(await page.getByRole('heading',{name:'No matching videos'}).count(),1);
      await layout(page);assert.deepEqual(errors,[]);await context.close();
    });
    for (const width of [360,390,430,1200]) await t.test('creator directory and per-screen state survive menu playback, Back, Forward and reload at '+width+'px',async()=>{
      const {page,context,errors}=await session(width);
      try {
        await page.locator('[data-view="creators"]').click();await waitForBrowseScreen(page,'**/#creators','Creators');
        assert.equal(await page.locator('.creator-directory .creator-link').count(),1);
        assert.equal(await page.locator('#sort').isVisible(),false);await screenshot(page,'my-media-creators-'+width);
        await page.locator('#search').fill('Preview');
        await page.locator('.creator-directory .creator-link').click();await waitForBrowseScreen(page,'**/#creator=*','Preview channel');
        await page.locator('#sort').selectOption('title');
        await page.locator('#search').fill('quiet');
        assert.equal(await page.locator('#sections .video-tile').count(),18);await screenshot(page,'my-media-creator-'+width);
        await page.locator('.video-menu').first().click();await page.getByRole('button',{name:'Play video',exact:true}).click();
        await page.waitForURL('**/#v=*');await page.locator('#next-list .video-card').first().click();
        await page.locator('#back').click();await waitForBrowseScreen(page,'**/#creator=*','Preview channel');
        assert.equal(await page.locator('#search').inputValue(),'quiet');assert.equal(await page.locator('#sort').inputValue(),'title');
        assert.equal(await page.locator('#sections .video-tile').count(),18);
        await page.locator('#back').click();await waitForBrowseScreen(page,'**/#creators','Creators');
        assert.equal(await page.locator('#search').inputValue(),'Preview');
        await screenshot(page,'my-media-back-'+width);
        await page.goBack();await waitForBrowseScreen(page,'**/#creator=*','Preview channel');assert.equal(await page.locator('#search').inputValue(),'quiet');
        await page.goForward();await waitForBrowseScreen(page,'**/#creators','Creators');
        assert.equal(await page.locator('#search').inputValue(),'Preview');
        assert.equal(await page.locator('.creator-directory .creator-link').count(),1);
        await page.goBack();await waitForBrowseScreen(page,'**/#creator=*','Preview channel');await page.reload();await page.locator('#creator-header').waitFor();
        assert.equal(await page.locator('#search').inputValue(),'quiet');assert.equal(await page.locator('#sort').inputValue(),'title');
        await layout(page);assert.deepEqual(errors,[]);
      } finally { await context.close(); }
    });
    await t.test('browse readiness waits for the destination render after a native Back URL change',async()=>{
      const {page,context,errors}=await session(390,false,false,false,()=>{
        addEventListener('hashchange',event=>{
          if(!window.__holdBrowseChange)return;
          window.__holdBrowseChange=false;
          event.stopImmediatePropagation();
          window.__heldBrowseChange={oldURL:event.oldURL,newURL:event.newURL};
        },{capture:true});
      });
      try {
        await page.locator('[data-view="creators"]').click();await waitForBrowseScreen(page,'**/#creators','Creators');
        await page.locator('#search').fill('Preview');
        await page.locator('.creator-directory .creator-link').click();await waitForBrowseScreen(page,'**/#creator=*','Preview channel');
        await page.locator('#search').fill('quiet');
        // Hold one event's delivery after real fragment navigation. This makes
        // the observed URL-before-render interval deterministic without changing
        // the app's route or history operations.
        await page.evaluate(()=>{window.__holdBrowseChange=true;});
        await page.locator('#back').click();await page.waitForURL('**/#creators');
        await page.waitForFunction(()=>!!window.__heldBrowseChange);
        assert.equal(await page.locator('#view-title').textContent(),'Preview channel');
        assert.equal(await page.locator('#search').inputValue(),'quiet');
        await assert.rejects(waitForBrowseScreen(page,'**/#creators','Creators',150),
          error=>error.name==='TimeoutError' && error.message.includes('waitForFunction'));
        await page.evaluate(()=>{
          const change=window.__heldBrowseChange;delete window.__heldBrowseChange;
          dispatchEvent(new HashChangeEvent('hashchange',change));
        });
        await waitForBrowseScreen(page,'**/#creators','Creators');
        assert.equal(await page.locator('#search').inputValue(),'Preview');
        assert.equal(await page.locator('.creator-directory .creator-link').count(),1);
        assert.deepEqual(errors,[]);
      } finally { await context.close(); }
    });
    await t.test('original YouTube dates sort separately from archive additions; undated videos stay last',async()=>{
      const {page,context,errors}=await session(390,false,false,true);
      await page.locator('#sort').selectOption('youtube-newest');
      assert.equal(await page.locator('#sections .video-card').first().getAttribute('href'),'#v='+videoId(1));
      assert.match(await page.locator('#sort-note').textContent(),/69 videos have no YouTube date/);
      await page.locator('#sort').selectOption('youtube-oldest');
      assert.equal(await page.locator('#sections .video-card').first().getAttribute('href'),'#v='+videoId(0));
      await page.locator('#load-more').click();assert.equal(await page.locator('#sections .video-tile').count(),72);
      assert.equal(await page.locator('#sections .card-status').last().textContent(),'YouTube date unknown');
      await page.locator('#sort').selectOption('newest');
      assert.equal(await page.locator('#sort-note').isVisible(),false);
      await layout(page);assert.deepEqual(errors,[]);await context.close();
    });
    for (const width of [390,1200]) await t.test('watch layout, native playback, progress and back at '+width+'px',async()=>{
      const {page,context,errors}=await session(width);
      const first=page.locator('.feed-grid .video-card').first();
      const href=await first.getAttribute('href');await first.click();await page.waitForURL('**/#v=*');
      await page.waitForFunction(()=>document.querySelector('#video').readyState>=2);
      assert.equal(await page.locator('#video-creator').textContent(),'Preview channel');
      assert.equal(await page.locator('#video-details').isVisible(),false,'no fabricated description');
      assert.ok(await page.locator('#next-list .video-tile').count());
      const positions=await page.evaluate(()=>{const box=id=>document.getElementById(id).getBoundingClientRect();return {video:box('video').bottom,title:box('video-title').top,next:box('next-list').top,mainRight:document.querySelector('.watch-main').getBoundingClientRect().right,nextLeft:document.querySelector('.watch-next').getBoundingClientRect().left};});
      assert.ok(positions.title>=positions.video,'title is below the player');
      if(width<900)assert.ok(positions.next>positions.title,'more videos follows details on a phone');else assert.ok(positions.nextLeft>positions.mainRight,'more videos occupies the desktop side rail');
      await page.locator('#video').evaluate(n=>{n.pause();n.currentTime=15;});
      await page.locator('#back-10').click();assert.ok(Math.abs(await page.locator('#video').evaluate(n=>n.currentTime)-5)<.5);
      await page.locator('#forward-10').click();assert.ok(Math.abs(await page.locator('#video').evaluate(n=>n.currentTime)-15)<.5);
      await page.waitForFunction(()=>document.querySelector('#video track'));
      await page.locator('#captions').selectOption('0');
      await page.waitForFunction(()=>document.querySelector('#video').textTracks[0]?.mode==='showing');
      await page.locator('#speed').selectOption('1.5');assert.equal(await page.locator('#video').evaluate(n=>n.playbackRate),1.5);
      await layout(page);await screenshot(page,'my-media-watch-'+width);
      await page.locator('#back').click();await page.waitForFunction(()=>!document.querySelector('#library-view').hidden);
      assert.equal(await page.locator('#continue-grid .video-tile').count(),1);
      await page.goto(origin+'/mymedia/'+href);await page.waitForFunction(()=>document.querySelector('#video').readyState>=2 && document.querySelector('#video').currentTime>10);
      assert.equal(await page.locator('#speed').inputValue(),'1.5');
      await page.locator('#watched').click();assert.equal(await page.locator('#watched').getAttribute('aria-pressed'),'true');
      await page.locator('#save-video').click();assert.equal(await page.locator('#save-video').textContent(),'Saved');
      await page.locator('#back').click();await page.waitForFunction(()=>!document.querySelector('#library-view').hidden);
      await page.locator('.feed-grid .video-card').first().click();
      await page.locator('#next-list .video-card').first().click();await page.waitForFunction(()=>document.querySelector('#video-title').textContent.includes('2'));
      await page.locator('#back').click();await page.waitForFunction(()=>!document.querySelector('#library-view').hidden);
      await page.goto(origin+'/mymedia/#v=missing000000000');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('no longer'));
      assert.equal(await page.locator('#library-view').isVisible(),true);assert.deepEqual(errors,[]);await context.close();
    });
    await t.test('real archive covers in phone, tablet, desktop and watch previews', {skip:process.env.JARVIS_LIVE_THUMBNAILS==='0'?'Live thumbnail access explicitly disabled; fixture playback and fallback layouts are covered above':false},async()=>{
      for(const width of [360,390,430,768,1200]){
        const {page,context,errors}=await session(width,true,true);
        await page.waitForFunction(()=>{const images=[...document.querySelectorAll('.feed-grid .thumb img')];return images.length>=4 && images.slice(0,4).every(img=>img.complete && img.naturalWidth>0);},null,{timeout:30000});
        await screenshot(page,'my-media-feed-'+width);
        if(width===390 || width===1200){
          await page.locator('.feed-grid .video-card').first().click();
          await page.waitForFunction(()=>document.querySelector('#video').readyState>=2);
          await page.locator('#video').evaluate(n=>n.pause());
          await page.waitForFunction(()=>document.querySelector('#next-list .thumb img')?.naturalWidth>0,null,{timeout:30000});
          await screenshot(page,'my-media-watch-'+width);
        }
        await layout(page);assert.deepEqual(errors,[]);await context.close();
      }
    });
  } finally {
    await browser.close();await new Promise(done=>server.close(done));
  }
});
