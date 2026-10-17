import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
function renderer(){
  let now=0,id=0;const frames=new Map(),timers=new Map(),listeners=new Map(),nodes=new Map();
  const calls={seek:0,mini:0,progress:0,viz:0,writes:0};
  const document={visibilityState:'visible',addEventListener(type,fn){listeners.set(type,fn);}};
  const UI={loopId:0,loopToken:0,renderProgress(){calls.progress++;},drawViz(){calls.viz++;}};
  const Engine={playing:true,time:()=>20,duration:()=>100};
  const node=()=>{let text='';const attributes=new Map();return {hidden:false,style:{},get textContent(){return text;},set textContent(v){text=v;calls.writes++;},getAttribute:k=>attributes.get(k)??null,setAttribute(k,v){attributes.set(k,v);calls.writes++;}};};
  const context=vm.createContext({UI,Engine,document,Nav:{cur:'library'},SET:{seekStyle:'wave',keepScreenOn:false},InputLifecycle:{contacts:new Set()},
    $:selector=>{if(!nodes.has(selector))nodes.set(selector,node());return nodes.get(selector);},clamp:(v,min,max)=>Math.max(min,Math.min(max,v)),fmtTime:v=>String(v),wakeLock(){},
    paintSeekFraction(){calls.seek++;},paintMiniProgress(){calls.mini++;},
    requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),
    setTimeout:(fn,delay)=>{timers.set(++id,{fn,at:now+delay});return id;},clearTimeout:key=>timers.delete(key)});
  const start=source.indexOf('  lastProg:0,'),end=source.indexOf('  /* ------- waveform',start);
  vm.runInContext('Object.assign(UI,{'+source.slice(start,end)+'});',context);
  const visibility=source.indexOf("document.addEventListener('visibilitychange',function(){");
  vm.runInContext(source.slice(visibility,source.indexOf('\n});',visibility)+4),context);
  function frame(at=now+17){now=at;for(const [key,fn] of [...frames]){frames.delete(key);fn(now);}}
  function advance(ms){now+=ms;for(const [key,timer] of [...timers])if(timer.at<=now){timers.delete(key);timer.fn();}}
  function visible(value){document.visibilityState=value?'visible':'hidden';listeners.get('visibilitychange')();}
  function installProgress(){const a=source.indexOf('  renderProgress:function('),b=source.indexOf('  lastProg:',a);vm.runInContext('UI.renderProgress='+source.slice(a+'  renderProgress:'.length,b).trim().replace(/,$/,'')+';',context);}
  return {UI,Engine,context,calls,nodes,frames,timers,frame,advance,visible,installProgress};
}

test('returning from background repeatedly keeps exactly one animation loop',()=>{
  const h=renderer();h.UI.startLoop();h.frame();
  for(let i=0;i<5;i++){h.visible(false);h.frame();h.visible(true);h.advance(1000);h.frame();}
  assert.equal(h.frames.size,1,'old background timers must not create additional frame chains');
  assert.equal(h.timers.size,0,'hidden UI does not need polling timers');
});
test('backgrounding stops rendering immediately and leaves no recurring UI work',()=>{
  const h=renderer();h.UI.startLoop();h.visible(false);
  assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);
  h.UI.startLoop();h.frame();assert.equal(h.calls.progress,0);assert.equal(h.calls.viz,0);
});
test('unchanged playback labels and accessibility values do not mutate the DOM again',()=>{
  const h=renderer();h.installProgress();h.UI.renderProgress();const writes=h.calls.writes;
  h.UI.renderProgress();h.UI.renderProgress();assert.equal(h.calls.writes,writes);
});
test('library progress does not paint the hidden player seek rail',()=>{
  const h=renderer();h.installProgress();h.UI.renderProgress();assert.equal(h.calls.seek,0);assert.equal(h.calls.mini,1);
});
test('a canceled callback cannot interfere with the replacement animation loop',()=>{
  const h=renderer();h.UI.startLoop();const stale=[...h.frames.values()][0];h.visible(false);h.visible(true);
  const current=h.UI.loopId;stale(1000);assert.equal(h.UI.loopId,current);assert.equal(h.frames.size,1);assert.equal(h.calls.mini,0);
});
test('scrubbing owns its preview without periodic progress mutations or competing canvas work',()=>{
  const h=renderer();h.context.Nav.cur='player';h.context.InputLifecycle.contacts.add(1);h.UI.seekDragging=true;h.UI.startLoop();
  for(let i=1;i<8;i++)h.frame(i*120);assert.equal(h.calls.progress,0);assert.equal(h.calls.seek,0);assert.equal(h.calls.viz,0);
  h.UI.seekDragging=false;h.context.InputLifecycle.contacts.clear();h.frame(1000);assert.equal(h.calls.viz,1);assert.equal(h.calls.progress,1);
});
test('hidden progress updates cannot paint or mutate controls',()=>{
  const h=renderer();h.installProgress();h.visible(false);h.UI.renderProgress();assert.equal(h.calls.writes,0);assert.equal(h.calls.mini,0);assert.equal(h.calls.seek,0);
});
test('mini thumb frame updates change only a transform and skip identical positions',()=>{
  const h=renderer();const fill={style:new Proxy({}, {set(target,key,value){assert.equal(key,'transform');h.calls.writes++;target[key]=value;return true;}})};
  h.nodes.set('#mini-fill',fill);
  const a=source.indexOf('function paintMiniProgress('),b=source.indexOf('function setupSeekGestures(',a);
  vm.runInContext(source.slice(a,b),h.context);
  h.context.paintMiniProgress(0);h.context.paintMiniProgress(.5);h.context.paintMiniProgress(1);h.context.paintMiniProgress(1);
  assert.equal(fill.style.transform,'translateX(100%)');assert.equal(h.calls.writes,3);
});
