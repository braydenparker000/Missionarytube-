import {icon as uiIcon, sheet, appViewport, autosize, copyText} from './ui.js';
import {conversation} from './conversation.js';
import { apps, icon, loadPreferences, savePreferences, renderUtility } from './hub.js';
import { API_ORIGIN } from './config.js';
import { request } from './shared-api.js';
import { STORAGE_KEY, readState, mergeState } from './shared-store.js';
import {createPublicReaderDeliveryStore, mergePublicReaderInbox} from './public-reader-cache.js';
import { channelMessages } from './channels.js';
import { OWNER_SESSION_KEY } from './relay-owner-api.js';
import { createRelayOwnerController, createRelayOwnerUI } from './relay-owner-ui.js';
import {createRelayTransferStore} from './relay-transfer.js';
import {createRelayMenuHistory} from './relay-menu-history.js';
import {createRelayAttachmentUI,trapRelayDialogFocus} from './relay-attachments.js';

const $ = id => document.getElementById(id);
const icons = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z"/><path d="M7 10h9M7 14h5"/>',
  board: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h4"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  sync: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>',
  send: '<path d="m3 3 18 9-18 9 3-9-3-9Zm3 9h15"/>'
};
const svg = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]}</svg>`;
let state, deliveryStore, storageError = '', syncError = '', busy = false, toastTimer;
try { deliveryStore=createPublicReaderDeliveryStore({storage:localStorage,tabStorage:sessionStorage,key:STORAGE_KEY,read:readState});state=deliveryStore.restore();state=deliveryStore.commit(state); }
catch (e) { storageError = e.message || 'Device storage is unavailable.'; }
let route = getRoute(), chatUI, workReturn='public', savedView=false, surfaceMotionKey='';
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
reducedMotion.addEventListener('change',event=>{if(event.matches)document.getAnimations().forEach(animation=>animation.cancel());});
const relayMenuHistory=createRelayMenuHistory({history,getURL:()=>location.href});
function relaySheet(title,entries){return sheet(title,entries,relayMenuHistory);}
const ownerController = createRelayOwnerController({onModeChange:next=>{if(next!=='public')savedView=false;if(route==='chat')drawShell();}});
const ownerUI = createRelayOwnerUI({controller:ownerController});
const attachments=createRelayAttachmentUI({openSheet:relaySheet,notify,controller:ownerController,getContext:()=>({key:route!=='chat'?null:ownerUI.mode==='public'?null:ownerController.status==='approved'?'owner:'+ownerController.snapshot().device?.id:null,ownerAuthorized:ownerController.status==='approved',attachmentsEnabled:ownerController.snapshot().attachmentsEnabled})});
ownerController.bindAttachments(()=>attachments.draft());
let relayTransfers, transferNotice = '';
try{relayTransfers=createRelayTransferStore();}catch{transferNotice='Could not read the transferred draft. Keep this tab open and allow browser storage.';}
ownerController.subscribe(()=>{updateConversationIdentity();updateRelayNavigation();if(route==='chat'&&ownerUI.mode!=='public')drawTransferNotice();});
appViewport(({keyboard})=>{document.body.dataset.relayCompactViewport=String(keyboard);});
addEventListener('pagehide',()=>chatUI?.savePosition());
const paths = { home: '/', chat: '/jarvis/', board: '/daily-board/', favorites: '/favorites/', settings: '/settings/', notes: '/notes/', tools: '/tools/', server: '/server/' };
const labels = { home: 'Home', chat: 'Relay', board: 'Daily Board', favorites: 'Favorites', settings: 'Settings', notes: 'Notes', tools: 'Tools', server: 'Server' };
function getRoute() { return ({jarvis:'chat','daily-board':'board',favorites:'favorites',settings:'settings',notes:'notes',tools:'tools',server:'server'})[location.pathname.split('/')[1]] || 'home'; }
let preferences = loadPreferences();
let searchQuery = '', searchOpen = false;
const time = stamp => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(stamp));
const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
let clockTimer;
const escape = text => String(text).replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
function updateClock() {
  clearTimeout(clockTimer);
  const clock = $('launcher-time'), date = $('launcher-date');
  if (!clock || !date || document.hidden) return;
  const now = new Date();
  clock.innerHTML = clockFormat.formatToParts(now).map(part => part.type === 'dayPeriod' ? `<span class="clock-period">${escape(part.value)}</span>` : escape(part.value)).join('');
  clock.dateTime = now.toISOString();
  date.textContent = dateFormat.format(now);
  date.dateTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  // Stay aligned to the device's minute, and only update the two clock nodes.
  clockTimer = setTimeout(updateClock, 60000 - Date.now() % 60000);
}
function commit(next) {
  try{state=deliveryStore.commit(next);storageError='';}catch(error){state=next;if(error.storageFailure)storageError=error.message;throw error;}
}
function notify(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
}
function connection() {
  if (storageError) return 'Device storage unavailable';
  if (!API_ORIGIN) return 'Cloud setup pending';
  if (busy) return 'Syncing';
  if (!navigator.onLine || syncError) return navigator.onLine ? 'Sync unavailable' : 'Offline · drafts saved';
  if (state.mode === 'github-publications' && state.publisher?.ok === false) return 'Replies delayed';
  return state.syncedAt ? 'Connected' : 'Connecting';
}
function drawShell() {
  relayMenuHistory.invalidate();
  ownerUI.unmount();
  chatUI?.savePosition(); chatUI=null;
  for(const cls of ['module-page','conversation-page','relay-page'])document.body.classList.toggle(cls,route==='chat');
  if(route==='chat'&&!document.querySelector('link[href^="/assets/conversation.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/assets/conversation.css?v=20261008';document.head.append(css);}
  if(route==='chat'&&!document.querySelector('link[href^="/assets/relay.css"]')){const css=document.createElement('link');css.rel='stylesheet';css.href='/assets/relay.css?v=20261010-v6';document.head.append(css);}
  document.body.dataset.conversationMode=route==='chat'&&ownerUI.mode!=='public'?'owner':'public';
  document.body.classList.toggle('aligned-hub', route==='home'||route==='board');
  if ((route==='home'||route==='board')&&!document.querySelector('link[href^="/assets/aligned-pages.css"]')) {
    const css=document.createElement('link');css.rel='stylesheet';css.href='/assets/aligned-pages.css?v=20261011';document.head.append(css);
  }
  const hub = ['home','favorites','settings'].includes(route);
  const launcher = ['home','favorites'].includes(route);
  clearTimeout(clockTimer);
  document.body.classList.toggle('launcher-page', launcher);
  document.querySelector('meta[name="theme-color"]').content = ['chat','home','board'].includes(route)?'#000000':launcher ? '#090a0c' : '#121212';
  document.title = `${labels[route]} · Jarvis`;
  const header = launcher
    ? `<header class="topbar launcher-topbar"><a class="brand" href="/" data-route="home">Jarvis</a><nav class="toolbar-actions" aria-label="Launcher tools"><button class="icon-button" id="search-button" aria-label="Search apps" aria-expanded="${route==='home'&&searchOpen}" ${route==='home'?'aria-controls="launcher-search"':''}>${icon('search')}</button><a class="icon-button" href="/favorites/" data-route="favorites" aria-label="Favorites" ${route==='favorites'?'aria-current="page"':''}>${icon('favorites')}</a><button class="icon-button" id="connection-button" aria-label="Connection details">${icon('more')}<span class="sr-only">${connection()}</span></button></nav></header>`
    : `<header class="topbar">${hub?`<button class="icon-button" id="menu-button" aria-label="Open navigation">${icon('menu')}</button>`:`<a class="icon-button" href="/" data-route="home" aria-label="Back to Home">${icon('back')}</a>`}${route==='chat'?`<div class="conversation-identity"><span class="brand" role="heading" aria-level="1">Relay</span><span class="conversation-visibility" id="conversation-visibility"></span></div>`:`<span class="brand">Jarvis</span>`}<div class="toolbar-actions">${route==='chat'?`<button class="icon-button" id="chat-search-toggle" aria-label="Search messages" hidden>${uiIcon('search')}</button><button class="icon-button" id="chat-menu" aria-label="Conversation menu">${uiIcon('more')}</button>`:''}${hub?`<button class="icon-button" id="search-button" aria-label="Search apps">${icon('search')}</button>`:''}<button class="icon-button" id="connection-button" aria-label="Connection details">${icon('more')}<span class="sr-only">${connection()}</span></button></div></header>`;
  const relayNav=route==='chat'?`<nav class="relay-navigation" aria-label="Relay destinations"><a class="relay-home" href="/" data-route="home">${icon('back')}<span>Jarvis home</span></a><p class="relay-nav-heading">Relay</p><button type="button" id="relay-nav-chat">${uiIcon('chat')}<span>Chat</span></button><button type="button" id="relay-nav-work">${uiIcon('check')}<span>Work</span></button><p class="relay-nav-note">A conversation, and the work that follows.</p></nav>`:'';
  $('app').innerHTML = `<div class="workspace${launcher?' launcher':''}">${relayNav}${header}<main id="content" tabindex="-1"></main>${hub&&!launcher?`<nav class="bottom-nav" aria-label="Hub navigation">${['home','favorites','settings'].map(key=>`<a href="${paths[key]}" data-route="${key}" ${key===route?'aria-current="page"':''}>${icon(key)}<span>${labels[key]}</span></a>`).join('')}</nav>`:''}</div>`;
  $('connection-button').onclick = showConnection;
  if ($('menu-button')) $('menu-button').onclick = showNavigation;
  if ($('search-button')) $('search-button').onclick = () => {
    if (route !== 'home') { route='home'; searchOpen=true; history.pushState({},'',paths.home); }
    else searchOpen=!searchOpen;
    if (!searchOpen) searchQuery='';
    drawShell();
    (searchOpen ? $('app-search') : $('search-button'))?.focus();
  };
  drawPage();
  if(route==='chat') {
    $('relay-nav-chat').onclick=()=>{if(ownerUI.mode!=='public'){ownerController.showOwner();ownerController.setJobMode(false);ownerController.setRequestsOnly(false);}updateRelayNavigation();};
    $('relay-nav-work').onclick=()=>{ownerController.showOwner();ownerController.setJobMode(false);ownerController.setRequestsOnly(true);updateRelayNavigation();};
    updateConversationIdentity();
    updateRelayNavigation();
    $('connection-button').hidden=true; $('connection-button').onclick=openRelaySettings;
    $('chat-search-toggle').onclick=()=>{
      if(ownerUI.mode!=='public'){ownerUI.toggleSearch();return;}
      const bar=$('chat-search-bar');if(!bar)return;bar.hidden=!bar.hidden;if(!bar.hidden)$('conversation-search').focus();else{ $('conversation-search').value='';chatUI?.search('');}
    };
    $('chat-menu').onclick=()=>{
      const privateView=ownerUI.mode!=='public';
      const ownerActions=[
        {label:'Public chat',icon:'chat',action:()=>ownerController.showPublic(),section:'Conversation'},
        {label:ownerController.hasCredential?'Owner chat':ownerController.status==='pending'?'Pairing status':'Connect this phone',icon:'chat',action:()=>ownerController.showOwner()},
        {label:'Muse',icon:'chat',href:'/muse/',action:()=>{}},
      ];
      const conversationActions=privateView
        ? [...(ownerController.status==='approved'?[{label:ownerController.snapshot().requestsOnly?'Search current work':'Search private messages',icon:'search',action:()=>ownerUI.toggleSearch(),section:'This conversation'},...(ownerController.snapshot().jobsEnabled?[{label:'Requests',icon:'clock',action:()=>ownerUI.requests()}]:[]),{label:'Latest private messages',icon:'chat',action:()=>ownerUI.latest()}]:[]),{label:'Refresh private inbox',icon:'refresh',action:()=>ownerUI.refresh(),disabled:!ownerController.hasCredential&&ownerController.status!=='pending',...(ownerController.status==='approved'?{}:{section:'This conversation'})},{label:'Connection details',icon:'info',action:()=>ownerUI.connection()}]
        : [{label:'Search messages',icon:'search',action:()=>$('chat-search-toggle').click(),section:'This conversation'},{label:'Bookmarks',icon:'bookmark',action:()=>chatUI?.bookmarks()},{label:'Latest messages',icon:'chat',action:()=>chatUI?.latest()},{label:'Refresh inbox',icon:'refresh',action:sync},{label:'Connection details',icon:'info',action:showConnection}];
      const accountActions=ownerController.hasCredential?[{label:'Account sign-in',icon:'info',action:()=>ownerController.showAccount(),section:'Owner access'},{label:'Devices',icon:'info',action:()=>ownerController.showDevices()},{label:'Disconnect this phone',icon:'close',action:()=>ownerController.disconnect()}]:[];
      const entries=[...ownerActions,...conversationActions,...accountActions];
      const dialog=relaySheet(privateView?'Private owner Relay':'Public Relay',entries);dialog.classList.add('conversation-sheet');
      const context=document.createElement('p');context.className='sheet-context';context.textContent=privateView?'Your owner conversation stays private. Relay and Muse share a separate public inbox.':'Anyone with this website address can read and post to this shared inbox.';dialog.querySelector('.dialog-heading').after(context);
      const actions=[...dialog.querySelectorAll('.sheet-action')];
      entries.forEach((entry,i)=>{if(entry.section){const label=document.createElement('p');label.className='sheet-section';label.textContent=entry.section;actions[i].before(label);}if((entry.label==='Public chat'&&!privateView)||(entry.label==='Owner chat'&&ownerUI.mode==='owner'))actions[i].classList.add('is-current');if(entry.href){const link=document.createElement('a');link.href=entry.href;link.className=actions[i].className;link.innerHTML=actions[i].innerHTML;actions[i].replaceWith(link);}});
    };
  }
}
function updateConversationIdentity(){
  const node=$('conversation-visibility');if(!node||route!=='chat')return;
  const privateView=ownerUI.mode!=='public';document.body.dataset.conversationMode=privateView?'owner':'public';
  node.textContent=privateView?ownerController.status==='approved'?'Private owner · this phone':ownerController.status==='checking'?'Private owner · verifying access':ownerController.status==='expired'?'Private owner · session expired':ownerController.status==='revoked'?'Private owner · access revoked':'Private owner · sign-in required':'Public · shared conversation';

}
function updateRelayNavigation(){
  if(route!=='chat')return;const state=ownerController,work=state.mode==='owner'&&state.requestsOnly;
  document.body.dataset.relayDestination=work?'work':'chat';
  document.body.dataset.relayTaskOpen=String(state.mode!=='public'&&state.status==='approved'&&state.jobMode);
  for(const [id,current]of [['relay-nav-chat',!work],['relay-nav-work',work]]){const button=$(id);if(button){if(current)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');}}
  const search=$('chat-search-toggle');if(search){search.hidden=ownerUI.mode!=='public'&&state.status!=='approved';search.setAttribute('aria-label',work?'Search current work':ownerUI.mode!=='public'?'Search private messages':'Search messages');}
  relayControls();
}
const MANROPE_LICENSE="Copyright 2018 The Manrope Project Authors (https://github.com/googlefonts/manrope)\n\nThis Font Software is licensed under the SIL Open Font License, Version 1.1.\nThis license is copied below, and is also available with a FAQ at:\nhttp://scripts.sil.org/OFL\n\n\n-----------------------------------------------------------\nSIL OPEN FONT LICENSE Version 1.1 - 26 February 2007\n-----------------------------------------------------------\n\nPREAMBLE\nThe goals of the Open Font License (OFL) are to stimulate worldwide\ndevelopment of collaborative font projects, to support the font creation\nefforts of academic and linguistic communities, and to provide a free and\nopen framework in which fonts may be shared and improved in partnership\nwith others.\n\nThe OFL allows the licensed fonts to be used, studied, modified and\nredistributed freely as long as they are not sold by themselves. The\nfonts, including any derivative works, can be bundled, embedded, \nredistributed and/or sold with any software provided that any reserved\nnames are not used by derivative works. The fonts and derivatives,\nhowever, cannot be released under any other type of license. The\nrequirement for fonts to remain under this license does not apply\nto any document created using the fonts or their derivatives.\n\nDEFINITIONS\n\"Font Software\" refers to the set of files released by the Copyright\nHolder(s) under this license and clearly marked as such. This may\ninclude source files, build scripts and documentation.\n\n\"Reserved Font Name\" refers to any names specified as such after the\ncopyright statement(s).\n\n\"Original Version\" refers to the collection of Font Software components as\ndistributed by the Copyright Holder(s).\n\n\"Modified Version\" refers to any derivative made by adding to, deleting,\nor substituting -- in part or in whole -- any of the components of the\nOriginal Version, by changing formats or by porting the Font Software to a\nnew environment.\n\n\"Author\" refers to any designer, engineer, programmer, technical\nwriter or other person who contributed to the Font Software.\n\nPERMISSION & CONDITIONS\nPermission is hereby granted, free of charge, to any person obtaining\na copy of the Font Software, to use, study, copy, merge, embed, modify,\nredistribute, and sell modified and unmodified copies of the Font\nSoftware, subject to the following conditions:\n\n1) Neither the Font Software nor any of its individual components,\nin Original or Modified Versions, may be sold by itself.\n\n2) Original or Modified Versions of the Font Software may be bundled,\nredistributed and/or sold with any software, provided that each copy\ncontains the above copyright notice and this license. These can be\nincluded either as stand-alone text files, human-readable headers or\nin the appropriate machine-readable metadata fields within text or\nbinary files as long as those fields can be easily viewed by the user.\n\n3) No Modified Version of the Font Software may use the Reserved Font\nName(s) unless explicit written permission is granted by the corresponding\nCopyright Holder. This restriction only applies to the primary font name as\npresented to the users.\n\n4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font\nSoftware shall not be used to promote, endorse or advertise any\nModified Version, except to acknowledge the contribution(s) of the\nCopyright Holder(s) and the Author(s) or with their explicit written\npermission.\n\n5) The Font Software, modified or unmodified, in part or in whole,\nmust be distributed entirely under this license, and must not be\ndistributed under any other license. The requirement for fonts to\nremain under this license does not apply to any document created\nusing the Font Software.\n\nTERMINATION\nThis license becomes null and void if any of the above conditions are\nnot met.\n\nDISCLAIMER\nTHE FONT SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND,\nEXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF\nMERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT\nOF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE\nCOPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,\nINCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL\nDAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING\nFROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM\nOTHER DEALINGS IN THE FONT SOFTWARE.\n";
function relayControls(){
  if(route!=='chat')return;
  const work=ownerController.mode==='owner'&&ownerController.requestsOnly,header=document.querySelector('.topbar');
  let menu=$('relay-menu-button'),workButton=$('relay-work-button');
  if(header&&!menu){menu=document.createElement('button');menu.type='button';menu.id='relay-menu-button';menu.className='relay-floating-control';menu.onclick=()=>{if(ownerController.mode==='owner'&&ownerController.requestsOnly)returnToChat();else openRelayMenu();};header.prepend(menu);}
  if(header&&!workButton){workButton=document.createElement('button');workButton.type='button';workButton.id='relay-work-button';workButton.className='relay-floating-control';header.append(workButton);}
  if(menu){const label=work?'Back to chat':'Open Relay menu',key=work?'back':'menu';menu.setAttribute('aria-label',label);if(menu.dataset.icon!==key){menu.dataset.icon=key;menu.innerHTML=work?uiIcon('back'):'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 8h14M5 15h9"/></svg>';}}
  if(workButton){workButton.setAttribute('aria-pressed',String(work));workButton.setAttribute('aria-label',work?'Search current work':'Open current work');const key=work?'search':'work';if(workButton.dataset.icon!==key){workButton.dataset.icon=key;workButton.innerHTML=work?uiIcon('search'):uiIcon('check')+'<span>Work</span>';}workButton.onclick=work?()=>ownerUI.toggleSearch():openWork;}
  const brand=header?.querySelector('.conversation-identity .brand'),title=work?'Work':ownerController.mode==='account'?'Account':ownerController.mode==='devices'?'Devices':savedView?'Saved':'Relay';if(brand&&brand.textContent!==title)brand.textContent=title;
  const identity=header?.querySelector('.conversation-identity');if(identity&&!identity.querySelector('.relay-identity-mark')){const mark=document.createElement('span');mark.className='relay-identity-mark';mark.innerHTML=uiIcon('chat');identity.prepend(mark);}
  const input=document.querySelector('.composer-input');if(input&&!input.querySelector('#relay-compose-menu')){const plus=document.createElement('button');plus.type='button';plus.id='relay-compose-menu';plus.className='relay-composer-plus';plus.setAttribute('aria-label','Attach images or files');plus.innerHTML=uiIcon('plus');plus.onclick=attachments.open;input.prepend(plus);}
  attachments.sync();
  animateRelaySurface(work);
}
function animateRelaySurface(work){
  const key=ownerController.mode==='owner'&&ownerController.jobMode?'task-editor':work?'work':savedView?'saved':ownerUI.mode==='public'?'public-chat':ownerUI.mode;
  if(key===surfaceMotionKey)return;
  const node=key==='task-editor'?$('relay-owner-message-form'):key==='work'?$('relay-owner-current-work'):document.querySelector('main#content .messages')||document.querySelector('.relay-owner-panel');
  if(!node)return;surfaceMotionKey=key;
  if(!reducedMotion.matches&&node.animate)node.animate([{opacity:.88,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:170,easing:'cubic-bezier(.2,.7,.2,1)'});
}
function openFontCredits(){
  const dialog=relaySheet('Font & credits',[]),note=document.createElement('p');note.className='sheet-context';note.textContent='Manrope by Mikhail Sharanda and the Manrope Project Authors. Embedded for offline use under the SIL Open Font License 1.1.';dialog.append(note);
  const details=document.createElement('details');details.className='font-license';const summary=document.createElement('summary');summary.textContent='Full font license';const text=document.createElement('pre');text.textContent=MANROPE_LICENSE;details.append(summary,text);dialog.append(details);
}
function openRelaySettings(){
  const privateView=ownerUI.mode!=='public',items=[{label:'Connection details',icon:'info',action:()=>privateView?ownerUI.connection():showConnection()},{label:privateView?'Refresh private inbox':'Refresh inbox',icon:'refresh',action:()=>privateView?ownerUI.refresh():sync(),disabled:privateView&&!ownerController.hasCredential&&ownerController.status!=='pending'}];
  // These remain the existing authenticated forms and disconnect operation.
  if(ownerController.hasCredential)items.push({label:'Account sign-in',icon:'info',action:()=>ownerController.showAccount()},{label:'Devices',icon:'info',action:()=>ownerController.showDevices()},{label:'Disconnect this phone',icon:'close',action:()=>ownerController.disconnect()});
  items.push({label:'Font & credits',icon:'info',action:openFontCredits});relaySheet('Settings',items);
}
function openWork(){savedView=false;if(!(ownerController.mode==='owner'&&ownerController.requestsOnly))workReturn=ownerUI.mode;$('relay-nav-work')?.click();$('relay-menu-button')?.focus({preventScroll:true});}
function returnToChat(){savedView=false;ownerController.setRequestsOnly(false);ownerController.setJobMode(false);if(workReturn==='public')ownerController.showPublic();else ownerController.showOwner();updateRelayNavigation();$('relay-compose-menu')?.focus({preventScroll:true});}
function openChats(){savedView=false;const dialog=relaySheet('Chats',[{label:'Private',icon:'chat',action:()=>{ownerController.showOwner();ownerController.setJobMode(false);ownerController.setRequestsOnly(false);updateRelayNavigation();}},{label:'Public',icon:'chat',action:()=>{ownerController.showPublic();chatUI?.latest();relayControls();}}]);dialog.classList.add('relay-navigation-sheet');trapRelayDialogFocus(dialog);dialog.setAttribute('aria-label','Choose chat');const selected=ownerUI.mode==='public'?'Public':'Private';for(const button of dialog.querySelectorAll('.sheet-action')){button.setAttribute('aria-label',button.textContent.trim());if(button.textContent.trim()===selected)button.setAttribute('aria-current','page');}}
function openSaved(){savedView=true;ownerController.showPublic();chatUI?.bookmarks(true);relayControls();}
function openRelayMenu(){
  const state=ownerController.snapshot(),privateView=ownerUI.mode!=='public';
  const entries=[{label:state.requestsOnly&&privateView?'Search current work':'Search messages',icon:'search',disabled:privateView&&state.status!=='approved',action:()=>$('chat-search-toggle')?.click()},
    {label:'Chats',icon:'chat',action:openChats},{label:'Work',icon:'check',action:openWork},{label:'Saved',icon:'bookmark',action:openSaved},{label:'Settings',icon:'info',action:openRelaySettings}];
  const dialog=relaySheet('Relay',entries);dialog.classList.add('relay-navigation-sheet');trapRelayDialogFocus(dialog);dialog.setAttribute('aria-label','Relay navigation');const context=document.createElement('p');context.className='sheet-context';context.textContent=privateView?'Private owner chat':'Public shared chat';dialog.querySelector('.dialog-heading').after(context);[...dialog.querySelectorAll('.sheet-action')].forEach((node,i)=>{node.setAttribute('aria-label',entries[i].label);if(entries[i].label==='Saved')node.setAttribute('aria-description','Saved public messages on this device');});
  const home=document.createElement('a');home.href='/';home.dataset.route='home';home.className='relay-menu-home';home.textContent='Jarvis home';dialog.append(home);
}
function drawPage() {
  if (route === 'home' || route === 'favorites') { drawHome(); return; }
  if (route === 'settings') { drawSettings(); return; }
  if (['notes','tools','server'].includes(route)) { renderUtility(route,$('content'),{notify,connection,showConnection,state,storageError,sync}); return; }
  // A damaged public store must not route private data through its recovery path.
  if (route === 'chat' && ownerUI.mode !== 'public') { adoptRelayTransfer('owner',ownerController.snapshot().draft,value=>ownerController.setDraft(value));ownerUI.mount($('content'));drawTransferNotice();return; }
  if (storageError) { $('content').innerHTML = `<div class="empty"><h1>Unable to save on this device</h1><p>${escape(storageError)}</p><p>Existing data has not been changed. Allow browser storage, then reload.</p></div>`;if(route==='chat')drawTransferNotice();return; }
  if (route === 'chat') drawChat();
  if (route === 'board') drawBoard();
}
function pendingTransfer(){try{return relayTransfers?.peek();}catch(error){transferNotice=error.message;return null;}}
function openTransferDestination(destination){
  try{if(pendingTransfer()?.legacy)relayTransfers.selectLegacy(destination);}
  catch(error){transferNotice=error.message;notify(transferNotice);return;}
  if(destination==='owner')ownerController.showOwner();else ownerController.showPublic();
  if(route==='chat')drawShell();
}
function chooseTransferDestination(){sheet('Choose Relay destination',[
  {label:'Owner chat · private',icon:'lock',action:()=>openTransferDestination('owner')},
  {label:'Public Relay · shared',icon:'chat',action:()=>openTransferDestination('public')}
]);}
function adoptRelayTransfer(destination,draft,saveDraft){
  if(!relayTransfers)return;
  transferNotice='';
  try{
    const result=relayTransfers?.apply({destination,draft,saveDraft});
    transferNotice={too_long:'Your existing draft and incoming draft exceed the message limit. Shorten your existing draft, then retry.',
      draft_changed:'Your draft changed during transfer. The incoming draft is still saved; copy it to review both.',
      storage_unavailable:'Could not retain the combined draft. The incoming draft is still saved.'}[result?.status]||'';
  }catch(error){transferNotice=error.message;}
}
function dismissRelayTransfer(){
  let review;try{review=relayTransfers.prepareDismissal();}catch(error){transferNotice=error.message;drawTransferNotice();return;}
  const dialog=sheet('Dismiss saved transfer?',[
    {label:'Keep saved transfer',icon:'close',action:()=>{}},
    {label:'Dismiss saved transfer',icon:'check',action:()=>{
      try{review.dismiss();transferNotice='';notify('Saved transfer dismissed. Your composer has not changed.');}
      catch(error){transferNotice=error.message;}
      drawTransferNotice();
    }}
  ]);
  const context=document.createElement('p');context.className='sheet-context';
  context.textContent='This removes the saved incoming transfer. Text in either Relay composer stays as it is. Copy the incoming draft first if you want to keep a separate copy.';
  dialog.querySelector('.dialog-heading').after(context);
}
function drawTransferNotice(){
  const content=$('content');if(!content)return;
  $('relay-transfer-notice')?.remove();
  const pending=pendingTransfer();if(!pending&&!transferNotice)return;
  const node=document.createElement('div');node.id='relay-transfer-notice';node.className='conversation-notice';node.style.flexWrap='wrap';
  const message=document.createElement('p');message.setAttribute('role','status');message.style.flexBasis='100%';
  message.textContent=transferNotice||(pending.legacy?'Choose where to continue your saved Relay draft.':`Incoming draft kept for ${pending.destination==='owner'?'private owner chat':'public Relay'}.`);node.append(message);
  const button=(label,action)=>{const b=document.createElement('button');b.type='button';b.className='text-button';b.textContent=label;b.onclick=action;node.append(b);};
  if(pending?.legacy)button('Choose destination',chooseTransferDestination);
  else if(pending)button(pending.destination==='owner'?'Review private draft':'Review public draft',()=>openTransferDestination(pending.destination));
  if(pending){button('Copy incoming draft',async()=>notify(await copyText(pending.body)?'Incoming draft copied.':'Copy is unavailable. Your draft is still saved.'));
    button('Dismiss saved transfer',dismissRelayTransfer);}
  content.prepend(node);
}
function appRow(app) {
  return `<a class="app-row" href="${app.href}">${icon(app.icon)}<span><strong>${app.name}</strong><small>${app.description}</small></span>${icon('chevron')}</a>`;
}
function launcherRow(app) {
  const favorite = preferences.favorites.includes(app.id);
  return `<a class="launcher-link${app.id==='jarvis'?' launcher-relay':''}" href="${app.href}">${icon(app.icon)}<span class="launcher-name">${app.name}</span>${favorite?`<span class="favorite-mark">${icon('favorites')}<span class="sr-only">Favorite</span></span>`:''}</a>`;
}
function drawHome() {
  const favorites = route==='favorites';
  const selected = apps.filter(a=>preferences.favorites.includes(a.id));
  $('content').innerHTML = `${favorites?`<section class="page-heading launcher-heading"><h1>Favorites</h1><button class="text-button" id="edit-favorites" aria-label="Edit favorites">Edit</button></section>`:`<section class="launcher-clock" aria-label="Local time and date"><h1 class="sr-only">Home</h1><time id="launcher-time" class="launcher-time"></time><time id="launcher-date" class="launcher-date"></time></section><div class="search-field" id="launcher-search" ${searchOpen?'':'hidden'}><label class="sr-only" for="app-search">Find an app</label><input id="app-search" type="search" placeholder="Find an app" value="${escape(searchQuery)}" autocomplete="off"></div>`}<div id="app-directory"></div>`;
  const render=()=>{
    const filtered=(favorites?selected:apps).filter(a=>(a.name+' '+a.description+' '+a.id).toLowerCase().includes(searchQuery.trim().toLowerCase()));
    const utilityIds = ['tools','server','settings'];
    const primary = filtered.filter(a=>!utilityIds.includes(a.id));
    const utilities = filtered.filter(a=>utilityIds.includes(a.id));
    $('app-directory').innerHTML = filtered.length?`<nav class="launcher-list" aria-label="${favorites?'Favorite apps':'Apps'}">${primary.map(launcherRow).join('')}${utilities.length?`<div class="launcher-utilities${primary.length?' separated':''}">${utilities.map(launcherRow).join('')}</div>`:''}</nav>`:`<p class="empty-note" role="status">${favorites?'Choose your favorite apps with Edit.':'No apps match your search.'}</p>`;
  };
  if(favorites)searchQuery='';
  render();
  if($('app-search'))$('app-search').oninput=e=>{searchQuery=e.target.value;render();};
  if ($('edit-favorites')) $('edit-favorites').onclick=editFavorites;
  if (!favorites) updateClock();
}
function editFavorites() {
  const dialog=$('hub-dialog');
  dialog.innerHTML=`<div class="dialog-heading"><h2 id="hub-dialog-heading">Favorites</h2><button class="close" aria-label="Close favorites">×</button></div><p>Choose favorites for this browser. They are marked on Home and collected in Favorites.</p><form id="favorites-form">${apps.map(a=>`<label class="check-row"><input type="checkbox" name="favorite" value="${a.id}" ${preferences.favorites.includes(a.id)?'checked':''}>${a.name}</label>`).join('')}<button class="primary" type="submit">Save favorites</button></form>`;
  dialog.querySelector('.close').onclick=()=>dialog.close();
  $('favorites-form').onsubmit=e=>{e.preventDefault();try{const next={...preferences,favorites:new FormData(e.target).getAll('favorite')};savePreferences(next);preferences=next;dialog.close();drawShell();}catch{notify('Favorites could not be saved. Browser storage is unavailable.');}};
  dialog.showModal();
}
function showNavigation() {
  const dialog=$('hub-dialog');
  dialog.innerHTML=`<div class="dialog-heading"><h2 id="hub-dialog-heading">Your apps</h2><button class="close" aria-label="Close navigation">×</button></div>${apps.map(appRow).join('')}`;
  dialog.querySelector('.close').onclick=()=>dialog.close();dialog.showModal();
}
function drawSettings() {
  $('content').innerHTML=`<section class="page-heading"><h1>Settings</h1></section><section class="app-group"><h2 class="eyebrow">Your hub</h2><button class="app-row" id="settings-favorites">${icon('favorites')}<span><strong>Favorites</strong><small>Choose your favorite apps</small></span>${icon('chevron')}</button><a class="app-row" href="/server/">${icon('server')}<span><strong>Connection & status</strong><small>Message sync and service details</small></span>${icon('chevron')}</a></section><section class="reading"><h2>One shared conversation</h2><p>Relay messages and Daily Board are shared across phones. Favorites and notes are saved in this browser.</p><h2>Your player</h2><p>DrawerCast has its own full player and settings. Music stays on your phone or server.</p><h2>About</h2><p>Jarvis · version 1.1<br>Dark interface inspired by your Poweramp player.</p></section>`;
  $('settings-favorites').onclick=editFavorites;
}
function drawChat() {
  $('content').innerHTML = `<div class="conversation-search" id="chat-search-bar" hidden><label class="sr-only" for="conversation-search">Search messages</label><input id="conversation-search" type="search" placeholder="Search this conversation" autocomplete="off"><button class="icon-button" id="chat-search-close" type="button" aria-label="Close search">${uiIcon('close')}</button></div><section class="chat-panel"><div class="messages" id="messages" aria-label="Public Relay conversation"></div><div class="conversation-notice" id="relay-sync-notice" hidden><p id="relay-sync-error" role="status"></p><button class="text-button" type="button" id="relay-retry">Retry sync</button></div><form class="composer" id="message-form"><div class="composer-input"><label class="sr-only" for="message-text">Message Relay publicly</label><textarea id="message-text" rows="1" maxlength="4000" placeholder="Message Relay publicly…" required>${escape(state.composer || '')}</textarea><button class="primary send-icon" type="submit" id="send-message" aria-label="Send message">${uiIcon('send')}</button></div><div class="composer-bottom"><span id="relay-status" role="status">${API_ORIGIN?'Opening public inbox…':'Draft mode · saved on this device'}</span></div></form></section>`;
  const input=$('message-text');
  const saveDraft=value=>{state={...state,composer:value};let saved=false;try{commit(state);saved=true;}catch(error){storageError=error.message||'Could not save your draft. Copy your text before leaving.';}renderPublicStatus();return saved;};
  input.oninput=()=>{saveDraft(input.value);autosize(input);};
  input.onkeydown=e=>{if(e.key==='Enter' && (e.ctrlKey||e.metaKey) && !e.isComposing){e.preventDefault();$('message-form').requestSubmit();}};
  $('message-form').onsubmit=e=>{e.preventDefault();submitMessage();};
  chatUI=conversation({panel:$('messages'),composer:input,channel:'relay',author:'Jarvis',notify,draftChanged:saveDraft,emptyTitle:'A little room to think.',emptyDescription:'Ask Jarvis a question or leave a thought. Replies arrive after the next inbox check.',scope:'Public conversation',dateGroups:true});
  chatUI.update(channelMessages(state.messages));
  $('conversation-search').oninput=e=>chatUI.search(e.target.value);
  $('chat-search-close').onclick=()=>$('chat-search-toggle').click();
  $('relay-retry').onclick=sync;
  adoptRelayTransfer('public',input.value,value=>{const saved=saveDraft(value);if(saved)input.value=value;return saved;});
  drawTransferNotice();
  autosize(input);
  renderPublicStatus();
}
function renderPublicStatus(){
  if(!chatUI||!$('relay-status'))return;
  $('send-message').disabled=!!storageError||!state.composer?.trim();
  const attention=state.outbox.some(m=>['rejected','conflict'].includes(m.sendState));
  $('relay-status').textContent=storageError?'Draft retention unavailable':syncError?state.outbox.length?attention?'Send needs attention · text saved on this device':'Send unconfirmed · queued safely on this device':'Inbox unavailable · draft saved':busy?state.outbox.length?'Sending to public inbox…':'Refreshing public inbox…':state.outbox.length?'Queued on this device':state.publisher?.ok===false?'Messages saved · replies delayed':'Public inbox · replies arrive after a check';
  $('relay-sync-notice').hidden=!syncError&&!storageError;$('relay-sync-error').textContent=storageError||syncError;$('relay-retry').disabled=busy||!!storageError;
  chatUI.setDelivery?.({busy,error:!!syncError});
}
function messageMarkup(m) {
  return `<article data-message-id="${escape(m.id)}" class="message-row ${m.role==='user'?'outgoing':'incoming'}"><span class="message-author">${m.role==='user'?'YOU':m.kind==='reply'?'JARVIS':'JARVIS · AUTOMATIC RECEIPT'}</span><p class="bubble">${escape(m.body)}</p><span class="message-time">${time(m.createdAt)} · ${m.saved?'Cloud saved':'Not sent · on this device'}</span></article>`;
}
function submitMessage() {
  // A stale public form/event must never submit an owner draft to the shared inbox.
  if (ownerUI.mode !== 'public') return;
  if(storageError)return;
  const body = $('message-text').value.trim();
  if (!body) return;
  const item = { id: crypto.randomUUID(), body, role: 'user', createdAt: new Date().toISOString(), saved: false,sendState:'queued',type:'message' };
  try {
    deliveryStore.savePending(item,{associateDraft:true});
    commit({ ...state, composer: '', messages: [...state.messages,item], outbox: [...state.outbox,{...item,type:'message'}] });
    $('message-text').value='';autosize($('message-text'));chatUI.update(channelMessages(state.messages));chatUI.latest(); if (API_ORIGIN) sync(); else notify('Draft saved on this device. It has not been sent.');
  } catch(error){
    state={...state,composer:$('message-text').value};
    try{state=deliveryStore.external(state);chatUI.update(channelMessages(state.messages));}catch{}
    if(error.kind==='capacity')syncError=error.message;else storageError=error.message||'Could not save. Your text is still in the message box.';
    renderPublicStatus();
  }
}
function drawBoard() {
  $('content').innerHTML = `<section class="page-heading"><div><p class="eyebrow">YOUR DAILY BRIEFING</p><h1>Daily Board</h1><p class="subheading">Your briefing from Jarvis.</p></div></section><div class="board-list">${state.posts.length?[...state.posts].reverse().map(p=>`<article class="card board-entry"><div class="card-top"><span class="eyebrow">${time(p.createdAt)}</span><span class="pill">${p.saved?'CLOUD SAVED':'ON THIS DEVICE'}</span></div><h2>${escape(p.title)}</h2><p>${escape(p.body)}</p></article>`).join(''):`<section class="card empty-board"><span class="empty-icon">${svg('board')}</span><h2>Your briefing will appear here.</h2><p>Briefings published by Jarvis appear here on all your devices.</p></section>`}</div><p class="board-note">${API_ORIGIN?'The same Daily Board on every device.':'Entries are saved on this device. Cloud sync and scheduled updates are not connected yet.'}</p>`;

}
function showConnection() {
  $('connection-state').textContent = connection();
  $('connection-detail').textContent = storageError ? storageError : !API_ORIGIN ? 'Your hub is live. Cloud storage is awaiting connection. Messages and board entries currently save only in this browser; clearing browser data will remove them.' : syncError || (state.syncedAt ? `Last synced ${time(state.syncedAt)}. One shared inbox. Messages are stored in Cloudflare.${state.mode === 'github-publications' ? (state.publisher?.ok ? ' Replies and briefings are connected.' : ' Your messages remain saved. Reply delivery is temporarily delayed: ' + (state.publisher?.error || 'waiting for publication sync')) : ' Publication upgrade pending.'}` : 'Opening the shared inbox.');
  $('sync-now').hidden = !API_ORIGIN || !!storageError;
  $('sync-now').disabled = busy;
  $('connection-dialog').showModal();
}
async function sync() {
  if (!API_ORIGIN || busy || storageError) return;
  busy = true; syncError = '';
  renderPublicStatus();
  $('connection-button').lastElementChild.textContent = connection();
  let sending;
  try {
    // Resume the complete public checkpoint; history alone cannot confirm a
    // pending send. Lost responses are recovered by an exact request probe.
    const inbox=await request('/shared/state',{publicReader:state.publicReader});commit(mergePublicReaderInbox(state,inbox,mergeState));
    while(state.outbox.some(item=>item.sendState!=='conflict')){
      const item=state.outbox.find(item=>item.sendState!=='conflict');sending=item;setPublicSendState(item.id,'sending');
      try{
        const remote=await request('/shared/messages',{id:item.id,body:item.body,retry:['unknown','sending','rejected'].includes(item.sendState)});commit(mergePublicReaderInbox(state,remote,mergeState));
        if(state.outbox.some(m=>m.id===item.id))throw Error('Message acceptance could not be confirmed. The original text and ID remain queued.');
      }catch(error){if(error.status!==409)throw error;setPublicSendState(item.id,'conflict');}
    }
    if(sending){const latest=await request('/shared/state',{publicReader:state.publicReader});commit(mergePublicReaderInbox(state,latest,mergeState));}
    if(state.outbox.some(m=>m.sendState==='conflict'))syncError='A queued message has an ID conflict. Its original text stays here; other messages can still sync.';
  } catch (e) { if(sending&&state.outbox.some(m=>m.id===sending.id)){try{setPublicSendState(sending.id,e.status===409?'conflict':e.status>=400&&e.status<500?'rejected':'unknown');}catch{}}syncError = e.message || 'Cloud unavailable. Your drafts are safe.'; notify(syncError); }
  finally {
    busy = false;
    if(route==='chat' && chatUI){
      chatUI.update(channelMessages(state.messages));
      renderPublicStatus();
    } else if(route==='board') drawShell();
    if ($('connection-button')) $('connection-button').lastElementChild.textContent=connection();
    if ($('connection-dialog').open) { $('connection-state').textContent = connection(); $('sync-now').disabled=false; }
  }
}
function setPublicSendState(id,sendState){commit({...state,messages:state.messages.map(m=>m.id===id?{...m,sendState}:m),outbox:state.outbox.map(m=>m.id===id?{...m,sendState}:m)});}
document.addEventListener('click', e => {
  const link = e.target.closest('[data-route]');
  if (!link || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  relayMenuHistory.navigate(()=>{
    $('hub-dialog')?.close();
    if (route !== link.dataset.route) { route = link.dataset.route; history.pushState({},'',paths[route]); }
    drawShell(); window.scrollTo(0,0);
  });
});
window.addEventListener('popstate',()=>{ if(relayMenuHistory.popstate())return;route=getRoute();drawShell(); });
window.addEventListener('online',sync);
window.addEventListener('pageshow',updateClock);
document.addEventListener('visibilitychange',updateClock);
document.addEventListener('visibilitychange',()=>{ if(!document.hidden && API_ORIGIN && !busy && (!state.syncedAt || Date.now()-Date.parse(state.syncedAt)>60000)) sync(); });
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).close());
$('sync-now').onclick = sync;
const initialTransfer=pendingTransfer();
if(initialTransfer&&!initialTransfer.legacy&&route==='chat'){
  if(initialTransfer.destination==='owner')ownerController.showOwner();else ownerController.showPublic();
}
drawShell();
new MutationObserver(()=>{if(route==='chat')relayControls();}).observe($('app'),{childList:true,subtree:true});
if (API_ORIGIN) sync();


setInterval(()=>{if(!document.hidden)sync();},30000);
window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY||e.key?.startsWith(deliveryStore?.prefix)){try{state=deliveryStore.external(state);if(route==='chat'&&chatUI){chatUI.update(channelMessages(state.messages));renderPublicStatus();}else if(route==='board')drawShell();}catch(error){syncError=error.message;renderPublicStatus();}}});
window.addEventListener('storage',e=>{if(e.key===OWNER_SESSION_KEY)ownerController.storedSessionChanged();});
