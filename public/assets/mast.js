import {createMastWork} from './mast-work.js';
import {createRelayOwnerApi} from './relay-owner-api.js';
import {createAttachmentDraft,RELAY_ATTACHMENT_TYPES} from './relay-attachments.js';
import {createPrivateAttachmentContent} from './relay-attachment-content.js';
import {createMastDraftStore} from './mast-draft.js';
import {richText,copyText,autosize,messageDay} from './ui.js';
let storage,tab;try{storage=localStorage;tab=sessionStorage;}catch{}
const api=createRelayOwnerApi({storage,attachmentDestination:'mast'}),journal=createMastDraftStore(tab);
const $=id=>document.getElementById(id),status=$('status'),login=$('login'),messages=$('messages');
const composer=$('composer'),input=$('message'),send=$('send'),picker=$('files'),choose=$('choose-files'),selected=$('selected-files');
let enabled=false,busy=false,pending=null,history=new Map(),loading=false,epoch=0,after='0',restored=false,adapter=null,draftError=false;
const content=createPrivateAttachmentContent({document,read:async(item,options)=>{try{return await api.attachmentContent(item,options);}catch(error){accessError(error);throw error;}}});
const previews=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting){previews.unobserve(e.target);e.target.querySelector('button[aria-label^="Preview "]')?.click();}},{root:messages});
const work=createMastWork({api,storage:tab,panel:$('work-panel'),status,onCreated:()=>refresh(),onError:accessError});
let workOpen=false;
function destination(open){workOpen=open;$('work-panel').hidden=!open;messages.hidden=open;composer.hidden=open||!enabled;document.querySelector('.mast-tools').hidden=open;$('chat-tab').setAttribute('aria-pressed',String(!open));$('work-tab').setAttribute('aria-pressed',String(open));if(open)work.refresh();}
$('chat-tab').onclick=()=>destination(false);$('work-tab').onclick=()=>destination(true);
const draft=createAttachmentDraft({enabled:()=>enabled&&api.hasCredential,upload:(file,{id,messageId,signal})=>api.uploadAttachment(messageId,id,file,{signal}),discard:(messageId,id)=>api.discardAttachment(messageId,id),onChange:renderDraft});
picker.accept=RELAY_ATTACHMENT_TYPES.join(',');
function renderDraft(){
  const state=draft.snapshot();selected.replaceChildren();choose.disabled=busy||state.locked||!!pending;input.required=!state.items.length&&!pending?.files.length;
  for(const item of state.items){const row=document.createElement('div');row.className='mast-selected-file';
    const text=document.createElement('span');text.textContent=item.name+' · '+({selected:'Ready to send',uploading:'Uploading…',ready:'Uploaded',error:item.error}[item.status]);
    const remove=document.createElement('button');remove.type='button';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+item.name);remove.disabled=state.locked;remove.onclick=()=>draft.remove(item.id);row.append(text,remove);selected.append(row);
  }
  if(pending?.files.length&&!state.items.length){const note=document.createElement('p');note.textContent=pending.files.length+' uploaded file(s) retained for this exact retry.';selected.append(note);}
  if(state.notice){const note=document.createElement('p');note.textContent=state.notice;selected.append(note);}
  $('discard-pending').hidden=!pending&&!draftError;$('discard-pending').textContent=draftError?'Clear local draft':'Stop retrying';$('discard-pending').disabled=busy;
}
function save(){journal.save(api.deviceId,pending?.body??input.value,pending);}
input.addEventListener('input',()=>{autosize(input);try{save();}catch(e){accessError(e);}});
choose.addEventListener('click',()=>picker.click());
picker.addEventListener('change',()=>{if(enabled&&!busy&&!pending)draft.add([...picker.files]);picker.value='';});
function sent(){journal.clear();draftError=false;pending=null;input.value='';input.readOnly=false;send.textContent='Send';draft.clear();autosize(input);}
function render(){
  const bottom=messages.scrollHeight-messages.scrollTop-messages.clientHeight<80,position=messages.scrollTop;
  const query=$('search').value.trim().toLocaleLowerCase(),list=[...history.values()].sort((a,b)=>a.sequence-b.sequence);
  const replied=new Set(list.filter(m=>m.role==='mast').map(m=>m.replyTo));
  previews.disconnect();messages.replaceChildren();let day='';
  for(const message of list){
    if(query&&!((message.body+' '+message.attachments.map(a=>a.name).join(' ')).toLocaleLowerCase().includes(query)))continue;
    const date=messageDay(message.createdAt);if(date.key!==day){day=date.key;const label=document.createElement('p');label.className='mast-day';label.textContent=date.label;messages.append(label);}
    const row=document.createElement('article');row.className='message-row'+(message.role==='owner'?' outgoing':'');row.dataset.id=message.id;
    const author=document.createElement('span');author.className='message-author';author.textContent=message.role==='owner'?'You':'Muse';
    const body=document.createElement('div');body.className='bubble rich-body';richText(body,message.body);
    const time=document.createElement('span');time.className='message-time';time.textContent=new Date(message.createdAt).toLocaleString()+(message.role==='owner'?(replied.has(message.id)?' · Replied':adapter?.fetchedSequence>=message.sequence?' · Fetch served · Awaiting reply':' · Saved · Awaiting Muse'):'');
    row.append(author,body);
    for(const file of message.attachments){const node=content.row(file);row.append(node);if(file.mimeType.startsWith('image/'))previews.observe(node);}
    const copy=document.createElement('button');copy.type='button';copy.className='mast-copy';copy.textContent='Copy';copy.setAttribute('aria-label','Copy message');copy.onclick=async()=>{try{status.textContent=await copyText(message.body)?'Message copied.':'Copy unavailable. Select the message text to copy it.';}catch{status.textContent='Copy unavailable. Select the message text to copy it.';}};
    row.append(time,copy);if(message.role==='owner'){const request=document.createElement('button');request.type='button';request.textContent='Work from this message';request.onclick=()=>{work.prepare(message);destination(true);};row.append(request);}messages.append(row);
  }
  content.prune();
  if(!messages.children.length){const p=document.createElement('p');p.className='mast-empty';p.textContent=query?'No matching messages.':enabled?'Start your private conversation with Muse.':'Muse is not connected yet. Your private messages never go to the public Muse inbox.';messages.append(p);}
  messages.scrollTop=bottom?messages.scrollHeight:position;
  $('latest').hidden=bottom;$('export').disabled=!history.size;
}
function reset(){try{work.reset();}catch{}destination(false);++epoch;enabled=false;history.clear();after='0';adapter=null;content.clear();previews.disconnect();draft.clear();pending=null;input.value='';input.readOnly=false;restored=false;try{journal.clear();}catch(e){status.textContent=e.message;}render();composer.hidden=true;login.hidden=false;}
function accessError(error){status.textContent=error.message;if(error.name==='MastDraftError'){draftError=true;renderDraft();}if(!api.hasCredential)reset();}
function connection(){
  $('connection-detail').textContent=!enabled?'Secure adapter setup is incomplete. No connected agent is claimed.':!adapter?'Access is configured; no Muse fetch has been observed.':
    'Last authenticated fetch request: '+new Date(adapter.lastFetchedAt).toLocaleString()+'. The server handled this request; client receipt and agent execution are not confirmed by a fetch.';
}
async function refresh(){
  if(loading||busy)return;loading=true;const generation=epoch;$('refresh').disabled=true;
  try{
    if(!api.hasCredential){login.hidden=false;status.textContent='Sign in to open your private Muse conversation.';return;}
    const additions=[];let cursor=after,data;
    do{data=await api.mastMessages(cursor);if(generation!==epoch)return;additions.push(...data.messages);cursor=data.nextCursor;}while(cursor);
    if(generation!==epoch)return;
    enabled=data.enabled;adapter=data.adapter;login.hidden=true;composer.hidden=!enabled||workOpen;
    if(!enabled){history.clear();after='0';content.clear();}
    else for(const m of additions){history.set(m.id,m);after=String(Math.max(Number(after),m.sequence));}
    if(!restored){const saved=journal.read(api.deviceId);if(saved){pending=saved.pending;input.value=saved.body;input.readOnly=!!pending;send.textContent=pending?'Retry':'Send';}restored=true;autosize(input);}
    if(pending&&history.has(pending.id))sent();
    status.textContent=pending?'Send not confirmed. Retry keeps the original message and file IDs.':enabled?'Only this conversation is shared with Muse.':'Muse adapter is not connected. Secure setup is still required.';
    connection();render();renderDraft();if(workOpen)work.refresh();
  }catch(error){accessError(error);}finally{loading=false;$('refresh').disabled=false;}
}
login.addEventListener('submit',async event=>{
  event.preventDefault();const button=login.querySelector('button');button.disabled=true;
  try{await api.login(login.elements.username.value,login.elements.password.value,'Muse chat');login.elements.password.value='';await refresh();}
  catch(error){accessError(error);}finally{button.disabled=false;}
});
composer.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||loading||!enabled||!pending&&!input.value.trim()&&!draft.snapshot().items.length)return;
  busy=true;send.disabled=true;input.readOnly=true;renderDraft();
  try{
    // Validate the journal before uploading or sending; unreadable state must not
    // silently become a fresh send with a different id.
    journal.read(api.deviceId);
    if(!pending){
      if(draft.snapshot().items.length){status.textContent='Uploading private files…';if(!await draft.start()){if(!api.hasCredential)accessError({message:'Owner access expired. Sign in again.'});else status.textContent='Files not confirmed. Retry or remove them; nothing has been sent.';input.readOnly=false;return;}}
      const state=draft.snapshot();pending={id:state.messageId,body:input.value.trim(),files:state.items.map(item=>item.attachment.id)};draft.lock();
    }
    save();status.textContent='Sending to Muse…';const data=await api.mastSend(pending.id,pending.body,pending.files);history.set(data.entry.id,data.entry);sent();
    status.textContent='Saved · Awaiting Muse';render();messages.scrollTop=messages.scrollHeight;input.focus();
  }catch(error){accessError(error);if(api.hasCredential)status.textContent=error.message+' Send not confirmed. Retry checks the same message safely.';send.textContent='Retry';}
  finally{busy=false;send.disabled=false;renderDraft();}
});
$('discard-pending').onclick=()=>{if(!busy&&confirm('This message may already be saved. Stop retrying it? Check history before sending the same message again.')){try{sent();status.textContent='Retry cleared. Check history before resending.';}catch(e){status.textContent=e.message;}}};
window.addEventListener('pagehide',()=>{++epoch;previews.disconnect();content.clear();draft.clear();});
window.addEventListener('pageshow',()=>{render();refresh();});
window.addEventListener('storage',event=>{if(event.key==='jarvis.relay.owner-session.v1'){api.refreshStoredCredential();reset();refresh();}});
window.addEventListener('online',refresh);
$('refresh').onclick=refresh;$('search').oninput=render;$('latest').onclick=()=>{messages.scrollTop=messages.scrollHeight;$('latest').hidden=true;};
messages.addEventListener('scroll',()=>{$('latest').hidden=messages.scrollHeight-messages.scrollTop-messages.clientHeight<80;});
$('export').onclick=()=>{const text=[...history.values()].sort((a,b)=>a.sequence-b.sequence).map(m=>`${m.role==='owner'?'You':'Muse'} · ${m.createdAt}\n${m.body}\n${m.attachments.map(a=>a.name).join('\n')}`).join('\n\n');const url=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='private-muse-conversation.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
function viewport(){document.documentElement.style.setProperty('--mast-height',(window.visualViewport?.height||innerHeight)+'px');}
window.visualViewport?.addEventListener('resize',viewport);viewport();
setInterval(()=>{if(!document.hidden&&enabled)refresh();},15000);
refresh();
