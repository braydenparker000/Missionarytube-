import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(process.env.POWERAMP_PLAYER_FILE||new URL('../public/drawercast/player.js',import.meta.url),'utf8');
function node(){const handlers={};return {handlers,style:{setProperty(){}},hidden:false,clientWidth:100,classList:{add(){},remove(){},contains:()=>false},dataset:{},setAttribute(){},closest:()=>null,addEventListener(n,fn){(handlers[n]??=[]).push(fn)},setPointerCapture(){},hasPointerCapture:()=>false,getBoundingClientRect:()=>({left:0,width:100}),fire(type,event={}){const e={type,pointerId:1,pointerType:'touch',isPrimary:true,button:0,detail:1,clientX:20,clientY:20,target:this,preventDefault(){this.prevented=true},stopPropagation(){},stopImmediatePropagation(){this.stopped=true},...event};for(const fn of handlers[type]||[]){fn(e);if(e.stopped)break;}if(type==='click'&&!e.prevented)this.onclick?.(e);return e;}};}
function harness(){
  let now=1000,sequence=0;const timers=new Map(),intervals=new Map(),nodes=new Map(),seeks=[],skips=[];
  const Engine={current:{id:'one'},_playRequest:1,duration:()=>100,time:()=>20,seek:v=>seeks.push(v),seekBy:v=>seeks.push(v)};
  const context=vm.createContext({Engine,UI:{renderProgress(){},drawViz(){}},SET:{seekStep:10,seekStyle:'wave'},
    performance:{now:()=>now},setTimeout:fn=>{timers.set(++sequence,fn);return sequence},clearTimeout:id=>timers.delete(id),setInterval:fn=>{intervals.set(++sequence,fn);return sequence},clearInterval:id=>intervals.delete(id),
    requestAnimationFrame:fn=>{timers.set(++sequence,fn);return sequence},cancelAnimationFrame:id=>timers.delete(id),
    $:id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id)},document:{body:node(),addEventListener(){}},window:{addEventListener(){}},
    vibrate(){},proSkip:d=>skips.push(d),clamp:(v,l,h)=>Math.max(l,Math.min(h,v)),fmtTime:String,Waveform:{span:()=>100}});
  vm.runInContext(source.slice(source.indexOf('const InputLifecycle='),source.indexOf('const Nav=')),context);
  vm.runInContext(source.slice(source.indexOf('function paintSeekFraction('),source.indexOf('function setupSeekGestures(')),context);
  return {context,Engine,seeks,skips,nodes,timers,intervals,advance:ms=>now+=ms,flush(){for(const [id,fn] of [...timers]){timers.delete(id);fn()}}};
}
test('a short category tap skips once; a held seek never also skips',()=>{
  const h=harness();vm.runInContext(source.slice(source.indexOf('function bindTapButton('),source.indexOf('function setupSeekGestures(')),h.context);
  const b=node();b.dataset.act='ff';h.context.b=b;vm.runInContext('bindTransportButton(b)',h.context);
  b.fire('pointerdown');b.fire('pointerup');b.fire('click');assert.deepEqual(h.skips,[1]);assert.deepEqual(h.seeks,[]);
  b.fire('pointerdown');h.advance(450);h.flush();b.fire('pointerup');b.fire('click');
  assert.deepEqual(h.seeks,[10]);assert.deepEqual(h.skips,[1]);assert.equal(h.intervals.size,0);
});
test('moving a held category button cancels its timer and trailing click',()=>{
  const h=harness();vm.runInContext(source.slice(source.indexOf('function bindTapButton('),source.indexOf('function setupSeekGestures(')),h.context);
  const b=node();b.dataset.act='rew';h.context.b=b;vm.runInContext('bindTransportButton(b)',h.context);
  b.fire('pointerdown');b.fire('pointermove',{clientX:50});h.flush();b.fire('pointerup');b.fire('click');
  assert.deepEqual(h.seeks,[]);assert.deepEqual(h.skips,[]);
});
function seekHarness(){const h=harness();const start=source.indexOf('function setupSeekGestures('),end=source.indexOf('\nfunction ',start+10);vm.runInContext(source.slice(start,end)+'\nsetupSeekGestures();',h.context);return h;}
test('seek ignores a second pointer and commits only the original gesture',()=>{
  const h=seekHarness(),bar=h.nodes.get('#seek');bar.fire('pointerdown');bar.fire('pointerup',{pointerId:2,clientX:90});assert.deepEqual(h.seeks,[]);
  bar.fire('pointerup',{clientX:65});assert.deepEqual(h.seeks,[65]);assert.equal(h.context.UI.seekDragging,false);
});
test('canceled capture or a changed song cannot receive the old scrub position',()=>{
  const h=seekHarness(),bar=h.nodes.get('#seek');bar.fire('pointerdown');bar.fire('lostpointercapture');bar.fire('pointerup',{clientX:90});assert.deepEqual(h.seeks,[]);
  bar.fire('pointerdown');h.Engine._playRequest++;bar.fire('pointerup',{clientX:70});assert.deepEqual(h.seeks,[]);assert.equal(h.context.UI.seekDragging,false);
});
test('vertical travel over a transport button does not initiate waveform scrubbing',()=>{
  const h=seekHarness(),tr=h.nodes.get('#transport'),target={closest:()=>({})};
  tr.fire('pointerdown',{target});tr.fire('pointermove',{clientX:27,clientY:70});tr.fire('pointerup',{clientX:27,clientY:70});assert.deepEqual(h.seeks,[]);
});
