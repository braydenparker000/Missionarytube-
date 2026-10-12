#!/usr/bin/env node
/**
 * Build an isolated single-file, no-audio UI preview from the integrated app.
 * Usage: node scripts/build-poweramp-preview.mjs [output.html | output-directory]
 * Production HTML, modules, settings, sources and storage are never modified.
 */
import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Script} from 'node:vm';

const repository=fileURLToPath(new URL('../',import.meta.url));
const appRoot=resolve(repository,'public/drawercast');
export const defaultOutput='/workspace/shared/poweramp-preview/Poweramp-UI-Preview.html';

// This scope deliberately shadows persistent browser storage and networking.
// Even a preview hosted on the production origin cannot read/write its data.
export const previewPrelude=String.raw`
const __previewValues=new Map();
const localStorage={
  getItem(key){return __previewValues.has(String(key))?__previewValues.get(String(key)):null;},
  setItem(key,value){__previewValues.set(String(key),String(value));},
  removeItem(key){__previewValues.delete(String(key));},clear(){__previewValues.clear();},
  key(index){return Array.from(__previewValues.keys())[index]??null;},
  get length(){return __previewValues.size;}
};
let __previewHistoryUnavailable=false;
const history={
  pushState(state,title){try{window.history.pushState(state,title);}catch(e){__previewHistoryUnavailable=true;}},
  replaceState(state,title){try{window.history.replaceState(state,title);}catch(e){__previewHistoryUnavailable=true;}}
};
const __offlineImport=()=>Promise.reject(new Error('External modules are disabled in this offline UI preview'));
const fetch=()=>Promise.reject(new Error('Network access is disabled in this offline UI preview'));
const previewOpen=()=>{if(typeof Preview!=='undefined')Preview.notice();return null;};

// Real DOM media nodes keep production event handlers/slot logic intact. Their
// media API is simulated without setting a native src or opening any audio file.
function PreviewAudio(){
  const audio=document.createElement('audio');
  let source='',position=0,startedAt=0,paused=true,ended=false,timer=0,duration=0,revision=0,rate=1;
  const now=()=>performance.now();
  const time=()=>Math.min(duration,position+(paused?0:(now()-startedAt)/1000*rate));
  const fire=type=>audio.dispatchEvent(new Event(type));
  const metadata=token=>setTimeout(()=>{if(token!==revision||!source)return;fire('loadedmetadata');fire('durationchange');fire('canplay');},0);
  const stop=()=>{position=time();paused=true;clearTimeout(timer);timer=0;};
  const tick=()=>{
    if(paused)return;
    fire('timeupdate');
    if(time()>=duration){position=duration;paused=true;ended=true;timer=0;fire('ended');return;}
    timer=setTimeout(tick,100);
  };
  Object.defineProperties(audio,{
    src:{configurable:true,get:()=>source,set:value=>{
      stop();source=String(value||'');position=0;ended=false;revision++;
      duration=source?Preview.track(source.slice('preview:'.length))?.dur||90:0;
      if(source)metadata(revision);
    }},
    currentSrc:{get:()=>source},
    playbackRate:{configurable:true,get:()=>rate,set:value=>{position=time();startedAt=now();rate=Number(value)>0?Number(value):1;}},
    currentTime:{configurable:true,get:time,set:value=>{
      position=Math.max(0,Math.min(duration,Number(value)||0));startedAt=now();ended=false;
      fire('seeking');fire('timeupdate');setTimeout(()=>fire('seeked'),0);
    }},
    duration:{configurable:true,get:()=>source?duration:NaN},
    paused:{configurable:true,get:()=>paused},ended:{configurable:true,get:()=>ended},
    readyState:{configurable:true,get:()=>source?4:0},networkState:{configurable:true,get:()=>source?1:0},
    error:{configurable:true,get:()=>null},
    buffered:{configurable:true,get:()=>({length:source?1:0,start:()=>0,end:()=>duration})},
    seekable:{configurable:true,get:()=>({length:source?1:0,start:()=>0,end:()=>duration})}
  });
  audio.play=()=>{
    if(!source)return Promise.reject(new Error('Select a placeholder track first'));
    if(ended){position=0;ended=false;}
    if(paused){startedAt=now();paused=false;fire('play');fire('playing');clearTimeout(timer);timer=setTimeout(tick,100);}
    return Promise.resolve();
  };
  audio.pause=()=>{const wasPlaying=!paused;stop();if(wasPlaying)fire('pause');};
  audio.load=()=>{if(source)metadata(revision);else fire('emptied');};
  const remove=audio.removeAttribute.bind(audio);
  audio.removeAttribute=name=>{if(String(name).toLowerCase()==='src')audio.src='';remove(name);};
  return audio;
}
const Audio=PreviewAudio;
`;

