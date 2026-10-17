import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {chromium} from 'playwright-core';
const chrome=process.env.JARVIS_CHROME;
const publicRoot=resolve('public'),policy=JSON.parse(await readFile(join(publicRoot,'staticwebapp.config.json'),'utf8'));
const show={id:'fixture-show',title:'The Sound of History',author:'A thoughtful host',feedUrl:'https://feeds.example.org/history.xml',description:'Stories from the past, told with care.',artwork:'',website:'https://example.org'};
const episodes=Array.from({length:5},(_,i)=>({id:'episode-'+i,title:['A remarkable beginning','The music of a city','An overlooked story','Across the mountains','A new chapter'][i],description:'Episode notes with <script>untrusted text</script> and useful details.',duration:60,publishedAt:new Date(Date.UTC(2026,9,3-i)).toISOString(),audioUrl:'https://audio.example.org/'+i+'.wav',type:'audio/wav',bytes:960044}));
function wav() {const rate=8000,samples=rate*60,b=Buffer.alloc(44+samples*2);b.write('RIFF',0);b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);return b;}
test('podcast mobile flows, real offline audio, seeking, timers and queue',{skip:!chrome||!existsSync(chrome),timeout:120000},async t=>{
 const audioBytes=wav();let failPrimaryAudio=false,feedRequests=0;const directoryQueries=[];
 const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://local');
  const json=data=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(url.pathname==='/assets/config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end('export const API_ORIGIN=location.origin;');return;}
  if(['/podcasts/search','/podcasts/browse'].includes(url.pathname)){directoryQueries.push(Object.fromEntries(url.searchParams));if(url.searchParams.get('q')==='slow')await delay(500);if(url.searchParams.get('q')==='unavailable'){res.writeHead(503);res.end();return;}if(url.searchParams.get('q')==='fallback'){res.writeHead(502,{'Content-Type':'application/json'});res.end('{"error":"Directory blocked in this region"}');return;}json({shows:['empty','race'].includes(url.searchParams.get('q'))?[]:[show,{...show,id:'two',title:'Science in motion',feedUrl:'https://feeds.example.org/science.xml'}]});return;}
  if(url.pathname==='/podcasts/feed'){feedRequests++;
   if(url.searchParams.get('url')?.includes('slow.xml'))await delay(500);
   const archive=url.searchParams.get('url')?.includes('archive'),offset=Number(url.searchParams.get('offset') || 0);
   const items=archive?Array.from({length:95},(_,i)=>({...episodes[0],id:'archive-'+i,title:'Archive episode '+i})):episodes;
   json({show:{...show,feedUrl:url.searchParams.get('url')},episodes:items.slice(offset,offset+40),nextOffset:items.length>offset+40?offset+40:null});return;
  }
  if(url.pathname==='/podcasts/audio'){
   if(failPrimaryAudio&&url.searchParams.get('id')==='episode-4'){res.writeHead(502,{'Content-Type':'application/json'});res.end('{"error":"Publisher redirect chain is unavailable"}');return;}
   const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range || ''),start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),audioBytes.length-1):audioBytes.length-1;
   res.writeHead(range?206:200,{'Content-Type':'audio/wav','Content-Length':end-start+1,'Accept-Ranges':'bytes',...(range?{'Content-Range':`bytes ${start}-${end}/${audioBytes.length}`}:{})});res.end(audioBytes.subarray(start,end+1));return;
  }
  let p=resolve(publicRoot,'.'+url.pathname);if(!p.startsWith(publicRoot+'/'))throw Error();if((await stat(p)).isDirectory())p=join(p,'index.html');
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};
  let content=await readFile(p);if(extname(p)==='.html'){const path='/'+p.slice(publicRoot.length+1),csp=(policy.routes.find(r=>path.startsWith(r.route.replace('*','')))?.headers?.['Content-Security-Policy'] || policy.globalHeaders['Content-Security-Policy']).replace(/frame-ancestors[^;]*(;|$)/g,'');content=content.toString().replace('<head>',`<head><meta http-equiv="Content-Security-Policy" content="${csp}">`);}
  res.writeHead(200,{'Content-Type':mime[extname(p)] || 'application/octet-stream'});res.end(content);
 }catch{res.writeHead(404);res.end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));});
 const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
 await page.clock.install();
 const directoryRequests=[];
 await context.route('https://itunes.apple.com/**',async route=>{const request=route.request(),u=new URL(request.url()),term=u.searchParams.get('term');directoryRequests.push(request);if(term==='slow')await delay(600);if(term==='unavailable'){await route.abort('failed');return;}assert.equal(request.resourceType(),'fetch');assert.equal(u.searchParams.has('callback'),false);assert.equal(request.headers().authorization,undefined);assert.equal(request.headers().referer,undefined);const shows=term==='empty'?[]:[show,{...show,id:'two',title:'Science in motion',feedUrl:'https://feeds.example.org/science.xml'}];await route.fulfill({contentType:'text/javascript; charset=utf-8',headers:{'Access-Control-Allow-Origin':'*'},body:JSON.stringify({results:shows.map(s=>({collectionId:s.id,collectionName:s.title,artistName:s.author,feedUrl:s.feedUrl}))})});});
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&m.text().includes('Content Security Policy'))errors.push(m.text());});
 const stored=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis.podcasts.v1')));
 const shot=async name=>{if(process.env.JARVIS_SCREENSHOT_DIR){await mkdir(process.env.JARVIS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.JARVIS_SCREENSHOT_DIR,'podcasts-'+name+'.png'),animations:'disabled'});}};
 try {
  await t.test('browse, search, follow and episode filtering',async()=>{
   await page.goto(origin+'/podcasts/');await page.locator('.show-tile').first().waitFor();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
   await shot('discover');await page.locator('#query').fill('history');await page.locator('#search-form button[type=submit]').click();await page.waitForURL('**/#search=history');await page.locator('.show-tile').first().click();await page.locator('#follow-show').click();assert.equal((await stored()).follows.length,1);
   await page.locator('#episode-query').fill('music');assert.equal(await page.locator('.episode-row').count(),1);await page.locator('#episode-query').fill('');assert.equal(await page.locator('.episode-row').count(),5);await shot('show');
   assert.equal(await page.locator('#results script').count(),0);
  });
  await t.test('download, real playback, speed and mini-player seeking',async()=>{
   await page.locator('[data-options]').first().click();await page.getByRole('button',{name:'Download for offline listening',exact:true}).click();await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('jarvis.podcasts.v1')).downloads).length===1);
   await page.locator('[data-play]').first().click();await page.waitForFunction(()=>!document.querySelector('#audio').paused&&document.querySelector('#audio').duration===60);
   await page.locator('#mini-seek').evaluate(input=>{input.value=25;input.dispatchEvent(new Event('input'));input.dispatchEvent(new Event('change'));});await page.waitForFunction(()=>document.querySelector('#audio').currentTime>=25);
   await page.waitForFunction(()=>!document.querySelector('#mini-seek').disabled);
   assert.match(await page.locator('#mini-seek').getAttribute('aria-valuetext'),/25 seconds of 1 minute/);
   const axSession=await context.newCDPSession(page),ax=await axSession.send('Accessibility.getFullAXTree');
   assert.match(ax.nodes.find(n=>n.role?.value==='slider')?.description?.value,/25 seconds of 1 minute/);await axSession.detach();
   await page.locator('#open-player').click();assert.match(await page.locator('#seek').getAttribute('aria-valuetext'),/seconds of 1 minute/);await page.locator('#seek').evaluate(input=>{input.value=35;input.dispatchEvent(new Event('input'));});assert.equal(await page.locator('#seek').getAttribute('aria-valuetext'),'35 seconds of 1 minute');await page.locator('#seek').evaluate(input=>input.dispatchEvent(new Event('pointercancel')));await page.locator('#speed').click();await page.getByRole('button',{name:'1.5×',exact:true}).click();assert.equal(await page.locator('#audio').evaluate(a=>a.playbackRate),1.5);await shot('player');
   await page.locator('#play').click();assert.equal(await page.locator('#audio').evaluate(a=>a.paused),true);assert.ok(Object.values((await stored()).progress)[0].position>=25);await page.locator('#close-player').click();
  });
  await t.test('offline reload, resume and byte-range seeking use the actual downloaded file',async()=>{
   await page.locator('[data-view=downloads]').click();await context.setOffline(true);await page.reload();await page.locator('.episode-row').first().waitFor();assert.match(await page.locator('#mini-seek').getAttribute('aria-valuetext'),/of 1 minute; play audio to enable seeking/);assert.equal(await page.locator('#mini-seek').isDisabled(),true);await page.locator('[data-play]').first().click();await page.waitForFunction(()=>!document.querySelector('#audio').paused);
   assert.ok(await page.locator('#audio').evaluate(a=>a.currentTime>=25));
   await page.locator('#mini-seek').evaluate(input=>{input.value=40;input.dispatchEvent(new Event('change'));});await page.waitForFunction(()=>document.querySelector('#audio').currentTime>=40);
   const range=await page.evaluate(async()=>{const a=document.querySelector('#audio'),r=await fetch(a.src,{headers:{Range:'bytes=10-19'}});return {status:r.status,range:r.headers.get('Content-Range'),length:(await r.arrayBuffer()).byteLength};});assert.deepEqual(range,{status:206,range:'bytes 10-19/960044',length:10});
   await page.locator('#mini-play').click();await context.setOffline(false);
  });
  await t.test('end-of-episode timer stops queue autoplay; disabling it advances the queue',async()=>{
   await page.locator('[data-view=library]').click();await page.locator('.show-tile').first().click();await page.locator('[data-options]').nth(1).click();await page.getByRole('button',{name:'Add to queue',exact:true}).click();
   await page.locator('#open-player').click();await page.locator('#sleep').click();await page.getByRole('button',{name:'End of this episode',exact:true}).click();await page.locator('#play').click();
   await page.locator('#audio').evaluate(a=>a.currentTime=a.duration-.05);await page.waitForFunction(()=>document.querySelector('#audio').ended);
   assert.equal((await stored()).queue.length,1);assert.equal(await page.locator('#sleep-label').textContent(),'Sleep timer');assert.equal(Object.values((await stored()).progress).find(p=>p.episode.id==='episode-0').played,true);
   await page.locator('#play').click();await page.waitForFunction(()=>!document.querySelector('#audio').paused);await page.locator('#audio').evaluate(a=>a.currentTime=a.duration-.05);
   await page.waitForFunction(()=>document.querySelector('#mini-title').textContent==='The music of a city'&&!document.querySelector('#audio').paused&&JSON.parse(localStorage.getItem('jarvis.podcasts.v1')).queue.length===0);assert.equal((await stored()).queue.length,0);assert.equal(Object.values((await stored()).progress).find(p=>p.episode.id==='episode-0').played,true);
   await page.locator('#play').click();await page.locator('#close-player').click();
  });
  await t.test('timed sleep uses elapsed wall time and pauses playback',async()=>{
   await page.locator('#open-player').click();await page.locator('#sleep').click();await page.getByRole('button',{name:'15 minutes',exact:true}).click();await page.locator('#play').click();await page.waitForFunction(()=>!document.querySelector('#audio').paused);
   await page.clock.fastForward(15*60000+10);assert.equal(await page.locator('#audio').evaluate(a=>a.paused),true);assert.equal(await page.locator('#sleep-label').textContent(),'Sleep timer');await page.locator('#close-player').click();
  });
  await t.test('empty search and mobile/desktop layouts remain usable',async()=>{
   await page.locator('[data-view=discover]').click();await page.locator('#query').fill('empty');await page.locator('#search-form button[type=submit]').click();await page.getByRole('heading',{name:'No shows found'}).waitFor();
   for(const width of [360,390,1200]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
   assert.deepEqual(errors,[]);
  });
  await t.test('large shows load more pages without rebuilding or losing episode filters',async()=>{
   await page.setViewportSize({width:390,height:844});await page.goto(origin+'/podcasts/#show='+encodeURIComponent('https://feeds.example.org/archive.xml'));
   await page.locator('.episode-row').first().waitFor();assert.equal(await page.locator('.episode-row').count(),40);
   await page.locator('#more-episodes').click();await page.waitForFunction(()=>document.querySelectorAll('.episode-row').length===80);
   await page.locator('[data-view=library]').click();await page.goBack();await page.waitForFunction(()=>document.querySelectorAll('.episode-row').length===80);
   await page.locator('#episode-query').fill('episode 79');assert.equal(await page.locator('.episode-row').count(),1);
   await page.locator('#more-episodes').click();await page.waitForFunction(()=>document.querySelector('#episode-count').textContent==='95');assert.equal(await page.locator('#episode-query').inputValue(),'episode 79');assert.equal(await page.locator('.episode-row').count(),1);
   assert.deepEqual(errors,[]);
  });
  await t.test('discovery still works when a server region rejects directory requests',async()=>{
   await page.goto(origin+'/podcasts/#search=fallback');await page.locator('.show-tile').first().waitFor();assert.equal(await page.locator('.show-tile').count(),2);assert.equal(await page.locator('#status').isVisible(),false);assert.deepEqual(errors,[]);
  });
  await t.test('empty server results do not beat a matching client directory response',async()=>{
   await page.goto(origin+'/podcasts/#search=race');await page.locator('.show-tile').first().waitFor();assert.equal(await page.locator('.show-tile').count(),2);assert.equal(await page.getByRole('heading',{name:'No shows found'}).count(),0);
  });
  await t.test('directory requests stay data-only and never expose a remembered owner bearer',async()=>{
   const marker='fixture-owner-token-'+ 'a'.repeat(40);await page.evaluate(value=>localStorage.setItem('jarvis.relay.owner-session.v1',JSON.stringify({device_token:value,device_id:'fixture-device'})),marker);
   await page.goto(origin+'/podcasts/#search=history');await page.locator('.show-tile').first().waitFor();
   assert.ok(directoryRequests.length);assert.equal(await page.locator('script[src^="https://itunes.apple.com"]').count(),0);
   assert.equal(await page.evaluate(()=>Object.keys(window).some(key=>key.startsWith('__jarvis_podcast_'))),false);
   for(const request of directoryRequests)assert.equal(JSON.stringify({url:request.url(),headers:request.headers(),body:request.postData()}).includes(marker),false);
  });
  await t.test('failed audio resolves from the publisher and preserves the saved position',async()=>{
   await context.route('https://audio.example.org/4.wav',route=>route.fulfill({contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':'*','Accept-Ranges':'bytes'},body:audioBytes}));
   await page.goto(origin+'/podcasts/#show='+encodeURIComponent(show.feedUrl));await page.getByRole('button',{name:'Play A new chapter',exact:true}).click();
   await page.waitForFunction(()=>!document.querySelector('#audio').paused&&document.querySelector('#audio').currentTime>0);
   await page.locator('#mini-seek').evaluate(input=>{input.value=22;input.dispatchEvent(new Event('change'));});await page.locator('#mini-play').click();assert.ok((await stored()).progress[show.feedUrl+'#episode-4'].position>=22);
   failPrimaryAudio=true;await page.reload();await page.locator('.episode-play').last().click();
   await page.waitForFunction(()=>!document.querySelector('#audio').paused&&document.querySelector('#audio').currentTime>=22,{},{timeout:5000});
   assert.ok(await page.locator('#audio').evaluate(a=>a.currentTime<25),'Recovery must resume immediately, rather than play from the beginning');
   assert.equal(await page.locator('#audio').evaluate(a=>a.currentSrc),'https://audio.example.org/4.wav');await page.locator('#mini-play').click();assert.equal(await page.locator('#playback-status').isVisible(),false);assert.deepEqual(errors,[]);
  });
  await t.test('show Back returns to the search that opened it',async()=>{
   await page.goto(origin+'/podcasts/#search=history');await page.locator('.show-tile').first().click();await page.locator('#show-back').click();
   await page.waitForFunction(()=>document.querySelector('#results').getAttribute('aria-busy')==='false');
   assert.equal(new URL(page.url()).hash,'#search=history');assert.equal(await page.locator('#query').inputValue(),'history');
  });
  await t.test('removing a download clears the visible saved state',async()=>{
   await page.goto(origin+'/podcasts/#show='+encodeURIComponent(show.feedUrl));await page.locator('[data-options]').first().click();await page.getByRole('button',{name:'Remove download',exact:true}).click();
   await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('jarvis.podcasts.v1')).downloads).length===0);
   assert.equal(await page.locator('.episode-row').first().innerText().then(text=>text.includes('Downloaded')),false);
  });
  await t.test('new searches win over delayed results, with truthful loading and errors',async()=>{
   await page.goto(origin+'/podcasts/#discover');await page.locator('#query').fill('slow');await page.locator('#search-form button[type=submit]').click();
   await page.waitForFunction(()=>document.querySelector('#results').getAttribute('aria-busy')==='true');
   assert.equal(await page.locator('#status').textContent(),'Finding shows…');
   await page.locator('#query').fill('science');await page.locator('#search-form button[type=submit]').click();await page.getByRole('heading',{name:'Results for “science”'}).waitFor();
   await delay(650);assert.equal(await page.locator('#query').inputValue(),'science');assert.equal(await page.getByRole('heading',{name:'Results for “science”'}).count(),1);
   await page.locator('#query').fill('unavailable');await page.locator('#search-form button[type=submit]').click();await page.getByRole('heading',{name:'Couldn’t load podcasts'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Try again',exact:true}).count(),1);assert.equal(await page.getByRole('link',{name:'Open downloads',exact:true}).count(),1);
   await page.locator('#clear-search').click();await page.locator('[data-search="science"]').click();await page.getByRole('heading',{name:'Results for “science”'}).waitFor();
   await page.goto(origin+'/podcasts/#search=x');await page.getByRole('heading',{name:'What would you like to hear?'}).waitFor();
  });
  await t.test('Back closes nested sheets before leaving the episode; Escape restores focus',async()=>{
   await page.goto(origin+'/podcasts/#show='+encodeURIComponent(show.feedUrl));await page.locator('.episode-row').first().waitFor();
   await page.locator('#open-player').click();await page.locator('#sleep').click();await page.goBack();await page.waitForFunction(()=>!document.querySelector('#sheet').open);
   assert.equal(await page.locator('#player').evaluate(d=>d.open),true);assert.ok(page.url().includes('#show='));
   await page.goBack();await page.waitForFunction(()=>!document.querySelector('#player').open);assert.ok(page.url().includes('#show='));
   await page.locator('[data-options]').first().click();await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#sheet').open);
   assert.equal(await page.locator('[data-options]').first().evaluate(b=>b===document.activeElement),true);
   await page.locator('#mini-sleep').click();await page.getByRole('button',{name:'30 minutes',exact:true}).click();const remaining=(await page.locator('#mini-sleep-label').textContent()).split(':').map(Number);assert.ok(remaining[0]*60+remaining[1]>29*60&&remaining[0]*60+remaining[1]<=30*60);
   await page.locator('#mini-sleep').click();await page.getByRole('button',{name:'Turn off timer',exact:true}).click();assert.equal(await page.locator('#mini-sleep-label').textContent(),'Sleep');
  });
  await t.test('episode filters and category survive navigation; stale show loads cannot replace Downloads',async()=>{
   await page.goto(origin+'/podcasts/#show='+encodeURIComponent(show.feedUrl));await page.locator('#episode-query').fill('music');
   await page.locator('[data-view=library]').click();await page.goBack();await page.locator('#episode-query').waitFor();assert.equal(await page.locator('#episode-query').inputValue(),'music');assert.equal(await page.locator('.episode-row').count(),1);
   await page.locator('[data-view=discover]').click();await page.locator('[data-category=science]').click();await page.locator('.show-tile').first().click();await page.locator('#show-back').click();await page.locator('[data-category=science][aria-pressed=true]').waitFor();
   await page.goto(origin+'/podcasts/#show='+encodeURIComponent('https://feeds.example.org/slow.xml'));await page.locator('[data-view=downloads]').click();await delay(600);assert.equal(await page.locator('#heading').textContent(),'Downloads');assert.equal(await page.locator('#follow-show').count(),0);
  });
  await t.test('direct download actions are idempotent and cancellation never reports saved',async()=>{
   await page.goto(origin+'/podcasts/#show='+encodeURIComponent(show.feedUrl));await page.locator('.episode-row').first().waitFor();
   await page.locator('#episode-query').fill('');
   let requests=0;let release;const blocked=new Promise(resolve=>release=resolve);
   await context.route('**/podcasts/audio?*',async route=>{requests++;await blocked;await route.fulfill({contentType:'audio/wav',body:audioBytes}).catch(()=>{});});
   await page.locator('[data-download]').nth(2).evaluate(b=>{b.click();b.click();});await page.waitForFunction(()=>document.querySelectorAll('.episode-row')[2].textContent.includes('Downloading'));
   await page.getByRole('button',{name:'Cancel download An overlooked story',exact:true}).click();release();
   await page.waitForFunction(()=>!document.querySelectorAll('.episode-row')[2].textContent.includes('Downloading'));assert.ok(requests<=1);assert.equal(Object.keys((await stored()).downloads).length,0);
   await context.unroute('**/podcasts/audio?*');
   await page.locator('[data-download]').nth(2).click();await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('jarvis.podcasts.v1')).downloads).length===1);
   assert.ok((await page.locator('.episode-row').nth(2).innerText()).includes('Downloaded'));await page.getByRole('button',{name:'Manage download An overlooked story',exact:true}).click();await page.getByRole('button',{name:'Remove download',exact:true}).click();await page.waitForFunction(()=>Object.keys(JSON.parse(localStorage.getItem('jarvis.podcasts.v1')).downloads).length===0);
  });
  await t.test('offline show snapshots stay explicitly saved across repeated visits',async()=>{
   await page.goto(origin+'/podcasts/#show='+encodeURIComponent(show.feedUrl));await page.locator('#follow-show').waitFor();await context.setOffline(true);await page.reload();await page.locator('#follow-show').waitFor();
   assert.equal(await page.locator('#offline-status').isVisible(),true);assert.match(await page.locator('#status').textContent(),/Showing saved episodes/);
   await page.locator('[data-view=library]').click();await page.locator('.show-tile').first().click();await page.locator('#follow-show').waitFor();assert.match(await page.locator('#status').textContent(),/Showing saved episodes/);
   await shot('offline-show');await context.setOffline(false);
  });
  await t.test('narrow touch layouts, readable controls and reduced motion',async()=>{
   await page.emulateMedia({reducedMotion:'reduce'});
   for(const width of [320,360,390,430,1200]){
    await page.setViewportSize({width,height:800});await page.goto(origin+'/podcasts/#show='+encodeURIComponent(show.feedUrl));await page.locator('.episode-row').first().waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'No page overflow at '+width);
    for(const selector of ['#follow-show','.episode-play','.episode-download','[data-options]','#mini-sleep','#mini-play','#mini-seek']){
     const box=await page.locator(selector).first().boundingBox();assert.ok(box.width>=48&&box.height>=48,selector+' has a 48px target at '+width);
    }
    await page.locator('#open-player').click();assert.equal(await page.locator('#player').evaluate(d=>getComputedStyle(d).animationName),'none');
    assert.ok(await page.locator('#player').evaluate(d=>d.scrollWidth<=d.clientWidth+1));await page.locator('#close-player').click();await page.waitForFunction(()=>!document.querySelector('#player').open);
   }
   await page.setViewportSize({width:390,height:844});await page.goto(origin+'/podcasts/#search=history');await page.locator('.show-tile').first().waitFor();await shot('search');
   await page.locator('.show-tile').first().click();await page.locator('.episode-row').first().waitFor();await page.locator('#query').evaluate(e=>e.blur());await shot('compact-player');
   assert.equal(await page.evaluate(()=>document.fonts.check('16px "Podcast Manrope"')),true);assert.deepEqual(errors,[]);
  });
  await t.test('Show Back skips the closed dialog history entry after reload',async()=>{
   await page.goto(origin+'/podcasts/#search=history');await page.locator('.show-tile').first().click();await page.locator('.episode-row').first().waitFor();
   await page.locator('#open-player').click();await page.reload();await page.locator('#show-back').waitFor();assert.equal(await page.locator('#player').evaluate(d=>d.open),false);
   await page.locator('#show-back').click();await page.waitForURL('**/#search=history');assert.equal(new URL(page.url()).hash,'#search=history');await page.getByRole('heading',{name:'Results for “history”'}).waitFor();
  });
  await t.test('Show Back returns to search after Forward into a dismissed player entry',async()=>{
   await page.goto(origin+'/podcasts/#search=history');await page.locator('.show-tile').first().click();await page.locator('.episode-row').first().waitFor();
   await page.locator('#open-player').click();await page.locator('#close-player').click();await page.waitForFunction(()=>!document.querySelector('#player').open);await page.goForward();
   await page.locator('#show-back').click();await page.waitForURL('**/#search=history');assert.equal(new URL(page.url()).hash,'#search=history');await page.getByRole('heading',{name:'Results for “history”'}).waitFor();
   await page.goForward();await page.locator('#show-back').waitFor();assert.equal(await page.locator('#player').evaluate(d=>d.open),false);await page.goForward();await page.goBack();await page.waitForURL('**/#search=history');await page.getByRole('heading',{name:'Results for “history”'}).waitFor();
  });
  await t.test('browser Back skips a dismissed player entry after reload',async()=>{
   await page.goto(origin+'/podcasts/#search=history');await page.locator('.show-tile').first().click();await page.locator('#show-back').waitFor();await page.locator('#open-player').click();
   await page.reload();await page.locator('#show-back').waitFor();await page.goBack();await page.waitForURL('**/#search=history');await page.getByRole('heading',{name:'Results for “history”'}).waitFor();
  });
  await t.test('show refresh remains visible and preserves filters; the last episode clears fixed controls',async()=>{
   await page.goto(origin+'/podcasts/#show='+encodeURIComponent(show.feedUrl));await page.locator('#episode-query').fill('music');const before=feedRequests;
   await page.getByRole('button',{name:'Refresh episodes',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#results').getAttribute('aria-busy')==='false');
   assert.ok(feedRequests>before);assert.equal(await page.locator('#episode-query').inputValue(),'music');assert.equal(await page.locator('.episode-row').count(),1);
   await page.locator('#episode-query').fill('');await page.locator('.episode-row').last().scrollIntoViewIfNeeded();const last=await page.locator('.episode-row').last().boundingBox(),mini=await page.locator('#mini-player').boundingBox();assert.ok(last.y+last.height<=mini.y,'Last episode and actions remain reachable above the mini-player');
  });
  await t.test('global directory fallback never implies selected-country provenance',async()=>{
   const blockApple=route=>route.abort('failed');await context.route('https://itunes.apple.com/**',blockApple);
   await page.locator('[data-view=discover]').click();await page.locator('#settings').click();await page.locator('#country').selectOption('ar');await page.getByRole('button',{name:'Save',exact:true}).click();await page.locator('.show-tile').first().waitFor();
   assert.equal(directoryQueries.at(-1).country,'ar');assert.equal(await page.locator('.directory-caption').textContent(),'Browse by topic');
   await context.unroute('https://itunes.apple.com/**',blockApple);
  });
 } finally {await browser.close();}
});
test('live podcast discovery, search and playback',{skip:!process.env.PODCAST_LIVE_URL||!chrome||!existsSync(chrome),timeout:240000},async()=>{
 const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.PODCAST_LIVE_URL);await page.locator('.show-tile').first().waitFor({timeout:45000});
  if(process.env.JARVIS_SCREENSHOT_DIR){await mkdir(process.env.JARVIS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.JARVIS_SCREENSHOT_DIR,'podcasts-live-discover.png'),animations:'disabled'});}
  await page.locator('#query').fill('The Rest Is History');await page.locator('#search-form button[type=submit]').click();
  await page.locator('.show-tile').filter({has:page.getByText('The Rest Is History',{exact:true})}).first().click({timeout:45000});
  await page.locator('[data-play]').first().click({timeout:30000});await page.waitForFunction(()=>!document.querySelector('#audio').paused&&document.querySelector('#audio').currentTime>0,{},{timeout:45000});
  await page.locator('#open-player').click();
  if(process.env.JARVIS_SCREENSHOT_DIR)await page.screenshot({path:join(process.env.JARVIS_SCREENSHOT_DIR,'podcasts-live-player.png'),animations:'disabled'});
  await page.locator('#audio').evaluate(a=>a.pause());assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  // Require real advancing playback for the two publishers whose enclosure
  // chains exceeded the previous redirect cap.
  for(const feedUrl of ['https://feeds.simplecast.com/Sl5CSM3S','https://rss2.flightcast.com/xmsftuzjjykcmqwolaqn6mdn']) {
   await page.locator('#close-player').click();await page.goto(process.env.PODCAST_LIVE_URL+'#show='+encodeURIComponent(feedUrl));
   await page.locator('.episode-play').first().click({timeout:30000});await page.waitForFunction(()=>!document.querySelector('#audio').paused&&document.querySelector('#audio').currentTime>0,{},{timeout:55000});
   await page.locator('#open-player').click();await page.locator('#audio').evaluate(a=>a.pause());
  }
  assert.deepEqual(errors,[]);
 }finally{await browser.close();}
});
