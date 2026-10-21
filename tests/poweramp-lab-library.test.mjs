import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {PlaylistStore,PLAYLIST_STORAGE_KEY,libraryRatingDisplay,resolveLibraryLayout,searchTracks,groupTracks,reorderItems} from '../frontend/poweramp-lab/library.js';

const tracks=[
  {id:'a',title:'Alpha',artist:'One',album:'First',genre:'Rock',folder:'Music',duration:62},
  {id:'b',title:'Beta',artist:'Two',album:'Second',genre:'Jazz',folder:'Music',duration:180},
  {id:'c',title:'Gamma <img src=x onerror=alert(1)>',artist:'One',album:'First',genre:'Rock',folder:'Live',duration:91},
];

test('library density resolves semantic zoom order and landscape increments',()=>{
  assert.deepEqual([-4,-3,-2,-1,0,3,4].map(zoom=>resolveLibraryLayout(zoom).rowHeight),[34.55,34.55,43.64,49.09,56.36,96,137]);
  assert.deepEqual([1,2,5].map(zoom=>resolveLibraryLayout(zoom,false,360,780).columns),[4,3,2]);
  assert.deepEqual([1,2,5].map(zoom=>resolveLibraryLayout(zoom,false,780,360).columns),[6,5,4]);
  assert.equal(resolveLibraryLayout(5,false,600,400).columns,3);
  assert.equal(resolveLibraryLayout(-4).columns,2);
  assert.equal(resolveLibraryLayout(-2).titlesOnly,true);
});
test('library rating modes preserve native endpoint thumbs and stars-in-menu',()=>{
  assert.equal(libraryRatingDisplay(0,5),null);
  assert.equal(libraryRatingDisplay(1,3),null);
  assert.equal(libraryRatingDisplay(1,-1).kind,'dislike');
  assert.equal(libraryRatingDisplay(1,1).kind,'dislike');
  assert.equal(libraryRatingDisplay(1,5).kind,'like');
  assert.equal(libraryRatingDisplay(2,3).count,3);
  assert.equal(libraryRatingDisplay(3,4).count,4);
  assert.equal(libraryRatingDisplay(3,4,true),null);
});
test('metadata query matches every term and groups all songs without executing markup',()=>{
  assert.deepEqual(searchTracks(tracks,'one rock').map(track=>track.id),['a','c']);
  assert.equal(searchTracks(tracks,'').length,0);
  assert.equal(searchTracks(tracks,'<img')[0].id,'c');
  assert.deepEqual(groupTracks(tracks,'albums').map(group=>[group.title,group.tracks.length]),[['First',2],['Second',1]]);
  assert.deepEqual(reorderItems(['a','b','a'],0,2),['b','a','a']);
});
test('playlist CRUD persists only a versioned name/ID model and keeps duplicates',()=>{
  const values=new Map();const storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const store=new PlaylistStore(storage);const id=store.create('  Weekend  ',['a','b']);
  store.add(id,['a']);store.rename(id,'Weekend 2');
  assert.deepEqual(new PlaylistStore(storage).get(id),{id,name:'Weekend 2',trackIds:['a','b','a']});
  const saved=JSON.parse(values.get(PLAYLIST_STORAGE_KEY));assert.deepEqual(Object.keys(saved.items[0]).sort(),['id','name','trackIds']);
  assert.throws(()=>store.rename(id,'  '),/name/);
  store.replace(id,reorderItems(store.get(id).trackIds,0,1));assert.deepEqual(store.get(id).trackIds,['b','a','a']);
  store.delete(id);assert.equal(new PlaylistStore(storage).list().length,0);
  storage.getItem=()=>'{broken';assert.equal(new PlaylistStore(storage).list().length,0);
});

