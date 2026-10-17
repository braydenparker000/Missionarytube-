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
  // CSSOM setter model: display:none ancestors have no scrollable box.
  get scrollTop(){let modeled=false,hidden=false;for(let n=this;n;n=n.parentElement){modeled ||= !!n.__cssomScrollRoot;hidden ||= !!n.hidden;}return modeled&&hidden?0:this._scrollTop||0;}
  set scrollTop(value){let modeled=false,hidden=false;for(let n=this;n;n=n.parentElement){modeled ||= !!n.__cssomScrollRoot;hidden ||= !!n.hidden;}if(!modeled||!hidden)this._scrollTop=Number(value);}
  get scrollLeft(){let modeled=false,hidden=false;for(let n=this;n;n=n.parentElement){modeled ||= !!n.__cssomScrollRoot;hidden ||= !!n.hidden;}return modeled&&hidden?0:this._scrollLeft||0;}
  set scrollLeft(value){let modeled=false,hidden=false;for(let n=this;n;n=n.parentElement){modeled ||= !!n.__cssomScrollRoot;hidden ||= !!n.hidden;}if(!modeled||!hidden)this._scrollLeft=Number(value);}
  getContext(type){if(this.tagName!=='CANVAS'||type!=='2d')return null;return {drawImage:source=>{if(source.__canvasCopyFailure)throw new Error('Unavailable fixture bitmap');this.__bitmap=source.__bitmap;this.__canvasDraws=(this.__canvasDraws||0)+1;}};}
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
  cloneNode(deep){const node=new Element(this.tagName,this.id);Object.assign(node.style,this.style);Object.assign(node.dataset,this.dataset);Object.assign(node.attrs,this.attrs);node.textContent=this.textContent;node.hidden=this.hidden;node.inert=this.inert;if(this.tagName==='CANVAS'){node.width=this.width;node.height=this.height;}node.classList.add(...this.classList);if(deep)this.children.forEach(n=>node.appendChild(n.cloneNode(true)));return node;}
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
  const Nav={cur:'library',lastLibrary:'library',go(name){if(this.cur!==name)context.lifecycle.cancel({preserveScene:true});this.cur=name;context.ScreenDrag.ownership();}};
  const Views={stack:[],render(spec,keep){context.lifecycle.cancel();this.currentSpec=spec;this.currentData={items:[]};title.textContent=spec.title||spec.kind;if(!keep)listBody.scrollTop=0;calls.push(['render',plain(spec)]);},renderLibrary(){calls.push(['root']);},push(spec){this.stack.push(spec);this.render(spec);Nav.go('list');}};
  const Selection={mode:false,exit(){this.mode=false;calls.push(['exit-selection']);}},Sheets={open:null};
  const SCREENS={library:'#sc-library',list:'#sc-list'};
  const ScreenDrag={activating:false,abort(){},activate(name){this.activating=true;try{Nav.go(name,false);}finally{this.activating=false;}},ownership(){for(const [name,selector] of Object.entries(SCREENS)){const node=$(selector);node.inert=Nav.cur!==name;node.hidden=Nav.cur!==name;node.setAttribute('aria-hidden',String(node.inert));}}};
  const context=vm.createContext({document,window,$,Nav,Views,Selection,Sheets,SCREENS,ScreenDrag,UI:{vizFull:false},SET:{animations:'disabled'},innerWidth:393,performance:{now:()=>now},getComputedStyle:n=>({transform:n.paintedTransform||n.style.transform||'none',overflowX:n.style.overflowX||'visible'}),matchMedia:()=>({matches:false}),clamp:(v,a,b)=>Math.max(a,Math.min(b,v)),history:{pushState:()=>calls.push(['browser-history'])},setTimeout:(fn,ms)=>{timers.set(++serial,{fn,at:now+ms});return serial;},clearTimeout:id=>timers.delete(id),requestAnimationFrame:fn=>{frames.set(++serial,fn);return serial;},cancelAnimationFrame:id=>frames.delete(id)});
  document.createElement=tag=>new Element(tag);
  vm.runInContext(source.slice(source.indexOf('const InputLifecycle='),source.indexOf('const Nav='))+'\nglobalThis.lifecycle=InputLifecycle;',context);
  vm.runInContext(source.slice(source.indexOf('function bindTapButton('),source.indexOf('function bindTransportButton(')),context);
  vm.runInContext(source.slice(source.indexOf('const GestureMotion='),source.indexOf('const SwipeArt=')),context);
  vm.runInContext(source.slice(source.indexOf('const LibraryPageHistory='),source.indexOf('async function boot(){'))+'\nglobalThis.pages=LibraryPageHistory;globalThis.motion=LibraryPageMotion;LibraryPageHistory.install();',context);
  const h={context,document,window,root,list,cats,listBody,title,alpha,button,row,Nav,Views,Selection,Sheets,calls,timers,frames,history:context.pages,motion:context.motion,
    advance(ms){now+=ms;for(const [id,t] of [...timers])if(t.at<=now){timers.delete(id);t.fn();}},paint(){for(const [id,fn] of [...frames]){frames.delete(id);fn(now);}},
    fire(node,type,args={}){const e={type,pointerId:1,pointerType:'touch',isPrimary:true,button:0,target:node,clientX:160,clientY:300,timeStamp:now,cancelable:true,detail:1,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.immediateStopped=true;},...args};if(type.startsWith('pointer')||type==='click')document.fire(type,e);if(!e.immediateStopped)node.fire(type,e);if(type==='click'&&!e.immediateStopped)node.onclick?.(e);return e;},
    swipe(node,dx,dy=0){this.fire(node,'pointerdown');this.advance(150);this.fire(node,'pointermove',{clientX:160+dx,clientY:300+dy});this.paint();this.advance(150);this.fire(node,'pointerup',{clientX:160+dx,clientY:300+dy});},
    settle(){this.advance(1000);}
  };ScreenDrag.ownership();return h;
}
function nested(){const h=harness();h.Views.push({kind:'artists'});h.listBody.scrollTop=245;h.Views.push({kind:'artist',key:'Mira Vale',title:'Mira Vale'});h.listBody.scrollTop=618;return h;}

