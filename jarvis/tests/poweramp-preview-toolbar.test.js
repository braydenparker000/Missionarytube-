import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {previewHooks} from '../scripts/build-poweramp-preview.mjs';

const player=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');

// Exercise the actual injected toolbar bindings with the unchanged production
// tap owner. This model checks action/cancellation semantics, not browser input.
function harness(){
  let now=1000;const calls=[];
  const node=id=>({id,disabled:false,isConnected:true,handlers:new Map(),capture:new Set(),closest:()=>null,
    addEventListener(type,fn,options){const capture=options===true||!!options?.capture;const list=this.handlers.get(type)||[];list.push({fn,capture});this.handlers.set(type,list);},
    setPointerCapture(pointer){this.capture.add(pointer);},hasPointerCapture(pointer){return this.capture.has(pointer);}});
  const document=node('document'),window=node('window'),buttons=new Map(['preview-help','preview-reset','preview-size'].map(id=>[id,node(id)]));
  document.getElementById=id=>buttons.get(id);
  const Preview={count:60,help(){calls.push(['help']);},reset(count){calls.push(['reset',count]);this.count=count;context.lifecycle.cancel();}};
  const context=vm.createContext({document,window,Preview,performance:{now:()=>now},UI:{seekDragging:false},SCREENS:{},Nav:{cur:'player'}});
  vm.runInContext(player.slice(player.indexOf('const InputLifecycle='),player.indexOf('const Nav='))+'\nglobalThis.lifecycle=InputLifecycle;',context);
  vm.runInContext(player.slice(player.indexOf('function bindTapButton('),player.indexOf('function bindTransportButton(')),context);
  const start=previewHooks.indexOf("const help=document.getElementById('preview-help');"),end=previewHooks.indexOf("document.addEventListener('click',e=>",start);
  assert.ok(start>=0&&end>start);vm.runInContext('(function(){'+previewHooks.slice(start,end)+'}).call(Preview);',context);
  const listen=(target,e,capture)=>{for(const entry of target.handlers.get(e.type)||[]){if(entry.capture===capture)entry.fn(e);if(e.immediateStopped)break;}};
  const fire=(id,type,args={})=>{
    const target=buttons.get(id)||window,e={type,target,pointerId:1,pointerType:'touch',isPrimary:true,button:0,clientX:100,clientY:14,timeStamp:now,detail:1,defaultPrevented:false,
      preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},stopImmediatePropagation(){this.immediateStopped=true;this.stopped=true;},...args};
    if(target!==window)listen(document,e,true);listen(target,e,true);if(!e.immediateStopped)listen(target,e,false);
    if(type==='click'&&!e.immediateStopped)target.onclick?.(e);if(!e.stopped&&target!==window)listen(document,e,false);return e;
  };
  return {calls,buttons,document,context,fire,advance(ms){now+=ms;},tap(id,args={}){fire(id,'pointerdown',args);now+=30;return fire(id,'pointerup',args);}};
}

test('preview Help uses the production touch and pen release action when no compatibility click arrives',()=>{
  for(const pointerType of ['touch','pen']){const h=harness();const up=h.tap('preview-help',{pointerType});assert.equal(up.defaultPrevented,true);assert.deepEqual(h.calls,[['help']]);}
});

test('preview toolbar actions fire once and trailing compatibility clicks cannot duplicate them',()=>{
  for(const id of ['preview-help','preview-reset','preview-size']){
    const h=harness();h.tap(id);const expected=id==='preview-help'?[['help']]:[['reset',id==='preview-size'?5000:60]];assert.deepEqual(h.calls,expected);
    const click=h.fire(id,'click');assert.equal(click.defaultPrevented,true);assert.deepEqual(h.calls,expected);
    h.tap(id,{pointerId:2});assert.equal(h.calls.length,2,'a fresh deliberate contact remains usable after reset/lifecycle work');
  }
});

test('preview toolbar movement, cancellation, capture loss and lifecycle changes cannot activate',()=>{
  for(const mode of ['move','cancel','lostcapture','blur','resize','hidden']){
    const h=harness();h.fire('preview-help','pointerdown');
    if(mode==='move')h.fire('preview-help','pointermove',{clientX:140});
    else if(mode==='cancel')h.fire('preview-help','pointercancel');
    else if(mode==='lostcapture')h.fire('preview-help','lostpointercapture');
    else if(mode==='hidden'){h.document.hidden=true;for(const {fn} of h.document.handlers.get('visibilitychange'))fn({});}
    else h.fire('window',mode);
    h.fire('preview-help','pointerup');assert.deepEqual(h.calls,[],mode);assert.equal(h.fire('preview-help','click').defaultPrevented,true,mode);
    h.document.hidden=false;h.tap('preview-help',{pointerId:3});assert.deepEqual(h.calls,[['help']],mode+' permits a fresh contact');
  }
});

test('preview toolbar rejects multi-contact and long-held touches without losing the next tap',()=>{
  for(const mode of ['multi','long']){
    const h=harness();h.fire('preview-help','pointerdown');
    if(mode==='multi'){h.fire('preview-help','pointerdown',{pointerId:2,isPrimary:false});h.fire('preview-help','pointerup',{pointerId:2,isPrimary:false});}else h.advance(650);
    h.fire('preview-help','pointerup');assert.deepEqual(h.calls,[],mode);if(mode==='long')assert.equal(h.fire('preview-help','click').defaultPrevented,true,mode);
    h.tap('preview-help',{pointerId:3});assert.deepEqual(h.calls,[['help']]);
  }
});

test('preview toolbar mouse and keyboard clicks retain their normal activation path',()=>{
  const h=harness();h.tap('preview-help',{pointerType:'mouse'});assert.deepEqual(h.calls,[]);h.fire('preview-help','click',{pointerType:'mouse'});assert.deepEqual(h.calls,[['help']]);
  h.tap('preview-help');h.fire('preview-help','click',{detail:0,pointerId:-1});assert.deepEqual(h.calls,[['help'],['help'],['help']]);
});
