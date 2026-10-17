import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
function harness({reduced=false}={}){
  let now=1000,id=0;const timers=new Map(),frames=new Map(),nodes=new Map(),painted=new Map(),history=[];
  function node(selector=''){
    const events=new Map(),classes=new Set(),raw={transition:'',transform:'',zIndex:''};
    const n={id:selector.replace(/^#/,''),dataset:{},hidden:selector.startsWith('#sc-')&&selector!=='#sc-player',inert:false,clientHeight:700,clientWidth:393,
      style:new Proxy(raw,{set(object,key,value){object[key]=value;if(key==='transform')painted.delete(n);return true;}}),
      setAttribute(key,value){(this.attrs??={})[key]=value;},getAttribute(key){return this.attrs?.[key];},
      classList:{add(...names){names.forEach(name=>classes.add(name));},remove(...names){names.forEach(name=>classes.delete(name));},toggle(name,on){if(on??!classes.has(name))classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},
      closest(selector){return selector==='.screen'&&n.id.startsWith('sc-')?n:null;},
      addEventListener(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);},removeEventListener(name,fn){events.get(name)?.delete(fn);},
      setPointerCapture(){},hasPointerCapture(){return false;},
      getBoundingClientRect(){return {top:0,left:0,width:393,height:700};},
      fire(type,args={}){const e={type,target:n,pointerId:1,clientX:120,clientY:250,button:0,isPrimary:true,detail:1,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;},...args};for(const fn of [...events.get(type)||[]]){fn(e);if(e.stopped)break;}return e;}
    };return n;
  }
  const $=selector=>{if(!nodes.has(selector))nodes.set(selector,node(selector));return nodes.get(selector);};
  const document=node(),window=node();
  const context=vm.createContext({$, $$:()=>[], document,window,innerHeight:852,
    SET:{animations:'normal',listBg:true,longPressMenu:false},UI:{renderProgress(){},syncNav(){},fitPlayer(){},drawCurve(){}},EQ:{render(){}},
    Engine:{current:{id:'song'}},Selection:{mode:false},Sheets:{request:0},
    history:{pushState(state){history.push(state);}},performance:{now:()=>now},matchMedia:()=>({matches:reduced}),
    clamp:(value,low,high)=>Math.max(low,Math.min(high,value)),
    getComputedStyle:n=>({transform:painted.has(n)?`matrix(1,0,0,1,0,${painted.get(n)})`:n.style.transform||'none'}),
    setTimeout(fn,ms=0){timers.set(++id,{fn,at:now+ms});return id;},clearTimeout:key=>timers.delete(key),
    requestAnimationFrame(fn){frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key)
  });
  const extract=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)+a.length));
  vm.runInContext(extract('const SCREENS=','window.addEventListener(\'popstate\''),context);
  vm.runInContext(extract('const GestureMotion=','const SwipeArt='),context);
  vm.runInContext(extract('const ScreenDrag=','function libraryDestination()')+'\nglobalThis.nav=Nav;globalThis.scene=ScreenDrag;globalThis.input=InputLifecycle;globalThis.motion=GestureMotion;',context);
  return {context,$,nodes,timers,frames,history,document,window,nav:context.nav,scene:context.scene,input:context.input,motion:context.motion,
    paint(n,y){painted.set(n,y);},advance(ms){now+=ms;for(const [key,t] of [...timers])if(t.at<=now){timers.delete(key);t.fn();}},run(code){return vm.runInContext(code,context);}};
}
function list(h){h.context.SET.animations='disabled';h.nav.go('list',false);h.context.SET.animations='normal';}

test('tap navigation and upward mini drag share player entry from below',()=>{
  const h=harness();list(h);h.nav.go('player');
  assert.equal(h.nav.cur,'player');assert.equal(h.scene.settling.direction,-1);
  assert.equal(h.scene.settling.to.style.transition.startsWith('transform '),true);
  const k=harness();list(k);k.scene.begin('player',-1);k.scene.move(-140);
  assert.equal(k.$('#sc-player').style.transform,'translateY(560px)');
  k.scene.end(true,-.7);assert.equal(k.scene.settling.direction,h.scene.settling.direction);
});

