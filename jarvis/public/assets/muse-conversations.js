import {sheet} from './ui.js';

// Navigation only: each conversation retains its own authentication, drafts and
// transport. Switching never copies messages or composer text between scopes.
export function museConversations(privateView, actions=[]) {
  const modes=[{label:'Public chat',href:'/muse/'},{label:'Owner chat',href:'/mast/'}];
  const dialog=sheet(privateView?'Private owner Muse':'Public Muse',[
    ...modes.map(mode=>({label:mode.label,icon:'chat',action:()=>{}})),...actions
  ]);
  dialog.classList.add('conversation-sheet','muse-mode-sheet');
  const buttons=[...dialog.querySelectorAll('.sheet-action')];
  modes.forEach((mode,index)=>{
    const link=document.createElement('a');link.href=mode.href;
    link.className=buttons[index].className;link.innerHTML=buttons[index].innerHTML;
    if(Boolean(index)===privateView){link.classList.add('is-current');link.setAttribute('aria-current','page');}
    buttons[index].replaceWith(link);
    if(index===0){const label=document.createElement('p');label.className='sheet-section';label.textContent='Conversation';link.before(label);}
  });
  if(buttons[2]){const label=document.createElement('p');label.className='sheet-section';label.textContent='This conversation';buttons[2].before(label);}
  return dialog;
}
