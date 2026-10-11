import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const block=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function harness(){
  const revoked=[];let renders=0;
  const context=vm.createContext({AudioQuality:{reset(){},refreshGain(){}},setTimeout,clearTimeout,debounce:fn=>fn,
    SourceLibrary:{kind:t=>t?.source||(t?.remote?'server':'local')},R2Source:{status:''},URL:{revokeObjectURL:u=>revoked.push(u)},
    SET:{fadeOnPause:false},UI:{renderPlayState(){renders++;},renderProgress(){},startLoop(){}},toast(){}});
  const {Engine,PlaybackTransitions}=vm.runInContext(block('const Engine = {','function SET_shuffleOn()')+
    block('const PlaybackTransitions={','function installPlaybackRework()')+
    block('function restoreTrackStepOrigin(','/* Shared finger tracking:')+'\n({Engine,PlaybackTransitions})',context);
  const audio=src=>({src,preload:'auto',paused:false,loads:0,events:{},pause(){this.paused=true;},removeAttribute(){this.src='';},load(){this.loads++;},addEventListener(name,fn){this.events[name]=fn;},removeEventListener(name){delete this.events[name];},play(){this.paused=false;return {catch:fn=>{this.reject=fn;}};}});
  Engine.els=[audio('http://music.example.test/audio/current'),audio('http://music.example.test/audio/next')];
  const ensureCtx=Engine.ensureCtx;
  Engine.cur=0;Engine.setGain=()=>{};Engine.ensureCtx=()=>{};Engine.updateMediaSession=()=>{};Engine._playRequest=1;
  return {Engine,PlaybackTransitions,ensureCtx,ctx:context,revoked,renders:()=>renders};
}
test('metadata-only selected songs can seek before Play, including a refreshed catalog record',()=>{
 const {Engine,ctx}=harness();ctx.LIB={map:new Map([['saved',{id:'saved',dur:180}]])};
 Engine.current={id:'saved',dur:0};Engine.dur=0;Engine.els[0].src='';Engine.els[0].duration=999;
 assert.equal(Engine.duration(),180,'an unloaded slot cannot supply an unrelated duration');
 Engine.seek(126);assert.equal(Engine.time(),126);assert.equal(Engine._resumePosition.id,'saved');
 Engine.els[0].src='https://audio.test/current';Engine.els[0].duration=181;assert.equal(Engine.duration(),181);
 Engine._loadingRequest=2;Engine.dur=180;assert.equal(Engine.duration(),180,'the abandoned media slot cannot override a loading song');
});
test('routing into Web Audio clears retained element volume while slot gains stay separate',()=>{
  const {Engine,ensureCtx,ctx}=harness();
  const node=()=>{const n={connect(){}};for(const k of ['gain','frequency','Q','threshold','knee','ratio','attack','release'])n[k]={value:0};return n;};
  class AudioContext{constructor(){this.state='running';}createGain(){return node();}createBiquadFilter(){return node();}createStereoPanner(){return node();}createDynamicsCompressor(){return node();}createAnalyser(){return node();}createConvolver(){return node();}createDelay(){return node();}createChannelSplitter(){return node();}createChannelMerger(){return node();}createMediaElementSource(){return node();}}
  ctx.window={AudioContext};ctx.FREQ_SETS={16:Array.from({length:16},(_,i)=>20*(i+1))};
  Engine.els[0].volume=.25;Engine.els[1].volume=0;Engine.applyEQ=()=>{};Engine.applyVolume=()=>{};Engine.applyReverb=()=>{};
  assert.ok(ensureCtx.call(Engine));assert.deepEqual(Engine.els.map(a=>a.volume),[1,1]);
  assert.deepEqual([...Engine.gains].map(g=>g.gain.value),[1,0]);
});
test('cancelled transition releases spare streaming request',()=>{
  const {Engine,PlaybackTransitions}=harness();Engine.preloadId='unused';PlaybackTransitions.cancel();
  assert.equal(Engine.els[1].src,'');assert.equal(Engine.els[1].loads,1);assert.equal(Engine.preloadId,null);
  assert.match(Engine.els[0].src,/current$/);
});
test('gapless handoff retains the matching preloaded song',()=>{
  const {Engine,PlaybackTransitions}=harness();Engine.preloadId='next';PlaybackTransitions.cancel(true,'next');
  assert.match(Engine.els[1].src,/next$/);assert.equal(Engine.els[1].loads,0);assert.equal(Engine.preloadId,'next');
  PlaybackTransitions.cancel(true,'different');assert.equal(Engine.els[1].src,'');
});
test('released local object URLs are revoked',()=>{
  const {Engine,revoked}=harness();Engine.els[1].src='blob:local-track';Engine.releaseSlot(1);
  assert.deepEqual(revoked,['blob:local-track']);assert.equal(Engine.els[1].preload,'metadata');
});
test('late failure of an abandoned play attempt cannot pause the new track',()=>{
  const {Engine,renders}=harness();Engine.play();const reject=Engine.els[0].reject;
  Engine._playRequest++;Engine.els[0].src='http://music.example.test/audio/new';Engine.onPlaying(0);const activeRenders=renders();reject({name:'NotSupportedError'});
  assert.equal(Engine.playing,true);assert.equal(renders(),activeRenders);
});

