import {icon, richText, sheet, appViewport, autosize, el as uiEl} from './ui.js';
import {MODELS,STORAGE_KEY,parseHistory,selectedMessages,chatUsage,streamReply,imageDB,prepareImage,blobData,cleanURL} from './quick-ai-core.js';
import {createRelayTransferStore,quickAITransfer} from './relay-transfer.js';
const $=id=>document.getElementById(id),db=imageDB();let state,storageOK=true,run=null,preparing=false,keys={},ready={};let pending=[];
appViewport();
document.querySelectorAll('[data-icon]').forEach(n=>n.innerHTML=icon(n.dataset.icon));
document.querySelectorAll('[data-close]').forEach(n=>n.onclick=()=>$(n.dataset.close).close());
function warn(s){$('storage-status').hidden=false;$('storage-status').textContent=s;}
function continueInRelay(question,answer){
  sheet('Choose Relay destination',[
    {label:'Owner chat · private',icon:'lock',action:()=>transferToRelay(question,answer,'owner')},
    {label:'Public Relay · shared',icon:'chat',action:()=>transferToRelay(question,answer,'public')}
  ]);
}
function transferToRelay(question,answer,destination){
  if(!save()){
    warn('Could not save this Quick AI chat. It is still open; copy new messages and your draft before leaving. No Relay draft was prepared.');
    $('status').textContent='Relay transfer paused: save or copy your Quick AI content before leaving.';
    return;
  }
  try{createRelayTransferStore().stage(quickAITransfer(question,answer,destination));location.href='/jarvis/';}
  catch(error){$('status').textContent=error.message||'Could not prepare a Relay draft.';}
}
try{state=parseHistory(localStorage.getItem(STORAGE_KEY));}catch{state=parseHistory(null);storageOK=false;warn('Saved chats could not be read. This session will not overwrite them.');}
function save(){if(!storageOK)return false;try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));return true;}catch{storageOK=false;warn('Storage is full or blocked. Existing chats will not be overwritten; copy new messages before leaving.');return false;}}
const current=()=>state.chats.find(c=>c.id===state.active);
function create(){const c={id:crypto.randomUUID(),title:'New chat',draft:'',provider:'gemini',search:false,messages:[]};state.chats.unshift(c);state.active=c.id;return c;}
if(!current())state.active=state.chats[0]?.id||create().id;
function text(tag,value,cls){const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;}
function link(url,label){const a=document.createElement('a');a.href=url;a.textContent=label;a.target='_blank';a.rel='noopener noreferrer';return a;}
function bodyRender(node,message){richText(node,message.content,message.sources?.sources||[]);}
function allowanceText(rate){
  if(!rate)return '';
  const parts=[];
  if(rate.dailyRemaining!==null&&rate.dailyLimit!==null)parts.push(`${rate.dailyRemaining.toLocaleString()} / ${rate.dailyLimit.toLocaleString()} daily requests left`);
  if(rate.minuteTokensRemaining!==null&&rate.minuteTokensLimit!==null)parts.push(`${rate.minuteTokensRemaining.toLocaleString()} / ${rate.minuteTokensLimit.toLocaleString()} minute tokens left`);
  return parts.join(' · ');
}
function renderUsage(){
  const chat=current(),usage=chatUsage(chat.messages),last=chat.messages.findLast(m=>m.role==='assistant'&&m.provider==='qwen');
  const parts=[usage.replies?`This chat · ${usage.reported}/${usage.replies} replies reported · ${usage.input.toLocaleString()} in / ${usage.output.toLocaleString()} out tokens`:'This chat · usage appears after a reply'];
  if(usage.credits)parts.push(`${usage.credits.toLocaleString()} Tavily credit${usage.credits===1?'':'s'} reported`);
  if(chat.provider==='qwen'&&last?.allowance&&Date.now()-last.allowance.observedAt<120000){const allowance=allowanceText(last.allowance);if(allowance)parts.push(`Groq last report: ${allowance}`);}
  else if(chat.provider==='qwen'&&last?.errorCode==='limit')parts.push('Groq limited · remaining quota unavailable here');
  $('usage-summary').textContent=parts.join(' · ');
}
async function thumbnails(container,message){for(const id of message.attachments){try{const blob=await db.get(id);if(!blob){container.append(text('span','Image missing · reattach'));continue;}const url=URL.createObjectURL(blob),img=document.createElement('img');img.src=url;img.alt='Attached image';img.onload=()=>URL.revokeObjectURL(url);const item=text('div','','preview');item.append(img);if(message.role==='user'){const remove=text('button','Remove image','text-button');remove.onclick=async()=>{const previous=[...message.attachments];message.attachments=message.attachments.filter(x=>x!==id);if(save()){await db.delete(id).catch(()=>warn('Image removal failed.'));render();}else message.attachments=previous;};item.append(remove);}container.append(item);}catch{container.append(text('span','Image unavailable · reattach'));}}}
function messageElement(m){const article=text('article','','ai-message '+m.role);article.append(text('h2',m.role==='user'?'You':m.provider==='qwen'?'Qwen':m.provider==='gemini'?'Gemini':'Quick AI'));
  const body=text('div','','body rich-body');bodyRender(body,m);if(!m.content&&m.status==='streaming')body.textContent='Thinking…';article.append(body);
  if(m.attachments?.length){const box=text('div','','thumbnails');article.append(box);thumbnails(box,m);}
  if(m.sources?.sources?.length){const sourceDetails=text('details','','sources-panel');sourceDetails.append(text('summary',`${m.sources.sources.length} sources`));article.append(sourceDetails);sourceDetails.append(text('p',`Retrieved sources · ${m.sources.retrievedAt||'time unavailable'}`,'message-note'));const list=text('ol','','source-list');for(const s of m.sources.sources){const url=cleanURL(s.url);if(!url)continue;const li=document.createElement('li');li.value=s.id;li.append(link(url,s.title||url),document.createTextNode(m.content.includes(`[${s.id}]`)?' · cited':' · retrieved'));list.append(li);}sourceDetails.append(list);}
  if(m.usage){const details=text('details','','request-info');details.append(text('summary','Request details'));article.append(details);details.append(text('p',`This request: ${m.usage.input} input · ${m.usage.output} output tokens (provider reported; not an account balance)`,'message-note'));}
  if(m.allowance){const allowance=allowanceText(m.allowance);if(allowance)article.append(text('p',`Groq at this request: ${allowance}`,'message-note'));}
  if(m.role==='assistant'&&m.status!=='streaming'){
    if(m.status!=='complete'||m.truncated)article.append(text('p',m.truncated?'Reply reached its length limit. Ask to continue.':'Reply interrupted. Tap Retry.','message-note'));
    if(m.content){const b=text('button','Copy','text-button copy');b.onclick=async()=>{try{await navigator.clipboard.writeText(m.content);b.textContent='Copied';}catch{b.textContent='Select text to copy';}};article.append(b);
      const menu=text('button','More','text-button reply-menu');menu.setAttribute('aria-label','Reply actions');menu.onclick=()=>sheet('Reply actions',[{label:'Continue answer',icon:'chat',disabled:!!run,action:()=>{$('prompt').value='Continue your previous answer.';$('prompt').dispatchEvent(new Event('input'));$('composer').requestSubmit();}},{label:'Continue in Relay',icon:'quote',action:()=>{const i=current().messages.indexOf(m);const question=current().messages.slice(0,i).findLast(x=>x.role==='user')?.content||'';continueInRelay(question,m.content);}}]);article.append(menu);}
  }return article;}