export const previewHooks=String.raw`
/* Everything below is injected ONLY into the downloadable preview. */
const Preview={
  appearanceStatus(){return {ready:!!SharedPlayerMotion.preparedAppearance,pending:!!SharedPlayerMotion.appearanceJob,...SharedPlayerMotion.appearanceStats};},
  count:60,ready:false,defaults:null,nativeDefaults:null,presetDefaults:[],stores:new Map(),blockedRequests:0,
  store(name){if(!this.stores.has(name))this.stores.set(name,new Map());return this.stores.get(name);},
  track(id){return LIB.map.get(id)||this.store('tracks').get(id);},
  cover(index){
    const colors=['#a84d31','#287f94','#65518e','#53714b','#a44165','#496d95'];
    const labels=['NIGHT SIGNALS','PAPER SATELLITES','SOFT GEOMETRY','AFTER THE RAIN','BLUE HOUR MAPS','QUIET RADIANCE'];
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><rect width="600" height="600" fill="'+colors[index%6]+'"/><circle cx="'+(140+index%3*100)+'" cy="220" r="180" fill="#fff" opacity=".15"/><path d="M0 430 L210 280 L600 460 V600 H0" fill="#111" opacity=".25"/><text x="42" y="498" fill="#fff" font-size="32" font-family="sans-serif">'+labels[index%6]+'</text><text x="42" y="549" fill="#fff" font-size="19" font-family="sans-serif">FICTIONAL UI PREVIEW</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  },
  fixtures(count){
    const artists=['Mira Vale','The Lantern District','Juniper Static','Noah Ember','Glass Harbour','Selene North'];
    const albums=['Night Signals','Paper Satellites','Soft Geometry','After the Rain','Blue Hour Maps','Quiet Radiance'];
    const titles=['1984 Signal','Aster Windows','Bridge Bloom','City Waltz','Midnight Orchard','Northern Air','Silver Current','Warm Glass'];
    const covers=albums.map((_,i)=>this.cover(i));
    return Array.from({length:count},(_,i)=>{
      const album=Math.floor(i/4)%6,dur=60+(i*17)%121;
      return {id:'preview-track-'+i,source:'local',preview:true,remote:false,
        title:(count>100?String.fromCharCode(65+Math.floor(i*26/count))+' ':'')+titles[i%8]+(i>=8?' '+(Math.floor(i/8)+1):''),
        artist:artists[album],album:albums[album],albumArtist:artists[album],composer:artists[album]+' Studio',genre:i%2?'Indie electronic':'Ambient pop',year:2020+album,
        path:'Offline Preview/'+albums[album]+'/'+String(i%4+1).padStart(2,'0')+' '+titles[i%8]+'.placeholder',folder:'Offline Preview/'+albums[album],
        ext:'placeholder',codec:'Placeholder · no audio',dur,size:0,track:i%4+1,disc:1,rating:i%5===0?4:0,
        added:1735689600000+i*3600000,mtime:1704067200000+i*86400000,lastPlayed:i%3?0:1737000000000+i*60000,plays:i%7,coverURL:covers[album],tagReaderVersion:2,
        lyrics:'[00:00.00]Fictional fixture lyrics\n[00:08.00]This preview is silent\n[00:16.00]Try seeking and swiping\n[00:28.00]All data resets on reopen'};
    });
  },
  seed(count){
    this.count=count;const tracks=this.fixtures(count);this.store('tracks').clear();
    for(const track of tracks)this.store('tracks').set(track.id,track);
    const playlists=[{id:'preview-evening',name:'Evening Walk',ids:tracks.slice(0,8).map(t=>t.id)},
      {id:'preview-focus',name:'Late-Night Focus',ids:tracks.slice(8,16).map(t=>t.id)},
      {id:'preview-favourites',name:'Fixture Favourites',ids:tracks.filter((_,i)=>i%5===0).slice(0,16).map(t=>t.id)}];
    this.store('kv').set('playlists',playlists);
    // Placeholder geometry, never measured audio. Generated lazily for this UI.
    for(const track of tracks.slice(0,24))this.waveform(track);
    PlaybackQueue.pending=tracks.slice(8,11).map(t=>t.id);PlaybackQueue.active=false;PlaybackQueue.resume=null;PlaybackQueue.forced=false;
    return tracks;
  },
  waveform(track){
    const key=Waveform.key(track);if(this.store('kv').has(key))return;
    const phase=Number(track.id.split('-').at(-1))||0;
    const peaks=Uint8Array.from({length:Math.ceil(track.dur*16)},(_,i)=>Math.round(34+150*Math.abs(Math.sin(i*.075+phase))*(.45+.55*Math.abs(Math.cos(i*.017+phase)))));
    this.store('kv').set(key,{duration:track.dur,peaks});
  },
  notice(){toast('Offline UI preview: fictional placeholders, simulated playback, no audio or live accounts',5500);},
  prepare(){
    for(const name of ['get','set','del','keys','all','clear','bulk','playlists'])delete IDB[name];
    Object.assign(IDB,{
      playlists:async(expected,next,marker,valid=()=>true)=>{const store=this.store('kv');if(marker&&store.get(marker)===true)return false;if(!valid()||JSON.stringify(store.get('playlists')||[])!==JSON.stringify(expected))throw Error('Preview playlists changed');store.set('playlists',structuredClone(next));if(marker)store.set(marker,true);return true;},
      get:async(s,k)=>this.store(s).get(k),set:async(s,k,v)=>{this.store(s).set(k,v);return k;},
      del:async(s,k)=>{this.store(s).delete(k);},keys:async s=>Array.from(this.store(s).keys()),
      all:async s=>Array.from(this.store(s).values()),clear:async s=>{this.store(s).clear();},
      bulk:async(s,pairs)=>{for(const [k,v] of pairs)this.store(s).set(k,v);},
      catalog:async()=>{throw Error('External catalogs disabled in preview');},r2Catalog:async()=>{throw Error('External catalogs disabled in preview');}
    });
    SET.listZoom=Object.assign({},SET.listZoom,{files:1,album_files:3});
    SourceLibrary.load=()=>{SourceLibrary.flags={local:true,drive:false,r2:false,server:false};};
    SourceLibrary.save=()=>{};SourceLibrary.load();
    DrawerCast.install=()=>{};DrawerCast.restoreConfig=()=>null;DrawerCast.connect=async()=>false;DrawerCast.show=()=>this.notice();
    for(const source of [DriveSource,R2Source]){
      source.install=async()=>{source.status='Unavailable in offline preview';};
      source.connect=async()=>false;source.show=()=>this.notice();source.schedule=()=>{};source.scheduleManifestCheck=()=>{};
    }
    DriveSource.pumpTags=()=>{};DriveSource.ensureMetadata=async()=>{};
    const installSources=MusicSources.install.bind(MusicSources);
    MusicSources.install=()=>{installSources();MusicSources.names.local='Fixture library';};
    const setEnabled=MusicSources.setEnabled.bind(MusicSources);
    MusicSources.setEnabled=(kind,on)=>{if(kind!=='local'){this.notice();return;}setEnabled(kind,on,false);};
    const sourceStatus=MusicSources.status.bind(MusicSources);
    MusicSources.status=kind=>kind==='local'?allTracks(true).length+' fictional placeholder tracks':kind==='drive'||kind==='r2'||kind==='server'?'Disabled in offline preview':sourceStatus(kind);
    MusicSources.renderLocal=body=>{
      body.append(el('div','native-note','Fictional placeholder files only. Playback progress is simulated and silent. Changes last until you reopen this file.'));
      const reset=el('button','btn','Reset preview');reset.onclick=()=>this.reset(60);body.append(reset);
    };
    getFileFor=async track=>{
      if(!track?.preview)return null;this.waveform(track);
      return {__previewTrack:track,name:baseName(track.path),size:0,type:'application/x-poweramp-placeholder'};
    };
    audioSource=file=>'preview:'+file.__previewTrack.id;
    const art=getArtURL;getArtURL=async(t,small)=>t?.preview&&!t.customArt?t.coverURL:art(t,small);
    Engine.ensureCtx=()=>null;Engine.updateMediaSession=()=>{};
    const renderMeta=UI.renderMeta.bind(UI);UI.renderMeta=(...args)=>{renderMeta(...args);const label=document.getElementById('outinfo-txt');if(label)label.textContent='SIMULATED · NO AUDIO';};
    // A waveform for a later placeholder is created before the unchanged loader runs.
    const load=Waveform.load.bind(Waveform);Waveform.load=track=>{if(track?.preview)this.waveform(track);return load(track);};
    for(const id of ['pick-files','pick-dir','pick-img','pick-zip','pick-json']){
      const input=document.getElementById(id);input?.addEventListener('click',e=>{e.preventDefault();e.stopImmediatePropagation();this.notice();},true);
    }
    addFiles=async()=>this.notice();linkFolder=async()=>this.notice();
    wakeLock=async()=>{};
    renderStorage=async body=>{body.innerHTML='';body.append(el('div','native-note','Preview storage is isolated session-only memory. No real library or cached audio is read or written. Reopening the file resets everything.'));};
    const share=Selection.share;Selection.share=async t=>t?.preview?this.notice():share.call(Selection,t);
    exportTrack=async()=>this.notice();
    this.seed(60);
    // Chrome may omit the post-drag compatibility click. Reuse the app's
    // touch/pen release owner, including travel/cancel and duplicate guards.
    const help=document.getElementById('preview-help');bindTapButton(help,()=>this.help());
    bindTapButton(document.getElementById('preview-reset'),()=>this.reset(60));
    bindTapButton(document.getElementById('preview-size'),()=>this.reset(this.count===5000?60:5000));
    document.addEventListener('click',e=>{
      const anchor=e.target.closest('a[href]');if(!anchor)return;
      const href=anchor.getAttribute('href')||'';if(!href.startsWith('#')&&!href.startsWith('blob:')&&!href.startsWith('data:')){e.preventDefault();e.stopImmediatePropagation();this.notice();}
    },true);
  },
  finish(){
    this.defaults=JSON.parse(JSON.stringify(SET));this.nativeDefaults=JSON.parse(JSON.stringify(NativeSettings.values));this.presetDefaults=JSON.parse(JSON.stringify(EQ.userPresets||[]));this.ready=true;this.updateToolbar();Search.run();
    document.body.classList.add('offline-ui-preview');window.powerampPreview=this;
    document.getElementById('preview-error').hidden=true;
    if(__previewHistoryUnavailable)document.getElementById('preview-hint').textContent='Use the app’s Back controls; this file cannot create browser history';
  },
  updateToolbar(){
    document.getElementById('preview-count').textContent=this.count.toLocaleString()+' tracks';
    const size=document.getElementById('preview-size');size.textContent=this.count===5000?'60 tracks':'5,000 tracks';size.setAttribute('aria-pressed',String(this.count===5000));
  },
  restoreDefaults(){
    // Options created after boot must disappear too, rather than survive an
    // Object.assign reset as stale category preferences.
    for(const key of Object.keys(SET))delete SET[key];
    Object.assign(SET,JSON.parse(JSON.stringify(this.defaults)));
    NativeSettings.values=JSON.parse(JSON.stringify(this.nativeDefaults));
    NativeSettings.scrolls={};NativeSettings.searching=false;
  },
  clearViewContext(){
    Views.stack=[];Views.currentSpec=null;Views.currentData=null;Views.job++;
    Nav.lastLibrary='library';Settings.stack=['root'];
    const body=document.getElementById('list-body'),fabs=document.getElementById('list-fabs');
    if(body){TrackWindow.clean(body);if(typeof artObserver!=='undefined')for(const art of body.querySelectorAll?.('[data-art]')||[])artObserver?.unobserve(art);body.innerHTML='';body.scrollTop=0;body.__referenceHeader=null;body.__referenceActions=null;}
    if(fabs){fabs.innerHTML='';fabs.hidden=true;fabs.inert=true;fabs.__referenceVisible=false;}
    const categories=document.getElementById('lib-cats');if(categories)categories.scrollTop=0;
    if(typeof Search!=='undefined'){
      Search.filter='All';Search.sections=[];Search.history=[];
      const query=document.getElementById('q'),results=document.getElementById('q-body'),chips=document.getElementById('q-chips');
      if(query)query.value='';if(chips)chips.scrollLeft=0;
      if(results){TrackWindow.clean(results);if(typeof artObserver!=='undefined')for(const art of results.querySelectorAll?.('[data-art]')||[])artObserver?.unobserve(art);results.innerHTML='';results.scrollTop=0;}
    }
    if(typeof EQ!=='undefined'){EQ.tab='eq';EQ.userPresets=JSON.parse(JSON.stringify(this.presetDefaults));const bands=document.getElementById('bands');if(bands)bands.scrollLeft=0;}
    if(typeof LibraryPageHistory!=='undefined'){LibraryPageHistory.entries=[];LibraryPageHistory.index=-1;LibraryPageHistory.seed();}
  },
  async reset(count=60){
    if(!this.ready)return;
    this.ready=false;
    try{
      PreviewDiagnostics.stop('fixture reset');InputLifecycle.cancel();if(typeof LibraryPageMotion!=='undefined')LibraryPageMotion.abort();PlaybackTransitions.cancel();Selection.exit();Sheets.close();Engine.stop();
      if(UI.vizFull)toggleVizFull(false);
      this.clearViewContext();
      Engine._playRequest=(Engine._playRequest||0)+1;Engine._loadingRequest=null;Engine._pendingSeek=null;Engine._resumePosition=null;Engine.preloadId=null;Engine.xfading=false;
      clearTimeout(Engine.sleepTimer);clearTimeout(Engine.fadeTimer);Engine.sleepAt=0;
      LIB.ids=[];LIB.map.clear();FILES.clear();this.stores.clear();localStorage.clear();
      this.restoreDefaults();SourceLibrary.load();
      this.seed(count);await loadLibrary();await Playlists.load();await Bookmarks.load();
      Engine.queue=allTracks();Engine.buildOrder();Engine.pos=0;Engine.current=Engine.queue[0];Engine.dur=Engine.current.dur;
      Engine.el().src=audioSource(await getFileFor(Engine.current));Engine.playing=false;
      // A fixture reset replaces track identity, so it has no old scene to
      // morph. Ordinary taps and swipes retain the normal shared transition.
      const instant=UI.instantNav;UI.instantNav=true;
      try{Nav.go('player',false);}finally{UI.instantNav=instant;}
      NativeSettings.apply();applySettings();
      await UI.renderNowPlaying(Engine.current);UI.renderPlayState();UI.renderToggles();UI.renderProgress();Views.refreshAll();Search.renderChips();Search.run();Settings.render();EQ.render();
      this.ready=true;this.updateToolbar();toast(count===5000?'5,000 fictional tracks · silent UI preview':'Preview reset · 60 fictional tracks');
    }catch(error){this.fail(error);}
  },
  help(){
    dialog('Offline UI Preview v9','<p>Fictional placeholder songs, artwork, playlists, and queue. Play, pause, seek, track changes, and progress are simulated. No sound is generated.</p><p>Drag up from the mini player to grow the same cover, title and controls into the full player. Drag down to reverse it, including halfway through a transition.</p><p>In library pages, swipe right to the previously visited page and left to return forward. Vertical scrolling stays native. Try top versus scrolled action buttons, the alphabet rail, album pages and List Options. “5,000 tracks” exercises the large-library renderer.</p><p>Optional diagnostics measures callback gaps and gesture outcomes for 30 seconds. It is off by default, stays in this file, and sends nothing. These callback gaps are not touch latency or display-frame measurements.</p><p>Nothing connects to your accounts or touches the real app’s library. Changes last only while this file is open. Reset restores the fixture.</p><p>If Android opens a file viewer, choose Open with Chrome. Use in-app Back if this local file does not support browser history.</p>',[{label:'Measure 30 seconds',fn:()=>PreviewDiagnostics.start()},{label:'Show diagnostics',fn:()=>PreviewDiagnostics.show()},{label:'Close'}]);
  },
  fail(error){
    console.error('Offline UI preview could not start',error);
    const panel=document.getElementById('preview-error');panel.hidden=false;
    panel.textContent='This file could not start: '+(error?.message||String(error))+'. Open the downloaded HTML directly in Chrome rather than a file-preview viewer.';
  }
};
// Optional, bounded phone feedback aid. No listeners or animation callback run
// until requested; no layout reads, console stream, storage or networking.
const PreviewDiagnostics={
  active:false,frame:0,started:0,last:0,gaps:[],gapCursor:0,count:0,sum:0,max:0,over33:0,over50:0,events:[],handlers:[],lastOwner:'',result:null,wrappers:[],contexts:[],operationFrames:[],operations:new Map(),longOperations:[],longGaps:[],phaseGaps:new Map(),contactSamples:new Map(),lastPhase:'idle',
  snapshot(){return {preview:'v9',source:document.querySelector('meta[name="poweramp-preview-source-sha256"]')?.content||'',tracks:Preview.count,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},settings:{animations:SET.animations,playerLayout:SET.playerLayout,bgBlur:SET.bgBlur,vizOnPlayer:SET.vizOnPlayer,listZoom:JSON.parse(JSON.stringify(SET.listZoom||{})),headerButtons:NativeSettings.values.list_header_buttons}};},
  owner(){
    const gesture=InputLifecycle.gesture,library=LibraryPageMotion.state,scene=ScreenDrag.state||ScreenDrag.settling;
    return {screen:Nav.cur,owner:gesture?.node?.id||(library?'library-page-motion':scene?.morph?'shared-player':scene?'screen-scene':'none'),phase:gesture?.phase||(LibraryPageMotion.finish?.pending||ScreenDrag.settling?'settle':library||scene?'drag':'idle'),historyIndex:LibraryPageHistory.index,historyVisits:LibraryPageHistory.entries.length,version:InputLifecycle.version,scene:scene?.morph?'shared-player':scene?'screen-scene':null,scene_phase:scene?ScreenDrag.phase:null,scene_progress:scene?.morph?Math.round(scene.morph.p*1000)/1000:null,direction:scene?.morph?(scene.morph.opening?'expand':'collapse'):null};
  },
  phase(){
    if(this.contexts.length)return this.contexts.at(-1);
    const scene=ScreenDrag.state||ScreenDrag.settling;
    if(scene?.morph)return 'shared:'+ScreenDrag.phase+':'+(scene.morph.opening?'expand':'collapse');
    if(scene)return 'scene:'+ScreenDrag.phase;
    if(LibraryPageMotion.state)return 'library:'+(LibraryPageMotion.finish?.pending?'settle':'drag');
    return 'idle';
  },
  installMeasurements(){
    const shared=typeof SharedPlayerMotion==='undefined'?null:SharedPlayerMotion,ui=typeof UI==='undefined'?null:UI;
    const targets=[[shared,'create','shared.create','setup'],[shared,'clone','shared.clone'],[shared,'snapshotPlan','shared.snapshotPlan'],[shared,'snapshotKeys','shared.snapshotKeys'],[shared,'snapshotCSS','shared.snapshotCSS'],[shared,'copyCanvas','shared.copyCanvas'],[shared,'consumeAppearance','shared.appearance'],[shared,'paint','shared.paint'],[shared,'refreshDynamic','shared.dynamic'],[shared,'refreshBackground','shared.background'],[shared,'settle','shared.settle'],[shared,'clean','shared.clean','cleanup'],[LibraryPageHistory,'save','history.save'],[LibraryPageMotion,'capture','history.capture'],[ui,'fitPlayer','player.fit'],[ui,'drawViz','player.draw'],[Nav,'go','navigation.go']];
    for(const [object,key,label,stage] of targets){
      if(typeof object?.[key]!=='function')continue;const original=object[key],diagnostics=this;
      const wrapper=function(...args){
        if(!diagnostics.active)return original.apply(this,args);
        const phase=stage?'shared:'+stage+':'+(key==='create'?(args[0]?.target==='player'?'expand':'collapse'):(args[0]?.opening?'expand':'collapse')):diagnostics.phase(),at=performance.now();
        if(stage)diagnostics.contexts.push(phase);
        const frame={nested_ms:0};diagnostics.operationFrames.push(frame);
        if(key==='settle')diagnostics.record('motion-settle',{direction:args[0]?.opening?'expand':'collapse',from:args[0]?.p,to:args[1],planned_ms:args[2]});
        try{const result=original.apply(this,args);if(key==='snapshotPlan')diagnostics.record('snapshot-plan',{active:!!result});if(key==='consumeAppearance')diagnostics.record('appearance-cache',{mode:SharedPlayerMotion.captureMode,...SharedPlayerMotion.appearanceStats});return result;}finally{
          if(stage)diagnostics.contexts.pop();const elapsed=Math.max(0,performance.now()-at),self=Math.max(0,elapsed-frame.nested_ms),id=label+'|'+phase;
          diagnostics.operationFrames.pop();const parent=diagnostics.operationFrames.at(-1);if(parent)parent.nested_ms+=elapsed;
          const value=diagnostics.operations.get(id)||{operation:label,phase,calls:0,total_ms:0,self_ms:0,max_ms:0,max_self_ms:0,over_8ms:0};
          value.calls++;value.total_ms+=elapsed;value.self_ms+=self;value.max_ms=Math.max(value.max_ms,elapsed);value.max_self_ms=Math.max(value.max_self_ms,self);if(elapsed>=8)value.over_8ms++;diagnostics.operations.set(id,value);
          if(elapsed>=8){if(diagnostics.longOperations.length===60)diagnostics.longOperations.shift();diagnostics.longOperations.push({operation:label,phase,at_ms:Math.round(at-diagnostics.started),duration_ms:Math.round(elapsed*10)/10});}
        }
      };object[key]=wrapper;this.wrappers.push([object,key,original,wrapper]);
    }
  },
  restoreMeasurements(){for(const [object,key,original,wrapper] of this.wrappers)if(object[key]===wrapper)object[key]=original;this.wrappers=[];this.contexts=[];this.operationFrames=[];},
  record(type,detail={}){if(!this.active)return;if(this.events.length===80)this.events.shift();this.events.push({ms:Math.round(performance.now()-this.started),type,...detail});},
  observe(){if(!this.active)return;const owner=this.owner(),key=JSON.stringify({...owner,scene_progress:undefined});if(key!==this.lastOwner){this.lastOwner=key;this.record('owner',owner);}},
  start(){
    if(!Preview.ready)return;this.stop('restarted');this.active=true;this.started=performance.now();this.last=0;this.gaps=[];this.gapCursor=0;this.count=this.sum=this.max=this.over33=this.over50=0;this.events=[];this.lastOwner='';this.result=null;this.initial=this.snapshot();this.operations=new Map();this.longOperations=[];this.longGaps=[];this.phaseGaps=new Map();this.contactSamples=new Map();this.contexts=[];this.operationFrames=[];this.lastPhase='idle';this.installMeasurements();
    const help=document.getElementById('preview-help');if(help){help.textContent='●';help.title='Diagnostics recording for 30 seconds';}
    for(const type of ['pointerdown','pointerup','pointercancel','lostpointercapture','keydown']){
      const fn=e=>{
        const x=Number.isFinite(e.clientX)?e.clientX:null,y=Number.isFinite(e.clientY)?e.clientY:null,id=e.pointerId;
        if(type==='pointerdown')this.contactSamples.set(id,{x,y,lastX:x,lastY:y,moves:0,travel:0});
        const sample=this.contactSamples.get(id),detail={target:e.target?.id||e.target?.tagName||'',pointerType:e.pointerType||''};
        if(sample&&x!==null&&y!==null&&sample.x!==null&&sample.y!==null)sample.travel=Math.max(sample.travel,Math.hypot(x-sample.x,y-sample.y));
        if(type!=='keydown'){detail.x=x;detail.y=y;detail.pointer=id;if(sample){detail.moves=sample.moves;detail.dx=x===null||sample.x===null?null:Math.round(x-sample.x);detail.dy=y===null||sample.y===null?null:Math.round(y-sample.y);detail.travel=Math.round(sample.travel);}}
        if(type==='pointerup'||type==='pointercancel')this.contactSamples.delete(id);
        this.record(type,detail);
      };
      document.addEventListener(type,fn,true);this.handlers.push([document,type,fn,true]);
      // Native event dispatch may checkpoint microtasks between listeners.
      // Observe at bubble after the app target handlers, with RAF fallback
      // when an action intentionally stops propagation.
      const observed=()=>this.observe();document.addEventListener(type,observed,false);this.handlers.push([document,type,observed,false]);
    }
    const move=e=>{const sample=this.contactSamples.get(e.pointerId);if(!sample)return;sample.moves++;sample.lastX=e.clientX;sample.lastY=e.clientY;if(Number.isFinite(sample.x)&&Number.isFinite(sample.y))sample.travel=Math.max(sample.travel,Math.hypot(e.clientX-sample.x,e.clientY-sample.y));};document.addEventListener('pointermove',move,true);this.handlers.push([document,'pointermove',move]);
    const visibility=()=>{if(document.hidden)this.stop('page hidden');};document.addEventListener('visibilitychange',visibility,true);this.handlers.push([document,'visibilitychange',visibility]);
    const tick=now=>{
      if(!this.active)return;
      if(this.last){const gap=Math.max(0,now-this.last);this.count++;this.sum+=gap;this.max=Math.max(this.max,gap);if(gap>33)this.over33++;if(gap>50)this.over50++;
        if(this.gaps.length<600)this.gaps.push(gap);else this.gaps[this.gapCursor++%600]=gap;
        const key=this.lastPhase,value=this.phaseGaps.get(key)||{phase:key,samples:0,total_ms:0,max_ms:0,over_33ms:0,over_50ms:0};value.samples++;value.total_ms+=gap;value.max_ms=Math.max(value.max_ms,gap);if(gap>33)value.over_33ms++;if(gap>50)value.over_50ms++;this.phaseGaps.set(key,value);
        if(gap>33){if(this.longGaps.length===60)this.longGaps.shift();this.longGaps.push({at_ms:Math.round(now-this.started),gap_ms:Math.round(gap*10)/10,from_phase:key,to_phase:this.phase()});}
      }
      this.last=now;this.lastPhase=this.phase();this.observe();if(now-this.started>=30000){this.stop('30 seconds elapsed');toast('Diagnostics ready · open ? → Show diagnostics');return;}
      this.frame=requestAnimationFrame(tick);
    };
    this.observe();this.frame=requestAnimationFrame(tick);toast('Recording 30 seconds · try the laggy gesture · no data is sent',4500);
  },
  stop(reason='stopped'){
    if(!this.active)return;this.observe();this.active=false;this.restoreMeasurements();this.contactSamples.clear();cancelAnimationFrame(this.frame);this.frame=0;
    for(const [node,type,fn,capture=true] of this.handlers)node.removeEventListener(type,fn,capture);this.handlers=[];
    const sorted=this.gaps.slice().sort((a,b)=>a-b),round=value=>Math.round(value*10)/10,percentile=f=>sorted.length?round(sorted[Math.min(sorted.length-1,Math.floor((sorted.length-1)*f))]):null;
    this.result={...this.initial,elapsed_ms:Math.round(performance.now()-this.started),stop:reason,metric:'requestAnimationFrame callback gaps, not display frames or input latency',raf_gap_ms:{samples:this.count,recent_samples:sorted.length,mean:this.count?round(this.sum/this.count):null,p50_recent:percentile(.5),p95_recent:percentile(.95),max:round(this.max),over_33ms:this.over33,over_50ms:this.over50},final:this.owner(),events:this.events.slice(),phase_gap_ms:[...this.phaseGaps.values()].map(v=>({phase:v.phase,samples:v.samples,mean:round(v.total_ms/v.samples),max:round(v.max_ms),over_33ms:v.over_33ms,over_50ms:v.over_50ms})),long_gaps:this.longGaps.slice(),operation_timing_note:'Synchronous inclusive function time. Nested durations overlap and must not be added together. Self time excludes instrumented child calls, including recursive calls; it is not browser CPU time. Gap phase endpoints can span setup or another phase; they do not prove GPU/display latency.',operations:[...this.operations.values()].map(v=>({...v,total_ms:round(v.total_ms),self_ms:round(v.self_ms),mean_ms:round(v.total_ms/v.calls),max_ms:round(v.max_ms),max_self_ms:round(v.max_self_ms)})),long_operations:this.longOperations.slice()};
    const help=document.getElementById('preview-help');if(help){help.textContent='?';help.title='About this offline preview';}
  },
  show(){
    this.stop('opened report');
    if(!this.result){toast('No diagnostics recorded yet · open ? → Measure 30 seconds');return;}
    const text=JSON.stringify(this.result,null,2);
    dialog('Preview diagnostics','<p>Local callback-gap and gesture report only. Long-press the text to select and copy it. Nothing is sent automatically.</p><textarea id="preview-diagnostics-report" readonly aria-label="Local preview diagnostic report" style="width:100%;height:42vh;user-select:text;-webkit-user-select:text;font:11px/1.4 monospace;padding:12px;border:1px solid var(--line);border-radius:12px">'+esc(text)+'</textarea>',[{label:'Close'}]);
  }
};
Preview.prepare();
function previewBoot(){Promise.resolve().then(boot).then(()=>Preview.finish()).catch(error=>Preview.fail(error));}
`;

