import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
// Deterministic logic/DOM contracts only. Browser boot, layout and touch QA are
// separately exercised by poweramp-search-browser.test.js.
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
function harness(tracks=[]){
  const nodes=new Map(),calls=[],settings={};
  const $=s=>{if(!nodes.has(s))nodes.set(s,element());return nodes.get(s);};
  const body=$('#q-body');body.classList.add('scroll');$('#q').value='the';
  const context=vm.createContext({$,el:element,artObserver:null,SET:{listOptions:{},listZoom:{}},allTracks:()=>tracks,nativeValues:()=>settings,
    Views:{trackList(items,spec){const b=element('div','list zoom-list');b.__items=items;b.__spec=spec;calls.push(['trackList',items.length]);return b;},
      playlistList(items){const b=element('div','list zoom-list');b.__pls=items;return b;},listOptions:()=>context.SET.listOptions.search||{},push:spec=>calls.push(['push',spec])},
    ListZoom:{get:()=>context.SET.listZoom.search??3,attach(b,key){b.classList.add('zoom-list');b.dataset.zoomKey=key;b.dataset.zoom=String(this.get());return b;},apply(b,key,id){b.dataset.zoomKey=key;b.dataset.zoom=String(id);},set(b,id){context.SET.listZoom.search=id;b.dataset.zoom=String(id);calls.push(['zoom',id]);}},
    ListOptions:{save(spec,value){context.SET.listOptions.search={...context.SET.listOptions.search,...value};}},
    Playlists:{data:[],all(){return this.data;}},LIB:{map:new Map(tracks.map(t=>[t.id,t]))},sourceTrackEnabled:t=>!!t,
    Selection:{mode:false,box:null,enter(id,box){this.mode=true;this.box=box;calls.push(['select',box.__items.length]);},exit(){this.mode=false;this.box=null;calls.push('exit');}},
    TrackWindow:{clean:()=>calls.push('clean')},InputLifecycle:{active:()=>true,register(){}},NativeSettings:{values:{}},
    Engine:{setQueue:(...args)=>calls.push(['queue',...args])},Nav:{cur:'search',go:screen=>calls.push(['nav',screen])},UI:{renderToggles(){}},
    Settings:{open:page=>calls.push(['settings',page])},openSheet:()=>calls.push('open'),closeSheet:()=>calls.push('close'),
    trackArtist:t=>t.artist||'Unknown artist',trackAlbum:t=>t.album||'Unknown album',baseName:s=>String(s||'').split('/').at(-1),
    sortNat:(a,b)=>String(a).localeCompare(String(b),undefined,{numeric:true}),fmtTime:n=>Math.floor(n/60)+':'+String(Math.floor(n%60)).padStart(2,'0'),
    esc:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),icoHTML:icon=>'<i data-icon="'+icon+'"></i>',
    debounce:fn=>fn,observeArt(){},saveSet:()=>calls.push('save'),performance:{now:()=>1000},setTimeout,clearTimeout,vibrate(){},PlaybackQueue:{add(){},play(){}},ctxMenuGroup:()=>calls.push('groupMenu')});
  const start=source.indexOf('  groupBy:function('),end=source.indexOf('  buildItems:',start);
  vm.runInContext('Views.groupBy='+source.slice(start+'  groupBy:'.length,end).trim().replace(/,$/,'')+';',context);
  vm.runInContext(section('const Search={','/* =====================================================================\n   SETTINGS SCREENS')+'\nglobalThis.search=Search;',context);
  vm.runInContext(section('function installSearchPlayback(){','function installSettingsShortcuts(){')+'\ninstallSearchPlayback();',context);
  context.search.init();return {context,search:context.search,$,body,calls,settings};
}
const tracks=()=>[
  {id:'a',title:'The Moon',artist:'The Artist',album:'The Album',albumArtist:'The Album Artist',folder:'The Folder',genre:'The Genre',composer:'The Composer',year:2026,dur:60},
  {id:'b',title:'Song B',artist:'The Artist',album:'The Album',albumArtist:'The Album Artist',folder:'The Folder',genre:'The Genre',composer:'The Composer',year:2026,dur:120}
];

