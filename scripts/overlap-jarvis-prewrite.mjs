import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

// The backup's existing 30s inventory / 120s transfer bounds remain unchanged.
// Allow both inventory reads and local verification; readiness retains its own
// HTTP retry gates, with a final cap below the deployment job's 40 minute limit.
export const PREWRITE_TIMEOUTS=Object.freeze({readiness:30*60*1000,backup:4*60*1000,terminate:1000});
const RUNTIME_ENV=['PATH','TMPDIR','TMP','TEMP','LANG','LC_ALL','LC_CTYPE','TZ','RUNNER_TRACKING_ID',
  'HTTP_PROXY','HTTPS_PROXY','NO_PROXY','http_proxy','https_proxy','no_proxy','NODE_EXTRA_CA_CERTS'];
function checkedSettings(env){
  if(env.STORAGE_ACCOUNT!=='missionarytube')throw Error('Unexpected prewrite account');
  if(!['true','false'].includes(env.PODCASTS_ENABLED))throw Error('Explicit podcast readiness setting required');
}
export function prewriteLanes({root=process.cwd(),env=process.env,readinessDirectory}={}){
  checkedSettings(env);
  if(env.PODCASTS_ENABLED==='true'&&(typeof readinessDirectory!=='string'||!isAbsolute(readinessDirectory)))
    throw Error('Isolated readiness configuration directory required');
  const lanes=[];
  if(env.PODCASTS_ENABLED==='true')lanes.push({name:'podcast-readiness',binary:process.execPath,
    args:[resolve(root,'.jarvis-source/scripts/verify-podcasts.mjs')],cwd:root,
    env:{...Object.fromEntries(RUNTIME_ENV.filter(key=>env[key]!==undefined).map(key=>[key,env[key]])),
      HOME:join(readinessDirectory,'home'),XDG_CONFIG_HOME:join(readinessDirectory,'config'),AZURE_CONFIG_DIR:join(readinessDirectory,'azure')},timeout:PREWRITE_TIMEOUTS.readiness});
  lanes.push({name:'verified-rollback-backup',binary:process.execPath,
    args:[resolve(root,'scripts/backup-jarvis-storage.mjs')],cwd:root,env,timeout:PREWRITE_TIMEOUTS.backup});
  return lanes;
}

export async function runPrewriteGates({root=process.cwd(),env=process.env,signal,...options}={}){
  checkedSettings(env);
  if(signal?.aborted)throw Error('Prewrite gates cancelled; no overwrite is authorized');
  let readinessDirectory;
  try{
    if(env.PODCASTS_ENABLED==='true'){
      try{
        readinessDirectory=await mkdtemp(join(resolve(env.RUNNER_TEMP||tmpdir()),'jarvis-readiness-'));
        for(const name of ['home','config','azure'])await mkdir(join(readinessDirectory,name),{mode:0o700});
      }catch{throw Error('Readiness environment isolation failed; no overwrite is authorized');}
    }
    // Only the backup lane inherits the original Azure CLI session environment.
    // This prevents accidental credential discovery, not intentional same-UID
    // access: these processes share a runner and are not a security sandbox.
    return await joinPrewriteLanes(prewriteLanes({root,env,readinessDirectory}),{signal,...options});
  }finally{
    // The join has awaited both lane exits on success, failure or cancellation.
    // Never remove configuration directories while a readiness lane is active.
    if(readinessDirectory){
      try{await rm(readinessDirectory,{recursive:true,force:true});}
      catch{throw Error('Readiness environment cleanup failed; no overwrite is authorized');}
    }
  }
}

// Ubuntu process groups include the backup helper's az / azcopy children. A
// failure, timeout or runner cancellation terminates and awaits every lane;
// shell background jobs, inherited provider diagnostics and alternate auth
// routes are deliberately absent.
export async function joinPrewriteLanes(lanes,{signal,terminateMs=PREWRITE_TIMEOUTS.terminate,killProcess=process.kill}={}){
  if(process.platform==='win32')throw Error('Prewrite process-group supervision requires a POSIX runner');
  if(!Array.isArray(lanes)||!lanes.length||lanes.length>2||new Set(lanes.map(lane=>lane.name)).size!==lanes.length||
    lanes.some(lane=>!['podcast-readiness','verified-rollback-backup'].includes(lane.name)||
      typeof lane.binary!=='string'||!Array.isArray(lane.args)||!Number.isSafeInteger(lane.timeout)||lane.timeout<1)||
    !Number.isSafeInteger(terminateMs)||terminateMs<1)throw Error('Invalid bounded prewrite lanes');
  if(signal?.aborted)throw Error('Prewrite gates cancelled; no overwrite is authorized');
  const running=[];
  let failure,killTimer;
  const killAll=kind=>{
    for(const lane of running){
      if(!lane.child.pid)continue;
      // Attempt every group even if one signal fails. Never throw provider or
      // OS diagnostics from an event/timer callback and abandon the peers.
      try{killProcess(-lane.child.pid,kind);}catch{}
    }
  };
  const stop=message=>{
    if(failure)return;
    failure=message;
    killAll('SIGTERM');
    killTimer=setTimeout(()=>killAll('SIGKILL'),terminateMs);
  };
  const cancelled=()=>stop('Prewrite gates cancelled; no overwrite is authorized');
  signal?.addEventListener('abort',cancelled,{once:true});
  try{
    for(const spec of lanes){
      if(failure)break;
      let child;
      try{child=spawn(spec.binary,spec.args,{cwd:spec.cwd,env:spec.env,detached:true,stdio:'ignore'});}
      catch{stop(`${spec.name} could not start; no overwrite is authorized`);break;}
      const lane={child};running.push(lane);
      lane.done=new Promise(done=>{
        const timer=setTimeout(()=>stop(`${spec.name} timed out; no overwrite is authorized`),spec.timeout);
        child.once('error',()=>stop(`${spec.name} could not start; no overwrite is authorized`));
        child.once('close',(code,killedBy)=>{
          clearTimeout(timer);
          if(code!==0||killedBy)stop(`${spec.name} failed; no overwrite is authorized`);
          done();
        });
      });
    }
    await Promise.all(running.map(lane=>lane.done));
    // Finish escalation even if a lane closed before its descendant. The
    // normal scripts await children, but failure must never orphan a peer.
    if(failure){
      clearTimeout(killTimer);
      killAll('SIGKILL');
      throw Error(failure);
    }
    return {completed:lanes.map(lane=>lane.name)};
  }finally{
    clearTimeout(killTimer);
    signal?.removeEventListener('abort',cancelled);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const controller=new AbortController(),cancel=()=>controller.abort();
  process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
  try{
    await runPrewriteGates({signal:controller.signal});
    console.log('Required readiness and verified rollback backup passed; rollback artifact upload is still required before writes');
  }catch(error){console.error(error.message);process.exitCode=1;}
  finally{process.off('SIGINT',cancel);process.off('SIGTERM',cancel);}
}
