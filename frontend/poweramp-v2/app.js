import {PlaybackEngine} from './audio.js';
import {createDemoCatalog,createLocalCatalog} from './sources.js';
import {SceneMotion,attachDrag,clamp} from './motion.js';
import {Waveform} from './waveform.js';
import {readPreferences,savePreferences} from './preferences.js';
import {icon,setIcon} from './icons.js';

const $=id=>document.getElementById(id);
const app=$('app'), audio=$('audio'), preferences=readPreferences();
document.querySelectorAll('[data-icon]').forEach(element=>setIcon(element,element.dataset.icon));
export const engine=new PlaybackEngine(audio);
const waveform=new Waveform($('waveform'));
let source=null, sourceRequest=0, tracks=[], entries=[], mode='library', group=null, ascending=true;
let geometry=null, sceneDragStart=0, sceneDragOrigin=0, seeking=false, seekOrigin=0, activeSeek=null, seekPointer=null, ignoredSeekContact=null;
let oldTrackId=null, oldStatus=null, savedAt=0, rowFrame=0, tickFrame=0, toastTimer=0;
const artCache=new Map();
const time=seconds=>`${Math.floor(Math.max(0,seconds||0)/60)}:${String(Math.floor(Math.max(0,seconds||0)%60)).padStart(2,'0')}`;

