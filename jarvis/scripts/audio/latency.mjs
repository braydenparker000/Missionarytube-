// Transport-clock observations on one cloud host, not audible output latency.
import {chromium} from 'playwright-core';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const origin='https://missionarytube.z13.web.core.windows.net';
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const report={browser:browser.version(),startedAt:new Date().toISOString(),definition:'Wall-clock selection to media readyState >= 3 and playhead > 0.05 s; seek to target + 0.05 s. Includes network and observation scheduling. Cloud host only; audible latency/underruns/battery unmeasured.',rows:[]};
try{
 for(const [version,root] of [['previous-live-79452a0',resolve(process.env.AUDIO_BASELINE_PUBLIC||'/workspace/scratch/old-public/public')],['candidate',resolve('public')]])for(let trial=0;trial<3;trial++){
  const context=await browser.newContext();
  await context.route(origin+'/drawercast/**',async route=>{const path=new URL(route.request().url()).pathname,file=resolve(root,'.'+(path==='/drawercast/'?path+'index.html':path));try{await stat(file);return await route.fulfill({body:await readFile(file),contentType:extname(file)==='.html'?'text/html':extname(file)==='.js'?'application/javascript':'application/octet-stream'});}catch{return route.continue();}});
  await context.route('https://www.googleapis.com/**',route=>route.abort());
  const page=await context.newPage(),row={version,trial,seeksMs:[]};const start=performance.now();
  await page.goto(origin+'/drawercast/');await page.waitForFunction(()=>window.PA?.R2Source.mapping?.native,null,{timeout:60000,polling:25});row.pageCatalogMs=performance.now()-start;
  const selected=performance.now();await page.evaluate(()=>{for(const k of ['local','drive','server'])PA.MusicSources.setEnabled(k,false,false);PA.Engine.setQueue([PA.LIB.map.get('r2_1594bzGkaPidWVBMpAM5_QwpEX7AVG-t7')],0,true);});
  await page.waitForFunction(()=>PA.Engine.el().readyState>=3&&PA.Engine.time()>.05,null,{timeout:30000,polling:25});row.selectionMs=performance.now()-selected;
  for(const target of [20,75,10,100,50]){const at=performance.now();await page.evaluate(t=>PA.Engine.seek(t),target);await page.waitForFunction(t=>PA.Engine.el().readyState>=3&&PA.Engine.time()>t+.05,target,{timeout:15000,polling:25});row.seeksMs.push(performance.now()-at);}
  report.rows.push(row);await context.close();
 }
 report.passed=true;
}catch(e){report.failure=e.stack;process.exitCode=1;}
finally{report.finishedAt=new Date().toISOString();await writeFile('docs/audio-evidence/transport-latency.json',JSON.stringify(report,null,2)+'\n');await browser.close();console.log(JSON.stringify({passed:report.passed,trials:report.rows.length,failure:report.failure}));}
