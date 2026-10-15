import {createRelayOwnerController,createRelayOwnerUI} from './relay-owner-ui.js';
import {createRelayAttachmentUI} from './relay-attachments.js';
import {sheet,appViewport} from './ui.js';
import {createRelayOwnerApi} from './relay-owner-api.js';
import {readTaskPages} from './private-tasks.js';
const api=createRelayOwnerApi();
const controller=createRelayOwnerController({api}),ui=createRelayOwnerUI({controller});
const attachments=createRelayAttachmentUI({controller,openSheet:sheet,notify:text=>document.getElementById('notice').textContent=text,getContext:()=>({key:controller.status==='approved'?'owner:'+controller.snapshot().device?.id:null,ownerAuthorized:controller.status==='approved',attachmentsEnabled:controller.snapshot().attachmentsEnabled})});
controller.bindAttachments(()=>attachments.draft());
controller.showOwner();
ui.mount(document.getElementById('content'));
function controls(){const input=document.querySelector('.composer-input');if(input&&!input.querySelector('.private-attach')){const button=document.createElement('button');button.type='button';button.className='relay-composer-plus private-attach';button.textContent='+';button.setAttribute('aria-label','Attach images or files to Lucy');button.onclick=attachments.open;input.prepend(button);}attachments.sync();document.getElementById('disconnect').hidden=!controller.hasCredential;}
controller.subscribe(controls);controls();appViewport();
document.getElementById('search').onclick=()=>ui.toggleSearch();document.getElementById('account').onclick=()=>controller.showAccount();document.getElementById('disconnect').onclick=()=>controller.disconnect();
// No public store or transport is imported. Recipient is fixed for this document.
addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent)return;if(event.data?.type==='jarvis-private-refresh')ui.refresh();});

window.jarvisPrivateReader=Object.freeze({get connected(){return api.hasCredential;},list:()=>readTaskPages(cursor=>api.jobs(cursor)),detail:id=>api.jobDetail(id),refresh:()=>ui.refresh()});
addEventListener('storage',event=>{if(event.key==='jarvis.relay.owner-session.v1'){api.refreshStoredCredential();location.reload();}});
