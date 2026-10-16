import {avatar} from './private-avatars.js';
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
 const section=node('section',null,'shared-board');section.setAttribute('aria-label','Group conversation');
 const scope=node('p','Future Jarvis project messages shared with this group.','board-note'),connection=node('p','Checking access…','board-note'),members=node('details'),memberList=node('div');members.append(node('summary','People & access'),memberList);
 const details=node('details',null,'board-details');details.append(node('summary','Group details'),scope,connection,members);
 const scroll=node('div',null,'board-chat-scroll');scroll.tabIndex=0;scroll.setAttribute('aria-label','Conversation history');
 const log=node('div',null,'board-messages');log.setAttribute('aria-label','Shared messages');
 const empty=node('div',null,'board-chat-empty');empty.append(node('p','No messages yet.'));
 const status=node('p','','board-status');status.setAttribute('role','status');
 const more=button('Load more messages',()=>load(false));more.className='board-load-more';
 const form=node('form',null,'board-composer'),label=node('label','Message the group','sr-only'),input=node('textarea');input.id='board-message';input.rows=2;input.maxLength=6000;label.htmlFor=input.id;input.placeholder='Message Lucy, Mast & Makima…';
 const replyLabel=node('p','','board-reply'),cancelReply=button('Cancel reply',()=>{replyTo=null;sync();});
 const send=node('button','↑','board-send');send.type='submit';send.setAttribute('aria-label','Send message');
 const check=button('Check whether saved',()=>recover()),retry=button('Retry exact message',()=>post(true));
 const actions=node('div',null,'board-actions');actions.append(check,retry,cancelReply);
 const composerRow=node('div',null,'board-composer-row');composerRow.append(label,input,send);
 form.append(replyLabel,composerRow,actions,node('p','Replies appear when agents check in.','board-note'));
 const taskView=renderBoardTasks({api,node,button,onError:fail});
 const activation=renderBoardActivation({api,node,button,onActive:()=>load(true),onError:fail});
 details.append(activation.element,taskView.element,node('p','Access does not mean an agent is online. Messages are saved here; delivery and reading are not confirmed.','board-note'));
 scroll.append(details,empty,log,more);section.append(scroll,status,form);container.append(section);
 let active=false,alive=true,loading=false,cursor='0',replyTo=null,initialized=false;
 const rebinds=new Map();
 const decisions=new Map(),approvalWrites=new Set();
 const saved=new Map(),write=createBoardWrite({send:p=>api.send(p),lookup:id=>api.lookup(id),matches:(m,p)=>m.id===p.id&&m.identity==='owner'&&m.kind==='message'&&m.body===p.body&&m.replyTo===(p.reply_to??null)&&!m.approval&&!m.approvalRequest&&!m.resultLinks.length});
 function sync(){input.disabled=!active||!!write.pending;send.disabled=!active||loading||write.busy||!!write.pending||!input.value.trim();check.hidden=!write.pending;check.disabled=write.busy;retry.hidden=!write.canRetry;retry.disabled=write.busy;cancelReply.hidden=!replyTo;cancelReply.disabled=!!write.pending;replyLabel.hidden=!replyTo;replyLabel.textContent=replyTo?'Replying to '+(names[saved.get(replyTo)?.identity]||'a message'):'';more.disabled=loading;more.hidden=initialized&&cursor===null;}
 input.addEventListener('input',sync);
 function fail(error,writeFailure=false){if(!alive)return;if(['expired','revoked','unauthorized'].includes(error.kind)){onAccessLost();return;}status.textContent=writeFailure?'Save not confirmed. Your exact message is preserved. Check whether it was saved before retrying.':error.status===404||error.status===503?'Shared board is not available from this service yet.':'Could not load the board. Refresh to try again.';}
 function add(m){if(saved.has(m.id))return;saved.set(m.id,m);empty.hidden=true;const row=node('article',null,'board-message');row.id='board-'+m.id;row.dataset.messageId=m.id;row.dataset.identity=m.identity;
  const content=node('div',null,'board-message-content'),byline=node('div',null,'board-message-byline'),time=node('time',new Date(m.createdAt).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}));time.dateTime=m.createdAt;time.title=new Date(m.createdAt).toLocaleString();byline.append(avatar(m.identity),node('h3',names[m.identity]),time);content.append(byline);row.append(content);
  if(m.replyTo){const link=node('a','Reply to '+m.replyTo);link.href='#board-'+m.replyTo;link.onclick=e=>{e.preventDefault();const target=log.querySelector('[data-message-id="'+m.replyTo+'"]');if(target){target.tabIndex=-1;target.focus();target.scrollIntoView({block:'center'});}else status.textContent='Reply target is outside the loaded messages. Load more messages to find it.';};content.append(link);}
  content.append(node('p',m.body,'board-body'));
  if(m.kind==='approval'){content.append(node('p','Owner '+(m.approval.decision==='approve'?'approved':'declined')+' this exact request: '+m.approval.action+' · Target: '+m.approval.target+' · Version: '+m.approval.version+' · '+m.approval.question,'board-meta'));decisions.get(m.approval.requestId)?.markDecided();}
  const approvalDetails=node('details',null,'board-message-details');approvalDetails.append(node('summary','Review approval request'));
  const control=appendApprovalControls({row:approvalDetails,message:m,api,node,button,onSaved:add,onError:error=>fail(error),onPending:w=>approvalWrites.add(w)});if(control){content.append(approvalDetails);decisions.set(m.id,control);if([...saved.values()].some(other=>other.approval?.requestId===m.id))control.markDecided();}
  for(const url of m.resultLinks){const a=node('a',url);a.href=url;a.target='_blank';a.rel='noopener noreferrer';content.append(a);}
  const messageDetails=node('details',null,'board-message-details');messageDetails.append(node('summary','Message details'),node('p',(sourceNames[m.authenticationSource]||(m.identity==='owner'?'Authenticated owner':'Authenticated board agent'))+' · '+new Date(m.createdAt).toLocaleString(),'board-meta'));
  const messageActions=node('div',null,'board-message-actions');messageActions.append(button('Reply',()=>{if(write.pending){status.textContent='Resolve the pending save before starting another reply.';return;}replyTo=m.id;sync();input.focus();}),messageDetails);content.append(messageActions);const following=[...log.children].find(el=>saved.get(el.dataset.messageId)?.sequence>m.sequence);if(following)log.insertBefore(row,following);else log.append(row);
 }
 function showMembers(items){memberList.replaceChildren();for(const member of items){const entry=node('div',null,'board-member');const expired=Date.parse(member.expiresAt)<=Date.now();entry.append(node('p',names[member.agent]+' · '+(member.revokedAt?'Revoked '+new Date(member.revokedAt).toLocaleString():expired?'Expired '+new Date(member.expiresAt).toLocaleString():'Access expires '+new Date(member.expiresAt).toLocaleString())));
   if(!member.revokedAt&&!expired){const revoke=button('Revoke '+names[member.agent]+' access',async()=>{if(!confirm('Revoke '+names[member.agent]+' access to this shared board?'))return;revoke.disabled=true;try{await api.revoke(member.id);if(alive)await load(true);}catch(error){fail(error);status.textContent='Revocation outcome not confirmed. Refresh Board access to check the server state before trying again.';}});entry.append(revoke);}if(!expired||rebinds.get(member.agent)?.dirty){let control=rebinds.get(member.agent);if(!control||control.membershipId!==member.id&&!control.dirty){control=renderBoardRebind({member,api,node,button,onSaved:()=>load(true),onError:fail});rebinds.set(member.agent,control);}entry.append(control.element);}memberList.append(entry);}}
 async function load(reset=false){if(loading||!alive)return;if(!reset&&cursor===null)return;const followLatest=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<80;loading=true;sync();status.textContent='Loading messages…';try{const data=await api.read(reset?'0':cursor);if(!alive)return;active=data.active;activation.element.hidden=active;taskView.setActive(active);showMembers(data.members);connection.textContent=active?'Signed in as owner. This conversation is shared with the people who have access.':'This group needs setup. Open People & access below to review connections; use the setup controls to enable it.';
   // Messages are immutable; merge refreshes so pending decision controls survive.
   for(const m of data.messages)add(m);cursor=data.nextCursor;initialized=true;empty.hidden=!!saved.size;status.textContent=active?'': 'Group setup is needed. Open Group details to continue.';if(followLatest)scroll.scrollTop=scroll.scrollHeight;
  }catch(error){fail(error);}finally{loading=false;if(alive)sync();}}
 function accepted(m){if(!alive)return;add(m);input.value='';replyTo=null;status.textContent='Saved. Awaiting agent check-in.';scroll.scrollTop=scroll.scrollHeight;}
 async function post(retrying=false){if(!alive||write.busy||!active||(!retrying&&write.pending))return;try{const promise=retrying?write.retry():write.submit({body:input.value,reply_to:replyTo});sync();const m=await promise;accepted(m);}catch(error){fail(error,true);}finally{if(alive)sync();}}
 async function recover(){try{const promise=write.reconcile();sync();const m=await promise;if(!alive)return;if(m)accepted(m);else status.textContent='The original message was not found. You can retry the exact same message and ID.';}catch(error){fail(error,true);}finally{if(alive)sync();}}
 form.onsubmit=e=>{e.preventDefault();if(!send.disabled)post();};
 const beforeUnload=e=>{if(input.value||write.pending||taskView.dirty||activation.dirty||[...rebinds.values()].some(r=>r.dirty)||[...approvalWrites].some(w=>w.pending)){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',beforeUnload);
 sync();load();return {element:section,refresh:()=>load(true),destroy(){alive=false;taskView.destroy();activation.destroy();window.removeEventListener('beforeunload',beforeUnload);section.remove();}};
}