for(const cloud of ['drive','r2'])test('rapid manual '+cloud+' skips select immediately without awaiting cloud crossfade readiness',async()=>{
  const calls=[],fades=[];
  const Engine={queue:[{id:'one',source:cloud},{id:'two',source:cloud},{id:'three',source:cloud}],current:{id:'one',source:cloud},playing:true,
    el:()=>({ended:false}),cancelSleepFade(){},async playIndex(index){this.current=this.queue[index];calls.push(index);}};
  const ctx=vm.createContext({AudioQuality:{reset(){},refreshGain(){}},sourceTrackEnabled:t=>!!t,Engine,PlaybackTransitions:{cancel(){},to(index){fades.push(index);return new Promise(()=>{});}},
    nativeValues:()=>({fade_manual_advance:1}),clearTimeout,SET:{crossfadeLen:2}});
  const wrapper=source.slice(source.indexOf('  const playIndex=Engine.playIndex;'),source.indexOf('  Engine.setGain=function(i,value,ms)'));
  vm.runInContext(wrapper,ctx);
  const second=Engine.playIndex(1,true),third=Engine.playIndex(2,true);
  assert.equal(Engine.current.id,'three');assert.deepEqual(calls,[1,2]);assert.deepEqual(fades,[]);await Promise.all([second,third]);
  Engine.current={id:'local-old'};Engine.queue=[{id:'local-new'}];Engine.playIndex(0,true);assert.deepEqual(fades,[0],'local manual fades are unchanged');
});

test('a streamed Ogg duration arriving after loadedmetadata updates the track and its saved duration',()=>{
  const saved=[];
  class Audio {constructor(){this.events={};this.duration=Infinity;}setAttribute(){}addEventListener(name,fn){this.events[name]=fn;}}
  const ctx=vm.createContext({Audio,debounce:fn=>fn,document:{body:{appendChild(){}}},UI:{renderProgress(){},renderMeta(){}},persistTrack:t=>saved.push({...t})});
  const Engine=vm.runInContext(block('const Engine = {','function SET_shuffleOn()')+'\nEngine',ctx);Engine.init();Engine.current={id:'stream',dur:0};
  Engine.els[0].events.loadedmetadata();assert.equal(saved.length,0);
  Engine.els[0].duration=210;Engine.els[0].events.durationchange();assert.equal(Engine.current.dur,210);assert.equal(saved[0].dur,210);
  Engine.els[1].duration=999;Engine.els[1].events.durationchange();assert.equal(Engine.current.dur,210);
});