let renderedChat;
function render(){const panel=$('messages'),oldScroll=panel.scrollTop,nearBottom=panel.scrollHeight-panel.clientHeight-panel.scrollTop<100;const c=current(),changed=renderedChat!==c.id;renderedChat=c.id;$('history').replaceChildren(...state.chats.map(chat=>{const o=document.createElement('option');o.value=chat.id;o.textContent=chat.title;return o;}));$('history').value=c.id;$('model').value=c.provider;$('search').checked=c.search;$('search-row').hidden=!c.search;$('prompt').value=c.draft;
  $('messages').replaceChildren(...c.messages.map(messageElement));if(!c.messages.length){const empty=text('div','','empty-chat');empty.append(text('h1','What’s on your mind?'),text('p','Ask a question, attach an image, or turn on Search for current sources.'));$('messages').append(empty);}controls();renderUsage();autosize($('prompt'));renderChatList();panel.scrollTop=changed||nearBottom?panel.scrollHeight:oldScroll;}
function renderChatList(){
  $('chat-list').replaceChildren(...state.chats.map(chat=>{const b=text('button',chat.title,'saved-chat-row');b.type='button';b.setAttribute('aria-current',String(chat.id===state.active));const subtitle=text('small',`${chat.messages.filter(m=>m.role==='user').length} messages · ${chat.provider==='gemini'?'Gemini':'Qwen'}`);b.append(subtitle);b.disabled=!!run;b.onclick=()=>{state.active=chat.id;pending=[];renderPreviews();save();render();status();$('history-dialog').close();};return b;}));
}
function controls(){const busy=!!run||preparing,c=current(),last=c.messages.at(-1),available=!!ready[c.provider];$('send').disabled=busy||!available||(c.search&&!ready.search)||!($('prompt').value.trim()||pending.length)||(c.search&&!$('query').value.trim());$('send').hidden=busy;$('stop').hidden=!busy;$('prompt').disabled=busy;$('image').disabled=busy;$('model').disabled=busy;$('search').disabled=busy;$('query').disabled=busy;$('retry').hidden=busy||!available||!(last?.role==='user'||last?.status==='interrupted');$('switch-retry').hidden=busy||!ready.qwen||c.provider!=='gemini'||last?.errorCode!=='limit';$('history').disabled=busy;$('new-chat').disabled=busy;$('delete-chat').disabled=busy;$('messages').setAttribute('aria-busy',String(busy));}
function status(){const c=current();$('status').textContent=!ready[c.provider]?`${c.provider} key is not configured`:c.search&&!ready.search?'Search key is not configured':'Ready';controls();renderUsage();}
async function refresh(){try{const r=await fetch('/assets/quick-ai-config.json',{cache:'no-store'});if(!r.ok)throw Error('Configuration unavailable');const config=await r.json();if(config.version!==3)throw Error('Quick Chat needs its new configuration');keys={geminiKey:config.geminiKey||'',groqKey:config.groqKey||'',tavilyKey:config.tavilyKey||''};ready={gemini:!!keys.geminiKey,qwen:!!keys.groqKey,search:!!keys.tavilyKey};status();}catch(error){$('status').textContent=error.message;}}
$('prompt').oninput=()=>{autosize($('prompt'));current().draft=$('prompt').value;if(current().search&&!$('query').dataset.edited)$('query').value=$('prompt').value.trim().slice(0,350);save();controls();};
$('query').oninput=()=>{$('query').dataset.edited='yes';controls();};
$('prompt').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();$('composer').requestSubmit();}};
$('model').onchange=()=>{current().provider=$('model').value;save();status();};$('search').onchange=()=>{current().search=$('search').checked;$('search-row').hidden=!current().search;if(current().search&&!$('query').dataset.edited)$('query').value=$('prompt').value.trim().slice(0,350);save();status();};
$('history').onchange=()=>{state.active=$('history').value;pending=[];save();render();status();};
$('new-chat').onclick=()=>{if(run)return;if(current().messages.length){if(state.chats.length>=50){$('status').textContent='Delete an older chat before creating another.';return;}create();pending=[];save();render();status();} $('prompt').focus();};
$('delete-chat').onclick=async()=>{if(run||!confirm('Delete this chat and its images from this device?'))return;const old=current();state.chats=state.chats.filter(c=>c!==old);if(!state.chats.length)create();else state.active=state.chats[0].id;pending=[];const removed=save();render();status();if(!removed)return;for(const id of old.messages.flatMap(m=>m.attachments||[]))try{await db.delete(id);}catch{warn('Some local images could not be removed.');}};
$('image').onchange=async e=>{for(const file of e.target.files){if(pending.length>=3){$('status').textContent='Up to three images per request.';break;}try{const blob=await prepareImage(file);pending.push({id:crypto.randomUUID(),blob});}catch(error){$('status').textContent=error.message;}}e.target.value='';renderPreviews();controls();};
window.addEventListener('paste',async e=>{const files=[...(e.clipboardData?.files||[])].filter(f=>f.type.startsWith('image/'));if(!files.length)return;e.preventDefault();for(const file of files){if(pending.length>=3)break;try{pending.push({id:crypto.randomUUID(),blob:await prepareImage(file)});}catch(error){$('status').textContent=error.message;}}renderPreviews();controls();});
function renderPreviews(){$('previews').replaceChildren(...pending.map(item=>{const box=text('div','','preview');const img=document.createElement('img'),url=URL.createObjectURL(item.blob);img.src=url;img.alt='Image preview';img.onload=()=>URL.revokeObjectURL(url);const b=text('button','Remove','text-button');b.type='button';b.onclick=()=>{pending=pending.filter(p=>p!==item);renderPreviews();controls();};box.append(img,b);return box;}));}
$('stop').onclick=()=>run?.controller.abort();$('retry').onclick=()=>send(true);$('switch-retry').onclick=()=>{current().provider='qwen';save();render();send(true);};$('composer').onsubmit=e=>{e.preventDefault();send(false);};
async function send(retry){if(run||preparing||!ready[current().provider])return;const c=current();let user;
  if(retry){user=c.messages.findLast(m=>m.role==='user');if(!user||c.messages.at(-1)?.role==='assistant'&&c.messages.at(-1).status==='complete')return;}
  else{const content=$('prompt').value.trim();if(!content&&!pending.length)return;if(c.search&&!$('query').value.trim()){$('status').textContent='Enter a search query.';return;}user={role:'user',content,attachments:pending.map(p=>p.id),search:c.search,query:$('query').value.trim()};
    // Commit images before changing saved chat state.
    preparing=true;controls();try{for(const p of pending)await db.put(p.id,p.blob);}catch(error){preparing=false;controls();$('status').textContent='Image storage failed. Nothing was sent; retry or free device storage.';return;}
    c.messages.push(user);c.draft='';if(c.messages.length===1)c.title=(content||'Image question').slice(0,60);pending=[];renderPreviews();$('query').value='';delete $('query').dataset.edited;}
  if(retry){user.search=c.search;if(c.search){user.query=$('query').value.trim()||user.query||user.content;if(!user.query){$('status').textContent='Enter a search query.';return;}}save();}
  preparing=true;controls();let selected;try{selected=selectedMessages(c.messages);const count=selected.messages.reduce((n,m)=>n+(m.attachments?.length||0),0);if(count>3)throw Error('A request supports at most three images, including earlier images. Start a new chat or reduce images.');
    const payload=[];for(const m of selected.messages){const images=[];for(const id of m.attachments||[]){const blob=await db.get(id);if(!blob)throw Error('An earlier image is missing. Reattach it in a new message.');images.push(await blobData(blob));}payload.push({role:m.role,content:m.content,images,provider:m.provider,continuation:c.provider==='gemini'&&m.provider==='gemini'?m.continuation:null});}selected.messages=payload;
  }catch(error){preparing=false;$('status').textContent=error.message;save();render();return;}
  const reply={role:'assistant',provider:c.provider,model:MODELS[c.provider],content:'',status:'streaming'};c.messages.push(reply);const controller=new AbortController();run={controller};preparing=false;save();render();$('messages').scrollTop=$('messages').scrollHeight;$('status').textContent=selected.omitted?'Thinking · older context omitted…':'Thinking…';let lastSave=0,paintFrame;
  const article=$('messages').lastElementChild,body=article.querySelector('.body');
  try{const result=await streamReply({keys,provider:c.provider,messages:selected.messages,search:user.search,query:user.query||user.content,retry,signal:controller.signal,onEvent:(type,data,content)=>{
    if(type==='searchUsage'){user.searchCredits=(user.searchCredits||0)+data.credits;save();renderUsage();}
    if(type==='metadata'){reply.provider=data.provider;reply.model=data.model;reply.sources=data.search;reply.allowance=data.allowance;}
    if(type==='continuation')reply.continuation=data;
    if(type==='usage')reply.usage={input:Number(data.promptTokenCount??data.prompt_tokens??0),output:Number(data.candidatesTokenCount??data.completion_tokens??0)};
    if(type==='text'){const panel=$('messages'),nearBottom=panel.scrollHeight-panel.clientHeight-panel.scrollTop<100;reply.content=content;if(!paintFrame)paintFrame=requestAnimationFrame(()=>{paintFrame=null;bodyRender(body,reply);if(nearBottom)panel.scrollTop=panel.scrollHeight;else $('new-reply').hidden=false;});$('status').textContent='Replying…';if(Date.now()-lastSave>1000){save();lastSave=Date.now();}if(nearBottom)panel.scrollTop=panel.scrollHeight;else $('new-reply').hidden=false;}
    if(type==='complete')reply.truncated=data.truncated;
  }});reply.status='complete';reply.content=result.content;status();}
  catch(error){reply.status='interrupted';reply.errorCode=error.code||'';reply.allowance=error.allowance;$('status').textContent=controller.signal.aborted?'Stopped. Tap Retry.':error.message||'Connection failed. Tap Retry.';controls();}
  finally{if(paintFrame)cancelAnimationFrame(paintFrame);run=null;save();render();}
}
window.addEventListener('pagehide',()=>{run?.controller.abort();save();});
render();refresh();

$('chat-drawer').onclick=()=>{renderChatList();$('history-dialog').showModal();};
$('drawer-new').onclick=()=>{$('history-dialog').close();$('new-chat').click();};
$('quick-menu').onclick=()=>sheet('Quick AI',[{label:'New conversation',icon:'plus',disabled:!!run,action:()=>$('new-chat').click()},{label:'Saved conversations',icon:'chat',action:()=>$('chat-drawer').click()},{label:'Chat information',icon:'info',action:()=>{$('info-dialog').showModal();renderUsage();}},{label:'Delete this conversation',disabled:!!run,action:()=>$('delete-chat').click()}]);
$('new-reply').onclick=()=>{$('messages').scrollTop=$('messages').scrollHeight;$('new-reply').hidden=true;};
$('messages').addEventListener('scroll',()=>{const p=$('messages');if(p.scrollHeight-p.clientHeight-p.scrollTop<100)$('new-reply').hidden=true;},{passive:true});
