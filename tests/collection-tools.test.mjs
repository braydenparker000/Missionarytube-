import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const context=vm.createContext({URL});
vm.runInContext(await readFile('assets/js/collection-tools.js','utf8'),context);
const tools=context.AstraCollections;
const plain=value=>JSON.parse(JSON.stringify(value));
const titles=[{id:'a',type:'movie',name:'Amélie',year:2001,genres:['Comedy']},{id:'b',type:'series',name:'Dark',year:2017},{id:'c',type:'movie',name:'Arrival',year:2016}];
test('collection matching combines accent-insensitive title words and type without changing source arrays',()=>{
  assert.deepEqual(plain(tools.select(titles,{query:'amelie comedy',type:'movie'})),[titles[0]]);
  assert.equal(tools.select(titles,{query:'Dark',type:'movie'}).length,0);
  assert.deepEqual(titles.map(item=>item.id),['a','b','c']);
});
test('collection sorts are explicit and preserve original order for equal dates',()=>{
  assert.deepEqual(plain(tools.select(titles,{sort:'year'})).map(item=>item.id),['b','c','a']);
  assert.deepEqual(plain(tools.select(titles,{sort:'title'})).map(item=>item.id),['a','c','b']);
  assert.deepEqual(plain(tools.select(titles,{dates:{'movie:c':20}})).map(item=>item.id),['c','a','b']);
});
test('recent searches reject malformed history, deduplicate, and stay bounded',()=>{
  assert.deepEqual(plain(tools.recent(null,'  The  Matrix ')),['The Matrix']);
  assert.deepEqual(plain(tools.recent(['AMELIE',null,{},'Dune'],'Amélie')),['Amélie','Dune']);
  assert.equal(tools.recent(Array.from({length:20},(_,i)=>'title '+i),'new').length,8);
  assert.deepEqual(plain(tools.recent(['Dune'],'x'.repeat(161))),['Dune']);
});
const good=()=>({app:'Astra',addons:[{url:'https://example.test/manifest.json',enabled:true}],library:{'movie:a':{meta:titles[0],added:1}},settings:{},progress:{},youtube:{enabled:false}});
test('backup retains valid content and preferences while deriving official status from the real URL',()=>{
  const data=good();data.addons[0].official=true;
  const result=tools.backup(data);
  assert.equal(result.addons[0].official,false);
  assert.equal(result.library['movie:a'].meta.name,'Amélie');
  assert.equal(result.youtube.enabled,false);
});
test('backup rejects unsafe addresses and malformed collections before any state is returned',()=>{
  for(const url of ['javascript:alert(1)','http://example.test/manifest.json','https://user:pass@example.test/manifest.json','https://example.test/page']){
    const data=good();data.addons[0].url=url;assert.throws(()=>tools.backup(data));
  }
  for(const library of [[],{'movie:a':{meta:null}},{'wrong':{meta:titles[0]}}])assert.throws(()=>tools.backup({...good(),library}));
  assert.throws(()=>tools.backup({...good(),settings:[]}));
  assert.throws(()=>tools.backup({...good(),addons:[...good().addons,...good().addons]}));
});
test('failed backup persistence rolls back earlier writes and preserves unrelated data',()=>{
  const values=new Map([['addons','old'],['library','original'],['other','untouched']]);
  const storage={getItem:key=>values.get(key)??null,setItem(key,value){if(key==='library'&&value==='"new"')throw Error('quota');values.set(key,value);},removeItem:key=>values.delete(key)};
  assert.throws(()=>tools.commit(storage,{addons:['replacement'],library:'new',settings:{}}));
  assert.deepEqual([...values],[['addons','old'],['library','original'],['other','untouched']]);
});
test('backup serialization errors and unavailable storage leave the original setup untouched',()=>{
  let writes=0;const circular={};circular.self=circular;
  assert.throws(()=>tools.commit({getItem:()=>null,setItem:()=>writes++},{a:'value',b:circular}));
  assert.equal(writes,0);assert.throws(()=>tools.commit(null,{a:'value'}));
});

const app=await readFile('assets/js/app.js','utf8');
function homeFixture(){
  const nodes={homeRoot:{innerHTML:''},featureMount:{innerHTML:''},homeSections:{innerHTML:'',slots:[],insertAdjacentHTML(_,html){this.slots.push({dataset:{homeCatalog:html},outerHTML:html});},addEventListener(){}}};
  const waiting=new Map();let active=true;
  const run={current:()=>active,signal:new AbortController().signal};
  const entries=['slow','fast'].map(key=>({key,displayName:key,providerName:key,hero:false,source:{},catalog:{id:key}}));
  const ctx=vm.createContext({
    Routes:{begin:()=>run},state:{currentPage:'home',homeLayout:{showHero:true}},$:id=>nodes[id.slice(1)],$$:()=>nodes.homeSections.slots,
    continueItems:()=>[],tonightLoadingHTML:()=>'<loading>',resumeSectionHTML:()=>'',skeletonSector:()=>'',loadManifests:async()=>{},catalogEntries:()=>entries,
    getCatalog:(_,cat)=>new Promise((resolve,reject)=>waiting.set(cat.id,{resolve,reject})),catalogExtras:()=>({}),homeBrowseHTML:()=>'',homeGroupHTML:g=>g.items?.length?g.entry.key+':ready':g.entry.key,
    tonightChoice:groups=>groups[0],featureHTML:choice=>'feature:'+choice.entry.key,bindDynamic(){},installHomeSectorPager(){},welcomeFeatureHTML:()=>'<welcome>',
    HOME_INITIAL_SECTORS:3,CONTINUE_LIMIT:12
  });
  vm.runInContext(app.slice(app.indexOf('    async function renderHome()'),app.indexOf('    function homeGroupHTML(')),ctx);
  return {ctx,nodes,waiting,cancel:()=>active=false};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('Home renders a ready catalog while another is pending, retaining configured slot order',async()=>{
  const f=homeFixture(),done=f.ctx.renderHome();await tick();
  f.waiting.get('fast').resolve([{id:'fast'}]);await tick();
  assert.equal(f.nodes.homeSections.slots[1].outerHTML,'fast:ready');
  assert.equal(f.nodes.homeSections.slots[0].outerHTML,'slow');
  assert.equal(f.nodes.featureMount.innerHTML,'feature:fast');
  f.waiting.get('slow').resolve([{id:'slow'}]);await done;
  assert.equal(f.nodes.homeSections.slots[0].outerHTML,'slow:ready');
  assert.equal(f.nodes.featureMount.innerHTML,'feature:fast','late arrivals must not replace the feature under a tap');
});
test('leaving Home prevents late catalog responses from repainting the page',async()=>{
  const f=homeFixture(),done=f.ctx.renderHome();await tick();f.cancel();
  f.waiting.get('slow').resolve([{id:'slow'}]);f.waiting.get('fast').reject(Error('offline'));await done;
  assert.deepEqual(f.nodes.homeSections.slots.map(slot=>slot.outerHTML),['slow','fast']);
  assert.equal(f.nodes.featureMount.innerHTML,'');
});