test('Search mounts every enabled reference chip and keeps the selected filter accessible',()=>{
  const h=harness(tracks()),chips=h.$('#q-chips').querySelectorAll('.chip');
  assert.deepEqual(chips.map(c=>c.dataset.c),['All','Albums','Artists','Album Artists','Folders','Genres','Years','Composers','Playlists','All Songs','Streams']);
  chips.find(c=>c.dataset.c==='Albums').onclick();assert.equal(h.search.filter,'Albums');assert.equal(h.body.querySelector('h2').textContent,'Albums');assert.equal(chips.find(c=>c.dataset.c==='Albums').getAttribute('aria-pressed'),'true');
});
test('All search results remain category sections, with real year/composer/playlist sources',()=>{
  const h=harness(tracks());h.context.Playlists.data=[{id:'pl',name:'The Playlist',ids:['a','b']}];h.search.run();
  assert.deepEqual(Array.from(h.search.sections,s=>s.category.label),['Albums','Artists','Album Artists','Folders','Genres','Composers','Playlists','All Songs']);
  assert.equal(h.body.querySelector('.search-group-list').__groups[0].tracks.length,2);
  h.search.filter='Years';h.$('#q').value='2026';h.search.run();assert.equal(h.search.sections[0].data.items[0].key,'2026');
  h.search.filter='Composers';h.$('#q').value='The Composer';h.search.run();assert.equal(h.search.sections[0].data.open,'composer');
  h.search.filter='Playlists';h.$('#q').value='The Playlist';h.search.run();assert.equal(h.search.sections[0].box.__pls[0].id,'pl');
});
test('Search album rows use real artwork and artist/count/duration/year metadata',()=>{
  const h=harness(tracks());h.search.filter='Albums';h.search.run();const row=h.body.querySelector('.trow');
  assert.equal(row.querySelector('.art').dataset.art,'a');assert.equal(row.querySelector('.t1').textContent,'The Album');assert.equal(row.querySelector('.t2').textContent,'The Album Artist');assert.equal(row.querySelector('.t3').textContent,'2 | 3:00 | 2026');
  h.context.LIB.map.get('a').dur=0;h.search.run();assert.match(h.body.querySelector('.t3').textContent,/Duration unavailable/);
});
test('5,000 matching songs and 200 matching groups are never truncated',()=>{
  const items=Array.from({length:5000},(_,i)=>({id:'x'+i,title:'The Song '+i,artist:'Artist',album:'The Album '+i%200,dur:60}));
  const h=harness(items);h.search.filter='All Songs';h.search.run();assert.equal(h.search.sections[0].box.__items.length,5000);assert.deepEqual(h.calls.find(c=>Array.isArray(c)&&c[0]==='trackList'),['trackList',5000]);
  h.search.filter='Albums';h.search.run();assert.equal(h.search.sections[0].box.__groups.length,200);assert.equal(h.body.querySelectorAll('.trow').length,60);assert.match(h.body.querySelector('.search-result-page').textContent,/1–60 of 200/);h.body.querySelector('[data-search-next]').onclick();assert.equal(h.body.querySelector('.trow').dataset.g,'60');assert.equal(h.body.querySelectorAll('.trow').length,60);
});
test('Search Play/Shuffle use de-duplicated complete tracks and preserve native Play Tracks Only',()=>{
  const h=harness(tracks());h.search.run();h.settings.search_play_tracks=false;h.search.play(false);let queue=h.calls.find(c=>Array.isArray(c)&&c[0]==='queue');assert.deepEqual(Array.from(queue[1],t=>t.id),['a','b']);assert.equal(h.context.Engine.categoryKind,'search');
  h.settings.search_track_titles_only=true;h.settings.search_play_tracks=true;h.search.run();assert.deepEqual(Array.from(h.search.playbackItems(),t=>t.id),['a']);
  h.search.play(true);assert.equal(h.context.SET.shuffleOn,true);assert.equal(h.context.SET.shuffleMode,1);assert.deepEqual(h.calls.at(-1),['nav','player']);
});
test('Select targets actual song results and stays disabled for unsupported group selection',()=>{
  const h=harness(tracks());h.search.filter='All Songs';h.search.run();h.$('#q-select').onclick();assert.deepEqual(h.calls.at(-1),['select',2]);assert.equal(h.$('#q-select').getAttribute('aria-pressed'),'true');h.$('#q-select').onclick();assert.equal(h.context.Selection.mode,false);
  h.search.filter='Albums';h.search.run();assert.equal(h.$('#q-select').disabled,true);assert.match(h.$('#q-select').title,/All Songs/);assert.equal(h.$('#q-play').disabled,false);
});
test('Streams explicitly reports unavailable and never enables pretend playback',()=>{
  const h=harness(tracks());h.search.filter='Streams';h.search.run();assert.match(h.body.textContent,/Streams are unavailable/);assert.equal(h.search.sections.length,0);assert.equal(h.$('#q-play').disabled,true);assert.equal(h.$('#q-shuffle').disabled,true);assert.equal(h.$('#q-select').disabled,true);
});
test('Search List Options has ten working category toggles, fixed header/footer and two-column real views',()=>{
  const h=harness(tracks());h.search.run();h.search.listOptions();const panel=h.$('#sheet');
  assert.deepEqual(panel.querySelector('.list-options-content').children.map(c=>c.tagName),['HEADER','DIV','FOOTER']);assert.equal(panel.querySelector('h3').textContent,'List Options: Search');
  const categories=panel.querySelector('.search-category-options').querySelectorAll('input');assert.equal(categories.length,10);const albums=categories.find(c=>c.dataset.searchCategory==='albums');albums.onchange({target:{checked:false}});assert.equal(h.context.SET.searchCategories.albums,false);assert.equal(h.search.sections.some(s=>s.category.label==='Albums'),false);assert.equal(h.$('#q-chips').querySelectorAll('.chip').some(c=>c.dataset.c==='Albums'),false);
  const titles=panel.querySelector('[data-search-titles]');titles.onchange({target:{checked:true}});assert.equal(h.context.SET.listOptions.search.titlesOnly,true);assert.equal(h.body.querySelector('.search-group-list').querySelector('.t2'),null);
  const views=panel.querySelector('.list-view-options').querySelectorAll('input');assert.equal(views.length,10);views.find(c=>c.getAttribute('value')==='5').onchange();assert.equal(h.context.SET.listZoom.search,5);assert.ok(h.body.querySelectorAll('.zoom-list').every(b=>b.dataset.zoom==='5'));
  panel.querySelector('[data-search-settings]').onclick();assert.deepEqual(h.calls.at(-1),['settings','library_search']);panel.querySelector('[data-search-close]').onclick();assert.equal(h.calls.at(-1),'close');
});
test('Search empty-query wrapper resets old result actions and stale view events do not change newer screens',()=>{
  const h=harness(tracks());h.search.run();h.search.listOptions();const view=h.$('#sheet').querySelector('.list-view-options').querySelectorAll('input')[0];h.context.Nav.cur='library';view.onchange();assert.equal(h.context.SET.listZoom.search,undefined);
  h.$('#q').value='';h.search.refreshActions();assert.equal(h.search.sections.length,0);assert.equal(h.$('#q-play').disabled,true);assert.equal(h.$('#q-select').disabled,true);assert.equal(h.$('#q-clear').disabled,true);
});
test('actual delegated group and playlist rows open their supported library destinations',()=>{
  const h=harness(tracks());vm.runInContext(section('function installListDelegation(','/* =====================================================================\n   CONTEXT MENUS'),h.context);h.context.installListDelegation(h.body);
  h.search.filter='Albums';h.search.run();h.body.fire('click',{target:h.body.querySelector('.trow')});assert.deepEqual({...h.calls.at(-1)[1]},{kind:'album',key:'The Album',title:'The Album'});
  h.context.Playlists.data=[{id:'pl',name:'The Playlist',ids:['a']}];h.search.filter='Playlists';h.search.run();const row=h.search.sections[0].box.querySelector('.trow');h.body.fire('click',{target:row});assert.deepEqual({...h.calls.at(-1)[1]},{kind:'playlist',key:'pl',title:'The Playlist'});
});