const previewStyles=String.raw`
#preview-toolbar{position:fixed;inset:0 0 auto;z-index:1000;height:28px;display:flex;align-items:center;gap:6px;padding:0 6px;background:#181613;color:#d7d0c8;font:10px/1.2 system-ui,sans-serif;border-bottom:1px solid #4a4035;touch-action:manipulation}
#preview-toolbar .preview-label{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#preview-toolbar button{font:inherit;color:#e6d6c5;padding:4px 5px;border:1px solid #625242;border-radius:4px;background:#2e2720;min-height:22px;touch-action:manipulation}
#preview-toolbar button:focus-visible{outline:2px solid #eaa565;outline-offset:1px}
#preview-toolbar #preview-count{font-size:9px;color:#bfb4a8}
body #app{top:28px}
#preview-error{position:fixed;inset:38px 10px auto;z-index:1002;padding:16px;background:#382018;border:1px solid #c16e45;color:#fff;font:14px/1.5 system-ui,sans-serif;white-space:normal}
#preview-error[hidden]{display:none}
#preview-hint{position:fixed;top:30px;left:6px;right:6px;z-index:1001;font:10px/1.3 system-ui,sans-serif;pointer-events:none;color:#e9bc95;background:#211a16}
#preview-hint:empty{display:none}
`;
const toolbar=`<aside id="preview-toolbar" aria-label="Offline UI preview controls"><span class="preview-label">UI preview v9 · simulated · no audio</span><span id="preview-count">60 tracks</span><button id="preview-size" aria-pressed="false" title="Switch between 60 and 5,000 fictional tracks">5,000 tracks</button><button id="preview-reset">Reset</button><button id="preview-help" aria-label="About this offline preview">?</button></aside><div id="preview-hint" role="status"></div><div id="preview-error" role="alert">Starting offline UI preview… If this stays visible, open the downloaded HTML directly in Chrome.</div>`;
const csp="default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline'; img-src data: blob:; media-src blob: data:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

