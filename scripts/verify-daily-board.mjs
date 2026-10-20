// Exercise the built route under its real CSP with a synthetic API response.
// No live publication or database write occurs.
import {chromium} from 'playwright-core';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {encodeReport} from '../frontend/daily-board/v1/schema.js';
const root=resolve(process.argv[2]||'dist'),report=JSON.parse(await readFile(new URL('../tests/fixtures/daily-board/one.json',import.meta.url)));
const entry={id:report.id,title:report.title,body:encodeReport(report),createdAt:'2026-10-18T12:00:00Z'};
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://local').pathname);if(!path.startsWith(root+'/'))throw Error();res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404);res.end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));const browser=await chromium.launch({executablePath:process.env.JARVIS_CHROME||'/usr/bin/chromium',args:['--no-sandbox']});
try{const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/Content Security Policy/.test(m.text()))errors.push(m.text());});
 await page.route('**/assets/shared-api.js',route=>route.fulfill({contentType:'text/javascript',body:'export async function request(){return '+JSON.stringify({posts:[entry,{id:'44444444-4444-4444-8444-444444444444',title:'Legacy entry',body:'A historical plain-text report.',createdAt:'2026-10-17T12:00:00Z'}]})+';}'}));
 await page.goto(`http://127.0.0.1:${server.address().port}/daily-board/index.html`);await page.waitForSelector('article.story');await page.evaluate(()=>document.fonts.ready);
 assert.equal(await page.locator('article.story').count(),2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.evaluate(()=>document.fonts.check('16px "Instrument Sans"')),true);
 await page.screenshot({path:'/tmp/daily-board-built-reader.png',fullPage:true});
 await page.locator('select').selectOption('44444444-4444-4444-8444-444444444444');assert.match(await page.locator('#report').textContent(),/historical plain-text report/);assert.deepEqual(errors,[]);
 console.log('Built route: CSP/font, structured envelope, historical edition selection and mobile overflow passed.');
}finally{await browser.close();await new Promise(done=>server.close(done));}
