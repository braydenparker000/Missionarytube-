import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {extname,resolve,sep} from 'node:path';
import {chromium} from 'playwright-core';
import {encodeReport} from '../frontend/daily-board/v1/schema.js';
import {encodeReport as encodeV2} from '../frontend/daily-board/v2/schema.js';

const chrome=[process.env.JARVIS_CHROME,process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
if(!chrome)throw Error('Daily Board browser checks require Chrome. Set JARVIS_CHROME.');
const artifact=process.env.DAILY_BOARD_ARTIFACT_ROOT;
const root=resolve(artifact||'frontend');
const assets=resolve(artifact||'frontend');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2'};

async function openBoard(t,width=390,{live=false}={}){
 const server=createServer(async(req,res)=>{
  try{
   const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   const base=path.startsWith('/assets/')?assets:root;
   let file=resolve(base,'.'+path);
   if(!file.startsWith(base+sep))throw Error();
   if((await stat(file)).isDirectory())file+='/index.html';
   res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 t.after(()=>new Promise(done=>{server.closeAllConnections();server.close(done);}));
 const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
 const origin=process.env.DAILY_BOARD_ORIGIN||`http://127.0.0.1:${server.address().port}`,errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 // Synthetic cases fulfill API reads locally. The live smoke permits GETs only.
 let reply={status:503,body:{error:'Synthetic unavailable response'}},requests=0,release;
 await page.route('**/*',async route=>{
  const url=new URL(route.request().url());
  assert.equal(route.request().method(),'GET');
  if(url.origin===origin)return route.continue();
  assert.equal(url.origin,'https://jarvis-hub-api.braydenparker999.workers.dev');
  if(live)return route.continue();
  requests++;
  if(reply.hold)await new Promise(done=>{release=done;});
  await route.fulfill({status:reply.status,contentType:'application/json',body:JSON.stringify(reply.body)});
 });
 return {page,errors,origin,setReply:value=>{reply=value;},count:()=>requests,release:()=>release?.()};
}
const legacy=posts=>({status:200,body:{mode:'github-publications',messages:[],posts,nextCursor:null}});

for(const width of [320,390])test(`Daily Board retries a failed read in place at ${width}px`,async t=>{
 const h=await openBoard(t,width),{page}=h;
 await page.goto(h.origin+'/daily-board/');
 const retry=page.getByRole('button',{name:'Try again',exact:true});await retry.waitFor();
 const documentId=await page.evaluate(()=>{window.dailyBoardTestDocument=crypto.randomUUID();return window.dailyBoardTestDocument;});
 const bounds=await retry.boundingBox();assert.ok(bounds.height>=44&&bounds.width>=44);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await retry.focus();await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.activeElement?.textContent==='Try again'&&!document.activeElement.disabled);
 assert.equal(h.count(),2,'a repeated failure remains retryable');
 const report=JSON.parse(await readFile(new URL('./fixtures/daily-board/one.json',import.meta.url)));
 h.setReply({...legacy([{id:report.id,title:report.title,body:encodeReport(report),createdAt:'2026-10-18T09:00:00Z'}]),hold:true});
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('#report button')?.disabled);
 assert.equal(await page.getByText('Opening your Daily Board…',{exact:true}).count(),1);
 await page.keyboard.press('Enter');assert.equal(h.count(),3,'pending retry cannot submit twice');
 h.release();
 await page.getByRole('heading',{name:report.title,exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{pressed:true}).evaluate(n=>n===document.activeElement),true);
 assert.equal(await page.evaluate(()=>window.dailyBoardTestDocument),documentId,'retry preserves the original document');
 assert.equal(await retry.count(),0);assert.deepEqual(h.errors,[]);
});

test('Daily Board can recover to the empty state and transfers keyboard focus',async t=>{
 const h=await openBoard(t);await h.page.goto(h.origin+'/daily-board/');
 const retry=h.page.getByRole('button',{name:'Try again',exact:true});await retry.waitFor();
 h.setReply(legacy([]));await retry.click();
 await h.page.getByText('Your briefing will appear here.',{exact:true}).waitFor();
 assert.equal(await h.page.locator('#report').evaluate(n=>n===document.activeElement),true);
 assert.deepEqual(h.errors,[]);
});

if(process.env.DAILY_BOARD_ORIGIN)test('delivered Daily Board reads the real public feed',async t=>{
 const h=await openBoard(t,390,{live:true});await h.page.goto(h.origin+'/daily-board/');
 await h.page.waitForFunction(()=>document.querySelector('nav.editions [aria-pressed="true"]')||document.querySelector('#report')?.textContent==='Your briefing will appear here.');
 assert.equal(await h.page.getByRole('button',{name:'Try again',exact:true}).count(),0);
 assert.deepEqual(h.errors,[]);
});

async function openReports(t,width=390){
 const h=await openBoard(t,width);
 const report=JSON.parse(await readFile(new URL('./fixtures/daily-board/one.json',import.meta.url)));
 const post={id:report.id,title:report.title,body:encodeReport(report),createdAt:'2026-10-18T09:00:00Z'};
 const older={...post,id:'22222222-2222-4222-8222-222222222222',title:'Previous edition',body:'A previous briefing.\n'.repeat(100),createdAt:'2026-10-17T09:00:00Z'};
 h.setReply(legacy([post,older]));await h.page.goto(h.origin+'/daily-board/');
 await h.page.getByRole('heading',{name:report.title,exact:true}).waitFor();
 return {...h,post,older};
}

for(const width of [320,390])test(`Daily Board refresh retains the selected edition, reading position and focus at ${width}px`,async t=>{
 const h=await openReports(t,width),{page}=h;
 const chip=id=>page.locator(`.chip[data-id="${id}"]`),pressed=()=>page.locator('.chip[aria-pressed="true"]').getAttribute('data-id');
 await chip(h.older.id).click();
 const refresh=page.getByRole('button',{name:'Refresh reports',exact:true});
 assert.equal(await refresh.isVisible(),true,'Manual refresh is available after the initial read');
 await refresh.scrollIntoViewIfNeeded();await refresh.focus();
 await page.evaluate(()=>{document.querySelector('#report>div').dataset.retained='yes';window.scrollTo(0,200);});
 const y=await page.evaluate(()=>scrollY);
 const newPost={...h.post,id:'33333333-3333-4333-8333-333333333333',title:'New edition',createdAt:'2026-10-19T09:00:00Z'};
 h.setReply({...legacy([newPost,h.post,h.older]),hold:true});
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('#refresh')?.getAttribute('aria-disabled')==='true');
 assert.equal(await pressed(),h.older.id,'current edition remains visible while loading');
 await page.keyboard.press('Enter');assert.equal(h.count(),2,'pending refresh cannot submit twice');
 h.release();
 await page.getByRole('status').filter({hasText:'Reports refreshed.'}).waitFor();
 assert.equal(await pressed(),h.older.id,'a newer report does not replace the selected edition');
 assert.equal(await page.locator('#report>div').getAttribute('data-retained'),'yes','unchanged content is not rebuilt');
 assert.equal(await page.evaluate(()=>scrollY),y);
 assert.equal(await refresh.evaluate(n=>n===document.activeElement),true);
 assert.equal(await page.locator('.chip').count(),3);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(h.errors,[]);
});

test('Daily Board refresh failure retains the report and supports another refresh',async t=>{
 const h=await openReports(t),{page}=h;
 const refresh=page.getByRole('button',{name:'Refresh reports',exact:true});
 h.setReply({status:503,body:{error:'Synthetic unavailable response'}});
 await refresh.focus();await page.keyboard.press('Enter');
 await page.getByRole('status').filter({hasText:'Could not refresh.'}).waitFor();
 await page.getByRole('heading',{name:h.post.title,exact:true}).waitFor();
 assert.equal(await refresh.evaluate(n=>n===document.activeElement),true);
 h.setReply(legacy([h.older]));await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('.chip[aria-pressed="true"]')?.dataset.id==='22222222-2222-4222-8222-222222222222');
 assert.equal(await refresh.getAttribute('aria-disabled'),'false');
 assert.equal(await refresh.evaluate(n=>n===document.activeElement),true);
 assert.deepEqual(h.errors,[]);
});

