import {createRelayOwnerApi} from './relay-owner-api.js';
let storage;try{storage=localStorage;}catch{}
const api=createRelayOwnerApi({storage});
const status=document.querySelector('#status'),login=document.querySelector('#login'),messages=document.querySelector('#messages');
const composer=document.querySelector('#composer'),input=document.querySelector('#message'),send=document.querySelector('#send');
let enabled=false,busy=false,pending=null,history=new Map(),loading=false;
function render() {
  const replied=new Set([...history.values()].filter(m=>m.role==='mast').map(m=>m.replyTo));
  messages.replaceChildren();
  for(const message of [...history.values()].sort((a,b)=>a.sequence-b.sequence)) {
    const row=document.createElement('article');row.className='message-row'+(message.role==='owner'?' outgoing':'');
    const author=document.createElement('span');author.className='message-author';author.textContent=message.role==='owner'?'You':'Mast';
    const body=document.createElement('div');body.className='bubble';body.textContent=message.body;
    const time=document.createElement('span');time.className='message-time';time.textContent=new Date(message.createdAt).toLocaleString()+(message.role==='owner'?(replied.has(message.id)?' · Replied':' · Saved · Awaiting Mast'):'');
    row.append(author,body,time);messages.append(row);
  }
  if(!history.size){const p=document.createElement('p');p.textContent=enabled?'Start your conversation with Mast.':'Mast chat is not active yet. Nothing is sent until access is approved.';messages.append(p);}
}
function accessError(error){
  status.textContent=error.message;
  if(!api.hasCredential){enabled=false;history.clear();render();composer.hidden=true;login.hidden=false;}
}
async function refresh(){
  if(loading||busy)return;loading=true;
  try {
    if(!api.hasCredential){login.hidden=false;status.textContent='Sign in to open your private Mast conversation.';return;}
    const snapshot=new Map();let after='0',data;
    do {data=await api.mastMessages(after);for(const m of data.messages)snapshot.set(m.id,m);after=data.nextCursor;}while(after);
    history=snapshot;enabled=data.enabled;login.hidden=true;composer.hidden=!enabled;
    status.textContent=enabled?'Only this conversation is shared with Mast.':'Awaiting approval to activate Mast access.';
    if(pending&&history.has(pending.id)){pending=null;input.value='';input.readOnly=false;send.textContent='Send';}
    render();
  }catch(error){accessError(error);}finally{loading=false;}
}
login.addEventListener('submit',async event=>{
  event.preventDefault();const button=login.querySelector('button');button.disabled=true;
  try{await api.login(login.elements.username.value,login.elements.password.value,'Mast chat');login.elements.password.value='';await refresh();}
  catch(error){accessError(error);}finally{button.disabled=false;}
});
composer.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!enabled||!input.value.trim())return;
  pending ||= {id:crypto.randomUUID(),body:input.value.trim()};busy=true;send.disabled=true;input.readOnly=true;status.textContent='Sending to Mast…';
  try {
    const data=await api.mastSend(pending.id,pending.body);history.set(data.entry.id,data.entry);pending=null;input.value='';input.readOnly=false;send.textContent='Send';
    status.textContent='Saved · Awaiting Mast';render();messages.scrollTop=messages.scrollHeight;input.focus();
  }catch(error){accessError(error);if(api.hasCredential)status.textContent='Send not confirmed. Retry to check the same message safely.';send.textContent='Retry';}
  finally{busy=false;send.disabled=false;}
});
document.querySelector('#refresh').addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setInterval(()=>{if(!document.hidden&&enabled&&!pending)refresh();},15000);
refresh();