const chrome=[process.env.POWERAMP_CHROME,process.env.CHROME_PATH,'/usr/bin/chromium','/usr/bin/google-chrome'].find(path=>path&&existsSync(path));
const fixture=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/library.css"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#app{height:100%;width:100%}</style></head><body><div id="app"></div><script type="module">
import {LibraryView} from '/library.js';
class Player extends EventTarget {
 constructor(){super();this.tracks=${JSON.stringify(tracks).replace(/</g,'\\u003c')};this.queue=['a','b','a','c'];this.queueIndex=0;this.currentTrack=this.tracks[0];this.calls=[];}
 select(id,options){this.calls.push(['select',id,options]);this.queue=[...options.queue];this.currentTrack=this.tracks.find(track=>track.id===id);this.queueIndex=options.queueIndex??this.queue.indexOf(id);this.dispatchEvent(new Event('change'));}
 enqueue(ids,options){this.calls.push(['enqueue',ids,options]);if(options?.next)this.queue.splice(this.queueIndex+1,0,...ids);else this.queue.push(...ids);this.dispatchEvent(new Event('change'));}
 removeQueue(index){this.calls.push(['removeQueue',index]);this.queue.splice(index,1);this.dispatchEvent(new Event('change'));}
 reorderQueue(from,to){this.calls.push(['reorderQueue',from,to]);this.queue.splice(to,0,this.queue.splice(from,1)[0]);this.dispatchEvent(new Event('change'));}
}
class Settings extends EventTarget {constructor(){super();this.scopes={};}get(scope={}){return {skin:'black',list_zoom:0,titles_only:false,compact_header:false,...this.scopes[scope.listId]};}set(key,value,scope={}){this.scopes[scope.listId]={...this.scopes[scope.listId],[key]:value};this.dispatchEvent(new Event('change'));}}
window.player=new Player();window.settings=new Settings();window.messages=[];window.navigations=[];window.imports=0;
window.library=new LibraryView({player,settings,notify:m=>messages.push(m),onNavigate:route=>navigations.push(route),onImport:()=>imports++});document.querySelector('#app').append(library.element);window.ready=true;
</script></body></html>`;
async function browserFixture(t) {
  assert.ok(chrome,'Library browser checks require Chromium; set POWERAMP_CHROME.');
  const server=createServer(async(req,res)=>{try{if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(fixture);return;}if(!['/library.js','/library.css'].includes(req.url)){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',req.url.endsWith('js')?'text/javascript':'text/css');res.end(await readFile(new URL(`../frontend/poweramp-lab${req.url}`,import.meta.url)));}catch{res.writeHead(500);res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});t.after(()=>browser.close());
  const origin=`http://127.0.0.1:${server.address().port}`;
  return {browser,origin};
}
async function open(f,width=360,height=780) {
  const page=await f.browser.newPage({viewport:{width,height},reducedMotion:'reduce'});const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(f.origin);await page.waitForFunction(()=>window.ready);return {page,errors};
}