// Execute the rendered header's real binding with the production tap owner and
// production ancestry/history implementation. No compatibility click is added.
function backControl(h){
  const start=source.indexOf("back.setAttribute('aria-label','Back to '+backLabel);"),end=source.indexOf('header.append(back);',start)+'header.append(back);'.length;
  assert.ok(start>=0&&end>start);Object.assign(h.context,{back:h.button,backLabel:'Artists',header:{append() {}}});
  vm.runInContext(source.slice(start,end),h.context);return h.button;
}

test('post-swipe touch and pen Back releases preserve ancestry without a compatibility click',()=>{
  for(const pointerType of ['touch','pen']){
    const h=nested();h.swipe(h.list,120);h.swipe(h.list,-120);const back=backControl(h),label=back.appendChild(new Element('span'));
    h.fire(back,'pointerdown',{pointerType,target:label});h.advance(30);h.fire(back,'pointerup',{pointerType,target:label});
    assert.equal(h.Views.currentSpec.kind,'artists',pointerType);assert.equal(h.history.index,1);assert.equal(h.listBody.scrollTop,245);assert.deepEqual(plain(h.Views.stack.map(s=>s.kind)),['artists']);assert.equal(h.history.peek(1).spec.key,'Mira Vale');
    assert.equal(h.fire(back,'click',{pointerType,target:label}).prevented,true);assert.equal(h.history.index,1,'a trailing click cannot go Back twice');
    h.Views.push({kind:'artist',key:'Juniper Static'});assert.equal(h.history.peek(1),null);assert.deepEqual(plain(h.Views.stack.map(s=>s.key||s.kind)),['artists','Juniper Static']);
  }
});

test('Back movement, cancellation, capture loss and lifecycle interruption leave ancestry unchanged',()=>{
  for(const mode of ['move','pointercancel','lostpointercapture','blur','resize','visibilitychange','second-contact','long-hold']){
    const h=nested(),back=backControl(h);h.fire(back,'pointerdown');
    if(mode==='move')h.fire(back,'pointermove',{clientX:190});
    else if(mode==='blur'||mode==='resize')h.fire(h.window,mode);
    else if(mode==='visibilitychange'){h.document.hidden=true;h.fire(h.document,mode);}
    else if(mode==='second-contact'){h.fire(back,'pointerdown',{pointerId:2,isPrimary:false});h.fire(back,'pointerup',{pointerId:2,isPrimary:false});}
    else if(mode==='long-hold')h.advance(650);
    else h.fire(back,mode);
    h.fire(back,'pointerup');assert.equal(h.history.index,2,mode);assert.equal(h.fire(back,'click').prevented,true,mode+' suppresses its trailing click');assert.equal(h.history.index,2,mode+' cannot navigate through the stale click');
    h.document.hidden=false;h.fire(back,'pointerdown',{pointerId:3});h.advance(30);h.fire(back,'pointerup',{pointerId:3});assert.equal(h.history.index,1,mode+' permits the next fresh tap');
  }
});

test('Back retains mouse/keyboard, selection dismissal and inactive-screen protection',()=>{
  const mouse=nested(),mouseBack=backControl(mouse);mouse.fire(mouseBack,'pointerdown',{pointerType:'mouse'});mouse.fire(mouseBack,'pointerup',{pointerType:'mouse'});assert.equal(mouse.history.index,2);mouse.fire(mouseBack,'click',{pointerType:'mouse'});assert.equal(mouse.history.index,1);
  const keyboard=nested(),keyBack=backControl(keyboard);keyboard.fire(keyBack,'click',{detail:0,pointerId:-1});assert.equal(keyboard.history.index,1);keyboard.fire(keyBack,'click',{detail:0,pointerId:-1});assert.equal(keyboard.Nav.cur,'library');
  const selection=nested(),selectionBack=backControl(selection);selection.Selection.mode=true;selection.fire(selectionBack,'pointerdown');selection.fire(selectionBack,'pointerup');assert.equal(selection.Selection.mode,false);assert.equal(selection.history.index,2);selection.fire(selectionBack,'pointerdown',{pointerId:2});selection.fire(selectionBack,'pointerup',{pointerId:2});assert.equal(selection.history.index,1);
  for(const mode of ['hidden','inert','disabled','seek']){const h=nested(),back=backControl(h);if(mode==='seek')h.context.UI.seekDragging=true;else if(mode==='disabled')back.disabled=true;else h.list[mode]=true;h.fire(back,'pointerdown');h.fire(back,'pointerup');h.fire(back,'click',{detail:0});assert.equal(h.history.index,2,mode);}
});

test('repeated Back header replacement keeps shared listeners and lifecycle resets bounded',()=>{
  const h=nested(),documentHandlers=h.document.handlers.pointerdown.length,resets=h.context.lifecycle.resets.size;
  for(let i=0;i<120;i++){
    // Production render cancels before removing its old header. The next cancel
    // drops that disconnected reset; the document must never retain the button.
    h.context.lifecycle.cancel();h.button.remove();h.button.isConnected=false;
    h.button=h.list.appendChild(new Element('button','library-back'));backControl(h);
    assert.equal(h.document.handlers.pointerdown.length,documentHandlers,'header '+i+' adds no document handler');
    assert.ok(h.context.lifecycle.resets.size<=resets+2,'only current and just-detached header resets remain');
  }
  const back=h.button;h.fire(back,'pointerdown');h.fire(h.row,'pointerdown',{pointerId:2,isPrimary:false});h.fire(h.row,'pointerup',{pointerId:2,isPrimary:false});h.fire(back,'pointerup');
  assert.equal(h.fire(back,'click').prevented,true,'a contact on another target still cancels Back through the shared owner');assert.equal(h.history.index,2);
  h.fire(back,'pointerdown',{pointerId:3});h.fire(back,'pointerup',{pointerId:3});assert.equal(h.history.index,1,'current header still accepts a fresh tap');
  back.remove();back.isConnected=false;h.context.lifecycle.cancel();
  assert.equal(h.document.handlers.pointerdown.length,documentHandlers);assert.equal(h.context.lifecycle.resets.size,resets,'disconnected header resets are released');
});