test('Daily Board preserves an edition chosen while refresh is pending and recovers from an empty feed',async t=>{
 const h=await openReports(t),{page}=h,pressed=()=>page.locator('.chip[aria-pressed="true"]').getAttribute('data-id');
 h.setReply({...legacy([h.post,h.older]),hold:true});
 await page.getByRole('button',{name:'Refresh reports',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#refresh')?.getAttribute('aria-disabled')==='true');
 await page.locator(`.chip[data-id="${h.older.id}"]`).click();h.release();
 await page.getByRole('status').filter({hasText:'Reports refreshed.'}).waitFor();
 assert.equal(await pressed(),h.older.id);
 h.setReply(legacy([]));await page.getByRole('button',{name:'Refresh reports',exact:true}).click();
 await page.getByText('Your briefing will appear here.',{exact:true}).waitFor();
 h.setReply(legacy([h.post]));await page.getByRole('button',{name:'Refresh reports',exact:true}).click();
 await page.getByRole('heading',{name:h.post.title,exact:true}).waitFor();
 assert.deepEqual(h.errors,[]);
});

test('Daily Board says when today’s report is late, and only then',async t=>{
 const h=await openBoard(t,390),{page}=h;
 const report=JSON.parse(await readFile(new URL('./fixtures/daily-board/one.json',import.meta.url)));
 const post={id:report.id,title:report.title,body:encodeReport(report),createdAt:'2026-10-18T09:00:00Z'};
 const note=page.locator('.late-note');
 // 07:30 Rosario (UTC-3) on the report's day: due, but not late.
 await page.clock.setFixedTime(new Date('2026-10-18T10:30:00Z'));h.setReply(legacy([post]));
 await page.goto(h.origin+'/daily-board/');await page.getByRole('heading',{name:report.title,exact:true}).waitFor();
 assert.equal(await note.isVisible(),false);
 // The next morning after 08:00 the board says the new report is late.
 await page.clock.setFixedTime(new Date('2026-10-19T11:15:00Z'));await page.reload();
 await note.waitFor();assert.equal(await note.textContent(),'Today’s report hasn’t arrived yet. The latest is from October 18.');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // A plain report from today (dated by when it arrived) clears it.
 h.setReply(legacy([{id:'33333333-3333-4333-8333-333333333333',title:'Today',body:'A plain briefing.',createdAt:'2026-10-19T10:05:00Z'},post]));
 await page.getByRole('button',{name:'Refresh reports',exact:true}).click();
 await page.getByText('Reports refreshed.',{exact:true}).waitFor();
 assert.equal(await note.isVisible(),false);
 assert.deepEqual(h.errors,[]);
});

async function openPremium(t,width=390,extra=[]){
 const h=await openBoard(t,width);
 const report=JSON.parse(await readFile(new URL('./fixtures/daily-board/premium.json',import.meta.url)));
 const v1=JSON.parse(await readFile(new URL('./fixtures/daily-board/one.json',import.meta.url)));
 const post={id:report.id,title:report.title,body:encodeV2(report),createdAt:'2026-10-24T10:04:00Z'};
 const older={id:v1.id,title:v1.title,body:encodeReport(v1),createdAt:'2026-10-18T10:04:00Z'};
 h.setReply(legacy([older,post,...extra]));
 return {...h,report,post,older};
}

for(const width of [320,390,1280])test(`premium edition draws every v2 component without overflow at ${width}px`,async t=>{
 const h=await openPremium(t,width),{page}=h;
 await page.goto(h.origin+'/daily-board/');
 await page.getByRole('heading',{name:h.report.title,exact:true,level:1}).waitFor();
 await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.evaluate(()=>document.fonts.check('20px Newsreader')&&document.fonts.check('16px "Instrument Sans"')),true,'self-hosted fonts load under the CSP');
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'ember');
 assert.equal(await page.locator('article.story').count(),4);
 assert.equal(await page.locator('.glance li').count(),4);
 for(const selector of ['.cover-art','.stats .stat','.agenda li','.perspectives [role=tab]','.chart-line svg','.chart-column svg','.compare-item','.callout[data-kind=unknown]','.quote blockquote','.timeline li[data-state=now]','.stepper input[type=range]','.why','.note.next','.note.disagree','.c-brief'])
  assert.ok(await page.locator(selector).count()>0,selector);
 assert.match(await page.locator('.synthetic').textContent(),/Synthetic demonstration/);
 assert.equal(await page.locator('.agenda time').first().textContent(),'08:00');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'no horizontal scroll');
 assert.equal(await page.locator('.chip').count(),2);
 assert.equal(await page.locator('.chip[aria-pressed=true]').getAttribute('data-id'),h.post.id,'newest report date first');
 assert.deepEqual(h.errors,[]);
});

