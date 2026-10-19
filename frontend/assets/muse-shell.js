// Presentation only. Relay's stylesheet owns every shared visual primitive;
// callers retain their separate stores, credentials and request transports.
import {icon,sheet,appViewport} from './ui.js';
import {createRelayMenuHistory} from './relay-menu-history.js';
const navigation=createRelayMenuHistory({history,getURL:()=>location.href});
addEventListener('popstate',()=>navigation.popstate());
export const museSheet=(title,entries)=>sheet(title,entries,navigation);
import {trapRelayDialogFocus} from './relay-attachments.js';
export function museShell({privateView,search,work,saved,settings,attach}) {
 appViewport();document.body.dataset.relayDestination='chat';document.body.dataset.conversationMode=privateView?'owner':'public';
 const header=document.querySelector('.topbar');
 const controls=document.createElement('div');controls.hidden=true;for(const id of ['search-toggle','muse-menu']){const node=document.getElementById(id);if(node)controls.append(node);}header.after(controls);
 header.innerHTML=`<button type="button" id="relay-menu-button" class="relay-floating-control" aria-label="Open Muse menu"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 8h14M5 15h9"/></svg></button><div class="conversation-identity"><span class="relay-identity-mark">${icon('chat')}</span><span class="brand" role="heading" aria-level="1">Muse</span><span id="conversation-visibility" class="conversation-visibility">${privateView?'Private owner chat':'Public shared chat'}</span></div><button type="button" id="relay-work-button" class="relay-floating-control" aria-label="Open current work" aria-pressed="false">${icon('check')}<span>Work</span></button>`;
 const show=(title,entries)=>{const d=museSheet(title,entries);d.classList.add('relay-navigation-sheet');[...d.querySelectorAll('.sheet-action')].forEach((b,i)=>b.setAttribute('aria-label',entries[i].label));trapRelayDialogFocus(d);return d;};
 function chats(){const d=show('Chats',[{label:'Private',icon:'chat',action:()=>location.assign('/mast/')},{label:'Public',icon:'chat',action:()=>location.assign('/muse/')}]);d.setAttribute('aria-label','Choose chat');[...d.querySelectorAll('.sheet-action')].forEach((b,i)=>{b.setAttribute('aria-label',i?'Public':'Private');if(Boolean(i)!==privateView)b.setAttribute('aria-current','page');});}
 const menu=()=>{const d=show('Muse',[{label:'Search messages',icon:'search',action:search},{label:'Chats',icon:'chat',action:chats},{label:'Work',icon:'check',action:work},{label:'Saved',icon:'bookmark',action:saved},{label:'Settings',icon:'info',action:settings}]);d.setAttribute('aria-label','Muse navigation');const p=document.createElement('p');p.className='sheet-context';p.textContent=privateView?'Private owner chat':'Public shared chat';d.querySelector('.dialog-heading').after(p);const home=document.createElement('a');home.href='/';home.className='relay-menu-home';home.textContent='Jarvis home';d.append(home);};
 document.getElementById('relay-menu-button').onclick=menu;document.getElementById('relay-work-button').onclick=work;
 const row=document.querySelector('.composer-input');let plus=row.querySelector('.relay-composer-plus');
 if(!plus){plus=document.createElement('button');plus.type='button';plus.className='relay-composer-plus';plus.setAttribute('aria-label','Attach images or files');row.prepend(plus);}plus.innerHTML=icon('plus');plus.onclick=attach;plus.hidden=!privateView;
 return {menu,show,chats,setWork(open){document.body.dataset.relayDestination=open?'work':'chat';const b=document.getElementById('relay-menu-button');b.setAttribute('aria-label',open?'Back to chat':'Open Muse menu');b.innerHTML=open?icon('back'):'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 8h14M5 15h9"/></svg>';b.onclick=open?()=>work(false):menu;document.getElementById('relay-work-button').setAttribute('aria-pressed',String(open));}};
}