test('library visits distinguish horizontal history from nested ancestry',()=>{const h=nested();assert.deepEqual(plain(h.history.entries.map(e=>[e.screen,e.spec?.kind])),[['library',undefined],['list','artists'],['list','artist']].map(plain));h.Views.back();assert.equal(h.Views.currentSpec.kind,'artists');assert.equal(h.listBody.scrollTop,245);assert.deepEqual(plain(h.Views.stack.map(s=>s.kind)),['artists']);assert.equal(h.history.peek(1).spec.kind,'artist');assert.equal(h.history.move(1),true);assert.equal(h.Views.currentSpec.key,'Mira Vale');assert.equal(h.listBody.scrollTop,618);assert.deepEqual(plain(h.Views.stack.map(s=>s.kind)),['artists','artist']);});
test('right swipe goes to the prior visited page, left returns to the page just left',()=>{const h=nested();h.swipe(h.list,120);assert.equal(h.Views.currentSpec.kind,'artists');assert.equal(h.listBody.scrollTop,245);h.swipe(h.list,-120);assert.equal(h.Views.currentSpec.kind,'artist');assert.equal(h.listBody.scrollTop,618);});
test('root Library participates in Back and Forward and restores its own scroll',()=>{const h=harness();h.cats.scrollTop=189;h.Views.push({kind:'all'});h.listBody.scrollTop=482;h.swipe(h.list,120);assert.equal(h.Nav.cur,'library');assert.equal(h.cats.scrollTop,189);assert.equal(h.Views.stack.length,0);h.swipe(h.root,-120);assert.equal(h.Nav.cur,'list');assert.equal(h.listBody.scrollTop,482);assert.equal(h.Views.currentSpec.kind,'all');});
test('new navigation after Back truncates the abandoned forward branch',()=>{const h=nested();h.Views.back();h.Views.push({kind:'artist',key:'Juniper Static'});assert.equal(h.history.peek(1),null);assert.equal(h.history.entries.some(e=>e.spec?.key==='Mira Vale'),false);assert.deepEqual(plain(h.Views.stack.map(s=>s.key||s.kind)),['artists','Juniper Static']);});
test('visiting root from a category resets stale ancestry without losing visited history',()=>{const h=nested();h.Nav.go('library');h.Views.push({kind:'albums'});assert.deepEqual(plain(h.Views.stack.map(s=>s.kind)),['albums']);h.Views.back();assert.equal(h.Nav.cur,'library');h.history.move(-1);assert.equal(h.Views.currentSpec.kind,'artist');assert.deepEqual(plain(h.Views.stack.map(s=>s.kind)),['artists','artist']);});
test('same-screen returns from the player do not duplicate or truncate visits',()=>{const h=nested();h.Nav.go('player');h.Nav.go('list');assert.equal(h.history.entries.length,3);assert.equal(h.history.index,2);h.Views.back();h.Nav.go('player');h.Nav.go('list');assert.equal(h.history.peek(1).spec.key,'Mira Vale');});
function recordCaptures(h){const captures=[],capture=h.motion.capture.bind(h.motion);h.motion.capture=(screen,savedScroll)=>{captures.push({screen,savedScroll,title:h.title.textContent});h.calls.push(['capture',screen]);return capture(screen,savedScroll);};return captures;}
const snapshotScroll=(snapshot,id)=>{const index=[snapshot.node,...snapshot.node.querySelectorAll('*')].findIndex(n=>n.dataset.pageSourceId===id);return snapshot.scroll.find(([i])=>i===index)?.slice(1)||[0,0];};

test('library-to-player saves navigation state without a viewport clone or scheduled capture',()=>{
  const h=nested(),captures=recordCaptures(h),entry=h.history.current();h.listBody.scrollLeft=37;
  h.Nav.go('player');assert.equal(captures.length,0);assert.equal(entry.scrollTop,618);assert.equal(entry.scrollLeft,37);assert.equal(entry.spec.scrollTop,618);assert.equal(entry.stack.at(-1).scrollTop,618);assert.equal(entry.snapshotDeferred,true);
  assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);h.advance(10000);h.paint();assert.equal(captures.length,0,'no idle capture competes with the player morph');
  h.context.lifecycle.cancel();h.Nav.go('list');assert.equal(captures.length,0);assert.equal(h.history.current(),entry);assert.equal(h.history.index,2);assert.equal(h.history.entries.length,3);
});

test('a later horizontal gesture captures the returned page with its fresh scroll before mounting',()=>{
  const h=nested(),captures=recordCaptures(h),entry=h.history.current();h.Nav.go('player');h.Nav.go('list');h.listBody.scrollTop=731;h.listBody.scrollLeft=22;
  h.fire(h.list,'pointerdown');h.fire(h.list,'pointermove',{clientX:280});h.paint();
  assert.equal(captures.length,1);assert.equal(captures[0].screen,'list');assert.equal(entry.snapshotDeferred,false);assert.deepEqual(plain(snapshotScroll(entry.snapshot,'list-body')),[731,22]);
  const from=h.motion.state.from.querySelectorAll('*').find(n=>n.dataset.pageSourceId==='list-body');assert.equal(from.scrollTop,731);assert.equal(from.scrollLeft,22);
  h.fire(h.list,'pointercancel',{clientX:280});h.settle();assert.equal(h.motion.state,null);assert.equal(h.history.index,2);
});

test('opening a new category from player captures the old retained page before replacing its DOM',()=>{
  const h=nested(),captures=recordCaptures(h),entry=h.history.current();h.list.__cssomScrollRoot=true;h.listBody.scrollLeft=37;
  h.Nav.go('player');assert.equal(h.listBody.scrollTop,0,'the hidden source has no CSSOM scrolling box');assert.equal(captures.length,0);
  h.calls.length=0;h.Views.push({kind:'albums',title:'Albums'});
  assert.equal(captures.length,1);assert.equal(captures[0].title,'Mira Vale');assert.deepEqual(plain(snapshotScroll(entry.snapshot,'list-body')),[618,37]);assert.equal(entry.snapshotDeferred,false);
  assert.equal(h.calls[0][0],'capture');assert.equal(h.calls[1][0],'render');assert.equal(entry.snapshot.node.querySelectorAll('*').find(n=>n.dataset.pageSourceId==='list-title').textContent,'Mira Vale');
  h.history.move(-1);assert.equal(h.Views.currentSpec.key,'Mira Vale');assert.equal(h.listBody.scrollTop,618);
});

