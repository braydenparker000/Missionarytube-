import {chromium} from 'playwright-core';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const origin='https://missionarytube.z13.web.core.windows.net',root=resolve('public');
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const page=await browser.newPage();
await page.route(origin+'/drawercast/**',async route=>{const path=new URL(route.request().url()).pathname;try{return await route.fulfill({body:await readFile(resolve(root,'.'+(path==='/drawercast/'?path+'index.html':path))),contentType:path.endsWith('.js')?'application/javascript':'text/html'});}catch{return route.continue();}});
const rows=[];
try{
 await page.goto(origin+'/drawercast/');await page.waitForFunction(()=>window.PA,null,{polling:100});
 for(const rate of [44100,48000,96000])for(const type of ['peaking','lowshelf','highshelf'])for(const center of [20,997,20000])for(const q of [.1,12])for(const gain of [-15,15]){
  rows.push(await page.evaluate(async({rate,type,center,q,gain})=>{
   const duration=24,length=duration*rate,ctx=new OfflineAudioContext(1,length,rate),c=PA.AudioDSP.coeff(type,center,gain,q,rate),filter=ctx.createIIRFilter(c.slice(0,3),c.slice(3));
   const input=ctx.createBuffer(1,length,rate);input.getChannelData(0)[0]=.001;
   const src=ctx.createBufferSource();src.buffer=input;src.connect(filter);filter.connect(ctx.destination);src.start();const h=(await ctx.startRendering()).getChannelData(0);
   // Independent complex z-domain response of the supplied coefficients,
   // compared with the ACTUAL rendered impulse, including a long decay tail.
   let maximum=0,phaseMax=0,tail=0,invalid=false;
   for(let i=length-rate;i<length;i++){tail=Math.max(tail,Math.abs(h[i]));if(!Number.isFinite(h[i]))invalid=true;}
   for(const f of [20,37,100,997,5000,10000,Math.min(20000,rate*.45)]){
    const w=2*Math.PI*f/rate;let re=0,im=0;
    for(let i=0;i<h.length;i++){re+=h[i]*Math.cos(w*i);im-=h[i]*Math.sin(w*i);}
    const nr=c[0]+c[1]*Math.cos(w)+c[2]*Math.cos(2*w),ni=-c[1]*Math.sin(w)-c[2]*Math.sin(2*w),dr=1+c[4]*Math.cos(w)+c[5]*Math.cos(2*w),di=-c[4]*Math.sin(w)-c[5]*Math.sin(2*w);
    const expected=20*Math.log10(Math.hypot(nr,ni)/Math.hypot(dr,di));const actual=20*Math.log10(Math.hypot(re,im)/.001);
    maximum=Math.max(maximum,Math.abs(actual-expected));let phase=Math.atan2(im,re)-(Math.atan2(ni,nr)-Math.atan2(di,dr));while(phase>Math.PI)phase-=2*Math.PI;while(phase<-Math.PI)phase+=2*Math.PI;phaseMax=Math.max(phaseMax,Math.abs(phase));
   }
   return {rate,type,center,q,gain,maxMagnitudeErrorDb:maximum,maxPhaseErrorRadians:phaseMax,tailPeak:tail,invalid,passed:maximum<=.05&&!invalid&&tail<1e-12};
  },{rate,type,center,q,gain}));
 }
 const report={browser:browser.version(),rows,passed:rows.every(x=>x.passed)};await writeFile('docs/audio-evidence/eq-extremes.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({passed:report.passed,count:rows.length,maxError:Math.max(...rows.map(x=>x.maxMagnitudeErrorDb))}));if(!report.passed)process.exitCode=1;
}finally{await browser.close();}
