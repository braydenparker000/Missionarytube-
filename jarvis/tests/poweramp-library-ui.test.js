import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/drawercast/index.html',import.meta.url),'utf8');
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
    matches(selector){if(selector.includes(','))return selector.split(',').some(s=>n.matches(s));if(selector.startsWith('.'))return names.has(selector.slice(1));if(selector.startsWith('[')){const m=selector.match(/^\[([^=\]]+)(?:=["']?([^"'\]]+)["']?)?\]$/);return !!m&&attributes.has(m[1])&&(m[2]==null||attributes.get(m[1])===m[2]);}return n.tagName===selector.toUpperCase();},
    querySelectorAll(selector){const found=[];const visit=p=>{for(const c of p.children){if(c.matches(selector))found.push(c);visit(c);}};visit(n);return found;},querySelector(selector){return n.querySelectorAll(selector)[0]||null;},
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
    ListZoom:{keys:{all:'files',albums:'albums',album:'album_files',queue:'queue',recent:'recently_added_files',playlist:'playlists_files'},key(s){return this.keys[s.kind]||s.kind;},set(b,id){b.dataset.zoom=String(id);calls.push(['zoom',id]);}},
    Engine:{queue:[],order:[],current:null,playIndex:(...v)=>calls.push(['playIndex',...v]),setQueue:(...v)=>calls.push(['setQueue',...v])},
    sortNat:(a,b)=>collator.compare(String(a),String(b)),baseName:v=>String(v).split('/').pop(),trackArtist:t=>t.artist||'Unknown artist',trackAlbum:t=>t.album||'Unknown album',
    esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),icoHTML:name=>'<i data-icon="'+name+'"></i>',fmtTime:v=>`${Math.floor((v||0)/60)}:${String(Math.floor((v||0)%60)).padStart(2,'0')}`,
    saveSet:()=>calls.push('save'),closeSheet:()=>calls.push('close'),openSheet:()=>calls.push('open'),Settings:{open:p=>calls.push(['settings',p])},
    requestAnimationFrame:fn=>{fn();return 1;},observeArt:n=>calls.push(['observeArt',n[0].dataset.art]),DockLayout:{schedule:()=>calls.push('dock')},CATS:[{k:'all',n:'All Songs',ic:'note',c:'#6d7de8'},{k:'album',n:'Album',ic:'album',c:'#5b4fe0'}],
    getArtURL:()=>Promise.resolve(null),UI:{setArtEl:(node,url)=>calls.push(['heroArt',node.dataset.art,url])},nativeValues:()=>({}),Selection:{mode:false},Nav:{go:n=>calls.push(['nav',n])},bindTapButton:(button,action)=>{button.onclick=action;}});
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