test('Drive metadata cannot reset the retry budget and an old timer cannot restart playback',()=>{
  const {Engine,ctx}=harness(),timers=[],messages=[];let retries=0,plays=0;
  ctx.setTimeout=fn=>{timers.push(fn);return timers.length};
  ctx.toast=message=>messages.push(message);
  ctx.UI.renderProgress=()=>{};ctx.UI.renderMeta=()=>{};
  ctx.DriveSource={retryFileFor:()=>({__remoteURL:'https://drive.test/audio?retry='+ ++retries}),playbackRetry:new Map()};
  ctx.audioSource=file=>file.__remoteURL;
  Engine.current={id:'gd_song',source:'drive',dur:100};
  Engine.els[0].duration=100;
  Engine.els[0].play=()=>{plays++;return Promise.resolve()};
  Engine.onError(0);
  Engine.onMeta(0); // Drive can report metadata before the stream fails again.
  Engine.onError(0);
  assert.equal(retries,1,'one retry per selection, even if metadata arrived');
  assert.equal(messages.filter(message=>message.includes('still could not play')).length,1);
  Engine._playRequest++; // The user selected this same song again before the old timer fired.
  timers[0]();
  assert.equal(plays,0,'a stale retry must not start the new selection');
});

test('Drive retry resumes the interrupted position and reports only one terminal error',()=>{
  const {Engine,ctx}=harness(),timers=[],messages=[];let starts=0;
  ctx.setTimeout=fn=>{timers.push(fn);return timers.length};
  ctx.toast=message=>messages.push(message);
  ctx.DriveSource={retryFileFor:()=>({__remoteURL:'https://drive.test/audio?retry=1'})};
  ctx.audioSource=file=>file.__remoteURL;
  Engine.current={id:'gd_song',source:'drive',remote:true};Engine.playing=true;
  Engine.els[0].currentTime=42;Engine.els[0].duration=100;
  Engine.els[0].play=()=>{starts++;return Promise.resolve()};
  Engine.onError(0);
  Engine.els[0].currentTime=0;Engine.els[0].events.loadedmetadata();
  assert.equal(Engine.els[0].currentTime,42);
  timers[0]();assert.equal(starts,1);
  Engine.onError(0);Engine.onError(0);
  assert.equal(Engine.playing,false);
  assert.equal(messages.filter(message=>message.includes('still could not play')).length,1);
});

test('Drive initial play rejection uses bounded retry, while a silent start arms the stall timer',()=>{
  const {Engine,ctx}=harness(),timers=[];let retries=0;
  ctx.setTimeout=fn=>{timers.push(fn);return timers.length};
  ctx.DriveSource={retryFileFor:()=>({__remoteURL:'https://drive.test/audio?retry='+ ++retries})};
  ctx.audioSource=file=>file.__remoteURL;
  Engine.current={id:'gd_song',source:'drive',remote:true};
  Engine.play();assert.equal(timers.length,1,'a pending initial play has a watchdog');
  Engine.els[0].reject({name:'NotSupportedError'});
  assert.equal(retries,1);
  Engine._playRequest++;timers.at(-1)();assert.equal(Engine.playing,false,'an abandoned retry cannot restart playback');
});

test('pausing a pending Drive retry prevents its timer from starting audio',()=>{
  const {Engine,ctx}=harness(),timers=[];let starts=0;
  ctx.setTimeout=fn=>{timers.push(fn);return timers.length};
  ctx.clearTimeout=id=>{if(id)timers[id-1]=()=>{}};
  ctx.DriveSource={retryFileFor:()=>({__remoteURL:'https://drive.test/audio?retry=1'}),pumpTags(){},status:''};
  ctx.audioSource=file=>file.__remoteURL;
  Engine.current={id:'gd_song',source:'drive',remote:true};Engine.playing=true;
  Engine.els[0].play=()=>{starts++};
  Engine.onError(0);Engine.pause();timers[0]();
  assert.equal(starts,0);assert.equal(Engine.playing,false);
});

