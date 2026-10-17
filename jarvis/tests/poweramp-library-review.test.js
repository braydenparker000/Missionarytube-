import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(process.env.POWERAMP_PLAYER_FILE||new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const plain=value=>JSON.parse(JSON.stringify(value));

class Element{
  constructor(tag='div',id=''){
    this.tagName=tag.toUpperCase();this.id=id;this.style={};this.dataset={};this.attrs={};this.children=[];this.handlers={};this.scrollTop=0;this.scrollLeft=0;this.clientWidth=393;this.clientHeight=680;this.scrollWidth=393;this.hidden=false;this.inert=false;this.isConnected=true;this.capture=new Set();this.captureCount=0;
    const classes=new Set();this.classList={add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n)),contains:n=>classes.has(n),toggle:(n,on)=>{if(on??!classes.has(n))classes.add(n);else classes.delete(n);},[Symbol.iterator]:()=>classes[Symbol.iterator]()};
  }
  // Opt-in CSSOM box model: display:none ancestors prevent scroll assignment.
  // https://drafts.csswg.org/cssom-view/#dom-element-scrolltop (setter step 10)
  get scrollTop(){let modeled=false,hidden=false;for(let n=this;n;n=n.parentElement){modeled ||= !!n.__cssomScrollRoot;hidden ||= !!n.hidden;}return modeled&&hidden?0:this._scrollTop||0;}
  set scrollTop(value){let modeled=false,hidden=false;for(let n=this;n;n=n.parentElement){modeled ||= !!n.__cssomScrollRoot;hidden ||= !!n.hidden;}if(!modeled||!hidden)this._scrollTop=Number(value);}
  get attributes(){return Object.entries({...this.attrs,...(this.id?{id:this.id}:{})}).map(([name,value])=>({name,value}));}
  setAttribute(name,value){if(name==='id')this.id=value;else this.attrs[name]=String(value);}
  getAttribute(name){return name==='id'?this.id:this.attrs[name]??null;}
  removeAttribute(name){if(name==='id')this.id='';else delete this.attrs[name];}
  appendChild(node){node.parentElement=this;this.children.push(node);return node;}
  remove(){if(this.parentElement)this.parentElement.children=this.parentElement.children.filter(n=>n!==this);this.parentElement=null;}
  replaceChildren(...nodes){this.children.forEach(n=>n.parentElement=null);this.children=[];nodes.forEach(n=>this.appendChild(n));}
  contains(node){return node===this||this.children.some(n=>n.contains(node));}
  querySelectorAll(selector){const list=this.children.flatMap(n=>[n,...n.querySelectorAll('*')]);return selector==='*'?list:list.filter(n=>selector==='[id]'?n.id:selector==='.list'?n.classList.contains('list'):false);}
  closest(selector){for(let node=this;node;node=node.parentElement){if(selector==='.screen'&&node.classList.contains('screen'))return node;if(selector.includes('button')&&node.tagName==='BUTTON')return node;if(selector.includes('#alpha')&&node.id==='alpha')return node;if(selector.includes('[data-horizontal-gesture]')&&node.dataset.horizontalGesture!==undefined)return node;}return null;}
  cloneNode(deep){const node=new Element(this.tagName,this.id);Object.assign(node.style,this.style);Object.assign(node.dataset,this.dataset);Object.assign(node.attrs,this.attrs);node.hidden=this.hidden;node.inert=this.inert;node.classList.add(...this.classList);if(deep)this.children.forEach(n=>node.appendChild(n.cloneNode(true)));return node;}
  addEventListener(type,fn,options){(this.handlers[type]??=[]).push({fn,capture:options===true||!!options?.capture});}
  removeEventListener(type,fn){this.handlers[type]=(this.handlers[type]||[]).filter(h=>h.fn!==fn);}
  setPointerCapture(id){this.capture.add(id);this.captureCount++;}
  hasPointerCapture(id){return this.capture.has(id);}
  releasePointerCapture(id){this.capture.delete(id);}
  fire(type,e){for(const h of [...this.handlers[type]||[]].sort((a,b)=>Number(b.capture)-Number(a.capture))){h.fn(e);if(e.immediateStopped)break;}}
}
function harness(){
  let now=1000,serial=0;const timers=new Map(),frames=new Map(),calls=[];
  const document=new Element('document'),window=new Element('window'),head=document.appendChild(new Element('head')),body=document.appendChild(new Element('body')),app=body.appendChild(new Element('div','app'));
  document.head=head;document.body=body;document.styleSheets=[];
  const root=app.appendChild(new Element('section','sc-library')),list=app.appendChild(new Element('section','sc-list'));root.classList.add('screen');list.classList.add('screen');
  const cats=root.appendChild(new Element('div','lib-cats')),listBody=list.appendChild(new Element('div','list-body'));
  const title=list.appendChild(new Element('h1','list-title')),alpha=list.appendChild(new Element('div','alpha')),button=list.appendChild(new Element('button','list-back'));
  const row=listBody.appendChild(new Element());row.classList.add('trow');row.setAttribute('role','button');row.tabIndex=0;
  const $=selector=>[document,...document.querySelectorAll('*')].find(n=>n.id===selector.slice(1))||null;
  let Nav, ScreenDrag;
  const Views={stack:[],render(spec,keep){context.lifecycle.cancel();this.currentSpec=spec;this.currentData={items:[]};title.textContent=spec.title||spec.kind;if(!keep)listBody.scrollTop=0;calls.push(['render',plain(spec)]);},renderLibrary(){calls.push(['root']);},push(spec){this.stack.push(spec);this.render(spec);Nav.go('list');}};
  const Selection={mode:false,exit(){this.mode=false;calls.push(['exit-selection']);}},Sheets={open:null};
  
  const context=vm.createContext({document,window,$,$$:()=>[],Views,Selection,Sheets,UI:{vizFull:false,renderProgress(){},syncNav(){},fitPlayer(){},drawCurve(){}},EQ:{render(){}},Engine:{current:{id:'song'}},SET:{animations:'disabled'},innerWidth:393,innerHeight:700,performance:{now:()=>now},getComputedStyle:n=>({transform:n.paintedTransform||n.style.transform||'none',overflowX:n.style.overflowX||'visible'}),matchMedia:()=>({matches:false}),clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),history:{pushState:()=>calls.push(['browser-history'])},setTimeout:(fn,ms)=>{timers.set(++serial,{fn,at:now+ms});return serial;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id)});
  document.createElement=tag=>new Element(tag);
  for(const id of ['sc-player','sc-eq','sc-search','sc-settings']){const n=app.appendChild(new Element('section',id));n.classList.add('screen');n.hidden=true;}
  for(const id of ['mini','bg-dim','nav'])app.appendChild(new Element('div',id));
  vm.runInContext(source.slice(source.indexOf('const SCREENS='),source.indexOf("window.addEventListener('popstate'"))+'\nglobalThis.lifecycle=InputLifecycle;globalThis.nav=Nav;',context);
  Nav=context.nav;
  vm.runInContext(source.slice(source.indexOf('const GestureMotion='),source.indexOf('const SwipeArt=')),context);
  if(source.includes('const SharedPlayerMotion='))vm.runInContext(source.slice(source.indexOf('const SharedPlayerMotion='),source.indexOf('const ScreenDrag='))+'\nglobalThis.shared=SharedPlayerMotion;',context);
  vm.runInContext(source.slice(source.indexOf('const ScreenDrag='),source.indexOf('function libraryDestination()'))+'\nglobalThis.scene=ScreenDrag;globalThis.gestureMotion=GestureMotion;',context);ScreenDrag=context.scene;
  vm.runInContext(source.slice(source.indexOf('const LibraryPageHistory='),source.indexOf('async function boot(){'))+'\nglobalThis.pages=LibraryPageHistory;globalThis.motion=LibraryPageMotion;LibraryPageHistory.install();',context);
  const h={context,document,window,root,list,cats,listBody,title,alpha,button,row,Nav,Views,Selection,Sheets,calls,timers,frames,history:context.pages,motion:context.motion,
    advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}},paint(){for(const [id,fn] of [...frames]){frames.delete(id);fn(now);}},
    fire(node,type,args={}){const e={type,pointerId:1,pointerType:'touch',isPrimary:true,button:0,target:node,clientX:160,clientY:300,timeStamp:now,cancelable:true,detail:1,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.immediateStopped=true;},...args};if(type.startsWith('pointer'))document.fire(type,e);if(!e.immediateStopped)node.fire(type,e);return e;},
    swipe(node,dx,dy=0){this.fire(node,'pointerdown');this.advance(150);this.fire(node,'pointermove',{clientX:160+dx,clientY:300+dy});this.paint();this.advance(150);this.fire(node,'pointerup',{clientX:160+dx,clientY:300+dy});},
    settle(){this.advance(1000);}
  };Nav.cur='library';ScreenDrag.ownership();return h;
}
function nested(){const h=harness();h.Views.push({kind:'artists'});h.listBody.scrollTop=245;h.Views.push({kind:'artist',key:'Mira Vale',title:'Mira Vale'});h.listBody.scrollTop=618;return h;}


