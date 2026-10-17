import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source=await readFile(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const block=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function harness(saved={}){
  const data=new Map(Object.entries(saved));
  const tracks=[{id:'local',title:'Local',rating:5,plays:3},{id:'drive',source:'drive',remote:true,title:'Drive',rating:4,plays:7},{id:'server',remote:true,title:'Server'}];
  const playlist={ids:tracks.map(t=>t.id)};let stops=0,aborts=0,connections=0;
  const ctx=vm.createContext({LIB:{ids:tracks.map(t=>t.id),map:new Map(tracks.map(t=>[t.id,t]))},
    localStorage:{getItem:k=>data.get(k)||null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)},toast(){},clearTimeout,
    $:()=>null,UI:{renderNowPlaying(){},renderPlayState(){},renderProgress(){}},Views:{refreshAll(){}},
    Engine:{current:tracks[1],queue:tracks.slice(),_playRequest:5,buildOrder(){this.order=this.queue.map((_,i)=>i);},stop(){stops++;this.current=null;this.queue=[];},saveState(){},updateMediaSession(){}},
    R2Source:{status:'Ready',connect(){connections++;},suspend(){aborts++;}},
    DriveSource:{api:{},folder:'folder',tagQueue:[],tagJobs:new Map(),controller:{abort(){aborts++;}},connect(){connections++;}},
    DrawerCast:{suspend(){},connection:{},connect(){connections++;}},PlaybackTransitions:{cancel(){}},
    Playlists:{get:()=>playlist},Bookmarks:{all:()=>playlist.ids},SET:{},trackAlbum:t=>t.album||'Album',trackArtist:t=>t.artist||'Artist',sortNat:(a,b)=>a.localeCompare(b)});
  const policy=block('const SourceLibrary={','async function loadLibrary()');
  const ui=block('const MusicSources={','async function boot()');
  const result=vm.runInContext(policy+ui+'\n({SourceLibrary,MusicSources,allTracks,sourceTrackEnabled})',ctx);
  const build=block('  buildItems:function(spec){','  trackSorter:function()');
  ctx.Views={...ctx.Views,trackSorter:()=>()=>0,groupBy:(tracks)=>tracks,buildItems:vm.runInContext('({'+build+'}).buildItems',ctx)};
  return {...result,ctx,data,tracks,playlist,stops:()=>stops,aborts:()=>aborts,connections:()=>connections};
}
test('source flags migrate legacy Drive disable and persist independently',()=>{
  const h=harness({'drawercast.drive.disabled':'1'});h.SourceLibrary.load();assert.equal(h.SourceLibrary.enabled('drive'),false);assert.equal(h.SourceLibrary.enabled('local'),true);
  h.SourceLibrary.flags.server=false;h.SourceLibrary.save();const restored=harness(Object.fromEntries(h.data));restored.SourceLibrary.load();assert.equal(restored.SourceLibrary.enabled('server'),false);assert.equal(restored.SourceLibrary.enabled('drive'),false);
});
test('disable hides music and playlist results without deleting stored records or playlist IDs',()=>{
  const h=harness();h.MusicSources.setEnabled('drive',false);
  assert.deepEqual(Array.from(h.allTracks(),t=>t.id),['local','server']);assert.equal(h.allTracks(true).length,3);
  assert.deepEqual(h.playlist.ids,['local','drive','server']);assert.equal(h.tracks[1].rating,4);assert.equal(h.tracks[1].plays,7);
  for(const kind of ['all','playlist','bookmarks','albums','artists'])assert.ok(h.ctx.Views.buildItems({kind}).items.every(t=>t.id!=='drive'),kind);
  assert.equal(h.stops(),1);assert.equal(h.aborts(),1);assert.equal(h.ctx.Engine._playRequest,6);
  assert.ok(h.ctx.Engine.queue.every(t=>t.id!=='drive'));
  h.MusicSources.setEnabled('drive',true,false);assert.equal(h.allTracks().length,3);assert.equal(h.ctx.Views.buildItems({kind:'playlist'}).items.length,3);assert.equal(h.connections(),0);
});
test('disabling an unrelated source preserves the current playback request',()=>{
  const h=harness();h.MusicSources.setEnabled('server',false);assert.equal(h.ctx.Engine.current.id,'drive');assert.equal(h.ctx.Engine._playRequest,5);assert.equal(h.stops(),0);
});
test('all sources can be disabled and restored without an empty-library crash or data loss',()=>{
  const h=harness();for(const kind of ['local','drive','server'])h.MusicSources.setEnabled(kind,false);
  assert.equal(h.allTracks().length,0);assert.equal(h.ctx.Engine.current,null);assert.equal(h.allTracks(true).length,3);
  h.MusicSources.setEnabled('local',true);assert.equal(h.ctx.Engine.current.id,'local');assert.equal(h.connections(),0);
});
test('queue selection filters disabled sources while retaining the selected enabled song',()=>{
  const h=harness();h.SourceLibrary.flags.drive=false;
  const body=block('  setQueue:function(list, index, autoplay){','  buildOrder:function()');
  const queue=vm.runInContext('({'+body+'}).setQueue',h.ctx);
  const engine={buildOrder(){this.order=this.queue.map((_,i)=>i);},playIndex(i){this.selected=this.queue[i].id;},saveState(){}};
  queue.call(engine,h.tracks,2,true);assert.equal(engine.selected,'server');assert.deepEqual(Array.from(engine.queue,t=>t.id),['local','server']);
});

