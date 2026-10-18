// Staged route entrypoint; not loaded by the offline review preview.
import {request} from '/assets/shared-api.js';
import {API_ORIGIN} from '/assets/config.js';
import {renderEntry} from './render.js';
const target=document.querySelector('#report');
try {
  const state=await request('/shared/state');
  const posts=[...state.posts].sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
  if(!posts.length)target.textContent='Your briefing will appear here.';
  else {
    const select=document.createElement('select');select.setAttribute('aria-label','Report edition');
    for(const post of posts){const option=document.createElement('option');option.value=post.id;option.textContent=post.title;select.append(option);}
    const host=document.createElement('div');target.replaceChildren(select,host);let generation=0;
    async function show(){const own=++generation,post=posts.find(p=>p.id===select.value);renderEntry(post,host);
      try {const response=await fetch(`${API_ORIGIN}/shared/report?id=${encodeURIComponent(post.id)}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});if(!response.ok)return;const data=await response.json();if(own===generation&&data.report?.id===post.id)renderEntry({...post,report:data.report},host);}catch{/* Legacy content remains readable offline or during rollout. */}
    }
    select.addEventListener('change',show);await show();
  }
}catch{target.textContent='Daily Board is temporarily unavailable. Please refresh to retry.';}