// These checks use production Nav, ScreenDrag, InputLifecycle, and horizontal
// history/motion together. The miniature DOM is deterministic, not device QA.
test('real Nav transitions do not duplicate a nested visit or retire its forward branch',()=>{const h=nested();assert.equal(h.history.entries.length,3);h.Views.back();h.context.SET.animations='normal';h.Nav.go('player');h.advance(1000);h.Nav.go('list');h.advance(1000);assert.equal(h.history.index,1);assert.equal(h.history.peek(1).spec.key,'Mira Vale');assert.equal(h.history.entries.length,3);});
test('real Nav rapid Library/Settings/Player exits leave a restored history page input-capable',()=>{const h=nested();h.context.SET.animations='normal';h.swipe(h.list,120);h.Nav.go('settings');h.Nav.go('player');h.Nav.go('list');h.settle();assert.equal(h.Nav.cur,'list');assert.equal(h.context.scene.phase,'idle');assert.equal(h.motion.state,null);assert.equal(h.list.inert,false);assert.equal(h.list.hidden,false);assert.equal(h.Views.currentSpec.kind,'artists');});
test('new settled contact remains a tap after a real Nav horizontal commit',()=>{const h=nested();h.context.SET.animations='normal';h.swipe(h.list,120);h.settle();h.fire(h.list,'pointerdown',{target:h.row});h.advance(50);h.fire(h.list,'pointerup',{target:h.row});assert.notEqual(h.fire(h.list,'click',{target:h.row}).prevented,true);assert.equal(h.list.captureCount,1);assert.equal(h.context.lifecycle.gesture,null);});
test('deep history parent recovery retains every immediate forward destination with real Nav',()=>{const h=harness();h.history.limit=5;for(let i=0;i<35;i++)h.Views.push({kind:'tree',path:'folder/'.repeat(i),title:'Folder '+i});for(let i=0;i<34;i++){const before=h.Views.currentSpec.path;h.Views.back();assert.equal(h.history.peek(1).spec.path,before);assert.ok(h.history.entries.length<=5);}h.Views.back();assert.equal(h.Nav.cur,'library');assert.equal(h.history.peek(1).spec.kind,'tree');});
test('lifecycle cancellation blocks the old drag trailing click but accepts a fresh row tap',()=>{for(const type of ['resize','blur','visibilitychange']){const h=nested();h.fire(h.list,'pointerdown',{target:h.row});h.fire(h.list,'pointermove',{target:h.row,clientX:280});h.paint();if(type==='visibilitychange'){h.document.hidden=true;h.fire(h.document,type);}else h.fire(h.window,type);h.fire(h.list,'pointerup',{target:h.row,clientX:280});assert.equal(h.fire(h.list,'click',{target:h.row}).prevented,true,type+' must suppress the canceled contact');h.fire(h.list,'pointerdown',{target:h.row});h.fire(h.list,'pointerup',{target:h.row});assert.notEqual(h.fire(h.list,'click',{target:h.row}).prevented,true,type+' must accept new tap');}});
test('Library history wrapper must not hide the incoming list when reversing a live player scene',()=>{const h=nested();h.context.SET.animations='normal';h.Nav.go('player');const player=h.document.querySelectorAll('*').find(n=>n.id==='sc-player');h.list.paintedTransform='matrix(1,0,0,1,0,-75)';player.paintedTransform='matrix(1,0,0,1,0,350)';h.Nav.go('list');assert.ok(h.context.scene.finish?.pending);assert.equal(h.Nav.cur,'list');assert.equal(h.list.hidden,false,'the selected incoming scene must remain rendered during reversal');assert.equal(player.hidden,false,'the departing scene must remain rendered until settle');h.settle();assert.equal(h.list.hidden,false);assert.equal(h.list.inert,false);});
test('library lifecycle reset must preserve incoming vertical scene during initial navigation',()=>{const h=harness();h.context.SET.animations='normal';h.Nav.cur='player';h.context.scene.ownership();h.Nav.go('library');assert.equal(h.Nav.cur,'library');assert.ok(h.context.scene.finish?.pending);assert.equal(h.root.hidden,false,'incoming library must remain rendered during its arrival');h.settle();assert.equal(h.root.inert,false);});
test('two-finger cancellation on the same library surface cannot activate an old row',()=>{const h=nested();h.fire(h.list,'pointerdown',{target:h.row});h.fire(h.list,'pointermove',{target:h.row,clientX:280});h.paint();h.fire(h.list,'pointerdown',{target:h.row,pointerId:2,isPrimary:false});h.fire(h.list,'pointerup',{target:h.row,pointerId:2,isPrimary:false});h.fire(h.list,'pointerup',{target:h.row,clientX:280});assert.equal(h.fire(h.list,'click',{target:h.row}).prevented,true);h.fire(h.list,'pointerdown',{target:h.row,pointerId:3});h.fire(h.list,'pointerup',{target:h.row,pointerId:3});assert.notEqual(h.fire(h.list,'click',{target:h.row,pointerId:3}).prevented,true);});

