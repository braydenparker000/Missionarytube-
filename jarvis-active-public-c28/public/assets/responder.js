import {API_ORIGIN} from './config.js';
const $=id=>document.getElementById(id), storageKey='jarvis.responder.v1';
const escape=text=>String(text).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let token='';
try {token=localStorage.getItem(storageKey)||'';}catch{}
async function request(path,body,key=token){
 const r=await fetch(API_ORIGIN+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(15000)});
 const data=await r.json();if(!r.ok)throw new Error(data.error||'Request failed');return data;
}
function render(data){
 $('connect').hidden=true;$('inbox').hidden=false;
 $('pending').textContent=data.unanswered.length+' unanswered message'+(data.unanswered.length===1?'':'s');
 $('conversation').innerHTML=data.messages.map(m=>`<article class="card"><strong>${m.role==='user'?'BRAYDEN':m.kind==='reply'?'JARVIS':'DELIVERY RECEIPT'}</strong><p>${escape(m.body)}</p><small>${escape(m.createdAt)}</small></article>`).join('');
 const selected=$('reply-to').value;
 $('reply-to').innerHTML=data.unanswered.map(m=>`<option value="${escape(m.id)}">${escape(m.body.slice(0,160))}</option>`).join('');
 if(data.unanswered.some(m=>m.id===selected))$('reply-to').value=selected;
 $('reply-form').hidden=!data.unanswered.length;
 $('status').textContent='Inbox connected. Hourly scheduling is not enabled.';
}
async function refresh(){try{render(await request('/v1/agent/inbox'));}catch(e){$('status').textContent=e.message;}}
$('connect-form').onsubmit=async e=>{
 e.preventDefault();const next=$('connection-code').value.trim();
 try{const data=await request('/v1/agent/inbox',null,next);localStorage.setItem(storageKey,next);token=next;$('connection-code').value='';render(data);}catch(e){$('status').textContent=e.message;}
};
$('refresh').onclick=refresh;
$('forget').onclick=()=>{localStorage.removeItem(storageKey);token='';$('conversation').textContent='';$('reply-body').value='';$('inbox').hidden=true;$('connect').hidden=false;$('status').textContent='Connection forgotten in this browser. To revoke access everywhere, use Connection on your phone.';};
$('reply-form').onsubmit=async e=>{
 e.preventDefault();const body=$('reply-body').value.trim(),replyTo=$('reply-to').value;if(!body||!replyTo)return;
 $('post-reply').disabled=true;
 try{await request('/v1/agent/replies',{id:crypto.randomUUID(),replyTo,body});$('reply-body').value='';await refresh();}
 catch(e){$('status').textContent=e.message;}
 finally{$('post-reply').disabled=false;}
};
$('briefing-form').onsubmit=async e=>{
 e.preventDefault();const title=$('briefing-title').value.trim(),body=$('briefing-body').value.trim();if(!title||!body)return;
 $('post-briefing').disabled=true;
 try{await request('/v1/agent/board',{id:crypto.randomUUID(),title,body});$('briefing-form').reset();$('status').textContent='Daily briefing published.';}
 catch(e){$('status').textContent=e.message;}
 finally{$('post-briefing').disabled=false;}
};
if(token)refresh();
