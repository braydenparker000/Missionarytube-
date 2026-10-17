import {createBoardWrite} from './private-board-state.js';
export function appendApprovalControls({row,message,api,node,button,onSaved,onError,onPending}){
 const q=message.approvalRequest;if(!q)return;
 const box=node('section',null,'board-approval');box.append(node('h4','Decision requested'),node('p','Action: '+q.action),node('p','Target: '+q.target),node('p','Version: '+q.version),node('p',q.question),node('p','Expires '+new Date(q.expiresAt).toLocaleString()),node('p','This records your decision for this exact request. It does not grant project-tool access.','board-note'));
 const status=node('p');status.setAttribute('role','status');let decided=false;
 const matches=(m,p)=>m.id===p.id&&m.kind==='approval'&&m.identity==='owner'&&m.approval?.requestId===q.id&&m.approval.action===q.action&&m.approval.target===q.target&&m.approval.version===q.version&&m.approval.question===q.question&&m.approval.requestExpiresAt===q.expiresAt&&m.approval.decision===p.decision;
 const write=createBoardWrite({send:p=>api.approve(p,q),lookup:id=>api.lookup(id),matches});
 const approve=button('Approve exact request',()=>decide('approve')),decline=button('Decline request',()=>decide('decline')),check=button('Check saved decision',()=>recover()),retry=button('Retry exact decision',()=>retryWrite());
 function sync(){const expired=Date.parse(q.expiresAt)<=Date.now();approve.disabled=decline.disabled=expired||decided||!!write.pending;check.hidden=!write.pending;check.disabled=write.busy;retry.hidden=!write.canRetry;retry.disabled=write.busy;onPending(write);if(expired&&!write.pending&&!decided)status.textContent='This request has expired.';}
 function accepted(m){decided=true;status.textContent='Your exact decision is recorded.';onSaved(m);}
 async function perform(fn){try{const p=fn();sync();const m=await p;if(m)accepted(m);else status.textContent='Decision not found. You can retry the exact decision and ID.';}catch(error){status.textContent='Decision save not confirmed. Check its saved status before retrying.';onError(error);}finally{sync();}}
 async function decide(decision){if(write.pending||decided||Date.parse(q.expiresAt)<=Date.now())return;if(!confirm((decision==='approve'?'Approve':'Decline')+' this exact request?\n\n'+q.action+'\nTarget: '+q.target+'\nVersion: '+q.version+'\n'+q.question+'\nExpires: '+q.expiresAt))return;await perform(()=>write.submit({request_id:q.id,decision}));}
 const recover=()=>perform(()=>write.reconcile()),retryWrite=()=>perform(()=>write.retry());
 box.append(approve,decline,check,retry,status);row.append(box);sync();return {markDecided(){decided=true;sync();},write};
}