function installContactPlaneFixture(h){
  const shared=h.context.shared;
  shared.create=scene=>{const input=h.document.body.appendChild(new Element('div')),mini=h.document.querySelectorAll('*').find(n=>n.id==='mini'),full=h.document.querySelectorAll('*').find(n=>n.id==='sc-player');input.classList.add('player-scene-input');const m={opening:scene.target==='player',p:scene.target==='player'?0:1,input,mini,full,focus:[]};shared.bindInput(m);return m;};
  // Scene construction/painting is covered by morph-review. This fixture uses
  // the real input plane, lifecycle, shared settle and ScreenDrag routing.
  shared.paint=(m,p)=>{m.p=p;shared.lockOriginals(m);m.mini.hidden=m.full.hidden=false;m.mini.style.opacity=m.full.style.opacity='0';};
  shared.clean=m=>{m.disposeInput();m.input.remove();m.mini.inert=false;m.full.inert=false;m.mini.style.opacity=m.full.style.opacity='';};
}
test('dedicated shared-player contact plane keeps library history gesture ownership separate',{skip:!source.includes('const SharedPlayerMotion=')},()=>{const h=nested();installContactPlaneFixture(h);h.context.SET.animations='normal';h.Nav.go('player');const m=h.context.scene.settling.morph;assert.ok(m.input.isConnected);h.Nav.go('list');assert.equal(h.list.hidden,false);const index=h.history.index;h.fire(m.input,'pointerdown');assert.equal(h.context.lifecycle.gesture.node,m.input);h.fire(m.input,'pointermove',{clientX:280});h.paint();assert.equal(h.motion.state,null);assert.equal(h.history.index,index);h.fire(m.input,'pointerup',{clientX:280});h.settle();assert.equal(h.Nav.cur,'list');assert.equal(h.history.index,index);assert.equal(h.motion.state,null);assert.equal(h.context.lifecycle.gesture,null);assert.equal(h.list.inert,false);assert.equal(h.context.lifecycle.resets.has(m.resetInput),false);});
test('third-screen navigation retires a shared-player plane without changing library history',{skip:!source.includes('const SharedPlayerMotion=')},()=>{const h=nested();installContactPlaneFixture(h);h.context.SET.animations='normal';const index=h.history.index;h.Nav.go('player');const m=h.context.scene.settling.morph;h.Nav.go('settings');h.settle();assert.equal(h.Nav.cur,'settings');assert.equal(h.history.index,index);assert.equal(h.context.lifecycle.resets.has(m.resetInput),false);assert.equal(m.input.parentElement,null);assert.equal(h.motion.state,null);});
test('a stationary library contact canceled by lifecycle cannot become a delayed row tap',()=>{const h=nested();h.fire(h.list,'pointerdown',{target:h.row});h.fire(h.window,'blur');h.fire(h.list,'pointerup',{target:h.row});assert.equal(h.fire(h.list,'click',{target:h.row}).prevented,true);h.fire(h.list,'pointerdown',{target:h.row});h.fire(h.list,'pointerup',{target:h.row});assert.notEqual(h.fire(h.list,'click',{target:h.row}).prevented,true);});
test('root category vertical movement cannot become a click when no native cancellation arrives',()=>{const h=harness();h.fire(h.root,'pointerdown',{target:h.cats});h.fire(h.root,'pointermove',{target:h.cats,clientY:420});h.fire(h.root,'pointerup',{target:h.cats,clientY:420});assert.equal(h.fire(h.root,'click',{target:h.cats}).prevented,true);h.fire(h.root,'pointerdown',{target:h.cats});h.fire(h.root,'pointerup',{target:h.cats});assert.notEqual(h.fire(h.root,'click',{target:h.cats}).prevented,true);});
test('generic vertical-to-horizontal takeover preserves painted library continuity',()=>{const h=harness();h.context.SET.animations='normal';h.Nav.go('settings');const settings=h.document.querySelectorAll('*').find(n=>n.id==='sc-settings');h.root.paintedTransform='matrix(1,0,0,1,0,75)';settings.paintedTransform='matrix(1,0,0,1,0,-350)';h.Nav.go('library');assert.ok(h.context.scene.finish?.pending);assert.equal(h.root.hidden,false);h.fire(h.root,'pointerdown',{target:h.cats});h.fire(h.root,'pointermove',{target:h.cats,clientX:280});h.paint();if(h.motion.state){const y=h.context.gestureMotion.offset(h.motion.state.from,'y');assert.equal(y,75,'claimed horizontal page must retain current painted vertical offset');}else assert.ok(h.context.scene.finish?.pending,'deferred horizontal ownership must let the existing scene continue');});
test('root moved-contact click guard survives a second finger on the same surface',()=>{const h=harness();h.fire(h.root,'pointerdown',{target:h.cats});h.fire(h.root,'pointermove',{target:h.cats,clientY:420});h.fire(h.root,'pointerdown',{target:h.cats,pointerId:2,isPrimary:false});h.fire(h.root,'pointerup',{target:h.cats,pointerId:2,isPrimary:false});h.fire(h.root,'pointerup',{target:h.cats,clientY:420});assert.equal(h.fire(h.root,'click',{target:h.cats}).prevented,true);});

