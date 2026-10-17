import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat, mkdir, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join, resolve, extname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {requireBrowser} from './helpers/ci-test-inventory.mjs';

const root = resolve('public');
const baseline = '8c4f6de790b3e06cd78b11706dfa2c055174bbf1';
const folder = 'folder123456789', channel = 'channel123456789';
const videoId = n => 'video0000000' + String(n).padStart(3, '0');
const stamp = '2026-10-05T12:00:00Z';
const files = Array.from({length:72}, (_, i) => ({
  id:videoId(i), name:'Preview Studio - Building a folding workbench — Guide ' + String(i).padStart(2, '0') + ' [abcdefghijk].webm',
  mimeType:'video/webm', createdTime:stamp, modifiedTime:stamp,
  videoMediaMetadata:{durationMillis:'600000',width:640,height:360}
}));
const mime = {'.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css'};
const art = '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#fff"/><path d="M0 260 200 60 420 260Z" fill="#61798c"/><path d="M160 360 430 90 640 360Z" fill="#bd8e50"/><text x="24" y="326" fill="#101112" font-family="sans-serif" font-size="26">Fictional layout fixture</text></svg>';

test('My Media rendered refinement: geometry, access, focus, compact viewport and evidence',
  {timeout:180000}, async t => {
  const chrome = requireBrowser();
  // Reuse the existing generated silent 30-second WebM fixture, without downloads.
  const media = Buffer.from('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', 'base64');
  const policy = JSON.parse(await readFile(join(root, 'staticwebapp.config.json'), 'utf8'));
  function withPolicy(content, path) {
    if (extname(path) !== '.html') return content;
    const routePath = '/' + path.slice(root.length + 1);
    const csp = (policy.routes.find(r=>routePath.startsWith(r.route.replace('*','')))?.headers?.['Content-Security-Policy'] || policy.globalHeaders['Content-Security-Policy']).replace(/frame-ancestors[^;]*(;|$)/g,'');
    return content.toString().replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="' + csp + '">');
  }
  const server = createServer(async (req,res) => {
    try {
      let path = resolve(root, '.' + new URL(req.url, 'http://local').pathname);
      if (!path.startsWith(root + '/') && path !== root) throw Error('outside public');
      if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
      res.writeHead(200, {'Content-Type':mime[extname(path)] || 'application/octet-stream'});
      res.end(withPolicy(await readFile(path), path));
    } catch { res.writeHead(404);res.end(); }
  });
  await new Promise(done=>server.listen(0, '127.0.0.1', done));
  t.after(()=>new Promise(done=>server.close(done)));
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({executablePath:chrome, headless:true, args:['--no-sandbox']});
  t.after(()=>browser.close());
  const oldFiles = new Map(['app.js','index.html','mymedia.css','presentation.js'].map(name=>[
    '/mymedia/' + name, execFileSync('git', ['show', baseline + ':public/mymedia/' + name])
  ]));
  const directory = process.env.JARVIS_SCREENSHOT_DIR ? join(process.env.JARVIS_SCREENSHOT_DIR, 'mymedia-refinement') : '';
  if (process.env.CI) assert.ok(directory, 'hosted qualification must preserve rendered screenshots');
  const report = {baseline, candidate:execFileSync('git', ['rev-parse','HEAD'], {encoding:'utf8'}).trim(),
    fixture:'72 fictional videos, synthetic bright artwork, local silent video; no live owner acceptance',
    viewportNote:'Short viewport and a synthetic visualViewport resize are tested, not a physical OS keyboard.',
    screenshots:[], measurements:[]};
  async function screenshot(page, name) {
    if (!directory) return;
    await mkdir(directory,{recursive:true});
    await page.screenshot({path:join(directory, name + '.png')});
    report.screenshots.push(name + '.png');
    await writeFile(join(directory, 'evidence.json'), JSON.stringify(report, null, 2));
  }
  async function session(width=390, height=844, before=false, reducedMotion='no-preference') {
    const context = await browser.newContext({viewport:{width,height},isMobile:width<600,hasTouch:width<600,reducedMotion});
    t.after(()=>context.close());
    await context.addInitScript(({id})=>localStorage.setItem('mymedia.progress.v1', JSON.stringify({[id]:{t:120,d:600,done:false,at:10}})),{id:videoId(1)});
    await context.route('**/*',async route=>{
      const request=route.request(), url=new URL(request.url());
      const json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
      if(url.origin===origin) {
        if(url.pathname==='/assets/drive-config.json')return json({apiKey:'AIza'+'x'.repeat(35),videoFolderId:folder});
        const oldPath=url.pathname==='/mymedia/'?'/mymedia/index.html':url.pathname;
        if(before && oldFiles.has(oldPath))return route.fulfill({contentType:mime[extname(oldPath)],body:withPolicy(oldFiles.get(oldPath),join(root,oldPath))});
        return route.continue();
      }
      if(url.hostname==='www.googleapis.com') {
        if(url.searchParams.get('alt')==='media') {
          if(url.pathname.endsWith('/metadata0000000'))return json({videos:files.map(file=>({id:file.id,creator:'Preview Studio',description:'Fictional video used only for layout qualification.'}))});
          const range=/bytes=(\d+)-(\d*)/.exec(request.headers().range||'');
          const start=range?Number(range[1]):0, end=range?.[2]?Math.min(Number(range[2]),media.length-1):media.length-1;
          return route.fulfill({status:range?206:200,contentType:'video/webm',body:media.subarray(start,end+1),headers:{'Accept-Ranges':'bytes',...(range?{'Content-Range':'bytes '+start+'-'+end+'/'+media.length}:{})}});
        }
        if(url.pathname.endsWith('/'+folder))return json({id:folder,name:'Preview library',mimeType:'application/vnd.google-apps.folder'});
        const q=url.searchParams.get('q')||'';
        return json({files:q.includes(folder)?[{id:channel,name:'Preview Studio',mimeType:'application/vnd.google-apps.folder'},files[0],files[1],{id:'metadata0000000',name:'jarvis-video-metadata.json',mimeType:'application/json',size:'10000'}]:files.slice(2)});
      }
      if(url.hostname==='i.ytimg.com')return route.fulfill({contentType:'image/svg+xml',body:art});
      return route.abort();
    });
    const page=await context.newPage(), errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    page.on('console',m=>{if(m.type()==='error' && m.text().includes('Content Security Policy'))errors.push(m.text());});
    await page.goto(origin+'/mymedia/');
    await page.waitForFunction(()=>document.querySelector('#status')?.textContent.startsWith('72 videos'));
    assert.equal(await page.locator('#sections .video-tile').count(),60, 'fixture loaded all 72 videos with 60 rendered');
    assert.equal(await page.locator('.browse-count').count(),0,'ordinary Explore keeps counts in its freshness status');
    assert.equal(await page.locator('#sections .video-tile').count(),60);
    return {page,context,errors};
  }
  async function noOverflow(page) {
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no document horizontal overflow');
  }
  async function target(page,selector) {
    const node=page.locator(selector).first();
    await node.scrollIntoViewIfNeeded();
    const result=await node.evaluate(n=>{
      const r=n.getBoundingClientRect();
      return {selector:n.id||n.className,width:r.width,height:r.height,
        hit:[.15,.5,.85].every(x=>n.contains(document.elementFromPoint(r.left+r.width*x,r.top+r.height/2)))};
    });
    assert.ok(result.width>=44 && result.height>=44, selector+' has a 44px target in both dimensions: '+JSON.stringify(result));
    assert.equal(result.hit,true,selector+' is not covered at left, center or right');
    report.measurements.push(result);
  }
  async function contrast(page, selector, minimum=4.5, backgroundSelector=null) {
    const result=await page.locator(selector).first().evaluate((node,{backgroundSelector})=>{
      const parse=value=>{const v=value.match(/[\d.]+/g).map(Number);return [v[0],v[1],v[2],v.length>3?v[3]:1];};
      const over=(a,b)=>{const alpha=a[3]+b[3]*(1-a[3]);return [0,1,2].map(i=>(a[i]*a[3]+b[i]*b[3]*(1-a[3]))/alpha).concat(alpha);};
      function background(n) {
        const chain=[];for(let p=n;p;p=p.parentElement)chain.push(p);
        return chain.reverse().reduce((color,p)=>over(parse(getComputedStyle(p).backgroundColor),color),[255,255,255,1]);
      }
      const fg=parse(getComputedStyle(node)[backgroundSelector?'backgroundColor':'color']);
      const bg=background(backgroundSelector?document.querySelector(backgroundSelector):node);
      const luminance=color=>color.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
      const a=luminance(over(fg,bg)),b=luminance(bg);
      return {foreground:fg,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
    },{backgroundSelector});
    assert.ok(result.ratio>=minimum, selector+' contrast >= '+minimum+': '+JSON.stringify(result));
    report.measurements.push({selector,...result});
  }
  async function menuKeyboard(page) {
    const menu=page.locator('#sections .video-menu').first();
    await menu.focus();await page.keyboard.press('Enter');
    await page.locator('dialog[open]').waitFor();
    await page.locator('#search').evaluate(n=>n.focus());
    assert.equal(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),true,'native modal makes background search unfocusable');
    for(let i=0;i<10;i++) {
      await page.keyboard.press('Tab');
      const focus=await page.evaluate(()=>({inDialog:document.querySelector('dialog').contains(document.activeElement),tag:document.activeElement.tagName,id:document.activeElement.id,label:document.activeElement.getAttribute('aria-label'),text:document.activeElement.tagName==='BODY'?'':document.activeElement.textContent,documentFocused:document.hasFocus()}));
      report.measurements.push({tab:i+1,...focus});
      // Native modal traversal may enter browser chrome, where BODY is the
      // active-element fallback and the document itself has lost focus.
      // A focused background page control must never satisfy this assertion.
      const browserChrome=focus.tag==='BODY' && !focus.documentFocused;
      if(browserChrome)await screenshot(page,'native-menu-browser-chrome');
      assert.ok(focus.inDialog || browserChrome,'no background page focus after Tab '+(i+1)+': '+JSON.stringify(focus));
    }
    assert.equal(await page.evaluate(()=>document.hasFocus() && document.querySelector('dialog').contains(document.activeElement)),true,'Tab traversal returns from browser chrome to the modal');
    await screenshot(page,'candidate-keyboard-menu');
    await page.keyboard.press('Escape');
    await page.waitForFunction(()=>!document.querySelector('dialog'));
    assert.equal(await menu.evaluate(n=>document.activeElement===n),true,'Escape restores original menu focus');
  }

  for(const width of [320,360,390,430,1200])await t.test('before/after feed, sticky controls and positive search at '+width+'px',async()=>{
    const old=await session(width,844,true);
    await screenshot(old.page,'baseline-feed-'+width);
    await old.page.evaluate(()=>scrollTo(0,1800));await screenshot(old.page,'baseline-scroll-'+width);
    await old.page.locator('#continue-grid').scrollIntoViewIfNeeded();await screenshot(old.page,'baseline-continue-'+width);
    if(width===1200) {
      await old.page.locator('#sections .video-card').first().click();
      await old.page.waitForFunction(()=>document.querySelector('#video').readyState>=1);
      await screenshot(old.page,'baseline-player-desktop');
    }
    await old.context.close();

    const {page,context,errors}=await session(width);
    await noOverflow(page);await screenshot(page,'candidate-feed-'+width);
    assert.equal(await page.locator('.feed-grid strong').first().evaluate(n=>getComputedStyle(n).fontSize),'16px');
    for(const selector of ['#search','#sort','#all-videos','#time-filter','#unwatched-filter','#sections .video-menu','#sections a.card-creator','.media-nav a'])await target(page,selector);
    for(const selector of ['.feed-grid strong','.feed-grid .card-creator','#status','#time-filter','.media-nav a:not([aria-current])'])await contrast(page,selector);
    await contrast(page,'.feed-grid .bar > span',3,'.feed-grid .bar');
    const bar=await page.locator('.feed-grid .bar').evaluate(n=>({aria:n.getAttribute('aria-valuenow'),ratio:n.firstElementChild.getBoundingClientRect().width/n.getBoundingClientRect().width}));
    assert.equal(bar.aria,'20');assert.ok(Math.abs(bar.ratio-.2)<.01,'paint width agrees with accessible progress');
    await page.evaluate(()=>scrollTo(0,1800));
    await page.waitForFunction(()=>Math.abs(document.querySelector('#library-toolbar').getBoundingClientRect().top-document.querySelector('.topbar').getBoundingClientRect().bottom)<2);
    await screenshot(page,'candidate-scroll-'+width);
    await target(page,'#search');
    await page.locator('#search').fill('Guide 05');
    await page.waitForFunction(()=>document.querySelector('#sections > .video-grid')?.children.length===1);
    assert.equal(await page.locator('#sections .video-tile').count(),1,'search must find a positive result in the focused grid');
    assert.match(await page.locator('#sections .video-card strong').textContent(),/Guide 05$/);
    assert.equal(await page.locator('.browse-count').textContent(),'1 video');
    await page.locator('#sections .video-card').focus();
    assert.equal(await page.locator('#sections .video-card').evaluate(n=>{const r=n.getBoundingClientRect(),header=document.querySelector('#library-toolbar').getBoundingClientRect();return r.top>=header.bottom && r.bottom<=document.querySelector('.media-nav').getBoundingClientRect().top;}),true,'focused result is clear of fixed controls');
    await screenshot(page,'candidate-search-'+width);
    await page.locator('#all-videos').click();
    assert.equal(await page.locator('.browse-count').count(),0,'ordinary Explore keeps counts in its freshness status');
    assert.equal(await page.locator('#sections .video-tile').count(),60);
    await page.locator('#load-more').click();
    assert.equal(await page.locator('.browse-count').count(),0,'Show more does not turn Explore into a focused count view');
    assert.equal(await page.locator('#sections .video-tile').count(),72);
    await target(page,'#continue-grid a.card-creator');
    await target(page,'#continue-grid .video-menu');
    await screenshot(page,'candidate-continue-'+width);
    assert.deepEqual(errors,[]);await noOverflow(page);await context.close();
  });

  await t.test('keyboard, menu capabilities, native playback and desktop recommendations',async()=>{
    const {page,context,errors}=await session(1200);
    await page.locator('#search').focus();await page.keyboard.press('Tab');
    assert.equal(await page.locator('#sort').evaluate(n=>document.activeElement===n && getComputedStyle(n).outlineStyle==='solid' && getComputedStyle(n).outlineWidth==='2px'),true,'sort has explicit visible keyboard focus');
    await page.keyboard.press('Tab');
    assert.equal(await page.locator('#all-videos').evaluate(n=>{const r=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect();return document.activeElement===n && r.top-p.top>=5 && r.left-p.left>=5;}),true,'first filter focus ring fits the scrollport');
    await menuKeyboard(page);
    await page.locator('#sections .video-menu').first().click();await page.getByRole('button',{name:'Save for later',exact:true}).click();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mymedia.saved.v1')).length),1);
    await page.locator('#sections .video-menu').first().click();await page.getByRole('button',{name:'Add to queue',exact:true}).click();
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('mymedia.queue.v1')).length),1);
    await page.locator('#sections .video-menu').first().click();await page.getByRole('button',{name:'Mark watched',exact:true}).click();
    assert.equal(await page.locator('#sections .watched-mark').count(),1);
    await page.locator('#sections .video-menu').first().click();await page.getByRole('button',{name:'Play video',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#video').readyState>=1);
    assert.equal(await page.locator('#video').evaluate(n=>n.controls),true,'native controls remain enabled');
    for(const selector of ['#video-creator','#back-10','#forward-10','#speed','#save-video','#queue-video','#watched','#next-list a.card-creator','#next-list .video-menu'])await target(page,selector);
    await screenshot(page,'candidate-player-desktop');
    await page.locator('#video').evaluate(n=>n.play());
    await page.waitForFunction(()=>document.querySelector('#video').currentTime>.1);
    await page.locator('#video').evaluate(n=>n.pause());
    await page.locator('#back').click();
    await page.waitForFunction(()=>!document.querySelector('#library-view').hidden);
    assert.equal(await page.locator('.browse-count').count(),0,'ordinary Explore keeps counts in its freshness status');
    assert.equal(await page.locator('#sections .video-tile').count(),60);
    assert.deepEqual(errors,[]);await noOverflow(page);await context.close();
  });

  await t.test('short viewports recover browsing room and search remains reachable',async()=>{
    for(const [width,height] of [[320,480],[390,360]]) {
      const {page,context,errors}=await session(width,height);
      assert.equal(await page.locator('#library-toolbar').evaluate(n=>getComputedStyle(n).position),'static');
      await page.evaluate(()=>scrollTo(0,1400));
      assert.ok(await page.locator('#library-toolbar').evaluate(n=>n.getBoundingClientRect().bottom)<0,'short viewport scrolls the toolbar away');
      await page.locator('#search-toggle').click();
      assert.equal(await page.locator('#search').evaluate(n=>{const r=n.getBoundingClientRect();return document.activeElement===n && r.top>=document.querySelector('.topbar').getBoundingClientRect().bottom && r.bottom<=document.querySelector('.media-nav').getBoundingClientRect().top;}),true,'header action restores visible focused search');
      await page.locator('#search').fill('Guide 05');
      assert.equal(await page.locator('#sections .video-tile').count(),1);
      await screenshot(page,'candidate-compact-'+width+'x'+height);
      await noOverflow(page);assert.deepEqual(errors,[]);await context.close();
    }
    const {page,context}=await session();
    await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,get:()=>420});visualViewport.dispatchEvent(new Event('resize'));});
    assert.equal(await page.locator('#library-toolbar').evaluate(n=>getComputedStyle(n).position),'static','visual-only viewport shrink also releases toolbar');
    await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
    assert.equal(await page.locator('#library-toolbar').evaluate(n=>getComputedStyle(n).position),'sticky','toolbar recovers after viewport expansion');
    await context.close();
  });

  await t.test('reduced-motion styles and dialog behavior are computed at runtime',async()=>{
    const {page,context,errors}=await session(390,844,false,'reduce');
    assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
    for(const selector of ['.video-grid','#continue-grid','.discovery-filters','.creator-strip-links'])assert.equal(await page.locator(selector).first().evaluate(n=>getComputedStyle(n).scrollBehavior),'auto');
    for(const selector of ['.video-card','.thumb img','.video-menu'])assert.equal(await page.locator(selector).first().evaluate(n=>getComputedStyle(n).transitionDuration),'0s');
    await page.locator('#sections .video-menu').first().click();
    assert.equal(await page.locator('dialog').evaluate(n=>getComputedStyle(n).animationName),'none');
    await screenshot(page,'candidate-reduced-motion-menu');
    await page.keyboard.press('Escape');assert.deepEqual(errors,[]);await context.close();
  });
  if(directory) {
    await writeFile(join(directory,'evidence.json'),JSON.stringify(report,null,2));
    await writeFile(join(directory,'README.txt'),'Baseline: '+baseline+'\nTested candidate checkout: '+report.candidate+'\nAll images use fictional 72-video data, synthetic artwork and local media. Baseline images serve the four pre-layout files from the qualified count commit. No owner or live-library acceptance is claimed.\n'+report.viewportNote+'\n');
  }
});
