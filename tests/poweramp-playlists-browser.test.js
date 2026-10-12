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