test('new horizontal snapshots restore viewport scroll only after acquiring a layout box',()=>{const h=nested();h.motion.host.__cssomScrollRoot=true;h.fire(h.list,'pointerdown',{target:h.row});h.fire(h.list,'pointermove',{target:h.row,clientX:280});h.paint();const source=h.motion.state.from.querySelectorAll('*').find(n=>n.dataset.pageSourceId==='list-body');assert.equal(source.scrollTop,618,'snapshot must preserve current viewport rather than resetting to list start');});
test('regrabbing a resisted history edge cannot move opposite the new finger delta',()=>{const h=harness();h.context.SET.animations='normal';h.swipe(h.root,120);assert.ok(h.motion.finish?.pending);h.motion.state.from.paintedTransform='translateX(12px)';h.fire(h.motion.host,'pointerdown');assert.equal(h.motion.state.from.style.transform,'translateX(12px)');delete h.motion.state.from.paintedTransform;h.fire(h.motion.host,'pointermove',{clientX:180});h.paint();assert.ok(h.motion.state.x>=12,'continuing right must not jump the page back to 7.04px');h.fire(h.motion.host,'pointerup',{clientX:180});h.settle();assert.equal(h.history.index,0);assert.equal(h.motion.state,null);});
test('generic peer backdrop freezes both axes on regrab and is retired with its selected library page',()=>{const h=harness();h.context.SET.animations='normal';h.Nav.go('settings');const settings=h.document.querySelectorAll('*').find(n=>n.id==='sc-settings');h.root.paintedTransform='matrix(1,0,0,1,0,75)';settings.paintedTransform='matrix(1,0,0,1,0,-350)';h.Nav.go('library');h.fire(h.root,'pointerdown',{target:h.cats});h.fire(h.root,'pointermove',{target:h.cats,clientX:280});h.paint();const state=h.motion.state;assert.ok(state.backdrop);assert.equal(state.y,75);assert.equal(state.backdrop.y,-350);assert.equal(state.backdrop.node.inert,true);h.fire(h.root,'pointerup',{target:h.cats,clientX:280});state.from.paintedTransform='matrix(1,0,0,1,12,40)';state.backdrop.node.paintedTransform='matrix(1,0,0,1,0,-480)';h.fire(h.motion.host,'pointerdown');assert.equal(state.y,40);assert.equal(state.backdrop.y,-480);assert.equal(state.from.style.transform,'translateX(12px) translateY(40px)');assert.equal(state.backdrop.node.style.transform,'translateX(0px) translateY(-480px)');h.advance(500);assert.equal(state.y,40);const ids=[h.document,...h.document.querySelectorAll('*')].filter(n=>n.id).map(n=>n.id);assert.equal(new Set(ids).size,ids.length);h.fire(h.motion.host,'pointerup');h.settle();assert.equal(h.motion.state,null);assert.equal(h.motion.host.children.length,0);assert.equal(h.root.inert,false);assert.equal(h.Nav.cur,'library');});

