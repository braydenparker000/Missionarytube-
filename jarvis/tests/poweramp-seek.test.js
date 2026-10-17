import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const block=(from,to)=>source.slice(source.indexOf(from),source.indexOf(to,source.indexOf(from)+from.length));
function node(){
  const handlers=new Map(),classes=new Set(),captures=new Set(),attrs={};
  return {handlers,attrs,style:{},clientWidth:400,hidden:false,isConnected:true,rect:{left:0,width:400},reads:0,
    classList:{add(...names){names.forEach(n=>classes.add(n));},remove(...names){names.forEach(n=>classes.delete(n));},contains:n=>classes.has(n)},
    setAttribute(name,value){attrs[name]=value;},getAttribute:name=>attrs[name]??null,
    closest(){return null;},setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),
    getBoundingClientRect(){this.reads++;return {...this.rect};},
    addEventListener(type,fn,options){if(!handlers.has(type))handlers.set(type,[]);handlers.get(type).push({fn,capture:options===true||!!options?.capture});},
    fire(type,values={}){
      const e={type,pointerId:1,pointerType:'touch',isPrimary:true,button:0,clientX:200,clientY:100,timeStamp:1000,detail:1,target:this,
        preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.immediate=true;},...values};
      for(const {fn} of [...(handlers.get(type)||[])].sort((a,b)=>Number(b.capture)-Number(a.capture))){fn(e);if(e.immediate)break;}
      return e;
    }
  };
}
function harness({style='wave',staticBar=0,realEngine=false,playing=false,sourceURL='',loading=false}={}){
  const nodes=new Map(),frames=new Map(),calls=[],doc=node(),win=node();let now=1000,sequence=0,time=40,duration=200,draws=0;
  doc.body=node();doc.hidden=false;doc.visibilityState='visible';
  const $=name=>{if(!nodes.has(name))nodes.set(name,node());return nodes.get(name);};
  const UI={renderProgress(){
    if(this.seekDragging)return;
    const d=Engine.duration(),f=d?Engine.time()/d:0;
    context.paintSeekFraction(f);context.paintMiniProgress(f);
    $('#t-cur').textContent=String(Engine.time());
    $('#mini-seek').setAttribute('aria-valuenow',String(Math.round(Engine.time())));
    $('#mini-seek').setAttribute('aria-valuetext',Engine.time()+' of '+d);
  },drawViz(){draws++;},startLoop(){},renderNowPlaying(){},renderPlayState(){}};
  const context=vm.createContext({UI,$,document:doc,window:win,SET:{seekStyle:style,nativeSeekbar:staticBar},SCREENS:{},Nav:{cur:'player'},
    performance:{now:()=>now},requestAnimationFrame:fn=>{frames.set(++sequence,fn);return sequence;},cancelAnimationFrame:id=>frames.delete(id),
    clamp:(n,min,max)=>Math.max(min,Math.min(max,n)),fmtTime:String,Waveform:{span:d=>Math.min(90,Math.max(10,d||90))},vibrate(){},debounce:fn=>fn,LIB:{map:new Map()}});
  let Engine;
  if(realEngine){
    Engine=vm.runInContext(block('const Engine = {','function SET_shuffleOn()')+'\nEngine',context);
    const audio={src:sourceURL,currentTime:time,duration,readyState:sourceURL?1:0,play(){calls.push('play');},pause(){calls.push('pause');}};
    Engine.els=[audio];Engine.playing=playing;Engine.dur=duration;Engine.current={id:'one',dur:duration};Engine._playRequest=1;
    if(loading){Engine._loadingRequest=1;Engine._loadingAutoplay=playing;Engine._requestedSeek=time;}
    const seek=Engine.seek;Engine.seek=function(sec){calls.push(['seek',sec]);return seek.call(this,sec);};
  }else{
    Engine={current:{id:'one'},_playRequest:1,playing,duration:()=>duration,time:()=>time,seek(sec){calls.push(['seek',sec]);time=sec;}};
    context.Engine=Engine;
  }
  vm.runInContext(block('const InputLifecycle=','const Nav=')+'\nglobalThis.lifecycle=InputLifecycle;',context);
  vm.runInContext(block('function paintSeekFraction(','function setupVizGestures()')+'\nsetupSeekGestures();',context);
  return {context,Engine,UI,nodes,doc,win,calls,frames,$,get draws(){return draws;},advance(ms){now+=ms;},setDuration(value){duration=value;},
    paint(){for(const [id,fn] of [...frames]){frames.delete(id);fn(now);}},
    down(name,values={}){doc.fire('pointerdown',values);return $(name).fire('pointerdown',values);},
    up(name,values={}){doc.fire('pointerup',values);return $(name).fire('pointerup',values);}};
}
const modes=[['rail','#seek'],['mini','#mini-seek'],['moving','#transport']];

