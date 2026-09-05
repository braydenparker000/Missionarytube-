import test from 'node:test';
import assert from 'node:assert/strict';
import {loadPlayback,plain} from './helpers/playback.mjs';
const PB=await loadPlayback();
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('fast addon results appear immediately, final addon and stream order stay intact',async()=>{
  const jobs=[deferred(),deferred(),deferred()],updates=[];
  const lookup=PB.sourceLoader.create({providers:[0,1,2],load:i=>jobs[i].promise,onUpdate:s=>updates.push(s)});
  jobs[2].resolve(['C1','C2']);await tick();
  assert.deepEqual(plain(updates[0].streams),['C1','C2']);assert.equal(updates[0].pending,2);
  jobs[0].resolve(['A2','A1']);jobs[1].resolve(['B1']);
  assert.deepEqual(plain((await lookup.done).streams),['A2','A1','B1','C1','C2']);
});
test('one failing addon leaves working sources available',async()=>{
  const lookup=PB.sourceLoader.create({providers:[0,1],load:async i=>{if(i)throw Error();return ['works'];},onUpdate:()=>{}});
  const done=await lookup.done;assert.equal(done.failed,1);assert.equal(done.pending,0);assert.deepEqual(plain(done.streams),['works']);
});
test('closing a lookup aborts its requests and suppresses late rendering',async()=>{
  let signal,updates=0;const job=deferred();
  const lookup=PB.sourceLoader.create({providers:[0],load:(_i,_order,s)=>{signal=s;return job.promise;},onUpdate:()=>updates++});
  lookup.cancel();assert.equal(signal.aborted,true);job.resolve(['late']);await lookup.done;assert.equal(updates,0);
});
const original='https://torrentio.strem.fun/resolve/torbox/'+'test-token/'+'a'.repeat(40)+'/movie.mkv/0/movie.mkv';
const answer=data=>({ok:true,json:async()=>({success:true,data})});
test('TorBox matches the exact hash and file, never treating Torrentio index as TorBox ID',async()=>{
  const calls=[];
  const result=await PB.delivery.resolve(original,{fetch:async(url,init)=>{calls.push({url,init});return calls.length===1?answer([{hash:'a'.repeat(40),id:7,files:[{id:42,short_name:'movie.mkv'}]}]):answer('https://media.example.test/movie.mkv');}});
  assert.equal(result,'https://media.example.test/movie.mkv');assert.equal(calls.length,2);
  assert.equal(calls[0].init.headers.Authorization,'Bearer test-token');
  assert.equal(new URL(calls[1].url).searchParams.get('file_id'),'42');assert.equal(new URL(calls[1].url).searchParams.get('redirect'),'false');
  assert.equal(calls[1].init.headers.Authorization,undefined);
  for(const call of calls){assert.equal(call.init.redirect,'error');assert.equal(call.init.credentials,'omit');assert.equal(call.init.referrerPolicy,'no-referrer');}
});
test('ambiguous TorBox filenames preserve the original URL without requesting a different file',async()=>{
  let calls=0;
  const result=await PB.delivery.resolve(original,{fetch:async()=>{calls++;return answer([{hash:'a'.repeat(40),id:7,files:[{id:1,name:'one/movie.mkv'},{id:2,name:'two/movie.mkv'}]}]);}});
  assert.equal(result,original);assert.equal(calls,1);
});
test('TorBox API failure is not a dead end for the original playback path',async()=>{
  assert.equal(await PB.delivery.resolve(original,{fetch:async()=>{throw TypeError('blocked');}}),original);
});
test('lookalike resolver hosts never receive account requests',async()=>{
  let calls=0;const url=original.replace('torrentio.strem.fun','torrentio.example.test');
  assert.equal(await PB.delivery.resolve(url,{fetch:async()=>calls++}),url);assert.equal(calls,0);
});
test('cancelled TorBox resolution does not return a stale usable link',async()=>{
  const controller=new AbortController();controller.abort();
  await assert.rejects(PB.delivery.resolve(original,{signal:controller.signal,fetch:async()=>{throw new DOMException('cancelled','AbortError');}}),{name:'AbortError'});
});
