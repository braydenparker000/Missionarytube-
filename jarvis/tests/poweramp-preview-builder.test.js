import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {buildPreview, previewPrelude, previewHooks} from '../scripts/build-poweramp-preview.mjs';

function mediaHarness({historyThrows=false}={}){
  let now=0,next=0;const timers=new Map(),nodes=[];
  class AudioNode extends EventTarget{
    constructor(){super();this.playbackRate=1;this.attributes=new Map();}
    removeAttribute(name){this.attributes.delete(name);}
    setAttribute(name,value){this.attributes.set(name,value);}
  }
  const window={history:{pushState(){if(historyThrows)throw Error('file history blocked');},replaceState(){if(historyThrows)throw Error('file history blocked');}}};
  Object.defineProperty(window,'localStorage',{get(){throw Error('Must not read real storage');}});
  const document={createElement(name){assert.equal(name,'audio');const node=new AudioNode();nodes.push(node);return node;}};
  const context=vm.createContext({Event,document,window,performance:{now:()=>now},
    setTimeout:(fn,ms=0)=>{timers.set(++next,{fn,at:now+ms});return next;},clearTimeout:id=>timers.delete(id),
    Preview:{track:id=>({id,dur:id==='second'?180:60}),notice(){}}});
  vm.runInContext(previewPrelude+'\nglobalThis.makeAudio=()=>new Audio();globalThis.storage=localStorage;globalThis.previewHistory=history;globalThis.network=fetch;globalThis.offlineImport=__offlineImport;',context);
  const advance=ms=>{now+=ms;for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}};
  return {context,nodes,timers,advance};
}

test('preview builder emits parseable self-contained classic HTML without changing app sources',async()=>{
  const names=['index.html','audio-analysis.js','audio-core.js','player.js'];
  const inputs=await Promise.all(names.map(name=>readFile(new URL('../public/drawercast/'+name,import.meta.url))));
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const directory=await mkdtemp(join(tmpdir(),'poweramp-preview-'));
  try{
    const result=await buildPreview(join(directory,'preview.html'));
    const html=await readFile(result.output,'utf8');
    assert.ok(result.bytes>500000);assert.equal(result.verification.externalAssets,0);assert.equal(result.verification.moduleImports,0);
    const scripts=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    assert.equal(scripts.length,1);new vm.Script(scripts[0][1],{filename:'preview-inline.js'});
    assert.doesNotMatch(html,/<script\b[^>]*\b(?:src|type)\s*=/i);
    assert.doesNotMatch(html,/<link\b[^>]*\bhref\s*=/i);
    assert.match(html,/Content-Security-Policy/);assert.match(html,/connect-src 'none'/);
    assert.match(html,/UI preview v9 · simulated · no audio/);assert.match(html,/id="preview-reset"/);assert.match(html,/5,000 tracks/);
    assert.doesNotMatch(scripts[0][1],/\bawait\s+import\s*\(/);
    assert.match(html,/const Audio=PreviewAudio/);assert.match(html,/Engine\.ensureCtx=\(\)=>null/);
    const current=await Promise.all(names.map(name=>readFile(new URL('../public/drawercast/'+name,import.meta.url))));
    assert.deepEqual(current.map(hash),inputs.map(hash));
  }finally{await rm(directory,{recursive:true,force:true});}
});

test('output-directory argument builds the named downloadable HTML',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'poweramp-preview-directory-'));
  try{const result=await buildPreview(directory);assert.equal(result.output,join(directory,'Poweramp-UI-Preview.html'));assert.ok((await readFile(result.output)).length>0);}
  finally{await rm(directory,{recursive:true,force:true});}
});

test('storage facade works without ever accessing real localStorage and can reset',()=>{
  const {context}=mediaHarness(),s=context.storage;
  assert.equal(s.getItem('settings'),null);s.setItem('settings','fictional');assert.equal(s.getItem('settings'),'fictional');
  assert.equal(s.length,1);assert.equal(s.key(0),'settings');s.removeItem('settings');assert.equal(s.length,0);
  s.setItem('another',123);assert.equal(s.getItem('another'),'123');s.clear();assert.equal(s.length,0);
});

test('network and module facades reject before any live source request',async()=>{
  const {context}=mediaHarness();await assert.rejects(context.network('https://example.invalid'),/Network access is disabled/);
  await assert.rejects(context.offlineImport('./drive-api.js'),/External modules are disabled/);
});

test('file history rejection is caught and recorded for the in-app Back hint',()=>{
  const {context}=mediaHarness({historyThrows:true});context.previewHistory.pushState({},'');context.previewHistory.replaceState({},'');
  assert.equal(vm.runInContext('__previewHistoryUnavailable',context),true);
});

