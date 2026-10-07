import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const execute=promisify(execFile),ACCOUNT='missionarytube';
export const BACKUP_TIMEOUTS=Object.freeze({list:30000,transfer:120000});
export function checkedBackupManifest(manifest){
  if(!Array.isArray(manifest)||!manifest.length||manifest.length>10000)throw Error('Backup blob inventory missing or unbounded');
  const names=new Set();
  for(const item of manifest){
    const name=item?.name,properties=item?.properties;
    if(typeof name!=='string'||!name||name.length>1024||name.startsWith('/')||name.includes('\\')||name.includes('\0')||name.split('/').some(part=>!part||part==='.'||part==='..')||names.has(name))throw Error('Unsafe or duplicate backup blob path');
    if(!properties||!Number.isSafeInteger(properties.contentLength)||properties.contentLength<0||typeof properties.etag!=='string'||!properties.etag||properties.etag.length>128)throw Error('Exact backup blob length and ETag required');
    const md5=properties.contentSettings?.contentMd5;
    if(md5!=null&&(typeof md5!=='string'||!/^[A-Za-z0-9+/]{22}==$/.test(md5)||Buffer.from(md5,'base64').length!==16))throw Error('Invalid provider backup content MD5');
    names.add(name);
  }
  const homepage=manifest.find(item=>item.name==='index.html');
  if(!homepage||homepage.properties.contentLength<1)throw Error('Nonempty rollback homepage required');
  return manifest;
}
export function checkedBackupSnapshot(before,after){
  checkedBackupManifest(before);checkedBackupManifest(after);
  // Azure ETags change on byte/property updates. Reading may update access-time
  // telemetry, which is not a content mutation or a restorable HTTP property.
  const identity=items=>items.map(item=>[item.name,item.properties.etag,item.properties.contentLength]).sort((a,b)=>a[0].localeCompare(b[0]));
  if(JSON.stringify(identity(before))!==JSON.stringify(identity(after)))throw Error('Live blobs changed while preserving rollback; no overwrite is authorized');
  return true;
}
export async function verifyBackupFiles(manifest,directory){
  checkedBackupManifest(manifest);
  const observed=[];
  async function walk(path,prefix=''){
    for(const name of await readdir(path)){
      const file=join(path,name),relative=prefix+name,info=await lstat(file);
      if(info.isSymbolicLink())throw Error('Rollback symlinks are forbidden');
      if(info.isDirectory())await walk(file,relative+'/');
      else if(info.isFile())observed.push(relative);
      else throw Error('Unexpected rollback file type');
    }
  }
  await walk(directory);
  if(JSON.stringify(observed.sort())!==JSON.stringify(manifest.map(item=>item.name).sort()))throw Error('Rollback file inventory does not exactly match all live blobs');
  const files=[];
  for(const item of [...manifest].sort((a,b)=>a.name.localeCompare(b.name))){
    const bytes=await readFile(join(directory,item.name)),md5=item.properties.contentSettings?.contentMd5;
    if(bytes.length!==item.properties.contentLength)throw Error('Rollback blob length mismatch');
    if(md5&&createHash('md5').update(bytes).digest('base64')!==md5)throw Error('Rollback provider MD5 mismatch');
    files.push({path:item.name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
  return files;
}
export function azcopyBackupArguments(directory){
  return ['copy',`https://${ACCOUNT}.blob.core.windows.net/%24web/*`,directory,'--recursive=true','--as-subdir=false','--overwrite=false','--check-length=true','--check-md5=FailIfDifferent','--output-type=json','--log-level=ERROR'];
}
export async function backupStorage({root=process.cwd(),env=process.env,runner=execute}={}){
  if(env.STORAGE_ACCOUNT!==ACCOUNT)throw Error('Unexpected backup account');
  const rollback=resolve(root,'rollback'),directory=join(rollback,'files');
  await mkdir(directory,{recursive:true});
  if((await readdir(directory)).length)throw Error('Rollback destination must start empty');
  const listArgs=['storage','blob','list','--account-name',ACCOUNT,'--auth-mode','login','--container-name','$web','--output','json','--only-show-errors'];
  const list=async()=>{
    try{return JSON.parse((await runner('az',listArgs,{env,maxBuffer:32*1024*1024,timeout:BACKUP_TIMEOUTS.list,killSignal:'SIGKILL'})).stdout);}
    catch{throw Error('Authenticated rollback blob inventory unavailable; no overwrite is authorized');}
  };
  const before=checkedBackupManifest(await list());
  await writeFile(join(rollback,'manifest.json'),JSON.stringify(before,null,2)+'\n');
  let transport='azcopy-8-connections';
  try{
    const logs=resolve(env.RUNNER_TEMP||rollback,'jarvis-backup-transport');
    await mkdir(logs,{recursive:true});
    await runner('azcopy',azcopyBackupArguments(directory),{env:{...env,AZCOPY_AUTO_LOGIN_TYPE:'AZCLI',AZCOPY_CONCURRENCY_VALUE:'8',AZCOPY_CONCURRENT_FILES:'8',AZCOPY_LOG_LOCATION:logs,AZCOPY_JOB_PLAN_LOCATION:logs},maxBuffer:8*1024*1024,timeout:BACKUP_TIMEOUTS.transfer,killSignal:'SIGKILL'});
  }catch(error){
    // Only a missing installed tool selects the original authorized transport.
    // Authentication/authorization denial, corrupt transfer, timeout or other
    // failure stops before frontend mutation and is never retried around here.
    if(error.code!=='ENOENT')throw Error('Authenticated parallel rollback transfer failed; no overwrite is authorized');
    transport='original-azure-cli-missing-azcopy';
    await runner('az',['storage','blob','download-batch','--account-name',ACCOUNT,'--auth-mode','login','--source','$web','--destination',directory,'--no-progress','--only-show-errors'],{env,maxBuffer:8*1024*1024,timeout:BACKUP_TIMEOUTS.transfer,killSignal:'SIGKILL'});
  }
  const files=await verifyBackupFiles(before,directory);
  checkedBackupSnapshot(before,await list());
  await writeFile(join(rollback,'verified-backup.json'),JSON.stringify({schema:1,account:ACCOUNT,container:'$web',transport,files},null,2)+'\n');
  await writeFile(join(rollback,'new-release.json'),await readFile(resolve(root,'jarvis-release.json')));
  return {transport,files:files.length};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await backupStorage()));}
  catch(error){console.error(error.message);process.exitCode=1;}
}