test('player-to-root branch preserves the pending list picture and primary scroll',()=>{
  const h=nested(),captures=recordCaptures(h),entry=h.history.current();h.list.__cssomScrollRoot=true;h.Nav.go('player');h.Nav.go('library');
  assert.equal(captures.length,1);assert.equal(captures[0].screen,'list');assert.deepEqual(plain(snapshotScroll(entry.snapshot,'list-body')),[618,0]);assert.equal(entry.snapshotDeferred,false);
  assert.equal(h.history.current().screen,'library');assert.equal(h.history.peek(-1),entry);h.swipe(h.root,120);assert.equal(h.Views.currentSpec.key,'Mira Vale');assert.equal(h.listBody.scrollTop,618);
});

test('root-player detours stay cheap and root capture waits for an actual category change',()=>{
  const h=harness(),captures=recordCaptures(h),entry=h.history.current();h.root.__cssomScrollRoot=true;h.cats.scrollTop=189;
  for(let i=0;i<4;i++){h.Nav.go('player');h.context.lifecycle.cancel();h.Nav.go('library');}
  assert.equal(captures.length,0);assert.equal(entry.snapshotDeferred,true);h.Nav.go('player');h.Views.push({kind:'all'});
  assert.equal(captures.length,1);assert.equal(captures[0].screen,'library');assert.deepEqual(plain(snapshotScroll(entry.snapshot,'lib-cats')),[189,0]);assert.equal(entry.snapshotDeferred,false);
});

test('deferred pictures cannot outlive visit eviction through asynchronous jobs',()=>{
  const h=nested(),captures=recordCaptures(h);h.history.limit=5;
  for(let i=0;i<12;i++){h.Nav.go('player');const leaving=h.history.current();const count=captures.length;h.advance(10000);h.paint();assert.equal(captures.length,count);h.Views.push({kind:'tree',path:'folder/'+i});assert.equal(leaving.snapshotDeferred,false);assert.ok(h.history.entries.length<=5);}
  assert.equal(h.frames.size,0);assert.equal(h.timers.size,0);assert.ok(h.history.entries.every(entry=>!entry.snapshotDeferred));
});

test('deferred capture keeps its last valid picture if the retained source was replaced or removed',()=>{
  for(const mode of ['replaced','removed']){const h=nested();h.history.save();const entry=h.history.current(),previous=entry.snapshot;h.Nav.go('player');const captures=recordCaptures(h);
    if(mode==='replaced'){h.Views.currentSpec={kind:'albums'};h.Views.stack=[h.Views.currentSpec];}else h.list.remove();
    h.history.captureDeferred();assert.equal(entry.snapshot,previous,mode);assert.equal(entry.snapshotDeferred,false,mode);assert.equal(captures.length,mode==='replaced'?0:1,mode);
  }
});

