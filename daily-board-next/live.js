// Staged route entrypoint; not loaded by the offline review preview.
import {request} from '/assets/shared-api.js';
import {renderEntry} from './render.js';
const target=document.querySelector('#report');
try {
  const state=await request('/shared/state');
  const posts=[...state.posts].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  if(!posts.length)target.textContent='Your briefing will appear here.';
  else {
    const select=document.createElement('select');select.setAttribute('aria-label','Report edition');
    for(const post of posts){const option=document.createElement('option');option.value=post.id;option.textContent=post.title;select.append(option);}
    const host=document.createElement('div');target.replaceChildren(select,host);
    function show(){renderEntry(posts.find(p=>p.id===select.value),host);}
    select.addEventListener('change',show);show();
  }
}catch{target.textContent='Daily Board is temporarily unavailable. Please refresh to retry.';}