test('tapping Play after a terminal Drive rejection starts a fresh selection',()=>{
  const {Engine}=harness();let selected=0,starts=0;
  Engine.current={id:'gd_song',source:'drive',remote:true};
  Engine.queue=[Engine.current];Engine.order=[0];Engine.pos=0;
  Engine._driveErrorReportedId='gd_song';
  Engine.playIndex=(index,autoplay)=>{selected++;assert.equal(index,0);assert.equal(autoplay,true)};
  Engine.els[0].play=()=>{starts++};
  Engine.play();assert.equal(selected,1);assert.equal(starts,0);
});

test('a new selection stops the previous stream while its file is loading',async()=>{
  const {Engine,ctx}=harness();let resolveFile,advances=0,starts=0;
  ctx.sourceTrackEnabled=()=>true;
  ctx.DriveSource={prioritize(){},playbackRetry:new Map()};
  ctx.DrawerCast={canPlay:()=>true};
  ctx.getFileFor=()=>new Promise(resolve=>{resolveFile=resolve});
  ctx.audioSource=f=>f.__remoteURL;
  ctx.UI.renderNowPlaying=()=>{};
  Engine.queue=[{id:'old'},{id:'new'}];Engine.order=[0,1];Engine.current=Engine.queue[0];Engine.playing=true;
  Engine.applySpeed=()=>{};Engine.rgGain=()=>1;Engine.saveState=()=>{};
  Engine.next=()=>{advances++};Engine.play=()=>{starts++;Engine.playing=true};
  const pending=Engine.playIndex(1,true);
  assert.equal(Engine.els[0].paused,true);assert.equal(Engine.els[0].src,'');
  assert.equal(Engine.playing,false);
  Engine.onEnded(0);Engine.onError(0);
  assert.equal(advances,0,'late events from the abandoned stream do not advance the new selection');
  resolveFile({__remoteURL:'https://music.example.test/new'});await pending;
  assert.equal(Engine.els[0].src,'https://music.example.test/new');assert.equal(starts,1);
});

test('play waits for a missing source to load before asking the audio element to play',()=>{
  const {Engine}=harness();let selections=0,starts=0;
  Engine.els[0].src='';Engine.els[0].play=()=>{starts++};
  Engine.queue=[{id:'song'}];Engine.order=[0];Engine.pos=0;Engine.playIndex=()=>{selections++};
  Engine.play();assert.equal(selections,1);assert.equal(starts,0);
});

test('A15 network failure retries once and then reports a durable error',()=>{
  const {Engine,ctx}=harness(),timers=[],messages=[];let starts=0,errors=0;
  ctx.setTimeout=fn=>{timers.push(fn);return timers.length};
  ctx.toast=message=>messages.push(message);
  ctx.DrawerCast={fileFor:()=>({__remoteURL:'http://192.168.4.1:8765/audio/song?k=key'}),markError:()=>{errors++}};
  ctx.audioSource=file=>file.__remoteURL;
  Engine.current={id:'dc_song',remote:true,source:'server'};Engine.playing=true;
  Engine.els[0].currentTime=42;Engine.els[0].error={code:2};
  Engine.els[0].play=()=>{starts++;return Promise.resolve()};
  Engine.onError(0);
  assert.equal(starts,0);assert.match(Engine.els[0].src,/retry=/);
  Engine.els[0].duration=90;Engine.els[0].events.loadedmetadata();
  assert.equal(Engine.els[0].currentTime,42,'the retry keeps the playhead when metadata arrives');
  timers[0]();assert.equal(starts,1);
  Engine.onError(0);Engine.onError(0);
  assert.equal(errors,1);assert.equal(Engine.playing,false);
  assert.equal(messages.filter(message=>message.includes('retrying once')).length,1);
});

