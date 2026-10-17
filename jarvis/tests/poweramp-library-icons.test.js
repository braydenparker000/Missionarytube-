import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildPreview} from '../scripts/build-poweramp-preview.mjs';

const source=readFileSync(process.env.POWERAMP_PLAYER_FILE||new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const html=readFileSync(process.env.POWERAMP_HTML_FILE||new URL('../public/drawercast/index.html',import.meta.url),'utf8');
function section(input,start,end){
  const a=input.indexOf(start),b=input.indexOf(end,a);
  assert.ok(a>=0&&b>a,`Missing source section: ${start}`);
  return input.slice(a,b);
}

// This harness preserves actual production icon strings, action markup and
// clone classes. It checks the DOM/CSS contract, not browser mask rendering.
function element(tag='div',classes='',markup=''){
  const names=new Set(classes.split(/\s+/).filter(Boolean)),attributes=new Map();
  const node={tagName:tag.toUpperCase(),children:[],dataset:{},innerHTML:markup,scrollTop:0,hidden:false,inert:false,
    classList:{add(...values){values.forEach(v=>names.add(v));},remove(...values){values.forEach(v=>names.delete(v));},contains:v=>names.has(v),toggle(v,on){on?names.add(v):names.delete(v);}},
    setAttribute(k,v){attributes.set(k,String(v));},getAttribute:k=>attributes.get(k)??null,
    append(...children){node.children.push(...children);},appendChild(child){node.append(child);return child;},prepend(child){node.children.unshift(child);},
    querySelectorAll(selector){return node.children.flatMap(child=>[...(selector==='.fab'&&child.classList.contains('fab')?[child]:[]),...child.querySelectorAll(selector)]);},
    querySelector(selector){return node.querySelectorAll(selector)[0]||null;},
    getBoundingClientRect:()=>({top:0,bottom:100,height:100}),addEventListener(){},
    cloneNode(){const copy=element(tag,[...names].join(' '),node.innerHTML);for(const [key,value] of attributes)copy.setAttribute(key,value);return copy;}
  };
  return node;
}
function harness(input=source){
  const nodes=new Map(),calls=[],view={stack:[],title:spec=>spec.title||spec.kind,back:()=>calls.push('back')};
  const $=selector=>{if(!nodes.has(selector))nodes.set(selector,element());return nodes.get(selector);};
  const context=vm.createContext({$: $,el:element,document:{body:{classList:{contains:()=>false}}},Views:view,
    CATS:[{k:'all',ic:'cat-all',c:'#7589ce'}],SET:{},Engine:{queue:[],order:[],setQueue:(...args)=>calls.push(['play',...args]),playIndex:(...args)=>calls.push(['index',...args])},
    UI:{renderToggles:()=>calls.push('toggles')},Selection:{toggleMode:()=>calls.push('select')},Nav:{go:screen=>calls.push(['nav',screen])},
    ctxMenuList:(...args)=>calls.push(['more',...args]),esc:String,saveSet:()=>calls.push('save'),toast:()=>{},setTimeout:()=>0,
    requestAnimationFrame:fn=>fn(),DockLayout:{schedule:()=>calls.push('dock')},bindTapButton:(button,action)=>{button.onclick=action;}
  });
  // Use both real icon tables and the late override that is active before boot.
  vm.runInContext(section(input,'const S =','/* =====================================================================\n   SMALL UTILS')+
    section(input,'const ReferenceIcons=','\nfor(const c of CATS)')+
    section(input,'const oldReferenceIcon=','\nconst EXTRA_DEFAULTS=')+
    '\nglobalThis.icon=icoHTML;',context);
  const build=section(input,'  buildFabs:function(data, spec){','  markPlaying:function(').replace(/^  buildFabs:/,'').replace(/,\s*$/,'');
  vm.runInContext('Views.buildFabs='+build+';\n'+section(input,'const LibraryPresentation={','\nViews.render=function(spec,keep)')+'\nglobalThis.presentation=LibraryPresentation;',context);
  return {context,$,calls};
}

// The whole scoped icon-hiding rule must select only explicitly labeled
// buttons. Checking its complete selector list guards both header and dock.
function assertVisibilityContract(input,buttons){
  const rules=[...input.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([,selector,declarations])=>selector.includes('.fab')&&/(?:^|;)\s*display\s*:\s*none\s*(?:;|$)/.test(declarations));
  assert.equal(rules.length,1,'There must be one explicit labeled-action icon visibility rule');
  const selectors=rules[0][1].replace(/\/\*[\s\S]*?\*\//g,'').trim().split(',').map(s=>s.trim());
  assert.deepEqual(selectors,[
    '.library-header-actions .fab.fab-labeled svg',
    '.library-header-actions .fab.fab-labeled .native-icon',
    '#list-fabs .fab.fab-labeled svg',
    '#list-fabs .fab.fab-labeled .native-icon'
  ]);
  for(const button of buttons){
    const label=button.getAttribute('aria-label');
    assert.equal(button.classList.contains('fab-labeled'),label==='Select',label);
    assert.match(button.innerHTML,/^<(?:svg|span)\b/,`${label} has actual icon content`);
    if(['Play songs','Search library','List actions'].includes(label)){
      assert.match(button.innerHTML,/^<span class="native-icon raster-icon"/);
      const image=button.innerHTML.match(/data:image\/png;base64,([^)]*)/);
      assert.ok(image,`${label} has an inline mask image`);
      const png=Buffer.from(image[1],'base64');
      assert.equal(png.toString('ascii',1,4),'PNG');assert.ok(png.readUInt32BE(16)>0&&png.readUInt32BE(20)>0);
      assert.doesNotMatch(button.innerHTML,/<span(?![^>]*class="native-icon)/,`${label} has no text label`);
    }
    if(label==='Select')assert.match(button.innerHTML,/<\/svg><span>Select<\/span>$/);
  }
}
function renderTracks(h){
  const data={type:'tracks',items:[{id:'one',title:'One'}]},spec={kind:'all'};
  h.context.Views.buildFabs(data,spec);h.context.presentation.render(spec,data);
  return {data,spec,dock:h.$('#list-fabs'),header:h.$('#list-body').__referenceActions};
}

test('real production library icons remain visible after icon selection and header cloning',()=>{
  const h=harness(),{data,spec,dock,header}=renderTracks(h);
  assert.deepEqual(dock.children.map(b=>b.getAttribute('aria-label')),['Shuffle songs','Play songs','Search library','Select','List actions']);
  assertVisibilityContract(html,[...dock.children,...header.children]);
  assert.equal(dock.hidden,true);assert.equal(dock.inert,true);
  for(let i=0;i<dock.children.length;i++){
    assert.equal(header.children[i].innerHTML,dock.children[i].innerHTML);
    assert.equal(header.children[i].onclick,dock.children[i].onclick);
  }
  header.children[1].onclick();assert.equal(h.calls.find(c=>c[0]==='play')[1],data.items);
  header.children[2].onclick();assert.deepEqual(h.calls.at(-1),['nav','search']);
  header.children[3].onclick();assert.equal(h.calls.at(-1),'select');
  header.children[4].onclick();assert.deepEqual(h.calls.at(-1),['more',data,spec]);
  header.getBoundingClientRect=()=>({top:-100,bottom:-1,height:99});h.context.presentation.updateDock();
  assert.equal(dock.hidden,false);assert.equal(dock.inert,false);assertVisibilityContract(html,dock.children);
});

test('group and playlist fallback actions keep real raster icons in header and dock copies',()=>{
  for(const type of ['groups','playlists']){
    const h=harness(),data={type,items:[]},spec={kind:type==='groups'?'albums':'playlists'};
    h.context.Views.buildFabs(data,spec);h.context.presentation.render(spec,data);
    const dock=h.$('#list-fabs'),header=h.$('#list-body').__referenceActions;
    assert.equal(dock.children.length,2);assert.equal(header.children.length,2);
    assertVisibilityContract(html,[...dock.children,...header.children]);
    dock.children[0].onclick();assert.deepEqual(h.calls.at(-1),['nav','search']);
    dock.children[1].onclick();assert.deepEqual(h.calls.at(-1),['more',data,spec]);
  }
});

test('downloadable preview uses the same real icon/action/CSS contract as production',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'poweramp-library-icons-'));
  try{
    const result=await buildPreview(join(directory,'preview.html')),preview=await readFile(result.output,'utf8');
    const runtime=preview.match(/<script>([\s\S]*)<\/script>/)[1],h=harness(runtime),production=harness(),{dock,header}=renderTracks(h);
    assertVisibilityContract(preview,[...dock.children,...header.children]);
    for(const name of ['shuffle','play','search','select','more'])assert.equal(h.context.icon(name),production.context.icon(name));
    assert.ok(runtime.indexOf('icoHTML=function(name)')<runtime.indexOf('async function boot()'));
    assert.ok(runtime.includes('function previewBoot(){Promise.resolve().then(boot).then(()=>Preview.finish())'),'Preview boot still delegates to the production boot');
    assert.match(html,/<script type="module" src="\.\/player\.js/);
  }finally{await rm(directory,{recursive:true,force:true});}
});