test('paged playlists keep global route indices and page controls never escape the last full page',()=>{
  const h=harness(tracks());h.context.Playlists.data=Array.from({length:145},(_,i)=>({id:'pl'+i,name:'The Playlist '+i,ids:['a']}));h.search.filter='Playlists';h.search.run();const box=h.search.sections[0].box;assert.equal(box.__pls.length,145);assert.equal(box.querySelectorAll('.trow').length,60);
  for(let i=0;i<4;i++)box.querySelector('[data-search-next]').onclick();assert.equal(box.querySelector('.trow').dataset.pl,'120');assert.equal(box.querySelectorAll('.trow').length,25);assert.match(box.querySelector('.search-result-page').textContent,/121–145 of 145/);box.querySelector('[data-search-prev]').onclick();assert.equal(box.querySelector('.trow').dataset.pl,'60');
  h.context.Nav.cur='player';box.querySelector('[data-search-prev]').onclick();assert.equal(box.querySelector('.trow').dataset.pl,'60','stale page controls cannot alter a newer screen');
});

test('native Search Categories binds only the library_search list_opts action and preserves other actions',()=>{
  const h=harness(tracks());Object.assign(h.context,{audioInfo:()=>h.calls.push('audio-info'),DrawerCast:{show(){}},PAGES:{},ROOTS:{list:[]},EQ:{},editPlayerButtons(){},exportConfiguration(){}});h.context.Settings.stack=['library_search'];
  const a=source.indexOf('  action(it){'),b=source.indexOf('  renderItem(it){',a);vm.runInContext('NativeSettings.action='+source.slice(a+'  action'.length,b).trim().replace(/,$/,'').replace(/^\(it\)/,'function(it)')+';',h.context);
  vm.runInContext(section('const actionBeforeRework=NativeSettings.action;','NativeSettings.import='),h.context);
  const action=h.context.NativeSettings.action({key:'list_opts'});assert.equal(typeof action,'function');action();assert.deepEqual(h.calls.at(-2),['nav','search']);assert.equal(h.$('#sheet').querySelector('h3').textContent,'List Options: Search');
  h.context.Settings.stack=['library'];assert.equal(h.context.NativeSettings.action({key:'list_opts'}),undefined);h.context.NativeSettings.action({key:'audio_info'})();assert.equal(h.calls.at(-1),'audio-info');
});
