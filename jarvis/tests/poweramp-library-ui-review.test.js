import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(process.env.POWERAMP_PLAYER_FILE||new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const html=readFileSync(process.env.POWERAMP_HTML_FILE||(process.env.POWERAMP_PLAYER_FILE?process.env.POWERAMP_PLAYER_FILE.replace(/player\.js$/, 'index.html'):new URL('../public/drawercast/index.html',import.meta.url)),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const collator=new Intl.Collator('en',{numeric:true,sensitivity:'base'});
// A deterministic DOM contract harness. This does not emulate browser layout,
// compositor timing, native scrolling, or Android touch input.
function element(tag='div',classes='',markup=''){
  const attributes=new Map(),names=new Set(classes.split(/\s+/).filter(Boolean)),events=new Map();
  const n={tagName:tag.toUpperCase(),dataset:{},style:{setProperty(){}},children:[],parentNode:null,scrollTop:0,hidden:false,inert:false,isConnected:true,rect:{top:0,bottom:100,height:100,width:393},
    classList:{add(...v){v.forEach(x=>names.add(x));},remove(...v){v.forEach(x=>names.delete(x));},toggle(v,on){if(on??!names.has(v))names.add(v);else names.delete(v);},contains:v=>names.has(v)},
    setAttribute(k,v){attributes.set(k,String(v));if(k==='class'){names.clear();String(v).split(/\s+/).filter(Boolean).forEach(x=>names.add(x));}if(k.startsWith('data-'))n.dataset[k.slice(5).replace(/-([a-z])/g,(_,x)=>x.toUpperCase())]=String(v);},
    getAttribute:k=>k==='class'?[...names].join(' '):attributes.get(k)??null,
    append(...nodes){for(const child of nodes){child.remove();child.parentNode=n;n.children.push(child);}},appendChild(child){n.append(child);return child;},
    prepend(...nodes){for(const child of nodes.reverse()){child.remove();child.parentNode=n;n.children.unshift(child);}},
    remove(){if(n.parentNode){const a=n.parentNode.children;a.splice(a.indexOf(n),1);n.parentNode=null;}},contains(child){return child===n||n.children.some(c=>c.contains(child));},
    get firstChild(){return n.children[0];},get firstElementChild(){return n.children[0];},
    getBoundingClientRect:()=>n.rect,focus(){},
    matches(selector){if(selector.includes(','))return selector.split(',').some(s=>n.matches(s));if(selector.startsWith('.'))return names.has(selector.slice(1));if(selector.startsWith('[')&&selector.includes('^=')){const m=selector.match(/^\[([^\^]+)\^=["']?([^"'\]]+)["']?\]$/);return !!m&&String(attributes.get(m[1])||'').startsWith(m[2]);}if(selector.startsWith('[')){const m=selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);return !!m&&attributes.has(m[1])&&(m[2]==null||attributes.get(m[1])===m[2]);}return n.tagName===selector.toUpperCase();},
    querySelectorAll(selector){selector=selector.trim();const found=[];const visit=p=>{for(const c of p.children){if(c.matches(selector))found.push(c);visit(c);}};visit(n);return found;},querySelector(selector){return n.querySelectorAll(selector)[0]||null;},
    closest(selector){let p=n;while(p){if(p.matches(selector))return p;p=p.parentNode;}return null;},
    addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn);},removeEventListener(){},
    fire(type,extra={}){const event={type,target:n,detail:0,preventDefault(){},...extra};for(const fn of events.get(type)||[])fn(event);},
    cloneNode(){return element(tag,[...names].join(' '),n.innerHTML);},_text:'',_html:'',
    get textContent(){return n._text+n.children.map(c=>c.textContent).join('');},set textContent(value){n._text=String(value);n.children=[];},
    get innerHTML(){return n._html;},set innerHTML(value){n._html=String(value);n._text='';n.children=[];const stack=[n];for(const token of String(value).match(/<[^>]+>|[^<]+/g)||[]){if(token.startsWith('</')){if(stack.length>1)stack.pop();continue;}if(token.startsWith('<')){const match=token.match(/^<([\w-]+)/);if(!match)continue;const child=element(match[1]);for(const a of token.matchAll(/([\w-]+)(?:="([^"]*)"|='([^']*)')?/g)){if(a.index<=1)continue;child.setAttribute(a[1],a[2]??a[3]??'');}child.checked=attributes.has('checked');child.checked=child.getAttribute('checked')!==null;child.disabled=child.getAttribute('disabled')!==null;stack.at(-1).append(child);if(!['input','br','img','hr'].includes(match[1])&&!token.endsWith('/>'))stack.push(child);}else stack.at(-1)._text+=token.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>');}}
  };n.innerHTML=markup;return n;
}
function harness(){
  const nodes=new Map(),calls=[],body=element('div','scroll'),box=element('div','zoom-list');body.append(box);box.dataset.zoom='1';box.dataset.zoomKey='files';box.__spec={kind:'all'};
  nodes.set('#sheet',element());nodes.set('#list-body',body);nodes.set('#list-body .zoom-list',box);nodes.set('#list-fabs',element());nodes.set('#sc-list',element('section','screen'));
  const $=s=>{if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);};
  const context=vm.createContext({document:{body:{classList:{contains:()=>false}}},$,el:element,SET:{sortTracks:'title',listOptions:{},listZoom:{}},Views:{currentSpec:box.__spec,title:s=>({all:'All Songs',album:'Album',albums:'Albums',queue:'Queue',recent:'Recently Added'}[s.kind]||'List'),stack:[],back:()=>calls.push('back')},
    ListZoom:{keys:{all:'files',albums:'albums',album:'album_files',queue:'queue',recent:'recently_added_files',playlist:'playlists_files'},key(s){return this.keys[s.kind]||s.kind;},set(b,id){b.dataset.zoom=String(id);calls.push(['zoom',id,b]);}},
    Engine:{queue:[],order:[],current:null,playIndex:(...v)=>calls.push(['playIndex',...v]),setQueue:(...v)=>calls.push(['setQueue',...v])},
    sortNat:(a,b)=>collator.compare(String(a),String(b)),baseName:v=>String(v).split('/').pop(),trackArtist:t=>t.artist||'Unknown artist',trackAlbum:t=>t.album||'Unknown album',
    esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),icoHTML:name=>'<i data-icon="'+name+'"></i>',fmtTime:v=>`${Math.floor((v||0)/60)}:${String(Math.floor((v||0)%60)).padStart(2,'0')}`,
    saveSet:()=>calls.push('save'),closeSheet:()=>calls.push('close'),openSheet:()=>calls.push('open'),Settings:{open:p=>calls.push(['settings',p])},
    requestAnimationFrame:fn=>{fn();return 1;},observeArt:n=>calls.push(['observeArt',n[0].dataset.art]),DockLayout:{schedule:()=>calls.push('dock')},CATS:[{k:'all',n:'All Songs',ic:'note',c:'#6d7de8'},{k:'album',n:'Album',ic:'album',c:'#5b4fe0'}],
    UI:{setArtEl:(...v)=>calls.push(['heroArt',...v])},getArtURL:()=>Promise.resolve(null),nativeValues:()=>({}),Selection:{mode:false},Nav:{go:n=>calls.push(['nav',n])},bindTapButton:(button,action)=>{button.onclick=action;}});
  vm.runInContext(section('const ListOptions={','const ListZoom={')+'\nglobalThis.options=ListOptions;',context);
  context.Views.render=(spec)=>{context.Views.currentSpec=spec;context.Views.currentData=context.options.prepare(context.Views.currentData,spec);box.__items=context.Views.currentData.items;};
  return {context,options:context.options,$,nodes,body,box,calls};
}
const tracks=()=>[
  {id:'a',title:'Z 10',artist:'C',album:'B',path:'/z/a.opus',track:3,disc:1,year:2024,added:100,mtime:500,rating:1,dur:100,lastPlayed:200,plays:4},
  {id:'b',title:'A 2',artist:'A',album:'C',path:'/a/c.opus',track:1,disc:2,year:2021,added:300,mtime:100,rating:3,dur:300,lastPlayed:500,plays:2},
  {id:'c',title:'A 10',artist:'B',album:'A',path:'/b/b.opus',track:2,disc:1,year:2022,added:200,mtime:300,rating:2,dur:200,lastPlayed:300,plays:3}
];
const ids=items=>Array.from(items,t=>t.id);

function menu(h){
  Object.assign(h.context,{$$:(s,n)=>Array.from((n||h.$('#sheet')).querySelectorAll(s)),Sheets:{show(){}},PlaybackQueue:{add:v=>h.calls.push(['enqueue',v])},Playlists:{addDialog:v=>h.calls.push(['playlist',v])},UI:{renderToggles(){}},setVal(){}});
  h.context.ListZoom.options=b=>h.options.show(b);
  vm.runInContext(section('function ctxMenuList(data, spec){','/* =====================================================================\n   SELECTION MODE')+section('const oldCtxMenuList=ctxMenuList;','\n\nconst NativeSettings='),h.context);
}
function presentation(h){h.context.renderListBeforeRework=()=>{};vm.runInContext(section('const LibraryPresentation={','\n\nconst PlaylistFiles=')+'\nglobalThis.presentation=LibraryPresentation;',h.context);return h.context.presentation;}

test('playlist category title sorting and reverse are real choices',()=>{
  const h=harness(),spec={kind:'playlists'},data={type:'playlists',items:[{id:'z',name:'Zulu',ids:[]},{id:'a',name:'Alpha',ids:[]}]};
  h.options.save(spec,{sort:'title'});const reason=h.options.availability('title',data,spec);
  assert.equal(reason,'');assert.deepEqual(ids(h.options.prepare(data,spec).items),['a','z']);
  h.options.save(spec,{reverse:true});assert.deepEqual(ids(h.options.prepare(data,spec).items),['z','a']);
});
test('hierarchy title choice sorts actual rows or is honestly unavailable',()=>{
  const h=harness(),spec={kind:'tree'},data={type:'tree',dirs:['Alpha','Zulu'],items:[{id:'z',title:'Zulu'},{id:'a',title:'Alpha'}]};
  h.options.save(spec,{sort:'title'});
  if(h.options.availability('title',data,spec))return;
  const sorted=h.options.prepare(data,spec);assert.deepEqual(Array.from(sorted.dirs),['Alpha','Zulu']);assert.deepEqual(ids(sorted.items),['a','z']);h.options.save(spec,{reverse:true});const reversed=h.options.prepare(data,spec);assert.deepEqual(Array.from(reversed.dirs),['Zulu','Alpha']);assert.deepEqual(ids(reversed.items),['z','a']);
});
test('unknown zero years and track numbers sort after present metadata',()=>{
  const h=harness();for(const field of ['year','track']){
    const items=[{id:'unknown',title:'Alpha',[field]:0},{id:'known',title:'Zulu',[field]:field==='year'?2024:1}];
    h.options.save({kind:'all'},{sort:field});assert.deepEqual(ids(h.options.prepare({type:'tracks',items},{kind:'all'}).items),['known','unknown'],field);
  }
});
test('zero duration does not enable an unavailable duration comparator',()=>{
  const h=harness();assert.notEqual(h.options.availability('duration',{type:'tracks',items:[{id:'u',title:'Unknown',dur:0}]},{kind:'all'}),'');
});
test('group overflow never sends non-track group records to playback',()=>{
  const h=harness();menu(h);const data={type:'groups',open:'album',items:[{key:'Album',tracks:[tracks()[0]]}]};h.context.ctxMenuList(data,{kind:'albums'});
  const play=h.$('#sheet').querySelector('[data-a="play"]');if(!play||play.disabled)return;play.onclick();
  const playback=h.calls.find(c=>Array.isArray(c)&&c[0]==='setQueue');if(playback)assert.ok(playback[1].every(t=>t.id&&t.title),'group wrappers cannot be tracks');
});
test('playlist overflow never sends playlist records to playback or enqueue',()=>{
  for(const action of ['play','enqueue']){const h=harness();menu(h);const data={type:'playlists',items:[{id:'playlist1',name:'Playlist',ids:['a']}]};h.context.ctxMenuList(data,{kind:'playlists'});
    const b=h.$('#sheet').querySelector('[data-a="'+action+'"]');if(!b||b.disabled)continue;b.onclick();
    const call=h.calls.find(c=>Array.isArray(c)&&['setQueue','enqueue'].includes(c[0]));if(call)assert.ok(call[1].every(t=>t.title&&t.path),'playlist records cannot be tracks');
  }
});
test('overflow Play all preserves a valid mapped shuffle occurrence',()=>{
  const h=harness();menu(h);const original=tracks();Object.assign(h.context.Engine,{queue:original,order:[2,0,1]});
  const data={type:'tracks',items:[original[2],original[0],original[1]],indices:[2,0,1],mappedPlayback:true};h.context.ctxMenuList(data,{kind:'all'});h.$('#sheet').querySelector('[data-a="play"]').onclick();
  assert.deepEqual(h.calls.find(c=>Array.isArray(c)&&['playIndex','setQueue'].includes(c[0])),['playIndex',2,true]);
});
test('View As applies to the current connected list after a source-driven rerender',()=>{
  const h=harness();h.context.Views.currentData={type:'tracks',items:tracks()};h.options.show(h.box);
  const handler=h.$('#sheet').querySelector('.list-view-options').querySelectorAll('input').find(n=>n.getAttribute('value')==='5').onchange;
  const replacement=element('div','zoom-list');replacement.dataset.zoom='1';replacement.dataset.zoomKey='files';replacement.__spec={kind:'all'};h.box.isConnected=false;h.nodes.set('#list-body .zoom-list',replacement);
  handler();const zoom=h.calls.find(c=>Array.isArray(c)&&c[0]==='zoom');assert.equal(zoom?.[2],replacement,'detached old box must not receive the layout update');
});
test('group actions remain accessible in the dock once their header scrolls away',()=>{
  const h=harness(),p=presentation(h),fabs=h.$('#list-fabs');p.render({kind:'albums'},{type:'groups',items:[]});h.body.__referenceActions.rect.bottom=-1;p.updateDock();
  assert.equal(fabs.hidden,false);assert.ok(fabs.querySelectorAll('.fab').length>=2,'search and options need a dock copy for group lists');
});
test('alphabet anchors distinguish numeric, accented Latin, and non-Latin rows',()=>{
  const h=harness();h.context.alphaInitial=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().charAt(0);
  vm.runInContext('globalThis.buildAlpha='+section('  buildAlpha:function(data){','  buildFabs:function(data, spec){').replace(/^  buildAlpha:/,'').replace(/},\s*$/,'}'),h.context);
  const items=[{title:'2 numeric'},...Array.from({length:26},(_,i)=>({title:String.fromCharCode(65+i)+' song'})),{title:'Éclair'},{title:'東京'},{title:'# Symbols'}];
  h.context.buildAlpha({type:'tracks',items});const rail=h.$('#alpha');assert.equal(rail.children.map(n=>n.textContent).join(''),'^0ABCDEFGHIJKLMNOPQRSTUVWXYZ#');
  assert.equal(rail.__anchors.get('0'),0);assert.equal(rail.__anchors.get('E'),5);assert.equal(rail.__anchors.get('#'),28);
});
test('album hero summary does not report an unknown duration as measured 0:00',()=>{
  const h=harness(),p=presentation(h);p.render({kind:'album',key:'Unknown durations'},{type:'tracks',items:[{id:'a',title:'A',artist:'Artist',year:0,dur:0}]});
  const summary=h.body.querySelector('.album-meta-pill').textContent;assert.doesNotMatch(summary,/0:00/);assert.doesNotMatch(summary,/\| 0$/);
});
function artworkHarness(){
  let callback;const requests=[],painted=[],unobserved=[];
  const context=vm.createContext({IntersectionObserver:class{constructor(fn){callback=fn;}observe(){}unobserve(n){unobserved.push(n);}},LIB:{map:new Map([['old',{id:'old'}],['new',{id:'new'}]])},getArtURL:(t,small)=>new Promise(resolve=>requests.push({t,small,resolve})),UI:{setArtEl:(...v)=>painted.push(v)}});
  vm.runInContext(section('let artObserver=null;','/* =====================================================================\n   ROW INTERACTION')+'\nglobalThis.observer=ensureArtObserver();',context);
  return {context,requests,painted,unobserved,intersect:node=>callback([{isIntersecting:true,target:node}])};
}
const flush=()=>new Promise(setImmediate);
test('album hero completion ignores detached, reassigned, superseded, and rejected targets',async()=>{
  for(const mode of ['valid','detach','reassign','supersede','reject']){const h=harness(),pending=[];h.context.getArtURL=(t,small)=>new Promise((resolve,reject)=>pending.push({t,small,resolve,reject}));const p=presentation(h);p.render({kind:'album',key:'First'},{type:'tracks',items:[tracks()[0]]});const n=h.body.querySelector('.album-hero-art');assert.equal(pending[0].small,false);
    if(mode==='detach')n.isConnected=false;if(mode==='reassign')n.dataset.art='new';if(mode==='supersede')p.render({kind:'album',key:'Second'},{type:'tracks',items:[tracks()[1]]});
    if(mode==='reject')pending[0].reject(Error('unavailable cover'));else pending[0].resolve('fixture:cover');await flush();assert.equal(h.calls.filter(c=>Array.isArray(c)&&c[0]==='heroArt').length,mode==='valid'?1:0,mode);
  }
});
test('ordinary library artwork retains cached thumbnail loading',()=>{
  const h=artworkHarness(),n=element('div','art');n.dataset.art='old';h.intersect(n);assert.equal(h.requests[0].small,true);
});
test('source geometry fits primary header and rail budgets at 360/393/430 widths',()=>{
  // Source arithmetic only; these assertions do not qualify browser or phone layout.
  assert.match(html,/\.library-header-actions\{[^}]*gap:calc\(5 \* var\(--pa-u\)\)/);
  assert.match(html,/\.library-header-actions \.fab\{[^}]*min-width:calc\(55 \* var\(--pa-u\)\)/);
  assert.match(html,/#sc-list\.reference-list #alpha\{[^}]*width:calc\(16 \* var\(--pa-u\)\)/);
  assert.match(html,/#sc-list\.reference-list #alphabubble\{[^}]*width:calc\(102 \* var\(--pa-u\)\)/);
  for(const width of [360,393,430]){const u=width/393,headerAvailable=width-40*u,conservativeButtonTotal=(3*55+(6*15+2*12+2*1.4)+42+4*5)*u;assert.ok(conservativeButtonTotal<=headerAvailable,`header ${width}`);const railHeight=640-112*u-109*u;assert.ok(railHeight>102*u,`rail/bubble ${width}`);assert.ok(railHeight/29>=10*u,`distributed labels ${width}`);}
});
test('missing alphabet letters jump to the closest later letter even in a reversed list',()=>{
  const h=harness();h.context.alphaInitial=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase().charAt(0);
  vm.runInContext('globalThis.buildAlpha='+section('  buildAlpha:function(data){','  buildFabs:function(data, spec){').replace(/^  buildAlpha:/,'').replace(/},\s*$/,'}'),h.context);
  const items=[{title:'Zulu'},{title:'Charlie'},...Array.from({length:27},(_,i)=>({title:'Alpha '+i}))];h.context.buildAlpha({type:'tracks',items});
  assert.equal(h.$('#alpha').__anchors.get('B'),1,'a missing B should go to C rather than the first Z in reversed order');
});
test('a legacy global track sort cannot select a disabled sort for group categories',()=>{
  const h=harness();h.context.SET.sortTracks='artist';for(const kind of ['albums','artists','playlists','tree'])assert.equal(h.options.get({kind}).sort,'title',kind);
});
