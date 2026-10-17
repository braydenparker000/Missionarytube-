// Read-only candidate check: serve this checkout to an isolated browser at the
// existing frontend origin so real Worker CORS and publisher requests apply.
// Nothing is uploaded or deployed. Requires JARVIS_CHROME; HTTPS_PROXY optional.
import {chromium} from 'playwright-core';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
const origin='https://missionarytube.z13.web.core.windows.net';
const output=process.env.JARVIS_SCREENSHOT_DIR;
const proxyURL=process.env.HTTPS_PROXY?new URL(process.env.HTTPS_PROXY):null;
const browser=await chromium.launch({executablePath:process.env.JARVIS_CHROME,headless:true,args:['--no-sandbox'],
 ...(proxyURL?{proxy:{server:proxyURL.origin,username:decodeURIComponent(proxyURL.username),password:decodeURIComponent(proxyURL.password)}}:{})});
try {
 const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,ignoreHTTPSErrors:!!proxyURL,serviceWorkers:'block'});
 const policy=JSON.parse(await readFile('public/staticwebapp.config.json','utf8'));
 await context.route(origin+'/**',async route=>{
  const url=new URL(route.request().url());let path=url.pathname;if(path.endsWith('/'))path+='index.html';
  const file=resolve('public','.'+path);if(!file.startsWith(resolve('public')+'/'))return route.abort();
  try {const body=await readFile(file),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff':'font/woff'};
   const csp=policy.routes.find(r=>url.pathname.startsWith(r.route.replace('*','')))?.headers?.['Content-Security-Policy'] || policy.globalHeaders['Content-Security-Policy'];
   await route.fulfill({body,contentType:mime[extname(file)] || 'application/octet-stream',headers:extname(file)==='.html'?{'Content-Security-Policy':csp}:{}});
  }catch{await route.fulfill({status:404,body:'Not found'});}
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const audit=async name=>{if(!process.env.JARVIS_AXE)return;await page.evaluate(await readFile(process.env.JARVIS_AXE,'utf8'));const result=await page.evaluate(()=>axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}));console.log(name+' accessibility violations:',JSON.stringify(result.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>n.target)}))));assert.deepEqual(result.violations,[]);};
 const shot=async name=>{await audit(name);if(output){await page.waitForFunction(()=>[...document.images].filter(i=>{const r=i.getBoundingClientRect();return r.top<innerHeight&&r.bottom>0;}).every(i=>i.complete&&i.naturalWidth>0),null,{timeout:15000}).catch(()=>{});await mkdir(output,{recursive:true});await page.screenshot({path:resolve(output,name+'.png'),animations:'disabled'});}};
 await page.goto(origin+'/podcasts/');await page.locator('.show-tile').first().waitFor({timeout:60000});await page.evaluate(()=>document.fonts.ready);
 await shot('podcasts-real-discovery');
 await page.locator('#query').fill('The Rest Is History');await page.locator('#search-form button[type=submit]').click();
 const result=page.locator('.show-tile').filter({has:page.getByText('The Rest Is History',{exact:true})}).first();await result.waitFor({timeout:45000});await shot('podcasts-real-search');
 await result.click();await page.locator('.episode-row').first().waitFor({timeout:35000});await shot('podcasts-real-show');
 await page.locator('.episode-play').first().click();await page.waitForFunction(()=>!document.querySelector('#audio').paused&&document.querySelector('#audio').currentTime>0,null,{timeout:55000});
 await page.locator('#open-player').click();await shot('podcasts-real-player');await page.locator('#play').click();await page.locator('#close-player').click();await page.locator('.episode-row').first().scrollIntoViewIfNeeded();await shot('podcasts-real-mini');
 for(const width of [320,360,430,1200]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
 assert.deepEqual(errors,[]);console.log('PASS: candidate discovery, real search, RSS episodes, advancing publisher audio, player, mini-player and 320–1200px page widths.');
} finally {await browser.close();}