test('A15 silent stall invokes the same bounded retry and a stale timer cannot play a new song',()=>{
  const {Engine,ctx}=harness(),timers=[];let starts=0;
  ctx.setTimeout=fn=>{timers.push(fn);return timers.length};
  ctx.DrawerCast={fileFor:()=>({__remoteURL:'http://192.168.4.1:8765/audio/song?k=key'}),markError(){}};
  ctx.audioSource=file=>file.__remoteURL;
  Engine.current={id:'dc_song',remote:true,source:'server'};Engine.playing=true;Engine.els[0].currentTime=12;
  Engine.els[0].play=()=>{starts++;return Promise.resolve()};
  Engine.onBuffering(0);timers[0]();
  assert.match(Engine.els[0].src,/retry=/);
  Engine._playRequest++;timers[1]();assert.equal(starts,0);
});

test('saved queue rejects a damaged order rather than indexing outside the library',async()=>{
  const {Engine,ctx}=harness();
  const tracks=[{id:'one',remote:true},{id:'two',remote:true}];
  ctx.SET.keepQueue=true;ctx.LIB={map:new Map(tracks.map(t=>[t.id,t]))};
  ctx.sourceTrackEnabled=t=>!!t;
  ctx.IDB={get:async()=>({ids:['one','two'],order:[99,99],curId:'one'})};
  ctx.UI.renderNowPlaying=()=>{};ctx.UI.renderProgress=()=>{};
  assert.equal(await Engine.restoreState(),true);
  assert.deepEqual(Array.from(Engine.order),[0,1]);assert.equal(Engine.current.id,'one');
});

test('the installed end-of-track handler ignores old and delayed endings',()=>{
  const {Engine,ctx}=harness(),timers=[];let advances=0;
  ctx.setTimeout=fn=>{timers.push(fn);return timers.length};
  ctx.nativeValues=()=>({track_end_silence_ms:50});ctx.persistTrack=()=>{};
  vm.runInContext(block('  Engine.onEnded=function(i){','  Engine.startCrossfade=function()'),ctx);
  Engine.current={id:'new'};Engine.playing=true;Engine._playIntent=true;Engine.el().ended=true;Engine.countPlayed=()=>{};Engine.next=()=>{advances++};
  Engine._loadingRequest=Engine._playRequest;
  Engine.onEnded(0);assert.equal(timers.length,0);
  Engine._loadingRequest=null;Engine.onEnded(0);assert.equal(timers.length,1);
  Engine._playRequest++;timers[0]();assert.equal(advances,0);
});