test('premium components work by keyboard: tabs, explainer, source marks and data tables',async t=>{
 const h=await openPremium(t,390),{page}=h;
 await page.goto(h.origin+'/daily-board/');
 await page.getByRole('heading',{name:h.report.title,exact:true,level:1}).waitFor();
 const first=page.getByRole('tab',{name:'What happened'});
 await first.focus();await page.keyboard.press('ArrowRight');
 const second=page.getByRole('tab',{name:'Why it matters'});
 assert.equal(await second.getAttribute('aria-selected'),'true');
 assert.equal(await second.evaluate(n=>n===document.activeElement),true);
 assert.match(await page.getByRole('tabpanel').filter({visible:true}).first().textContent(),/Port fees/);
 await page.keyboard.press('End');assert.equal(await page.getByRole('tab',{name:'What to watch'}).getAttribute('aria-selected'),'true');
 const slider=page.getByRole('slider',{name:'Explanation step'});
 await slider.focus();await page.keyboard.press('ArrowRight');
 assert.match(await page.locator('.step-count').textContent(),/Step 2 of 3/);
 assert.match(await page.locator('.step-text').textContent(),/lighter deck/);
 const sources=page.locator('#sources-ribera-vote');
 assert.equal(await sources.evaluate(n=>n.open),false);
 await page.getByRole('link',{name:/^Source 2: Final debate/}).first().click();
 assert.equal(await sources.evaluate(n=>n.open),true,'a source mark opens the list');
 await page.waitForFunction(()=>document.activeElement?.id==='src-ribera-vote-2');
 assert.match(await page.locator('#src-ribera-vote-2').textContent(),/The Ribera Ledger · Independent report/);
 await page.locator('.chart-line .chart-data summary').click();
 assert.equal(await page.locator('.chart-line table tbody tr').count(),6);
 assert.deepEqual(h.errors,[]);
});

