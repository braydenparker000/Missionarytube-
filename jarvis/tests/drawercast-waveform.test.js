import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Execute the actual waveform component without booting the monolithic player UI.
const source=await readFile(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const start=source.indexOf('const PreparedWaveform={');
const end=source.indexOf('\nfunction installLyricsRework()',start);
assert.ok(start>=0&&end>start);
function harness({cached,remoteFile=true,cacheRead,response}={}){
  const calls={files:0,fetch:0,decode:0,reads:0,writes:0,draw:0};
  const context=vm.createContext({
    Float32Array,Uint8Array,Map,AbortController,Blob,DataView,setTimeout,clearTimeout,
    UI:{drawViz(){calls.draw++;}},
    clamp:(x,min,max)=>Math.max(min,Math.min(max,x)),
    IDB:{async get(){return cacheRead?cacheRead():cached;},async set(){calls.writes++;}},
    async getFileFor(){calls.files++;return remoteFile?
      {__remoteURL:'http://music.example.test/audio/track',size:32}:
      {size:32,async arrayBuffer(){calls.reads++;return new ArrayBuffer(32);}};},
    DrawerCast:{waveformURL:t=>t.waveformVersion===1?'http://music.example.test/waveform/track':null},
    async fetch(url,options){calls.fetch++;calls.url=url;calls.signal=options.signal;if(response)return response;throw new Error('Waveform must not download streamed audio');},
    window:{OfflineAudioContext:class{async decodeAudioData(){calls.decode++;return {
      duration:1,sampleRate:16,length:16,numberOfChannels:1,
      getChannelData(){return new Float32Array(16).fill(.5);}
    };}}}
  });
  const waveform=vm.runInContext(source.slice(start,end)+'\nWaveform;',context);
  function select(track){waveform.load(track);clearTimeout(waveform.timer);}
  return {waveform,calls,select,context};
}

test('uncached A15 waveform never opens or downloads a second audio stream',async()=>{
  const {waveform,calls,select}=harness();
  select({id:'remote',remote:true,dur:180});await waveform.run();
  assert.equal(calls.files,0);assert.equal(calls.fetch,0);assert.equal(calls.decode,0);
  assert.equal(waveform.ready,false);
  waveform.sample(Uint8Array.of(128,192,64),12,180);
  assert.equal(waveform.level(12,12.0625),.5);
  assert.equal(waveform.level(15,16),null);
});

test('cached remote waveform remains available without opening media',async()=>{
  const {waveform,calls,select}=harness({cached:{duration:2,peaks:Uint8Array.of(255,128)}});
  select({id:'cached-remote',remote:true,dur:2});await waveform.run();
  assert.equal(waveform.ready,true);assert.equal(waveform.level(0,.0625),1);
  assert.equal(calls.files,0);assert.equal(calls.fetch,0);assert.equal(calls.decode,0);
});

test('a remote media descriptor cannot trigger a download even without the track flag',async()=>{
  const {waveform,calls,select}=harness();
  select({id:'descriptor-only',dur:180});await waveform.run();
  assert.equal(calls.fetch,0);assert.equal(calls.decode,0);
});

test('local files still receive a complete decoded and cached waveform',async()=>{
  const {waveform,calls,select}=harness({remoteFile:false});
  select({id:'local',dur:1});await waveform.run();
  assert.equal(calls.fetch,0);assert.equal(calls.decode,1);assert.equal(calls.reads,1);
  assert.equal(calls.writes,1);assert.equal(waveform.ready,true);
  assert.equal(waveform.peaks.length,16);assert.equal(waveform.level(0,1),1);
});

test('changing tracks while cache loads cannot apply the previous waveform',async()=>{
  let resolveCache;
  const {waveform,calls,select}=harness({cacheRead:()=>new Promise(resolve=>{resolveCache=resolve;})});
  select({id:'old',remote:true,dur:1});const pending=waveform.run();
  select(null);resolveCache({duration:1,peaks:Uint8Array.of(255)});await pending;
  assert.equal(waveform.id,null);assert.equal(waveform.ready,false);
  assert.equal(calls.files,0);assert.equal(calls.fetch,0);assert.equal(calls.draw,0);
});

function prepared(durationMs=1000){
  const data=new Uint8Array(16+Math.ceil(durationMs*16/1000)),view=new DataView(data.buffer);
  view.setUint32(0,0x44435731);view.setUint32(4,durationMs);view.setUint32(8,data.length-16);view.setUint16(12,16);data.fill(200,16);return data;
}
test('capable server returns only a compact waveform, cached by file revision',async()=>{
  const response=new Response(prepared());
  const {waveform,calls,select}=harness({response});
  select({id:'remote',remote:true,waveformVersion:1,mtime:100,size:10000,dur:1});await waveform.run();
  assert.equal(calls.files,0);assert.equal(calls.fetch,1);assert.match(calls.url,/\/waveform\//);assert.equal(calls.decode,0);
  assert.equal(waveform.ready,true);assert.equal(calls.writes,1);assert.equal(waveform.peaks.length,16);
  select({id:'remote',remote:true,waveformVersion:1,mtime:101,size:10000,dur:1});
  assert.equal(waveform.ready,false,'edited song must not reuse stale peaks');select(null);
});
test('not-yet-prepared waveform falls back without requesting audio',async()=>{
  const {waveform,calls,select}=harness({response:new Response('',{status:404})});
  select({id:'remote',remote:true,waveformVersion:1,dur:180});await waveform.run();
  assert.equal(waveform.ready,false);assert.equal(calls.fetch,1);assert.equal(calls.files,0);assert.equal(calls.decode,0);
});
test('malformed and oversized waveform responses cannot allocate unbounded peaks',async()=>{
  for(const response of [new Response(new Uint8Array(32)),new Response(prepared(),{headers:{'content-length':'10000000'}})]){
    const {waveform,calls,select}=harness({response});select({id:'bad',remote:true,waveformVersion:1,dur:1});await waveform.run();
    assert.equal(waveform.ready,false);assert.equal(calls.writes,0);assert.equal(calls.files,0);assert.equal(calls.signal.aborted,true);
  }
});
test('new server capability triggers loading even when the same track is selected',()=>{
  const {waveform,select}=harness();const t={id:'same',remote:true,dur:1};select(t);const token=waveform.token;
  t.waveformVersion=1;select(t);assert.equal(waveform.token,token+1);select(null);
});
function renderer(h,{time=1,duration=2,staticBar=false}={}){
  h.context.Engine={current:{id:'render',remote:true,dur:duration},playing:false,time:()=>time,duration:()=>duration};
  h.context.SET={nativeSeekbar:staticBar?1:0,waveBars:44};h.context.isLightUI=()=>false;
  const a=source.indexOf('  UI.drawWaveSeek=function(',source.indexOf('function installLyricsRework()'));
  const b=source.indexOf('\n  };',a);
  vm.runInContext(source.slice(a,b+5),h.context);
  h.select(h.context.Engine.current);
  const bars=[],clips=[],fills=[];const g={globalAlpha:1,fillStyle:'',beginPath(){},fill(){fills.push(this.globalAlpha);},save(){},restore(){},clip(){},
    rect(...r){clips.push(r);},roundRect(...r){bars.push(r);},fillRect(){}};
  return {g,bars,clips,fills,draw:()=>h.context.UI.drawWaveSeek(g,440,40,null,'#f4ddcb',1)};
}
test('loaded prepared waveform draws populated bars in both whole-track and centered views',()=>{
  for(const staticBar of [false,true]){const h=harness(),r=renderer(h,{staticBar});
    h.waveform.accept({duration:2,peaks:new Uint8Array(32).fill(200)});r.draw();
    assert.ok(r.bars.length>0);assert.ok(r.bars.every(([x,y,w,height])=>Number.isFinite(x)&&w>0&&height>2.5&&height<=40));
    assert.ok(r.fills.includes(.28)&&r.fills.includes(.78));assert.ok(r.clips.length<=2);
  }
});
test('progressive waveform draws sampled audio without inventing bars for unloaded time',()=>{
  const h=harness(),r=renderer(h,{time:5,duration:20});h.waveform.sample(Uint8Array.of(64,192),5,20);r.draw();
  assert.ok(r.bars.length>0);assert.ok(r.bars.length<44);
  assert.equal(h.waveform.level(10,11),null);assert.equal(h.calls.files,0);assert.equal(h.calls.fetch,0);
});
test('waveform bars away from the playhead draw once without clipping',()=>{
  const h=harness(),r=renderer(h,{staticBar:true});h.waveform.accept({duration:2,peaks:new Uint8Array(32).fill(200)});r.draw();
  assert.equal(r.bars.length,44);assert.equal(r.clips.length,0);
  assert.ok(r.fills.includes(.28)&&r.fills.includes(.78));
});
test('only the waveform bar crossing the playhead retains the exact split',()=>{
  const h=harness(),r=renderer(h,{staticBar:true,time:1.01});h.waveform.accept({duration:2,peaks:new Uint8Array(32).fill(200)});r.draw();
  assert.equal(r.bars.length,45);assert.equal(r.clips.length,2);
  assert.deepEqual(r.clips[0],[0,0,222.2,40]);assert.deepEqual(r.clips[1],[222.2,0,217.8,40]);
});