test('production TrackWindow ignores hidden ResizeObserver refreshes without changing mounted distant rows or spacers',()=>{
  const h=nested(),box=h.listBody.appendChild(new Element('div'));box.classList.add('list');box.__items=Array.from({length:5000},(_,i)=>({id:'track-'+i}));box.__spec={kind:'all'};
  for(const i of [1180,1181]){const row=box.appendChild(new Element());row.dataset.i=String(i);}
  const rows=box.children.slice();box.closest=selector=>selector==='.scroll'?h.listBody:null;box.getBoundingClientRect=()=>({width:393});box.prepend=node=>{node.parentElement=box;box.children.unshift(node);};box.append=node=>box.appendChild(node);
  h.context.el=(tag,classes)=>{const n=new Element(tag);n.classList.add(classes);return n;};let resized;
  h.context.ResizeObserver=class{constructor(fn){resized=fn;}observe(){}disconnect(){}};
  vm.runInContext(source.slice(source.indexOf('const TrackWindow='),source.indexOf('/* lazy album art loading */'))+'\nglobalThis.trackWindow=TrackWindow;',h.context);
  h.Nav.go('player');const window=h.context.trackWindow.create(box);h.paint();const before=box.children.slice(),spaces=box.children.filter(n=>n.classList.contains('track-spacer')).map(n=>({...n.style}));
  for(let i=0;i<3;i++){resized();h.paint();window.refresh();}
  assert.deepEqual(box.children,before);assert.deepEqual(box.children.filter(n=>n.classList.contains('track-spacer')).map(n=>({...n.style})),spaces);assert.ok(rows.every(row=>box.children.includes(row)));assert.deepEqual(rows.map(row=>row.dataset.i),['1180','1181']);window.destroy();
});
test('bounded visits retain a deeply nested Back parent and its Forward destination',()=>{const h=harness();h.history.limit=5;for(let i=0;i<20;i++)h.Views.push({kind:'tree',path:'folder/'.repeat(i),title:'Folder '+i});assert.equal(h.history.entries.length,5);for(let i=0;i<12;i++){const before=h.Views.currentSpec.path;h.Views.back();assert.equal(h.history.entries.length,5);assert.equal(h.history.peek(1).spec.path,before);}assert.equal(h.Views.stack.length,8);});
test('page specs including queue view survive Back/Forward and refresh',()=>{const h=harness();h.Views.push({kind:'queue',queueView:'added'});h.Views.currentSpec.queueView='upcoming';h.Views.render(h.Views.currentSpec);h.listBody.scrollTop=225;h.Views.push({kind:'playlists'});h.history.move(-1);assert.equal(h.Views.currentSpec.queueView,'upcoming');assert.equal(h.listBody.scrollTop,225);});
test('Back exits selection without changing visits or scroll',()=>{const h=nested();h.Selection.mode=true;h.Views.back();assert.equal(h.history.index,2);assert.equal(h.listBody.scrollTop,618);assert.equal(h.Selection.mode,false);});
test('browser Back from a single category reaches Library',()=>{const h=harness();h.Views.push({kind:'all'});h.fire(h.window,'popstate');assert.equal(h.Nav.cur,'library');assert.equal(h.history.peek(1).spec.kind,'all');});
test('row taps stay on their original target and do not capture or claim',()=>{const h=nested();h.fire(h.list,'pointerdown',{target:h.row});assert.equal(h.list.captureCount,0);assert.equal(h.context.lifecycle.gesture,null);h.advance(40);h.fire(h.list,'pointerup',{target:h.row});assert.notEqual(h.fire(h.list,'click',{target:h.row}).prevented,true);assert.equal(h.motion.state,null);});
test('keyboard activation is never swallowed by a prior horizontal gesture',()=>{const h=nested();h.swipe(h.list,120);assert.notEqual(h.fire(h.list,'click',{target:h.row,detail:0}).prevented,true);});
test('native vertical movement never captures, prevents default, writes scroll or paints pages',()=>{const h=nested();h.fire(h.list,'pointerdown',{target:h.row});const e=h.fire(h.list,'pointermove',{target:h.row,clientY:420});h.paint();h.fire(h.list,'pointerup',{target:h.row,clientY:420});assert.equal(h.list.captureCount,0);assert.notEqual(e.prevented,true);assert.equal(h.listBody.scrollTop,618);assert.equal(h.motion.state,null);assert.equal(h.history.index,2);});
test('ambiguous diagonal movement cannot claim or navigate',()=>{const h=nested();h.swipe(h.list,65,65);assert.equal(h.list.captureCount,0);assert.equal(h.history.index,2);});
test('horizontal intent captures once after the threshold and continuously follows the finger',()=>{const h=nested();h.fire(h.list,'pointerdown',{target:h.row});h.fire(h.list,'pointermove',{target:h.row,clientX:166});assert.equal(h.list.captureCount,0);h.fire(h.list,'pointermove',{target:h.row,clientX:230});h.paint();assert.equal(h.list.captureCount,1);assert.equal(h.motion.state.from.style.transform,'translateX(70px)');assert.equal(h.motion.state.to.style.transform,'translateX(-323px)');assert.equal(h.list.inert,true);assert.equal(h.motion.host.hidden,false);assert.equal(h.history.index,2);});
test('under-threshold movement springs back without a visit',()=>{const h=nested();h.swipe(h.list,30);assert.equal(h.history.index,2);assert.equal(h.motion.host.hidden,true);assert.equal(h.list.inert,false);});
test('a fast directional reversal cancels even beyond the distance threshold',()=>{const h=nested();h.fire(h.list,'pointerdown');h.advance(50);h.fire(h.list,'pointermove',{clientX:310});h.paint();h.advance(20);h.fire(h.list,'pointermove',{clientX:270});h.paint();h.fire(h.list,'pointerup',{clientX:270});assert.equal(h.history.index,2);});
test('history edges rubber-band and never manufacture a visit',()=>{const h=harness();h.fire(h.root,'pointerdown');h.advance(150);h.fire(h.root,'pointermove',{clientX:280});h.paint();assert.equal(h.motion.state.target,null);assert.equal(h.motion.state.from.style.transform,'translateX(26.4px)');h.advance(150);h.fire(h.root,'pointerup',{clientX:280});assert.equal(h.history.index,0);assert.equal(h.motion.host.hidden,true);});
test('buttons, alpha strip, horizontal controls, selection and sheets retain their own gestures',()=>{for(const mode of ['button','alpha','horizontal','selection','sheet']){const h=nested();let target=h.row;if(mode==='button')target=h.button;if(mode==='alpha')target=h.alpha;if(mode==='horizontal'){target=new Element();target.dataset.horizontalGesture='';h.listBody.appendChild(target);}if(mode==='selection')h.Selection.mode=true;if(mode==='sheet')h.Sheets.open='sheet';h.fire(h.list,'pointerdown',{target});h.fire(h.list,'pointermove',{target,clientX:280});h.fire(h.list,'pointerup',{target,clientX:280});assert.equal(h.motion.state,null,mode);assert.equal(h.history.index,2,mode);}});
test('a second contact cancels horizontal ownership and a later single contact recovers',()=>{const h=nested();h.fire(h.list,'pointerdown');h.fire(h.list,'pointermove',{clientX:260});h.paint();h.fire(h.list,'pointerdown',{pointerId:2,isPrimary:false});assert.equal(h.motion.state,null);h.fire(h.list,'pointerup',{clientX:260});h.fire(h.list,'pointerup',{pointerId:2});assert.equal(h.history.index,2);h.swipe(h.list,120);assert.equal(h.history.index,1);});
test('pointer cancellation returns to the selected page without a stale completion',()=>{const h=nested();h.context.SET.animations='normal';h.fire(h.list,'pointerdown');h.fire(h.list,'pointermove',{clientX:280});h.paint();h.fire(h.list,'pointercancel',{clientX:280});h.settle();assert.equal(h.history.index,2);assert.equal(h.motion.state,null);assert.equal(h.list.inert,false);});
test('lost capture, blur, resize and hidden document cannot commit stale movement',()=>{for(const type of ['lostpointercapture','blur','resize','visibilitychange']){const h=nested();h.fire(h.list,'pointerdown');h.fire(h.list,'pointermove',{clientX:280});h.paint();if(type==='visibilitychange'){h.document.hidden=true;h.fire(h.document,type);}else h.fire(type==='lostpointercapture'?h.list:h.window,type);h.fire(h.list,'pointerup',{clientX:280});h.settle();assert.equal(h.history.index,2,type);assert.equal(h.motion.state,null,type);}});
test('snapshots have unique source-mapped IDs and no active focus or inline handlers',()=>{const h=nested();h.row.setAttribute('onclick','unwanted()');h.row.setAttribute('tabindex','0');h.fire(h.list,'pointerdown');h.fire(h.list,'pointermove',{clientX:280});h.paint();const clones=h.motion.host.querySelectorAll('*'),all=[h.document,...h.document.querySelectorAll('*')].filter(n=>n.id),ids=all.map(n=>n.id);assert.equal(new Set(ids).size,ids.length);assert.equal(h.motion.state.from.dataset.pageSourceId,'sc-list');assert.equal(h.motion.state.to.dataset.pageSourceId,'sc-list');assert.ok(clones.every(n=>n.getAttribute('onclick')===null&&n.getAttribute('tabindex')===null));assert.ok(h.motion.host.children.every(n=>n.inert&&n.getAttribute('aria-hidden')==='true'));assert.equal(h.motion.state.from.classList.contains('library-page-covered'),false);});
test('page restoration rerenders current data and refreshes only the mounted window',()=>{const h=nested();let refresh=0;const box=h.listBody.appendChild(new Element());box.classList.add('list');box.__window={refresh(){refresh++;}};h.history.move(-1);assert.equal(refresh,2);assert.equal(h.calls.at(-1)[0],'render');assert.equal(h.Views.currentSpec.kind,'artists');});
test('committed incoming pages can be regrabbed at their computed position and reversed',()=>{const h=nested();h.context.SET.animations='normal';h.swipe(h.list,120);assert.equal(h.history.index,1);assert.ok(h.motion.finish?.pending);const state=h.motion.state;state.from.paintedTransform='translateX(243px)';state.to.paintedTransform='translateX(-150px)';h.fire(h.motion.host,'pointerdown');assert.equal(h.motion.state.from.style.transform,'translateX(-150px)');assert.equal(h.motion.finish,null);h.advance(500);assert.equal(h.motion.state.from.style.transform,'translateX(-150px)');delete state.from.paintedTransform;delete state.to.paintedTransform;h.fire(h.motion.host,'pointermove',{clientX:115});h.paint();assert.equal(h.motion.state.from.style.transform,'translateX(-195px)');h.advance(150);h.fire(h.motion.host,'pointerup',{clientX:115});assert.equal(h.history.index,2);h.settle();assert.equal(h.Views.currentSpec.kind,'artist');assert.equal(h.motion.host.hidden,true);assert.equal(h.list.inert,false);});
test('held interruption resumes the current selected page without an extra visit',()=>{const h=nested();h.context.SET.animations='normal';h.swipe(h.list,120);const state=h.motion.state;state.from.paintedTransform='translateX(293px)';state.to.paintedTransform='translateX(-100px)';h.fire(h.motion.host,'pointerdown');h.advance(500);h.fire(h.motion.host,'pointerup');h.settle();assert.equal(h.history.index,1);assert.equal(h.history.entries.length,3);assert.equal(h.motion.state,null);});
test('changing tabs retires an in-flight horizontal settle without stale page restoration',()=>{const h=nested();h.context.SET.animations='normal';h.swipe(h.list,120);h.Nav.go('settings');h.settle();assert.equal(h.Nav.cur,'settings');assert.equal(h.history.index,1);assert.equal(h.motion.state,null);assert.equal(h.motion.host.hidden,true);});
test('disabled and reduced-motion horizontal settles leave no handle or overlay',()=>{for(const mode of ['disabled','reduced']){const h=nested();if(mode==='reduced'){h.context.SET.animations='normal';h.context.matchMedia=()=>({matches:true});}h.swipe(h.list,120);assert.equal(h.motion.finish,null);assert.equal(h.motion.state,null);assert.equal(h.motion.host.hidden,true);assert.equal(h.history.index,1);}});


