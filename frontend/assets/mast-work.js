import {richText} from './ui.js';
// Explicit owner requests and authenticated reports. This UI never runs jobs.
export function createMastWork({api,storage,panel,status,onCreated,onError}){
  const key='jarvis.mast.work-intent.v1',list=panel.querySelector('#work-list'),form=panel.querySelector('form'),retry=panel.querySelector('#work-retry-intent');
  let pending=null,busy=false,loading=false,sourceId=null;
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  function restore(){const raw=storage?.getItem(key);if(!raw)return;const r=JSON.parse(raw);if(r.device!==api.deviceId){storage.removeItem(key);return;}if(!['create','cancel','retry'].includes(r.op)||typeof r.args!=='object'||!r.args)throw Error('Unrecognized saved Muse request. Do not create a replacement until the previous outcome is checked.');pending=r;retry.hidden=false;retry.textContent='Retry unconfirmed '+r.op;}
  function clear(){storage?.removeItem(key);pending=null;retry.hidden=true;}
  async function submit(op,args){
    if(busy)return;busy=true;
    try{
      restore();if(pending&&(pending.op!==op||JSON.stringify(pending.args)!==JSON.stringify(args)))throw Error('Resolve the previous unconfirmed request first.');
      if(!storage)throw Error('Tab storage is required to preserve the request ID.');pending={device:api.deviceId,op,args};storage.setItem(key,JSON.stringify(pending));retry.hidden=false;
      const result=await api.mastWork(op,args);clear();if(op==='create'){form.reset();sourceId=null;form.elements.body.readOnly=false;form.elements.body.required=true;}status.textContent='Muse request saved. Execution is not implied.';onCreated();await refresh();return result;
    }catch(e){status.textContent=e.message;retry.textContent='Retry unconfirmed '+op;if(!api.hasCredential)onError(e);}finally{busy=false;}
  }
  function row(j){
    const card=el('article',null,'mast-work-row'),heading=el('h3',j.title),state=el('p',j.cancelRequested&&!['cancelled','completed','failed'].includes(j.stage)?'Cancellation requested · stop not confirmed':({queued:'Queued · no execution reported',running:'Running · authenticated runtime report',waiting_for_owner:'Waiting for owner',completed:'Completion reported by Muse',failed:'Failure reported by Muse',cancelled:'Cancellation acknowledged by Muse',outcome_unknown:'Outcome unknown · completion unverified'})[j.stage]);
    card.append(heading,state);
    if(j.spec.projectTitle)card.append(el('p',j.spec.projectTitle+(j.spec.goalTitle?' · '+j.spec.goalTitle:''),'request-meta'));
    if(j.summary)card.append(el('p',j.summary));
    if(j.plan){const plan=el('details'),summary=el('summary','Plan · revision '+j.plan.revision);plan.append(summary,el('p',j.plan.goal));const steps=el('ol');for(const s of j.plan.steps)steps.append(el('li',s));plan.append(steps);card.append(plan);}
    const chat=el('button','View conversation and files');chat.type='button';chat.onclick=()=>document.getElementById('chat-tab').click();card.append(chat);
    const original=el('details');original.append(el('summary','Original request · '+j.actionKind),el('p',j.body));card.append(original);
    if(j.latestResult){const output=el('section'),body=el('div',null,'rich-body');richText(body,j.latestResult.body);output.append(el('h4','Result · version '+j.latestResult.version),body);
      output.append(el('p',j.completion?'Completion report applies to result version '+j.completion.resultVersion+'.'+(j.completion.resultVersion!==j.latestResult.version?' The latest correction is not covered by that report.':''):'Saved result; completion has not been reported.','request-meta'));card.append(output);
      if(j.resultHistory.length>1){const versions=el('details');versions.append(el('summary','Original result and correction history'));for(const r of j.resultHistory){const body=el('div',null,'rich-body');richText(body,r.body);versions.append(el('h4','Version '+r.version),el('p',r.correctionSummary||'Original accepted reply'),body);}card.append(versions);}
    }
    if(!['completed','failed','cancelled'].includes(j.stage)&&!j.cancelRequested){const cancel=el('button','Request cancellation');cancel.type='button';cancel.onclick=()=>submit('cancel',{job_id:j.id,event_id:crypto.randomUUID()});card.append(cancel);}
    if(j.retryAllowed){const again=el('button','Retry as a new attempt');again.type='button';again.onclick=()=>{if(j.retryRequiresConfirmation&&!confirm('The earlier execution outcome may be unknown. Creating another attempt could duplicate actions. Continue?'))return;submit('retry',{job_id:j.id,id:crypto.randomUUID(),confirm_duplicate_risk:j.retryRequiresConfirmation});};card.append(again);}
    const detail=el('details');detail.append(el('summary','Activity and report provenance'));detail.addEventListener('toggle',async()=>{if(!detail.open||detail.dataset.loaded)return;try{const data=await api.mastWork('read',{job_id:j.id});for(const e of data.events)detail.append(el('p',e.createdAt+' · '+e.op+(e.summary?' · '+e.summary:'')));detail.dataset.loaded='true';}catch(e){status.textContent=e.message;if(!api.hasCredential)onError(e);}});card.append(detail);
    return card;
  }
  async function refresh(){
    if(loading||!api.hasCredential)return;loading=true;
    try{restore();let after='0';const jobs=[];do{const data=await api.mastWork('list',{after});jobs.push(...data.jobs);after=data.nextCursor;}while(after);
      list.replaceChildren(...jobs.reverse().map(row));if(!jobs.length)list.append(el('p','No Muse work requests yet. Requests stay separate from Lucy’s Work history.'));
    }catch(e){status.textContent=e.message;if(!api.hasCredential){reset();onError(e);}}finally{loading=false;}
  }
  form.onsubmit=event=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));submit('create',{id:sourceId||crypto.randomUUID(),title:data.title,body:data.body,action_kind:data.action_kind,...(data.project_title?{project_title:data.project_title}:{}),...(data.goal_title?{goal_title:data.goal_title}:{})});};
  retry.onclick=()=>{if(pending)submit(pending.op,pending.args);};
  function reset(){try{clear();}finally{pending=null;sourceId=null;form.reset();form.elements.body.readOnly=false;form.elements.body.required=true;list.replaceChildren();}}
  function prepare(message){sourceId=message.id;form.elements.title.value=message.body.slice(0,120)||'Attached request';form.elements.body.value=message.body;form.elements.body.readOnly=true;form.elements.body.required=false;form.closest('details').open=true;}
  return {refresh,reset,prepare};
}
