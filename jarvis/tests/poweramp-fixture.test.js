import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {fixtureSceneSettled,installFixtureInputTrace} from './helpers/poweramp-fixture.js';

test('browser fixture readiness requires the physical endpoint, not just navigation ownership',()=>{
  const current={hidden:false,inert:false,dataset:{}},motion={state:null,finish:null};let plane=null;
  const context=vm.createContext({PA:{Nav:{cur:'list'},LibraryPageMotion:motion},document:{querySelector:selector=>selector==='#sc-list'?current:plane}});
  const ready=()=>vm.runInContext('('+fixtureSceneSettled.toString()+')("list")',context);
  assert.equal(ready(),true);
  current.dataset.scene='1';assert.equal(ready(),false,'active generic vertical arrival must retire first');delete current.dataset.scene;
  plane={};assert.equal(ready(),false,'shared player contact plane must retire first');plane=null;
  motion.state={};assert.equal(ready(),false);motion.state=null;motion.finish={pending:true};assert.equal(ready(),false);motion.finish=null;
  current.inert=true;assert.equal(ready(),false);current.inert=false;current.hidden=true;assert.equal(ready(),false);current.hidden=false;
  context.PA.Nav.cur='library';assert.equal(ready(),false);context.PA.Nav.cur='list';assert.equal(ready(),true);
});

function inputEvidenceHarness(){
  const listeners=new Map(),pending=[],title={tagName:'DIV',id:'mini-title',classList:['t1'],dataset:{},textContent:'should never be collected'};
  const mini={tagName:'DIV',id:'mini',classList:[],dataset:{}},lifecycle={gesture:{node:mini},contacts:new Set([1])};
  let now=100;
  const context=vm.createContext({window:{PA:{Nav:{cur:'list'},LibraryPageMotion:{state:null},UI:{seekDragging:false}}},InputLifecycle:lifecycle,ScreenDrag:{phase:'drag'},queueMicrotask:fn=>pending.push(fn),performance:{now:()=>++now},
    document:{querySelector:()=>null,addEventListener(type,fn,options){assert.equal(options.passive,true);const phases=listeners.get(type)||{capture:[],bubble:[]};phases[options.capture?'capture':'bubble'].push(fn);listeners.set(type,phases);}}});
  vm.runInContext('('+installFixtureInputTrace.toString()+')()',context);context.fixtureInputTrace=context.window.fixtureInputTrace;
  const event=(type,target=title)=>({type,target,isTrusted:true,pointerId:1,clientX:100,clientY:720,defaultPrevented:false});
  const capture=e=>{for(const fn of listeners.get(e.type).capture)fn(e);};
  const bubble=e=>{for(const fn of listeners.get(e.type).bubble)fn(e);};
  const fire=(type,target=title)=>{const e=event(type,target);capture(e);bubble(e);return e;};
  return {context,lifecycle,pending,title,mini,event,capture,bubble,fire};
}

test('browser input evidence stays bounded, preserves trusted capture targets, and is read-only',()=>{
  const h=inputEvidenceHarness();for(let i=0;i<100;i++)h.fire('lostpointercapture');
  const trace=h.context.window.fixtureInputTrace;assert.equal(trace.length,80);
  assert.equal(trace.at(-1).target,'div#mini-title.t1');assert.equal(trace.at(-1).trusted,true);
  assert.equal(trace.at(-1).before.gesture,'div#mini');assert.equal(trace.at(-1).after.gesture,'div#mini');assert.equal(trace.at(-1).observation,'bubble');
  h.fire('gotpointercapture',h.mini);h.fire('lostpointercapture',h.title);
  assert.equal(trace.at(-1).after.captureOwner,'div#mini','old child loss cannot erase the observed parent capture');
  h.fire('lostpointercapture',h.mini);assert.equal(trace.at(-1).after.captureOwner,null);
  assert.equal(h.lifecycle.gesture.node,h.mini);assert.equal(h.lifecycle.contacts.size,1);
  assert.doesNotMatch(JSON.stringify(trace),/should never be collected/);
});

test('trusted-event evidence observes owner changes at bubble rather than a capture microtask checkpoint',()=>{
  const h=inputEvidenceHarness(),e=h.event('pointermove');h.capture(e);
  // Real native events may drain microtasks after the document capture
  // callback, before the lower target owner handles that same contact.
  h.pending.splice(0).forEach(fn=>fn());const record=h.context.window.fixtureInputTrace.at(-1);
  assert.equal(record.observation,'capture');assert.equal(record.after,undefined);assert.equal(record.before.history,false);
  h.context.window.PA.LibraryPageMotion.state={};e.defaultPrevented=true;h.bubble(e);
  assert.equal(record.observation,'bubble');assert.equal(record.after.history,true);assert.equal(record.prevented,true);assert.ok(record.after_ms>record.at_ms);
});

test('stopped native events stay capture-only and compatibility clicks are recorded separately',()=>{
  const h=inputEvidenceHarness(),e=h.event('pointerdown');h.capture(e);h.pending.splice(0).forEach(fn=>fn());
  assert.equal(h.context.window.fixtureInputTrace.at(-1).observation,'capture');assert.equal(h.context.window.fixtureInputTrace.at(-1).after,undefined);
  h.fire('click');const click=h.context.window.fixtureInputTrace.at(-1);
  assert.equal(click.type,'click');assert.equal(click.trusted,true);assert.equal(click.observation,'bubble');
});