test('shortcut Back inserts its parent directly behind the page so Forward returns to the shortcut',()=>{const h=nested();h.cats.scrollTop=180;h.Nav.go('player');h.Views.push({kind:'queue',queueView:'upcoming'});assert.deepEqual(plain(h.Views.stack.map(s=>s.kind)),['queue']);h.Views.back();assert.equal(h.Nav.cur,'library');assert.equal(h.history.peek(1).spec.kind,'queue');h.history.move(1);assert.equal(h.Views.currentSpec.kind,'queue');assert.deepEqual(plain(h.Views.stack.map(s=>s.kind)),['queue']);});

test('distant scroll restoration expands short fresh spacers before mounting the desired viewport',()=>{const h=nested();h.history.entries[1].scrollTop=120000;let actual=0,range=600;Object.defineProperty(h.listBody,'scrollTop',{get:()=>actual,set:value=>{actual=Math.min(range,value);}});const seen=[],box=h.listBody.appendChild(new Element());box.classList.add('list');box.__window={refresh(){seen.push(actual);range=500000;}};h.history.move(-1);assert.deepEqual(seen,[0,120000]);assert.equal(h.listBody.scrollTop,120000);assert.equal(h.motion.state,null);});

test('lifecycle cancellation suppresses its old row click but accepts fresh contacts and keyboard',()=>{for(const event of ['resize','blur','visibilitychange','second-contact']){const h=nested();h.fire(h.list,'pointerdown',{target:h.row});h.fire(h.list,'pointermove',{target:h.row,clientX:280});h.paint();if(event==='visibilitychange'){h.document.hidden=true;h.fire(h.document,event);}else if(event==='second-contact')h.fire(h.list,'pointerdown',{target:h.row,pointerId:2,isPrimary:false});else h.fire(h.window,event);h.fire(h.list,'pointerup',{target:h.row,clientX:280});assert.equal(h.fire(h.list,'click',{target:h.row}).prevented,true,event);assert.notEqual(h.fire(h.list,'click',{target:h.row,detail:0}).prevented,true,event);if(event==='second-contact')h.fire(h.list,'pointerup',{pointerId:2});h.document.hidden=false;h.fire(h.list,'pointerdown',{target:h.row,pointerId:3});h.fire(h.list,'pointerup',{target:h.row,pointerId:3});assert.notEqual(h.fire(h.list,'click',{target:h.row,pointerId:3}).prevented,true,event);}});

