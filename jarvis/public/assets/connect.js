import {API_ORIGIN} from './config.js';
import {readState,STORAGE_KEY} from './store.js';
const $=id=>document.getElementById(id),params=Object.fromEntries(new URLSearchParams(location.search));
let owner;
try{
 if(!params.client_id){$('setup').hidden=false;$('status').textContent='Start the connection from ChatGPT using the details below.';}
 else if(!localStorage.getItem(STORAGE_KEY)){$('status').textContent='Open this page in the browser where you use Jarvis. Your saved workspace is not present in this browser.';}
 else{owner=readState(localStorage);$('summary').textContent=`This browser has ${owner.messages.filter(m=>m.role==='user').length} saved messages. Connect only if this is your usual Jarvis browser.`;$('approve').hidden=false;}
}catch{$('status').textContent='Your saved workspace could not be read. It has not been changed.';}
$('approve').onclick=async()=>{
 $('approve').disabled=true;$('status').textContent='Connecting your workspace…';
 try{
  const r=await fetch(API_ORIGIN+'/oauth/approve',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+owner.key},body:JSON.stringify(params),signal:AbortSignal.timeout(15000)});
  const data=await r.json();if(!r.ok)throw Error(data.error||'Connection failed');
  const target=new URL(data.redirect);if(target.origin!=='https://chatgpt.com'||target.pathname!=='/connector_platform_oauth_redirect')throw Error('Unexpected connection destination');
  location.replace(target.href);
 }catch(e){$('status').textContent=e.message;$('approve').disabled=false;}
};

if(!params.client_id){
 fetch(API_ORIGIN+'/.well-known/oauth-protected-resource',{signal:AbortSignal.timeout(15000)}).then(async r=>{
  const data=await r.json();if(!r.ok||data.resource!==API_ORIGIN+'/mcp')throw Error('not ready');
  $('status').textContent='Connector backend is online. Add Jarvis in ChatGPT using the details below.';
 }).catch(()=>{$('status').textContent='Connector deployment is not reachable yet. Check the latest Cloudflare build before connecting.';});
}
