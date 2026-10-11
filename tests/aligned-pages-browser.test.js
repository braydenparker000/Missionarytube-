import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join,extname} from 'node:path';
import {chromium} from 'playwright-core';

// Real page scripts and score/PDF worker; only network data is fictional.
test('aligned pages: board, guitar, route isolation and responsive states', {timeout:120000}, async () => {
 const root=resolve('public'), mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.otf':'font/otf'};
 const server=createServer(async(req,res)=>{try{let path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(path!==root&&!path.startsWith(root+'/'))throw Error();if((await stat(path)).isDirectory())path=join(path,'index.html');res.setHeader('Content-Type',mime[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({executablePath:process.env.JARVIS_CHROME||'/usr/bin/chromium',args:['--no-sandbox']});
 const tuning=[64,59,55,50,45,40];
 const tracks=[{partId:0,instrumentId:24,kind:'guitar',name:'Lead guitar',tuning},{partId:1,instrumentId:25,kind:'guitar',name:'Rhythm guitar',tuning}];
 const song={songId:1,revisionId:1,title:'Evening practice',artist:'Browser fixture',tracks};
 const post={id:'11111111-1111-4111-8111-111111111111',title:'A little room for what matters',body:'Start with a quiet moment.\n\nPractice the difficult phrase slowly, then play the whole song.\n\nKeep the rest of today simple. This is fictional test content.',createdAt:'2026-10-11T08:00:00Z'};
 try {
 for(const width of [360,390,1200]) {
  const context=await browser.newContext({viewport:{width,height:844},acceptDownloads:true});let posts=[post],fail=false;const errors=[];
  await context.route('**/*',async route=>{
   const u=new URL(route.request().url());if(u.origin===origin)return route.continue();
   const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
   if(fail)return json({error:'Service unavailable. Try again.'},503);
   if(u.pathname==='/shared/changes')return json({error:'Legacy fixture'},404);
   if(u.pathname==='/shared/state')return json({messages:[],posts,mode:'github-publications',coordinationVersion:1,publisher:{ok:true},nextCursor:null,public_inbox:true,author_authenticated:false,execution_authorized:false});
   if(u.pathname==='/guitar/search')return json({results:[song]});
   if(u.pathname==='/guitar/songs/1')return json({song});
   if(u.pathname==='/guitar/songs/1/score')return json({meta:song,revisions:tracks.filter(t=>u.searchParams.get('parts').split(',').includes(String(t.partId))).map(trackMeta=>({trackMeta,revision:{tuning,instrumentId:24,measures:[{signature:[4,4],voices:[{beats:[{duration:[1,1],notes:[{fret:3,string:0}]}]}]}]}}))});
   return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  const layout=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'no document overflow');
  const shot=async name=>{await layout();if(process.env.JARVIS_SCREENSHOT_DIR){await mkdir(process.env.JARVIS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.JARVIS_SCREENSHOT_DIR,`${name}-${width}.png`),fullPage:true,animations:'disabled'});}};
  const palette=async()=>assert.equal(await page.locator('body').evaluate(n=>getComputedStyle(n).getPropertyValue('--accent').trim()),'#dce3eb');
  await page.goto(origin+'/daily-board/');await page.getByText(post.title,{exact:true}).waitFor();await palette();await shot('daily-board');
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.className),'skip-link');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'content');
  await page.getByRole('link',{name:'Back to Home'}).click();await page.locator('#launcher-time').waitFor();await palette();await shot('home');
  // SPA route changes must not leave the new page class active in Relay.
  await page.locator('.launcher-link[href="/jarvis/"]').click();assert.equal(await page.locator('body.aligned-hub').count(),0);
  await page.goto(origin+'/daily-board/');posts=[];await page.evaluate(()=>localStorage.clear());await page.reload();await page.locator('.empty-board').waitFor();await shot('daily-board-empty');
  fail=true;await page.reload();await page.getByRole('button',{name:'Connection details'}).click();await page.locator('#connection-detail').filter({hasText:'unavailable'}).waitFor();await shot('daily-board-error');fail=false;
  await page.goto(origin+'/guitar/');await page.locator('.tab-empty').waitFor();await palette();await shot('guitar-empty');
  await page.locator('[data-guitar-view="search"]').click();await page.locator('#song-query').fill('Evening');await page.locator('#search-button').click();await page.locator('.song-result').click();
  await page.locator('#save-tab').click();await page.locator('#track-picker').click();await shot('guitar-tracks');await page.getByRole('radio',{name:'Rhythm guitar'}).check();
  await page.locator('#preview-tab').click();await page.locator('#notation-preview img').waitFor();await shot('guitar-score');
  await page.locator('#download-pdf').click();await page.locator('#direct-download').waitFor();const download=page.waitForEvent('download');await page.locator('#direct-download').click();assert.match((await download).suggestedFilename(),/\.pdf$/);
  await page.locator('[data-guitar-view="saved"]').click();await page.locator('.song-result:visible').waitFor();await shot('guitar-saved');await page.reload();await page.locator('.song-result:visible').waitFor();
  await page.locator('[data-guitar-view="search"]').click();fail=true;await page.locator('#song-query').fill('Retry');await page.locator('#search-button').click();await page.locator('#status.error').waitFor();assert.equal(await page.locator('#song-query').inputValue(),'Retry');await shot('guitar-error');
  await page.addStyleTag({content:'main input,main button,main p,main small,main strong,main h2,main label,main legend{font-size:28px!important;line-height:1.4!important}'});await layout();
  assert.deepEqual(errors,[]);await context.close();
 }
 } finally {await browser.close();await new Promise(r=>server.close(r));}
});
