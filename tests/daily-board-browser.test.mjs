import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {extname,resolve,sep} from 'node:path';
import {chromium} from 'playwright-core';
import {encodeReport} from '../frontend/daily-board/v1/schema.js';

const chrome=[process.env.JARVIS_CHROME,process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
if(!chrome)throw Error('Daily Board browser checks require Chrome. Set JARVIS_CHROME.');
const artifact=process.env.DAILY_BOARD_ARTIFACT_ROOT;
const root=resolve(artifact||'frontend');
const assets=resolve(artifact||'frontend');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css'};

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
 const report=JSON.parse(await readFile(new URL('../daily-board-next/fixtures/one.json',import.meta.url)));
 h.setReply({...legacy([{id:report.id,title:report.title,body:encodeReport(report),createdAt:'2026-10-18T09:00:00Z'}]),hold:true});
 await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('button')?.disabled);
 assert.equal(await page.getByText('Opening your Daily Board…',{exact:true}).count(),1);
 await page.keyboard.press('Enter');assert.equal(h.count(),3,'pending retry cannot submit twice');
 h.release();
 await page.getByRole('heading',{name:report.title,exact:true}).waitFor();
 assert.equal(await page.getByRole('combobox',{name:'Report edition'}).evaluate(n=>n===document.activeElement),true);
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
 await h.page.waitForFunction(()=>document.querySelector('[aria-label="Report edition"]')||document.querySelector('#report')?.textContent==='Your briefing will appear here.');
 assert.equal(await h.page.getByRole('button',{name:'Try again',exact:true}).count(),0);
 assert.deepEqual(h.errors,[]);
});
