// A hard transport reset must flush every fading curve, not only the latest.
import{chromium}from'playwright-core';import{readFile,writeFile}from'node:fs/promises';import{execFileSync}from'node:child_process';
const origin='https://missionarytube.z13.web.core.windows.net',baseline=process.env.AUDIO_BASELINE_COMMIT;
const b=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const p=await b.newPage();
await p.route(origin+'/drawercast/**',async r=>{const x=new URL(r.request().url()).pathname,file='public'+(x==='/drawercast/'?x+'index.html':x);try{return r.fulfill({body:baseline?execFileSync('git',['show',baseline+':'+file],{maxBuffer:4*1024*1024}):await readFile(file),contentType:x.endsWith('.js')?'application/javascript':'text/html'});}catch{return r.continue();}});await p.route('https://www.googleapis.com/**',r=>r.abort());
const report={browser:b.version(),baseline:baseline||null,rows:[],passed:false};
try{
 await p.goto(origin+'/drawercast/');await p.waitForFunction(()=>window.PA);
 for(const rate of [44100,48000,96000])report.rows.push(await p.evaluate(async rate=>{
  const{Engine:E,SET:S,AudioQuality:Q}=PA;E.pause();if(E.ctx?.close)await E.ctx.close();E.ctx=null;E.nodes=null;E.srcs=[];E.gains=[];E.ready=false;
  Object.assign(S,{audioMode:'custom',volume:1,preamp:0,eqEnabled:true,eqFreqs:[20],eqGains:[15],eqQ:[12],eqTypes:['lowshelf'],toneEnabled:false,reverbEnabled:false,mono:false,balance:0,rgEnabled:false,autoHeadroom:true,limiterEnabled:true});
  const c=new OfflineAudioContext(2,rate/2,rate),AC=window.AudioContext;c.createMediaElementSource=()=>c.createGain();window.AudioContext=function(){return c;};E.current={id:'reset-fixture'};E.ensureCtx();window.AudioContext=AC;
  for(let i=0;!E.nodes.peakLimiter&&i<100;i++)await new Promise(r=>setTimeout(r,10));if(!E.nodes.peakLimiter)throw Error('Guard missing');
  const input=c.createBuffer(2,Math.round(rate*.064),rate);for(let i=0;i<input.length;i++){input.getChannelData(0)[i]=.5*Math.sin(2*Math.PI*13*i/rate);input.getChannelData(1)[i]=-input.getChannelData(0)[i];}const s=c.createBufferSource();s.buffer=input;s.connect(E.srcs[0]);s.start(.05);
  const a=c.suspend(.115),z=c.suspend(.12),render=c.startRendering();await a;S.eqGains[0]=-15;Q.update();await c.resume();await z;const resetTime=c.currentTime;Q.reset();await new Promise(r=>setTimeout(r,10));await c.resume();
  const output=await render,delay=Math.round(rate*.006)+64,start=Math.ceil(resetTime*rate)+delay+256;
  let tail=0,before=0;for(let ch=0;ch<2;ch++){const x=output.getChannelData(ch);for(let i=Math.round(rate*.108);i<Math.round(rate*.114);i++)before=Math.max(before,Math.abs(x[i]));for(let i=start;i<x.length;i++)tail=Math.max(tail,Math.abs(x[i]));}
  return{rate,resetTime,alignedPostResetSample:start,preResetTailPeak:before,postResetPeak:tail,passed:before>1e-8&&tail===0};
 },rate));report.passed=report.rows.every(x=>x.passed);if(!report.passed&&!baseline)process.exitCode=1;
}finally{await writeFile(process.env.AUDIO_RESET_REPORT||'docs/audio-evidence/followup-reset.json',JSON.stringify(report,null,2)+'\n');await b.close();console.log(JSON.stringify(report));}