// Touch pointerdown is implicitly captured by the actual hit-tested child.
// When the broad surface takes explicit capture, the old child's bubbling
// lostpointercapture notification is NOT a loss of the surface's own stream.
// The earlier harness called the surface directly and omitted this transition.
// https://www.w3.org/TR/pointerevents/#process-pending-pointer-capture
function transferImplicitCapture(h,surface,target){
  h.fire(surface,'pointerdown',{target});target.setPointerCapture(1);
  h.advance(16);h.fire(surface,'pointermove',{target,clientX:176});h.paint();
  assert.equal(surface.hasPointerCapture(1),true);
  target.releasePointerCapture(1);
  const e={type:'lostpointercapture',target,pointerId:1,pointerType:'touch',isPrimary:true,timeStamp:1016,
    preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.immediateStopped=true;}};
  for(let node=target;node&&!e.immediateStopped;node=node.parentElement)node.fire('lostpointercapture',e);
}
test('row implicit-to-page capture transfer must retain broad horizontal drag ownership',()=>{
  const h=nested();h.context.SET.animations='normal';transferImplicitCapture(h,h.list,h.row);
  assert.equal(h.context.lifecycle.gesture?.node,h.list,'old row capture loss must not cancel the page owner');
  assert.equal(h.motion.finish,null,'the child capture notification must not start a rollback');
  h.advance(16);h.fire(h.list,'pointermove',{clientX:280});h.paint();
  assert.equal(h.motion.state.x,120,'later captured moves must continue tracking the finger');
  h.advance(120);h.fire(h.list,'pointerup',{clientX:280});h.settle();
  assert.equal(h.Views.currentSpec.kind,'artists');assert.equal(h.history.index,1);
});
test('category child capture transfer must preserve left-forward from Library root',()=>{
  const h=harness();h.Views.push({kind:'all'});h.Views.back();h.context.SET.animations='normal';
  const category=h.cats.appendChild(new Element());category.classList.add('catrow');category.setAttribute('role','button');
  transferImplicitCapture(h,h.root,category);
  assert.equal(h.context.lifecycle.gesture?.node,h.root);
  h.advance(16);h.fire(h.root,'pointermove',{clientX:40});h.paint();
  assert.equal(h.motion.state.x,-120);
  h.advance(120);h.fire(h.root,'pointerup',{clientX:40});h.settle();
  assert.equal(h.Nav.cur,'list');assert.equal(h.Views.currentSpec.kind,'all');
});
test('capture loss from the actual page owner still cancels and suppresses the moved contact',()=>{
  const h=nested();h.fire(h.list,'pointerdown',{target:h.row});h.fire(h.list,'pointermove',{target:h.row,clientX:280});h.paint();
  h.list.releasePointerCapture(1);h.fire(h.list,'lostpointercapture',{target:h.list});
  assert.equal(h.fire(h.list,'click',{target:h.row}).prevented,true);h.settle();
  assert.equal(h.history.index,2);assert.equal(h.context.lifecycle.gesture,null);assert.equal(h.motion.state,null);
});
