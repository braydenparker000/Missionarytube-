import {renderCollaboration} from './private-collaboration.js';
import {readAccent,setAccent} from './private-theme.js';
import {createRelayMenuHistory} from './relay-menu-history.js';
import {readTaskPages,taskStatus} from './private-tasks.js';
import {createRelayOwnerApi,OWNER_SESSION_KEY} from './relay-owner-api.js';
const body=document.getElementById('view-body'),status=document.getElementById('workspace-status');
const navigation=createRelayMenuHistory({history,getURL:()=>location.href});
const drawer=document.getElementById('navigation-drawer'),picker=document.getElementById('agent-panel'),pickerButton=document.getElementById('agent-select');
const titles={lucy:'Lucy',mast:'Mast',makima:'Makima',tasks:'Tasks',collaboration:'Collaboration'},frames=new Map();let current=null,epoch=0,lastChat='lucy';
const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text)el.textContent=text;if(cls)el.className=cls;return el;};
const agentName=agent=>agent==='lucy'?'Lucy':'Mast';
function reader(agent){const bridge=frames.get(agent)?.contentWindow?.jarvisPrivateReader;if(bridge)return bridge;const api=createRelayOwnerApi();return {get connected(){return api.hasCredential;},list:()=>readTaskPages(cursor=>agent==='lucy'?api.jobs(cursor):api.mastWork('list',{after:cursor})),detail:id=>agent==='lucy'?api.jobDetail(id):api.mastWork('read',{job_id:id})};}
function empty(title,text,mark,badge){const section=node('section',null,'empty-state');section.append(node('i',mark,'avatar'),node('span',badge,'badge'),node('h2',title),node('p',text));body.append(section);}
function clearSurface(){for(const child of [...body.children]){if(child.tagName==='IFRAME'){child.hidden=true;child.inert=true;}else child.remove();}}
async function tasks(generation){const list=node('div',null,'tasks');body.append(list);
 await Promise.all(['lucy','mast'].map(async agent=>{const section=node('section',null,'task-source');section.dataset.agent=agent;section.append(node('h2',agentName(agent)));const note=node('p','Loading saved tasks…','source-note');section.append(note);list.append(section);const api=reader(agent);try{if(api.connected===false)throw Error('Sign in to this agent to load tasks.');const jobs=await api.list();if(epoch!==generation||current!=='tasks')return;note.textContent=jobs.length?'':'No saved tasks.';
 for(const job of jobs){const card=node('details',null,'task-card');card.dataset.agent=agent;card.dataset.taskId=job.id;card.append(node('summary',job.plan?.title||job.title));card.append(node('div',agentName(agent)+' · '+taskStatus(agentName(agent),job),'task-meta'));card.append(node('p',job.body));const link=node('a','Open '+agentName(agent)+' conversation');link.href='#'+agent;card.append(link);const evidence=node('details');evidence.append(node('summary','Original record & completion evidence'),node('pre',JSON.stringify(job,null,2)));card.append(evidence);let loaded=false;card.addEventListener('toggle',async()=>{if(!card.open||loaded)return;loaded=true;const detail=node('pre','Loading original updates…');evidence.append(detail);try{const data=await api.detail(job.id);if(epoch===generation&&card.isConnected)detail.textContent=JSON.stringify(data,null,2);}catch(error){if(epoch!==generation)return;detail.textContent='Updates unavailable. Refresh to try again.';if(['expired','revoked','unauthorized'].includes(error.kind))invalidate(true);}});section.append(card);}
 }catch(error){if(epoch!==generation)return;if(['expired','revoked','unauthorized'].includes(error.kind)){invalidate(true);return;}section.replaceChildren(node('h2',agentName(agent)),node('p',error.status===503?'Tasks are not available from this agent yet.':'Sign in to '+agentName(agent)+' or reconnect to load its private tasks.','source-note'));}}));
 if(epoch===generation)status.textContent='Makima is disconnected. No Makima tasks are queried.';
}
function show(){const next=location.hash.slice(1);current=Object.hasOwn(titles,next)?next:'lucy';if(['lucy','mast'].includes(current))lastChat=current;const chatLink=document.querySelector('#destinations a');chatLink.href='#'+lastChat;chatLink.dataset.view=lastChat;document.body.dataset.view=current;const generation=++epoch;clearSurface();status.textContent='';document.getElementById('view-title').textContent=titles[current];for(const option of picker.querySelectorAll('[data-agent]'))option.setAttribute('aria-pressed',String(option.dataset.agent===current));for(const link of document.querySelectorAll('a[data-view]')){if(link.dataset.view===current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}document.getElementById('refresh').hidden=current==='makima';
 if(['lucy','mast'].includes(current)){let frame=frames.get(current);if(!frame){frame=node('iframe');frame.title='Private conversation with '+titles[current];frame.src='/private/'+current+'.html';frames.set(current,frame);body.append(frame);}frame.hidden=false;frame.inert=false;status.textContent='To '+titles[current]+' only · private owner conversation';}
 else if(current==='tasks')tasks(generation);
 else if(current==='makima')empty('Makima will join later','Grokbot is not connected yet.','K','Disconnected · coming later');
 else {const bridge=[...frames.values()].map(f=>f.contentWindow?.jarvisPrivateReader).find(r=>r?.connected&&r.collaboration);const api=bridge||createRelayOwnerApi();if(!bridge&&!api.hasCredential)empty('Sign in to view collaboration','Open Lucy or Mast and sign in to your private owner account.','↔','Read-only');else renderCollaboration({container:body,api,isCurrent:()=>epoch===generation&&current==='collaboration',onAccessLost:()=>invalidate(true)});}
}
function invalidate(accessLost=false){navigation.invalidate();++epoch;for(const frame of frames.values())frame.remove();frames.clear();if(accessLost)history.replaceState(null,'','#lucy');show();}
addEventListener('hashchange',show);addEventListener('storage',event=>{if(event.key===OWNER_SESSION_KEY)invalidate();});
document.getElementById('refresh').onclick=()=>navigation.navigate(()=>{if(['tasks','collaboration'].includes(current))show();else frames.get(current)?.contentWindow?.jarvisPrivateReader?.refresh();});
show();
// Mobile keyboards resize the top-level visual viewport, not an iframe's visual viewport.
function fitViewport(){const viewport=window.visualViewport;if(viewport&&viewport.scale!==1)return;const height=viewport?.height||innerHeight;document.documentElement.style.setProperty('--private-height',Math.round(height)+'px');document.body.dataset.keyboard=String(innerHeight-height>120);}
fitViewport();window.visualViewport?.addEventListener('resize',fitViewport);addEventListener('resize',fitViewport);

for(const button of document.querySelectorAll('[data-chat-action]'))button.onclick=()=>navigation.navigate(()=>frames.get(current)?.contentDocument?.getElementById(button.dataset.chatAction)?.click());

pickerButton.onclick=()=>{picker.showModal();pickerButton.setAttribute('aria-expanded','true');navigation.open(picker);(picker.querySelector('[aria-pressed="true"]')||picker.querySelector('[data-agent]')).focus();};
document.getElementById('close-agent-panel').onclick=()=>navigation.close(picker);
picker.addEventListener('cancel',event=>{event.preventDefault();navigation.close(picker);});
picker.addEventListener('close',()=>{pickerButton.setAttribute('aria-expanded','false');navigation.closed(picker);pickerButton.focus();});
picker.addEventListener('click',event=>{if(event.target===picker){const r=picker.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)navigation.close(picker);}});
for(const option of picker.querySelectorAll('[data-agent]'))option.onclick=()=>navigation.navigate(()=>{location.hash=option.dataset.agent;});
picker.addEventListener('keydown',event=>{const options=[...picker.querySelectorAll('[data-agent]')],index=options.indexOf(document.activeElement);if(index<0)return;let next;if(event.key==='ArrowDown')next=(index+1)%options.length;else if(event.key==='ArrowUp')next=(index+options.length-1)%options.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=options.length-1;else return;event.preventDefault();options[next].focus();});
document.getElementById('open-drawer').onclick=()=>{drawer.showModal();navigation.open(drawer);};
document.getElementById('close-drawer').onclick=()=>navigation.close(drawer);
drawer.addEventListener('cancel',event=>{event.preventDefault();navigation.close(drawer);});
drawer.addEventListener('close',()=>navigation.closed(drawer));
drawer.addEventListener('click',event=>{if(event.target===drawer){const r=drawer.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)navigation.close(drawer);}});
for(const link of drawer.querySelectorAll('a'))link.onclick=event=>{if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();navigation.navigate(()=>location.assign(link.href));};
addEventListener('popstate',()=>navigation.popstate());

for(const input of document.querySelectorAll('input[name="accent"]')){input.checked=input.value===readAccent();input.onchange=()=>{if(input.checked)setAccent(input.value);};}

// Enable header controls only after their module handlers are installed.
document.getElementById('open-drawer').disabled=false;pickerButton.disabled=false;
