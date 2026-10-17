import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {previewHooks} from '../scripts/build-poweramp-preview.mjs';

const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const part=(start,end)=>{
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,'production fragment must exist');return source.slice(a,b);
};

// These tests execute the installed production Search wrappers, not only the
// original Search object. Minimal DOM state supplies deterministic teardown
// semantics; this is not a browser or device-rendering qualification.
function harness(){
  const nodes=new Map(),forgotten=[],cleaned=[];let tracks=[{id:'old',title:'Old result',source:'local',dur:90}];
  const node=id=>{
    if(!nodes.has(id)){
      let markup='';const n={id,children:[],arts:[],scrollTop:0,scrollLeft:0,value:'',hidden:false,inert:false,isConnected:true,
        style:{setProperty(){}},dataset:{},classList:{add(){},remove(){},toggle(){},contains:()=>false},
        addEventListener(){},removeEventListener(){},focus(){},setAttribute(){},
        contains(child){return this.children.includes(child);},querySelector:()=>null,
        querySelectorAll(selector){return selector==='[data-art]'?this.arts:[];},
        appendChild(child){this.children.push(child);return child;},append(child){this.children.push(child);},
        get innerHTML(){return markup;},set innerHTML(value){markup=String(value);for(const child of this.children)child.isConnected=false;this.children=[];this.arts=[];}};
      nodes.set(id,n);
    }return nodes.get(id);
  };
  const $=selector=>selector.startsWith('#')?node(selector.slice(1)):null;
  const document={getElementById:node};
  const body=node('q-body'),box={isConnected:true,__items:tracks},art={id:'pending-art'};
  body.children=[box];body.arts=[art];body.innerHTML='<div>Old result</div>';body.children=[box];body.arts=[art];
  const SET={searchCategories:{albums:false},listZoom:{},listOptions:{}};
  const Selection={mode:true,box,exit(){this.mode=false;this.box=null;}};
  const Views={stack:[],job:0,renderLibrary(){},listOptions:()=>({}),refreshAll(){if(context.Nav.cur==='search')context.search.run();}};
  const Engine={current:tracks[0],stop(){},queue:tracks,buildOrder(){},el:()=>({src:''})};
  const context=vm.createContext({document,$,$$:()=>[],SET,Views,Engine,Selection,Nav:{cur:'search',go(name){this.cur=name;}},
    NativeSettings:{values:{},apply(){}},Settings:{stack:['root'],render(){}},
    TrackWindow:{clean(n){cleaned.push(n);}},artObserver:{unobserve:n=>forgotten.push(n)},
    localStorage:{getItem:()=>null,setItem(){},clear(){}},allTracks:()=>tracks,nativeValues:()=>({}),
    UI:{vizFull:false,async renderNowPlaying(){},renderPlayState(){},renderToggles(){},renderProgress(){}},EQ:{render(){}},
    LIB:{ids:['old'],map:new Map()},FILES:new Map(),SourceLibrary:{load(){}},
    PlaybackTransitions:{cancel(){}},PlaybackQueue:{},Sheets:{close(){}},InputLifecycle:{cancel(){}},
    LibraryPageMotion:{abort(){}},LibraryPageHistory:{entries:[],index:-1,seed(){}},
    async loadLibrary(){},Playlists:{async load(){}},Bookmarks:{async load(){}},async getFileFor(){return {};},audioSource:()=>'',applySettings(){},
    clearTimeout(){},toast(){},Waveform:{},Uint8Array,console,
    el:(tag,classes,html)=>({tagName:tag,classes,innerHTML:html}),esc:s=>String(s),icoHTML:()=>'',sourceTrackEnabled:()=>true,
  });
  vm.runInContext(part('const Search={','/* =====================================================================\n   SETTINGS SCREENS')+'\nglobalThis.search=Search;',context);
  vm.runInContext(part('Search.history=[];','Settings.returnTo=')+part('function installSearchPlayback(){','function installSettingsShortcuts(){')+'\ninstallSearchPlayback();',context);
  context.search.sections=[{data:{type:'tracks',items:tracks},box}];context.search.history=['remembered query'];context.search.filter='Artists';
  node('q').value='remembered query';node('q-chips').innerHTML='stale chip markup without Albums';
  vm.runInContext(previewHooks.slice(0,previewHooks.indexOf('Preview.prepare();'))+'\nglobalThis.fixture=Preview;',context);
  const p=context.fixture;p.ready=true;p.defaults={listZoom:{},listOptions:{}};p.nativeDefaults={};
  p.seed=count=>{p.count=count;tracks=[{id:'fresh',title:'Fresh fixture',dur:90}];return tracks;};
  return {context,search:context.search,p,$,body,box,art,Selection,forgotten,cleaned};
}

test('clearing query through the real history wrapper exits selection before detaching its result box',()=>{
  const h=harness();h.$('#q').value='';h.search.run();
  assert.equal(h.box.isConnected,false,'history rendering detached the selected result box');
  assert.equal(h.Selection.mode,false,'a detached song selection must not remain active');
  assert.equal(h.Selection.box,null);assert.equal(h.search.sections.length,0);
});

test('clearing grouped results through the real history wrapper unobserves pending artwork',()=>{
  const h=harness();h.Selection.mode=false;h.$('#q').value='';h.search.run();
  assert.ok(h.forgotten.includes(h.art),'the empty-query wrapper must release observations before removing grouped rows');
});

test('complete fixture reset restores search query, history, selected chip and category-chip DOM',async()=>{
  for(const count of [60,5000]){
    const h=harness();await h.p.reset(count);
    assert.equal(h.p.ready,true);assert.equal(h.context.Nav.cur,'player');
    assert.equal(h.$('#q').value,'','reset must clear the previously typed query');
    assert.equal(h.search.filter,'All');assert.equal(h.search.history.length,0);assert.equal(h.search.sections.length,0);
    assert.match(h.$('#q-chips').innerHTML,/data-c="Albums"/,'restored enabled category must also return to chip DOM');
    assert.equal(h.$('#q-body').scrollTop,0);
    assert.ok(h.forgotten.includes(h.art),'reset must unobserve pending grouped artwork before clearing result DOM');
  }
});