function installed(){
  const h=harness(),{Engine,ctx}=h,values={queue_no_shuffle:false,queue_start:2,queue_end:1};
  const nodes=new Map();
  Object.assign(ctx,{sourceTrackEnabled:t=>!!t&&!t.disabled,LIB:{map:new Map()},nativeValues:()=>values,
    trackAlbum:t=>t?.album||'',trackArtist:t=>t?.artist||'',shuffleArray:a=>a.slice().reverse(),
    Views:{buildItems(){},counts:()=>({}),buildFabs(){},refreshAll(){},refreshQueueOrder(){}},ctxMenuList(){},
    $:id=>{if(!nodes.has(id))nodes.set(id,{setAttribute(){},getAttribute(){}});return nodes.get(id);},$$:()=>[],icoHTML:()=>'',saveSet(){},
    localStorage:{getItem:()=>null,setItem(){}},persistTrack(){},clamp:(x,l,h)=>Math.max(l,Math.min(h,x)),
    DriveSource:{prioritize(){},api:{},playbackRetry:new Map(),pumpTags(){},status:''},DrawerCast:{canPlay:()=>true},
    getFileFor:async t=>({__remoteURL:'https://audio.test/'+t.id}),audioSource:f=>f.__remoteURL});
  Object.assign(ctx.UI,{renderToggles(){},renderNowPlaying(){},renderProgress(){},renderMeta(){}});
  vm.runInContext(block('const PlaybackQueue={','const PlaybackTransitions={')+block('function installPlaybackRework(){','/* Synced lyrics')+'\ninstallPlaybackRework();',ctx);
  const Queue=vm.runInContext('PlaybackQueue',ctx);
  Engine.applySpeed=()=>{};Engine.rgGain=()=>1;Engine.saveState=()=>{};
  Engine.els.forEach(a=>Object.assign(a,{readyState:1,duration:200,currentTime:0}));
  return {...h,Queue,values};
}
test('shuffle starts on the selected occurrence and includes every song exactly once',()=>{
  const {Engine,ctx}=installed();ctx.SET.shuffleOn=true;ctx.SET.shuffleMode=1;
  const same={id:'duplicate'};Engine.queue=[same,{id:'middle'},same,{id:'end'}];Engine.order=[0,1,2,3];Engine.pos=0;Engine.current=same;
  Engine.playIndex=function(i){this.current=this.queue[i]};Engine.setQueue(Engine.queue,2,false);
  assert.equal(Engine.order[0],2);assert.equal(Engine.pos,0);
  assert.deepEqual([...Engine.order].sort(),[0,1,2,3]);
});
test('all shuffle modes retain every occurrence after the starting song',()=>{
  const {Engine,ctx}=installed();Engine.queue=[{id:'a',album:'Hits',artist:'A'},{id:'b',album:'Hits',artist:'B'},{id:'c',album:'Hits',artist:'A'}];
  for(let mode=1;mode<=4;mode++){ctx.SET.shuffleOn=true;ctx.SET.shuffleMode=mode;Engine.buildOrder(1);assert.equal(Engine.order[0],1);assert.equal(new Set(Engine.order).size,3);}
});
test('rapid skips preserve playback intent while sources load; Pause cancels the final start',async()=>{
  const {Engine,ctx}=installed(),pending=[];ctx.getFileFor=t=>new Promise(resolve=>pending.push({id:t.id,resolve}));
  Engine.queue=['a','b','c'].map(id=>({id,source:'drive'}));Engine.order=[0,1,2];Engine.pos=0;Engine.current=Engine.queue[0];Engine.playing=true;
  const first=Engine.playIndex(1,true);Engine.next();assert.equal(Engine.current.id,'c');assert.equal(Engine.wantsPlayback(),true);
  Engine.toggle();assert.equal(Engine.wantsPlayback(),false);
  pending.forEach(p=>p.resolve({__remoteURL:'https://audio.test/'+p.id}));await first;await Promise.resolve();
  assert.equal(Engine.playing,false);assert.equal(Engine.el().src,'');
});
test('rapid skip starts the final selected song and ignores late prior sources',async()=>{
  const {Engine,ctx}=installed(),pending=[];ctx.getFileFor=t=>new Promise(resolve=>pending.push({id:t.id,resolve}));
  Engine.queue=['a','b','c'].map(id=>({id,source:'drive'}));Engine.order=[0,1,2];Engine.current=Engine.queue[0];Engine.pos=0;Engine.playing=true;
  const first=Engine.playIndex(1,true);Engine.next();pending[1].resolve({__remoteURL:'https://audio.test/c'});await new Promise(setImmediate);
  assert.equal(Engine.wantsPlayback(),true);assert.equal(Engine.playing,false,'a pending play promise is not actual playback');Engine.el().readyState=4;Engine.onPlaying(Engine.cur);assert.equal(Engine.playing,true);assert.match(Engine.el().src,/\/c$/);
  pending[0].resolve({__remoteURL:'https://audio.test/b'});await first;assert.match(Engine.el().src,/\/c$/);Engine.clearBuffering();
});
test('restored remote position is shown before loading and applied when metadata is ready',async()=>{
  const {Engine,ctx}=installed(),track={id:'a',remote:true,source:'drive'};
  ctx.SET.keepQueue=true;ctx.LIB.map.set('a',track);ctx.IDB={get:async()=>({ids:['a'],order:[0],curId:'a',time:42})};
  Engine.el().src='';Engine.el().readyState=0;Engine.el().duration=NaN;
  assert.equal(await Engine.restoreState(),true);assert.equal(Engine.time(),42);
  Engine.play();await new Promise(setImmediate);assert.equal(Engine.time(),42);
  Engine.el().readyState=1;Engine.el().duration=100;Engine.onMeta(0);assert.equal(Engine.el().currentTime,42);Engine.pause();
});
test('a pending seek cannot leak into the next track, even when metadata is late',async()=>{
  const {Engine}=installed();Engine.queue=[{id:'a'},{id:'b'}];Engine.order=[0,1];Engine.el().readyState=0;
  await Engine.playIndex(0,false,90);assert.equal(Engine.time(),90);
  await Engine.playIndex(1,false);Engine.el().readyState=1;Engine.onMeta(0);assert.equal(Engine.el().currentTime,0);
});
test('queue return preserves duplicate occurrences and remaps a removed earlier track',()=>{
  const {Engine,Queue,ctx}=installed(),a={id:'a'},b={id:'b'};ctx.LIB.map.set('a',a);ctx.LIB.map.set('b',b);
  Queue.active=true;Queue.resume={ids:['gone','a','a','b'],order:[0,2,1,3],pos:1,time:37};
  const calls=[];Engine.playIndex=(...args)=>calls.push(args);Queue.finish();
  assert.deepEqual([...Engine.order],[1,0,2]);assert.deepEqual(calls,[[1,true,37]]);
  Queue.active=true;assert.deepEqual(Queue.tracks().map(t=>t.id),['a','a','b']);Queue.play(2);assert.deepEqual(calls[1],[2,true]);
});
test('queue finish skips removed resume target without transferring its seek offset',()=>{
  const {Engine,Queue,ctx}=installed();ctx.LIB.map.set('b',{id:'b'});Queue.resume={ids:['gone','b'],order:[0,1],pos:0,time:98};
  let selection;Engine.playIndex=(...args)=>selection=args;Queue.finish(false);assert.deepEqual(selection,[0,false,0]);
});
test('autoplay ignores duplicate ended events and delayed ended events after Pause',()=>{
  const {Engine,ctx,values}=installed(),timers=[];values.track_end_silence_ms=50;ctx.setTimeout=fn=>{timers.push(fn);return timers.length};
  Engine.current={id:'a'};Engine.playing=true;Engine._playIntent=true;Engine.el().ended=true;let advances=0;Engine.next=()=>{advances++};Engine.onEnded(0);Engine.onEnded(0);assert.equal(timers.length,1);
  Engine.pause();timers[0]();Engine.onEnded(0);assert.equal(advances,0);
});
test('repeat one re-arms end handling on each completed play',()=>{
  const {Engine,ctx}=installed();ctx.SET.repeatMode='one';Engine.queue=[{id:'a'}];Engine.order=[0];Engine.pos=0;Engine.current=Engine.queue[0];Engine.playing=true;Engine._playIntent=true;Engine.el().ended=true;
  let plays=0;Engine.play=()=>{plays++};Engine.onEnded(0);Engine.onEnded(0);assert.equal(plays,2);assert.equal(Engine.el().currentTime,0);
});
test('a paused Next starts pending queue paused',()=>{
  const {Engine,Queue,ctx}=installed();const a={id:'a'},b={id:'b'};ctx.LIB.map.set('b',b);Engine.queue=[a];Engine.order=[0];Engine.pos=0;Engine.current=a;Queue.pending=['b'];
  let play;Engine.setQueue=(...args)=>play=args;Engine.next();assert.equal(play[2],false);
});
test('saved shuffled queue retains duplicate selection after a source disappears',async()=>{
  const {Engine,ctx}=installed(),a={id:'a',remote:true},b={id:'b',remote:true};ctx.SET.keepQueue=true;ctx.LIB.map.set('a',a);ctx.LIB.map.set('b',b);
  ctx.IDB={get:async()=>({ids:['gone','a','b','a'],order:[2,3,0,1],pos:1,curId:'a',time:12})};
  await Engine.restoreState();assert.deepEqual([...Engine.order],[1,2,0]);assert.equal(Engine.pos,1);assert.equal(Engine.order[Engine.pos],2);
});
test('category skip retains loading playback intent',()=>{
  const {Engine,ctx}=installed();ctx.Views.stack=[];vm.runInContext(block('function proSkip(direction){','function setupRework(){'),ctx);
  Engine.queue=[{id:'a',album:'A'},{id:'b',album:'B'}];Engine.order=[0,1];Engine.pos=0;Engine.current=Engine.queue[0];Engine._loadingRequest=1;Engine._loadingAutoplay=true;
  let args;Engine.playIndex=(...value)=>args=value;vm.runInContext('proSkip(1)',ctx);assert.deepEqual(args,[1,true]);
});
test('reload uses the newer synchronous checkpoint when the database write is delayed',async()=>{
  const {Engine,ctx}=installed(),stored=new Map(),track={id:'a',remote:true};ctx.SET.keepQueue=true;ctx.LIB.map.set('a',track);
  ctx.localStorage={setItem:(key,value)=>stored.set(key,value),getItem:key=>stored.get(key)||null};
  ctx.IDB={set:()=>new Promise(()=>{}),get:async()=>({ids:['a'],order:[0],pos:0,curId:'a',time:1,savedAt:1})};
  Engine.queue=[track];Engine.order=[0];Engine.pos=0;Engine.current=track;Engine.el().currentTime=64;Engine.checkpoint();
  Engine.el().src='';Engine.el().currentTime=0;await Engine.restoreState();assert.equal(Engine.time(),64);
});
test('periodic playback checkpoint captures playhead and explicit queue together',()=>{
  const {Engine,Queue,ctx}=installed(),writes=[];ctx.IDB={set:async(a,b,value)=>writes.push(value)};ctx.SET.gapless=false;ctx.SET.crossfade=false;
  Engine.queue=[{id:'a'}];Engine.order=[0];Engine.pos=0;Engine.current=Engine.queue[0];Engine.playing=true;Engine.el().currentTime=71;Queue.pending=['b'];
  Engine.onTime(0);Engine.onTime(0);assert.equal(writes.length,1);assert.equal(writes[0].time,71);assert.deepEqual([...writes[0].explicitQueue.pending],['b']);
});

