// Full production graph versus independent complex transfer algebra, including
// pathological 32-band boosts and the auto-headroom-off case. Baseline switch
// loads the recorded release bytes rather than synthesizing an old processor.
import {chromium} from 'playwright-core';
import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
const origin='https://missionarytube.z13.web.core.windows.net',baseline=process.env.AUDIO_BASELINE_COMMIT;
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage();
await page.route(origin+'/drawercast/**',async route=>{
 const path=new URL(route.request().url()).pathname,file='public'+(path==='/drawercast/'?path+'index.html':path);
 try{const body=baseline?execFileSync('git',['show',baseline+':'+file],{maxBuffer:4*1024*1024}):await readFile(resolve(file));return route.fulfill({body,contentType:path.endsWith('.js')?'application/javascript':'text/html'});}catch{return route.continue();}
});
await page.route('https://www.googleapis.com/**',route=>route.abort());
const report={browser:browser.version(),baseline:baseline||null,rows:[],passed:false};
try{
 await page.goto(origin+'/drawercast/');await page.waitForFunction(()=>window.PA,null,{polling:100});
 for(const rate of [44100,48000,96000])for(const type of ['peaking','lowshelf','highshelf'])for(const auto of [true,false]){
  const row=await page.evaluate(async({rate,type,auto})=>{
   const {Engine:E,SET:S,AudioQuality:Q}=PA;E.pause();if(E.ctx?.close)await E.ctx.close();E.ctx=null;E.nodes=null;E.srcs=[];E.gains=[];E.ready=false;Q.maxReductionDb=0;Q.reduction=1;Q.recent=null;
   Object.assign(S,{audioMode:'custom',volume:1,preamp:15,eqEnabled:true,eqFreqs:Array(32).fill(997),eqGains:Array(32).fill(15),eqQ:Array(32).fill(12),eqTypes:Array(32).fill(type),toneEnabled:false,reverbEnabled:false,mono:false,balance:0,rgEnabled:false,autoHeadroom:auto,limiterEnabled:true});
   const ctx=new OfflineAudioContext(2,rate*6,rate),AC=window.AudioContext;ctx.createMediaElementSource=()=>ctx.createGain();window.AudioContext=function(){return ctx;};
   E.current={id:'fixture',sha256:'a'.repeat(64),size:1,audioAnalysis:{version:1,sha256:'a'.repeat(64),audioBytes:1,gainBasis:'decoded-container-gain',decoder:'fixture',method:'known sine',analyzedAt:'2026-10-02T00:00:00Z',sampleRate:rate,channels:2,integratedLufs:-26,samplePeakDbfs:-26,truePeakDbtp:-25.9,containerGainDb:0}};
   E.ensureCtx();window.AudioContext=AC;for(let tries=0;!E.nodes.peakLimiter&&tries<100;tries++)await new Promise(r=>setTimeout(r,10));if(!E.nodes.peakLimiter)throw Error('Guard missing');
   // Separate complex response arithmetic; no DSP.db or sampled curve values.
   const c=PA.AudioDSP.coeff(type,997,15,12,rate),response=f=>{
    const w=2*Math.PI*f/rate,real=x=>x[0]+x[1]*Math.cos(w)+x[2]*Math.cos(2*w),imag=x=>-x[1]*Math.sin(w)-x[2]*Math.sin(2*w);
    const b=c.slice(0,3),a=c.slice(3),br=real(b),bi=imag(b),ar=real(a),ai=imag(a);
    return {db:20*Math.log10(Math.hypot(br,bi)/Math.hypot(ar,ai)),phase:Math.atan2(bi,br)-Math.atan2(ai,ar)};
   };
   let lo=10,hi=rate*.499;
   const grid=Array.from({length:4097},(_,i)=>10*Math.pow(hi/10,i/4096));let index=0;
   for(let i=1;i<grid.length;i++)if(response(grid[i]).db>response(grid[index]).db)index=i;
   lo=grid[Math.max(0,index-1)];hi=grid[Math.min(grid.length-1,index+1)];
   for(let i=0;i<40;i++){const u=lo+(hi-lo)/3,v=hi-(hi-lo)/3;if(response(u).db>response(v).db)hi=v;else lo=u;}
   const freq=(lo+hi)/2,ref=response(freq),input=ctx.createBuffer(2,rate*5,rate);
   for(let i=0;i<input.length;i++){input.getChannelData(0)[i]=.05*Math.sin(2*Math.PI*freq*i/rate);input.getChannelData(1)[i]=-.7*input.getChannelData(0)[i];}
   const src=ctx.createBufferSource();src.buffer=input;src.connect(E.srcs[0]);src.start(.5);
   const output=await ctx.startRendering();await new Promise(r=>setTimeout(r,10));
   const delay=Math.round(rate*.006)+64,expectedDb=32*ref.db+15+Q.ledger.eqHeadroomDb+Q.ledger.protectiveDb;
   let energy=0,refEnergy=0,sine=0,cosine=0,peak=0,finite=true,polarityError=0;
   for(let i=rate*3;i<rate*5;i++){
    const value=output.getChannelData(0)[i],p=2*Math.PI*freq*(i-Math.round(rate*.5)-delay)/rate;
    const reference=.05*10**(expectedDb/20)*Math.sin(p+32*ref.phase);
    energy+=(value-reference)**2;refEnergy+=reference**2;sine+=value*Math.sin(p);cosine+=value*Math.cos(p);peak=Math.max(peak,Math.abs(value));finite&&=Number.isFinite(value);
    polarityError=Math.max(polarityError,Math.abs(output.getChannelData(1)[i]+.7*value));
   }
   const measuredDb=20*Math.log10(Math.hypot(sine,cosine)/rate/.05),relativeErrorDb=10*Math.log10(energy/refEnergy);
   return {rate,type,autoHeadroom:auto,freq,ledger:Q.ledger,distributed:!!Q.distributedHeadroom,expectedDb,measuredDb,gainErrorDb:measuredDb-expectedDb,relativeErrorDb,finite,peak,polarityError,maxGuardReductionDb:Q.maxReductionDb};
  },{rate,type,auto});report.rows.push(row);console.log(JSON.stringify({rate,type,auto,gainErrorDb:row.gainErrorDb,relativeErrorDb:row.relativeErrorDb,peak:row.peak,reduction:row.maxGuardReductionDb}));
 }
 report.passed=report.rows.every(r=>r.finite&&r.peak>1e-6&&Math.abs(r.gainErrorDb)<=.05&&r.relativeErrorDb<=-80&&r.polarityError<1e-7&&r.maxGuardReductionDb===0);
 if(!report.passed&&!baseline)process.exitCode=1;
}finally{await writeFile(process.env.AUDIO_CASCADE_REPORT||'docs/audio-evidence/followup-cascade.json',JSON.stringify(report,null,2)+'\n');await browser.close();}
