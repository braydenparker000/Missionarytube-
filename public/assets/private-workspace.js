import {createRelayMenuHistory} from './relay-menu-history.js';
import {readTaskPages,taskStatus} from './private-tasks.js';
import {createRelayOwnerApi,OWNER_SESSION_KEY} from './relay-owner-api.js';
const body=document.getElementById('view-body'),status=document.getElementById('workspace-status');
const navigation=createRelayMenuHistory({history,getURL:()=>location.href});
const drawer=document.getElementById('navigation-drawer');
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
function show(){const next=location.hash.slice(1);current=Object.hasOwn(titles,next)?next:'lucy';if(['lucy','mast'].includes(current))lastChat=current;const chatLink=document.querySelector('#destinations a');chatLink.href='#'+lastChat;chatLink.dataset.view=lastChat;document.body.dataset.view=current;const generation=++epoch;clearSurface();status.textContent='';document.getElementById('view-title').textContent=titles[current];document.getElementById('agent-select').value=current;for(const link of document.querySelectorAll('a[data-view]')){if(link.dataset.view===current)link.setAttribute('aria-current','page');else link.removeAttribute('aria-current');}document.getElementById('refresh').hidden=['makima','collaboration'].includes(current);
 if(['lucy','mast'].includes(current)){let frame=frames.get(current);if(!frame){frame=node('iframe');frame.title='Private conversation with '+titles[current];frame.src='/private/'+current+'.html';frames.set(current,frame);body.append(frame);}frame.hidden=false;frame.inert=false;status.textContent='To '+titles[current]+' only · private owner conversation';}
 else if(current==='tasks')tasks(generation);
 else if(current==='makima')empty('Makima will join later','Grokbot is not connected yet.','K','Disconnected · coming later');
 else empty('Shared collaboration','The shared channel is not available to this account.','↔','Read-only · access unavailable');
}
function invalidate(accessLost=false){navigation.invalidate();++epoch;for(const frame of frames.values())frame.remove();frames.clear();if(accessLost)history.replaceState(null,'','#lucy');show();}
addEventListener('hashchange',show);addEventListener('storage',event=>{if(event.key===OWNER_SESSION_KEY)invalidate();});
document.getElementById('refresh').onclick=()=>navigation.navigate(()=>{if(current==='tasks')show();else frames.get(current)?.contentWindow?.jarvisPrivateReader?.refresh();});
show();
// Mobile keyboards resize the top-level visual viewport, not an iframe's visual viewport.
function fitViewport(){const viewport=window.visualViewport;if(viewport&&viewport.scale!==1)return;const height=viewport?.height||innerHeight;document.documentElement.style.setProperty('--private-height',Math.round(height)+'px');document.body.dataset.keyboard=String(innerHeight-height>120);}
fitViewport();window.visualViewport?.addEventListener('resize',fitViewport);addEventListener('resize',fitViewport);

for(const button of document.querySelectorAll('[data-chat-action]'))button.onclick=()=>navigation.navigate(()=>frames.get(current)?.contentDocument?.getElementById(button.dataset.chatAction)?.click());

document.getElementById('agent-select').onchange=event=>{location.hash=event.target.value;};
document.getElementById('open-drawer').onclick=()=>{drawer.showModal();navigation.open(drawer);};
document.getElementById('close-drawer').onclick=()=>navigation.close(drawer);
drawer.addEventListener('cancel',event=>{event.preventDefault();navigation.close(drawer);});
drawer.addEventListener('close',()=>navigation.closed(drawer));
drawer.addEventListener('click',event=>{if(event.target===drawer){const r=drawer.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)navigation.close(drawer);}});
for(const link of drawer.querySelectorAll('a'))link.onclick=event=>{if(event.button||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;event.preventDefault();navigation.navigate(()=>location.assign(link.href));};
addEventListener('popstate',()=>navigation.popstate());
