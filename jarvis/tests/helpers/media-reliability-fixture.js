import {readFile, stat} from 'node:fs/promises';
import {createServer} from 'node:http';
import {EventEmitter} from 'node:events';
import {extname, join, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fixtureWav} from './poweramp-fixture.js';

// Reuse the generated silent VP8 fixture; no external media or encoder is
// required. The independent audio leg uses generated, non-silent PCM.
export async function silentVideo(){
  const source=await readFile(new URL('../mymedia-layout-browser.test.js',import.meta.url),'utf8');
  const encoded=/const media = Buffer\.from\('([^']+)', 'base64'\)/.exec(source)?.[1];
  if(!encoded)throw Error('Generated VP8 fixture is missing');
  return Buffer.from(encoded,'base64');
}

export async function serveMediaReliabilityFixture({handleRequest}={}){
  const root=resolve(fileURLToPath(new URL('../../public/',import.meta.url)));
  const policy=JSON.parse(await readFile(join(root,'staticwebapp.config.json'),'utf8'));
  const frozenApp=process.env.ASTRA_APP_SOURCE?await readFile(process.env.ASTRA_APP_SOURCE):null;
  const clip=await silentVideo(),tone=fixtureWav(),requests=[],sockets=new Set(),held=[];
  const controls={movie:'ok',music:'ok'},changes=new EventEmitter();
  let sequence=0;
  const mark=(log,event)=>{log.events.push({event,sequence:++sequence});changes.emit('change');};
  const metas=[{id:'fixture-movie',type:'movie',name:'Test Pattern',description:'Generated silent VP8 video.'},
    {id:'fixture-music',type:'music',name:'Test Tone',description:'Generated non-silent PCM audio.'}];
  const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.otf':'font/otf','.woff2':'font/woff2'};
  let origin;
  const server=createServer(async(req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    const log={id:requests.length+1,path:pathname,range:req.headers.range||null,status:null,finished:false,events:[]};requests.push(log);
    mark(log,'admitted');
    res.on('finish',()=>{log.finished=true;mark(log,'finished')});
    res.on('close',()=>{if(!res.writableEnded){log.aborted=true;mark(log,'aborted')}});
    const json=value=>{log.status=200;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(value))};
    try{
      if(handleRequest&&await handleRequest({req,res,pathname,log,json,mark:event=>mark(log,event)}))return;
      if(frozenApp&&pathname==='/media/assets/js/app.js'){log.status=200;res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(frozenApp);}
      if(pathname==='/fixture/manifest.json')return json({id:'org.jarvis.media.fixture',name:'Media Fixture',version:'1.0.0',resources:['catalog','meta','stream'],types:['movie','music'],catalogs:metas.map(m=>({type:m.type,id:m.id,name:m.name}))});
      if(pathname.startsWith('/fixture/catalog/'))return json({metas:metas.filter(m=>pathname.includes('/'+m.type+'/'))});
      if(pathname.startsWith('/fixture/meta/'))return json({meta:metas.find(m=>pathname.includes('/'+m.id+'.json'))});
      if(pathname.startsWith('/fixture/stream/')){
        const m=metas.find(m=>pathname.includes('/'+m.id+'.json'));
        return json({streams:[{name:'Fixture',title:m.type==='music'?'Test Tone PCM WAV':'Test Pattern 360p VP8 WebM',url:origin+'/__media__/'+(m.type==='music'?'tone.wav':'clip.webm')}]});
      }
      if(pathname.startsWith('/__media__/')){
        const music=pathname.endsWith('.wav'),mode=controls[music?'music':'movie'];
        const bytes=music?tone:clip,range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
        const start=range?Number(range[1]):0,end=range&&range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
        const status=mode==='reject'?503:start>end?416:range?206:200;log.status=status;
        res.writeHead(status,{'Content-Type':music?'audio/wav':'video/webm','Accept-Ranges':'bytes','Cache-Control':'no-store',
          ...(status===416?{'Content-Range':`bytes */${bytes.length}`}:
            status===503?{}:{'Content-Length':end-start+1,...(range?{'Content-Range':`bytes ${start}-${end}/${bytes.length}`}:{})})});
        if(mode==='reject'||status===416)return res.end();
        if(mode==='hold'||mode==='partial'){
          res.flushHeaders();
          const sent=mode==='partial'&&start===0?44+262144:start;
          if(sent>start)res.write(bytes.subarray(start,sent));
          held.push({res,bytes,start:sent,end,log});
          log.held=true;mark(log,'held');
          return;
        }
        return res.end(bytes.subarray(start,end+1));
      }
      if(pathname==='/assets/r2-config.json')return json({manifestURL:'fixture-disabled',rootId:''});
      let path=resolve(root,'.'+decodeURIComponent(pathname));
      if(!path.startsWith(root+sep))throw Error('Outside fixture root');
      if((await stat(path)).isDirectory())path=join(path,'index.html');
      log.status=200;
      const headers={'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'};
      if(extname(path)==='.html')headers['Content-Security-Policy']=(policy.routes.find(r=>pathname.startsWith(r.route.replace('*','')))?.headers?.['Content-Security-Policy']||policy.globalHeaders['Content-Security-Policy']);
      res.writeHead(200,headers);res.end(await readFile(path));
    }catch{log.status=404;res.writeHead(404);res.end();}
  });
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+server.address().port;
  return {origin,controls,requests,clip,
    // Observe server admission/cancellation without completing the response.
    waitForRequest(predicate,timeout=10000){
      return new Promise((resolve,reject)=>{
        const check=()=>{const request=requests.find(predicate);if(request){cleanup();resolve(request);}};
        const cleanup=()=>{clearTimeout(timer);changes.off('change',check);};
        const timer=setTimeout(()=>{cleanup();reject(Error('HTTP observation timed out: '+JSON.stringify(requests.filter(r=>r.held))));},timeout);
        changes.on('change',check);check();
      });
    },
    releaseHeld(){for(const response of held.splice(0)){
      mark(response.log,'release-attempt');
      if(!response.res.destroyed){mark(response.log,'completion-requested');response.res.end(response.bytes.subarray(response.start,response.end+1));}
    }},
    close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(done=>server.close(done));}};
}