test('all fifteen metadata comparators use their actual fields and natural title ties',()=>{
  const h=harness(),expected={track:['b','c','a'],discTrack:['c','a','b'],title:['b','c','a'],filename:['a','c','b'],path:['b','c','a'],artist:['b','c','a'],album:['c','a','b'],year:['b','c','a'],yearAlbum:['b','c','a'],added:['b','c','a'],mtime:['a','c','b'],rating:['b','c','a'],duration:['a','c','b'],lastPlayed:['b','c','a'],plays:['a','c','b']};
  for(const [sort,order] of Object.entries(expected)){h.options.save({kind:'all'},{sort});assert.deepEqual(ids(h.options.prepare({type:'tracks',items:tracks()},{kind:'all'}).items),order,sort);}
});
test('per-category sort, reverse and titles-only choices persist without changing other categories',()=>{
  const h=harness();h.options.save({kind:'all'},{sort:'artist',reverse:true,titlesOnly:true});h.options.save({kind:'album'},{sort:'track'});
  assert.equal(h.options.get({kind:'all'}).titlesOnly,true);assert.equal(h.options.get({kind:'album'}).reverse,false);assert.equal(h.options.get({kind:'album'}).sort,'track');
  assert.equal(h.options.get({kind:'recent'}).sort,'added');assert.equal(h.options.get({kind:'playlist'}).sort,'original');
  assert.deepEqual(ids(h.options.prepare({type:'tracks',items:tracks()},{kind:'all'}).items),['a','c','b']);
});
test('missing metadata disables its sort and saved missing choices disclose their fallback',()=>{
  const h=harness(),data={type:'tracks',items:[{id:'x',title:'Song'}]};
  for(const sort of ['track','filename','year','added','mtime','rating','duration','lastPlayed','plays'])assert.notEqual(h.options.availability(sort,data,{kind:'all'}),'',sort);
  h.options.save({kind:'all'},{sort:'mtime'});const result=h.options.prepare(data,{kind:'all'});assert.match(result.sortNotice,/filesystem date/);assert.equal(result.items,data.items);
});
test('queue displays ignore sorting/reverse and retain exact repeated occurrences',()=>{
  const h=harness(),items=[tracks()[0],tracks()[1],tracks()[0]],indices=[0,2,3],data={type:'tracks',items,indices};h.options.save({kind:'queue'},{sort:'title',reverse:true});
  assert.equal(h.options.prepare(data,{kind:'queue'}),data);assert.equal(data.indices,indices);assert.deepEqual(ids(data.items),['a','b','a']);
  assert.match(h.options.availability('title',data,{kind:'queue'}),/occurrence/);
});
test('shuffle order projects complete unambiguous engine occurrences without mutating engine order',()=>{
  const h=harness(),items=tracks();Object.assign(h.context.Engine,{queue:items,order:[2,0,1]});h.context.SET.shuffleOn=true;h.options.save({kind:'all'},{sort:'shuffle'});
  const data=h.options.prepare({type:'tracks',items},{kind:'all'});assert.deepEqual(ids(data.items),['c','a','b']);assert.deepEqual(Array.from(data.indices),[2,0,1]);assert.equal(data.mappedPlayback,true);assert.deepEqual(h.context.Engine.order,[2,0,1]);
  h.context.Engine.queue=[...items,items[0]];h.context.Engine.order=[2,0,1,3];assert.equal(h.options.shuffleMap(items),null,'duplicate queue IDs cannot be inferred as one occurrence');
  h.context.Engine.queue=items;h.context.Engine.order=[2,0];assert.equal(h.options.shuffleMap(items),null,'incomplete mapping is unavailable');
});
test('List Options has a fixed header/footer contract, sixteen sorts and all ten real view modes',()=>{
  const h=harness();h.context.Views.currentData={type:'tracks',items:tracks()};h.box.__items=tracks();h.options.show(h.box);const panel=h.$('#sheet'),content=panel.querySelector('.list-options-content');
  assert.deepEqual(content.children.map(c=>c.tagName),['HEADER','DIV','FOOTER']);assert.equal(panel.querySelector('h3').textContent,'List Options: All Songs');
  assert.equal(panel.querySelector('.list-sort-options').querySelectorAll('input').length,16);assert.equal(panel.querySelector('.list-view-options').querySelectorAll('input').length,10);
  const layouts=panel.querySelector('.list-view-options').querySelectorAll('input');layouts.find(n=>n.getAttribute('value')==='5').onchange();assert.deepEqual(h.calls.at(-1),['zoom',5]);
  panel.querySelector('[data-list-close]').onclick();assert.equal(h.calls.at(-1),'close');
  assert.match(html,/\.list-options-body\{overflow-y:auto/);assert.match(html,/\.list-options-footer\{flex-shrink:0/);
});
test('Date Added provenance is available from an accessible sort control only when needed',()=>{
  const h=harness(),items=tracks().map(t=>({...t,addedSource:'r2-upload'}));h.context.Views.currentData={type:'tracks',items};h.options.save({kind:'all'},{sort:'added'});h.options.show(h.box);
  const panel=h.$('#sheet'),button=panel.querySelector('[data-date-added-info]'),info=panel.querySelector('.date-added-info');
  assert.ok(button);assert.equal(button.tagName,'BUTTON');assert.equal(button.getAttribute('aria-label'),'Date Added information');assert.equal(button.getAttribute('aria-expanded'),'false');
  assert.equal(info.textContent,'R2 dates use verified upload time; original library-add dates are unavailable.');button.onclick();assert.equal(button.getAttribute('aria-expanded'),'true');assert.equal(info.hidden,false);button.onclick();assert.equal(button.getAttribute('aria-expanded'),'false');assert.equal(info.hidden,true);
  h.context.Views.currentData={type:'tracks',items:tracks()};h.options.show(h.box);assert.equal(h.$('#sheet').querySelector('[data-date-added-info]'),null);
});
test('options update the actual sorted category and keep queue sorting controls disabled',()=>{
  const h=harness();h.context.Views.currentData={type:'tracks',items:tracks()};h.options.show(h.box);
  h.$('#sheet').querySelector('.list-sort-options').querySelectorAll('input').find(n=>n.getAttribute('value')==='mtime').onchange();
  assert.equal(h.context.SET.listOptions.files.sort,'mtime');assert.deepEqual(ids(h.context.Views.currentData.items),['a','c','b']);
  h.box.__spec={kind:'queue'};h.context.Views.currentSpec=h.box.__spec;h.options.show(h.box);
  assert.ok(h.$('#sheet').querySelector('.list-sort-options').querySelectorAll('input').every(n=>n.disabled));assert.equal(h.$('#sheet').querySelector('[data-list-reverse]').disabled,true);
});
function presentation(h){h.context.renderListBeforeRework=()=>{};vm.runInContext(section('const LibraryPresentation={','\n\nconst PlaylistFiles=')+'\nglobalThis.presentation=LibraryPresentation;',h.context);return h.context.presentation;}
test('page header and dock actions are exclusive and header copies retain real behavior',()=>{
  const h=harness(),p=presentation(h),fabs=h.$('#list-fabs');for(let i=0;i<5;i++){const b=element('button','fab','<i></i>');b.onclick=()=>h.calls.push(['action',i]);fabs.append(b);}
  p.render({kind:'all'},{type:'tracks',items:tracks()});const header=h.body.querySelector('.library-page-head');assert.equal(header.querySelector('h2').textContent,'All Songs');assert.equal(header.querySelector('.library-back').textContent,'Library');assert.equal(fabs.hidden,true);assert.equal(fabs.inert,true);
  header.querySelector('.library-header-actions').children[1].onclick();assert.deepEqual(h.calls.at(-1),['action',1]);header.querySelector('.library-back').onclick();assert.equal(h.calls.at(-1),'back');
  h.body.__referenceActions.rect.bottom=-1;p.updateDock();assert.equal(fabs.hidden,false);assert.equal(fabs.inert,false);
});
test('album page hero uses library artwork and artist/count/duration/year pills',()=>{
  const h=harness(),p=presentation(h),items=tracks().map(t=>({...t,album:'Fictional Album',artist:'Fictional Artist',year:2024}));
  p.render({kind:'album',key:'Fictional Album'},{type:'tracks',items});const hero=h.body.querySelector('.album-hero');
  assert.equal(hero.querySelector('.album-hero-art').dataset.art,'a');assert.equal(hero.querySelector('.library-back').textContent,'Albums');assert.equal(hero.querySelector('h2').textContent,'Fictional Album');assert.equal(hero.querySelector('.album-artist-pill').textContent,'Fictional Artist');assert.equal(hero.querySelector('.album-meta-pill').textContent,'3 | 10:00 | 2024');
  assert.doesNotMatch(source+html,/10000509\d+\.jpg/,'native screenshots are never embedded');
});
test('final row formatting includes duration | format and titles-only removes secondary lines',()=>{
  const h=harness();Object.assign(h.context.SET,{showDuration:true,showFileType:true,showMetaLine:true});vm.runInContext(section('Views.rowHTML=function','const groupsBeforeRework='),h.context);
  assert.match(h.context.Views.rowHTML({...tracks()[0],ext:'opus'},0,{kind:'album'}),/1:40 \| opus/);
  h.options.save({kind:'album'},{titlesOnly:true});assert.doesNotMatch(h.context.Views.rowHTML(tracks()[0],0,{kind:'album'}),/class="t[23]"/);
});
function delegated(h){
  Object.assign(h.context,{InputLifecycle:{active:()=>true,register(){}},NativeSettings:{values:{}},performance:{now:()=>1000},PlaybackQueue:{add(){},play(){}},setTimeout,clearTimeout,vibrate(){}});
  vm.runInContext(section('function installListDelegation(','/* =====================================================================\n   CONTEXT MENUS'),h.context);h.context.installListDelegation(h.body);
  h.box.__items=tracks();h.box.__spec={kind:'all'};h.box.__mappedPlayback=true;h.box.__playbackIndices=[0,1,2];const row=element('div','trow');row.dataset.i='0';h.box.append(row);return row;
}
test('mapped non-queue row playback validates occurrence ID and membership before playing',()=>{
  for(const mode of ['valid','stale-id','stale-order']){const h=harness(),row=delegated(h);h.context.Engine.queue=tracks();h.context.Engine.order=mode==='stale-order'?[1,2]:[0,1,2];if(mode==='stale-id')h.context.Engine.queue=[tracks()[1],tracks()[0],tracks()[2]];
    h.body.fire('click',{target:row});const playback=h.calls.find(c=>Array.isArray(c)&&['playIndex','setQueue'].includes(c[0]));assert.equal(playback[0],mode==='valid'?'playIndex':'setQueue',mode);if(mode==='valid')assert.deepEqual(playback,['playIndex',0,true]);}
});
test('reference density defaults apply only when no explicit category zoom was saved',()=>{
  const h=harness();h.context.clamp=(v,a,b)=>Math.max(a,Math.min(b,v));vm.runInContext(section('const ZoomProfile=','/* Per-category display choices')+section('const ListZoom={','// Preserve the existing delegated actions')+'\nglobalThis.zoom=ListZoom;',h.context);
  assert.equal(h.context.zoom.get('files'),1);assert.equal(h.context.zoom.get('albums'),1);assert.equal(h.context.zoom.get('album_files'),3);
  h.context.SET.listZoom.files=3;assert.equal(h.context.zoom.get('files'),3);h.context.zoom.apply(h.box,'files',3);h.context.SET.listOptions.files={titlesOnly:true};h.context.zoom.apply(h.box,'files',3);assert.equal(h.box.classList.contains('titles-only'),true,'same density must still apply changed row formatting');
});
test('five-thousand-song sorting preserves the complete playback item array and source order',()=>{
  const h=harness(),items=Array.from({length:5000},(_,i)=>({id:'t'+i,title:'Song '+(5000-i),track:i+1}));h.options.save({kind:'all'},{sort:'title'});
  const result=h.options.prepare({type:'tracks',items},{kind:'all'});assert.equal(result.items.length,5000);assert.equal(result.items[0].id,'t4999');assert.equal(result.items[4999].id,'t0');assert.equal(items[0].id,'t0');assert.equal(new Set(result.items.map(t=>t.id)).size,5000);
});
test('alpha rail exposes distinct numeric and symbol anchors, distributed geometry and rounded-square bubble',()=>{
  const h=harness();vm.runInContext(section('function alphaInitial(','function setupAlphaScrub()'),h.context);const a=source.indexOf('  buildAlpha:function('),b=source.indexOf('  buildFabs:',a);vm.runInContext('globalThis.buildAlpha='+source.slice(a+'  buildAlpha:'.length,b).trim().replace(/,$/,'')+';',h.context);
  const titles=['2 Song','42 Song','Alpha','Över','Zebra','東京',...Array.from({length:30},(_,i)=>'A '+i)];h.context.buildAlpha({type:'tracks',items:titles.map(title=>({title}))});const rail=h.$('#alpha');assert.equal(rail.__anchors.get('0'),0);assert.equal(rail.__anchors.get('#'),5);assert.equal(rail.__anchors.get('O'),3);assert.deepEqual(rail.children.map(n=>n.textContent).slice(0,4),['^','0','A','B']);assert.equal(rail.children.at(-1).textContent,'#');
  assert.match(html,/#sc-list\.reference-list #alpha\{[^}]*width:calc\(16 \* var\(--pa-u\)\)[^}]*justify-content:space-around/);
  assert.match(html,/#sc-list\.reference-list #alphabubble\{[^}]*width:calc\(102 \* var\(--pa-u\)\)[^}]*border-radius:calc\(25 \* var\(--pa-u\)\)/);
});
test('track/year/date/duration unknown zero values sort after known values while count/rating zero remain real',()=>{
  const h=harness();for(const [sort,field] of [['track','track'],['year','year'],['duration','dur'],['added','added'],['mtime','mtime'],['lastPlayed','lastPlayed']]){const items=[{id:'unknown',title:'A',[field]:0},{id:'known',title:'Z',[field]:3}];assert.deepEqual(ids(items.sort(h.options.comparator(sort))),['known','unknown'],sort);assert.notEqual(h.options.availability(sort,{type:'tracks',items:[{id:'zero',[field]:0}]},{kind:'all'}),'',sort);}
  assert.equal(h.options.availability('plays',{type:'tracks',items:[{plays:0}]},{kind:'all'}),'');assert.equal(h.options.availability('rating',{type:'tracks',items:[{rating:0}]},{kind:'all'}),'');
});
test('group/playlist/title and tree file sorts actually apply and reverse their visible order',()=>{
  const h=harness();for(const [type,kind,field] of [['groups','albums','key'],['playlists','playlists','name']]){h.options.save({kind},{sort:'title',reverse:true});const data=h.options.prepare({type,items:[{id:'z',[field]:'Z'},{id:'a',[field]:'A'}]},{kind});assert.deepEqual(ids(data.items),['z','a'],type);}
  h.options.save({kind:'tree'},{sort:'title',reverse:true});const tree=h.options.prepare({type:'tree',dirs:['A','B'],items:tracks()},{kind:'tree'});assert.deepEqual(ids(tree.items),['a','c','b']);assert.deepEqual(Array.from(tree.dirs),['B','A']);
});
function menu(h){
  h.context.oldCtxMenuList=(data)=>{h.calls.push(['oldMenu',data.type]);h.$('#sheet').innerHTML='<h3>All Songs</h3><div class="menugrid"><button data-a="play">Play all</button><button data-a="shuffle">Shuffle all</button></div>';};h.context.Sheets={show:()=>h.calls.push('menu-open')};
  vm.runInContext(section('ctxMenuList=function(data,spec){\n  const s=', '\n\nconst NativeSettings='),h.context);
}
test('group and playlist More omit inapplicable track actions, while mapped overflow Play preserves the occurrence',()=>{
  for(const type of ['groups','playlists']){const h=harness();menu(h);h.context.ctxMenuList({type,items:[]},{kind:'albums'});assert.equal(h.calls.some(c=>Array.isArray(c)&&c[0]==='oldMenu'),false,type);assert.equal(h.$('#sheet').querySelector('[data-a="play"]'),null,type);assert.equal(h.$('#sheet').querySelector('.mi').textContent,'List Options');}
  for(const stale of [false,true]){const h=harness();menu(h);const items=tracks();h.context.Engine.queue=items;h.context.Engine.order=stale?[0,1]:[2,0,1];h.context.ctxMenuList({type:'tracks',items:[items[2],items[0],items[1]],indices:[2,0,1],mappedPlayback:true},{kind:'all'});h.$('#sheet').querySelector('[data-a="play"]').onclick();const playback=h.calls.find(c=>Array.isArray(c)&&['setQueue','playIndex'].includes(c[0]));assert.equal(playback[0],stale?'setQueue':'playIndex');if(!stale)assert.deepEqual(playback,['playIndex',2,true]);}
});
test('group pages retain applicable filled search/options dock actions after scrolling',()=>{
  const h=harness(),p=presentation(h);p.render({kind:'albums'},{type:'groups',items:[]});const dock=h.$('#list-fabs');assert.equal(dock.children.length,2);h.body.__referenceActions.rect.bottom=-1;p.updateDock();assert.equal(dock.hidden,false);dock.children[0].onclick();assert.deepEqual(h.calls.at(-1),['nav','search']);
});
test('View As follows a replacement category box and never alters an unrelated newer category',()=>{
  const h=harness();h.context.Views.currentData={type:'tracks',items:tracks()};h.options.show(h.box);const input=h.$('#sheet').querySelector('.list-view-options').querySelectorAll('input').find(n=>n.getAttribute('value')==='5');
  const replacement=element('div','zoom-list');replacement.__spec={kind:'all'};replacement.dataset.zoom='1';replacement.dataset.zoomKey='files';h.nodes.set('#list-body .zoom-list',replacement);h.box.isConnected=false;input.onchange();assert.equal(replacement.dataset.zoom,'5');assert.equal(h.box.dataset.zoom,'1');
  replacement.__spec={kind:'album'};replacement.dataset.zoom='3';input.onchange();assert.equal(replacement.dataset.zoom,'3');
});
test('album hero and row metadata disclose unmeasured duration rather than a fake zero total',()=>{
  const h=harness(),p=presentation(h),item={id:'x',title:'Unmeasured',artist:'Artist',album:'Album',dur:0};p.render({kind:'album',key:'Album'},{type:'tracks',items:[item]});assert.match(h.body.querySelector('.album-meta-pill').textContent,/Duration unavailable/);assert.doesNotMatch(h.body.querySelector('.album-meta-pill').textContent,/0:00/);
  h.context.SET.showDuration=true;h.context.SET.showMetaLine=true;vm.runInContext(section('Views.rowHTML=function','const groupsBeforeRework='),h.context);assert.match(h.context.Views.rowHTML(item,0,{kind:'album'}),/Duration unavailable/);
});
test('album hero requests full-resolution art and ignores stale, detached and failed loads',async()=>{
  const h=harness(),pending=[];h.context.getArtURL=(track,small)=>new Promise((resolve,reject)=>pending.push({track,small,resolve,reject}));const p=presentation(h),items=tracks();p.render({kind:'album',key:'First'},{type:'tracks',items:[items[0]]});assert.equal(pending[0].small,false);p.render({kind:'album',key:'Second'},{type:'tracks',items:[items[1]]});pending[0].resolve('stale-full-cover');await new Promise(setImmediate);assert.equal(h.calls.some(c=>Array.isArray(c)&&c[0]==='heroArt'),false);
  pending[1].resolve('current-full-cover');await new Promise(setImmediate);assert.deepEqual(h.calls.at(-1),['heroArt','b','current-full-cover']);
  p.render({kind:'album',key:'Third'},{type:'tracks',items:[items[2]]});h.body.__referenceHeader.querySelector('.album-hero-art').isConnected=false;pending[2].resolve('detached-full-cover');await new Promise(setImmediate);assert.equal(h.calls.some(c=>Array.isArray(c)&&c[2]==='detached-full-cover'),false);
  p.render({kind:'album',key:'Failed'},{type:'tracks',items:[items[0]]});pending[3].reject(Error('Cover unavailable'));await new Promise(setImmediate);assert.equal(h.calls.filter(c=>Array.isArray(c)&&c[0]==='heroArt').length,1);
});
test('missing alphabet letter anchors choose the closest later initial in reversed display order',()=>{
  const h=harness();vm.runInContext(section('function alphaInitial(','function setupAlphaScrub()'),h.context);const a=source.indexOf('  buildAlpha:function('),b=source.indexOf('  buildFabs:',a);vm.runInContext('globalThis.buildAlpha='+source.slice(a+'  buildAlpha:'.length,b).trim().replace(/,$/,'')+';',h.context);
  h.context.buildAlpha({type:'tracks',items:[{title:'Zulu'},{title:'Charlie'},...Array.from({length:30},(_,i)=>({title:'Alpha '+i}))]});assert.equal(h.$('#alpha').__anchors.get('B'),1);
});
