import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright-core';
import {requireBrowser} from './helpers/ci-test-inventory.mjs';

const track=(partId,kind,name)=>({partId,kind,name,instrument:kind==='guitar'?'Electric Guitar':kind==='drums'?'Drums':'Voice'});
const song=(songId,tracks)=>({songId,revisionId:1,title:'Fixture song '+songId,artist:'Fixture artist',tracks});
const vocals=track(0,'other','Vocals');
const songs=[song(101,[vocals,track(5,'guitar','Left guitar'),track(9,'guitar','Right guitar'),track(12,'drums','Drums')]),
  song(102,[vocals,track(7,'guitar','Solo guitar')]),song(103,[track(3,'other','Keys'),vocals]),song(104,[track(8,'guitar','Only guitar')]),
  song(105,[vocals,...Array.from({length:13},(_,i)=>track(i+1,'guitar','Guitar '+(i+1)))]),
  song(106,[vocals,...Array.from({length:12},(_,i)=>track(i+1,'guitar','Guitar '+(i+1)))])];
const storageKey='jarvis.guitar.library.v1';
const savedEntry=(songId,parts)=>({songId,title:'Fixture song '+songId,artist:'Fixture artist',parts,at:1,collection:'Repertoire'});

test('Guitar track selection belongs to the selected song across picker, requests and storage',{timeout:90000},async t=>{
  const root=resolve(fileURLToPath(new URL('../public/',import.meta.url))),scoreRequests=[];
  const frozen=process.env.GUITAR_APP_SOURCE?await readFile(process.env.GUITAR_APP_SOURCE):null;
  const server=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://local');
    const send=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
    try{
      if(url.pathname==='/assets/config.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end('export const API_ORIGIN=location.origin;');}
      if(frozen&&url.pathname==='/guitar/guitar.js'){res.writeHead(200,{'Content-Type':'text/javascript'});return res.end(frozen);}
      if(url.pathname==='/guitar/search')return send({results:songs});
      const match=/^\/guitar\/songs\/(\d+)(\/score)?$/.exec(url.pathname);
      if(match){
        if(match[2]){
          // Check the real preview/PDF request boundary without rendering or downloading.
          scoreRequests.push({songId:Number(match[1]),parts:url.searchParams.get('parts')});
          return send({error:'Fixture score boundary reached'},503);
        }
        return send({song:songs.find(s=>s.songId===Number(match[1]))});
      }
      let path=resolve(root,'.'+decodeURIComponent(url.pathname));if(!path.startsWith(root+sep))throw Error('Outside root');
      if((await stat(path)).isDirectory())path=join(path,'index.html');
      res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'}[extname(path)]||'application/octet-stream'});res.end(await readFile(path));
    }catch{res.writeHead(404);res.end();}
  });
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const origin='http://127.0.0.1:'+server.address().port;
  let browser;
  try{
    browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
    const session=async(initial={recent:[],saved:[]})=>{
      const context=await browser.newContext({viewport:{width:390,height:844}}),errors=[];
      await context.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
      await context.addInitScript(({key,value})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(value));},{key:storageKey,value:initial});
      const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
      await page.goto(origin+'/guitar/');await page.locator('#song-query').fill('fixture');await page.locator('#song-query').press('Enter');await page.locator('.song-result').first().waitFor();
      const open=async id=>{
        if(await page.locator('#song').isVisible())await page.locator('.change-song').click();
        await page.locator('.song-result').filter({hasText:'Fixture song '+id}).click();
        await page.waitForFunction(id=>location.hash==='#song='+id&&document.querySelector('#content').getAttribute('aria-busy')==='false',id);
      };
      const choose=async value=>{
        await page.locator('#track-picker').click();
        const option=page.locator('input[name="part"][value="'+value+'"]');
        if(!await option.isVisible())await page.getByText('Other instruments',{exact:true}).click();
        await option.check();
      };
      const stored=()=>page.evaluate(key=>JSON.parse(localStorage.getItem(key)),storageKey);
      const selection=async(id,parts,label)=>{
        if(label){assert.equal(await page.locator('#track-picker').evaluate(el=>el.firstChild.textContent),label);assert.equal(await page.locator('input[name="part"]:checked').count(),1);assert.equal(await page.locator('input[name="part"]:checked').inputValue(),parts);}
        assert.equal((await stored()).recent.find(s=>s.songId===id)?.parts,parts);
      };
      const requests=async(id,parts)=>{
        for(const button of ['#preview-tab','#download-pdf']){
          const before=scoreRequests.length;await page.locator(button).click();
          await page.waitForFunction(()=>document.querySelector('#content').getAttribute('aria-busy')==='false');
          assert.equal(scoreRequests.length,before+1);assert.deepEqual(scoreRequests.at(-1),{songId:id,parts});
        }
      };
      return {page,context,errors,open,choose,stored,selection,requests};
    };
    const check=async(initial,body)=>{const h=await session(initial);try{await body(h);assert.deepEqual(h.errors,[]);}finally{await h.context.close();}};
    await t.test('fresh vocal-first song defaults to all real guitars and preview/PDF agree',()=>check(undefined,async h=>{
      await h.open(101);await h.selection(101,'5,9','All guitar tracks');await h.requests(101,'5,9');
      await h.page.locator('#save-tab').click();assert.equal((await h.stored()).saved[0].parts,'5,9');
    }));
    await t.test('in-page song switch cannot copy a colliding vocal ID; explicit vocals restore',()=>check(undefined,async h=>{
      await h.open(101);await h.choose('5');await h.choose('0');await h.selection(101,'0','Vocals');
      await h.page.evaluate(()=>window.selectionDocumentMarker='same-document');
      await h.open(102);assert.equal(await h.page.evaluate(()=>window.selectionDocumentMarker),'same-document');await h.selection(102,'7','Solo guitar');await h.requests(102,'7');
      await h.open(101);await h.selection(101,'0','Vocals');await h.requests(101,'0');
      await h.page.reload();await h.page.locator('#track-picker').waitFor();await h.selection(101,'0','Vocals');
    }));
    await t.test('saved-only vocals survive recent eviction and later user choices update saved state',()=>check({recent:[],saved:[savedEntry(101,'0')]},async h=>{
      await h.open(101);await h.selection(101,'0','Vocals');await h.requests(101,'0');
      await h.choose('5,9');await h.selection(101,'5,9','All guitar tracks');
      const entry=(await h.stored()).saved.find(s=>s.songId===101);assert.equal(entry.parts,'5,9');assert.equal(entry.collection,'Repertoire');
      await h.page.evaluate(key=>{const value=JSON.parse(localStorage.getItem(key));value.recent=[];localStorage.setItem(key,JSON.stringify(value));},storageKey);
      await h.page.reload();await h.page.locator('#track-picker').waitFor();await h.selection(101,'5,9','All guitar tracks');await h.requests(101,'5,9');
    }));
    await t.test('invalid recent IDs never become checked; valid saved choice is retained',()=>check({recent:[savedEntry(101,'999')],saved:[savedEntry(101,'9')]},async h=>{
      await h.open(101);await h.selection(101,'9','Right guitar');await h.requests(101,'9');
    }));
    await t.test('invalid multi-track values fall back consistently',()=>check({recent:[savedEntry(101,'5,999')],saved:[savedEntry(101,'999')]},async h=>{
      await h.open(101);await h.selection(101,'5,9','All guitar tracks');await h.requests(101,'5,9');
    }));
    await t.test('no-guitar and single-track songs remain usable; All guitar keeps the 12-track limit',()=>check(undefined,async h=>{
      await h.open(103);await h.selection(103,'3','Keys');await h.requests(103,'3');
      await h.open(104);await h.selection(104,'8');assert.equal(await h.page.locator('#track-picker').count(),0);await h.requests(104,'8');
      await h.open(105);await h.selection(105,'1','Guitar 1');
      assert.equal(await h.page.locator('input[name="part"]').evaluateAll(nodes=>nodes.some(n=>n.value.includes(','))),false);await h.requests(105,'1');
      const all=Array.from({length:12},(_,i)=>i+1).join(',');await h.open(106);await h.selection(106,all,'All guitar tracks');await h.requests(106,all);
    }));
  }finally{await browser?.close();server.closeAllConnections();await new Promise(done=>server.close(done));}
});
