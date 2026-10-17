import {el, icon, richText, sheet, copyText, readLocal, writeLocal, autosize, messageDay} from './ui.js';
import {publicReportLabel} from './public-coordination.js';

// Keep existing nodes and their scroll anchors across inbox refreshes.
export function conversation({panel, composer, channel, author, body=m=>m.body, notify=()=>{}, draftChanged=()=>{}, emptyTitle='What’s on your mind?', emptyDescription='Write a message to '+author+'.', scope='',dateGroups=false} ){
  let messages=[], query='', savedOnly=false, first=true, timer, start, deliveryBusy=false, deliveryError=false;
  const key='jarvis.'+channel+'.bookmarks.v1';
  const raw=readLocal(key,[]), bookmarks=new Set(Array.isArray(raw)?raw:[]);
  const formatter=new Intl.DateTimeFormat(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
  const clockFormat=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'});
  const savedPosition=readLocal('jarvis.'+channel+'.reading.v1',null);
  const jump=el('button','New messages','new-messages');jump.type='button';jump.hidden=true;panel.after(jump);
  const completeBody=m=>body(m)+(m.kind==='coordination'?m.publicReport.artifacts.map(item=>'\n'+item.label+' · revision '+item.revision+': '+item.url).join(''):'');
  jump.onclick=()=>{query='';savedOnly=false;const input=document.getElementById('conversation-search');if(input)input.value='';update(messages);panel.scrollTop=panel.scrollHeight;jump.hidden=true;};
  function showActions(id){if(document.querySelector('.app-sheet[open]'))return;const m=messages.find(x=>x.id===id);if(!m)return;sheet(m.role==='user'?'Your message':author,[
    {label:'Copy message',icon:'copy',action:async()=>notify(await copyText(completeBody(m))?'Copied':'Select the message text to copy it')},
    {label:bookmarks.has(id)?'Remove bookmark':'Bookmark',icon:'bookmark',action:()=>{bookmarks.has(id)?bookmarks.delete(id):bookmarks.add(id);if(!writeLocal(key,[...bookmarks]))notify('Bookmark could not be saved');update(messages);}},
    {label:'Quote in reply',icon:'quote',action:()=>{const quoted=completeBody(m).slice(0,900).split('\n').map(s=>'> '+s).join('\n');composer.value=(composer.value?composer.value+'\n\n':'')+quoted+'\n\n';composer.value=composer.value.slice(0,composer.maxLength>0?composer.maxLength:16000);draftChanged(composer.value);autosize(composer);composer.focus();composer.setSelectionRange(composer.value.length,composer.value.length);}},
    ...(m.kind==='coordination'?[{label:'Public report details',icon:'info',action:()=>{const report=m.publicReport,detail=sheet('Public report',[]);
      detail.append(el('p',publicReportLabel(m),'sheet-context'),el('p','This is a public report published through GitHub. The destination does not verify an agent’s identity or attest private execution.','sheet-note'),
        el('p','Attempt: '+report.attemptId+'\nRecorded: '+report.recordedAt+'\nPublished: '+report.provenance.publishedAt,'sheet-context'));
      const link=el('a','View source publication','sheet-action');link.href='https://github.com/braydenparker999/jarvis/issues/2#issuecomment-'+report.provenance.commentId;link.target='_blank';link.rel='noopener noreferrer';detail.append(link);}}]:[]),
  ]);}
  panel.addEventListener('click',e=>{const a=e.target.closest('[data-message-actions]');if(a)showActions(a.dataset.messageActions);});
  panel.addEventListener('contextmenu',e=>{const row=e.target.closest('[data-message-id]');if(row && !e.target.closest('a')){e.preventDefault();showActions(row.dataset.messageId);}});
  panel.addEventListener('pointerdown',e=>{if(e.target.closest('a,button')||e.button>0)return;const row=e.target.closest('[data-message-id]');if(!row)return;start={x:e.clientX,y:e.clientY};timer=setTimeout(()=>{timer=null;showActions(row.dataset.messageId);},550);},{passive:true});
  panel.addEventListener('pointermove',e=>{if(start && Math.hypot(e.clientX-start.x,e.clientY-start.y)>8)clearTimeout(timer);},{passive:true});
  for(const event of ['pointerup','pointercancel','scroll'])panel.addEventListener(event,()=>clearTimeout(timer),{passive:true});
  panel.addEventListener('scroll',()=>{if(panel.scrollHeight-panel.clientHeight-panel.scrollTop<50)jump.hidden=true;},{passive:true});
  function position(){const r=panel.getBoundingClientRect();const visible=[...panel.children].find(n=>n.dataset.messageId&&n.getBoundingClientRect().bottom>=r.top);return {id:visible?.dataset.messageId,offset:visible?visible.getBoundingClientRect().top-r.top:0,bottom:panel.scrollHeight-panel.clientHeight-panel.scrollTop<70};}
  function update(next){
    const oldIds=new Set(messages.map(x=>x.id)), anchor=position();messages=next;
    const answered=new Set(next.filter(m=>m.kind==='reply').map(m=>m.replyTo));
    const selected=next.filter(m=>(!savedOnly||bookmarks.has(m.id))&&(!query||completeBody(m).toLowerCase().includes(query)));
    const existing=new Map([...panel.children].filter(n=>n.dataset.messageId).map(n=>[n.dataset.messageId,n]));
    panel.querySelector('.chat-empty')?.remove();
    const wanted=new Set(selected.map(m=>m.id));for(const [id,n] of existing)if(!wanted.has(id))n.remove();
    let previousDay;
    for(let i=0;i<selected.length;i++){
      const m=selected[i];let row=existing.get(m.id);
      if(!row){row=el('article','','message-row '+(m.role==='user'?'outgoing':'incoming'));row.dataset.messageId=m.id;
        const header=el('div','','message-heading');header.append(el('span',m.role==='user'?'You':author,'message-author'));
        const action=el('button','','message-actions');action.type='button';action.dataset.messageActions=m.id;action.setAttribute('aria-label','Message actions');action.innerHTML=icon('more');header.append(action);
        if(dateGroups&&channel==='relay'){const footer=el('div','','message-footer'),bubble=el('div','','bubble');footer.append(el('span','','message-time'),action);bubble.append(el('div','','message-body rich-body'),footer);row.append(header,bubble);}else if(dateGroups){const footer=el('div','','message-footer');footer.append(el('span','','message-time'),action);row.append(header,el('div','','bubble rich-body'),footer);}else row.append(header,el('div','','bubble rich-body'),el('span','','message-time'));
      }
      if(dateGroups){const day=messageDay(m.createdAt),label=previousDay!==day.key?day.label:'';previousDay=day.key;let divider=row.querySelector('.message-day');if(label){if(!divider){divider=el('p','','message-day');row.insertBefore(divider,row.firstChild);}divider.textContent=label;}else divider?.remove();}
      row.classList.toggle('bookmarked',bookmarks.has(m.id));
      const prior=selected[i-1];row.classList.toggle('message-group-continuation',channel==='relay'&&!!prior&&prior.role===m.role&&publicReportLabel(prior)===publicReportLabel(m)&&messageDay(prior.createdAt).key===messageDay(m.createdAt).key&&Date.parse(m.createdAt)-Date.parse(prior.createdAt)<300000);
      const reportLabel=publicReportLabel(m);
      row.querySelector('.message-author').textContent=reportLabel|| (m.role==='user'?'You':author);
      if(reportLabel)row.setAttribute('aria-label',reportLabel+' · public report; no private execution authority');
      const content=body(m);if(row._body!==content){richText(row.querySelector('.message-body')||row.querySelector('.bubble'),content);row._body=content;}
      if(m.kind==='coordination'&&row._report!==JSON.stringify(m.publicReport)){
        const bubble=row.querySelector('.message-body')||row.querySelector('.bubble');richText(bubble,content);
        for(const item of m.publicReport.artifacts){const p=el('p'),link=el('a',item.label+' · revision '+item.revision);link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';p.append(link);bubble.append(p);}
        const note=el('p','Public report · private execution unverified.','message-time');bubble.append(note);
        row._report=JSON.stringify(m.publicReport);
      }
      const stamp=(dateGroups?clockFormat:formatter).format(new Date(m.createdAt));
      const sendLabels={rejected:'Send rejected · text saved on this device',conflict:'ID conflict · original text saved',unknown:'Send unconfirmed · queued on this device'};
      const statusText=stamp+(m.localOnly?' · Local history · on this device':m.role==='user'?' · '+(!m.saved?sendLabels[m.sendState]||(deliveryError?'Send unconfirmed · queued on this device':deliveryBusy?'Sending to public inbox':'Queued on this device'):answered.has(m.id)?'Saved':'Awaiting reply'):'')+(bookmarks.has(m.id)?' · Bookmarked':'');
      const timestamp=row.querySelector(dateGroups?'.message-footer > .message-time':':scope > .message-time');
      if(row._stamp!==statusText){timestamp.textContent=statusText;row._stamp=statusText;}
      timestamp.dataset.pending=String(!m.localOnly&&m.role==='user'&&(!m.saved||!answered.has(m.id)));
      if(panel.children[i]!==row)panel.insertBefore(row,panel.children[i]||null);
    }
    if(!selected.length){const empty=el('div','','chat-empty');if(scope&&!query&&!savedOnly)empty.append(el('p',scope,'empty-label'));empty.append(el('h2',query?'No matching messages':savedOnly?'No bookmarks yet':deliveryBusy&&!messages.length?'Opening your conversation…':emptyTitle),el('p',query?'Try a different phrase.':savedOnly?'Bookmark a message from its menu.':deliveryError&&!messages.length?'The inbox is unavailable. Your draft stays on this device; use Retry sync to try again.':deliveryBusy&&!messages.length?'Checking the shared inbox.':emptyDescription));panel.append(empty);}
    if(first){first=false;if(savedPosition?.id){const row=[...panel.children].find(n=>n.dataset.messageId===savedPosition.id);if(row)panel.scrollTop+=row.getBoundingClientRect().top-panel.getBoundingClientRect().top-savedPosition.offset;else panel.scrollTop=panel.scrollHeight;}else panel.scrollTop=panel.scrollHeight;}
    else if(!query&&!savedOnly){if(anchor.bottom){panel.scrollTop=panel.scrollHeight;jump.hidden=true;}else{const row=[...panel.children].find(n=>n.dataset.messageId===anchor.id);if(row)panel.scrollTop+=row.getBoundingClientRect().top-panel.getBoundingClientRect().top-anchor.offset;if(next.some(m=>!oldIds.has(m.id)))jump.hidden=false;}}
  }
  return {update,setDelivery({busy=false,error=false}={}){deliveryBusy=busy;deliveryError=error;update(messages);},search(value){query=value.trim().toLowerCase();savedOnly=false;update(messages);panel.scrollTop=0;},bookmarks(value){savedOnly=typeof value==='boolean'?value:!savedOnly;query='';update(messages);panel.scrollTop=0;return savedOnly;},latest(){query='';savedOnly=false;update(messages);panel.scrollTop=panel.scrollHeight;},savePosition(){writeLocal('jarvis.'+channel+'.reading.v1',position());},actions:showActions};
}
