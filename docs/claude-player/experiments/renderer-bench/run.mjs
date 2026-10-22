// Drives bench.html in headless Chromium with mobile emulation and CPU throttling.
import {chromium} from 'playwright-core';
import {fileURLToPath} from 'node:url';
const url='file://'+fileURLToPath(new URL('./bench.html',import.meta.url));
const modes=['A-dom-compositor','A-dom-layout','A-canvas','B-canvas','B-svg','C-dom','C-canvas'];
const throttle=Number(process.argv[2]||4),reps=Number(process.argv[3]||3);
const browser=await chromium.launch({executablePath:process.env.JARVIS_CHROME,args:['--enable-gpu-rasterization']});
const q=(a,p)=>{const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*s.length))];};
const rows=[];
for(const mode of modes){const agg={work:[],intervals:[]};
 for(let r=0;r<reps;r++){
  const ctx=await browser.newContext({viewport:{width:412,height:915},deviceScaleFactor:2.625,isMobile:true,hasTouch:true});
  const page=await ctx.newPage();const cdp=await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:throttle});
  await page.goto(url+'?mode='+mode);await page.waitForFunction('window.__done',null,{timeout:120000});
  const s=await page.evaluate('window.__done');agg.work.push(...s.work.slice(10));agg.intervals.push(...s.intervals.slice(10));
  await ctx.close();}
 const iv=agg.intervals,wk=agg.work;
 rows.push({mode,frames:iv.length,fps:+(1000/(iv.reduce((a,b)=>a+b,0)/iv.length)).toFixed(1),p95_ms:+q(iv,.95).toFixed(1),p99_ms:+q(iv,.99).toFixed(1),over33ms_pct:+(100*iv.filter(x=>x>33.4).length/iv.length).toFixed(1),work_mean_ms:+(wk.reduce((a,b)=>a+b,0)/wk.length).toFixed(2),work_p95_ms:+q(wk,.95).toFixed(2)});}
console.table(rows);console.log(JSON.stringify({throttle,reps,rows}));
await browser.close();
