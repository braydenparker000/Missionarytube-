import {chromium} from 'playwright-core';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const origin='https://missionarytube.z13.web.core.windows.net',root=resolve('public'),fixtures=process.env.AUDIO_FIXTURES||'/workspace/scratch/opus-fixtures';
const report={startedAt:new Date().toISOString(),captures:[],passed:false};
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});report.browser=browser.version();
const context=await browser.newContext();await context.route(origin+'/**',async route=>{
 const path=new URL(route.request().url()).pathname;
 if(path.startsWith('/audio-fixtures/'))return route.fulfill({body:await readFile(resolve(fixtures,path.split('/').at(-1))),contentType:path.endsWith('.wav')?'audio/wav':'audio/ogg'});
 if(path.startsWith('/drawercast/')){const file=resolve(root,'.'+(path==='/drawercast/'?path+'index.html':path));try{await stat(file);return await route.fulfill({body:await readFile(file),contentType:extname(file)==='.html'?'text/html':'application/javascript'});}catch{}}
 return route.continue();
});const page=await context.newPage();
try{
 await page.goto(origin+'/drawercast/');await page.waitForFunction(()=>window.PA,null,{polling:100});
 for(const file of ['gain0.opus','gain6.opus','gain-6.opus','rate44100.wav'])for(const seek of [0,1]){
  const result=await page.evaluate(async({file,seek,origin})=>{
   const {Engine:E,SET:S}=PA;S.fadeOnPause=false;clearTimeout(E.fadeTimer);E.pause();E.releaseSlot(0);E.releaseSlot(1);PA.AudioQuality.reset();
   Object.assign(S,{audioMode:'transparent',volume:1,rgEnabled:false});E.ensureCtx();E.applyEQ();E.applyVolume();E.applySpeed();
   for(let i=0;!E.nodes.peakLimiter&&i<100;i++)await new Promise(r=>setTimeout(r,10));
   const code=`class Capture extends AudioWorkletProcessor{constructor(){super();this.data=new Float32Array(sampleRate*2);this.n=0;this.start=currentFrame+sampleRate/2;}process(inputs,outputs){const x=inputs[0];if(currentFrame<this.start)return true;for(let i=0;i<outputs[0][0].length&&this.n<this.data.length;i++)this.data[this.n++]=x?.[0]?.[i]||0;if(this.n===this.data.length){this.port.postMessage(this.data,[this.data.buffer]);return false;}return true;}}registerProcessor('capture-'+${JSON.stringify(file+seek)},Capture);`;
   const url=URL.createObjectURL(new Blob([code],{type:'application/javascript'}));await E.ctx.audioWorklet.addModule(url);URL.revokeObjectURL(url);
   const capture=new AudioWorkletNode(E.ctx,'capture-'+file+seek);E.nodes.analyser.connect(capture);capture.connect(E.ctx.destination);
   const done=new Promise((resolve,reject)=>{capture.port.onmessage=e=>resolve(e.data);setTimeout(()=>reject(Error('capture timeout')),8000);});
   E.cur=0;const audio=E.els[0];audio.src=origin+'/audio-fixtures/'+file;
   await new Promise((resolve,reject)=>{audio.onloadedmetadata=resolve;audio.onerror=reject;audio.load();});audio.currentTime=seek;E.setGain(0,1,0);await audio.play();
   const pcm=await done;audio.pause();E.nodes.analyser.disconnect(capture);capture.disconnect();
   // The first 0.5 seconds settle; measure a steady one-second sine window.
   let energy=0,peak=0;const start=Math.round(E.ctx.sampleRate*.25),end=start+E.ctx.sampleRate;
   for(let i=start;i<Math.min(end,pcm.length);i++){energy+=pcm[i]*pcm[i];peak=Math.max(peak,Math.abs(pcm[i]));}
   return {file,seek,processingRate:E.ctx.sampleRate,rmsDbfs:10*Math.log10(energy/E.ctx.sampleRate),samplePeakDbfs:20*Math.log10(peak),backend:PA.AudioQuality.limiter,ledger:PA.AudioQuality.ledger};
  },{file,seek,origin});report.captures.push(result);
 }
 for(const gain of [-6,6])for(const seek of [0,1]){const baseline=report.captures.find(x=>x.file==='gain0.opus'&&x.seek===seek),changed=report.captures.find(x=>x.file==='gain'+gain+'.opus'&&x.seek===seek);changed.measuredGainDb=changed.rmsDbfs-baseline.rmsDbfs;assert.ok(Math.abs(changed.measuredGainDb-gain)<.03);}
 report.passed=true;
}catch(e){report.failure=e.stack;process.exitCode=1;}
finally{await writeFile('docs/audio-evidence/opus-browser.json',JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({passed:report.passed,captures:report.captures.length,failure:report.failure}));}