test('Drive and R2 switches persist and filter independently, with source-specific playlist IDs',()=>{
  const h=harness({'drawercast.sources.v1':JSON.stringify({drive:false,r2:true,local:false,server:false})});
  h.SourceLibrary.load();const r2={id:'r2_song',source:'r2',remote:true,title:'R2',rating:2};
  h.tracks.push(r2);h.ctx.LIB.ids.push(r2.id);h.ctx.LIB.map.set(r2.id,r2);h.playlist.ids.push(r2.id);
  assert.deepEqual(Array.from(h.allTracks(),t=>t.id),['r2_song']);assert.equal(h.SourceLibrary.kind(r2),'r2');
  h.ctx.Engine.current=r2;h.ctx.Engine.queue=[r2];
  h.MusicSources.setEnabled('drive',true,false);assert.equal(h.ctx.Engine.current,r2);assert.equal(h.stops(),0);
  h.MusicSources.setEnabled('r2',false);assert.equal(h.stops(),1);assert.equal(h.ctx.LIB.map.get(r2.id).rating,2);
  assert.deepEqual(Array.from(h.allTracks(),t=>t.id),['drive']);assert.ok(h.playlist.ids.includes(r2.id));
  const restored=harness(Object.fromEntries(h.data));restored.SourceLibrary.load();
  assert.equal(restored.SourceLibrary.enabled('drive'),true);assert.equal(restored.SourceLibrary.enabled('r2'),false);
});

test('an A15 catalog refresh cannot remove Drive or R2 tracks',async()=>{
  const h=harness(),r2={id:'r2_song',source:'r2',remote:true,title:'R2'};
  h.tracks.push(r2);h.ctx.LIB.ids.push(r2.id);h.ctx.LIB.map.set(r2.id,r2);
  const removed=[];Object.assign(h.ctx,{validId:()=>true,save(){},persistTracks:async()=>{},
    removeTracks:async ids=>{removed.push(...ids);},Nav:{go(){}},cfg:null});
  const ingest=vm.runInContext(block('  async function ingest(data,c){','  function scheduleRetry()')+'\ningest',h.ctx);
  await ingest({apiVersion:1,serverId:'serverID',tracks:[]},{});
  assert.deepEqual(Array.from(removed),['server']);assert.equal(h.ctx.LIB.map.get(r2.id),r2);
  assert.equal(h.ctx.LIB.map.get('drive'),h.tracks[1]);
});

test('disabling Drive during R2 playback preserves the current position in the filtered queue',()=>{
  const h=harness(),r2={id:'r2_song',source:'r2',remote:true,title:'R2'};
  h.tracks.push(r2);h.ctx.LIB.ids.push(r2.id);h.ctx.LIB.map.set(r2.id,r2);
  h.ctx.Engine.queue=h.tracks.slice();h.ctx.Engine.order=[0,1,2,3];h.ctx.Engine.pos=3;h.ctx.Engine.current=r2;
  h.MusicSources.setEnabled('drive',false);
  assert.equal(h.ctx.Engine.queue[h.ctx.Engine.order[h.ctx.Engine.pos]]?.id,r2.id);
  assert.equal(h.ctx.Engine._playRequest,5);assert.equal(h.stops(),0);
});
