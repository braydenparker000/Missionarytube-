import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {requireBrowser} from './helpers/ci-test-inventory.mjs';
import {serveMediaReliabilityFixture,openAstraFixture} from './helpers/media-reliability-fixture.js';

async function navigationFixture(){
  const held=new Map(),releases=new Set(),calls=[];
  const metadata=id=>({id,type:'movie',name:id==='alpha'?'Alpha Clip':id==='beta'?'Beta Clip':id+' result'});
  let fixture;
  fixture=await serveMediaReliabilityFixture({handleRequest:async({pathname,log,json,res,mark})=>{
    if(!pathname.startsWith('/fixture/'))return false;
    if(pathname.endsWith('/manifest.json')){
      json({id:'org.astra.navigation.fixture',name:'Navigation Fixture',version:'1.0.0',resources:['catalog','meta','stream'],types:['movie'],catalogs:[{type:'movie',id:'movies',name:'Fixture movies',extra:[{name:'search'}]}]});return true;
    }
    const kind=pathname.split('/')[2],query=decodeURIComponent(/\/search=([^/]+)\.json$/.exec(pathname)?.[1]||''),id=decodeURIComponent(pathname.split('/').at(-1).replace(/\.json$/,''));
    const key=kind==='catalog'?query:kind+':'+id;calls.push(key);
    const mode=held.get(key);
    if(mode==='hold'){
      await new Promise(resolve=>{log.release=resolve;releases.add(resolve);log.held=true;mark('held');});
    }
    if(mode==='error'){log.status=503;res.writeHead(503);res.end();return true;}
    if(res.destroyed)return true;
    if(kind==='catalog')json({metas:query?[metadata(query)]:[metadata('alpha'),metadata('beta')]});
    if(kind==='meta')json({meta:metadata(id)});
    if(kind==='stream')json({streams:[{name:'Fixture',title:id+' VP8 WebM',url:fixture.origin+'/__media__/clip.webm'}]});
    return true;
  }});
  return Object.assign(fixture,{held,calls,release(request){request.release();releases.delete(request.release);},async dispose(){for(const release of releases)release();await fixture.close();}});
}

const summary=page=>page.locator('#searchSummary h2');
const submit=async(page,query)=>{await page.locator('#globalSearch').fill(query);await page.locator('#globalSearch').press('Enter');};
const card=(page,title)=>page.locator('.card[data-open]').filter({hasText:title}).first();