export async function openAstraFixture(browser,fixture){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.route('**/*',route=>new URL(route.request().url()).origin===fixture.origin?route.continue():route.abort('blockedbyclient'));
  await context.addInitScript(origin=>{
    if(!localStorage.getItem('astra.v1.addons'))localStorage.setItem('astra.v1.addons',JSON.stringify([{url:origin+'/fixture/manifest.json',enabled:true}]));
    localStorage.setItem('astra.v1.youtube',JSON.stringify({enabled:false}));
  },fixture.origin);
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.setDefaultTimeout(10000);await page.goto(fixture.origin+'/media/');
  const open=async(type='movie')=>{
    await page.locator('.card[data-open]').filter({hasText:type==='music'?'Test Tone':'Test Pattern'}).first().click();
    await page.locator('[data-get-streams]').first().click();
    await page.locator('[data-play-source]').first().click();
    await page.locator('#mediaEl').waitFor();
  };
  const state=()=>page.evaluate(()=>{
    const media=document.querySelector('#mediaEl');
    return {release:document.querySelector('meta[name="astra-release"]')?.content,hash:location.hash,
      playback:document.querySelector('#playerShell')?.dataset.playbackState||null,
      media:media?{time:media.currentTime,duration:media.duration,paused:media.paused,ended:media.ended,readyState:media.readyState,networkState:media.networkState,error:media.error?.code||0,frames:media.getVideoPlaybackQuality?.().totalVideoFrames||0}:null,
      pip:!!document.pictureInPictureElement,fullscreen:!!document.fullscreenElement,
      status:document.querySelector('#playerStatus')?.textContent.slice(0,400)||'',
      savedProgress:Object.values(JSON.parse(localStorage.getItem('astra.v1.progress')||'{"entries":{}}').entries).map(({time,duration,completed})=>({time,duration,completed}))};
  });
  return {context,page,errors,open,state};
}

export async function openMyMediaFixture(browser,fixture){
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.route('**/*',route=>{
    const url=new URL(route.request().url()),json=data=>route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
    if(url.origin===fixture.origin){
      if(url.pathname==='/assets/drive-config.json')return json({apiKey:'AIza'+'x'.repeat(35),videoFolderId:'folder123456789'});
      return route.continue();
    }
    // My Media's fixed Google transport is substituted, as in its existing
    // browser tests. Astra's media and add-on legs remain real local HTTP.
    if(url.hostname==='www.googleapis.com'){
      if(url.searchParams.get('alt')==='media')return route.fulfill({contentType:'video/webm',body:fixture.clip,headers:{'Accept-Ranges':'bytes'}});
      if(url.pathname.endsWith('/folder123456789'))return json({id:'folder123456789',name:'Fixture library',mimeType:'application/vnd.google-apps.folder'});
      return json({files:[{id:'video1234567890',name:'Generated Test Pattern.webm',mimeType:'video/webm',modifiedTime:'2026-10-06T00:00:00Z',videoMediaMetadata:{durationMillis:'30000',width:320,height:180}}]});
    }
    return route.abort('blockedbyclient');
  });
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  await page.goto(fixture.origin+'/mymedia/');await page.locator('.video-card').first().click();
  await page.waitForFunction(()=>{const m=document.querySelector('#video');return m&&m.readyState>=2&&!m.paused});
  await page.evaluate(()=>{window.fixturePiPObserver=JarvisPiPDiagnostics.observe(document.querySelector('#video'));});
  const state=()=>page.evaluate(()=>{
    const release=new URL([...document.scripts].find(script=>script.src.includes('/mymedia/app.js')).src).searchParams.get('v');
    return {release,hash:location.hash,paused:document.querySelector('#video').paused,
      time:document.querySelector('#video').currentTime,pip:window.fixturePiPObserver.snapshot({app:'mymedia',release})};
  });
  return {context,page,errors,state};
}
