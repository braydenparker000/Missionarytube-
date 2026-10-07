import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {checkedBackupManifest,checkedBackupSnapshot,verifyBackupFiles,azcopyBackupArguments,backupStorage,BACKUP_TIMEOUTS} from '../scripts/backup-jarvis-storage.mjs';

const blobs=[['index.html','existing homepage'],['assets/app.js','existing application'],['orphan/retained.txt','preserve even unreferenced blobs']];
const manifest=()=>blobs.map(([name,bytes])=>({name,metadata:{restore:'unchanged'},properties:{etag:'"fixture-'+name+'"',contentLength:Buffer.byteLength(bytes),contentSettings:{contentType:name.endsWith('.html')?'text/html':'application/octet-stream',contentMd5:createHash('md5').update(bytes).digest('base64')}}}));
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'verified-backup-'));await writeFile(join(root,'jarvis-release.json'),'fixture release');
  const directory=join(root,'rollback','files');
  const materialize=async()=>{for(const [name,bytes] of blobs){const path=join(directory,name);await mkdir(join(path,'..'),{recursive:true});await writeFile(path,bytes);}};
  return {root,directory,materialize,cleanup:()=>rm(root,{recursive:true,force:true})};
}
test('backup inventory requires every safe unique blob with exact lengths and ETags',()=>{
  checkedBackupManifest(manifest());
  for(const name of ['/absolute','../escape','bad/../escape','bad\\escape','bad//path','bad\0path'])assert.throws(()=>checkedBackupManifest([...manifest(),{...manifest()[1],name}]),/path/);
  assert.throws(()=>checkedBackupManifest([...manifest(),manifest()[0]]),/duplicate/);
  assert.throws(()=>checkedBackupManifest(manifest().slice(1)),/homepage/);
  assert.throws(()=>checkedBackupManifest(manifest().map(item=>({...item,properties:{...item.properties,etag:null}}))),/ETag/);
  assert.throws(()=>checkedBackupManifest(manifest().map(item=>({...item,properties:{...item.properties,contentLength:-1}}))),/length/);
  assert.throws(()=>checkedBackupManifest(manifest().map(item=>({...item,properties:{...item.properties,contentSettings:{contentMd5:'invalid'}}}))),/MD5/);
});
test('parallel transport is bounded, authenticated with the existing CLI session and validates lengths/MD5',()=>{
  const args=azcopyBackupArguments('/fixture/rollback/files');
  assert.equal(args[0],'copy');assert.equal(args[1],'https://missionarytube.blob.core.windows.net/%24web/*');
  for(const flag of ['--recursive=true','--as-subdir=false','--overwrite=false','--check-length=true','--check-md5=FailIfDifferent'])assert.ok(args.includes(flag));
  assert.ok(!args.join(' ').includes('token'));assert.ok(!args.some(value=>value.includes('NoCheck')));
});
test('rollback bytes include unreferenced blobs, verify provider hashes and receive SHA256 sealing',async()=>{
  const f=await fixture();try{
    await f.materialize();const files=await verifyBackupFiles(manifest(),f.directory);assert.equal(files.length,blobs.length);
    assert.ok(files.every(item=>/^[a-f0-9]{64}$/.test(item.sha256)));
    await writeFile(join(f.directory,'assets/app.js'),'wrong bytes');await assert.rejects(verifyBackupFiles(manifest(),f.directory),/length|MD5/);
  }finally{await f.cleanup();}
});
test('missing, extra, same-size tampered and symlinked rollback files fail before overwrite',async()=>{
  for(const mutation of ['missing','extra','same-size','symlink']){
    const f=await fixture();try{
      await f.materialize();
      if(mutation==='missing')await rm(join(f.directory,'assets/app.js'));
      if(mutation==='extra')await writeFile(join(f.directory,'extra.txt'),'unexpected');
      if(mutation==='same-size')await writeFile(join(f.directory,'assets/app.js'),'x'.repeat(Buffer.byteLength(blobs[1][1])));
      if(mutation==='symlink'){await rm(join(f.directory,'assets/app.js'));await symlink(join(f.directory,'index.html'),join(f.directory,'assets/app.js'));}
      await assert.rejects(verifyBackupFiles(manifest(),f.directory),/inventory|MD5|symlinks/);
    }finally{await f.cleanup();}
  }
});
test('all property bytes are retained while ETag, length and inventory drift reject an unstable backup',()=>{
  checkedBackupSnapshot(manifest(),[...manifest()].reverse());
  for(const after of [manifest().slice(1),manifest().map((item,index)=>index?item:{...item,properties:{...item.properties,etag:'"changed"'}}),manifest().map((item,index)=>index?item:{...item,properties:{...item.properties,contentLength:item.properties.contentLength+1}})])assert.throws(()=>checkedBackupSnapshot(manifest(),after));
});
test('complete transfer saves full properties and verified bytes only after a stable second listing',async()=>{
  const f=await fixture(),calls=[];try{
    const runner=async(binary,args,options)=>{
      calls.push({binary,args,env:options.env});
      assert.equal(options.timeout,binary==='azcopy'?BACKUP_TIMEOUTS.transfer:BACKUP_TIMEOUTS.list);assert.equal(options.killSignal,'SIGKILL');
      if(binary==='azcopy'){assert.equal(options.env.AZCOPY_AUTO_LOGIN_TYPE,'AZCLI');assert.equal(options.env.AZCOPY_CONCURRENCY_VALUE,'8');assert.equal(options.env.AZCOPY_CONCURRENT_FILES,'8');await f.materialize();return {stdout:'completed'};}
      assert.equal(binary,'az');assert.ok(args.includes('login'));return {stdout:JSON.stringify(manifest())};
    };
    const result=await backupStorage({root:f.root,env:{STORAGE_ACCOUNT:'missionarytube',RUNNER_TEMP:join(f.root,'temporary')},runner});
    assert.deepEqual(result,{transport:'azcopy-8-connections',files:3});assert.deepEqual(calls.map(item=>item.binary),['az','azcopy','az']);
    assert.deepEqual(JSON.parse(await readFile(join(f.root,'rollback/manifest.json'),'utf8')),manifest());
    assert.equal(await readFile(join(f.root,'rollback/new-release.json'),'utf8'),'fixture release');
    assert.equal(JSON.parse(await readFile(join(f.root,'rollback/verified-backup.json'),'utf8')).files.length,3);
  }finally{await f.cleanup();}
});
test('missing installed AzCopy alone falls back to original authorized CLI transport',async()=>{
  const f=await fixture(),calls=[];try{
    const runner=async(binary,args)=>{calls.push({binary,args});if(binary==='azcopy')throw Object.assign(Error('missing'),{code:'ENOENT'});if(args.includes('download-batch'))await f.materialize();return {stdout:JSON.stringify(manifest())};};
    assert.equal((await backupStorage({root:f.root,env:{STORAGE_ACCOUNT:'missionarytube'},runner})).transport,'original-azure-cli-missing-azcopy');
    assert.ok(calls.some(item=>item.args.includes('download-batch')));
  }finally{await f.cleanup();}
});
test('authorization denial, corruption, timeout or other transfer failure never retries another route',async()=>{
  for(const code of ['AuthorizationPermissionMismatch','AuthenticationFailed','ETIMEDOUT',1]){
    const f=await fixture(),calls=[];try{
      const runner=async(binary,args)=>{calls.push({binary,args});if(binary==='azcopy')throw Object.assign(Error('private provider diagnostic'),{code});return {stdout:JSON.stringify(manifest())};};
      await assert.rejects(backupStorage({root:f.root,env:{STORAGE_ACCOUNT:'missionarytube'},runner}),/no overwrite/);
      assert.equal(calls.length,2);assert.ok(!calls.some(item=>item.args.includes('download-batch')));
      await assert.rejects(readFile(join(f.root,'rollback/verified-backup.json')));
    }finally{await f.cleanup();}
  }
});
test('a concurrent live mutation cannot produce a verified backup or replacement release',async()=>{
  const f=await fixture();let listing=0;try{
    const runner=async(binary)=>{if(binary==='azcopy'){await f.materialize();return {stdout:''};}const items=manifest();if(listing++)items[0].properties.etag='"changed during transfer"';return {stdout:JSON.stringify(items)};};
    await assert.rejects(backupStorage({root:f.root,env:{STORAGE_ACCOUNT:'missionarytube'},runner}),/changed while/);
    await assert.rejects(readFile(join(f.root,'rollback/verified-backup.json')));
    await assert.rejects(readFile(join(f.root,'rollback/new-release.json')));
  }finally{await f.cleanup();}
});
