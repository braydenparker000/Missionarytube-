import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {chromium} from 'playwright-core';
import {buildPublication,sha256,mimeFor,POINTER,ROOT} from '../scripts/static-publication.mjs';

const loader=await readFile(new URL('../scripts/static-release-loader.js',import.meta.url));
function release(name){
  const policy="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'";
  const doc=Buffer.from('<!doctype html><html lang="en"><head><meta http-equiv="Content-Security-Policy" content="'+policy+'"><title>'+name+'</title><link rel="stylesheet" href="style.css"><script type="module" src="app.js"></script></head><body><h1>'+name+'</h1><a href="/">Home</a></body></html>');
  const script=Buffer.from('document.body.dataset.loaded="'+name+'";try{eval("window.badEvaluation=true");window.cspBlocked=false;}catch{window.cspBlocked=true;}');
  return buildPublication(new Map([['index.html',doc],['podcasts/index.html',doc],['style.css',Buffer.from('h1{color:rgb(10,20,30)}')],['podcasts/style.css',Buffer.from('h1{color:rgb(10,20,30)}')],['app.js',script],['podcasts/app.js',script]]),{proof:{digest:sha256(name)},recipe:sha256('browser-recipe'),loader});
}
test('mobile canonical loader renders one hashed immutable document, preserves URL/CSP/storage and fails closed',async()=>{
  const old=release('old'),next=release('candidate'),blobs=new Map(old.canonical),requests=[];
  for(const pub of [old,next])for(const [path,bytes] of pub.payload)blobs.set(ROOT+pub.plan.releaseId+'/'+path,bytes);
  blobs.set(POINTER,Buffer.from(JSON.stringify(old.plan.pointer)));
  const server=createServer((req,res)=>{
    let path=new URL(req.url,'http://localhost').pathname.slice(1);if(!path||path.endsWith('/'))path+='index.html';requests.push(path);
    const bytes=blobs.get(path);if(!bytes){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mimeFor(path),'Cache-Control':'no-cache'});res.end(bytes);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    const executable=process.env.JARVIS_CHROME||execFileSync('sh',['-c','command -v google-chrome || command -v chromium'],{encoding:'utf8'}).trim();
    browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox']});
    const context=await browser.newContext({viewport:{width:412,height:915},isMobile:true,hasTouch:true});
    const origin='http://127.0.0.1:'+server.address().port,page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(origin+'/podcasts/?keep=1#library');await page.waitForFunction(()=>document.body.dataset.loaded==='old');
    assert.equal(new URL(page.url()).pathname,'/podcasts/');assert.equal(new URL(page.url()).search,'?keep=1');assert.equal(new URL(page.url()).hash,'#library');
    assert.equal(await page.locator('h1').evaluate(e=>getComputedStyle(e).color),'rgb(10, 20, 30)');
    await page.evaluate(()=>{localStorage.setItem('jarvis.notes.v1','fixture');sessionStorage.setItem('jarvis.owner.session.v1','fixture');});
    blobs.set(POINTER,Buffer.from(JSON.stringify(next.plan.pointer)));requests.length=0;
    await page.reload();await page.waitForFunction(()=>document.body.dataset.loaded==='candidate');
    assert.ok(requests.includes(ROOT+next.plan.releaseId+'/podcasts/app.js'));assert.ok(!requests.includes('podcasts/app.js'));
    assert.equal(await page.evaluate(()=>localStorage.getItem('jarvis.notes.v1')),'fixture');assert.equal(await page.evaluate(()=>sessionStorage.getItem('jarvis.owner.session.v1')),'fixture');
    assert.equal(await page.evaluate(()=>window.cspBlocked),true,'existing CSP must still prohibit eval in a shipped script');
    assert.deepEqual(errors,[]);
    // A page that read the old pointer before promotion must finish with old
    // bytes/resources even if another navigation selects the new release.
    blobs.set(POINTER,Buffer.from(JSON.stringify(old.plan.pointer)));
    let resume;const gate=new Promise(resolve=>{resume=resolve;});let observed;const seen=new Promise(resolve=>{observed=resolve;});
    await page.route('**/'+ROOT+old.plan.releaseId+'/podcasts/index.html',async route=>{observed();await gate;await route.continue();});
    const navigation=page.reload();await seen;blobs.set(POINTER,Buffer.from(JSON.stringify(next.plan.pointer)));resume();await navigation;await page.waitForFunction(()=>document.body.dataset.loaded==='old');
    await page.unrouteAll();
    // Wrong HTML bytes must never execute. There is no fallback to mutable assets.
    blobs.set(ROOT+next.plan.releaseId+'/podcasts/index.html',Buffer.from('<script>window.privateLeak=true</script>'));
    await page.reload();await page.getByText('Jarvis could not open. Please reload to try again.').waitFor();
    assert.equal(await page.evaluate(()=>window.privateLeak),undefined);
    blobs.set(POINTER,Buffer.from(JSON.stringify({...next.plan.pointer,prefix:'https://untrusted.invalid/'})));
    await page.reload();await page.getByText('Jarvis could not open. Please reload to try again.').waitFor();
    assert.ok(!requests.some(path=>path.includes('untrusted')));
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
test('a fresh podcast service-worker install keeps its application shell and ranged offline audio after cutover',async()=>{
  const sw=await readFile(new URL('../.jarvis-source/public/podcasts/sw.js',import.meta.url));
  const policy="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'";
  const podcast=Buffer.from('<!doctype html><head><meta http-equiv="Content-Security-Policy" content="'+policy+'"><link rel="stylesheet" href="/podcasts/style.css?v=20261004"><script type="module" src="/podcasts/app.js?v=20261004"></script></head><body><h1>Offline fixture</h1></body>');
  const input=new Map([['index.html',podcast],['podcasts/index.html',podcast],['podcasts/sw.js',sw],['podcasts/app.js',Buffer.from("import {value} from './core.js';document.body.dataset.loaded=value;navigator.serviceWorker.register('/podcasts/sw.js',{scope:'/podcasts/',type:'module'});")],['podcasts/core.js',Buffer.from("export const value='offline-fixture';")],['podcasts/style.css',Buffer.from('h1{color:rgb(10,20,30)}')],['assets/config.js',Buffer.from('export const API_ORIGIN="";')],['assets/shell.css',Buffer.from('body{margin:0}')],['assets/premium.css',Buffer.from('body{background:black}')]]);
  const pub=buildPublication(input,{proof:{digest:sha256('fresh-offline')},recipe:sha256('offline-recipe'),loader}),blobs=new Map([...input,...pub.canonical]);
  for(const [path,bytes] of pub.payload)blobs.set(ROOT+pub.plan.releaseId+'/'+path,bytes);blobs.set(POINTER,Buffer.from(JSON.stringify(pub.plan.pointer)));
  const server=createServer((req,res)=>{let path=new URL(req.url,'http://localhost').pathname.slice(1);if(!path||path.endsWith('/'))path+='index.html';const bytes=blobs.get(path);if(!bytes){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':mimeFor(path),'Cache-Control':'no-cache'});res.end(bytes);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));let browser;
  try{
    const executable=process.env.JARVIS_CHROME||execFileSync('sh',['-c','command -v google-chrome || command -v chromium'],{encoding:'utf8'}).trim();
    browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox']});const context=await browser.newContext(),page=await context.newPage(),origin='http://127.0.0.1:'+server.address().port;
    await page.goto(origin+'/podcasts/');await page.waitForFunction(()=>document.body.dataset.loaded==='offline-fixture');await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await page.evaluate(async()=>{const cache=await caches.open('jarvis-podcast-audio-v1');await cache.put('/podcasts/offline/synthetic',new Response(new Uint8Array([1,2,3,4,5]),{headers:{'Content-Type':'audio/mpeg'}}));});
    await context.setOffline(true);await page.reload();await page.waitForFunction(()=>document.body.dataset.loaded==='offline-fixture');
    const range=await page.evaluate(async()=>{const r=await fetch('/podcasts/offline/synthetic',{headers:{Range:'bytes=1-3'}});return {status:r.status,range:r.headers.get('Content-Range'),bytes:[...new Uint8Array(await r.arrayBuffer())]};});
    assert.deepEqual(range,{status:206,range:'bytes 1-3/5',bytes:[2,3,4]});assert.equal(await page.locator('h1').textContent(),'Offline fixture');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
});