test('media simulation reports metadata without assigning a native source or playing audio',()=>{
  const h=mediaHarness(),audio=h.context.makeAudio(),events=[];
  for(const name of ['loadedmetadata','durationchange','canplay'])audio.addEventListener(name,()=>events.push(name));
  audio.src='preview:first';assert.equal(audio.duration,60);assert.equal(audio.readyState,4);assert.equal(audio.paused,true);
  assert.equal(audio.attributes.has('src'),false);assert.equal(audio.currentSrc,'preview:first');
  h.advance(0);assert.deepEqual(events,['loadedmetadata','durationchange','canplay']);
  assert.equal(audio.buffered.end(0),60);assert.equal(audio.seekable.start(0),0);
});

test('simulated play, pause and seek advance logically and preserve paused seek position',async()=>{
  const h=mediaHarness(),audio=h.context.makeAudio();audio.src='preview:first';h.advance(0);
  await audio.play();h.advance(1500);assert.equal(audio.currentTime,1.5);assert.equal(audio.paused,false);
  audio.pause();h.advance(5000);assert.equal(audio.currentTime,1.5);assert.equal(audio.paused,true);
  audio.currentTime=24;assert.equal(audio.currentTime,24);await audio.play();h.advance(2000);assert.equal(audio.currentTime,26);
  audio.pause();assert.equal(h.timers.size,0);
});

test('simulated speed changes preserve previous progress rather than jumping retroactively',async()=>{
  const h=mediaHarness(),audio=h.context.makeAudio();audio.src='preview:first';h.advance(0);await audio.play();h.advance(2000);
  audio.playbackRate=2;assert.equal(audio.currentTime,2);h.advance(1000);assert.equal(audio.currentTime,4);audio.pause();
});

test('source replacement cancels stale metadata and releases playback ticks',async()=>{
  const h=mediaHarness(),audio=h.context.makeAudio(),events=[];audio.addEventListener('loadedmetadata',()=>events.push(audio.src));
  audio.src='preview:first';audio.src='preview:second';h.advance(0);assert.deepEqual(events,['preview:second']);assert.equal(audio.duration,180);
  await audio.play();h.advance(1000);audio.removeAttribute('src');audio.load();h.advance(1000);
  assert.equal(audio.src,'');assert.equal(audio.currentTime,0);assert.equal(audio.paused,true);assert.equal(audio.readyState,0);assert.equal(h.timers.size,0);
});

test('simulated end fires once and replay restarts a completed placeholder',async()=>{
  const h=mediaHarness(),audio=h.context.makeAudio();let ended=0;audio.addEventListener('ended',()=>ended++);
  audio.src='preview:first';h.advance(0);await audio.play();h.advance(60000);assert.equal(ended,1);assert.equal(audio.currentTime,60);assert.equal(audio.ended,true);assert.equal(audio.paused,true);
  h.advance(10000);assert.equal(ended,1);await audio.play();assert.equal(audio.currentTime,0);audio.pause();
});

function fixtureHarness(globals={}){
  const ctx=vm.createContext({LIB:{map:new Map()},Waveform:{key:t=>'wave-'+t.id},PlaybackQueue:{},Uint8Array,console,...globals});
  const hooks=previewHooks.slice(0,previewHooks.indexOf('Preview.prepare();'));
  vm.runInContext(hooks+'\nglobalThis.fixture=Preview;',ctx);return ctx.fixture;
}
test('fixture catalogs contain fictional placeholders and inline SVG art with bounded durations',()=>{
  const p=fixtureHarness(),tracks=p.fixtures(24);assert.equal(tracks.length,24);assert.equal(new Set(tracks.map(t=>t.id)).size,24);
  for(const t of tracks){assert.equal(t.preview,true);assert.equal(t.remote,false);assert.equal(t.size,0);assert.ok(t.dur>=60&&t.dur<=180);assert.match(t.coverURL,/^data:image\/svg\+xml/);assert.match(t.codec,/no audio/);}
  const large=p.fixtures(5000);assert.equal(large.length,5000);assert.equal(new Set(large.map(t=>t.id)).size,5000);
  assert.equal(new Set(large.map(t=>t.title[0])).size,26);assert.equal(new Set(large.map(t=>t.coverURL)).size,6);
});

test('fixture seeding creates playlists, upcoming queue and placeholder waveform geometry in memory',()=>{
  const p=fixtureHarness(),tracks=p.seed(5000);assert.equal(p.store('tracks').size,5000);assert.equal(p.store('kv').get('playlists').length,3);
  assert.equal(p.store('kv').get('playlists')[0].ids.length,8);assert.equal(p.store('kv').size,25);
  p.waveform(tracks[4999]);const shape=p.store('kv').get('wave-'+tracks[4999].id);assert.equal(shape.duration,tracks[4999].dur);assert.ok(shape.peaks.length<=2880);
});