const once=(source,needle,replacement,label)=>{
  const count=source.split(needle).length-1;
  if(count!==1)throw Error(`Expected one ${label} anchor, found ${count}; source changed, review preview builder`);
  return source.replace(needle,()=>replacement);
};
const stripExports=source=>source.replace(/^export\s+(?=(?:const|let|function|class)\b)/gm,'');
export function classicRuntime({analysis,core,player}){
  const coreImport=/^import\s+\{analysisForTrack\}\s+from\s+['"]\.\/audio-analysis\.js['"];?\s*$/m;
  if(!coreImport.test(core))throw Error('Audio core analysis import changed; review preview builder');
  core=stripExports(core.replace(coreImport,''));
  const playerImport=/^import\s+\{([^}]+)\}\s+from\s+['"]\.\/audio-core\.js['"];?\s*$/m;
  const imported=player.match(playerImport)?.[1];
  if(!imported||!/^[\w\s,]+$/.test(imported))throw Error('Player audio-core import changed; review preview builder');
  const deps=`const {${imported}}=(()=>{\nconst {analysisForTrack}=(()=>{\n${stripExports(analysis)}\nreturn {analysisForTrack};\n})();\n${core}\nreturn {${imported}};\n})();\n`;
  player=player.replace(playerImport,'');
  // Dynamic sources are unreachable and carry no module/network prerequisites.
  player=player.replace(/\bawait import\(/g,'await __offlineImport(').replace(/\bwindow\.open\(/g,'previewOpen(');
  player=once(player,"'use strict';",`'use strict';\n${previewPrelude}`,'player strict-scope');
  const bootAnchor="if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot);\nelse boot();";
  player=once(player,bootAnchor,`${previewHooks}\nif(document.readyState==='loading') document.addEventListener('DOMContentLoaded',previewBoot);\nelse previewBoot();`,'boot');
  const runtime=deps+player;
  if(/(^|\n)\s*(?:import|export)\s/.test(runtime)||/(?<![\w.])import\s*\([^()\n]*\)(?!\s*\{)/.test(runtime))throw Error('Unbundled module dependency in preview');
  new Script(runtime,{filename:'Poweramp-UI-Preview.inline.js'});
  return runtime;
}

export async function buildPreview(output=defaultOutput,{inputs=null}={}){
  const inputNames=['index.html','audio-analysis.js','audio-core.js','player.js'];
  const [htmlInput,analysis,core,player]=inputs||await Promise.all(inputNames.map(file=>readFile(resolve(appRoot,file),'utf8')));
  const runtime=classicRuntime({analysis,core,player});
  const sourceHash=createHash('sha256').update([htmlInput,analysis,core,player].join('\0')).digest('hex');
  // Never carry a personalized embedded server credential into the preview.
  const safeInput=htmlInput.replace(/<script\b(?=[^>]*\bid=["']drawercast-defaults["'])[^>]*>[\s\S]*?<\/script>\s*/gi,'');
  let html=once(safeInput,'<title>Poweramp</title>','<title>Poweramp · Offline UI Preview v9</title>','title');
  html=once(html,'<meta charset="utf-8">',`<meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="${csp}">\n<meta name="poweramp-preview" content="fictional UI fixtures; simulated playback; no audio">\n<meta name="poweramp-preview-source-sha256" content="${sourceHash}">`,'charset');
  html=once(html,'</head>',`<style>${previewStyles}</style>\n</head>`,'head');
  const bodyTag=html.match(/<body\b[^>]*>/)?.[0];if(!bodyTag)throw Error('Missing body');
  html=once(html,bodyTag,`${bodyTag}\n${toolbar}`,'body');
  const scriptRegex=/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']\.\/player\.js[^"']*["'][^>]*><\/script>/;
  if(!scriptRegex.test(html))throw Error('Player module script changed; review preview builder');
  html=html.replace(scriptRegex,()=>`<script>${runtime.replace(/<\/script/gi,'<\\/script')}</script>`);
  if(/<script\b[^>]*\bsrc\s*=/i.test(html)||/<link\b[^>]*\bhref\s*=/i.test(html))throw Error('External HTML asset in preview');
  if(/(?:src|href)=["'](?:https?:)?\/\//i.test(html))throw Error('External HTML source in preview');
  const css=[...html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map(m=>m[1]).join('\n');
  const externalCSS=[...css.matchAll(/url\(\s*["']?([^)'"\s]+)/g)].filter(([,url])=>!url.startsWith('data:')&&!url.startsWith('#')&&!url.startsWith('var('));
  if(externalCSS.length)throw Error('External CSS asset in preview: '+externalCSS[0][1].slice(0,60));
  output=resolve(output);if(extname(output).toLowerCase()!=='.html')output=resolve(output,'Poweramp-UI-Preview.html');
  await mkdir(dirname(output),{recursive:true});await writeFile(output,html,'utf8');
  return {output,bytes:Buffer.byteLength(html),sourceHash,sha256:createHash('sha256').update(html).digest('hex'),runtimeBytes:Buffer.byteLength(runtime),verification:{classicJavaScriptParsed:true,externalAssets:0,moduleImports:0,audio:'simulated UI only; no audio files or synthesis',storage:'session-only isolated memory',network:'CSP denied; fetch/import/source hooks disabled'}};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{console.log(JSON.stringify(await buildPreview(process.argv[2]),null,2));}catch(error){console.error(error);process.exitCode=1;}
}