function art(track) {
  // All demonstration artwork is original programmatic geometry, not reference artwork.
  const key=track?.source==='demo'?track.id:'local';
  if(artCache.has(key))return artCache.get(key);
  const palettes={ 'demo-01':['#14202a','#6f8f99','#dfac79'], 'demo-02':['#192c29','#6b9181','#d5d7b6'], 'demo-03':['#2c2539','#9c7e9e','#d6afac'],local:['#242429','#666671','#b8b8bf']};
  const [a,b,c]=palettes[key]||palettes.local;
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600"><defs><linearGradient id="sky" x2=".6" y2="1"><stop stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient><radialGradient id="sun"><stop stop-color="${c}"/><stop offset="1" stop-color="${c}" stop-opacity=".1"/></radialGradient></defs><rect width="600" height="600" fill="url(#sky)"/><circle cx="423" cy="180" r="138" fill="url(#sun)"/><circle cx="423" cy="180" r="69" fill="${c}" opacity=".9"/><path d="M0 330 95 267 235 343 349 286 600 370V600H0Z" fill="${a}" opacity=".85"/><path d="M0 416 238 355 600 465V600H0Z" fill="${a}"/><g stroke="${b}" opacity=".5"><path d="M0 453h600M0 477h600M0 510h600M0 550h600M0 596h600"/><path d="m290 410-280 190m280-190L190 600m100-190 90 190m-90-190 270 190"/></g><path d="M50 58h105M50 67h67" stroke="${c}" opacity=".7" stroke-width="2"/></svg>`;
  const url=`url("data:image/svg+xml,${encodeURIComponent(svg)}")`; artCache.set(key,url); return url;
}
function notify(message, duration=3500) {
  clearTimeout(toastTimer);$('status').textContent=message;$('status').hidden=!message;
  if(message&&duration)toastTimer=setTimeout(()=>{$('status').hidden=true;},duration);
}

function measure() {
  const height=app.clientHeight,width=app.clientWidth,nav=$('navbar').getBoundingClientRect(),box=app.getBoundingClientRect();
  const top=parseFloat(getComputedStyle($('player')).top)||0;
  const landscape=width>height*1.2 && height<520;
  const artSize=landscape?Math.min(height-top-(height-(nav.top-box.top))-24,width*.48-16):Math.max(90,Math.min(width-16,height-top-(height-(nav.top-box.top))-224));
  const full={x:landscape?8:(width-artSize)/2,y:top+8,size:artSize};
  const mini={x:10,y:$('mini').offsetTop+10,size:28};
  geometry={full,mini,height,width};
  $('artwork').style.width=`${artSize}px`;$('artwork').style.height=`${artSize}px`;
  $('track-labels').style.top=`${full.y-top+artSize-18}px`;
  $('track-labels').style.left=`${full.x+18}px`;$('track-labels').style.right=`${width-full.x-artSize+18}px`;
  $('track-labels').style.transform='translateY(-100%)';
  $('player-controls').style.top=`${landscape?8:full.y-top+artSize+4}px`;
  $('player-controls').style.left=`${landscape?full.x+artSize+8:8}px`;
  renderScene(motion.progress);waveform.draw();renderRows();
}
function renderScene(p) {
  if(!geometry)return;
  const {full,mini}=geometry;
  const playing=engine.snapshot.status==='playing';
  const rest=playing?1:.975,fullSize=full.size*rest;
  const size=fullSize+(mini.size-fullSize)*p,scale=size/full.size;
  const x=full.x+(full.size-fullSize)/2+(mini.x-full.x-(full.size-fullSize)/2)*p;
  const y=full.y+(full.size-fullSize)/2+(mini.y-full.y-(full.size-fullSize)/2)*p;
  $('artwork').style.transform=`translate(${x}px,${y}px) scale(${scale})`;
  $('artwork').style.borderRadius=`${(18.75+(8-18.75)*p)/scale}px`;
  $('player').style.opacity=String(clamp(1-p*1.8));
  $('player').inert=p>.01;
  $('library').style.opacity=String(p);
  $('library').style.transform=`translateY(${(1-p)*32}px)`;
  $('library').inert=p<.999;
  $('mini').style.opacity=String(clamp((p-.5)*2));$('mini').inert=p<.999;
  app.dataset.scene=p===0?'player':p===1?'library':'transition';
  app.dataset.progress=p.toFixed(4);
  $('nav-library').setAttribute('aria-current',p>.5&&mode!=='search'?'page':'false');
  $('nav-search').setAttribute('aria-current',p>.5&&mode==='search'?'page':'false');
}
export const motion=new SceneMotion(renderScene);
const resize=new ResizeObserver(measure);resize.observe(app);

function route(name,{push=true}={}) {
  const player=name==='player';
  if(!player){mode=name;group=null;$('search-input').value='';refreshLibrary();}
  if(push&&location.hash!==`#${name}`)history.pushState({v2:true},'',`#${name}`);
  motion.settle(player?0:1);
}
addEventListener('popstate',()=>route(location.hash.slice(1)||'player',{push:false}));
function back(){if(motion.target===0)return;if(group){group=null;refreshLibrary();}else if(mode!=='library'){route('library');}else route('player');}
$('back').onclick=back;
$('nav-library').onclick=()=>route(motion.target===1&&mode==='library'?'player':'library');
$('nav-search').onclick=()=>{motion.addEventListener('settled',()=>{if(mode==='search'&&motion.target===1)$('search-input').focus();},{once:true});route('search');};
$('mini-expand').onclick=()=>route('player');
$('queue').onclick=()=>route('queue');
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('menu').open)back();});

function wireSceneDrag(element,isMini) {
  attachDrag(element,{
    enabled:()=>!$('menu').open,
    start:()=>{sceneDragStart=motion.interrupt();sceneDragOrigin=motion.target;},
    move:g=>{
      if(g.axis==='y')motion.set(sceneDragStart+ (isMini?g.dy:-g.dy)/Math.max(180,geometry.height*.55));
      else if(!isMini)$('art-image').style.transform=`translateX(${g.dx*.35}px)`;
    },
    end:g=>{
      $('art-image').style.transform='';
      if(g.cancelled){motion.settle(sceneDragOrigin);return;}
      if(!g.moved){motion.settle(sceneDragOrigin);return;}
      if(g.axis==='x'&&!isMini){if(Math.abs(g.dx)>geometry.width*.2){g.dx<0?engine.next():engine.previous();}motion.settle(sceneDragOrigin);return;}
      if(g.axis==='y'){
        const target=motion.progress>.5?1:0;
        if(target===1){if(sceneDragOrigin===0){mode='library';group=null;refreshLibrary();}}
        if(location.hash!==`#${target===1?mode:'player'}`)history.pushState({v2:true},'',`#${target===1?mode:'player'}`);
        motion.settle(target);
      }
    }
  },{axes:isMini?'y':'xy'});
}
wireSceneDrag($('artwork'),false);wireSceneDrag($('mini-expand'),true);

