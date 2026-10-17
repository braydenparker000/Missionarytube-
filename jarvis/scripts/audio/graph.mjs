import {chromium} from 'playwright-core';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const origin='https://missionarytube.z13.web.core.windows.net',root=resolve('public');
const report={startedAt:new Date().toISOString(),graph:[],eq:[],opus:[],passed:false};
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});report.browser=browser.version();
const context=await browser.newContext();await context.route(origin+'/**',async route=>{
 const path=new URL(route.request().url()).pathname;if(path.startsWith('/drawercast/')){const file=resolve(root,'.'+(path==='/drawercast/'?path+'index.html':path));try{await stat(file);return await route.fulfill({body:await readFile(file),contentType:extname(file)==='.html'?'text/html':'application/javascript'});}catch{}}
 return route.continue();
});const page=await context.newPage();
try{
 await page.goto(origin+'/drawercast/');await page.waitForFunction(()=>window.PA,null,{polling:100});
 for(const rate of [44100,48000,96000])for(const volume of [1,.5]){
  const result=await page.evaluate(async({rate,volume})=>{
   const {Engine:E,SET:S,AudioQuality:Q}=PA;
   E.pause();const old=E.ctx;if(old?.close)await old.close();E.ctx=null;E.nodes=null;E.srcs=[];E.gains=[];E.ready=false;
   Object.assign(S,{audioMode:'transparent',volume,eqEnabled:true,toneEnabled:true,reverbEnabled:true,mono:true,balance:1,speed:2,rgEnabled:false});
   const length=rate,ctx=new OfflineAudioContext(2,length,rate),AC=window.AudioContext;
   ctx.createMediaElementSource=()=>ctx.createGain();window.AudioContext=function(){return ctx;};
   E.current={id:'fixture',sha256:'a'.repeat(64),size:1,audioAnalysis:{version:1,sha256:'a'.repeat(64),audioBytes:1,gainBasis:'decoded-container-gain',decoder:'fixture',method:'identity',analyzedAt:'2026-10-02T00:00:00Z',sampleRate:rate,channels:2,integratedLufs:-20,samplePeakDbfs:-16,truePeakDbtp:-15,containerGainDb:0}};
   E.ensureCtx();window.AudioContext=AC;
   for(let tries=0;!E.nodes.peakLimiter&&tries<100;tries++)await new Promise(r=>setTimeout(r,10));
   if(!E.nodes.peakLimiter)throw Error('Production worklet missing');
   // All settings transitions settle in silence before the measured signal.
   const offset=Math.round(rate*.5),input=ctx.createBuffer(2,Math.round(rate*.25),rate);
   for(let i=0;i<input.length;i++){input.getChannelData(0)[i]=.06*Math.sin(i*.13)+.03*Math.cos(i*.17);input.getChannelData(1)[i]=-.05*Math.cos(i*.19);}
   const source=ctx.createBufferSource();source.buffer=input;source.connect(E.srcs[0]);source.start(offset/rate);
   const output=await ctx.startRendering(),delay=Math.round(rate*.006)+64;
   let energy=0,peak=0,dot=0,referenceEnergy=0,n=0;
   for(let ch=0;ch<2;ch++)for(let i=0;i<input.length;i++){
    const reference=Math.fround(input.getChannelData(ch)[i]*volume*volume),value=output.getChannelData(ch)[offset+delay+i],error=value-reference;
    energy+=error*error;peak=Math.max(peak,Math.abs(error));dot+=value*reference;referenceEnergy+=reference*reference;n++;
   }
   return {rate,volume,declaredDelaySamples:delay,residualRmsDbfs:energy?10*Math.log10(energy/n):-180,residualPeak:peak,gainErrorDb:20*Math.log10(dot/referenceEnergy),ledger:Q.ledger,backend:Q.limiter};
  },{rate,volume});
  assert.ok(result.residualRmsDbfs<=-120);assert.ok(result.residualPeak<1e-7);report.graph.push(result);
 }
 // Compare actual Web Audio IIRFilter rendered steady-state sine gain against
 // an independent RBJ frequency-domain reference calculated separately here.
 for(const rate of [44100,48000,96000])for(const type of ['peaking','lowshelf','highshelf']){
  const result=await page.evaluate(async({rate,type})=>{
   const frequencies=[20,937.23,Math.min(19000,rate*.45)],results=[];
   for(const freq of frequencies){
    const ctx=new OfflineAudioContext(1,rate*2,rate),coeff=PA.AudioDSP.coeff(type,937.23,12,12,rate),node=ctx.createIIRFilter(coeff.slice(0,3),coeff.slice(3));
    const b=ctx.createBuffer(1,rate*2,rate);for(let i=0;i<b.length;i++)b.getChannelData(0)[i]=.001*Math.sin(2*Math.PI*freq*i/rate);
    const source=ctx.createBufferSource();source.buffer=b;source.connect(node);node.connect(ctx.destination);source.start();const out=(await ctx.startRendering()).getChannelData(0);
    let sin=0,cos=0;for(let i=rate;i<out.length;i++){sin+=out[i]*Math.sin(2*Math.PI*freq*i/rate);cos+=out[i]*Math.cos(2*Math.PI*freq*i/rate);}
    const measured=20*Math.log10(2*Math.hypot(sin,cos)/rate/.001);
    // Independent transfer: textbook complex evaluation of RBJ coefficients
    // from a separate algebraic alpha/A construction, not DSP.db().
    const w=2*Math.PI*937.23/rate,A=10**(12/40),alpha=Math.sin(w)/24,c=Math.cos(w),k=2*Math.sqrt(A)*alpha;
    let b0,b1,b2,a0,a1,a2;
    if(type==='peaking'){b0=1+alpha*A;b1=-2*c;b2=1-alpha*A;a0=1+alpha/A;a1=-2*c;a2=1-alpha/A;}
    else if(type==='lowshelf'){b0=A*((A+1)-(A-1)*c+k);b1=2*A*((A-1)-(A+1)*c);b2=A*((A+1)-(A-1)*c-k);a0=(A+1)+(A-1)*c+k;a1=-2*((A-1)+(A+1)*c);a2=(A+1)+(A-1)*c-k;}
    else{b0=A*((A+1)+(A-1)*c+k);b1=-2*A*((A-1)+(A+1)*c);b2=A*((A+1)+(A-1)*c-k);a0=(A+1)-(A-1)*c+k;a1=2*((A-1)-(A+1)*c);a2=(A+1)-(A-1)*c-k;}
    const phase=2*Math.PI*freq/rate,real=(u,v,z)=>u+v*Math.cos(phase)+z*Math.cos(2*phase),imag=(u,v,z)=>-v*Math.sin(phase)-z*Math.sin(2*phase);
    const expected=20*Math.log10(Math.hypot(real(b0,b1,b2),imag(b0,b1,b2))/Math.hypot(real(a0,a1,a2),imag(a0,a1,a2)));
    results.push({freq,measuredDb:measured,referenceDb:expected,errorDb:measured-expected});
   }return {rate,type,results};
  },{rate,type});assert.ok(result.results.every(x=>Math.abs(x.errorDb)<=.05));report.eq.push(result);
 }
 report.passed=true;
}catch(e){report.failure=e.stack;process.exitCode=1;}
finally{await writeFile('docs/audio-evidence/graph.json',JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({passed:report.passed,graph:report.graph.length,eq:report.eq.length,failure:report.failure}));}
