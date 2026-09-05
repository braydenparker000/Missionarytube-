import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {loadPlayback} from './helpers/playback.mjs';
const source=await readFile(new URL('../assets/js/playback/software-player.js',import.meta.url),'utf8');
const PB=await loadPlayback();
const ioDeclaration=await readFile(new URL('../node_modules/@libmedia/common/src/io/error.ts',import.meta.url),'utf8');
const IO_END=Function('return '+ioDeclaration.match(/END = ([^,]+)/)[1])();
function fixture(fetchImpl){
  const engines=[];
  class FakePlayer {
    static IOLoader={CustomIOLoader:class {}};
    static setLogLevel(){}
    constructor(options){this.options=options;this.currentTime=0n;this.handlers={};this.audio=9;this.seeks=[];engines.push(this);}
    on(name,fn){(this.handlers[name]??=[]).push(fn);}
    emit(name){if(name==='ended')this.ended=true;for(const fn of this.handlers[name]||[])fn();}
    async load(io){this.io=io;}
    getStreams(){return [{id:1,mediaType:'Video'},{id:9,mediaType:'Audio',metadata:{language:'en'}},{id:12,mediaType:'Audio',metadata:{language:'ja'}}];}
    getDuration(){return 120000n;}
    getSelectedAudioStreamId(){return this.audio;}
    async selectAudio(id){this.audio=id;this.emit('changed');}
    async play(){this.running=true;}
    async pause(){this.running=false;}
    async resume(){}
    async seek(time){if(this.ended){this.running=true;this.ended=false;}this.emit('seeking');this.currentTime=time;this.seeks.push(time);this.emit('seeked');}
    setPlaybackRate(rate){this.rate=rate;}
    async destroy(){this.destroyed=true;await this.io.stop();}
  }
  const context=vm.createContext({console,URL,Headers,AbortController,DOMException,Event,setTimeout,clearTimeout,Uint8Array,fetch:fetchImpl,AstraPlayback:PB,AVPlayer:FakePlayer,
    MediaStream:class{getTracks(){return[];}},document:{currentScript:{src:'https://example.test/assets/js/playback/software-player.js'},createElement:()=>({remove(){},replaceChildren(){},append(){}})}});
  vm.runInContext(source,context);return {api:context.AstraSoftware,engines,FakePlayer};
}
function media(){
  const m=new EventTarget();Object.assign(m,{currentTime:0,duration:0,paused:true,playbackRate:1,parentNode:{append(){}},play(){this.paused=false;return Promise.resolve();},pause(){this.paused=true;}});return m;
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('software playback uses the decoder timeline, preserves pause and restores media properties on close',async()=>{
  const f=fixture(),m=media(),adapter=f.api.createAdapter({media:m,url:'https://example.test/movie.mkv',startTime:48.7,autoplay:false});
  await adapter.attach();const engine=f.engines[0];
  assert.equal(m.currentTime,48.7);assert.equal(m.duration,120);assert.equal(m.paused,true);assert.equal(engine.running,false);
  assert.equal(m.seekable.length,1);assert.equal(m.seekable.start(0),0);assert.equal(m.seekable.end(0),120);assert.throws(()=>m.seekable.end(1),{name:'IndexSizeError'});
  await m.play();await tick();assert.equal(engine.running,true);
  m.pause();await tick();assert.equal(engine.running,false);
  adapter.seekTo(99);await tick();assert.equal(m.currentTime,99);assert.equal(m.seeking,false);
  engine.emit('ended');adapter.seekTo(2);await tick();assert.equal(m.paused,true);assert.equal(engine.running,false);assert.equal(m.ended,false);
  assert.equal(adapter.getAudioTracks()[1].lang,'ja');assert.equal(adapter.selectAudioTrack('12'),true);await tick();assert.equal(engine.audio,12);
  m.playbackRate=1.5;assert.equal(engine.rate,1.5);
  adapter.destroy();assert.equal(engine.destroyed,true);assert.equal(m.currentTime,0);assert.equal(m.srcObject,null);assert.equal(m.astraCaptionClock,undefined);assert.equal(m.seekable,undefined);
});
test('software preparation can be disposed before it ever replaces native playback',async()=>{
  const f=fixture(),controller=new AbortController();
  const prepared=await f.api.prepare({url:'https://example.test/movie.mkv',signal:controller.signal});
  controller.abort();assert.equal(f.engines[0].destroyed,true);assert.throws(()=>prepared.take(),{name:'AbortError'});
});
test('real software test option bypasses WebCodecs as well as MSE',async()=>{
  const f=fixture(),prepared=await f.api.prepare({url:'https://example.test/movie.mkv',forceSoftware:true});
  assert.equal(f.engines[0].options.enableWebCodecs,false);assert.equal(f.engines[0].options.enableHardware,false);assert.equal(f.engines[0].options.checkUseMSE(),false);
  assert.match(f.engines[0].options.getWasm('decoder',173),/hevc-simd\.wasm$/);prepared.dispose();
});
test('range loader supports exact seeks without rereading or mixing bytes',async()=>{
  const bytes=new Uint8Array([1,2,3,4,5,6]);let calls=0;
  const f=fixture(async(_url,init)=>{calls++;assert.equal(new Headers(init.headers).get('range'),'bytes=0-2097151');return new Response(bytes,{status:206,headers:{'Content-Range':'bytes 0-5/6'}});});
  const io=f.api.source(f.FakePlayer,{url:'https://example.test/movie.mkv'});await io.open();
  const first=new Uint8Array(3);assert.equal(await io.read(first),3);assert.deepEqual([...first],[1,2,3]);
  await io.seek(1n);const second=new Uint8Array(3);await io.read(second);assert.deepEqual([...second],[2,3,4]);assert.equal(calls,1);
  await io.seek(6n);assert.equal(await io.read(first),IO_END);assert.equal(await io.size(),6n);await io.stop();
  await io.open();await io.read(first);assert.deepEqual([...first],[1,2,3]);await io.stop();
});
test('range loader rejects a server returning the wrong bytes',async()=>{
  const f=fixture(async()=>new Response(new Uint8Array([1,2]),{status:206,headers:{'Content-Range':'bytes 3-4/6'}}));
  const io=f.api.source(f.FakePlayer,{url:'https://example.test/movie.mkv'});
  await assert.rejects(io.open(),{playbackCode:'RANGE_UNSUPPORTED'});await io.stop();
});
test('a partial response without exposed size does not become a false EOF',async()=>{
  const ranges=[];
  const f=fixture(async(_url,init)=>{ranges.push(new Headers(init.headers).get('range'));return ranges.length<3?new Response(new Uint8Array([1,2]),{status:206}):new Response(null,{status:416});});
  const io=f.api.source(f.FakePlayer,{url:'https://example.test/movie.mkv'}),bytes=new Uint8Array(8);
  await io.open();assert.equal(await io.read(bytes),2);assert.equal(await io.read(bytes),2);assert.equal(await io.read(bytes),IO_END);
  assert.deepEqual(ranges,['bytes=0-2097151','bytes=2-2097153','bytes=4-2097155']);await io.stop();
});
test('custom headers stay scoped to their original origin and cannot follow redirects',async()=>{
  const url='https://example.test/movie.mkv',policy=PB.requests.analyze(url,{request:{'X-Test-Playback':'sample'}});
  const f=fixture(async(_url,init)=>{assert.equal(init.redirect,'error');assert.equal(new Headers(init.headers).get('x-test-playback'),'sample');return new Response(new Uint8Array([1]),{status:206,headers:{'Content-Range':'bytes 0-0/1'}});});
  const io=f.api.source(f.FakePlayer,{url,requestPolicy:policy});await io.open();await io.stop();
});
