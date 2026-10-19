import {createSharedApi} from './shared-api.js';
import {createDirectApi} from './direct-api.js';
import {channelState} from './channels.js';
const direct=createDirectApi(),legacy=createSharedApi();
async function refresh(){
 const button=document.getElementById('refresh'),status=document.getElementById('reader-status');button.disabled=true;status.textContent='Loading…';
 try{
  let data,notice;
  try{data=await direct('/shared/state');notice=data.publisher.ok?'Shared inbox loaded · publications connected':'Shared inbox loaded · publication sync delayed: '+(data.publisher.error||'Retry pending');}
  catch(e){data=await legacy('/shared/state');notice='Current inbox loaded · publication upgrade not ready: '+e.message;}
  const channel=new URLSearchParams(location.search).get('channel')==='muse'?'muse':'jarvis';
  document.getElementById('inbox').textContent=JSON.stringify(channelState(data,channel),null,2);status.textContent=notice+' · '+channel+' channel';
 }
 catch(e){status.textContent=e.message;}finally{button.disabled=false;}
}
document.getElementById('refresh').onclick=refresh;refresh();