test('Astra search and navigation keep the latest user intent',{timeout:90000},async t=>{
  const fixture=await navigationFixture();const browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
  const open=async()=>{
    const h=await openAstraFixture(browser,fixture);
    await h.page.emulateMedia({reducedMotion:'reduce'});
    await card(h.page,'Alpha Clip').waitFor();return h;
  };
  try{
    await t.test('choosing a recent search supersedes an unexpired typed-query debounce',async()=>{
      const h=await open();
      try{
        await h.page.evaluate(()=>localStorage.setItem('astra.v1.recentSearches',JSON.stringify(['Pinned choice'])));await h.page.reload();
        await h.page.locator('#mobileNav [data-nav="search"]').click();await h.page.locator('[data-recent-search]').waitFor();
        // Hold only the debounce clock. Browser HTTP still runs normally.
        await h.page.clock.install();await h.page.clock.pauseAt(new Date(Date.now()+100));
        await h.page.locator('#globalSearch').fill('abandoned');
        await h.page.locator('[data-recent-search]').first().click();
        assert.equal(await summary(h.page).textContent(),'Pinned choice');
        await h.page.clock.runFor(350);
        assert.equal(await h.page.locator('#globalSearch').inputValue(),'Pinned choice');
        assert.equal(await summary(h.page).textContent(),'Pinned choice','an old debounce must not replace the selected search');
        assert.equal(fixture.calls.includes('abandoned'),false,'abandoned query must not reach providers');
        assert.deepEqual(h.errors,[]);
      }finally{await h.context.close();}
    });
    await t.test('rapid searches cancel the old HTTP request and reject its late result',async()=>{
      const h=await open();fixture.held.set('oldquery','hold');fixture.held.set('newquery','hold');
      try{
        await h.page.locator('#mobileNav [data-nav="search"]').click();await submit(h.page,'oldquery');
        const old=await fixture.waitForRequest(r=>r.path.includes('search=oldquery')&&r.held);
        await submit(h.page,'newquery');const fresh=await fixture.waitForRequest(r=>r.path.includes('search=newquery')&&r.held);
        await fixture.waitForRequest(r=>r.id===old.id&&r.aborted);
        fixture.release(fresh);await card(h.page,'newquery result').waitFor();fixture.release(old);
        assert.equal(await summary(h.page).textContent(),'newquery');assert.equal(await card(h.page,'oldquery result').count(),0);
        assert.deepEqual(h.errors,[]);
      }finally{await h.context.close();}
    });
    await t.test('leaving Search cancels its request and a late answer cannot reopen it',async()=>{
      const h=await open();fixture.held.set('leaving','hold');
      try{
        await h.page.locator('#mobileNav [data-nav="search"]').click();await submit(h.page,'leaving');
        const pending=await fixture.waitForRequest(r=>r.path.includes('search=leaving')&&r.held);
        await h.page.locator('#mobileNav [data-nav="home"]').click();await fixture.waitForRequest(r=>r.id===pending.id&&r.aborted);
        fixture.release(pending);
        assert.equal(await h.page.locator('#page-home').evaluate(el=>el.classList.contains('active')),true);
        assert.equal(await h.page.locator('#searchRoot').innerHTML(),'');assert.deepEqual(h.errors,[]);
      }finally{await h.context.close();}
    });
    await t.test('closing a held metadata lookup aborts it and keeps the detail dismissed',async()=>{
      const h=await open();fixture.held.set('meta:alpha','hold');
      try{
        await card(h.page,'Alpha Clip').click();const pending=await fixture.waitForRequest(r=>r.path.endsWith('/meta/movie/alpha.json')&&r.held&&!r.aborted);
        await h.page.locator('#modalRoot [data-close]').click();await fixture.waitForRequest(r=>r.id===pending.id&&r.aborted);
        fixture.release(pending);await h.page.waitForFunction(()=>!document.querySelector('#modalRoot').children.length);
        assert.equal(await h.page.locator('#mediaEl').count(),0);assert.deepEqual(h.errors,[]);
      }finally{fixture.held.delete('meta:alpha');await h.context.close();}
    });
    await t.test('closing a held source lookup aborts it without reviving sources or media',async()=>{
      const h=await open();fixture.held.set('stream:alpha','hold');
      try{
        await card(h.page,'Alpha Clip').click();await h.page.locator('[data-get-streams]').first().click();
        const pending=await fixture.waitForRequest(r=>r.path.endsWith('/stream/movie/alpha.json')&&r.held&&!r.aborted);
        await h.page.getByRole('button',{name:'Close sources',exact:true}).click();await fixture.waitForRequest(r=>r.id===pending.id&&r.aborted);
        fixture.release(pending);await h.page.waitForFunction(()=>!document.querySelector('#streamOverlayRoot').children.length);
        assert.equal(await h.page.locator('#mediaEl').count(),0);assert.deepEqual(h.errors,[]);
      }finally{fixture.held.delete('stream:alpha');await h.context.close();}
    });
    await t.test('browser Back cancels pending sources and late replies cannot restore the player',async()=>{
      const h=await open();fixture.held.set('stream:alpha','hold');
      try{
        await h.page.goto(fixture.origin+'/notes/');await h.page.goto(fixture.origin+'/media/');
        await card(h.page,'Alpha Clip').click();await h.page.locator('[data-get-streams]').first().click();
        const pending=await fixture.waitForRequest(r=>r.path.endsWith('/stream/movie/alpha.json')&&r.held&&!r.aborted);
        await h.page.goBack();await fixture.waitForRequest(r=>r.id===pending.id&&r.aborted);fixture.release(pending);
        assert.equal(new URL(h.page.url()).pathname,'/notes/');assert.equal(await h.page.locator('#mediaEl').count(),0);assert.deepEqual(h.errors,[]);
      }finally{fixture.held.delete('stream:alpha');await h.context.close();}
    });
    await t.test('an offline search stays failed until explicit Retry after returning online',async()=>{
      const h=await open();
      try{
        await h.page.locator('#mobileNav [data-nav="search"]').click();await h.context.setOffline(true);await submit(h.page,'offlinequery');
        const retry=h.page.locator('[data-search-retry]');await retry.waitFor();
        const before=fixture.calls.filter(q=>q==='offlinequery').length;
        await h.context.setOffline(false);assert.equal(fixture.calls.filter(q=>q==='offlinequery').length,before);
        await retry.click();await card(h.page,'offlinequery result').waitFor();
        assert.equal(fixture.calls.filter(q=>q==='offlinequery').length,before+1);assert.deepEqual(h.errors,[]);
      }finally{await h.context.setOffline(false);await h.context.close();}
    });
    await t.test('provider errors stay bounded and repeated Retry taps recover once',async()=>{
      const h=await open();fixture.held.set('recover','error');
      try{
        await h.page.locator('#mobileNav [data-nav="search"]').click();await submit(h.page,'recover');
        const retry=h.page.locator('[data-search-retry]');await retry.waitFor();
        const before=fixture.calls.filter(q=>q==='recover').length;
        fixture.held.set('recover','hold');await retry.evaluate(button=>{button.click();button.click();});
        const pending=await fixture.waitForRequest(r=>r.path.includes('search=recover')&&r.held);
        assert.equal(fixture.calls.filter(q=>q==='recover').length,before+1);
        fixture.release(pending);await card(h.page,'recover result').waitFor();assert.deepEqual(h.errors,[]);
      }finally{fixture.held.delete('recover');await h.context.close();}
    });
  }finally{await browser.close();await fixture.dispose();}
});

