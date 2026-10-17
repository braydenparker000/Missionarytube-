// Observe the parameters actually sent by the shipped curve renderer, then
// compare every plotted frequency with separate RBJ algebra and active filters.
import{chromium}from'playwright-core';import{readFile,writeFile}from'node:fs/promises';
const origin='https://missionarytube.z13.web.core.windows.net';
const b=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const p=await b.newPage();
await p.route(origin+'/drawercast/**',async r=>{const x=new URL(r.request().url()).pathname;try{return await r.fulfill({body:await readFile('public'+(x==='/drawercast/'?x+'index.html':x)),contentType:x.endsWith('.js')?'application/javascript':'text/html'});}catch{return r.continue();}});
await p.route('https://www.googleapis.com/**',r=>r.abort());const report={browser:b.version(),rows:[],passed:false};
try{
 await p.goto(origin+'/drawercast/');await p.waitForFunction(()=>window.PA);
 for(const rate of [44100,48000,96000])for(const tone of [[100,10000,.7071068,.7071068],[200,4000,.7,.7],[47,12000,12,.1]]){
  const row=await p.evaluate(({rate,tone})=>{
   const {SET:S,EqMath:M,UI,Nav,Engine:E,AudioQuality:Q}=PA;
   Object.assign(S,{audioMode:'custom',eqEnabled:true,eqFreqs:[63,997,8000],eqGains:[3,-4,2],eqQ:[1,1.1,2],eqTypes:['peaking','peaking','peaking'],preamp:-3,toneEnabled:true,bass:.6,treble:-.4,bassFreq:tone[0],trebleFreq:tone[1],bassQ:tone[2],trebleQ:tone[3]});
   E.ctx={sampleRate:rate};Nav.cur='eq';let observed;
   const original=M.curve;M.curve=function(p,n,sr){const points=original.call(this,p,n,sr);observed={preset:structuredClone(p),points,sr};return points;};UI.drawCurve();M.curve=original;
   if(!observed)throw Error('No actual curve render observed');
   // Independent coefficient construction and complex magnitude response.
   const coefficient=(type,f,g,q)=>{
    f=Math.max(10,Math.min(rate*.49,f));q=Math.max(.1,Math.min(12,q));g=Math.max(-15,Math.min(15,g));
    const A=10**(g/40),w=2*Math.PI*f/rate,c=Math.cos(w),alpha=Math.sin(w)/(2*q),k=2*Math.sqrt(A)*alpha;
    let b0,b1,b2,a0,a1,a2;
    if(type==='peaking'){b0=1+alpha*A;b1=-2*c;b2=1-alpha*A;a0=1+alpha/A;a1=-2*c;a2=1-alpha/A;}
    else if(type==='lowshelf'){b0=A*((A+1)-(A-1)*c+k);b1=2*A*((A-1)-(A+1)*c);b2=A*((A+1)-(A-1)*c-k);a0=(A+1)+(A-1)*c+k;a1=-2*((A-1)+(A+1)*c);a2=(A+1)+(A-1)*c-k;}
    else{b0=A*((A+1)+(A-1)*c+k);b1=-2*A*((A-1)+(A+1)*c);b2=A*((A+1)+(A-1)*c-k);a0=(A+1)-(A-1)*c+k;a1=2*((A-1)-(A+1)*c);a2=(A+1)-(A-1)*c-k;}
    return [b0/a0,b1/a0,b2/a0,1,a1/a0,a2/a0];
   };
   const filters=[coefficient('peaking',63,3,1),coefficient('peaking',997,-4,1.1),coefficient('peaking',8000,2,2),coefficient('lowshelf',tone[0],9,tone[2]),coefficient('highshelf',tone[1],-6,tone[3])];
   const response=(c,f)=>{const w=2*Math.PI*f/rate,z=a=>Math.hypot(a[0]+a[1]*Math.cos(w)+a[2]*Math.cos(2*w),a[1]*Math.sin(w)+a[2]*Math.sin(2*w));return 20*Math.log10(z(c.slice(0,3))/z(c.slice(3)));};
   let error=0;observed.points.forEach((db,i)=>{const f=20*Math.pow(1000,i/(observed.points.length-1)),expected=-3+filters.reduce((s,c)=>s+response(c,f),0);error=Math.max(error,Math.abs(db-expected));});
   const active=Q.filters(),coefficientError=Math.max(...active.flatMap((c,i)=>c.map((v,j)=>Math.abs(v-filters[i][j]))));
   return {rate,tone,plottedToneFreqs:observed.preset.freqs.slice(-2),plottedToneQ:observed.preset.q.slice(-2),points:observed.points.length,maxMagnitudeErrorDb:error,maxActiveCoefficientError:coefficientError};
  },{rate,tone});report.rows.push(row);
 }
 report.passed=report.rows.every(x=>x.maxMagnitudeErrorDb<=.05&&x.maxActiveCoefficientError<1e-12);if(!report.passed)process.exitCode=1;
}finally{await writeFile('docs/audio-evidence/followup-tone-curve.json',JSON.stringify(report,null,2)+'\n');await b.close();console.log(JSON.stringify({passed:report.passed,maxErrorDb:Math.max(...report.rows.map(x=>x.maxMagnitudeErrorDb))}));}
