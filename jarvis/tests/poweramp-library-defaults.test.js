import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/drawercast/index.html',import.meta.url),'utf8');
const part=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const schema=JSON.parse(source.match(/const NativeSchema=(\{.*\});/)[1]);

// Run the real native settings installation and application, including its
// default values and header visibility classes. Geometry is supplied explicitly;
// this is a boot/settings contract, not browser rendering qualification.
function harness(saved){
  const classes=new Set(),nodes=new Map();let layouts=0;
  const body={classList:{contains:n=>classes.has(n),toggle(n,on){if(on)classes.add(n);else classes.delete(n);},remove:n=>classes.delete(n)},dataset:{}};
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:false,inert:false,style:{setProperty(){},visibility:''},classList:{toggle(){},remove(){},replace(){}},dataset:{},setAttribute(k,v){this[k]=String(v);},getBoundingClientRect(){return {top:28,bottom:628,height:600,width:393};}});
    return nodes.get(id);
  };
  const list=node('#list-body'),actions=node('actions'),fabs=node('#list-fabs');list.scrollTop=0;list.__referenceActions=actions;
  actions.getBoundingClientRect=()=>body.classList.contains('no-header-buttons')?{top:0,bottom:0,height:0}:{top:128-list.scrollTop,bottom:170-list.scrollTop,height:42};
  const SET={nativeSettings:saved,referenceRevision:2,interactionRevision:3,visualRevision:5,accent:'amber',listZoom:{},cardRadius:20,bgBlur:10};
  const context=vm.createContext({SET,NativeSchema:schema,document:{body},root:{style:{setProperty(){}}},$:node,$$:()=>[],
    Settings:{stack:['root'],item(){},search(){},close(){}},PAGES:{},Engine:{queue:[],pos:0,current:null},Nav:{cur:'list'},
    UI:{},EQ:{},ListZoom:{apply(){},get(){}},ZoomProfile:{files:1},DockLayout:{schedule(){layouts++;}},
    matchMedia:()=>({matches:false}),applySettings(){},applyPlayerButtons(){},saveSet(){},settingsRenderOriginal(){},el(){},navigator:{},nativeValues:()=>({})});
  vm.runInContext(part('const NativeSettings={','\n\n// Derive control dimensions')+'\n'+part('Object.assign(NativeSettings.binds,{','\n// Available band counts')+'\n'+part('const LibraryPresentation={','\nViews.render=function(spec,keep)')+'\n'+part('const nativeApplyBeforeRework=NativeSettings.apply;','\n\nconst PLAYER_BUTTONS=')+'\nglobalThis.native=NativeSettings;globalThis.presentation=LibraryPresentation;',context);
  context.native.install();
  return {context,SET,body,list,actions,fabs,layouts:()=>layouts,header:schema.listui.items.find(i=>i.key==='list_header_buttons')};
}

test('fresh production settings enable reference header actions instead of hiding them at boot',()=>{
  const h=harness();assert.equal(h.header.default,1);assert.equal(h.context.native.values.list_header_buttons,1);
  assert.equal(h.body.classList.contains('no-header-buttons'),false);assert.equal(h.fabs.hidden,true);assert.equal(h.fabs.inert,true);
  assert.match(html,/body\.no-header-buttons \.library-header-actions\{display:none\}/);
});

test('header actions and dock switch in both scroll directions with the actual installed defaults',()=>{
  const h=harness();h.list.scrollTop=220;h.context.presentation.updateDock();
  assert.equal(h.fabs.hidden,false);assert.equal(h.fabs.inert,false);
  h.list.scrollTop=0;h.context.presentation.updateDock();assert.equal(h.fabs.hidden,true);assert.equal(h.fabs.inert,true);
  assert.ok(h.layouts()>=3);
});

test('an explicit saved disabled header choice is honored and changing it refreshes the dock immediately',()=>{
  const h=harness({list_header_buttons:0});assert.equal(h.context.native.values.list_header_buttons,0);
  assert.equal(h.body.classList.contains('no-header-buttons'),true);assert.equal(h.fabs.hidden,false);
  h.context.native.write(h.header,1);assert.equal(h.body.classList.contains('no-header-buttons'),false);assert.equal(h.fabs.hidden,true);
  h.context.native.write(h.header,0);assert.equal(h.body.classList.contains('no-header-buttons'),true);assert.equal(h.fabs.hidden,false);
});