test('moving waveform commits the final owning pointerup coordinate rather than its last move',()=>{
  const h=harness(),tr=h.$('#transport');h.down('#transport',{clientX:200});tr.fire('pointermove',{clientX:160});
  h.up('#transport',{clientX:80});assert.deepEqual(h.calls,[['seek',67]]);assert.equal(h.UI.seekPreview,null);
});
test('static waveform uses cached absolute geometry for final release',()=>{
  const h=harness({staticBar:1}),tr=h.$('#transport');tr.rect={left:40,width:400};h.down('#transport',{clientX:100});tr.fire('pointermove',{clientX:200});
  tr.rect={left:0,width:800};h.up('#transport',{clientX:340});assert.deepEqual(h.calls,[['seek',150]]);assert.equal(tr.reads,1);
});
test('simple timeline commits the final release, including contact movement first observed at release',()=>{
  const h=harness({style:'simple'});h.down('#transport',{clientX:200});h.up('#transport',{clientX:320});assert.deepEqual(h.calls,[['seek',100]]);
});
for(const [mode,name] of modes){
  test(mode+': second contact cancels the owner without committing and the next contact recovers',()=>{
    const h=harness();h.down(name,{clientX:200});h.$(name).fire('pointermove',{clientX:280});
    h.doc.fire('pointerdown',{pointerId:2,isPrimary:false});assert.equal(h.UI.seekDragging,false);assert.equal(h.frames.size,0);
    h.up(name,{clientX:320});assert.deepEqual(h.calls,[]);
    h.doc.fire('pointerup',{pointerId:2,isPrimary:false});h.down(name,{clientX:200});h.$(name).fire('pointermove',{clientX:240});h.up(name,{clientX:240});assert.equal(h.calls.length,1);
  });
  test(mode+': cancellation discards preview on pointercancel, capture loss, blur, background, resize, or new selection',()=>{
    for(const interruption of ['pointercancel','lostpointercapture','blur','background','resize','selection']){
      const h=harness();h.down(name,{clientX:100});h.$(name).fire('pointermove',{clientX:300});h.paint();
      if(interruption==='blur'||interruption==='resize')h.win.fire(interruption);
      else if(interruption==='background'){h.doc.hidden=true;h.doc.fire('visibilitychange');}
      else if(interruption==='selection'){h.Engine.current={id:'two'};h.Engine._playRequest++;h.UI.cancelSeekGesture?.();}
      else h.$(name).fire(interruption);
      assert.equal(h.UI.seekDragging,false,interruption);assert.equal(h.UI.seekPreview,null,interruption);
      h.up(name,{clientX:320});h.paint();assert.deepEqual(h.calls,[],interruption);assert.equal(h.frames.size,0,interruption);
    }
  });
  test(mode+': foreign releases do not commit; the owning release commits once',()=>{
    const h=harness();h.down(name,{clientX:200});h.$(name).fire('pointermove',{clientX:240});
    h.up(name,{pointerId:2,isPrimary:false,clientX:400});assert.deepEqual(h.calls,[]);assert.equal(h.UI.seekDragging,true);
    h.up(name,{clientX:320});h.up(name,{clientX:400});h.$(name).fire('lostpointercapture');assert.equal(h.calls.length,1);
  });
  test(mode+': movement is painted once per frame and measures bounds once per contact',()=>{
    const h=harness(),n=h.$(name);h.down(name,{clientX:200});const before=h.draws;
    for(let i=1;i<=20;i++)n.fire('pointermove',{clientX:200+i*5});
    assert.equal(h.frames.size,1);assert.equal(h.draws,before);assert.equal(n.reads,1);
    h.paint();assert.equal(h.frames.size,0);assert.equal(n.reads,1);
    n.fire('pointermove',{clientX:320});h.up(name,{clientX:340});assert.equal(h.frames.size,0);h.paint();assert.equal(n.reads,1);
  });
  test(mode+': paused unloaded song seeks without loading, playing, or changing playback intent',()=>{
    const h=harness({realEngine:true}),n=h.$(name);h.down(name,{clientX:200});n.fire('pointermove',{clientX:280});h.up(name,{clientX:320});
    assert.equal(h.Engine.playing,false);assert.equal(h.Engine.el().src,'');assert.equal(h.calls.length,1);assert.equal(h.calls[0][0],'seek');
    assert.equal(h.Engine._resumePosition.id,'one');assert.equal(h.Engine.time(),h.calls[0][1]);
  });
  test(mode+': a playing loaded source stays playing; cancellation never changes its playhead',()=>{
    const h=harness({realEngine:true,playing:true,sourceURL:'https://audio.test/song'}),n=h.$(name);
    h.down(name,{clientX:200});n.fire('pointermove',{clientX:280});n.fire('pointercancel');assert.equal(h.Engine.el().currentTime,40);assert.equal(h.Engine.playing,true);assert.deepEqual(h.calls,[]);
    h.down(name,{clientX:200});n.fire('pointermove',{clientX:280});h.up(name,{clientX:320});assert.equal(h.Engine.playing,true);assert.equal(h.calls.length,1);
  });
}