function toggle(){engine.snapshot.intent==='play'?engine.pause():void engine.play();}
$('play').onclick=toggle;$('mini-play').onclick=toggle;
$('next').onclick=()=>engine.next();$('previous').onclick=()=>engine.previous();
$('repeat').onclick=()=>engine.setRepeat(({off:'all',all:'one',one:'off'})[engine.snapshot.repeat]);
$('shuffle').onclick=()=>engine.setShuffle(!engine.snapshot.shuffle);
// APK directly wires the full play/pause long press to Stop. Hold threshold is V2 provisional.
let holdTimer,held=false,holdOrigin;
$('play').addEventListener('pointerdown',event=>{
  if(!event.isPrimary||event.button!==0)return;held=false;holdOrigin={x:event.clientX,y:event.clientY};
  holdTimer=setTimeout(()=>{held=true;engine.pause();engine.seek(0);notify('Stopped');},550);
});
for(const name of ['pointerup','pointercancel','pointerleave'])$('play').addEventListener(name,()=>clearTimeout(holdTimer));
$('play').addEventListener('pointermove',event=>{if(holdOrigin&&Math.hypot(event.clientX-holdOrigin.x,event.clientY-holdOrigin.y)>8)clearTimeout(holdTimer);});
$('play').addEventListener('click',event=>{if(held){event.stopImmediatePropagation();event.preventDefault();held=false;}},{capture:true});

