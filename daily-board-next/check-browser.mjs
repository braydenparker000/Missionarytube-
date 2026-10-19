import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const root=fileURLToPath(new URL('../',import.meta.url));
const reference=process.argv[2];
const output=process.argv[3]||'/tmp/daily-board-visual';await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{try{
  const pathname=new URL(req.url,'http://local').pathname;
  const path=pathname==='/reference'&&reference?reference:resolve(root,'.'+(pathname==='/daily-board-next/'?'/daily-board-next/index.html':pathname));
  if(path!==reference&&!path.startsWith(root))throw Error();
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));
}catch{res.writeHead(404);res.end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const results=[];
try {
for(const width of [360,390,1200])for(const [name,path] of [...(reference?[['reference','/reference']]:[]),['one','/daily-board-next/?fixture=one'],['two','/daily-board-next/?fixture=two']]){
  const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://127.0.0.1:${server.address().port}${path}`);await page.evaluate(()=>document.fonts.ready);
  if(name!=='reference')await page.waitForSelector('article.story');
  const metrics=await page.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,background:getComputedStyle(document.body).backgroundColor,font:getComputedStyle(document.body).fontFamily,articles:document.querySelectorAll('article.story').length}));
  assert.equal(metrics.overflow,false);assert.equal(metrics.background,'rgb(0, 0, 0)');assert.deepEqual(errors,[]);
  if(name==='two'){await page.locator('input[type=range]').focus();await page.keyboard.press('End');assert.match(await page.locator('.lab-explain').textContent(),/Explain what changed/);}
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});});
  await page.screenshot({path:`${output}/${name}-${width}.png`,fullPage:true});
  if(width===390)await page.screenshot({path:`${output}/${name}-390-top.png`});
  if(name==='one')await page.evaluate(async()=>{
    const {renderEntry}=await import('../frontend/daily-board/v1/render.js');const target=document.querySelector('#report');
    renderEntry({title:'<img src=x onerror=alert(1)>',body:'<script>evil()</script>',report:{schema:'unknown'}},target);
    if(target.querySelector('script,img')||!target.textContent.includes('<script>evil()</script>'))throw Error('Unsafe legacy fallback');
  });
  results.push({name,width,...metrics,errors});await page.close();
}
await writeFile(`${output}/results.json`,JSON.stringify(results,null,2)+'\n');console.log(`${results.length} browser cases passed; keyboard explanation and inert legacy fallback passed.`);
}finally{await browser.close();await new Promise(done=>server.close(done));}