test('rail and mini share one seek owner instead of racing previews and commits',()=>{
  const h=harness();h.down('#seek',{clientX:100});h.$('#mini-seek').fire('pointerdown',{pointerId:2,isPrimary:false,clientX:300});
  h.up('#seek',{clientX:320});h.up('#mini-seek',{pointerId:2,clientX:320});assert.deepEqual(h.calls,[]);assert.equal(h.UI.seekDragging,false);
});
test('all rails clamp final release and do not activate an underlying compatibility click',()=>{
  for(const name of ['#seek','#mini-seek']){
    const h=harness();h.down(name,{clientX:100});h.up(name,{clientX:500});assert.deepEqual(h.calls,[['seek',200]]);
    assert.equal(h.$(name).fire('click').prevented,true);assert.notEqual(h.$(name).fire('click',{detail:0}).prevented,true);
    h.down(name,{clientX:100});h.up(name,{clientX:-100});assert.deepEqual(h.calls.at(-1),['seek',0]);
  }
});
test('timeline scrubbing over a button consumes owning release and trailing click; fresh taps still work',()=>{
  const h=harness(),tr=h.$('#transport'),target={closest:()=>({})};h.down('#transport',{target,clientX:200});tr.fire('pointermove',{target,clientX:280});
  const release=h.up('#transport',{target,clientX:320});assert.equal(release.prevented,true);assert.equal(release.stopped,true);
  assert.equal(tr.fire('click',{target}).prevented,true);h.down('#transport',{target});h.up('#transport',{target});assert.notEqual(tr.fire('click',{target}).prevented,true);
});
test('button-to-transport capture transfer retains the active waveform scrub and final seek',()=>{
  const h=harness(),tr=h.$('#transport'),button=node();button.closest=()=>button;
  h.down('#transport',{target:button,clientX:200});tr.fire('pointermove',{target:button,clientX:160});
  assert.equal(tr.hasPointerCapture(1),true);assert.equal(h.UI.seekDragging,true);
  tr.fire('lostpointercapture',{target:button});
  assert.equal(h.UI.seekDragging,true,'old button loss must not cancel its new timeline owner');
  tr.fire('pointermove',{clientX:100});h.up('#transport',{clientX:80});
  assert.deepEqual(h.calls,[['seek',67]]);assert.equal(h.UI.seekDragging,false);
  assert.equal(tr.fire('click',{target:button}).prevented,true);
  h.down('#transport',{target:button});h.up('#transport',{target:button});
  assert.notEqual(tr.fire('click',{target:button}).prevented,true,'a fresh button tap is still available');
});
test('actual transport capture loss and genuine child pointercancel still discard the scrub',()=>{
  for(const [type,child] of [['lostpointercapture',false],['pointercancel',true]]){
    const h=harness(),tr=h.$('#transport'),button=node();button.closest=()=>button;
    h.down('#transport',{target:button});tr.fire('pointermove',{target:button,clientX:160});
    tr.fire(type,{target:child?button:tr});h.up('#transport',{clientX:80});
    assert.deepEqual(h.calls,[]);assert.equal(h.UI.seekDragging,false);
  }
});
test('a child capture loss without transport capture still cancels a pending button contact',()=>{
  const h=harness(),tr=h.$('#transport'),button=node();button.closest=()=>button;
  h.down('#transport',{target:button});assert.equal(tr.hasPointerCapture(1),false);
  tr.fire('lostpointercapture',{target:button});tr.fire('pointermove',{clientX:100});h.up('#transport',{clientX:80});
  assert.deepEqual(h.calls,[]);assert.equal(h.UI.seekDragging,false);
});
test('a canceled button-origin contact and a long hold cannot activate a trailing timeline button click',()=>{
  for(const interruption of ['pointercancel','hold']){
    const h=harness(),tr=h.$('#transport'),target={closest:()=>({})};h.down('#transport',{target});
    if(interruption==='pointercancel')tr.fire('pointercancel',{target});else {h.advance(500);h.up('#transport',{target,timeStamp:1500});}
    assert.equal(tr.fire('click',{target}).prevented,true);assert.deepEqual(h.calls,[]);
  }
});
test('new playback request cannot receive a seek even when the track ID is unchanged',()=>{
  for(const [,name] of modes){const h=harness();h.down(name);h.$(name).fire('pointermove',{clientX:280});h.Engine._playRequest++;h.up(name,{clientX:320});assert.deepEqual(h.calls,[]);assert.equal(h.UI.seekDragging,false);}
});
test('mini keyboard seeking cancels a competing preview and preserves unloaded paused state',()=>{
  const h=harness({realEngine:true});h.down('#mini-seek',{clientX:100});h.$('#mini-seek').fire('keydown',{key:'ArrowRight'});
  assert.equal(h.UI.seekDragging,false);assert.equal(h.Engine.playing,false);assert.equal(h.Engine.el().src,'');assert.deepEqual(h.calls,[['seek',45]]);
  h.up('#mini-seek',{clientX:400});assert.equal(h.calls.length,1);
});
test('a metadata duration update cannot change cached fraction-to-time mapping mid-contact',()=>{
  const h=harness();h.down('#seek',{clientX:100});h.setDuration(400);h.up('#seek',{clientX:300});assert.deepEqual(h.calls,[['seek',150]]);
});
test('resize invalidates cached knob width before the next seek paint',()=>{
  const h=harness();h.context.paintSeekFraction(.5);assert.match(h.$('#seek-knob').style.transform,/200px/);
  h.$('#seek').clientWidth=800;h.win.fire('resize');h.context.paintSeekFraction(.5);assert.match(h.$('#seek-knob').style.transform,/400px/);
});

