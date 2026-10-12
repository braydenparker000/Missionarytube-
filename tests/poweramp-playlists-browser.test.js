import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {requireBrowser} from './helpers/ci-test-inventory.mjs';
import {servePowerampFixture,openFixturePage} from './helpers/poweramp-fixture.js';

test('playlist imports and one-time curated seeding use durable browser storage',{timeout:60000},async()=>{
  const fixture=await servePowerampFixture(),browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
  const h=await openFixturePage(browser,fixture,{count:3,art:false});
  try{
    await h.page.evaluate(async()=>{await PA.Playlists.save();const tracks=[...PA.LIB.map.values()];tracks[0].path=tracks[1].path;});
    const wanted=await h.page.evaluate(()=>[...PA.LIB.map.values()][1]);
    const choose=h.page.waitForEvent('filechooser');await h.page.evaluate(()=>PA.PlaylistFiles.import());
    await (await choose).setFiles({name:'DrawerCast-playlists.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({format:'DrawerCast-playlists',playlists:[{name:'Imported fixture',tracks:[{id:wanted.id,path:wanted.path},{id:wanted.id}]}]}))});
    await h.page.waitForFunction(()=>PA.Playlists.data.some(p=>p.name==='Imported fixture'));
    const ids=await h.page.evaluate(async()=>({memory:PA.Playlists.data.at(-1).ids,disk:(await PA.IDB.get('kv','playlists')).at(-1).ids}));
    assert.deepEqual(ids.memory,[wanted.id,wanted.id]);assert.deepEqual(ids.disk,ids.memory);
    const result=await h.page.evaluate(async()=>{
      const {PlaylistFiles:F,Playlists:P,R2Source:R}=PA;R.native=true;R.mapping={};
      const lists=Array.from({length:8},(_,i)=>({name:'Curated fixture '+i,tracks:[{id:'r2_fixture_0'}]}));
      const marker='playlist-seed:browser-fixture';await F.apply(lists,{marker,r2Only:true});
      const id=P.data.find(p=>p.name==='Curated fixture 2').id;P.remove(id);await P.writes;
      const edited=P.data.find(p=>p.name==='Curated fixture 1');edited.name='My edit';await P.save();
      await P.load();const again=await F.apply(lists,{marker,r2Only:true});
      return {created:again.created,deleted:!P.data.some(p=>p.id===id),edited:P.data.some(p=>p.name==='My edit'),receipt:await PA.IDB.get('kv',marker)};
    });
    assert.deepEqual(result,{created:0,deleted:true,edited:true,receipt:true});
    const aborted=await h.page.evaluate(async()=>{
      const original=IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction=function(...args){
        const tx=original.apply(this,args);if(args[0]==='kv'&&args[1]==='readwrite'){
          const os=tx.objectStore.bind(tx);tx.objectStore=name=>{const store=os(name),put=store.put.bind(store);store.put=(...values)=>{const request=put(...values);queueMicrotask(()=>{try{tx.abort();}catch(_){}});return request;};return store;};
        }return tx;
      };
      let failed=false;try{await PA.PlaylistFiles.apply([{name:'Must not appear',tracks:[{id:'r2_fixture_0'}]}]);}catch(_){failed=true;}finally{IDBDatabase.prototype.transaction=original;}
      return {failed,memory:PA.Playlists.data.some(p=>p.name==='Must not appear'),disk:(await PA.IDB.get('kv','playlists')).some(p=>p.name==='Must not appear')};
    });
    assert.deepEqual(aborted,{failed:true,memory:false,disk:false});assert.deepEqual(h.errors,[]);
  }finally{await h.context.close();await browser.close();await fixture.close();}
});

test('the actual eight curated playlists seed only after complete R2 readiness without blocking the UI',{timeout:60000},async()=>{
  const {readFile}=await import('node:fs/promises');
  const curated=JSON.parse(await readFile(new URL('../public/drawercast/curated-playlists.json',import.meta.url),'utf8'));
  const fixture=await servePowerampFixture(),browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']});
  const h=await openFixturePage(browser,fixture,{count:3,art:false});let reads=0,release;
  const held=new Promise(r=>release=r);
  await h.context.route('**/curated-playlists.json*',async route=>{if(++reads===2)await held;await route.continue();});
  try{
    await h.page.evaluate(async lists=>{
      const {Playlists:P,PlaylistFiles:F,R2Source:R,LIB}=PA;
      P.data=[{id:'owned',name:'My own playlist',ids:[]}];await P.save();
      window.curatedFixtureTracks=lists.flatMap(p=>p.tracks).map(t=>({...t,source:'r2',remote:false,dur:180}));
      LIB.map=new Map(curatedFixtureTracks.slice(0,1).map(t=>[t.id,t]));LIB.ids=[...LIB.map.keys()];
      R.native=true;R.mapping=null;R.fileFor=t=>LIB.map.has(t.id)?{__remoteURL:'https://fixture.invalid/unused'}:null;
      await F.seed();
    },curated.playlists);
    assert.equal(reads,0,'a nonempty library without native R2 mapping is not ready');
    await h.page.evaluate(async()=>{PA.R2Source.mapping={};await PA.PlaylistFiles.seed();});
    assert.equal(await h.page.evaluate(()=>PA.IDB.get('kv',PA.PlaylistFiles.seedMarker)),undefined,'partial catalog does not consume seed receipt');
    await h.page.evaluate(()=>{PA.LIB.map=new Map(curatedFixtureTracks.map(t=>[t.id,t]));PA.LIB.ids=[...PA.LIB.map.keys()];window.beforeSeedSelection=PA.Engine.current;void PA.PlaylistFiles.seed();PA.Nav.go('library');});
    await h.page.waitForFunction(()=>PA.PlaylistFiles.seeding&&PA.Nav.cur==='library');
    assert.equal(await h.page.evaluate(()=>PA.Playlists.data.length),1,'held artifact fetch does not block navigation or mutate playlists');
    release();await h.page.waitForFunction(()=>PA.PlaylistFiles.seedDone);
    const saved=await h.page.evaluate(async()=>({lists:await PA.IDB.get('kv','playlists'),sameSelection:PA.Engine.current===beforeSeedSelection}));
    assert.equal(saved.sameSelection,true);assert.equal(saved.lists.length,9);
    assert.deepEqual(saved.lists.slice(1).map(p=>({name:p.name,count:p.ids.length})),curated.playlists.map(p=>({name:p.name,count:p.tracks.length})));
    await h.page.evaluate(async()=>{const p=PA.Playlists.data.find(p=>p.id!=='owned');PA.Playlists.remove(p.id);await PA.Playlists.writes;await PA.Playlists.load();PA.PlaylistFiles.seedDone=false;await PA.PlaylistFiles.seed();});
    assert.equal(await h.page.evaluate(()=>PA.Playlists.data.length),8);assert.equal(reads,2,'durable seed receipt prevents re-fetch and resurrection');assert.deepEqual(h.errors,[]);
  }finally{release();await h.context.close();await browser.close();await fixture.close();}
});

test('offline preview playlist writes stay in isolated memory',{timeout:30000},async()=>{
  const {buildPreview}=await import('../scripts/build-poweramp-preview.mjs');const {mkdtemp,rm}=await import('node:fs/promises');
  const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {pathToFileURL}=await import('node:url');
  const directory=await mkdtemp(join(tmpdir(),'playlist-preview-'));const output=join(directory,'preview.html');await buildPreview(output);
  const browser=await chromium.launch({executablePath:requireBrowser(),headless:true,args:['--no-sandbox']}),page=await browser.newPage();
  try{
    await page.addInitScript(()=>{window.persistentOpens=0;indexedDB.open=()=>{persistentOpens++;throw Error('Persistent storage forbidden in preview');};});
    await page.goto(pathToFileURL(output).href);await page.waitForFunction(()=>window.PA?.Playlists.data.length>0);
    const result=await page.evaluate(async()=>{PA.Playlists.create('Preview-only playlist');await PA.Playlists.writes;return {saved:PA.Playlists.persisted.some(p=>p.name==='Preview-only playlist'),opens:persistentOpens};});
    assert.deepEqual(result,{saved:true,opens:0});
  }finally{await browser.close();await rm(directory,{recursive:true,force:true});}
});