test('committed drag gives incoming scene input before settle and blocks outgoing rows',()=>{
  const h=harness();list(h);const from=h.$('#sc-list'),to=h.$('#sc-player');
  h.scene.begin('player',-1);h.scene.move(-140);
  assert.equal(from.inert,true,'captured drag never leaves background rows enabled');
  assert.equal(h.input.active(from),false);h.scene.end(true,-.7);
  assert.equal(h.nav.cur,'player');assert.equal(h.input.active(from),false);assert.equal(h.input.active(to),true);
  assert.equal(from.hidden,false,'outgoing scene remains visible during settle');
  h.advance(1000);assert.equal(from.hidden,true);assert.equal(to.hidden,false);assert.equal(to.inert,false);
});

test('interruption freezes both displayed positions and rebases subsequent motion',()=>{
  const h=harness();list(h);h.scene.begin('player',-1);h.scene.move(-140);h.scene.end(true,-.7);
  const from=h.$('#sc-list'),to=h.$('#sc-player');h.paint(from,-31);h.paint(to,370);h.scene.pause();
  assert.equal(from.style.transform,'translateY(-31px)');assert.equal(to.style.transform,'translateY(370px)');
  assert.equal(h.scene.phase,'possible');h.scene.begin('library',1);h.scene.move(70);
  assert.equal(from.style.transform,'translateY(-18.4px)');assert.equal(to.style.transform,'translateY(440px)');
  h.scene.end(false,.7);assert.equal(h.nav.cur,'list');h.advance(1000);assert.equal(h.$('#sc-player').hidden,true);
});

test('holding or tapping a committed scene resumes the destination without changing selection',()=>{
  const h=harness();list(h);h.scene.begin('player',-1);h.scene.move(-140);h.scene.end(true,-.7);
  h.paint(h.$('#sc-player'),370);h.scene.pause();h.advance(1000);
  assert.equal(h.scene.phase,'possible');assert.equal(h.nav.cur,'player');assert.equal(h.scene.returnInterrupted(),true);
  h.advance(1000);assert.equal(h.nav.cur,'player');assert.equal(h.scene.phase,'idle');assert.equal(h.$('#sc-list').hidden,true);
  assert.equal(h.history.length,1,'resuming does not duplicate browser history');
});

test('rapid third-screen navigation preserves the currently displayed offset',()=>{
  const h=harness();list(h);h.nav.go('player');const player=h.$('#sc-player');h.paint(player,210);h.paint(h.$('#sc-list'),-80);
  h.nav.go('eq');assert.equal(h.nav.cur,'eq');assert.equal(h.scene.settling.fromName,'player');assert.equal(h.scene.settling.fromBaseY,210);
  assert.equal(h.$('#sc-list').hidden,true);h.advance(1000);
  assert.equal(h.$('#sc-eq').hidden,false);assert.equal(h.$('#sc-eq').inert,false);assert.equal(player.hidden,true);assert.equal(h.$('#sc-list').hidden,true);
});

test('retargeting an interrupted scene cannot run a stale completion or duplicate history',()=>{
  const h=harness();list(h);h.nav.go('player');h.paint(h.$('#sc-player'),350);h.nav.go('list');
  assert.equal(h.nav.cur,'list');h.nav.go('player');h.advance(1000);
  assert.equal(h.nav.cur,'player');assert.equal(h.scene.phase,'idle');assert.equal(h.$('#sc-list').hidden,true);
  assert.deepEqual(h.history.map(state=>state.screen),['player','list','player']);
});

test('under-threshold scene return keeps original current screen and can be interrupted',()=>{
  const h=harness();list(h);h.scene.begin('player',-1);h.scene.move(-25);h.scene.end(false);
  assert.equal(h.nav.cur,'list');assert.equal(h.input.active(h.$('#sc-list')),true);assert.equal(h.$('#sc-player').inert,true);
  h.paint(h.$('#sc-player'),680);h.scene.pause();h.scene.returnInterrupted();h.advance(1000);
  assert.equal(h.nav.cur,'list');assert.equal(h.$('#sc-player').hidden,true);assert.equal(h.history.length,0);
});