test('library browser workflows, pointer boundaries and compact phone layouts',async t=>{
  const f=await browserFixture(t);
  await t.test('category/detail Back and live metadata search keep playback in library',async()=>{
    const {page,errors}=await open(f);
    await page.locator('.pa-lib-category').filter({hasText:'Albums'}).click();
    await page.locator('.pa-lib-group').filter({hasText:'First'}).click();
    assert.equal(await page.locator('.pa-lib-track').count(),2);
    await page.locator('.pa-lib-track').first().click();
    assert.equal(await page.evaluate(()=>library.route),'detail');assert.deepEqual(await page.evaluate(()=>navigations),[]);
    assert.deepEqual(await page.evaluate(()=>player.calls[0]),['select','a',{play:true,queue:['a','c']}]);
    await page.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await page.evaluate(()=>library.route),'albums');
    await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('searchbox').fill('one rock');
    assert.equal(await page.locator('.pa-lib-track').count(),2);assert.equal(await page.locator('img[src="x"]').count(),0);
    await page.getByRole('searchbox').fill('not in library');await page.getByRole('heading',{name:'No results'}).waitFor();
    await page.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await page.evaluate(()=>library.route),'albums');
    assert.deepEqual(errors,[]);await page.close();
  });
  await t.test('long press selection consumes Back; moved pointer never activates a row',async()=>{
    const {page,errors}=await open(f);await page.evaluate(()=>library.show('all'));
    let box=await page.locator('.pa-lib-track').first().boundingBox();await page.mouse.move(box.x+95,box.y+20);await page.mouse.down();await page.waitForTimeout(550);await page.mouse.up();
    assert.equal(await page.locator('.pa-lib-selection').count(),1);assert.equal(await page.evaluate(()=>player.calls.length),0);
    await page.getByRole('button',{name:'Back',exact:true}).click();assert.equal(await page.locator('.pa-lib-selection').count(),0);assert.equal(await page.evaluate(()=>library.route),'all');
    await page.waitForTimeout(750);box=await page.locator('.pa-lib-track').first().boundingBox();await page.mouse.move(box.x+95,box.y+20);await page.mouse.down();await page.mouse.move(box.x+95,box.y+45,{steps:4});await page.mouse.up();
    assert.equal(await page.evaluate(()=>player.calls.length),0);assert.deepEqual(errors,[]);await page.close();
  });
  await t.test('playlist create, add, rename and remove survive view reconstruction',async()=>{
    const {page,errors}=await open(f);await page.evaluate(()=>library.show('all'));
    await page.getByRole('button',{name:'Actions for Alpha',exact:true}).click();await page.getByRole('button',{name:'Add to playlist',exact:true}).click();await page.getByRole('button',{name:'New playlist',exact:true}).click();await page.getByRole('textbox',{name:'Playlist name'}).fill('My <mix>');await page.getByRole('button',{name:'Create',exact:true}).click();
    await page.evaluate(()=>library.show('playlists'));await page.locator('.pa-lib-playlist').filter({hasText:'My <mix>'}).click();assert.equal(await page.locator('.pa-lib-track').count(),1);
    await page.getByRole('button',{name:'Library menu'}).click();await page.getByRole('button',{name:'Rename playlist',exact:true}).click();await page.getByRole('textbox',{name:'Playlist name'}).fill('Renamed');await page.getByRole('button',{name:'Save',exact:true}).click();
    await page.reload();await page.waitForFunction(()=>window.ready);await page.evaluate(()=>library.show('playlists'));await page.locator('.pa-lib-playlist').filter({hasText:'Renamed'}).click();
    await page.getByRole('button',{name:'Actions for Alpha',exact:true}).click();await page.getByRole('button',{name:'Remove',exact:true}).click();assert.equal(await page.locator('.pa-lib-track').count(),0);
    assert.deepEqual(errors,[]);await page.close();
  });
  await t.test('queue duplicates reorder by occurrence and pointer cancellation commits preview',async()=>{
    const {page,errors}=await open(f);await page.evaluate(()=>library.show('queue'));
    await page.getByRole('button',{name:'Move Alpha',exact:true}).first().focus();await page.keyboard.press('ArrowDown');assert.deepEqual(await page.evaluate(()=>player.queue),['b','a','a','c']);
    const handle=await page.getByRole('button',{name:'Move Beta',exact:true}).boundingBox();const target=await page.locator('.pa-lib-track').nth(2).boundingBox();
    await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(target.x+100,target.y+target.height/2,{steps:5});
    await page.evaluate(()=>library.element.dispatchEvent(new PointerEvent('pointercancel',{pointerId:1,bubbles:true})));await page.mouse.up();
    assert.deepEqual(await page.evaluate(()=>player.queue),['a','a','b','c']);assert.equal(await page.evaluate(()=>player.calls.filter(call=>call[0]==='select').length),0);
    await page.getByRole('button',{name:'Actions for Alpha',exact:true}).nth(1).click();await page.getByRole('button',{name:'Remove',exact:true}).click();assert.deepEqual(await page.evaluate(()=>player.queue),['a','b','c']);
    assert.deepEqual(errors,[]);await page.close();
  });
  await t.test('persisted rating updates refresh library rows and mode3 remains visible',async()=>{
    const {page,errors}=await open(f);
    await page.evaluate(()=>{localStorage.setItem('poweramp.lab.1031.v1.rating.a','4');settings.set('ratings',3,{listId:'all'});library.show('all');});
    assert.equal(await page.getByRole('img',{name:'4 of 5 stars',exact:true}).count(),1);
    await page.evaluate(()=>{localStorage.setItem('poweramp.lab.1031.v1.rating.a','5');dispatchEvent(new Event('poweramp-rating-change'));});
    assert.equal(await page.getByRole('img',{name:'5 of 5 stars',exact:true}).count(),1);
    await page.evaluate(()=>settings.set('ratings',0,{listId:'all'}));assert.equal(await page.locator('.pa-lib-rating').count(),0);
    assert.deepEqual(errors,[]);await page.close();
  });
  await t.test('display options immediately affect only the category and keep the modal open',async()=>{
    const {page,errors}=await open(f);await page.evaluate(()=>library.show('all'));
    await page.getByRole('button',{name:'Library menu'}).click();await page.getByRole('button',{name:'List Options',exact:true}).click();await page.getByRole('combobox',{name:'View as'}).selectOption('5');
    await page.getByLabel('Titles Only',{exact:true}).check();await page.getByLabel('Compact Header',{exact:true}).check();
    assert.equal(await page.getByRole('dialog',{name:'List Options'}).count(),1);await page.getByRole('button',{name:'Close',exact:true}).click();
    assert.equal(await page.locator('.pa-library.pa-lib-grid.pa-lib-titles-only.pa-lib-compact-header').count(),1);
    assert.equal(await page.locator('.pa-lib-row-subtitle').first().isVisible(),false);
    await page.evaluate(()=>library.show('albums'));assert.equal(await page.locator('.pa-library.pa-lib-grid').count(),0);
    assert.deepEqual(errors,[]);await page.close();
  });
  await t.test('required portrait and landscape sizes have bounded rows and dialogs',async()=>{
    for(const [width,height]of [[360,780],[430,932],[780,360]]) {
      const {page,errors}=await open(f,width,height);await page.evaluate(()=>{library.show('all');settings.set('list_zoom',5,{listId:'all'});});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const columns=await page.locator('.pa-lib-list').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length);assert.equal(columns,width>height?4:2);
      await page.getByRole('button',{name:'Actions for Alpha',exact:true}).click();const dialog=await page.getByRole('dialog').boundingBox();assert.ok(dialog.x>=0&&dialog.y>=0&&dialog.x+dialog.width<=width&&dialog.y+dialog.height<=height);
      await page.keyboard.press('Escape');assert.equal(await page.getByRole('dialog').count(),0);assert.deepEqual(errors,[]);await page.close();
    }
  });
});