test('source-specific snapshot CSS retains ID specificity and leaves global selectors and colors intact',()=>{const h=nested();h.document.styleSheets=[{cssRules:[{selectorText:'body:has(#mini) #sc-list #list-body .scroll',style:{cssText:'color: #123456; padding: 12px;'}}]}];h.fire(h.list,'pointerdown');h.fire(h.list,'pointermove',{clientX:280});h.paint();const style=h.document.head.children.find(n=>n.id==='library-page-snapshot-styles');assert.match(style.textContent,/body:has\(#mini\)/);assert.match(style.textContent,/:is\(#library-page-style-id,\[data-page-source-id="sc-list"\]\)/);assert.match(style.textContent,/:is\(#library-page-style-id,\[data-page-source-id="list-body"\]\)/);assert.match(style.textContent,/color: #123456/);});

test('visual snapshots restore each source viewport scroll rather than the shared live list scroll',()=>{const h=nested();h.fire(h.list,'pointerdown');h.fire(h.list,'pointermove',{clientX:280});h.paint();const body=node=>node.querySelectorAll('*').find(n=>n.dataset.pageSourceId==='list-body');assert.equal(body(h.motion.state.from).scrollTop,618);assert.equal(body(h.motion.state.to).scrollTop,245);});

test('snapshot IDs stay unique even when supplied icon markup repeats local SVG IDs',()=>{const h=nested();const a=h.row.appendChild(new Element('path','clip')),b=h.row.appendChild(new Element('path','clip'));a.setAttribute('fill','url(#clip)');const snapshot=h.motion.capture('list'),nodes=[snapshot.node,...snapshot.node.querySelectorAll('*')],ids=nodes.filter(n=>n.id).map(n=>n.id);assert.equal(new Set(ids).size,ids.length);assert.ok(nodes.some(n=>n.getAttribute('fill')?.includes('url(#library-snapshot-')));assert.notEqual(a.id,ids[0]);assert.equal(b.id,'clip');});

test('a stationary possible row contact canceled by lifecycle cannot activate its old row',()=>{for(const event of ['blur','resize','visibilitychange','second-contact','pointercancel','lostpointercapture']){const h=nested();h.fire(h.list,'pointerdown',{target:h.row});assert.equal(h.list.captureCount,0);if(event==='visibilitychange'){h.document.hidden=true;h.fire(h.document,event);}else if(event==='second-contact')h.fire(h.list,'pointerdown',{target:h.row,pointerId:2,isPrimary:false});else if(event==='pointercancel'||event==='lostpointercapture')h.fire(h.list,event,{target:h.row});else h.fire(h.window,event);h.fire(h.list,'pointerup',{target:h.row});assert.equal(h.fire(h.list,'click',{target:h.row}).prevented,true,event);assert.notEqual(h.fire(h.list,'click',{target:h.row,detail:0}).prevented,true,event);if(event==='second-contact')h.fire(h.list,'pointerup',{pointerId:2});h.document.hidden=false;h.fire(h.list,'pointerdown',{target:h.row,pointerId:3});h.fire(h.list,'pointerup',{target:h.row,pointerId:3});assert.notEqual(h.fire(h.list,'click',{target:h.row,pointerId:3}).prevented,true,event);assert.equal(h.history.index,2,event);}});

test('root category vertical intent stays native and suppresses an uncanceled trailing category click',()=>{const h=harness();h.fire(h.root,'pointerdown',{target:h.cats});const move=h.fire(h.root,'pointermove',{target:h.cats,clientY:420});h.fire(h.root,'pointerup',{target:h.cats,clientY:420});assert.notEqual(move.prevented,true);assert.equal(h.root.captureCount,0);assert.equal(h.cats.scrollTop,0);assert.equal(h.fire(h.root,'click',{target:h.cats}).prevented,true);h.fire(h.root,'pointerdown',{target:h.cats});h.fire(h.root,'pointerup',{target:h.cats});assert.notEqual(h.fire(h.root,'click',{target:h.cats}).prevented,true);});


function genericArrival(){
  const h=nested(),peer=h.document.body.children[0].appendChild(new Element('section','sc-settings'));peer.classList.add('screen');peer.appendChild(new Element('button','setting-action'));h.context.SCREENS.settings='#sc-settings';
  h.context.SET.animations='normal';h.list.paintedTransform='matrix(1,0,0,1,0,75)';peer.paintedTransform='matrix(1,0,0,1,0,-350)';
  h.context.ScreenDrag.settling={from:h.list,to:peer,fromName:'list',target:'settings',height:680};h.context.ScreenDrag.finish={pending:true};
  h.context.ScreenDrag.abort=()=>{h.context.ScreenDrag.settling=null;h.context.ScreenDrag.state=null;h.context.ScreenDrag.finish=null;delete h.list.paintedTransform;delete peer.paintedTransform;h.context.ScreenDrag.ownership();};
  return {h,peer};
}
test('generic vertical-to-horizontal takeover preserves both painted pages in inert visual layers',()=>{const {h,peer}=genericArrival();h.fire(h.list,'pointerdown',{target:h.row});h.advance(50);h.fire(h.list,'pointermove',{target:h.row,clientX:280});h.paint();const s=h.motion.state;assert.equal(s.from.style.transform,'translateX(120px) translateY(75px)');assert.equal(s.to.style.transform,'translateX(-273px) translateY(75px)');assert.equal(s.backdrop.node.style.transform,'translateX(0px) translateY(-350px)');assert.equal(s.backdrop.node.dataset.pageSourceId,'sc-settings');assert.equal(s.backdrop.node.inert,true);assert.equal(s.backdrop.node.getAttribute('aria-hidden'),'true');assert.equal(peer.hidden,true);assert.equal(h.list.inert,true);assert.equal(h.context.ScreenDrag.settling,null);assert.equal(h.history.index,2);assert.equal(h.motion.host.children.length,3);const ids=h.document.querySelectorAll('*').filter(n=>n.id).map(n=>n.id);assert.equal(ids.length,new Set(ids).size);});
test('cross-axis release settles page Y to zero and regrab retains computed X/Y and peer position',()=>{const {h,peer}=genericArrival();h.fire(h.list,'pointerdown',{target:h.row});h.advance(50);h.fire(h.list,'pointermove',{target:h.row,clientX:280});h.paint();h.advance(150);h.fire(h.list,'pointerup',{target:h.row,clientX:280});assert.equal(h.history.index,1);let s=h.motion.state;assert.equal(s.from.style.transform,'translateX(393px)');assert.equal(s.to.style.transform,'translateX(0px)');assert.equal(s.backdrop.node.style.transform,'translateX(0px) translateY(-680px)');s.from.paintedTransform='matrix(1,0,0,1,220,40)';s.to.paintedTransform='matrix(1,0,0,1,-173,40)';s.backdrop.node.paintedTransform='matrix(1,0,0,1,0,-480)';h.fire(h.motion.host,'pointerdown');assert.equal(s.from.style.transform,'translateX(-173px) translateY(40px)');assert.equal(s.to.style.transform,'translateX(220px) translateY(40px)');assert.equal(s.backdrop.node.style.transform,'translateX(0px) translateY(-480px)');assert.equal(s.y,40);delete s.from.paintedTransform;delete s.to.paintedTransform;delete s.backdrop.node.paintedTransform;h.advance(500);h.fire(h.motion.host,'pointermove',{clientX:100});h.paint();assert.equal(s.from.style.transform,'translateX(-233px) translateY(40px)');h.advance(150);h.fire(h.motion.host,'pointerup',{clientX:100});assert.equal(h.history.index,2);h.settle();assert.equal(h.motion.state,null);assert.equal(h.motion.host.children.length,0);assert.equal(h.list.inert,false);assert.equal(peer.hidden,true);});
test('root vertical click suppression survives a second contact after native intent was relinquished',()=>{const h=harness();h.fire(h.root,'pointerdown',{target:h.cats});h.fire(h.root,'pointermove',{target:h.cats,clientY:420});h.fire(h.root,'pointerdown',{target:h.cats,pointerId:2,isPrimary:false});h.fire(h.root,'pointerup',{target:h.cats,pointerId:2,isPrimary:false});h.fire(h.root,'pointerup',{target:h.cats,clientY:420});assert.equal(h.fire(h.root,'click',{target:h.cats}).prevented,true);h.fire(h.root,'pointerdown',{target:h.cats,pointerId:3});h.fire(h.root,'pointerup',{target:h.cats,pointerId:3});assert.notEqual(h.fire(h.root,'click',{target:h.cats,pointerId:3}).prevented,true);});

test('CSSOM snapshot scrolling is replayed after layout for both list pages and the peer backdrop',()=>{const {h,peer}=genericArrival();h.motion.host.__cssomScrollRoot=true;const peerScroll=peer.appendChild(new Element('div','setting-scroll'));peerScroll.scrollTop=214;peerScroll.scrollLeft=31;h.fire(h.list,'pointerdown');h.fire(h.list,'pointermove',{clientX:280});h.paint();const body=node=>node.querySelectorAll('*').find(n=>n.dataset.pageSourceId==='list-body'),scroll=h.motion.state.backdrop.node.querySelectorAll('*').find(n=>n.dataset.pageSourceId==='setting-scroll');assert.equal(h.motion.host.hidden,false);assert.equal(body(h.motion.state.from).scrollTop,618);assert.equal(body(h.motion.state.to).scrollTop,245);assert.equal(scroll.scrollTop,214);assert.equal(scroll.scrollLeft,31);h.motion.abort();assert.equal(h.motion.host.hidden,true);assert.equal(h.motion.host.children.length,0);});
test('both resisted history edges retain the displayed regrab base and cross to a neighbor continuously',()=>{for(const direction of [1,-1]){const h=direction>0?harness():nested();if(direction>0){h.Views.push({kind:'all'});h.history.move(-1);}h.context.SET.animations='normal';h.swipe(direction>0?h.root:h.list,direction*120);h.motion.state.from.paintedTransform=`translateX(${direction*12}px)`;h.fire(h.motion.host,'pointerdown');delete h.motion.state.from.paintedTransform;h.motion.move(0);assert.ok(Math.abs(h.motion.state.x-direction*12)<1e-8);h.fire(h.motion.host,'pointermove',{clientX:160+direction*20});h.paint();assert.ok(Math.abs(h.motion.state.x-direction*16.4)<1e-8);h.fire(h.motion.host,'pointermove',{clientX:160-direction*20});h.paint();assert.ok(Math.abs(h.motion.state.x-direction*7.6)<1e-8);const origin=-direction*12/.22;h.motion.move(origin);assert.ok(Math.abs(h.motion.state.x)<1e-8);h.motion.move(origin-direction);assert.ok(Math.abs(h.motion.state.x+direction)<1e-8);assert.equal(h.motion.state.target.spec.kind,direction>0?'all':'artists');const index=h.history.index;h.advance(150);h.fire(h.motion.host,'pointerup',{clientX:160+origin-direction});h.settle();assert.equal(h.history.index,index);assert.equal(h.motion.state,null);}});
test('peer canvas pixels survive capture and mount without modifying their source',()=>{const {h,peer}=genericArrival(),canvas=peer.appendChild(new Element('canvas','curve'));canvas.width=512;canvas.height=256;canvas.__bitmap='generated-eq-fixture';h.fire(h.list,'pointerdown');h.fire(h.list,'pointermove',{clientX:280});h.paint();const copy=h.motion.state.backdrop.node.querySelectorAll('*').find(n=>n.dataset.pageSourceId==='curve');assert.equal(copy.__bitmap,'generated-eq-fixture');assert.equal(copy.width,512);assert.equal(copy.height,256);assert.equal(copy.__canvasDraws,1);assert.equal(canvas.__bitmap,'generated-eq-fixture');assert.equal(canvas.__canvasDraws,undefined);h.motion.abort();assert.equal(h.motion.host.children.length,0);assert.equal(canvas.__bitmap,'generated-eq-fixture');});
test('unavailable canvas bitmap copying cannot break navigation or leave a snapshot owner',()=>{const {h,peer}=genericArrival(),canvas=peer.appendChild(new Element('canvas','curve'));canvas.__canvasCopyFailure=true;h.fire(h.list,'pointerdown');h.fire(h.list,'pointermove',{clientX:280});h.paint();assert.ok(h.motion.state.backdrop);h.fire(h.list,'pointercancel',{clientX:280});h.settle();assert.equal(h.motion.state,null);assert.equal(h.motion.host.children.length,0);assert.equal(h.list.inert,false);assert.equal(h.history.index,2);});

test('a compatibility click retargeted to a replacement Back header cannot navigate twice',()=>{
  const h=nested(),old=backControl(h);old.classList.add('library-back');h.fire(old,'pointerdown',{pointerId:23});h.fire(old,'pointerup',{pointerId:23});assert.equal(h.history.index,1);
  old.remove();old.isConnected=false;h.button=h.list.appendChild(new Element('button','library-back'));h.button.classList.add('library-back');const replacement=backControl(h),label=replacement.appendChild(new Element('span'));
  const click=h.fire(replacement,'click',{pointerId:23,pointerType:'touch',target:label});assert.equal(click.prevented,true);assert.equal(h.history.index,1,'one original contact only returns one parent');
  h.fire(replacement,'pointerdown',{pointerId:24,target:label});h.fire(replacement,'pointerup',{pointerId:24,target:label});assert.equal(h.Nav.cur,'library','a fresh deliberate contact still navigates');
});
