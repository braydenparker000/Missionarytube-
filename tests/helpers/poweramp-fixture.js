import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const defaultRoot=fileURLToPath(new URL('../../public/',import.meta.url));
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2'};
export const sourceFlags={local:false,drive:false,r2:false,server:false};
export const mobileContext={viewport:{width:393,height:852},isMobile:true,hasTouch:true};

// Read-only, bounded evidence for real Chromium failures. Record targets and
// ownership, never app text or any synthetic replacement input events.
export function installFixtureInputTrace(){
  const captures=new Map(),records=new WeakMap();
  const label=n=>n?((n.tagName||'').toLowerCase()+(n.id?'#'+n.id:'')+(n.classList?.length?'.'+Array.from(n.classList).slice(0,3).join('.'):'')+(n.dataset?.act?'[data-act='+n.dataset.act+']':'')):null;
  const owner=pointer=>({screen:window.PA?.Nav.cur,captureOwner:captures.get(pointer)||null,gesture:typeof InputLifecycle!=='undefined'?label(InputLifecycle.gesture?.node):null,
    phase:typeof ScreenDrag!=='undefined'?ScreenDrag.phase:null,shared:!!document.querySelector('.player-scene-input'),history:!!window.PA?.LibraryPageMotion.state,scrubbing:!!window.PA?.UI.seekDragging,sheet:window.PA?.Sheets?.open||null});
  window.fixtureInputTrace=[];
  for(const type of ['pointerdown','pointermove','pointerup','pointercancel','gotpointercapture','lostpointercapture','touchstart','touchmove','touchend','touchcancel','click']){
    document.addEventListener(type,e=>{
      const p=e.touches?.[0]||e.changedTouches?.[0]||e,record={type,target:label(e.target),miniTitle:!!e.target.closest?.('#mini-title'),trusted:e.isTrusted,pointer:e.pointerId,pointerType:e.pointerType||(e.touches?'touch':null),x:p.clientX,y:p.clientY,at_ms:performance.now(),observation:'capture',before:owner(e.pointerId)};
      if(type==='gotpointercapture')captures.set(e.pointerId,label(e.target));
      if(type==='lostpointercapture'&&captures.get(e.pointerId)===label(e.target))captures.delete(e.pointerId);
      records.set(e,record);fixtureInputTrace.push(record);if(fixtureInputTrace.length>80)fixtureInputTrace.shift();
    },{capture:true,passive:true});
    // Native Chromium events run microtask checkpoints between listeners. A
    // capture-listener microtask therefore cannot observe the target owner's
    // completed work. Read it at document bubble; stopped events stay marked
    // capture-only instead of claiming an unobserved final state.
    document.addEventListener(type,e=>{const record=records.get(e);if(record){record.prevented=e.defaultPrevented;record.after=owner(e.pointerId);record.after_ms=performance.now();record.observation='bubble';}},{passive:true});
  }
}

export async function reportFixtureFailure(h,error,name){
  let evidence;
  try{evidence={test:name,error:String(error),...await h.diagnostics()};}
  catch(diagnosticError){evidence={test:name,error:String(error),diagnosticError:String(diagnosticError)};}
  console.error('POWERAMP_BROWSER_FAILURE '+JSON.stringify(evidence));
  if(process.env.POWERAMP_EVIDENCE_DIR){
    const directory=resolve(process.env.POWERAMP_EVIDENCE_DIR),filename=String(name).toLowerCase().replace(/[^a-z0-9]+/g,'-').slice(0,120);
    try{
      await mkdir(directory,{recursive:true});await writeFile(join(directory,filename+'.json'),JSON.stringify(evidence,null,2)+'\n');
      // Only this isolated, generated fixture is captured. A single viewport
      // per failed contract keeps CI artifacts bounded and preserves animation.
      if(h.page)await h.page.screenshot({path:join(directory,filename+'.png'),fullPage:false,animations:'allow',timeout:5000});
    }catch(artifactError){console.error('POWERAMP_BROWSER_EVIDENCE_ERROR '+JSON.stringify({test:name,error:String(artifactError)}));}
  }
}

