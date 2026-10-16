import {renderBoardRebind} from './private-board-rebind.js';
import {renderBoardTasks} from './private-board-tasks.js';
import {renderBoardActivation} from './private-board-activation.js';
import {appendApprovalControls} from './private-board-approvals.js';
import {createBoardWrite} from './private-board-state.js';
const sourceNames={'owner-device-session':'Owner device session','owner-password-session':'Owner account session','lucy-oauth-mcp':'Lucy · ChatGPT connection','mast-muse-profile':'Mast · Muse connection','makima-oauth-mcp':'Makima · OAuth connection'};
const names={owner:'You',lucy:'Lucy',mast:'Mast',makima:'Makima'};
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn)=>{const n=node('button',text);n.type='button';n.onclick=fn;return n;};
export function renderBoard({container,api,onAccessLost}){
 const section=node('section',null,'shared-board');section.setAttribute('aria-label','Shared agent board');
 const header=node('header'),heading=node('h2','Shared board'),scope=node('p','You · Lucy · Mast · Makima. Future Jarvis project messages only.','board-note');
 const connection=node('p','Checking board access…','board-note'),members=node('details'),memberList=node('div');members.append(node('summary','Board access'),memberList);
 header.append(heading,scope,connection,members);
 const log=node('div',null,'board-messages');log.setAttribute('aria-label','Shared messages');
 const status=node('p','','board-status');status.setAttribute('role','status');
 const more=button('Load more messages',()=>load(false));
 const form=node('form',null,'board-composer'),label=node('label','Message everyone on this board'),input=node('textarea');input.id='board-message';input.rows=3;input.maxLength=6000;label.htmlFor=input.id;input.placeholder='Write a shared project message…';
 const replyLabel=node('p','','board-reply'),cancelReply=button('Cancel reply',()=>{replyTo=null;sync();});
 const send=node('button','Send to board');send.type='submit';
 const check=button('Check whether saved',()=>recover()),retry=button('Retry exact message',()=>post(true));
 const actions=node('div',null,'board-actions');actions.append(send,check,retry,cancelReply);
 form.append(replyLabel,label,input,actions,node('p','Messages are saved to this board. Agent reads and replies happen separately; Makima checks during host runs.','board-note'));
 const taskView=renderBoardTasks({api,node,button,onError:fail});
 const activation=renderBoardActivation({api,node,button,onActive:()=>load(true),onError:fail});
 section.append(header,activation.element,log,more,status,form,taskView.element);container.append(section);
 let active=false,alive=true,loading=false,cursor='0',replyTo=null,initialized=false;
 const rebinds=new Map();
 const decisions=new Map(),approvalWrites=new Set();
 const saved=new Map(),write=createBoardWrite({send:p=>api.send(p),lookup:id=>api.lookup(id),matches:(m,p)=>m.id===p.id&&m.identity==='owner'&&m.kind==='message'&&m.body===p.body&&m.replyTo===(p.reply_to??null)&&!m.approval&&!m.approvalRequest&&!m.resultLinks.length});
 function sync(){input.disabled=!active||!!write.pending;send.disabled=!active||loading||write.busy||!!write.pending||!input.value.trim();check.hidden=!write.pending;check.disabled=write.busy;retry.hidden=!write.canRetry;retry.disabled=write.busy;cancelReply.hidden=!replyTo;cancelReply.disabled=!!write.pending;replyLabel.hidden=!replyTo;replyLabel.textContent=replyTo?'Replying to '+(saved.get(replyTo)?.identity?names[saved.get(replyTo).identity]+' · ':'')+replyTo:'';more.disabled=loading;more.hidden=initialized&&cursor===null;}
 input.addEventListener('input',sync);
 function fail(error,writeFailure=false){if(!alive)return;if(['expired','revoked','unauthorized'].includes(error.kind)){onAccessLost();return;}status.textContent=writeFailure?'Save not confirmed. Your exact message is preserved. Check whether it was saved before retrying.':error.status===404||error.status===503?'Shared board is not available from this service yet.':'Could not load the board. Refresh to try again.';}
 function add(m){if(saved.has(m.id))return;saved.set(m.id,m);const row=node('article');row.id='board-'+m.id;row.dataset.messageId=m.id;row.append(node('h3',names[m.identity]),node('p',(sourceNames[m.authenticationSource]||(m.identity==='owner'?'Authenticated owner':'Authenticated board agent'))+' · '+new Date(m.createdAt).toLocaleString(),'board-meta'));
  if(m.replyTo){const link=node('a','Reply to '+m.replyTo);link.href='#board-'+m.replyTo;link.onclick=e=>{e.preventDefault();const target=log.querySelector('[data-message-id="'+m.replyTo+'"]');if(target){target.tabIndex=-1;target.focus();target.scrollIntoView({block:'center'});}else status.textContent='Reply target is outside the loaded messages. Load more messages to find it.';};row.append(link);}
  row.append(node('p',m.body,'board-body'));
  if(m.kind==='approval'){row.append(node('p','Owner '+(m.approval.decision==='approve'?'approved':'declined')+' this exact request: '+m.approval.action+' · Target: '+m.approval.target+' · Version: '+m.approval.version+' · '+m.approval.question,'board-meta'));decisions.get(m.approval.requestId)?.markDecided();}
  const control=appendApprovalControls({row,message:m,api,node,button,onSaved:add,onError:error=>fail(error),onPending:w=>approvalWrites.add(w)});if(control){decisions.set(m.id,control);if([...saved.values()].some(other=>other.approval?.requestId===m.id))control.markDecided();}
  for(const url of m.resultLinks){const a=node('a',url);a.href=url;a.target='_blank';a.rel='noopener noreferrer';row.append(a);}
  row.append(button('Reply',()=>{if(write.pending){status.textContent='Resolve the pending save before starting another reply.';return;}replyTo=m.id;sync();input.focus();}));const following=[...log.children].find(el=>saved.get(el.dataset.messageId)?.sequence>m.sequence);if(following)log.insertBefore(row,following);else log.append(row);
 }
 function showMembers(items){memberList.replaceChildren();for(const member of items){const entry=node('div',null,'board-member');const expired=Date.parse(member.expiresAt)<=Date.now();entry.append(node('p',names[member.agent]+' · '+(member.revokedAt?'Revoked '+new Date(member.revokedAt).toLocaleString():expired?'Expired '+new Date(member.expiresAt).toLocaleString():'Access expires '+new Date(member.expiresAt).toLocaleString())));
   if(!member.revokedAt&&!expired){const revoke=button('Revoke '+names[member.agent]+' access',async()=>{if(!confirm('Revoke '+names[member.agent]+' access to this shared board?'))return;revoke.disabled=true;try{await api.revoke(member.id);if(alive)await load(true);}catch(error){fail(error);status.textContent='Revocation outcome not confirmed. Refresh Board access to check the server state before trying again.';}});entry.append(revoke);}if(!expired||rebinds.get(member.agent)?.dirty){let control=rebinds.get(member.agent);if(!control||control.membershipId!==member.id&&!control.dirty){control=renderBoardRebind({member,api,node,button,onSaved:()=>load(true),onError:fail});rebinds.set(member.agent,control);}entry.append(control.element);}memberList.append(entry);}}
 async function load(reset=false){if(loading||!alive)return;if(!reset&&cursor===null)return;loading=true;sync();status.textContent='Loading shared messages…';try{const data=await api.read(reset?'0':cursor);if(!alive)return;active=data.active;activation.element.hidden=active;taskView.setActive(active);showMembers(data.members);connection.textContent=active?'Shared board active · signed in as owner':'This new board is not activated yet. No history is imported.';
   // Messages are immutable; merge refreshes so pending decision controls survive.
   for(const m of data.messages)add(m);cursor=data.nextCursor;initialized=true;status.textContent=saved.size?'Loaded saved board messages. No read or online status is available.':'No shared messages yet.';
  }catch(error){fail(error);}finally{loading=false;if(alive)sync();}}
 function accepted(m){if(!alive)return;add(m);input.value='';replyTo=null;status.textContent='Saved to the shared board. Agent delivery and reading are not confirmed.';}
 async function post(retrying=false){if(!alive||write.busy||!active||(!retrying&&write.pending))return;try{const promise=retrying?write.retry():write.submit({body:input.value,reply_to:replyTo});sync();const m=await promise;accepted(m);}catch(error){fail(error,true);}finally{if(alive)sync();}}
 async function recover(){try{const promise=write.reconcile();sync();const m=await promise;if(!alive)return;if(m)accepted(m);else status.textContent='The original message was not found. You can retry the exact same message and ID.';}catch(error){fail(error,true);}finally{if(alive)sync();}}
 form.onsubmit=e=>{e.preventDefault();if(!send.disabled)post();};
 const beforeUnload=e=>{if(input.value||write.pending||taskView.dirty||activation.dirty||[...rebinds.values()].some(r=>r.dirty)||[...approvalWrites].some(w=>w.pending)){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);
 sync();load();return {element:section,refresh:()=>load(true),destroy(){alive=false;taskView.destroy();activation.destroy();window.removeEventListener('beforeunload',beforeUnload);section.remove();}};
}
