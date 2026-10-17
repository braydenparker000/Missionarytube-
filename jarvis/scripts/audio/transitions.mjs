// Render rapid curve/mode edits through the shipped graph. The independent
// long interpolation oracle is applied afterward by verify-transitions.py.
import {chromium} from 'playwright-core';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const origin='https://missionarytube.z13.web.core.windows.net',root=resolve('public');
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage();
await page.route(origin+'/drawercast/**',async route=>{const path=new URL(route.request().url()).pathname;try{return await route.fulfill({body:await readFile(resolve(root,'.'+(path==='/drawercast/'?path+'index.html':path))),contentType:path.endsWith('.js')?'application/javascript':'text/html'});}catch{return route.continue();}});
await page.route('https://www.googleapis.com/**',route=>route.abort());
const extreme=process.env.AUDIO_EXTREME_TRANSITIONS==='1';
const report={browser:browser.version(),extreme,rows:[]};
try{
 await page.goto(origin+'/drawercast/');await page.waitForFunction(()=>window.PA,null,{polling:100});
 for(const rate of [44100,48000,96000])report.rows.push(await page.evaluate(async({rate,extreme})=>{
  const {Engine:E,SET:S,AudioQuality:Q}=PA;E.pause();if(E.ctx?.close)await E.ctx.close();E.ctx=null;E.nodes=null;E.srcs=[];E.gains=[];E.ready=false;
  Object.assign(S,{audioMode:'custom',volume:1,preamp:0,eqEnabled:true,eqFreqs:Array(extreme?32:1).fill(997),eqGains:Array(extreme?32:1).fill(0),eqQ:Array(extreme?32:1).fill(12),eqTypes:Array(extreme?32:1).fill('peaking'),toneEnabled:false,reverbEnabled:false,mono:false,balance:0,rgEnabled:false,autoHeadroom:true,limiterEnabled:true});
  const ctx=new OfflineAudioContext(2,rate*2,rate),AC=window.AudioContext;ctx.createMediaElementSource=()=>ctx.createGain();window.AudioContext=function(){return ctx;};
  E.current={id:'fixture',sha256:'a'.repeat(64),size:1,audioAnalysis:{version:1,sha256:'a'.repeat(64),audioBytes:1,gainBasis:'decoded-container-gain',decoder:'fixture',method:'synthetic transfer',analyzedAt:'2026-10-02T00:00:00Z',sampleRate:rate,channels:2,integratedLufs:-5,samplePeakDbfs:0,truePeakDbtp:1,containerGainDb:0}};
  E.ensureCtx();window.AudioContext=AC;for(let tries=0;!E.nodes.peakLimiter&&tries<100;tries++)await new Promise(r=>setTimeout(r,10));if(!E.nodes.peakLimiter)throw Error('Guard missing');
  const input=ctx.createBuffer(2,rate,rate);for(let i=0;i<input.length;i++){input.getChannelData(0)[i]=.6*Math.sin(2*Math.PI*997*i/rate)+.3*Math.sin(2*Math.PI*51*i/rate);input.getChannelData(1)[i]=-.7*input.getChannelData(0)[i];}
  const src=ctx.createBufferSource();src.buffer=input;src.connect(E.srcs[0]);src.start(.1);
  const edits=[{at:.25,gain:15},{at:.265,gain:-15},{at:.28,gain:15,type:'lowshelf'},{at:.31,gain:15,type:'highshelf'},{at:.5,mode:'transparent'},{at:.55,mode:'custom',gain:-15,type:'peaking'}];
  const pauses=edits.map(x=>ctx.suspend(x.at)),render=ctx.startRendering(),ledgers=[];
  for(let i=0;i<edits.length;i++){await pauses[i];const edit=edits[i];if(edit.mode)S.audioMode=edit.mode;if(edit.gain!=null)S.eqGains.fill(edit.gain);if(edit.type)S.eqTypes.fill(edit.type);Q.update();ledgers.push({...Q.ledger,at:edit.at});await ctx.resume();}
  const out=await render;return {rate,edits,ledgers,delay:Math.round(rate*.006)+64,channels:[...Array(out.numberOfChannels)].map((_,i)=>Array.from(out.getChannelData(i)))};
 },{rate,extreme}));
 await writeFile(process.env.AUDIO_TRANSITION_PCM||'/workspace/scratch/audio-transition-pcm.json',JSON.stringify(report));
}finally{await browser.close();}
