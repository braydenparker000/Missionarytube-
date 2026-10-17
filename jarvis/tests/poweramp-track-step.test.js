import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function stepHarness(){
  const calls=[],tracks=[{id:'A'},{id:'B'},{id:'C'}];let time=20;
  const Engine={queue:tracks,order:[0,1,2],current:tracks[1],pos:1,_playRequest:7,playing:false,time:()=>time,wantsPlayback(){return this.playing;},seek:t=>calls.push(['seek',t]),playIndex(i,autoplay){calls.push(['play',i,autoplay]);this.current=this.queue[i];this.pos=this.order.indexOf(i);}};
  const PlaybackQueue={pending:[],active:false,resume:null,shouldStart:()=>false,tracks:()=>[],begin:(...args)=>calls.push(['queue-start',...args]),finish:(...args)=>calls.push(['queue-finish',...args])};
  const ctx=vm.createContext({Engine,PlaybackQueue,SET:{previousRestarts:true},UI:{},LIB:{map:new Map(tracks.map(t=>[t.id,t]))},nativeValues:()=>({queue_end:1}),sourceTrackEnabled:t=>!!t});
  vm.runInContext(section('function restoreTrackStepOrigin(','/* Shared finger tracking:')+'\nglobalThis.resolve=resolveTrackStep;globalThis.commit=commitTrackStep;globalThis.peek=peekTrack;',ctx);
  return {ctx,Engine,PlaybackQueue,calls,tracks,setTime:t=>{time=t;}};
}
test('previous preview and commit restart restored/unloaded logical time without choosing another song',()=>{
  const h=stepHarness(),s=h.ctx.resolve(-1);assert.equal(s.kind,'restart');assert.equal(h.ctx.peek(-1).id,'B');
  assert.equal(h.ctx.commit(s),true);assert.deepEqual(h.calls,[['seek',0]]);assert.equal(h.Engine.current.id,'B');assert.equal(h.ctx.UI.artDir,0);
});
test('previous action remains the exact preview when logical time crosses the restart threshold',()=>{
  const h=stepHarness();h.setTime(2.9);const s=h.ctx.resolve(-1);h.setTime(3.2);
  assert.equal(s.track.id,'A');h.ctx.commit(s);assert.deepEqual(h.calls,[['play',0,false]]);
});
test('manual next and previous follow the selected occurrence and wrap at either end',()=>{
  for(const [pos,delta,index] of [[0,-1,2],[2,1,0],[1,1,2]]){
    const h=stepHarness();h.setTime(0);h.Engine.pos=pos;h.Engine.current=h.tracks[pos];const s=h.ctx.resolve(delta);
    h.ctx.commit(s);assert.deepEqual(h.calls,[['play',index,false]]);assert.equal(h.Engine.pos,index);
  }
});
test('swipe commit preserves playback intent rather than starting a paused selection',()=>{
  const h=stepHarness();h.Engine.playing=true;h.ctx.commit(h.ctx.resolve(1));assert.deepEqual(h.calls,[['play',2,true]]);
});
test('explicit queue preview and commit use the same pending first track',()=>{
  const h=stepHarness(),q={id:'Q'};h.PlaybackQueue.pending=['Q'];h.PlaybackQueue.shouldStart=()=>true;h.PlaybackQueue.tracks=()=>[q];
  const s=h.ctx.resolve(1);assert.equal(s.kind,'queue-start');assert.equal(s.track.id,'Q');h.ctx.commit(s);assert.deepEqual(h.calls,[['queue-start',false,0,false]]);
});
test('explicit queue return preview skips removed or disabled saved songs',()=>{
  const h=stepHarness();h.Engine.pos=2;h.Engine.current=h.tracks[2];h.PlaybackQueue.active=true;h.PlaybackQueue.resume={ids:['gone','B','C'],order:[0,1,2],pos:0};
  const s=h.ctx.resolve(1);assert.equal(s.kind,'queue-finish');assert.equal(s.track.id,'B');h.ctx.commit(s);assert.deepEqual(h.calls,[['queue-finish',false]]);
});
test('looping explicit queue previews its first occurrence',()=>{
  const h=stepHarness();h.Engine.pos=2;h.PlaybackQueue.active=true;h.ctx.nativeValues=()=>({queue_end:0});assert.equal(h.ctx.resolve(1).track.id,'A');
});
test('a queue return with no surviving target previews no artwork but can stop through its exact action',()=>{
  const h=stepHarness();h.Engine.pos=2;h.PlaybackQueue.active=true;h.PlaybackQueue.resume={ids:['gone'],order:[0],pos:0};
  const s=h.ctx.resolve(1);assert.equal(s.track,null);assert.equal(h.ctx.commit(s),true);assert.deepEqual(h.calls,[['queue-finish',false]]);
});
test('swipe actions cannot survive newer track, pause, queue or order changes',()=>{
  const modes=['track','request','queue','order','pending','active','resume','length','inplace-order'];
  for(const mode of modes){const h=stepHarness(),s=h.ctx.resolve(1);
    if(mode==='track')h.Engine.current=h.tracks[0];if(mode==='request')h.Engine._playRequest++;if(mode==='queue')h.Engine.queue=h.tracks.slice();if(mode==='order')h.Engine.order=h.Engine.order.slice();
    if(mode==='pending')h.PlaybackQueue.pending.push('Q');if(mode==='active')h.PlaybackQueue.active=true;if(mode==='resume')h.PlaybackQueue.resume={};if(mode==='length')h.Engine.order.push(0);if(mode==='inplace-order')h.Engine.order[2]=0;
    assert.equal(h.ctx.commit(s),false,mode);assert.deepEqual(h.calls,[],mode);
  }
});
test('empty manual navigation is inert',()=>{const h=stepHarness();h.Engine.queue=[];h.Engine.order=[];assert.equal(h.ctx.resolve(1),null);assert.equal(h.ctx.commit(null),false);});
function artHarness(){
  let fetches=0,decodes=0;const requests=[];
  class Image{set src(v){this.url=v;}async decode(){decodes++;if(this.url==='broken')throw Error('bad');}}
  const ctx=vm.createContext({Image,getArtURL:t=>{fetches++;return new Promise(resolve=>requests.push({t,resolve}));},peekTrack:()=>null});
  vm.runInContext(section('const SwipeArt={','const ScreenDrag={')+'\nglobalThis.art=SwipeArt;',ctx);
  return {ctx,requests,counts:()=>({fetches,decodes})};
}
test('neighbor art becomes cached only after a successful decode and concurrent warms coalesce',async()=>{
  const h=artHarness(),t={id:'A',coverURL:'cover-A'},a=h.ctx.art.warm(t),b=h.ctx.art.warm(t);
  assert.equal(a,b);assert.equal(h.ctx.art.cached(t),undefined);h.requests[0].resolve('cover-A');assert.equal(await a,'cover-A');assert.equal(h.ctx.art.cached(t),'cover-A');
  await h.ctx.art.warm(t);assert.deepEqual(h.counts(),{fetches:1,decodes:1});
});
test('missing or broken neighbor art is a stable placeholder rather than an undecoded URL',async()=>{
  for(const url of [null,'broken']){const h=artHarness(),t={id:'A'},p=h.ctx.art.warm(t);h.requests[0].resolve(url);assert.equal(await p,null);assert.equal(h.ctx.art.cached(t),null);}
});
test('a replaced cover invalidates cache and late older artwork cannot overwrite the newer decoded cover',async()=>{
  const h=artHarness(),t={id:'A',coverURL:'old'},old=h.ctx.art.warm(t);t.coverURL='new';const latest=h.ctx.art.warm(t);
  h.requests[1].resolve('new');await latest;h.requests[0].resolve('old');await old;assert.equal(h.ctx.art.cached(t),'new');
});
test('decoded neighbor cache remains bounded',async()=>{
  const h=artHarness();for(let i=0;i<12;i++){const t={id:String(i)},p=h.ctx.art.warm(t);h.requests.at(-1).resolve('cover'+i);await p;}
  assert.equal(h.ctx.art.ready.size,8);assert.equal(h.ctx.art.keys.size,8);
});
function renderHarness({active=false}={}){
  const nodes=new Map(),paint=[],pending=[],track={id:'A',title:'First'};
  const node=id=>{if(!nodes.has(id))nodes.set(id,{id,style:{setProperty(){}},classList:{remove(){},add(){}},innerHTML:'',textContent:''});return nodes.get(id);};
  const UI={setArtEl:(n,url)=>paint.push([n.id,url]),setBackground:url=>paint.push(['background',url]),refreshEmpty(){},fitPlayer(){},renderRating(){},renderMeta(){},renderProgress(){},cancelSeekGesture(){},artTrackId:'old'};
  const ctx=vm.createContext({UI,SharedPlayerMotion:{active:()=>active?{p:.5}:null,setMiniLabel(node,text){node.textContent=text;}},Engine:{current:track,updateMediaSession(){}},Waveform:{load(){}},Views:{refreshQueueOrder(){},markPlaying(){}},Nav:{cur:'player'},SET:{},GestureMotion:{reduced:()=>true},SwipeArt:{cached:()=> 'decoded-A',warm:()=>new Promise(resolve=>pending.push(resolve)),decode:async url=>url,neighbors(){}},getArtURL:async()=> 'thumb-A',requestAnimationFrame:fn=>fn(),setTimeout,document:{},esc:String,trackSub:()=>'',trackArtist:()=>'',$:node});
  const start=source.indexOf('  renderNowPlaying:async function('),end=source.indexOf('  renderRating:',start);
  vm.runInContext('UI.renderNowPlaying='+source.slice(start+'  renderNowPlaying:'.length,end).trim().replace(/,$/,'')+';',ctx);
  return {ctx,UI,track,paint,pending,nodes};
}
test('rendering a committed swipe seeds decoded artwork immediately without clearing it during async lookup',async()=>{
  const h=renderHarness(),p=h.UI.renderNowPlaying(h.track);assert.deepEqual(h.paint,[['#artA','decoded-A'],['#mini-art','decoded-A'],['background','decoded-A']]);
  h.pending[0]('decoded-A');await p;assert.equal(h.paint.filter(([,url])=>url===null).length,0);assert.equal(h.UI.curArtURL,'decoded-A');
});
test('late same-track render work cannot overwrite a newer artwork refresh',async()=>{
  const h=renderHarness(),old=h.UI.renderNowPlaying(h.track),fresh=h.UI.renderNowPlaying(h.track);h.pending[1]('new-A');await fresh;h.pending[0]('old-A');await old;
  assert.equal(h.UI.curArtURL,'new-A');assert.equal(h.paint.some(([,url])=>url==='old-A'),false);
});

// The real shared widgets cannot be hidden by a canonical same-track writer.
test('same-track artwork refresh keeps the actual mini owner visible during a live scene',async()=>{
  const h=renderHarness({active:true}),p=h.UI.renderNowPlaying(h.track);
  assert.equal(h.nodes.get('#mini').hidden,false);h.pending[0]('decoded-A');await p;
  assert.equal(h.nodes.get('#mini').hidden,false);assert.equal(h.UI.curArtURL,'decoded-A');
});