test('preview reset removes preferences created after boot and restores native settings independently',()=>{
  const SET={listZoom:{files:8},listOptions:{files:{sort:'duration'}},newSetting:true};
  const NativeSettings={values:{az_scroll:false,newPreference:true},scrolls:{root:400},searching:true};
  const p=fixtureHarness({SET,NativeSettings});
  p.defaults={listZoom:{files:1},animations:'default'};p.nativeDefaults={az_scroll:true};p.restoreDefaults();
  assert.deepEqual(JSON.parse(JSON.stringify(SET)),{listZoom:{files:1},animations:'default'});
  assert.equal(NativeSettings.values.az_scroll,true);assert.equal(NativeSettings.values.newPreference,undefined);
  assert.equal(Object.keys(NativeSettings.scrolls).length,0);assert.equal(NativeSettings.searching,false);
  SET.listZoom.files=9;NativeSettings.values.az_scroll=false;p.restoreDefaults();
  assert.equal(SET.listZoom.files,1);assert.equal(NativeSettings.values.az_scroll,true);
  assert.equal(p.defaults.listZoom.files,1);assert.equal(p.nativeDefaults.az_scroll,true);
});

test('preview reset clears detached list context, windows and old visit history before reseeding',()=>{
  const Views={stack:[{kind:'album'}],currentSpec:{kind:'album'},currentData:{items:['old']},job:12};
  const Nav={lastLibrary:'list'},Settings={stack:['root','skin']};let cleaned=0,seeded=0;
  const body={innerHTML:'old rows',scrollTop:900,__referenceHeader:{},__referenceActions:{}};
  const fabs={innerHTML:'old actions',hidden:false,inert:false,__referenceVisible:true},categories={scrollTop:100};
  const LibraryPageHistory={entries:[{spec:'old'}],index:0,seed(){seeded++;assert.equal(this.entries.length,0);assert.equal(this.index,-1);this.entries=[{screen:'library'}];this.index=0;}};
  const document={getElementById:id=>({'list-body':body,'list-fabs':fabs,'lib-cats':categories})[id]};
  const p=fixtureHarness({Views,Nav,Settings,document,LibraryPageHistory,TrackWindow:{clean(scope){assert.equal(scope,body);cleaned++;}}});p.clearViewContext();
  assert.equal(cleaned,1);assert.equal(seeded,1);assert.equal(Views.stack.length,0);assert.equal(Views.currentSpec,null);assert.equal(Views.currentData,null);assert.equal(Views.job,13);
  assert.equal(Nav.lastLibrary,'library');assert.equal(Settings.stack.length,1);assert.equal(Settings.stack[0],'root');
  assert.equal(body.innerHTML,'');assert.equal(body.scrollTop,0);assert.equal(body.__referenceHeader,null);assert.equal(body.__referenceActions,null);
  assert.equal(fabs.innerHTML,'');assert.equal(fabs.hidden,true);assert.equal(fabs.inert,true);assert.equal(categories.scrollTop,0);
  assert.equal(LibraryPageHistory.entries[0].screen,'library');
});

test('preview fixture reset clears parked Search and EQ state that lives outside settings',()=>{
  const Search={filter:'Artists',sections:[{old:true}],history:['old query']},EQ={tab:'vol',userPresets:[{name:'Old preset'}]};
  const query={value:'old query'},results={innerHTML:'old results',scrollTop:600},chips={scrollLeft:250},bands={scrollLeft:700};let cleaned=0;
  const document={getElementById:id=>({q:query,'q-body':results,'q-chips':chips,bands})[id]};
  const p=fixtureHarness({Search,EQ,document,Views:{job:0},Nav:{},Settings:{},TrackWindow:{clean(scope){assert.equal(scope,results);cleaned++;}}});
  p.presetDefaults=[{name:'Fixture preset'}];p.clearViewContext();
  assert.equal(Search.filter,'All');assert.equal(Search.sections.length,0);assert.equal(Search.history.length,0);assert.equal(query.value,'');assert.equal(results.innerHTML,'');assert.equal(results.scrollTop,0);assert.equal(chips.scrollLeft,0);assert.equal(cleaned,1);
  assert.equal(EQ.tab,'eq');assert.equal(EQ.userPresets[0].name,'Fixture preset');assert.equal(bands.scrollLeft,0);
  EQ.userPresets[0].name='Changed';assert.equal(p.presetDefaults[0].name,'Fixture preset');
  assert.match(previewHooks,/Views\.refreshAll\(\);Search\.renderChips\(\);Search\.run\(\);/);
});