test('Astra catalog choices distinguish movie and series catalogs with the same provider name',{timeout:30000},async()=>{
  const catalogs=['Popular','New','Featured'].flatMap((name,index)=>['movie','series'].map(type=>({id:'catalog'+index,name,type})));
  const fixture=await serveMediaReliabilityFixture({handleRequest:({pathname,json})=>{
    if(pathname==='/fixture/manifest.json'){
      json({id:'catalog-label-fixture',name:'Cinemeta',version:'1.0.0',resources:['catalog'],types:['movie','series'],catalogs});return true;
    }
    const match=/^\/fixture\/catalog\/(movie|series)\/(catalog\d)\.json$/.exec(pathname);
    if(match){json({metas:[{id:match[1]+'-'+match[2],type:match[1],name:match[1]+' '+catalogs.find(c=>c.id===match[2]).name}]});return true;}
    return false;
  }});
  const browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
  try{
    const h=await openAstraFixture(browser,fixture);await h.page.emulateMedia({reducedMotion:'reduce'});
    await h.page.locator('#mobileNav [data-nav="search"]').click();
    const picker=h.page.locator('#discoverCatalog');await picker.waitFor();
    const options=await picker.locator('option').evaluateAll(nodes=>nodes.slice(1).map(n=>({value:n.value,label:n.textContent})));
    assert.equal(options.length,6,'both content types must remain selectable');
    assert.equal(new Set(options.map(o=>o.value)).size,6,'catalog identities must remain distinct');
    assert.equal(new Set(options.map(o=>o.label)).size,6,'different catalogs must not have indistinguishable labels');
    for(const title of ['Popular','New','Featured'])for(const [type,label] of [['movie','Movie'],['series','Series']]){
      await picker.selectOption({label:`${title} · ${label} · Cinemeta`});
      await h.page.waitForFunction(expected=>{
        const cards=[...document.querySelectorAll('#discoverResults .card[data-open]')];
        return cards.length===1&&cards[0].textContent.includes(expected);
      },type+' '+title);
    }
    await picker.selectOption('all');await h.page.waitForFunction(()=>document.querySelectorAll('#discoverResults .card[data-open]').length===6);
    assert.deepEqual(h.errors,[]);
  }finally{await browser.close();await fixture.close();}
});
