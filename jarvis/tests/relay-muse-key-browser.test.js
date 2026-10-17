import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,join} from 'node:path';
import {chromium} from 'playwright-core';
import {requireBrowser} from './helpers/ci-test-inventory.mjs';

// Fixed dummy bytes only: never generates/provisions a production credential.
test('mobile owner-only key helper: encoding, copy, clear, CSP and fail-closed crypto',async t=>{
 const root=resolve('public/muse-key'),config=JSON.parse(await readFile('public/staticwebapp.config.json','utf8'));
 const headers=config.routes.find(r=>r.route==='/muse-key*').headers;
 assert.match(headers['Content-Security-Policy'],/connect-src 'none'/);
 assert.match(headers['Content-Security-Policy'],/frame-ancestors 'none'/);
 assert.equal(headers['Cache-Control'],'no-store');
 const requested=[];
 const server=createServer(async(req,res)=>{
  requested.push({method:req.method,url:req.url});
  const name={'/muse-key/':'index.html','/muse-key/key.js':'key.js','/muse-key/key.css':'key.css'}[req.url];
  if(!name)return res.writeHead(404).end();
  res.writeHead(200,{...headers,'Content-Type':name.endsWith('.html')?'text/html':name.endsWith('.js')?'text/javascript':'text/css'});
  res.end(await readFile(join(root,name)));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:requireBrowser(),args:['--no-sandbox']});t.after(()=>browser.close());
 const dummy=Array.from({length:32},(_,i)=>i.toString(16).padStart(2,'0')).join('');
 const fingerprint=createHash('sha256').update(dummy,'utf8').digest('hex');
 for(const width of [320,390]){
  const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true});
  await context.addInitScript(()=>{
   window.dummyRandomCalls=0;window.dummyClipboard=[];window.blockCopy=false;
   Object.defineProperty(crypto,'getRandomValues',{value:bytes=>{window.dummyRandomCalls++;for(let i=0;i<bytes.length;i++)bytes[i]=i;return bytes;}});
   Object.defineProperty(navigator,'clipboard',{value:{writeText:async value=>{if(window.blockCopy)throw Error();window.dummyClipboard.push(value);}}});
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/muse-key/');
  assert.equal(await page.evaluate(()=>dummyRandomCalls),0);
  assert.equal(await page.locator('#private-key').inputValue(),'');
  const baseline=requested.length;
  await page.getByRole('button',{name:'Generate on this phone'}).tap();
  await page.getByRole('button',{name:'Copy private key',exact:true}).waitFor();
  await page.waitForFunction(()=>!document.getElementById('copy-key').disabled);
  assert.equal(await page.locator('#private-key').inputValue(),dummy);
  assert.equal(await page.locator('#fingerprint').inputValue(),fingerprint);
  assert.equal(await page.getByRole('button',{name:'Generate on this phone'}).isDisabled(),true);
  await page.getByRole('button',{name:'Copy private key',exact:true}).tap();
  await page.getByRole('button',{name:'Copy fingerprint',exact:true}).tap();
  assert.deepEqual(await page.evaluate(()=>dummyClipboard),[dummy,fingerprint]);
  assert.equal(await page.evaluate(()=>dummyRandomCalls),1);
  assert.deepEqual(await page.evaluate(()=>[localStorage.length,sessionStorage.length]),[0,0]);
  assert.equal(page.url(),origin+'/muse-key/');
  assert.equal(requested.length,baseline,'no request after key generation or copy');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const button of await page.getByRole('button').all())assert.ok((await button.boundingBox()).height>=48);
  if(process.env.JARVIS_SCREENSHOT_DIR){await mkdir(process.env.JARVIS_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:join(process.env.JARVIS_SCREENSHOT_DIR,`muse-key-dummy-${width}.png`),fullPage:true});}
  await page.evaluate(()=>{window.blockCopy=true;});
  await page.getByRole('button',{name:'Copy private key',exact:true}).tap();
  await page.getByText(/Copy was blocked/).waitFor();
  assert.equal(await page.locator('#private-key').evaluate(n=>n.selectionEnd-n.selectionStart),64);
  await page.getByRole('button',{name:'Clear',exact:true}).tap();
  assert.equal(await page.locator('#private-key').inputValue(),'');assert.equal(await page.locator('#fingerprint').inputValue(),'');
  assert.equal(await page.locator('#copy-key').isDisabled(),true);
  await page.getByRole('button',{name:'Generate on this phone'}).tap();
  await page.waitForFunction(()=>!document.getElementById('copy-key').disabled);
  await page.evaluate(()=>dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));
  assert.equal(await page.locator('#private-key').inputValue(),'');
  assert.deepEqual(errors,[]);await context.close();
 }
 // Missing WebCrypto must leave generation disabled, without fallback randomness.
 const unsupported=await browser.newContext();await unsupported.addInitScript(()=>Object.defineProperty(window,'crypto',{value:{}}));
 const page=await unsupported.newPage();await page.goto(origin+'/muse-key/');
 assert.equal(await page.locator('#generate').isDisabled(),true);await page.getByText(/Secure browser support is unavailable/).waitFor();await unsupported.close();
 // Clear during an outstanding digest must not resurrect either value.
 const delayed=await browser.newContext();await delayed.addInitScript(()=>{
  Object.defineProperty(crypto,'getRandomValues',{value:bytes=>bytes.fill(0)});
  Object.defineProperty(crypto.subtle,'digest',{value:()=>new Promise(resolve=>{window.finishDummyDigest=()=>resolve(new Uint8Array(32).buffer);})});
 });
 const pending=await delayed.newPage();await pending.goto(origin+'/muse-key/');await pending.locator('#generate').click();
 await pending.locator('#clear').click();await pending.evaluate(()=>finishDummyDigest());
 assert.equal(await pending.locator('#private-key').inputValue(),'');assert.equal(await pending.locator('#fingerprint').inputValue(),'');await delayed.close();
 assert.ok(requested.every(r=>r.method==='GET'&&['/muse-key/','/muse-key/key.js','/muse-key/key.css'].includes(r.url)));
});