test('editions switch by date, older v1 and plain reports use the same design, and ?date= opens an edition',async t=>{
 const plain={id:'66666666-6666-4666-8666-666666666666',title:'Your daily briefing',body:'EXECUTIVE ASSESSMENT\n\nA plain briefing.',createdAt:'2026-10-16T10:05:00Z'};
 const h=await openPremium(t,390,[plain]),{page}=h;
 await page.goto(h.origin+'/daily-board/?date=2026-10-18');
 await page.getByRole('heading',{name:h.older.title,exact:true,level:1}).waitFor();
 assert.equal(await page.locator('.chip[aria-pressed=true]').getAttribute('data-id'),h.older.id);
 assert.equal(await page.locator('article.story').count(),2,'v1 stories render');
 assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),'ink');
 await page.getByRole('button',{name:/^Friday,? 16 October 2026/}).click();
 await page.getByText('A plain briefing.',{exact:false}).waitFor();
 assert.equal(new URL(page.url()).searchParams.get('date'),'2026-10-16');
 const chips=page.locator('.chip');
 await chips.first().focus();await page.keyboard.press('ArrowRight');
 assert.equal(await chips.nth(1).evaluate(n=>n===document.activeElement),true);
 assert.deepEqual(h.errors,[]);
});

test('an agenda item downloads a calendar file in Rosario time',async t=>{
 const h=await openPremium(t,1280),{page}=h;
 await page.goto(h.origin+'/daily-board/');
 await page.getByRole('heading',{name:h.report.title,exact:true,level:1}).waitFor();
 const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'Add Polls close to your calendar'}).click()]);
 assert.match(download.suggestedFilename(),/\.ics$/);
 const text=await readFile(await download.path(),'utf8');
 assert.match(text,/DTSTART:20261025T200000Z/);assert.match(text,/SUMMARY:Polls close/);
 assert.deepEqual(h.errors,[]);
});
