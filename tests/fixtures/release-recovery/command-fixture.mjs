import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {artifactIdentity,fileManifest} from '../../../scripts/qualified-artifact.mjs';
import {verifyBackupFiles} from '../../../scripts/backup-jarvis-storage.mjs';
import {publicationCommand,preservedPublication,PUBLICATION_RECIPE_FILES} from '../../../scripts/publish-jarvis-versioned.mjs';
import {rollbackPairContracts,ADVERSARIAL_TESTS} from '../../../scripts/rollback-pair-contracts.mjs';
import {recoveryPairRecord} from '../../../scripts/rollback-pair-proof.mjs';
import {sha256,mimeFor} from '../../../scripts/static-publication.mjs';

const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const commit=root=>{git(root,'init');git(root,'add','.');git(root,'-c','user.name=Recovery fixture','-c','user.email=fixture@example.test','commit','-m','synthetic fixture');return git(root,'rev-parse','HEAD');};
const policy="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'";
const html=name=>Buffer.from('<!doctype html><head><meta http-equiv="Content-Security-Policy" content="'+policy+'"><script src="/assets/app.js"></script></head><body>'+name+'</body>');
export const SYNTHETIC_EVIDENCE=Object.freeze({
  schema:{ddlInterruptionPoints:2,pendingRowsPreserved:4,runningLeasePreserved:true,immutableReplyPreserved:true,sqliteRestoreLossWindowDemonstrated:true,providerRestoreVerified:false},
  runtime:{pendingRowsPreserved:4,runningLeasePreserved:true,immutableReplyPreserved:true,deliveryReceiptsPreserved:true,previousFrontendRendered:true,privatePublicBoundaryPreserved:true,unexpectedNetworkRequests:0,productionOperations:0,browserRequests:12},sourceAdversarialTests:'pass'});
