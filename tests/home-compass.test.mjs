import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {extname,resolve,sep} from 'node:path';
import {chromium} from 'playwright-core';
import {directionOf,FLICK} from '../frontend/assets/compass.js';
import {apps,verbs,systemApps,DIRECTIONS,DEFAULT_COMPASS,loadPreferences} from '../frontend/assets/hub.js';

test('a flick picks one of eight directions, clockwise from up, and nothing near the touch point',()=>{
 assert.equal(directionOf(0,-FLICK),0);
 assert.equal(directionOf(40,-40),1);
 assert.equal(directionOf(50,3),2);
 assert.equal(directionOf(30,30),3);
 assert.equal(directionOf(-2,60),4);
 assert.equal(directionOf(-30,30),5);
 assert.equal(directionOf(-50,0),6);
 assert.equal(directionOf(-30,-30),7);
 assert.equal(directionOf(-10,-80),0,'a little off vertical still reads as up');
 assert.equal(directionOf(10,10),-1);
 assert.equal(directionOf(FLICK-1,0),-1);
});

test('every app is under exactly one verb or the system row; the compass has eight known apps',()=>{
 const listed=[...verbs.flatMap(v=>v.apps),...systemApps];
 assert.deepEqual([...listed].sort(),apps.map(a=>a.id).sort());
 assert.equal(DIRECTIONS.length,8);assert.equal(DEFAULT_COMPASS.length,8);
 assert.ok(DEFAULT_COMPASS.every(id=>apps.some(a=>a.id===id)));
});

test('saved compass slots survive, and unknown or missing ones fall back per slot',()=>{
 const saved=new Map(),previous=globalThis.localStorage;
 globalThis.localStorage={getItem:k=>saved.get(k)??null};
 try{
  assert.deepEqual(loadPreferences(),{favorites:['jarvis','poweramp'],compass:DEFAULT_COMPASS});
  saved.set('jarvis.preferences.v1',JSON.stringify({favorites:['guitar'],compass:['muse','drawercast','gone','notes','media','guitar','board','tools']}));
  assert.deepEqual(loadPreferences(),{favorites:['guitar'],compass:['muse','poweramp','board','notes','media','guitar','board','tools']});
  saved.set('jarvis.preferences.v1',JSON.stringify({favorites:['guitar'],compass:['muse']}));
  assert.deepEqual(loadPreferences().compass,DEFAULT_COMPASS,'a short list is not trusted slot by slot');
  saved.set('jarvis.preferences.v1','{');
  assert.deepEqual(loadPreferences().compass,DEFAULT_COMPASS);
 }finally{if(previous===undefined)delete globalThis.localStorage;else globalThis.localStorage=previous;}
});

const chrome=[process.env.JARVIS_CHROME,process.env.CHROME_PATH,'/usr/bin/google-chrome','/usr/bin/chromium'].find(p=>p&&existsSync(p));
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'};

test('Home: flick to open, cancel by returning, tap still works, and the verbs list switches back',{skip:!chrome&&'Set JARVIS_CHROME to run the browser check',timeout:60000},async t=>{
 const root=resolve('frontend');
 const server=createServer(async(req,res)=>{
  try{
   const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
   let file=resolve(root,'.'+path);
   if(!file.startsWith(root+sep)&&file!==root)throw Error();
   if((await stat(file)).isDirectory())file+='/index.html';
   res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(done=>server.listen(0,'127.0.0.1',done));
 t.after(()=>new Promise(done=>{server.closeAllConnections();server.close(done);}));
 const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
 t.after(()=>browser.close());
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 const page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 // Home works offline: every request off this server fails.
 const origin=`http://127.0.0.1:${server.address().port}`;
 await page.route(url=>!url.toString().startsWith(origin),route=>route.abort());
 const cdp=await context.newCDPSession(page);
 const touch=(type,x,y)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints:type==='touchEnd'?[]:[{x,y,id:1}]});
 const flick=async(x,y,dx,dy,{release=true}={})=>{
  await touch('touchStart',x,y);
  for(let i=1;i<=5;i++)await touch('touchMove',x+dx*i/5,y+dy*i/5);
  if(release)await touch('touchEnd');
 };

 await page.goto(origin+'/');await page.locator('body.launcher-page #app-directory #compass-rose').waitFor();
 assert.deepEqual(await page.locator('.compass-app .compass-name').allTextContents(),DEFAULT_COMPASS.map(id=>apps.find(a=>a.id===id).name));

 // Up-right from the clock previews Poweramp; back to the touch point cancels.
 await flick(120,200,60,-60,{release:false});
 assert.equal(await page.locator('#compass-rose').getAttribute('data-active'),'1');
 assert.equal(await page.locator('#compass-hint').textContent(),'Let go to open Poweramp');
 await touch('touchMove',121,199);await touch('touchEnd');
 assert.equal(await page.locator('#compass-rose').getAttribute('data-active'),null);
 assert.equal(new URL(page.url()).pathname,'/');

 // A flick that starts on Chats opens what it points at, not Chats.
 const chats=await page.locator('.compass-app[data-dir="0"]').boundingBox();
 await Promise.all([page.waitForURL(origin+'/daily-board/'),flick(chats.x+chats.width/2,chats.y+chats.height/2,70,0)]);

 await page.goto(origin+'/');await page.locator('#compass-rose').waitFor();
 // Let the freshly loaded launcher settle first: on a busy CI runner a tap in the
 // same instant the page appears can miss, which no person's tap would do.
 await page.waitForLoadState('networkidle');
 await Promise.all([page.waitForURL(origin+'/podcasts/'),page.locator('.compass-app[data-dir="3"]').tap()]);

 // The fallback: every app by verb, one open at a time, a finder, and back to the compass.
 await page.goto(origin+'/');await page.locator('#home-verbs').tap();
 await page.waitForURL(origin+'/#apps');await page.locator('.verbs-home').waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement.id),'home-compass');
 await page.locator('button.verb-word[data-verb="talk"]').tap();
 assert.deepEqual(await page.locator('#verb-talk .verb-app strong').allTextContents(),['Chats','Muse','Quick AI']);
 await page.locator('button.verb-word[data-verb="listen"]').tap();
 assert.equal(await page.locator('#verb-talk').isHidden(),true);
 assert.equal(await page.locator('button.verb-word[data-verb="listen"]').getAttribute('aria-expanded'),'true');
 await page.locator('#app-search').fill('guit');
 assert.deepEqual(await page.locator('#verb-results .verb-app strong').allTextContents(),['Guitar']);
 await page.locator('#app-search').fill('');
 await page.goBack();await page.locator('#compass-rose').waitFor();
 assert.equal(new URL(page.url()).hash,'');

 // Directions are the owner's to choose, and stay chosen.
 await page.locator('#home-verbs').tap();await page.locator('#edit-compass').tap();
 await page.locator('#compass-form select').nth(5).selectOption('muse');
 await page.locator('#compass-form .primary').tap();
 await page.locator('#home-compass').tap();await page.locator('#compass-rose').waitFor();
 assert.equal(await page.locator('.compass-app[data-dir="5"] .compass-name').textContent(),'Muse');
 await page.reload();await page.locator('#compass-rose').waitFor();
 assert.equal(await page.locator('.compass-app[data-dir="5"] .compass-name').textContent(),'Muse');

 // Nothing scrolls or overflows on a small phone.
 await page.setViewportSize({width:360,height:640});
 assert.deepEqual(await page.evaluate(()=>[document.documentElement.scrollWidth<=innerWidth,document.documentElement.scrollHeight<=innerHeight]),[true,true]);
 assert.deepEqual(errors,[]);
});
