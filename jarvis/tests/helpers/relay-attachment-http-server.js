import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConversationFixture,launchQualifiedBrowser,SITE,OWNER_KEY} from './relay-conversation-browser-fixture.js';
const root=resolve(fileURLToPath(new URL('../../public/',import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2'};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
// Real HTTP sockets carry browser uploads. The proxy maps its loopback origin to
// the approved synthetic SITE before invoking the real Worker/SQLite fixture.
// Only API_ORIGIN is rewritten in the served config. This is not live CORS, TLS,
// identity-provider, production traffic, or a mock acceptance/message service.
export async function createAttachmentHttpJourney(t,{width=390,height=844}={}){
 const browser=await launchQualifiedBrowser(t);if(!browser)return;
 const h=createConversationFixture(t),owner=await h.pair(await h.oauth());
 const capability=await (await h.phone('/session',undefined,owner.device_token)).json();
 if(capability.attachments_enabled!==true){await browser.close();h.close();assert.fail('Companion backend must advertise real attachment capability');}
 const gates=[],records=[],errors=[],tasks=new Set(),sockets=new Set();let origin;
 const config=JSON.parse(await readFile(resolve(root,'staticwebapp.config.json'),'utf8'));
 const policy=config.routes.find(route=>route.route==='/jarvis*').headers['Content-Security-Policy'];
 function hold(match,{phase='after'}={}){
  const entered=deferred(),release=deferred(),done=deferred(),closed=deferred();
  const gate={match,phase,used:false,entered:entered.promise,closed:closed.promise,done:done.promise,release:action=>release.resolve(action||'deliver'),_entered:entered.resolve,_release:release.promise,_done:done.resolve,_closed:closed.resolve};gates.push(gate);return gate;
 }
 async function handle(req,res){
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/relay/')||url.pathname.startsWith('/shared/')){
   assert.equal(req.headers.origin===undefined||req.headers.origin===origin,true,'Only the loopback test page may call this proxy');
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;assert.ok(size<=1500000,'Bound fixture request bytes');chunks.push(chunk);}
   const body=Buffer.concat(chunks).toString(),record={method:req.method,path:url.pathname,body,disconnected:false,status:null,delivered:false,lateResponse:false};records.push(record);
   const gate=gates.find(g=>!g.used&&g.match(record));if(gate)gate.used=true;
   res.on('close',()=>{record.disconnected=!res.writableEnded;gate?._closed(record);});
   const forward=()=>h.fixture.request(url.pathname+url.search,{method:req.method,headers:{Origin:SITE,...(req.headers.authorization?{Authorization:req.headers.authorization}:{}),...(body?{'Content-Type':req.headers['content-type']||'application/json'}:{})},...(['GET','HEAD'].includes(req.method)?{}:{body})});
   let response,action='deliver';
   if(gate?.phase==='before'){gate._entered(record);action=await gate._release;}
   response=await forward();record.status=response.status;const bytes=Buffer.from(await response.arrayBuffer());
   if(gate?.phase==='after'){gate._entered(record);action=await gate._release;}
   if(action==='drop'){res.destroy();gate?._done(record);return;}
   if(action==='truncate'&&!res.destroyed){record.truncated=true;res.writeHead(response.status,{...Object.fromEntries(response.headers),'Content-Length':bytes.length,'Connection':'close'});res.end(bytes.subarray(0,Math.min(12,bytes.length-1)));gate?._done(record);return;}
   if(res.destroyed){record.lateResponse=true;gate?._done(record);return;}
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(bytes);record.delivered=true;gate?._done(record);return;
  }
  assert.equal(req.method,'GET','Static source is read-only');let pathname=decodeURIComponent(url.pathname);if(pathname.endsWith('/'))pathname+='index.html';const path=resolve(root,'.'+pathname);assert.ok(path.startsWith(root+sep));
  let bytes;try{bytes=await readFile(path);}catch(error){if(error.code==='ENOENT'){res.writeHead(404);res.end();return;}throw error;}
  if(pathname==='/assets/config.js')bytes=Buffer.from(bytes.toString().replace("'https://jarvis-hub-api.braydenparker999.workers.dev'",JSON.stringify(origin)));
  res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store',...(pathname==='/jarvis/index.html'?{'Content-Security-Policy':policy}:{})});res.end(bytes);
 }
 const server=createServer((req,res)=>{const task=handle(req,res).catch(error=>{errors.push(error.message);if(!res.destroyed){res.writeHead(500);res.end('Fixture error');}});tasks.add(task);task.finally(()=>tasks.delete(task));});
 server.keepAliveTimeout=60000; // Keep the pinned-browser replay scenario on a reused HTTP connection.
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 const context=await browser.newContext({viewport:{width,height},isMobile:true,hasTouch:true,serviceWorkers:'block'}),page=await context.newPage(),unexpected=[],pageErrors=[],failures=[],network=new Map(),cancellations=[];
 page.setDefaultTimeout(10000);
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin)return route.continue();unexpected.push(url.href);return route.abort('blockedbyclient');});
 await page.addInitScript(({key,owner})=>{localStorage.setItem(key,JSON.stringify({device_token:owner.device_token,device_id:owner.device.id}));},{key:OWNER_KEY,owner});
 page.on('pageerror',error=>pageErrors.push(error.message));page.on('requestfailed',request=>failures.push({method:request.method(),url:request.url(),body:request.postData(),error:request.failure()?.errorText}));
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');cdp.on('Network.requestWillBeSent',event=>network.set(event.requestId,event.request));cdp.on('Network.loadingFailed',event=>{if(event.canceled)cancellations.push({...event,request:network.get(event.requestId)});});
 t.after(async()=>{for(const gate of gates)gate.release('deliver');await context.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));await Promise.allSettled([...tasks]);await browser.close();h.close();});
 await page.goto(origin+'/jarvis/');await page.locator('#relay-owner-message-text').waitFor();
 return {h,owner,page,context,origin,hold,records,failures,cancellations,assertContained(){assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.deepEqual(pageErrors,[]);for(const failed of failures){assert.ok(records.some(record=>record.method===failed.method&&record.path===new URL(failed.url).pathname&&(record.body||undefined)===failed.body&&(record.disconnected||record.truncated)),'Only controlled HTTP disconnects may fail: '+failed.url);}}};
}
export async function chooseAttachment(page,file){await page.locator('#relay-compose-menu').click();const dialog=page.getByRole('dialog',{name:'Attachments',exact:true});await dialog.getByLabel('Choose files',{exact:true}).setInputFiles(file);await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});}
export async function waitForValue(get,predicate=Boolean){const end=Date.now()+10000;for(;;){const value=get();if(predicate(value))return value;if(Date.now()>end)assert.fail('Timed out waiting for fixture state');await new Promise(resolve=>setTimeout(resolve,10));}}