export async function commandFixture(){
  const root=await mkdtemp(join(tmpdir(),'versioned-command-')),source=join(root,'.jarvis-source');
  for(const [path,bytes] of [['package-lock.json','{}'],['backend/worker.js',"db.exec('CREATE TABLE IF NOT EXISTS synthetic_pending(id TEXT PRIMARY KEY)');"],['tests/relay-fixture.js','// synthetic contract'],['tests/helpers/indirect.js','// synthetic transitive helper'],...ADVERSARIAL_TESTS.map(path=>[path,'// synthetic adversarial contract'])]){
    await mkdir(dirname(join(source,path)),{recursive:true});await writeFile(join(source,path),bytes);
  }
  const sourceSHA=commit(source);
  for(const path of PUBLICATION_RECIPE_FILES){await mkdir(dirname(join(root,path)),{recursive:true});await copyFile(new URL('../../../'+path,import.meta.url),join(root,path));}
  await writeFile(join(root,'scripts/build-jarvis.mjs'),'// synthetic qualified build recipe');
  await writeFile(join(root,'package-lock.json'),'{}');
  await writeFile(join(root,'jarvis-release.json'),JSON.stringify({repository:'braydenparker999/jarvis',commit:sourceSHA,
    storageOrigin:'https://static.example.test',apiOrigin:'https://api.example.test',deployPodcastWorker:true,preserveDriveCatalog:true}));
  await writeFile(join(root,'.gitignore'),'.jarvis-source/\ndist/\nrollback/\n.publication/\n*artifact.json\nworker-identity-*.json\n');
  const orchestration=commit(root),env={GITHUB_REPOSITORY:'braydenparker000/Missionarytube-',GITHUB_REF:'refs/heads/main',
    GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1',STORAGE_ACCOUNT:'missionarytube',CLOUDFLARE_API_TOKEN:'SYNTHETIC_SECRET',CLOUDFLARE_ACCOUNT_ID:'SYNTHETIC_ACCOUNT'};
  const release=Buffer.from(JSON.stringify({source:'braydenparker999/jarvis',commit:sourceSHA}));
  const old=new Map([['index.html',html('old')],['assets/app.js',Buffer.from('window.old=true;')],['release.json',release]]);
  const next=new Map([['index.html',html('candidate')],['assets/app.js',Buffer.from('window.candidate=true;')],['release.json',release]]);
  for(const [kind,files] of [['dist',next],['rollback/files',old]])for(const [path,bytes] of files){const dest=join(root,kind,path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,bytes);}
  const candidate={source:sourceSHA,orchestration,backendDigest:'b'.repeat(64),backendReusable:true,
    recipe:[{path:'scripts/qualify-jarvis-rollback-pair.mjs',sha:git(root,'rev-parse','HEAD:scripts/qualify-jarvis-rollback-pair.mjs')}]};
  const beforeLive={version:'12345678-1234-1234-1234-123456789abc',settingsDigest:'a'.repeat(64)},backend={schema:1,candidate,beforeLive};
  const currentBackend={candidate,live:{...beforeLive,version:'23456789-1234-1234-1234-123456789abc'}};
  await writeFile(join(root,'worker-identity-planned.json'),JSON.stringify(backend));await writeFile(join(root,'worker-identity-current.json'),JSON.stringify(currentBackend));
  const blobs=new Map([...old].map(([name,bytes])=>[name,{bytes,contentType:mimeFor(name),etag:'"old-'+name+'"'}])),writes=[],calls=[];
  let serial=0,failAt=Infinity,afterWrite=false,proof,runStatus='in_progress',runConclusion=null;
  const store={get:async key=>blobs.get(key),route:async key=>blobs.get(key+'index.html'),put:async(key,bytes,contentType,condition)=>{
    if(condition.ifNoneMatch==='*'&&blobs.has(key)||condition.ifMatch&&condition.ifMatch!==blobs.get(key)?.etag)throw Error('provider precondition');
    if(writes.length===failAt&&!afterWrite)throw Error('interrupted');
    blobs.set(key,{bytes:Buffer.from(bytes),contentType,etag:'"write-'+(++serial)+'"'});writes.push(key);
    if(writes.length-1===failAt&&afterWrite)throw Error('interrupted after provider commit');
  }};
  const runner=async(binary,args,options)=>{calls.push({binary,args,env:options.env});return {stdout:'fixture pass'};};
  const run=()=>({id:123,run_attempt:1,repository:{full_name:env.GITHUB_REPOSITORY},head_repository:{full_name:env.GITHUB_REPOSITORY},
    head_sha:orchestration,status:runStatus,conclusion:runConclusion,event:'push',head_branch:'main',path:'.github/workflows/deploy-azure-storage.yml'});
  const step=(name,number)=>({name,number,status:'completed',conclusion:'success'});
  const job=(name,steps,conclusion='success')=>({name,run_id:123,run_attempt:1,head_sha:orchestration,status:'completed',conclusion,steps});
  const jobs=()=>({total_count:2,jobs:[job('rollback-pair',[step('Qualify the exact previous frontend and candidate backend pair',1),
    step('verified-recovery-pair-'+proof.pairDigest,2),step('Preserve the exact qualified rollback pair',3)]),
    job('deploy',[step('Record the actual qualified active Worker and configuration',1),step('verified-release-backend-'+sha256(currentBackend),2),
      step('Preserve the activated Worker checkpoint before frontend writes',3)],runConclusion??'success')]});
  const tree={truncated:false,tree:candidate.recipe.map(row=>({...row,type:'blob'}))};
  const metadata=async url=>url.includes('/jobs?')?jobs():url.includes('/git/trees/')?tree:run();
  const opts={root,env,store,runner,metadata};
  const seal=async()=>{const identity=await artifactIdentity({root,env:opts.env}),files=await fileManifest(join(root,'dist')),base={identity,files};
    await writeFile(join(root,'qualified-artifact.json'),JSON.stringify(base));await writeFile(join(root,'configured-artifact.json'),JSON.stringify({identity:{...identity,baseManifestDigest:sha256(base)},files}));};
  const backup=async()=>{
    await rm(join(root,'rollback/files'),{recursive:true,force:true});const manifest=[];
    for(const [name,item] of blobs){const dest=join(root,'rollback/files',name);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,item.bytes);
      manifest.push({name,properties:{contentLength:item.bytes.length,etag:item.etag,contentSettings:{contentType:item.contentType,contentMd5:createHash('md5').update(item.bytes).digest('base64')}}});}
    await writeFile(join(root,'rollback/manifest.json'),JSON.stringify(manifest));
    await writeFile(join(root,'rollback/verified-backup.json'),JSON.stringify({schema:1,account:'missionarytube',container:'$web',files:await verifyBackupFiles(manifest,join(root,'rollback/files'))}));
  };
  const pair=async()=>{const inputs=await preservedPublication(opts);inputs.contracts=await rollbackPairContracts({...inputs,root});
    proof=recoveryPairRecord(inputs,SYNTHETIC_EVIDENCE);await writeFile(join(root,'.publication/rollback-compatibility.json'),JSON.stringify(proof));return proof;};
  const prepare=async()=>{const result=await publicationCommand('prepare',opts);await pair();return result;};
  const approve=async action=>{await publicationCommand('inspect',opts);const context=JSON.parse(await readFile(join(root,'.publication/context.json'))),expected=JSON.parse(await readFile(join(root,'.publication/observed-pointer.json')));
    return {schema:1,action,account:'missionarytube',container:'$web',releaseId:context.releaseId,previousReleaseId:context.previousReleaseId,
      artifactDigest:context.artifactDigest,backupDigest:context.backupDigest,backendIdentityDigest:context.backendIdentityDigest,expectedPointer:expected};};
  await seal();await backup();
  return {root,env,sourceSHA,orchestration,backend,currentBackend,store,writes,calls,runner,blobs,opts,prepare,pair,approve,seal,backup,metadata,jobs,tree,run,
    finish:conclusion=>{runStatus='completed';runConclusion=conclusion;},interrupt:(at,after=false)=>{failAt=at;afterWrite=after;},
    cleanup:()=>rm(root,{recursive:true,force:true})};
}
