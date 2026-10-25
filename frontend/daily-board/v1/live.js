import {request} from '/assets/shared-api.js';
import {renderEntry} from './render.js';
import {decodeReport} from './schema.js';
const target=document.querySelector('#report');
const refresh=document.createElement('button');
refresh.id='refresh';refresh.type='button';refresh.className='tactile';refresh.textContent='Refresh reports';
refresh.setAttribute('aria-label','Refresh reports');refresh.setAttribute('aria-controls','report');
const status=document.createElement('p');status.className='refresh-status';status.setAttribute('role','status');
let posts=[],select,host,shown,loading=false;
// Reports are due by 08:00 Rosario; say so when today's has not arrived.
const ZONE='America/Argentina/Cordoba',DUE_HOUR=8;
const zoned=(ms,options)=>new Intl.DateTimeFormat('en-CA',{timeZone:ZONE,...options}).format(ms);
const boardDay=ms=>zoned(ms,{year:'numeric',month:'2-digit',day:'2-digit'});
const late=document.createElement('p');late.className='late-note';
function lateNote(now=Date.now()){
 if(!posts.length||Number(zoned(now,{hour:'2-digit',hourCycle:'h23'}))<DUE_HOUR)return '';
 const latest=posts.map(p=>decodeReport(p)?.date||boardDay(Date.parse(p.createdAt))).sort().at(-1);
 if(latest>=boardDay(now))return '';
 const label=new Intl.DateTimeFormat('en',{timeZone:'UTC',month:'long',day:'numeric'}).format(Date.parse(latest));
 return `Today’s report hasn’t arrived yet. The latest is from ${label}.`;
}

function show(){
 const post=posts.find(p=>p.id===select.value);
 // Keep the reading DOM intact when a refresh changes only the edition list.
 if(JSON.stringify(post)!==JSON.stringify(shown)){renderEntry(post,host);shown=post;}
}
function display(next){
 const selected=select?.value;
 posts=next;
 if(!posts.length){
  target.textContent='Your briefing will appear here.';select=host=shown=undefined;
  return;
 }
 if(!select){
  select=document.createElement('select');select.setAttribute('aria-label','Report edition');
  host=document.createElement('div');target.replaceChildren(late,select,host);
  select.addEventListener('change',show);
 }
 const options=posts.map(post=>{const option=document.createElement('option');option.value=post.id;option.textContent=post.title;return option;});
 select.replaceChildren(...options);
 select.value=posts.some(p=>p.id===selected)?selected:posts[0].id;
 late.textContent=lateNote();
 show();
}
async function load({retrying=false,refreshing=false}={}){
 if(loading)return;
 loading=true;refresh.setAttribute('aria-disabled','true');
 if(refreshing){status.textContent='Checking for new reports…';refresh.textContent='Refreshing…';}
 try{
  const state=await request('/shared/state');
  const next=[...state.posts].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  const position=window.scrollY;
  display(next);
  if(!refresh.isConnected){document.querySelector('.topline').append(refresh);target.after(status);}
  if(refreshing){status.textContent='Reports refreshed.';window.scrollTo(0,position);}
  if(retrying){if(select)select.focus();else{target.tabIndex=-1;target.focus();}}
 }catch{
  if(refreshing){status.textContent='Could not refresh. Your current view is unchanged. Try Refresh reports again.';}
  else{
   const message=document.createElement('p');message.textContent='Daily Board is temporarily unavailable.';
   const retry=document.createElement('button');retry.type='button';retry.className='tactile';retry.textContent='Try again';
   retry.addEventListener('click',()=>{retry.disabled=true;message.textContent='Opening your Daily Board…';load({retrying:true});});
   target.replaceChildren(message,retry);
   if(retrying)retry.focus();
  }
 }finally{loading=false;refresh.setAttribute('aria-disabled','false');refresh.textContent='Refresh reports';}
}
refresh.addEventListener('click',()=>load({refreshing:true}));
await load();