function finishSeek(cancelled=false){
  if(!activeSeek)return;
  const input=activeSeek,id=seekPointer;
  activeSeek=null;seekPointer=null;seeking=false;$('seek-marker').hidden=true;
  if(id!==null&&input.hasPointerCapture(id))input.releasePointerCapture(id);
  if(cancelled)engine.seek(seekOrigin);
  drawProgress(engine.snapshot.position,engine.snapshot.duration);savePreferences(engine.snapshot);
}
function centeredSeek(event){
  const rect=$('seek').getBoundingClientRect(),fraction=clamp((event.clientX-rect.left)/rect.width);
  const s=engine.snapshot,position=clamp(seekOrigin+(fraction-.5)*s.duration,0,s.duration);
  $('seek-marker').style.left=`${fraction*100}%`;$('seek-marker').hidden=false;
  engine.seek(position);$('seek').value=String(position/s.duration*1000);drawProgress(position,s.duration);
}
for(const id of ['seek','mini-seek']){
  const input=$(id);
  input.addEventListener('pointerdown',event=>{
    if(!event.isPrimary||event.button!==0)return;
    seeking=true;activeSeek=input;seekPointer=event.pointerId;seekOrigin=engine.snapshot.position;
    input.setPointerCapture(event.pointerId);
    if(id==='seek'){event.preventDefault();input.focus({preventScroll:true});centeredSeek(event);}
  });
  input.addEventListener('pointermove',event=>{if(id==='seek'&&activeSeek===input&&event.pointerId===seekPointer){event.preventDefault();centeredSeek(event);}});
  input.addEventListener('input',()=>{
    if(ignoredSeekContact!==null)return;
    if(id==='seek'&&seeking)return;
    const s=engine.snapshot,position=Number(input.value)/1000*s.duration;
    engine.seek(position);drawProgress(position,s.duration);
  });
  input.addEventListener('pointerup',()=>finishSeek(false));
  input.addEventListener('pointercancel',()=>finishSeek(true));
  input.addEventListener('lostpointercapture',()=>finishSeek(true));
  input.addEventListener('change',()=>savePreferences(engine.snapshot));
}
// A multi-contact sequence cannot finish a single-contact action on another control.
const contacts=new Set();let blockedContacts=false;
document.addEventListener('pointerdown',event=>{
  if(event.pointerType!=='touch')return;
  if(contacts.size===0)blockedContacts=false;
  contacts.add(event.pointerId);
  if(contacts.size>1){blockedContacts=true;clearTimeout(holdTimer);finishSeek(true);event.preventDefault();event.stopPropagation();}
},{capture:true});
for(const name of ['pointerup','pointercancel'])document.addEventListener(name,event=>{
  contacts.delete(event.pointerId);if(ignoredSeekContact===event.pointerId)ignoredSeekContact=null;
},{capture:true});
document.addEventListener('click',event=>{if(blockedContacts&&event.detail>0){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
function drawProgress(position,duration) {
  const fraction=duration?clamp(position/duration):0;
  for(const id of ['seek','mini-seek']){
    const input=$(id);if(input!==activeSeek)input.value=String(Math.round(fraction*1000));
    input.setAttribute('aria-valuetext',`${time(position)} of ${time(duration)}`);
  }
  $('mini-seek').style.setProperty('--played',`${fraction*100}%`);
  $('elapsed').textContent=time(position);$('duration').textContent=time(duration);
  waveform.update(engine.snapshot.track?.peaks,activeSeek===$('seek')?seekOrigin:position,duration);
}
function progressLoop(){
  cancelAnimationFrame(tickFrame);tickFrame=0;
  if(engine.snapshot.status!=='playing'||document.hidden)return;
  const tick=()=>{if(!seeking)drawProgress(audio.currentTime,engine.snapshot.duration);tickFrame=requestAnimationFrame(tick);};
  tickFrame=requestAnimationFrame(tick);
}
document.addEventListener('visibilitychange',()=>{savePreferences(engine.snapshot);progressLoop();});
function syncPlayback(){
  const s=engine.snapshot;
  if(s.track?.id!==oldTrackId){
    // Natural end or Media Session next can replace a track during a seek contact.
    // The old contact must never seek the new track using the previous track's origin.
    if(activeSeek){ignoredSeekContact=seekPointer;finishSeek(false);}
    oldTrackId=s.track?.id;
    for(const id of ['track-title','mini-title'])$(id).textContent=s.track?.title||'No track selected';
    const detail=s.track?`${s.track.artist||'Unknown artist'} · ${s.track.album||'Unknown album'}`:'';
    $('track-subtitle').textContent=detail;$('mini-subtitle').textContent=detail;
    $('art-image').style.backgroundImage=art(s.track);
    $('audio-info').textContent=s.track?.source==='demo'?'WAV · 16-bit · 22.05 kHz · Mono':s.track?'Local audio':'Open files from the menu';
    renderRows();
  }
  for(const id of ['play','mini-play']){setIcon($(id),s.intent==='play'?'pause':'play');$(id).setAttribute('aria-label',s.intent==='play'?'Pause':'Play');$(id).disabled=!s.track;}
  $('repeat').setAttribute('aria-label',`Repeat ${s.repeat}`);$('repeat').setAttribute('aria-pressed',String(s.repeat!=='off'));
  $('repeat').dataset.mode=s.repeat;$('repeat').title=`Repeat ${s.repeat}`;
  $('shuffle').setAttribute('aria-pressed',String(s.shuffle));
  $('track-counter').textContent=s.track?`${s.index+1} / ${s.tracks.length}`:'0 / 0';
  $('seek').disabled=!s.duration;$('mini-seek').disabled=!s.duration;
  app.dataset.playback=s.status;
  if(!seeking)drawProgress(s.position,s.duration);
  if(s.status!==oldStatus){oldStatus=s.status;progressLoop();renderScene(motion.progress);}
  if(s.error)notify(s.error,0);else if(s.status==='buffering')notify('Buffering…',0);else if(s.status==='playing')notify('');
  if(performance.now()-savedAt>1500){savePreferences(s);savedAt=performance.now();}
}
engine.addEventListener('change',syncPlayback);

function buttonCategory(label,detail,symbol,onClick){
  const button=document.createElement('button');button.className='category';
  button.innerHTML=icon(symbol);const text=document.createElement('span');text.textContent=label;button.append(text);
  const small=document.createElement('small');small.textContent=detail;button.append(small);button.onclick=onClick;return button;
}
function refreshLibrary(){
  const categoryView=mode==='library'||((mode==='albums'||mode==='artists')&&!group);
  $('categories').hidden=!categoryView;$('track-list').hidden=categoryView;$('list-toolbar').hidden=categoryView;
  $('search-row').hidden=mode!=='search';$('empty').hidden=true;
  const unique=key=>[...new Set(tracks.map(t=>t[key]||`Unknown ${key}`))].sort((a,b)=>a.localeCompare(b));
  const names={library:'Library',songs:'All Songs',albums:'Albums',artists:'Artists',queue:'Queue',search:'Search',local:'Local files'};
  $('library-title').textContent=group||names[mode]||'All Songs';
  $('library-subtitle').textContent=`${tracks.length} ${tracks.length===1?'song':'songs'} · ${tracks[0]?.source==='demo'?'Demo library':'On this device'}`;
  $('categories').replaceChildren();
  if(mode==='library'){
    const choices=[['All Songs',`${tracks.length} songs`,'songs','songs'],['Albums',`${unique('album').length} albums`,'albums','albums'],['Artists',`${unique('artist').length} artists`,'artists','artists'],['Queue',`${engine.snapshot.tracks.length} songs`,'queue','queue']];
    for(const [label,detail,symbol,target]of choices)$('categories').append(buttonCategory(label,detail,symbol,()=>route(target)));
  }else if(categoryView){
    const key=mode==='albums'?'album':'artist';
    for(const name of unique(key))$('categories').append(buttonCategory(name,`${tracks.filter(t=>(t[key]||`Unknown ${key}`)===name).length} songs`,mode,()=>{group=name;refreshLibrary();}));
  }
  const query=$('search-input').value.trim().toLocaleLowerCase();
  entries=tracks.filter(t=> (!group||(mode==='albums'?t.album:t.artist)===group)&&(!query||[t.title,t.artist,t.album].join(' ').toLocaleLowerCase().includes(query)));
  if(mode!=='queue')entries.sort((a,b)=>(ascending?1:-1)*a.title.localeCompare(b.title));
  $('result-count').textContent=`${entries.length} ${entries.length===1?'song':'songs'}`;
  $('sort').hidden=mode==='queue';$('sort').textContent=ascending?'Title ↑':'Title ↓';
  $('track-list').scrollTop=0;
  $('list-space').style.height=`${entries.length*rowHeight()}px`;
  $('empty').hidden=categoryView||entries.length>0;
  renderRows();renderScene(motion.progress);
}
function rowHeight(){return parseFloat(getComputedStyle(app).getPropertyValue('--row-height'))||96;}
function renderRows(){
  if($('track-list').hidden)return;
  const list=$('track-list'),height=rowHeight(),start=Math.max(0,Math.floor(list.scrollTop/height)-3);
  const count=Math.min(32,Math.ceil(list.clientHeight/height)+7),end=Math.min(entries.length,start+count);
  const focused=document.activeElement?.dataset?.trackId;
  const fragment=document.createDocumentFragment();
  for(let i=start;i<end;i++){
    const track=entries[i],button=document.createElement('button');button.className='song-row';button.dataset.trackId=track.id;
    button.style.top=`${i*height}px`;button.setAttribute('role','option');button.setAttribute('aria-posinset',String(i+1));button.setAttribute('aria-setsize',String(entries.length));
    button.setAttribute('aria-current',String(track.id===engine.snapshot.track?.id));
    button.setAttribute('aria-selected',String(track.id===engine.snapshot.track?.id));
    const thumb=document.createElement('span');thumb.className='row-art';thumb.style.backgroundImage=art(track);
    const copy=document.createElement('span');copy.className='row-text';
    const title=document.createElement('span');title.className='row-title';title.textContent=track.title;
    const detail=document.createElement('span');detail.className='row-detail';detail.textContent=`${track.artist||'Unknown artist'} · ${track.album||'Unknown album'}`;
    const duration=document.createElement('span');duration.className='row-duration';duration.textContent=track.duration?time(track.duration):'—';
    copy.append(title,detail);button.append(thumb,copy,duration);
    button.onclick=()=>{engine.select(tracks.findIndex(t=>t.id===track.id));route('player');};fragment.append(button);
  }
  $('list-rows').replaceChildren(fragment);
  if(focused){[...$('list-rows').children].find(row=>row.dataset.trackId===focused)?.focus({preventScroll:true});}
}
$('track-list').addEventListener('scroll',()=>{if(!rowFrame)rowFrame=requestAnimationFrame(()=>{rowFrame=0;renderRows();});},{passive:true});
$('track-list').addEventListener('keydown',event=>{
  if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
  event.preventDefault();const current=entries.findIndex(t=>t.id===document.activeElement?.dataset.trackId);
  const index=event.key==='Home'?0:event.key==='End'?entries.length-1:clamp(current+(event.key==='ArrowDown'?1:-1),0,entries.length-1);
  if(!entries[index])return;
  $('track-list').scrollTop=index*rowHeight();renderRows();
  [...$('list-rows').children].find(row=>row.dataset.trackId===entries[index].id)?.focus({preventScroll:true});
});
$('search-input').addEventListener('input',refreshLibrary);
$('sort').onclick=()=>{ascending=!ascending;refreshLibrary();};

export function useCatalog(catalog,{restore=false}={}){
  const previous=source;source=catalog;tracks=catalog.tracks;
  const index=restore?Math.max(0,tracks.findIndex(t=>t.id===preferences.lastDemoId)):0;
  engine.setQueue(tracks,{index,autoplay:false});previous?.dispose();
  if(restore){engine.setRepeat(preferences.repeat);engine.setShuffle(preferences.shuffle);engine.seek(preferences.position);}
  oldTrackId=null;syncPlayback();refreshLibrary();
}
async function loadDemo(restore=false){
  const request=++sourceRequest;
  try{const catalog=await createDemoCatalog();if(request!==sourceRequest){catalog.dispose();return;}useCatalog(catalog,{restore});}
  catch{notify('The demo library could not be prepared. Open an audio file to continue.',0);}
}
$('nav-menu').onclick=()=>$('menu').showModal();$('close-menu').onclick=()=>$('menu').close();
$('menu').addEventListener('click',event=>{if(event.target===$('menu')){const r=$('menu').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('menu').close();}});
for(const id of ['open-files','import'])$(id).onclick=()=>{$('menu').close();$('files').click();};
$('demo').onclick=()=>{$('menu').close();void loadDemo();};
$('files').onchange=()=>{
  const catalog=createLocalCatalog($('files').files);$('files').value='';
  if(!catalog.tracks.length){catalog.dispose();notify('No supported audio files selected.');return;}
  sourceRequest++;useCatalog(catalog);route('songs');
};
addEventListener('pagehide',()=>savePreferences(engine.snapshot));
history.replaceState({v2:true},'',location.hash||'#player');
const initial=location.hash.slice(1);mode=['library','songs','albums','artists','queue','search'].includes(initial)?initial:'library';
measure();if(initial!=='player')motion.settle(1,{immediate:true});
await loadDemo(true);
app.dataset.ready='true';