test('blur and resize end scene ownership at the selected destination and retire timers',()=>{
  for(const type of ['blur','resize']){const h=harness();list(h);h.nav.go('player');h.window.fire(type);h.advance(1000);
    assert.equal(h.nav.cur,'player');assert.equal(h.scene.phase,'idle');assert.equal(h.scene.finish,null);assert.equal(h.$('#sc-list').hidden,true);assert.equal(h.$('#sc-player').inert,false);}
});

test('reduced motion and disabled animation scenes settle synchronously with no dead handle',()=>{
  for(const reduced of [false,true]){const h=harness({reduced});if(!reduced)h.context.SET.animations='disabled';h.nav.go('list');
    assert.equal(h.nav.cur,'list');assert.equal(h.scene.phase,'idle');assert.equal(h.scene.finish,null);assert.equal(h.$('#sc-player').hidden,true);assert.equal(h.$('#sc-list').style.transform,'');assert.equal(h.timers.size,0);}
  const h=harness({reduced:true}),n=h.$('#target');let done=0;const finish=h.motion.settle([n],['translateY(0)'],300,()=>done++);
  assert.equal(done,1);assert.equal(finish.pending,false);assert.equal(h.timers.size,0);
});

test('scene cleanup releases compositor hints and exposes one accessible screen',()=>{
  const h=harness();h.nav.go('list');assert.equal(h.$('#sc-list').dataset.scene,'1');h.advance(1000);
  for(const [selector,n] of h.nodes)if(selector.startsWith('#sc-')){assert.equal(n.dataset.scene,undefined);assert.equal(n.getAttribute('aria-hidden'),selector==='#sc-list'?'false':'true');assert.equal(n.inert,selector!=='#sc-list');}
});

test('a canceled owner cannot click and a fresh pointer can claim ownership',()=>{
  const h=harness(),n=h.$('#sc-player');let starts=0,cancels=0;h.motion.bind(n,{start(){starts++;},cancel(){cancels++;}});
  n.fire('pointerdown');assert.equal(h.input.gesture.phase,'possible');n.fire('pointermove',{clientX:170});assert.equal(h.input.gesture.phase,'drag');
  n.fire('pointercancel');assert.equal(cancels,1);assert.equal(h.input.gesture,null);assert.equal(n.fire('click').prevented,true);
  n.fire('pointerdown');assert.equal(starts,2);n.fire('pointerup');assert.equal(h.input.gesture,null);
});

test('an additional contact elsewhere cancels the old gesture without granting a competing owner',()=>{
  const h=harness(),a=h.$('#sc-player'),b=h.$('#other');let canceled=0,started=0;
  h.motion.bind(a,{cancel(){canceled++;}});h.motion.bind(b,{start(){started++;}});
  h.document.fire('pointerdown',{pointerId:1});a.fire('pointerdown');
  h.document.fire('pointerdown',{pointerId:2,isPrimary:false});b.fire('pointerdown',{pointerId:2,isPrimary:false});
  assert.equal(canceled,1);assert.equal(started,0);assert.equal(h.input.contacts.size,2);assert.equal(h.input.gesture,null);
  h.document.fire('pointerup',{pointerId:1});h.document.fire('pointerup',{pointerId:2});b.fire('pointerup',{pointerId:2});
  b.fire('pointerdown',{pointerId:3});assert.equal(started,1);
});

test('switching to horizontal motion completes the selected vertical owner smoothly',()=>{
  const h=harness();list(h);h.nav.go('player');const player=h.$('#sc-player');h.paint(player,350);h.scene.pause();
  h.scene.complete();assert.equal(h.nav.cur,'player');assert.equal(h.scene.phase,'settle');assert.equal(player.style.transition.startsWith('transform '),true);
  h.advance(1000);assert.equal(h.scene.phase,'idle');assert.equal(h.$('#sc-list').hidden,true);assert.equal(h.history.length,1);
});
