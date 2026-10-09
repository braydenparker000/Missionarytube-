import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {loadPublication,mimeFor,ROOT,POINTER,sha256} from './static-publication.mjs';
import {BROWSER_VERSION} from './install-jarvis-browser.mjs';

const SITE='https://missionarytube.z13.web.core.windows.net',API='https://jarvis-hub-api.braydenparker999.workers.dev';
export async function runPairRuntime({source,previousDirectory,candidateDirectory,schemaDirectory,chrome,publicationMode='pointer'}={}){
  const [previous,candidate]=await Promise.all([loadPublication(previousDirectory),loadPublication(candidateDirectory)]);
  const fromSource=path=>import(pathToFileURL(join(source,path)).href);
  const [{createRelayFixture},{Hub},{SHARED_OBJECT},{RELAY_OWNER,random},{COMMENTS_URL}]=await Promise.all([
    fromSource('tests/relay-fixture.js'),fromSource('backend/worker.js'),fromSource('backend/shared.js'),fromSource('backend/relay-common.js'),fromSource('backend/publications.js')]);
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async(input,init={})=>{
    const url=typeof input==='string'||input instanceof URL?String(input):input.url;
    if(new URL(url).origin+new URL(url).pathname!==COMMENTS_URL||(init.method||'GET')!=='GET')throw Error('Fixture egress refused');
    return Response.json([]);
  };
  const fixture=createRelayFixture({env:{RELAY_MCP_ORIGIN:API,RELAY_OWNER_ENABLED:'true'}}),object=fixture.object(SHARED_OBJECT),db=object.db;
  let browser,context;
  try{
    db.exec(await readFile(join(schemaDirectory,'live-schema.sql'),'utf8'));
    const now=Date.now(),token=random(),tokenHash=sha256(token),device=crypto.randomUUID(),grant=crypto.randomUUID();
    db.prepare('INSERT INTO relay_owner_sessions VALUES(?,?,?,?,?,?,?,?,?)').run(device,tokenHash,RELAY_OWNER,'Synthetic qualification device',now,now,now+86400000,null,grant);
    const ids=[];
    for(const [index,stage] of ['queued','running','waiting_for_owner','completed'].entries()){
      const id=crypto.randomUUID(),reply=stage==='completed'?crypto.randomUUID():null;ids.push(id);
      db.prepare('INSERT INTO relay_owner_entries(id,kind,body,created_at,principal,device_id,authentication_source) VALUES(?,?,?,?,?,?,?)').run(id,'user','SYNTHETIC_PRIVATE_REQUEST_'+stage,new Date(now).toISOString(),RELAY_OWNER,device,'owner-device-session');
      if(reply)db.prepare('INSERT INTO relay_owner_entries(id,kind,reply_to,body,created_at,principal,device_id,authentication_source) VALUES(?,?,?,?,?,?,?,?)').run(reply,'reply',id,'SYNTHETIC_IMMUTABLE_REPLY',new Date(now).toISOString(),RELAY_OWNER,device,'owner-oauth-mcp');
      db.prepare('INSERT INTO relay_owner_jobs(seq,id,request_id,principal,device_id,title,action_kind,specified,stage,created_ms,updated_ms,result_reply_id,root_job_id,attempt,outcome,lease_run_id,lease_grant_id,lease_expires_ms) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(index+1,id,id,RELAY_OWNER,device,'Synthetic '+stage+' request','read_only',1,stage,now,now,reply,id,1,stage==='completed'?'known':'not_started',stage==='running'?crypto.randomUUID():null,stage==='running'?grant:null,stage==='running'?now+120000:null);
    }
    for(const subscription of ['synthetic-public','synthetic-owner'])for(const [sequence,status] of [[1,'pending'],[2,'failed'],[3,'delivered']])db.prepare('INSERT INTO relay_outbox VALUES(?,?,?,?,?,?,?)').run(subscription,sequence,'synthetic outbox fixture',status,status==='failed'?6:1,now,'synthetic');
    db.prepare('INSERT INTO relay_delivery_receipts VALUES(?,?)').run(3,now);
    // Initialize the existing checked-in publication import before the saved
    // snapshot, then add one fictional immutable public request/reply pair.
    assert.equal((await fixture.request('/shared/state',{headers:{Origin:SITE}})).status,200);
    const publicRequest=crypto.randomUUID(),publicReply=crypto.randomUUID();
    db.prepare('INSERT INTO shared_entries(id,kind,body,created_at) VALUES(?,?,?,?)').run(publicRequest,'user','SYNTHETIC_PUBLIC_REQUEST',new Date(now).toISOString());
    db.prepare('INSERT INTO shared_entries(id,kind,reply_to,body,created_at) VALUES(?,?,?,?,?)').run(publicReply,'reply',publicRequest,'SYNTHETIC_PUBLIC_ACCEPTED_REPLY',new Date(now+1).toISOString());
    const preserved=()=>Object.fromEntries(['shared_entries','relay_owner_entries','relay_owner_jobs','relay_outbox','relay_delivery_receipts'].map(name=>[name,db.prepare('SELECT * FROM '+name+' ORDER BY rowid').all()]));
    const before=preserved();
    object.hub=new Hub(object.ctx,fixture.env);
    const headers={Origin:SITE,Authorization:'Bearer '+token};
    for(const path of ['/relay/owner/jobs','/relay/owner/messages','/relay/owner/jobs/detail?job_id='+ids[1]])assert.equal((await fixture.request(path,{headers})).status,200);
    assert.equal((await fixture.request('/relay/owner/jobs',{headers:{Origin:SITE}})).status,401);
    assert.equal((await fixture.request('/relay/owner/jobs',{headers:{...headers,Origin:'https://untrusted.example.test'}})).status,403);
    const publicResponse=await fixture.request('/shared/state',{headers:{Origin:SITE}});
    assert.equal(publicResponse.status,200);assert.ok(!(await publicResponse.text()).includes('SYNTHETIC_PRIVATE'));
    assert.deepEqual(preserved(),before,'Candidate runtime reads/restart must preserve pending work and immutable acceptance evidence');

    const {chromium}=createRequire(join(source,'package.json'))('playwright-core');
    browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run']});
    assert.equal(browser.version(),BROWSER_VERSION,'The actual-artifact compatibility fixture requires the qualified browser');
    context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,serviceWorkers:'block',offline:true});
    await context.addInitScript(({token,device})=>{
      localStorage.setItem('jarvis.relay.owner-session.v1',JSON.stringify({device_token:token,device_id:device}));
      localStorage.setItem('drawercast.sources.v1',JSON.stringify({local:false,drive:false,r2:false,server:false}));
      localStorage.setItem('jarvis.notes.v1','SYNTHETIC_STORAGE_SENTINEL');sessionStorage.setItem('jarvis.recovery.fixture','SYNTHETIC_SESSION_SENTINEL');
    },{token,device});
    const page=await context.newPage(),cdp=await context.newCDPSession(page),pending=new Set(),errors=[],requests=[];
    let selected=previous,unexpected=0;
    const staticBytes=path=>{
      if(path===POINTER)return Buffer.from(JSON.stringify(selected.plan.pointer)+'\n');
      for(const publication of [previous,candidate])if(path.startsWith(ROOT+publication.plan.releaseId+'/'))return publication.payload.get(path.slice((ROOT+publication.plan.releaseId+'/').length));
      if(publicationMode==='documents'&&path.endsWith('.html'))return selected.payload.get(path);
      return previous.canonical.get(path)??previous.payload.get(path);
    };
    await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
    async function bridge(event){
      const request=event.request,url=new URL(request.url);requests.push({origin:url.origin,path:url.pathname,method:request.method});
      const fulfill=async(status,type,bytes,headers={})=>cdp.send('Fetch.fulfillRequest',{requestId:event.requestId,responseCode:status,responseHeaders:Object.entries({'Content-Type':type,...headers}).map(([name,value])=>({name,value:String(value)})),body:Buffer.from(bytes).toString('base64')});
      try{
        if(url.origin===SITE){
          if(request.method!=='GET')throw Error();let path=url.pathname.slice(1);if(!path||path.endsWith('/'))path+='index.html';
          const bytes=staticBytes(path);if(!bytes&&path==='favicon.ico')return await fulfill(404,'text/plain','');if(!bytes)throw Error();return await fulfill(200,mimeFor(path),bytes);
        }
        if(url.origin===API&&(['GET','OPTIONS'].includes(request.method)||(request.method==='POST'&&url.pathname==='/relay/owner/delivery'))){
          let body=request.postData;
          if(request.hasPostData&&body===undefined){assert.ok(event.networkId);body=(await cdp.send('Network.getRequestPostData',{requestId:event.networkId})).postData;}
          const response=await fixture.request(url.pathname+url.search,{method:request.method,headers:request.headers,body:request.method==='POST'?body:undefined});
          return await fulfill(response.status,response.headers.get('Content-Type')||'application/octet-stream',await response.arrayBuffer(),Object.fromEntries(response.headers));
        }
        // Deterministic public catalog fixtures; no real provider is contacted.
        if(url.origin==='https://v3-cinemeta.strem.io'&&request.method==='GET')return await fulfill(200,'application/json',JSON.stringify(url.pathname.endsWith('/manifest.json')?{id:'synthetic.catalog',name:'Synthetic empty catalog',resources:['catalog','meta'],types:['movie','series'],catalogs:[]}:{metas:[],streams:[]}),{'Access-Control-Allow-Origin':SITE});
        throw Error();
      }catch{unexpected++;await cdp.send('Fetch.failRequest',{requestId:event.requestId,errorReason:'BlockedByClient'}).catch(()=>{});}
    }
    cdp.on('Fetch.requestPaused',event=>{const task=bridge(event);pending.add(task);task.finally(()=>pending.delete(task));});
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*',requestStage:'Request'}]});page.on('pageerror',()=>errors.push('page_error'));page.setDefaultTimeout(20000);
    for(const publication of [previous,candidate]){
      selected=publication;
      await page.goto(SITE+'/?qualification=1#home');await page.locator('#launcher-time').waitFor();
      assert.equal(new URL(page.url()).search,'?qualification=1');assert.equal(new URL(page.url()).hash,'#home');
      await page.goto(SITE+'/jarvis/');
      await page.getByRole('button',{name:'Conversation menu',exact:true}).click();
      await page.locator('.conversation-sheet .sheet-action').filter({hasText:/Owner chat/}).click();
      await page.locator('#relay-owner-message-text').waitFor();
      await page.getByText('SYNTHETIC_IMMUTABLE_REPLY',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Conversation menu',exact:true}).click();await page.locator('.conversation-sheet .sheet-action').filter({hasText:/Public chat/}).click();await page.locator('#message-text').waitFor();
      await page.getByText('SYNTHETIC_PUBLIC_ACCEPTED_REPLY',{exact:true}).waitFor();
      assert.ok(!(await page.locator('body').textContent()).includes('SYNTHETIC_PRIVATE_REQUEST'));
      // Poweramp owns and consumes its browser history entries. Exercise the
      // canonical app history on Home/Relay without overriding that behavior.
      await page.goBack();await page.locator('#launcher-time').waitFor();
      assert.equal(new URL(page.url()).pathname,'/');assert.equal(new URL(page.url()).search,'?qualification=1');assert.equal(new URL(page.url()).hash,'#home');
      await page.goForward();await page.locator('#message-text').waitFor();assert.equal(new URL(page.url()).pathname,'/jarvis/');
      await page.getByText('SYNTHETIC_PUBLIC_ACCEPTED_REPLY',{exact:true}).waitFor();
      await page.goto(SITE+'/drawercast/');await page.waitForFunction(()=>!!window.PA?.DriveSource?.helper&&!!window.PA?.R2Source?.helper&&typeof window.PA?.DriveSource?.catalog?.readCatalog==='function');
      assert.equal(await page.evaluate(()=>typeof PA.DriveSource.catalog.readCatalog), 'function');
      await page.goto(SITE+'/media/');await page.locator('#mobileNav button').first().waitFor();
      // Existing pages must keep loading their own lazy resources after a pointer
      // changes. Derive paths from the shipped application script, not the pointer.
      selected=publication===previous?candidate:previous;
      const lazy=await page.evaluate(async()=>{
        const app=[...document.scripts].find(script=>new URL(script.src||location.href).pathname.endsWith('/media/assets/js/app.js'));
        if(!app)throw Error();
        for(const name of ['compatibility.js','software-player.js']){
          const script=document.createElement('script');script.src=new URL('playback/'+name,app.src);
          await new Promise((done,fail)=>{script.onload=done;script.onerror=fail;document.head.append(script);});
        }
        const controller=new AbortController();controller.abort();let cancelled=false;
        try{await AstraSoftware.prepare({signal:controller.signal});}catch(error){cancelled=error.name==='AbortError';}
        const decoder=new URL('playback/libmedia/decode/pcm-simd.wasm',app.src),response=await fetch(decoder);
        if(response.headers.get('Content-Type')!=='application/wasm')throw Error();
        const module=await WebAssembly.compile(await response.arrayBuffer());
        return {compatibility:typeof AstraCompatibility.createAdapter,software:typeof AVPlayer,cancelled,decoder:module instanceof WebAssembly.Module};
      });
      assert.deepEqual(lazy,{compatibility:'function',software:'function',cancelled:true,decoder:true});selected=publication;
      assert.equal(await page.evaluate(()=>localStorage.getItem('jarvis.notes.v1')),'SYNTHETIC_STORAGE_SENTINEL');
      assert.equal(await page.evaluate(()=>sessionStorage.getItem('jarvis.recovery.fixture')),'SYNTHETIC_SESSION_SENTINEL');
      const csp=await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');assert.equal(csp,publication.plan.policies['media/index.html']);
    }
    await context.close();context=null;await Promise.allSettled([...pending]);
    assert.equal(unexpected,0,'Every browser request must be fulfilled by an explicit local fixture');assert.deepEqual(errors,[]);
    assert.deepEqual(preserved(),before,'Old and new browser reads must preserve pending rows, leases, replies and receipts');
    assert.ok(requests.length>0&&requests.length<=500);
    for(const publication of [previous,candidate])for(const path of ['drawercast/drive-api.js','drawercast/r2-library.js','media/assets/js/playback/compatibility.js','media/assets/js/playback/software-player.js','media/assets/js/playback/libmedia/avplayer.js','media/assets/js/playback/libmedia/decode/pcm-simd.wasm'])assert.ok(requests.some(r=>r.path===publication.plan.prefix+path),'Actual immutable lazy module and decoder must load');
    return {pendingRowsPreserved:4,runningLeasePreserved:true,immutableReplyPreserved:true,deliveryReceiptsPreserved:true,previousFrontendRendered:true,privatePublicBoundaryPreserved:true,unexpectedNetworkRequests:0,productionOperations:0,browserRequests:requests.length};
  }finally{await context?.close();await browser?.close();fixture.close();globalThis.fetch=originalFetch;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    const [source,previousDirectory,candidateDirectory,schemaDirectory,report,publicationMode]=process.argv.slice(2);
    if(![source,previousDirectory,candidateDirectory,schemaDirectory,report].every(Boolean)||!process.env.JARVIS_CHROME)throw Error();
    const result=await runPairRuntime({source:resolve(source),previousDirectory:resolve(previousDirectory),candidateDirectory:resolve(candidateDirectory),schemaDirectory:resolve(schemaDirectory),chrome:process.env.JARVIS_CHROME,publicationMode});
    await writeFile(resolve(report),JSON.stringify(result)+'\n',{mode:0o600});
  }catch{console.error('Exact-artifact isolated runtime compatibility failed.');process.exitCode=1;}
}
