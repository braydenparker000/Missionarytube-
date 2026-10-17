import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const base=new URL('../public/media/assets/js/',import.meta.url);
const context=vm.createContext({URL,Map,AbortController,setTimeout,clearTimeout,console});
for(const file of ['search-intent.js','youtube/config.js','youtube/instances.js','youtube/api.js','youtube/playback.js'])vm.runInContext(await readFile(new URL(file,base),'utf8'),context);
const intent=context.AstraSearchIntent,YT=context.AstraYouTube;

test('normal movie, show and song names retain every search word',()=>{
  for(const title of ['American Horror Story','The Truman Show','Scary Movie','The Sound of Music','Comedy of Errors','Regular Show','Romance','Action Jackson','Science Fiction Double Feature']){
    const parsed=intent.parse(title);
    assert.equal(parsed.text,title);assert.equal(parsed.filters.length,0,title);
  }
});
test('explicit search filters and clear browse clauses remain supported',()=>{
  assert.equal(intent.parse('series: American Horror Story').text,'American Horror Story');
  assert.equal(intent.parse('music: The Sound of Music').genre,'');
  assert.equal(intent.parse('series: Scary Movie').type,'series');
  assert.equal(intent.parse('youtube scary movie').type,'youtube');
  assert.equal(intent.parse('youtube Paco de Lucia').type,'youtube');
  assert.equal(intent.parse('horror movies').genre,'Horror');
  assert.equal(intent.parse('dramatic movie under two hours').text,'dramatic');
  assert.equal(intent.parse('youtube:dQw4w9WgXcQ').text,'youtube:dQw4w9WgXcQ');
  assert.equal(intent.minutesOf('1:06:30'),66.5);
  assert.equal(intent.minutesOf('5:24'),5.4);
});
test('YouTube pasted links work with and without a scheme',()=>{
  for(const link of ['youtube.com/watch?v=dQw4w9WgXcQ','www.youtube.com/shorts/dQw4w9WgXcQ','youtu.be/dQw4w9WgXcQ','https://music.youtube.com/watch?v=dQw4w9WgXcQ'])assert.equal(YT.api.videoIdFromInput(link),'dQw4w9WgXcQ');
  assert.equal(YT.api.videoIdFromInput('https://example.test/watch?v=dQw4w9WgXcQ'),'');
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}};
const answer={api:'piped',instance:'https://relay.test',data:{items:[{type:'stream',url:'/watch?v=dQw4w9WgXcQ',title:'Video'}]}};
test('an immediate same-query retry owns a new request after the last subscriber cancels',async()=>{
  const calls=[];
  const manager={request(_spec,options){const d=deferred();calls.push({...d,options});return d.promise}};
  const client=YT.api.createClient({manager,config:{cacheTtl:10000}});
  const controller=new AbortController();
  const old=client.search('test',{signal:controller.signal});const rejected=assert.rejects(old,e=>e.kind==='aborted');
  controller.abort();
  const fresh=client.search('test');assert.equal(calls.length,2);
  calls[0].reject(Error('old request failed'));await rejected;await Promise.resolve();await Promise.resolve();
  const shared=client.search('test');assert.equal(calls.length,2,'old cleanup must not delete the new request');
  calls[1].resolve(answer);
  assert.equal((await fresh).items.length,1);assert.equal((await shared).items.length,1);
});
test('cached replies respect cancellation and explicit Try again reaches instance recovery',async()=>{
  const calls=[];const manager={request(_spec,options){calls.push(options);return Promise.resolve(answer)}};
  const client=YT.api.createClient({manager,config:{cacheTtl:10000}});
  await client.search('cached');const controller=new AbortController();controller.abort();
  await assert.rejects(client.search('cached',{signal:controller.signal}),e=>e.kind==='aborted');
  await client.search('cached',{retry:true});assert.equal(calls.length,2);assert.equal(calls.at(-1).retry,true);
});
const app=await readFile(new URL('app.js',base),'utf8');
function functionSource(name){const start=app.indexOf(`    ${name==='renewYouTubePlayback'?'async ':''}function ${name}(`);assert.ok(start>=0);return app.slice(start,app.indexOf('\n    }',start)+6)}
test('a newly mounted thumbnail is not discarded while its request starts',()=>{
  const queued=[],image={dataset:{},complete:true,currentSrc:"",naturalWidth:0,addEventListener(){}};
  let failed=0;
  const c=vm.createContext({$$:()=>[image],queueMicrotask:fn=>queued.push(fn),AstraArtworkFallback:()=>failed++});
  vm.runInContext(functionSource('bindArtwork'),c);c.bindArtwork({});
  queued[0]();assert.equal(failed,0,'lazy images without a selected source have not failed');
  image.complete=false;queued[0]();
  assert.equal(failed,0,'template completion is not a network failure');
  const renderer=functionSource('refreshSearchRun');
  assert.ok(renderer.indexOf('rail.insertBefore(node')<renderer.indexOf('bindArtwork(node)'), 'artwork binds after the new card is connected');
});
test('cached YouTube results share the live video lane and obey provider filters',()=>{
  const item={id:'dQw4w9WgXcQ',type:'youtube',name:'Paco',_providerKey:'youtube',_addonName:'YouTube'};
  for(const enabled of [true,false]){
    const state={currentPage:'search',searchSequence:0,metaCache:new Map([['video',item]]),homeItems:[],library:{}};
    const route={current:()=>true,onDispose(){}};
    const c=vm.createContext({state,clearTimeout,searchTimer:null,youtube:{browseToken:0},youtubeEnabled:()=>enabled,YT:{api:{videoIdFromInput:()=>''}},Routes:{},AstraSearchIntent:{parse:()=>({text:'Paco',type:''}),matches:()=>true},AstraSearch:{groupSources:()=>[],matchRank:()=>0,merge:(a,b)=>[...a,...b]},allCatalogs:()=>[],isYouTubeMeta:m=>m.type==='youtube',renderSearchRun(){},searchYouTube(){},searchProviderGroup(){}});
    vm.runInContext(functionSource('search'),c);c.search('Paco',route);
    const lanes=state.searchRun.groups.filter(group=>group.key==='youtube');
    assert.equal(lanes.length,enabled?1:0);
    if(enabled){assert.equal(lanes[0].youtube,true);assert.equal(lanes[0].items[0],item);assert.equal(lanes[0].pending,1)}
  }
});
test('YouTube renewal keeps the live position, pause state and selected quality',async()=>{
  const controller=deferred(),old={videoId:'dQw4w9WgXcQ',plan:{},refreshed:false};
  const player={youtube:old,session:{snapshot:()=>({resumeTime:13})},sources:[],diagnostics:{},lastPaused:false};
  const state={currentStreams:[]},opens=[];
  const c=vm.createContext({player,state,AbortController,$:()=>({currentTime:80,paused:true}),youtubeProvider:()=>({client:{video:()=>controller.promise}}),youtubeConfig:()=>({}),currentYouTubeVariant:()=> 'v720',window:{},YT:{playback:{variantById:()=>({height:720}),browserCapabilities:()=>({}),buildPlan:()=>({variants:[{}]}),toStreams:()=>[{}]}},prepareStreams:()=>[360,720].map(height=>({stream:{raw:{_youtube:{height,variantId:'v'+height}}}})),candidateKey:e=>'v'+e.stream.raw._youtube.height,openPlayer:(entry,options)=>opens.push({entry,options}),youtubeAborted:()=>false,renderPlayerError:()=>assert.fail('successful renewal must not show an error'),toast:()=>{}});
  vm.runInContext(functionSource('renewYouTubePlayback'),c);
  const job=c.renewYouTubePlayback(old);controller.resolve({});await job;
  assert.equal(opens[0].options.resumeAt,80);assert.equal(opens[0].options.paused,true);assert.equal(opens[0].entry.stream.raw._youtube.height,720);
});
test('closing or switching a player while renewing cannot start the old video again',async()=>{
  const controller=deferred(),old={videoId:'dQw4w9WgXcQ'},player={youtube:old,session:{}};
  const c=vm.createContext({player,AbortController,youtubeProvider:()=>({client:{video:()=>controller.promise}}),openPlayer:()=>assert.fail('stale renewal opened video')});
  vm.runInContext(functionSource('renewYouTubePlayback'),c);
  const job=c.renewYouTubePlayback(old);player.session=null;player.leaseAbort.abort();controller.resolve({});await job;
});