test('selection refresh for the same identity/request preserves the active owner',()=>{
  const h=harness();h.down('#seek',{clientX:100});h.UI.cancelSeekGesture();assert.equal(h.UI.seekDragging,true);
  h.up('#seek',{clientX:300});assert.deepEqual(h.calls,[['seek',150]]);
});
for(const [,name] of modes)test(name+': pending source load preserves its autoplay intent and defers seek until load completes',()=>{
  for(const playing of [false,true]){
    const h=harness({realEngine:true,loading:true,playing});h.down(name,{clientX:200});h.$(name).fire('pointermove',{clientX:280});h.up(name,{clientX:320});
    assert.equal(h.Engine._loadingRequest,1);assert.equal(h.Engine._loadingAutoplay,playing);assert.equal(h.Engine.playing,playing);
    assert.equal(h.Engine.el().src,'');assert.equal(h.Engine._requestedSeek,h.calls[0][1]);assert.equal(h.calls.length,1);
  }
});
test('rail preview cancellation restores actual playback progress and removes scrub styling',()=>{
  const h=harness();h.down('#seek',{clientX:200});h.$('#seek').fire('pointermove',{clientX:300});h.paint();
  assert.equal(h.UI.seekPreview,.75);assert.equal(h.$('#t-cur').textContent,'150');assert.equal(h.doc.body.classList.contains('scrubbing'),true);
  h.$('#seek').fire('pointercancel');assert.equal(h.$('#t-cur').textContent,'40');assert.equal(h.$('#seek-fill').style.transform,'scaleX(0.2)');
  assert.equal(h.doc.body.classList.contains('scrubbing'),false);assert.equal(h.$('#seek').classList.contains('drag'),false);
});
test('timeline hold context menu is consumed but a fresh ordinary button contact is available',()=>{
  const h=harness(),tr=h.$('#transport'),target={closest:()=>({})};h.down('#transport',{target});h.advance(500);
  assert.equal(tr.fire('contextmenu',{target,timeStamp:1500}).prevented,true);h.up('#transport',{target,timeStamp:1500});
  h.down('#transport',{target,timeStamp:1600});assert.notEqual(tr.fire('contextmenu',{target,timeStamp:1600}).prevented,true);
});
test('inactive screens and unknown durations cannot acquire a seek owner',()=>{
  const h=harness();h.setDuration(0);h.down('#seek');h.up('#seek');assert.deepEqual(h.calls,[]);assert.notEqual(h.UI.seekDragging,true);
  h.setDuration(200);h.$('#seek').closest=()=>({hidden:true});h.down('#seek');h.up('#seek');assert.deepEqual(h.calls,[]);
});
test('seek paints clamp nonfinite and out-of-range fractions without another layout measurement',()=>{
  const h=harness();h.context.paintSeekFraction(3);assert.equal(h.$('#seek-fill').style.transform,'scaleX(1)');
  h.context.paintSeekFraction(NaN);assert.equal(h.$('#seek-fill').style.transform,'scaleX(0)');
  h.context.paintMiniProgress(-1);assert.equal(h.$('#mini-fill').style.transform,'translateX(0%)');
  h.context.paintMiniProgress(Infinity);assert.equal(h.$('#mini-fill').style.transform,'translateX(0%)');
});

test('same-track layout cache refresh cannot change an owning rail preview geometry',()=>{
  const h=harness(),rail=h.$('#seek');h.down('#seek',{clientX:100});h.UI.seekWidth=800;
  rail.fire('pointermove',{clientX:300});h.paint();assert.match(h.$('#seek-knob').style.transform,/300px/);assert.equal(rail.reads,1);
  h.up('#seek',{clientX:320});assert.deepEqual(h.calls,[['seek',160]]);assert.equal(rail.reads,1);
});