export function fixtureSceneSettled(screen){
  const current=document.querySelector('#sc-'+screen);
  return PA.Nav.cur===screen&&current&&!current.hidden&&!current.inert&&!current.dataset.scene&&!document.querySelector('.player-scene-input')&&!PA.LibraryPageMotion.state&&!PA.LibraryPageMotion.finish;
}

// All names, covers, and audio in this fixture are generated test material.
export function fixtureWav(index=0){
  const rate=8000,seconds=180,samples=rate*seconds,b=Buffer.alloc(44+samples*2);
  b.write('RIFF');b.writeUInt32LE(36+samples*2,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);
  b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*2,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(samples*2,40);
  for(let i=0;i<samples;i++){const envelope=Math.min(1,(i%rate)/400,(rate-i%rate)/400);b.writeInt16LE(Math.round(Math.sin(i/rate*2*Math.PI*(220+index%8*27.5))*650*envelope),44+i*2);}
  return b;
}
export function fixtureCover(index=0){
  const colors=['#cb6434','#298b9d','#7850ab','#638646','#b13d68','#4b71ab'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><rect width="400" height="400" fill="${colors[index%colors.length]}"/><circle cx="${100+index%3*70}" cy="175" r="120" fill="#fff" opacity=".15"/><path d="M0 270 L150 170 L400 300 V400 H0" fill="#111" opacity=".25"/><text x="30" y="325" fill="#fff" font-size="28" font-family="sans-serif">NIGHT SIGNAL ${index+1}</text><text x="30" y="365" fill="#fff" font-size="15" font-family="sans-serif">ISOLATED PLAYABLE FIXTURE</text></svg>`;
}

// This function is serializable through Playwright evaluate and the preview server.
export async function installPowerampFixture({origin,count=24,art=true,preview=false}){
  const {LIB,SET,SourceLibrary,Engine,R2Source,UI,Views,NativeSettings,Playlists,PlaybackQueue}=window.PA;
  R2Source.suspend();SourceLibrary.flags={local:false,drive:false,r2:true,server:false};
  const artists=['Mira Vale','The Lantern District','Juniper Static','Noah Ember','Glass Harbour','Selene North'];
  const albums=['Night Signals','Paper Satellites','Soft Geometry','After the Rain','Blue Hour Maps','Quiet Radiance'];
  const titles=['Open Windows','Signal Bloom','Streetlight Waltz','Silver Current','Midnight Orchard','Letters in Motion','Northern Air','Warm Glass'];
  const tracks=Array.from({length:count},(_,i)=>({id:'r2_fixture_'+i,source:'r2',remote:true,remoteId:'fixture_'+i,
    title:count>100?String.fromCharCode(65+Math.floor(i*26/count))+' '+titles[i%titles.length]+' '+String(i).padStart(5,'0'):titles[i%titles.length]+(i>=8?' '+(Math.floor(i/8)+1):''),
    artist:artists[Math.floor(i/4)%artists.length],album:albums[Math.floor(i/4)%albums.length],albumArtist:artists[Math.floor(i/4)%artists.length],genre:i%2?'Indie electronic':'Ambient pop',year:2024+i%3,
    path:'Fixture/'+albums[Math.floor(i/4)%albums.length]+'/'+i+'.wav',ext:'wav',dur:180,size:2880044,track:i%4+1,rating:0,added:i,plays:0,
    ...(art?{coverURL:origin+'/__fixture__/cover/'+i%6+'.svg'}:{})}));
  LIB.ids=tracks.map(t=>t.id);LIB.map=new Map(tracks.map(t=>[t.id,t]));
  R2Source.fileFor=t=>({__remoteURL:origin+'/__fixture__/audio/'+(Number(t.remoteId.split('_').at(-1))%8)+'.wav',name:'fixture.wav',size:2880044,type:'audio/wav'});
  Engine.els.forEach(a=>{a.pause();a.removeAttribute('src');a.load();});
  Engine.queue=tracks;Engine.order=tracks.map((_,i)=>i);Engine.pos=0;Engine.current=tracks[0];Engine.dur=180;Engine.playing=false;
  Engine._playRequest=(Engine._playRequest||0)+1;Engine._loadingRequest=null;Engine._pendingSeek=null;Engine._resumePosition=null;
  SET.animations='normal';SET.listZoom={files:3};SET.keepQueue=true;SET.seekStyle='wave';SET.previousRestarts=true;SET.swipeToChange=true;SET.playerButtons=['viz','queue','lyrics','repeat','shuffle'];
  PlaybackQueue.pending=preview?tracks.slice(8,11).map(t=>t.id):[];PlaybackQueue.active=false;PlaybackQueue.resume=null;PlaybackQueue.forced=false;
  Playlists.data=[{id:'fixture-evening',name:'Evening Walk',ids:tracks.slice(0,8).map(t=>t.id)},{id:'fixture-focus',name:'Late-Night Focus',ids:tracks.slice(8,16).map(t=>t.id)}];
  NativeSettings.apply();await UI.renderNowPlaying(Engine.current);UI.renderPlayState();Views.renderLibrary();UI.renderProgress();
  window.powerampFixture={count,tracks,ready:true};
}

// The source deliberately overlaps configuration with boot. Fixtures must wait
// for the actual boot promise before replacing library/transport state.
export function instrumentFixtureBoot(source){
  const startup="if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);\nelse boot();";
  if(!source.includes(startup))throw Error('Unknown Poweramp boot entrypoint');
  return source.replace(startup,"const fixtureBoot=()=>window.__powerampBootPromise=boot();\nif(document.readyState==='loading') document.addEventListener('DOMContentLoaded',fixtureBoot);\nelse fixtureBoot();");
}

export async function servePowerampFixture({root=process.env.POWERAMP_PUBLIC_ROOT||defaultRoot}={}){
  root=resolve(root);const audio=new Map(),requests={audio:0,covers:0,paths:[]};
  const server=createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),pathname=url.pathname;requests.paths.push(pathname);
      if(pathname==='/assets/r2-config.json'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({manifestURL:'fixture-disabled',rootId:''}));}
      const wav=/^\/__fixture__\/audio\/(\d+)\.wav$/.exec(pathname);
      if(wav){
        requests.audio++;const index=Number(wav[1]);if(!audio.has(index))audio.set(index,fixtureWav(index));const bytes=audio.get(index);
        const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||''),start=range?+range[1]:0,end=range&&range[2]?Math.min(+range[2],bytes.length-1):bytes.length-1;
        res.writeHead(range?206:200,{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})});return res.end(bytes.subarray(start,end+1));
      }
      const cover=/^\/__fixture__\/cover\/(\d+)\.svg$/.exec(pathname);
      if(cover){requests.covers++;res.writeHead(200,{'Content-Type':'image/svg+xml','Cache-Control':'no-store'});return res.end(fixtureCover(Number(cover[1])));}
      let path=resolve(root,'.'+decodeURIComponent(pathname));
      if(!path.startsWith(root+sep))throw Error('Invalid path');if((await stat(path)).isDirectory())path=join(path,'index.html');
      let body=await readFile(path);
      if(pathname==='/drawercast/player.js')body=instrumentFixtureBoot(body.toString());
      res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const origin=`http://127.0.0.1:${server.address().port}`;
  return {server,origin,requests,close:()=>new Promise(done=>server.close(done))};
}

export async function openFixturePage(browser,fixture,options={}){
  const context=await browser.newContext(mobileContext);
  await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort('blockedbyclient'));
  await context.addInitScript(flags=>localStorage.setItem('drawercast.sources.v1',JSON.stringify(flags)),sourceFlags);
  await context.addInitScript(installFixtureInputTrace);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  page.setDefaultTimeout(5000);
  await page.goto(fixture.origin+'/drawercast/');await page.waitForFunction(()=>window.PA?.R2Source.manifestURL==='fixture-disabled');await page.evaluate(()=>window.__powerampBootPromise);
  await page.evaluate(installPowerampFixture,{origin:fixture.origin,...options});
  const cdp=await context.newCDPSession(page),point=(x,y,id=1)=>({id,x,y,radiusX:1,radiusY:1,force:1});
  let lastPoint=null,lastTarget=null;
  const send=(type,points)=>{if(points.length)lastPoint={x:points[0].x,y:points[0].y};return cdp.send('Input.dispatchTouchEvent',{type,touchPoints:points});};
  const frame=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>r())));
  const start=(x,y)=>send('touchStart',[point(x,y)]),move=(x,y)=>send('touchMove',[point(x,y)]),end=()=>send('touchEnd',[]);
  const tap=async(x,y)=>{await start(x,y);await end();};
  const center=async selector=>{const box=await page.locator(selector).boundingBox();if(!box)throw Error('Missing visible fixture target '+selector);const p={x:box.x+box.width/2,y:box.y+box.height/2,box};lastTarget={selector,...p};return p;};
  const swipe=async(selector,dx,dy)=>{const p=await center(selector);await start(p.x,p.y);for(let i=1;i<=5;i++){await move(p.x+dx*i/5,p.y+dy*i/5);await frame();}await end();return p;};
  const settled=async screen=>{
    await page.waitForFunction(fixtureSceneSettled,screen);
    await frame();await frame();
  };
  const library=async()=>{await page.locator('[data-nav="library"]').tap();await settled('library');await page.getByRole('button',{name:'All Songs',exact:true}).tap();await settled('list');};
  const diagnostics=()=>page.evaluate(({lastPoint,lastTarget})=>{
    const label=n=>n?((n.tagName||'').toLowerCase()+(n.id?'#'+n.id:'')+(n.classList?.length?'.'+Array.from(n.classList).slice(0,3).join('.'):'')+(n.dataset?.act?'[data-act='+n.dataset.act+']':'')):null;
    const rect=n=>{const r=n.getBoundingClientRect(),cs=getComputedStyle(n);return {left:r.left,top:r.top,width:r.width,height:r.height,hidden:n.hidden,inert:n.inert,scene:n.dataset.scene,transform:cs.transform,pointerEvents:cs.pointerEvents,touchAction:cs.touchAction,scrollTop:n.scrollTop,scrollHeight:n.scrollHeight,clientHeight:n.clientHeight};};
    const scene=typeof ScreenDrag!=='undefined'?(ScreenDrag.state||ScreenDrag.settling):null;
    const history=PA.LibraryPageMotion.state;
    return {lastPoint,lastTarget,viewport:{width:innerWidth,height:innerHeight},hit:lastPoint?document.elementsFromPoint(lastPoint.x,lastPoint.y).slice(0,6).map(label):[],screen:PA.Nav.cur,
      gesture:typeof InputLifecycle!=='undefined'?{owner:label(InputLifecycle.gesture?.node),phase:InputLifecycle.gesture?.phase,contacts:Array.from(InputLifecycle.contacts),version:InputLifecycle.version}:null,
      scene:scene?{from:scene.fromName,target:scene.target,phase:ScreenDrag.phase,progress:scene.progress,height:scene.height,commit:scene.commit,shared:scene.morph?.p,pending:!!ScreenDrag.finish?.pending}:null,
      history:history?{index:PA.LibraryPageHistory.index,x:history.x,base:history.base,y:history.y,width:history.width,delta:history.delta,commit:history.commit,target:history.target?.screen,pending:!!PA.LibraryPageMotion.finish?.pending}:null,
      time:PA.Engine.time(),scrubbing:PA.UI.seekDragging,pageErrors:[],probes:{libraryInterruption:window.libraryInterruption||null,crossAxisTrace:window.crossAxisTrace||null},nodes:Object.fromEntries(['#sc-player','#sc-library','#sc-list','#list-body','#mini','#mini-title','#mini-seek','#transport','.player-scene-input','#mini[data-shared-player] #mini-art','#player-live-mask','#player-live-backdrop-mask','#library-page-motion'].map(selector=>[selector,document.querySelector(selector)?rect(document.querySelector(selector)):null])),trace:window.fixtureInputTrace||[]};
  },{lastPoint,lastTarget}).then(result=>({...result,pageErrors:errors.slice()}));
  try{await settled('player');}catch(error){await reportFixtureFailure({diagnostics,page},error,'fixture player endpoint readiness');await context.close();throw error;}
  return {context,page,cdp,errors,point,send,start,move,end,tap,frame,center,swipe,library,settled,diagnostics,close:()=>context.close()};
}
