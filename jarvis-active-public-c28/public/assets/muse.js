import {icon, sheet, appViewport, autosize} from './ui.js';
import {conversation} from './conversation.js';
import {createDirectApi} from './direct-api.js';
import {museBody} from './channels.js';
import {MUSE_STORAGE_KEY, MAX_MESSAGE, readMuse, queueMuse, mergeMuse} from './muse-store.js';
import {createPublicReaderDeliveryStore, mergePublicReaderInbox} from './public-reader-cache.js';

const $ = id => document.getElementById(id);
const request = createDirectApi();
let state, deliveryStore, busy = false, storageError = '', syncError = '', chatUI, toastTimer;
appViewport();
document.querySelectorAll('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));
function notify(value){$('toast').textContent=value;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,3500);}
const time = value => new Intl.DateTimeFormat(undefined, {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}).format(new Date(value));
try { deliveryStore=createPublicReaderDeliveryStore({storage:localStorage,tabStorage:sessionStorage,key:MUSE_STORAGE_KEY,read:readMuse});state=deliveryStore.restore();state=deliveryStore.commit(state); }
catch (e) { storageError = e.message || 'Browser storage is unavailable. Keep your text here or copy it before leaving.'; }
function commit(next) {
  try{state=deliveryStore.commit(next);storageError='';}catch(error){state=next;if(error.storageFailure)storageError=error.message;throw error;}
}
function render() {
  $('send').disabled=!!storageError||!state?.composer?.trim();
  $('refresh').disabled=busy||!!storageError;
  $('error').hidden=!storageError&&!syncError;
  $('error').textContent=storageError||syncError;
  $('muse-sync-notice').hidden=!storageError&&!syncError;
  $('muse-retry').hidden=!!storageError;$('muse-retry').disabled=busy;
  const attention=state?.outbox.some(m=>['rejected','conflict'].includes(m.sendState));
  $('status').textContent=storageError?'Cannot save on this device':syncError?state?.outbox.length?attention?'Send needs attention · text saved on this device':'Send unconfirmed · queued on this device':'Inbox unavailable · draft saved':busy?state?.outbox.length?'Sending publicly · Muse destination':'Refreshing public inbox…':state?.outbox.length?'Queued on this device':state?.publisher?.ok===false?'Messages saved · replies delayed':'Public inbox · replies arrive after a check';
  if(!state)return;
  if(!chatUI)chatUI=conversation({panel:$('messages'),composer:$('prompt'),channel:'muse',author:'Muse',body:m=>m.role==='user'?museBody(m.body):m.body,notify,draftChanged:value=>{state={...state,composer:value};try{commit(state);}catch(error){storageError=error.message;render();}},emptyTitle:'Follow a thought.',emptyDescription:'Write to the Muse destination in the shared public Relay inbox. Replies appear here after an assistant checks the request.',scope:'Public Muse conversation'});
  chatUI.update(state.messages);
  chatUI.setDelivery({busy,error:!!syncError});
}
async function sync() {
  if (busy || storageError) return;
  busy = true; syncError = ''; render();
  let sending;
  try {
    // History uses a complete public checkpoint. A lost POST response still
    // needs an exact target probe before its queued UUID can be accepted.
    const inbox=await request('/shared/state',{publicReader:state.publicReader});commit(mergePublicReaderInbox(state,inbox,mergeMuse));
    while(state.outbox.some(message=>message.sendState!=='conflict')){
      const message=state.outbox.find(message=>message.sendState!=='conflict');
      sending=message;setSendState(message.id,'sending');
      try{
        const remote=await request('/shared/messages',{id:message.id,body:message.body,retry:['unknown','sending','rejected'].includes(message.sendState)});commit(mergePublicReaderInbox(state,remote,mergeMuse));
        if(state.outbox.some(m=>m.id===message.id))throw Error('Message acceptance could not be confirmed. Refresh to retry the same message.');
      }catch(error){if(error.status!==409)throw error;setSendState(message.id,'conflict');}
    }
    if(sending){const latest=await request('/shared/state',{publicReader:state.publicReader});commit(mergePublicReaderInbox(state,latest,mergeMuse));}
    if(state.outbox.some(m=>m.sendState==='conflict'))syncError='A queued message has an ID conflict. Its original text stays here; other messages can still sync.';
  } catch (e) { if(sending&&state.outbox.some(m=>m.id===sending.id)){try{setSendState(sending.id,e.status===409?'conflict':e.status>=400&&e.status<500?'rejected':'unknown');}catch{}}syncError = e.message || 'Sync failed. Queued messages remain on this device.'; }
  finally { busy = false; render(); }
}
function setSendState(id,sendState){commit({...state,messages:state.messages.map(m=>m.id===id?{...m,sendState}:m),outbox:state.outbox.map(m=>m.id===id?{...m,sendState}:m)});}
$('prompt').maxLength = MAX_MESSAGE;
$('prompt').value = state?.composer || '';
$('prompt').oninput = () => {
  if (storageError) return;
  autosize($('prompt'));
  state={...state,composer:$('prompt').value};
  try { commit(state); }
  catch(error){storageError=error.message||'Could not save your draft. Copy your text before leaving this page.';}
  render();
};
$('composer').onsubmit = e => {
  e.preventDefault(); if (storageError || !$('prompt').value.trim()) return;
  try {
    const queued=queueMuse(state,$('prompt').value,crypto.randomUUID(),new Date().toISOString());deliveryStore.savePending(queued.outbox.at(-1),{associateDraft:true});commit(queued);
    $('prompt').value = ''; autosize($('prompt'));render();chatUI.latest();sync();
  } catch(e){state={...state,composer:$('prompt').value};try{state=deliveryStore.external(state);}catch{}if(e.kind==='capacity')syncError=e.message;else storageError=e.message;render();}
};
$('prompt').onkeydown = e => {
  if (e.key === 'Enter' && (e.ctrlKey||e.metaKey) && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
};
$('refresh').onclick = sync;
$('muse-retry').onclick=sync;
$('setup').onclick = async () => {
  $('setup-dialog').showModal(); $('copy-status').textContent = 'Loading instructions…'; $('copy-setup').disabled = true;
  try {
    const response = await fetch('/muse/setup.txt', {cache:'no-store'});
    if (!response.ok) throw Error('Instructions could not be loaded. Use the full instructions link.');
    $('setup-text').value = await response.text(); $('copy-status').textContent = ''; $('copy-setup').disabled = false;
  } catch(e) { $('copy-status').textContent = e.message; }
};
$('close-setup').onclick = () => $('setup-dialog').close();
$('copy-setup').onclick = async () => {
  try { await navigator.clipboard.writeText($('setup-text').value); $('copy-status').textContent = 'Copied. Paste into your existing Muse chat.'; }
  catch { $('setup-text').focus(); $('setup-text').select(); $('copy-status').textContent = 'Select and copy the instructions above, then paste into Muse.'; }
};
window.addEventListener('online', sync);
window.addEventListener('storage',event=>{if(event.key!==MUSE_STORAGE_KEY&&!event.key?.startsWith(deliveryStore?.prefix))return;try{state=deliveryStore.external(state);render();}catch(e){syncError=e.message;render();}});
document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
setInterval(() => { if (!document.hidden) sync(); }, 30000);
render(); sync();

$('search-toggle').onclick=()=>{const bar=$('search-bar');bar.hidden=!bar.hidden;if(!bar.hidden)$('conversation-search').focus();else{$('conversation-search').value='';chatUI?.search('');}};
$('search-close').onclick=()=>$('search-toggle').click();
$('conversation-search').oninput=e=>chatUI?.search(e.target.value);
$('muse-menu').onclick=()=>{
  const d=sheet('Public Muse',[{label:'Search messages',icon:'search',action:()=>$('search-toggle').click()},{label:'Bookmarks',icon:'bookmark',action:()=>chatUI?.bookmarks()},{label:'Latest messages',icon:'chat',action:()=>chatUI?.latest()},{label:'Refresh inbox',icon:'refresh',action:sync},{label:'Connection details',icon:'info',action:()=>{const detail=sheet('Muse connection',[]);detail.classList.add('conversation-sheet');const p=document.createElement('p');p.className='sheet-context';p.textContent=storageError||syncError||(state?.syncedAt?'Public inbox refreshed '+time(state.syncedAt)+'. Messages are stored separately from the assistant’s reply delivery.':'The public inbox has not been refreshed yet.');detail.append(p);const note=document.createElement('p');note.className='sheet-note';note.textContent='This page checks for saved replies. It cannot confirm that Muse has an active schedule or is currently working.';detail.append(note);}},{label:'Reply setup instructions',icon:'clock',action:()=>$('setup').click()}]);
  d.classList.add('conversation-sheet');const p=document.createElement('p');p.className='sheet-context';p.textContent='Anyone with this website address can read and post here. Muse is a destination prefix in the shared public Relay inbox. Private owner Relay stays separate.';d.querySelector('.dialog-heading').after(p);const note=document.createElement('p');note.className='sheet-note';note.textContent='Replies appear after an assistant checks the request and publication is saved. No active schedule or separate Muse identity is confirmed by this page.';d.append(note);
  const relay=document.createElement('a');relay.href='/jarvis/';relay.className='sheet-action';relay.innerHTML=icon('chat');relay.append(document.createTextNode('Relay conversations'));note.before(relay);
};
addEventListener('pagehide',()=>chatUI?.savePosition());
autosize($('prompt'));
