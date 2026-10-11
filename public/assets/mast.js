import {createRelayOwnerApi} from './relay-owner-api.js';
import {createAttachmentDraft,RELAY_ATTACHMENT_TYPES} from './relay-attachments.js';
import {createPrivateAttachmentContent} from './relay-attachment-content.js';
let storage;try{storage=localStorage;}catch{}
const api=createRelayOwnerApi({storage,attachmentDestination:'mast'});
const status=document.querySelector('#status'),login=document.querySelector('#login'),messages=document.querySelector('#messages');
const composer=document.querySelector('#composer'),input=document.querySelector('#message'),send=document.querySelector('#send');
let enabled=false,busy=false,pending=null,history=new Map(),loading=false;
const picker=document.querySelector('#files'),choose=document.querySelector('#choose-files'),selected=document.querySelector('#selected-files');
picker.accept=RELAY_ATTACHMENT_TYPES.join(',');
const content=createPrivateAttachmentContent({document,read:async(item,options)=>{try{return await api.attachmentContent(item,options);}catch(error){accessError(error);throw error;}}});
const observed=new WeakSet(),previews=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){previews.unobserve(e.target);e.target.querySelector('button[aria-label^="Preview "]')?.click();}},{root:messages});
const draft=createAttachmentDraft({enabled:()=>enabled&&api.hasCredential,upload:(file,{id,messageId,signal})=>api.uploadAttachment(messageId,id,file,{signal}),discard:(messageId,id)=>api.discardAttachment(messageId,id),onChange:renderDraft});
function renderDraft(){
  const state=draft.snapshot();selected.replaceChildren();choose.disabled=busy||state.locked;input.required=!state.items.length;
  for(const item of state.items){const row=document.createElement('div');row.className='mast-selected-file';
    const text=document.createElement('span');text.textContent=item.name+' · '+({selected:'Ready to send',uploading:'Uploading…',ready:'Uploaded',error:item.error}[item.status]);
    const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+item.name);remove.disabled=state.locked;remove.onclick=()=>draft.remove(item.id);row.append(text,remove);selected.append(row);
  }
  if(state.notice){const note=document.createElement('p');note.textContent=state.notice;selected.append(note);}
}
choose.addEventListener('click',()=>picker.click());
picker.addEventListener('change',()=>{if(enabled&&!busy&&!pending)draft.add([...picker.files]);picker.value='';});
function sent(){pending=null;input.value='';input.readOnly=false;send.textContent='Send';draft.clear();}
function render() {
  const replied=new Set([...history.values()].filter(m=>m.role==='mast').map(m=>m.replyTo));
  messages.replaceChildren();
  for(const message of [...history.values()].sort((a,b)=>a.sequence-b.sequence)) {
    const row=document.createElement('article');row.className='message-row'+(message.role==='owner'?' outgoing':'');
    const author=document.createElement('span');author.className='message-author';author.textContent=message.role==='owner'?'You':'Mast';
    const body=document.createElement('div');body.className='bubble';body.textContent=message.body;
    const time=document.createElement('span');time.className='message-time';time.textContent=new Date(message.createdAt).toLocaleString()+(message.role==='owner'?(replied.has(message.id)?' · Replied':' · Saved · Awaiting Mast'):'');
    row.append(author,body);
    for(const file of message.attachments||[]){const node=content.row(file);row.append(node);if(file.mimeType.startsWith('image/')&&!observed.has(node)){observed.add(node);previews.observe(node);}}
    row.append(time);messages.append(row);
  }
  content.prune();
  if(!history.size){const p=document.createElement('p');p.textContent=enabled?'Start your conversation with Mast.':'Mast chat is not active yet. Nothing is sent until access is approved.';messages.append(p);}
}
function accessError(error){
  status.textContent=error.message;
  if(!api.hasCredential){enabled=false;history.clear();content.clear();previews.disconnect();draft.clear();pending=null;input.value='';input.readOnly=false;render();composer.hidden=true;login.hidden=false;}
}
async function refresh(){
  if(loading||busy)return;loading=true;
  try {
    if(!api.hasCredential){login.hidden=false;status.textContent='Sign in to open your private Mast conversation.';return;}
    const snapshot=new Map();let after='0',data;
    do {data=await api.mastMessages(after);for(const m of data.messages)snapshot.set(m.id,m);after=data.nextCursor;}while(after);
    history=snapshot;enabled=data.enabled;login.hidden=true;composer.hidden=!enabled;
    status.textContent=enabled?'Only this conversation is shared with Mast.':'Awaiting approval to activate Mast access.';
    if(pending&&history.has(pending.id))sent();
    render();
  }catch(error){accessError(error);}finally{loading=false;}
}
login.addEventListener('submit',async event=>{
  event.preventDefault();const button=login.querySelector('button');button.disabled=true;
  try{await api.login(login.elements.username.value,login.elements.password.value,'Mast chat');login.elements.password.value='';await refresh();}
  catch(error){accessError(error);}finally{button.disabled=false;}
});
composer.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!enabled||!input.value.trim()&&!draft.snapshot().items.length)return;
  busy=true;send.disabled=true;input.readOnly=true;renderDraft();
  try {
    if(!pending){
      if(draft.snapshot().items.length){status.textContent='Uploading private files…';if(!await draft.start()){if(!api.hasCredential)accessError({message:'Owner access expired. Sign in again.'});else status.textContent='Files not confirmed. Retry or remove them; nothing has been sent.';input.readOnly=false;return;}}
      const state=draft.snapshot();pending={id:state.messageId,body:input.value.trim(),files:state.items.map(item=>item.attachment.id)};draft.lock();
    }
    status.textContent='Sending to Mast…';const data=await api.mastSend(pending.id,pending.body,pending.files);history.set(data.entry.id,data.entry);sent();
    status.textContent='Saved · Awaiting Mast';render();messages.scrollTop=messages.scrollHeight;input.focus();
  }catch(error){accessError(error);if(api.hasCredential)status.textContent='Send not confirmed. Retry to check the same message safely.';send.textContent='Retry';}
  finally{busy=false;send.disabled=false;renderDraft();}
});
window.addEventListener('pagehide',()=>{previews.disconnect();content.clear();draft.clear();});
document.querySelector('#refresh').addEventListener('click',refresh);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
setInterval(()=>{if(!document.hidden&&enabled&&!pending)refresh();},15000);
refresh();
