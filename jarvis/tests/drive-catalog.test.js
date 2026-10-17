import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCatalog,readCatalog,catalogTrack,sha256,validateRecords,commitCatalog} from '../public/drawercast/drive-catalog.js';
const root='folder123456789';
const record=(i=0)=>({id:'track'+String(i).padStart(10,'0'),name:'Song '+i+'.opus',folder:'Music/Album',mimeType:'audio/ogg',size:4000,modifiedTime:'2026-09-28T00:00:00Z',md5Checksum:'abcdef',availability:'ready',prepared:{md5:'abcdef',size:4000,title:'Tagged song',dur:100}});
async function fixture(records){
  const catalog=await buildCatalog(records,{root,name:'Music'});const calls=[];
  return {...catalog,calls,fetcher:async url=>{calls.push(url);return url.endsWith('drive-catalog-v2.json')?Response.json(catalog.pointer):new Response(catalog.shards[Number(url.split('/').at(-1).split('.')[0])]);}};
}
test('10,000 songs load with bounded shards and no Drive requests',async()=>{
  const f=await fixture(Array.from({length:10000},(_,i)=>record(i)));
  const out=await readCatalog({root,fetcher:f.fetcher});assert.equal(out.records.length,10000);
  assert.ok(f.shards.every(s=>s.length<=512*1024));assert.ok(f.calls.every(u=>u.startsWith('/assets/drive-catalog-v2')));
});
test('unchanged pointer downloads no shards',async()=>{
  const f=await fixture([record()]);const out=await readCatalog({root,generation:f.pointer.generation,fetcher:f.fetcher});assert.equal(out.unchanged,true);assert.equal(f.calls.length,1);
});
test('missing, truncated and corrupt shards reject the whole generation',async()=>{
  for(const corrupt of [()=>new Response('',{status:404}),()=>new Response('['),()=>Response.json([record(2)])]){
    const f=await fixture([record()]);await assert.rejects(readCatalog({root,fetcher:u=>u.endsWith('drive-catalog-v2.json')?f.fetcher(u):corrupt()}));
  }
});
test('wrong roots, incomplete pointers and false counts reject',async()=>{
  for(const change of [{rootId:'wrongFolder12345'},{complete:false},{count:2},{generation:'../escape'}]){
    const f=await fixture([record()]);Object.assign(f.pointer,change);await assert.rejects(readCatalog({root,fetcher:f.fetcher}));
  }
});
test('duplicate IDs are rejected even when hashes and counts agree',async()=>{
  const f=await fixture([record()]);const bytes=new TextEncoder().encode(JSON.stringify([record(),record()]));
  f.pointer.count=2;f.pointer.shards=[{bytes:bytes.length,count:2,sha256:await sha256(bytes)}];
  await assert.rejects(readCatalog({root,fetcher:u=>u.endsWith('drive-catalog-v2.json')?Response.json(f.pointer):Promise.resolve(new Response(bytes))}));
});
test('a pointer changing mid-download does not mix generations',async()=>{
  const f=await fixture([record()]);let pointerReads=0;
  const out=await readCatalog({root,fetcher:async u=>{if(u.endsWith('drive-catalog-v2.json'))pointerReads++;return f.fetcher(u);}});
  assert.equal(pointerReads,1);assert.equal(out.records[0].id,record().id);
});
test('folder moves preserve stable identity, ratings and same-revision art',()=>{
  const r=record(),old={id:'gd_'+r.id,rating:5,plays:7,md5:r.md5Checksum,size:r.size,artKey:'saved',driveTagVersion:1};
  const moved=catalogTrack({...r,folder:'Music/Moved'},root,old);
  assert.equal(moved.id,old.id);assert.equal(moved.rating,5);assert.equal(moved.plays,7);assert.equal(moved.artKey,'saved');assert.match(moved.path,/Moved/);
  const changed=catalogTrack({...r,md5Checksum:'new',prepared:null},root,old);assert.equal(changed.artKey,null);assert.equal(changed.rating,5);
});
test('bounds reject path traversal and untrusted cover URLs',()=>{
  assert.throws(()=>validateRecords([{...record(),folder:'Music/../private'}]));
  assert.throws(()=>validateRecords([{...record(),cover:'https://foreign.test/a'}]));
});
test('catalog commit waits for transaction completion and reports abort',async()=>{
  for(const abort of [false,true]){
    let transaction;const db={transaction(stores,mode){assert.deepEqual(stores,['tracks','kv']);assert.equal(mode,'readwrite');transaction={objectStore(){return {openCursor(){return {};}}}};return transaction;}};
    let settled=false;const result=commitCatalog(db,{pointer:{},records:[]}).then(()=>{settled=true;},e=>{settled=true;throw e;});
    await Promise.resolve();assert.equal(settled,false);
    if(abort){transaction.error=Error('Quota exceeded');transaction.onabort();await assert.rejects(result,/Quota/);}else{transaction.oncomplete();await result;}
  }
});

test('initial catalog metadata preserves richer cached tags only for the same revision',()=>{
  const r=record(),old={md5:r.md5Checksum,size:r.size,driveTagVersion:1,title:'Embedded title',album:'Embedded album'};
  const pending={...r,prepared:{md5:r.md5Checksum,size:r.size}};
  const t=catalogTrack(pending,root,old);assert.equal(t.title,'Embedded title');assert.equal(t.album,'Embedded album');
  const changed=catalogTrack({...pending,md5Checksum:'changed'},root,old);assert.equal(changed.album,'');assert.notEqual(changed.title,'Embedded title');
});
