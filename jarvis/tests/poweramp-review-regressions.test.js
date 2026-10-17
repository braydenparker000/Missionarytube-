import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

// Use the production Engine dispatch, manual-fade wrapper, and transition
// implementation together. A stub playIndex would hide accepted async fades.
function localFadeHarness({pos=0}={}){
  const loads=[],renders=[],timers=new Map();let timerId=0;
  const UI={renderNowPlaying:t=>renders.push(t?.id),renderPlayState(){},startLoop(){},renderProgress(){}};
  const context=vm.createContext({UI,SET:{audioMode:'custom',crossfadeLen:2,previousRestarts:false},
    AudioQuality:{reset(){},refreshGain(){}},SourceLibrary:{kind:()=> 'local'},
    DriveSource:{pumpTags(){},status:''},R2Source:{status:''},
    sourceTrackEnabled:t=>!!t&&!t.disabled,nativeValues:()=>({fade_manual_advance:1}),
    PlaybackQueue:{pending:[],active:false,resume:null,shouldStart:()=>false},
    getFileFor:t=>new Promise((resolve,reject)=>loads.push({id:t.id,resolve,reject})),
    audioSource:file=>file.url,persistTrack(){},toast(){},debounce:fn=>fn,
    setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(section('const Engine = {','function SET_shuffleOn()')+
    section('const PlaybackTransitions={','function upcomingTracks()')+
    section('function restoreTrackStepOrigin(','/* Shared finger tracking:')+
    '\nglobalThis.engine=Engine;globalThis.transitions=PlaybackTransitions;',context);
  const Engine=context.engine;
  const audio=()=>({src:'',ended:false,currentTime:0,duration:200,readyState:1,pause(){},play:()=>Promise.resolve(),removeAttribute(){this.src='';},load(){}});
  Object.assign(Engine,{queue:['A','B','C','D'].map(id=>({id,dur:200})),order:[0,1,2,3],pos,playing:true,
    _playRequest:1,els:[audio(),audio()],cur:0,time:()=>0,ensureCtx(){},releaseSlot(){},setGain(){},
    applySpeed(){},rgGain:()=>1,saveState(){},updateMediaSession(){}});
  Engine.current=Engine.queue[pos];
  vm.runInContext(section('  const playIndex=Engine.playIndex;','  Engine.setGain=function(i,value,ms)')+
    section('  const pause=Engine.pause;','  const next=Engine.next;'),context);
  return {Engine,loads,renders,context};
}
const flush=()=>new Promise(setImmediate);

test('configured local manual fades accept rapid Next and advance the requested occurrence',()=>{
  const h=localFadeHarness();assert.equal(h.Engine.next(),true);assert.equal(h.Engine.next(),true);
  assert.deepEqual(h.loads.map(load=>load.id),['B','C']);assert.equal(h.Engine.current.id,'A');assert.equal(h.Engine.pos,2);
  assert.equal(h.context.transitions.pending,true,'configured asynchronous fades remain enabled');
});

test('configured local manual fades accept rapid Previous and retain occurrence progression',()=>{
  const h=localFadeHarness({pos:2});assert.equal(h.Engine.prev(),true);assert.equal(h.Engine.prev(),true);
  assert.deepEqual(h.loads.map(load=>load.id),['B','A']);assert.equal(h.Engine.current.id,'C');assert.equal(h.Engine.pos,0);
});

test('failure of the final superseding local fade restores the audible occurrence',async()=>{
  const h=localFadeHarness();h.Engine.next();h.Engine.next();h.loads[1].resolve(null);await flush();
  assert.equal(h.Engine.current.id,'A');assert.equal(h.context.transitions.pending,false);
  assert.equal(h.Engine.pos,0,'B was only a canceled request, so it cannot become the rollback cursor');
  assert.deepEqual(h.renders,['A']);
});

test('failure of an abandoned local fade cannot roll back the newer requested occurrence',async()=>{
  const h=localFadeHarness();h.Engine.next();h.Engine.next();h.loads[0].reject(Error('abandoned'));await flush();
  assert.equal(h.Engine.pos,2);assert.equal(h.context.transitions.pending,true);assert.deepEqual(h.renders,[]);
  h.loads[1].resolve({url:'fixture:C'});await flush();assert.equal(h.Engine.current.id,'C');assert.equal(h.Engine.pos,2);
});

test('successful latest local fade retains its current occurrence after the older file resolves',async()=>{
  const h=localFadeHarness();h.Engine.next();h.Engine.next();h.loads[1].resolve({url:'fixture:C'});await flush();
  h.loads[0].resolve({url:'fixture:B'});await flush();
  assert.equal(h.Engine.current.id,'C');assert.equal(h.Engine.pos,2);assert.deepEqual(h.renders,['C']);
});

function miniSettleHarness({withSeek=false}={}){
  let now=1000,sequence=0;const nodes=new Map(),timers=new Map(),frames=new Map(),calls=[];
  const makeNode=()=>{
    const events=new Map(),classes=new Set();
    const node={style:{},dataset:{},clientWidth:393,clientHeight:700,hidden:false,children:[],
      classList:{add(...values){values.forEach(value=>classes.add(value));},remove(...values){values.forEach(value=>classes.delete(value));},contains:value=>classes.has(value)},
      addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},removeEventListener(){},
      setAttribute(){},getAttribute(){return null;},closest(){return null;},setPointerCapture(){},hasPointerCapture:()=>false,
      contains(target){return target===node;},appendChild(child){this.children.push(child);},remove(){},
      cloneNode(){const ghost=makeNode(),parts=new Map();ghost.removeAttribute=()=>{};ghost.querySelectorAll=()=>[];ghost.querySelector=selector=>{if(!parts.has(selector))parts.set(selector,makeNode());return parts.get(selector);};return ghost;},
      fire(type,values={}){const event={type,pointerId:1,pointerType:'touch',isPrimary:true,button:0,clientX:150,clientY:250,timeStamp:now,detail:1,target:node,preventDefault(){},stopPropagation(){},stopImmediatePropagation(){},...values};for(const fn of events.get(type)||[])fn(event);return event;}};
    return node;
  };
  const $=selector=>{if(!nodes.has(selector))nodes.set(selector,makeNode());return nodes.get(selector);};
  const document=makeNode();document.body=makeNode();const window=makeNode();
  const Engine={current:{id:'A'},_playRequest:1};
  const context=vm.createContext({document,window,$,SCREENS:{},Nav:{cur:'list',go:name=>calls.push(['nav',name])},Engine,
    SET:{animations:'normal',swipeToChange:true,longPressMenu:false},ScreenDrag:{state:null,pause(){},complete(){},returnInterrupted:()=>false},
    SwipeArt:{cached:()=>null,warm:async()=>null},UI:{setArtEl(){}},trackSub:()=>'',el:()=>makeNode(),vibrate(){},
    resolveTrackStep:direction=>({direction,track:{id:direction>0?'B':'previous',title:'Preview'}}),commitTrackStep:()=>{calls.push('track-step');return true;},
    clamp:(value,min,max)=>Math.max(min,Math.min(max,value)),matchMedia:()=>({matches:false}),performance:{now:()=>now},
    setTimeout(fn,ms=0){timers.set(++sequence,{fn,at:now+ms});return sequence;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame(fn){frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:id=>frames.delete(id)});
  vm.runInContext(section('const InputLifecycle=','const Nav=')+section('const GestureMotion=','const SwipeArt=')+
    section('function setupMiniGestures()','function setupPlayerSwipeDown()')+'\nsetupMiniGestures();globalThis.lifecycle=InputLifecycle;',context);
  if(withSeek){
    Object.assign(Engine,{duration:()=>200,time:()=>40,seek:seconds=>calls.push(['seek',seconds])});
    Object.assign(context,{Waveform:{span:()=>90},fmtTime:String});Object.assign(context.UI,{renderProgress(){},drawViz(){}});
    vm.runInContext(section('function paintSeekFraction(','function setupVizGestures()')+'\nsetupSeekGestures();',context);
  }
  const mini=$('#mini'),seek=$('#mini-seek'),play=$('#mini-play');
  mini.contains=target=>[mini,seek,play].includes(target);
  for(const child of [seek,play])child.closest=selector=>selector==='#mini-play,.mini-seek'?child:null;
  const advance=ms=>{now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}};
  const swipe=()=>{
    document.fire('pointerdown',{target:mini});mini.fire('pointerdown');advance(100);
    mini.fire('pointermove',{clientX:30});for(const [id,fn] of [...frames]){frames.delete(id);fn();}
    advance(130);document.fire('pointerup',{target:mini,clientX:30});mini.fire('pointerup',{clientX:30});
  };
  return {context,document,mini,seek,play,calls,advance,swipe};
}

for(const child of ['seek','play'])test('mini-player '+child+' contact cancels a pending horizontal track step',()=>{
  const h=miniSettleHarness();h.swipe();assert.ok(h.context.lifecycle.motionSettle);
  h.document.fire('pointerdown',{pointerId:2,target:h[child]});h.mini.fire('pointerdown',{pointerId:2,target:h[child]});
  h.advance(500);assert.deepEqual(h.calls,[],'the excluded child never resumes the mini gesture, so its new contact must retire the old step');
  assert.equal(h.context.lifecycle.motionSettle,null);
});

for(const cancel of ['pause','seek'])test(cancel+' cancels pending local fades and restores the original audible occurrence',async()=>{
  const h=localFadeHarness();h.Engine.next();h.Engine.next();assert.equal(h.Engine.pos,2);
  if(cancel==='pause')h.Engine.pause();else h.Engine.seek(40);
  assert.equal(h.Engine.current.id,'A');assert.equal(h.Engine.pos,0);assert.equal(h.context.transitions.pending,false);
  h.loads[1].resolve({url:'fixture:C'});h.loads[0].resolve({url:'fixture:B'});await flush();
  assert.equal(h.Engine.current.id,'A');assert.equal(h.Engine.pos,0,'late canceled files cannot revive the requested occurrence');
});

test('stopping pending local fades cannot restore a stale occurrence into the empty queue',async()=>{
  const h=localFadeHarness();h.Engine.next();h.Engine.next();h.Engine.stop();
  assert.equal(h.Engine.current,null);assert.equal(h.Engine.pos,-1);assert.equal(h.Engine.queue.length,0);
  h.loads[1].resolve({url:'fixture:C'});h.loads[0].resolve({url:'fixture:B'});await flush();
  assert.equal(h.Engine.current,null);assert.equal(h.Engine.pos,-1);
});

test('mini-player keyboard seeking retires a pending horizontal track step',()=>{
  const h=miniSettleHarness({withSeek:true});h.swipe();assert.ok(h.context.lifecycle.motionSettle);
  h.seek.fire('keydown',{key:'ArrowRight'});assert.deepEqual(h.calls,[['seek',45]]);
  h.advance(500);assert.deepEqual(h.calls,[['seek',45]],'the old delayed track step cannot preempt the keyboard seek');
  assert.equal(h.context.lifecycle.motionSettle,null);
});

// Palette updates are explicit producers; a cached canvas accent cannot remain old.
test('an explicit palette update invalidates the existing waveform accent immediately',()=>{
  const vars={},UI={vizAccent:'old',vizAccentAt:1000,lastArtImg:null};
  const context=vm.createContext({UI,SET:{accent:'amber'},ACCENTS:{amber:[32,38]},isLightUI:()=>true,setVars:value=>Object.assign(vars,value),document:{querySelector:()=>null},extractPalette:()=>null});
  vm.runInContext(section('function applyPalette(img){','try{\n  window.matchMedia'),context);
  vm.runInContext('applyPalette(null);',context);
  assert.equal(UI.vizAccentAt,0,'next real draw must refresh its accent rather than waiting 250ms');assert.match(vars['--accent'],/^hsl/);
});
