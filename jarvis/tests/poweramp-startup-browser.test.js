import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright-core';
import {requireBrowser} from './helpers/ci-test-inventory.mjs';
import {fixtureWav,mobileContext,servePowerampFixture,sourceFlags} from './helpers/poweramp-fixture.js';

test('saved native R2 plays before refresh and phone diagnostics copy has a selectable fallback',{timeout:60000},async()=>{
  const fixture=await servePowerampFixture(),browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
  const context=await browser.newContext(mobileContext),bytes=fixtureWav(),sha=createHash('sha256').update(bytes).digest('hex');
  const endpoint='https://music.example.test/music/library.json',id='r2_native_'+sha;
  const catalog={version:1,kind:'r2-library',complete:true,count:1,generatedAt:'2026-10-12T00:00:00Z',tracks:[{
    id,sha256:sha,audioKey:'native/audio/'+sha+'.opus',size:bytes.length,mimeType:'audio/wav',path:'Fixture.opus',folder:'Fixture',
    r2Identity:{size:bytes.length,etag:'a'.repeat(32),lastModified:'2026-10-12T00:00:00Z'},metadata:{title:'Private fixture title',artist:'Fixture',dur:75}
  }]};
  let catalogReads=0,audioReads=0,release;const held=new Promise(resolve=>{release=resolve;});const errors=[];
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===fixture.origin&&url.pathname==='/assets/r2-config.json')return route.fulfill({json:{manifestURL:endpoint,rootId:''}});
    if(url.href===endpoint){if(++catalogReads>1)await held;return route.fulfill({json:catalog,headers:{'Access-Control-Allow-Origin':'*'}});}
    if(url.origin==='https://music.example.test'&&url.pathname==='/music/library/audio/'+id){audioReads++;return route.fulfill({body:bytes,contentType:'audio/wav',headers:{'Access-Control-Allow-Origin':'*'}});}
    if(url.origin===fixture.origin)return route.continue();return route.abort('blockedbyclient');
  });
  await context.addInitScript(flags=>localStorage.setItem('drawercast.sources.v1',JSON.stringify({...flags,r2:true})),sourceFlags);
  const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  try{
    await page.goto(fixture.origin+'/drawercast/');
    await page.waitForFunction(()=>PA.R2Source.mapping&&!PA.R2Source.busy);
    assert.ok(await page.evaluate(()=>PA.IDB.get('kv','r2-native-snapshot')));
    await page.reload();
    await page.waitForFunction(()=>PA.R2Source.mapping&&PA.R2Source.busy&&PA.Engine.current);
    assert.equal(audioReads,0,'restored discovery does not autoplay or prefetch audio');
    await page.locator('#btn-play').tap();await page.waitForFunction(()=>PA.Engine.playing&&PA.Engine.time()>.2);
    assert.ok(audioReads>0);await page.evaluate(()=>window.selectedBeforeRefresh=PA.Engine.current);
    release();await page.waitForFunction(()=>!PA.R2Source.busy);
    assert.equal(await page.evaluate(()=>PA.Engine.current===selectedBeforeRefresh&&PA.Engine.wantsPlayback()),true,'refresh cannot replace the selected object during playback');
    await page.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.copiedPlayback=text;}}});PA.R2Source.show();});
    await page.getByRole('button',{name:'Copy playback diagnostics',exact:true}).tap();
    await page.waitForFunction(()=>window.copiedPlayback);
    const copied=await page.evaluate(()=>copiedPlayback);assert.ok(JSON.parse(copied).events.some(e=>e.event==='r2-cache-restored'));
    assert.doesNotMatch(copied,/https?:|Private fixture title|r2_native_|secret/i);
    await page.evaluate(()=>{navigator.clipboard.writeText=async()=>{throw Error('Clipboard unavailable');};PA.R2Source.show();});
    await page.getByRole('button',{name:'Copy playback diagnostics',exact:true}).tap();
    const field=page.getByRole('textbox',{name:'Playback diagnostics',exact:true});await field.waitFor();
    assert.equal(JSON.parse(await field.inputValue()).schema,'poweramp-playback-v1');assert.equal(await field.getAttribute('readonly'),'');
    assert.deepEqual(errors,[]);
  }finally{release();await context.close();await browser.close();await fixture.close();}
});
