// Actual shipped player at the production origin, with source assets intercepted
// from disk. Original R2/Drive audio and catalogs remain live, read-only.
import {chromium} from 'playwright-core';
import {readFile,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(process.env.AUDIO_PUBLIC_DIR||'public'),output=process.env.AUDIO_REPORT||'/workspace/scratch/audio-browser.json';
const origin='https://missionarytube.z13.web.core.windows.net';
const minutes=Number(process.env.AUDIO_ENDURANCE_MINUTES||0);
const live=process.env.AUDIO_LIVE==='1';
const report={startedAt:new Date().toISOString(),minutes,live,errors:[],checks:[],samples:[],latency:{seeksMs:[]},passed:false};
const browser=await chromium.launch({headless:true,executablePath:process.env.AUDIO_CHROME||'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
report.browser=browser.version();
const context=await browser.newContext({viewport:{width:393,height:852},isMobile:true,hasTouch:true});
if(process.env.AUDIO_FORCE_FALLBACK==='1')await context.addInitScript(()=>{window.AudioWorkletNode=undefined;});
if(!live)await context.route(origin+'/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.startsWith('/drawercast/')){
    const file=resolve(root,'.'+(path==='/drawercast/'?path+'index.html':path));
    if(file.startsWith(root+'/')){try{
      await stat(file);let body=await readFile(file);
      if(process.env.AUDIO_TEST_PROCESSOR_ERROR==='1'&&file.endsWith('/audio-core.js')){
        // Controlled exception in the actual rendering callback, using the
        // production graph and recovery listener. No injected file is shipped.
        body=Buffer.from(body.toString().replace('this.port.onmessage=e=>{','this.port.onmessage=e=>{if(e.data.testThrow)this.testThrow=true;').replace('process(inputs,outputs){','process(inputs,outputs){if(this.testThrow)throw Error("Controlled verification error");'));
        report.injectedFaultModules=(report.injectedFaultModules||0)+1;
      }
      return await route.fulfill({body,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.json':'application/json','.woff2':'font/woff2'})[extname(file)]||'application/octet-stream'});
    }catch{}}
  }
  return route.continue();
});
// This task never downloads Google audio. The independent cached Drive catalog
// can still populate the UI from Azure.
await context.route('https://www.googleapis.com/**',route=>route.abort());
const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
try{
  const startup=performance.now();
  await page.goto(origin+'/drawercast/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.PA?.R2Source.mapping?.native,null,{timeout:60000});
  report.catalog=await page.evaluate(()=>({r2:[...PA.LIB.map.values()].filter(t=>t.source==='r2').length,drive:[...PA.LIB.map.values()].filter(t=>t.source==='drive').length,mode:PA.SET.audioMode}));
  assert.equal(report.catalog.mode,'transparent');
  report.latency.pageAndCatalogMs=performance.now()-startup;
  if(live){report.release=await page.evaluate(()=>fetch('/release.json',{cache:'no-store'}).then(r=>r.json()));if(process.env.AUDIO_SOURCE_COMMIT)assert.equal(report.release.commit,process.env.AUDIO_SOURCE_COMMIT);}
  const playStarted=performance.now();
  await page.evaluate(()=>{for(const k of ['local','drive','server'])PA.MusicSources.setEnabled(k,false,false);PA.MusicSources.setEnabled('r2',true,false);PA.Engine.setQueue([PA.LIB.map.get('r2_1594bzGkaPidWVBMpAM5_QwpEX7AVG-t7')],0,true);});
  assert.equal(await page.evaluate(()=>PA.Views.counts().all),report.catalog.r2);report.checks.push('independent R2 source selection');
  await page.waitForFunction(()=>PA.Engine.el().currentTime>1&&PA.Engine.el().readyState>=3,null,{timeout:30000,polling:100});
  report.latency.selectionToPlayheadOverOneSecondMs=performance.now()-playStarted;
  if(process.env.AUDIO_FORCE_FALLBACK!=='1')await page.waitForFunction(()=>PA.Engine.nodes?.peakLimiter,null,{timeout:10000,polling:100});
  const snapshot=()=>page.evaluate(()=>{const pcm=new Float32Array(PA.Engine.nodes.analyser.fftSize);PA.Engine.nodes.analyser.getFloatTimeDomainData(pcm);return {at:Date.now(),time:PA.Engine.time(),contextTime:PA.Engine.ctx.currentTime,rate:PA.Engine.ctx.sampleRate,readyState:PA.Engine.el().readyState,mediaError:PA.Engine.el().error?.code||null,mode:PA.SET.audioMode,backend:PA.AudioQuality.limiter,ledger:PA.AudioQuality.ledger,recent:PA.AudioQuality.recent,outputRms:Math.sqrt(pcm.reduce((sum,x)=>sum+x*x,0)/pcm.length),heap:performance.memory?.usedJSHeapSize,playing:PA.Engine.playing};});
  report.initial=await snapshot();report.checks.push(process.env.AUDIO_FORCE_FALLBACK==='1'?'actual R2 decode and explicit degraded backend':'actual R2 HTMLMediaElement decode and worklet');
  const seekStarted=performance.now();
  await page.evaluate(()=>PA.Engine.seek(42));await page.waitForFunction(()=>PA.Engine.time()>43,null,{timeout:10000,polling:100});report.latency.seeksMs.push(performance.now()-seekStarted);report.checks.push('seek continues actual audio');
  await page.evaluate(()=>PA.Engine.pause());await page.waitForFunction(()=>PA.Engine.el().paused,null,{polling:100});await page.evaluate(()=>PA.Engine.play());await page.waitForFunction(()=>PA.Engine.time()>44,null,{timeout:10000,polling:100});report.checks.push('pause/resume');
  await page.evaluate(()=>{PA.SET.eqGains[0]=5;PA.SET.preamp=-3;PA.setVal('audioMode','custom');});
  await page.waitForTimeout(250);report.custom=await snapshot();
  await page.evaluate(()=>PA.setVal('audioMode','transparent'));await page.waitForTimeout(250);
  assert.deepEqual(await page.evaluate(()=>[PA.SET.eqGains[0],PA.SET.preamp]),[5,-3]);report.checks.push('effects stored and restored across transparent mode');
  if(process.env.AUDIO_LATENCY_CHECK==='1')for(const target of [20,75,10,100,50]){
    const started=performance.now();await page.evaluate(t=>PA.Engine.seek(t),target);
    await page.waitForFunction(t=>PA.Engine.time()>t+.25&&PA.Engine.el().readyState>=3,target,{timeout:15000,polling:25});
    report.latency.seeksMs.push(performance.now()-started);
  }
  if(process.env.AUDIO_PIPELINE_CHECK==='1'){
    report.protocol=await page.evaluate(async()=>{
      const url='https://jarvis-hub-api.braydenparker999.workers.dev/music/library/audio/r2_1594bzGkaPidWVBMpAM5_QwpEX7AVG-t7';
      const rows=[];for(const range of ['bytes=0-1023','bytes=-32']){const r=await fetch(url,{headers:{Range:range}});rows.push({range,status:r.status,bytes:(await r.arrayBuffer()).byteLength,contentRange:r.headers.get('content-range')});}return rows;
    });assert.equal(report.protocol[0].status,206);assert.equal(report.protocol[0].bytes,1024);assert.equal(report.protocol[1].status,206);assert.equal(report.protocol[1].bytes,32);report.checks.push('browser byte/suffix Range and CORS');
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('#artA')).backgroundImage.startsWith('url('),null,{timeout:15000});
    report.artwork=await page.evaluate(async()=>{const css=getComputedStyle(document.querySelector('#artA')).backgroundImage,url=css.slice(4,-1).replace(/^"|"$/g,'');const img=new Image();img.src=url;await img.decode();return {width:img.naturalWidth,height:img.naturalHeight,origin:new URL(url).origin};});assert.ok(report.artwork.width>0);report.checks.push('artwork decodes');
    report.mediaSession=await page.evaluate(()=>({title:navigator.mediaSession.metadata?.title,playbackState:navigator.mediaSession.playbackState}));assert.ok(report.mediaSession.title);report.checks.push('media-session metadata');
    const nextId=await page.evaluate(()=>{const genesis=PA.LIB.map.get('r2_1594bzGkaPidWVBMpAM5_QwpEX7AVG-t7'),next=[...PA.LIB.map.values()].find(t=>t.source==='r2'&&t.id!==genesis.id&&!t.id.startsWith('r2_native_'));PA.SET.repeatMode='none';PA.Engine.setQueue([genesis,next],0,true);return next.id;});
    await page.waitForFunction(()=>PA.Engine.duration()>10&&PA.Engine.el().readyState>=3,null,{timeout:15000});
    await page.evaluate(()=>PA.Engine.seek(PA.Engine.duration()-1));
    await page.waitForFunction(id=>PA.Engine.current?.id===id&&PA.Engine.time()>1&&PA.Engine.el().readyState>=3,nextId,{timeout:20000,polling:25});report.next=await snapshot();report.checks.push('actual natural current/next track transition');
    await page.evaluate(()=>PA.Engine.setQueue([PA.LIB.map.get('r2_1594bzGkaPidWVBMpAM5_QwpEX7AVG-t7')],0,true));
    await page.waitForFunction(()=>PA.Engine.time()>1&&PA.Engine.el().readyState>=3,null,{timeout:15000});assert.ok((await snapshot()).outputRms>1e-8,'hard switch must render actual PCM');report.checks.push('hard track switch renders actual PCM');
  }
  await page.screenshot({path:output.replace(/\.json$/,'.png')});
  const until=Date.now()+minutes*60000;let iteration=0,previous=null,previousSeek=false;
  while(Date.now()<until){
    await page.waitForTimeout(10000);const s=await snapshot();report.samples.push(s);
    assert.equal(s.mediaError,null);assert.ok(s.playing);assert.ok(s.readyState>=2);
    assert.ok(s.outputRms>1e-8,'endurance track must render actual PCM');
    if(previous&&!previousSeek){const wall=(s.at-previous.at)/1000,media=s.time-previous.time;assert.ok(Math.abs(media-wall)<.5,'unexplained media-clock stall/drift');}
    previous=s;previousSeek=false;
    if(++iteration%6===0){previousSeek=true;await page.evaluate(i=>{const cycle=i/6;PA.setVal('volume',cycle%2?.5:.8);PA.Engine.seek(5+(cycle*17)%110);if(cycle%3===0)PA.setVal('audioMode',PA.SET.audioMode==='transparent'?'custom':'transparent');},iteration);
      // Exercise UI/network pressure without per-block work in the processor.
      await page.evaluate(()=>{PA.Views.refreshAll();PA.EQ.render();});
    }
  }
  report.final=await snapshot();
  if(process.env.AUDIO_TEST_PROCESSOR_ERROR==='1'){report.faultState=await page.evaluate(()=>({listener:typeof PA.Engine.nodes.peakLimiter.onprocessorerror,ctx:PA.Engine.ctx.state,port:PA.Engine.nodes.peakLimiter.port.constructor.name}));await page.evaluate(()=>PA.Engine.nodes.peakLimiter.port.postMessage({testThrow:true}));await page.waitForFunction(()=>!PA.Engine.nodes.peakLimiter,null,{timeout:10000,polling:25});await page.waitForTimeout(500);report.processorErrorRecovery=await snapshot();assert.match(report.processorErrorRecovery.backend,/Degraded/);assert.ok(report.processorErrorRecovery.playing);assert.ok(report.processorErrorRecovery.outputRms>1e-8,'fallback must render actual non-silent PCM');report.checks.push('real callback exception recovers to one degraded path with non-silent PCM');}
  assert.equal(report.errors.length,0);report.passed=true;
}catch(e){report.failure=e.stack;report.debug=await page.evaluate(()=>({track:PA?.Engine.current?.id,flags:PA?.SourceLibrary.flags,current:PA?.Engine.cur,ctx:PA?.Engine.ctx?.state,nodes:!!PA?.Engine.nodes,backend:PA?.AudioQuality.limiter,workletFailure:PA?.AudioQuality.workletFailure,playing:PA?.Engine.playing,audio:[...document.querySelectorAll('audio')].map(a=>({src:a.currentSrc,paused:a.paused,error:a.error?.code,readyState:a.readyState,time:a.currentTime})),text:document.body.innerText.slice(-1500)})).catch(()=>null);process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile(output,JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({passed:report.passed,output,failure:report.failure,checks:report.checks}));}