test('natural advance retains delayed output; manual changes reset the guard/filter state',async()=>{
  const {Engine,ctx}=installed();let resets=0;ctx.AudioQuality.reset=()=>resets++;
  Engine.queue=[{id:'first'},{id:'second'}];Engine.order=[0,1];Engine.current=Engine.queue[0];Engine.pos=0;
  Engine._autoAdvance=true;await Engine.playIndex(1,false);assert.equal(resets,0,'last queued samples must drain at a natural boundary');
  Engine._autoAdvance=false;await Engine.playIndex(0,false);assert.equal(resets,1,'manual source changes cannot emit stale delayed audio');
});

test('automatic entry to and return from the explicit queue also retains the output tail',async()=>{
  const {Engine,Queue,ctx}=installed();let resets=0;ctx.AudioQuality.reset=()=>resets++;
  const a={id:'a'},b={id:'b'},queued={id:'queued'};
  for(const t of [a,b,queued])ctx.LIB.map.set(t.id,t);
  Engine.queue=[a,b];Engine.order=[0,1];Engine.current=a;Engine.pos=0;Queue.pending=['queued'];
  Engine.next(true);await new Promise(setImmediate);
  assert.equal(Engine.current.id,'queued');assert.equal(resets,0);
  Engine.next(true);await new Promise(setImmediate);
  assert.equal(Engine.current.id,'b');assert.equal(resets,0);
  Engine.next(false);await new Promise(setImmediate);assert.equal(resets,1);
});
