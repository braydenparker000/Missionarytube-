import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,extname} from 'node:path';
const root=resolve('.private-workspace-source/public'),stage=resolve('.private-workspace-stage'),backup=resolve('private-workspace-publication');
const manifest=JSON.parse(await readFile('scripts/private-workspace-pins.json','utf8'));
const origin='https://missionarytube.z13.web.core.windows.net';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
async function live(path){const response=await fetch(origin+'/'+path,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});if(response.status===404)return null;assert.equal(response.status,200,'Read failed: '+path);return Buffer.from(await response.arrayBuffer());}
async function checkLive(){for(const file of manifest.dependencies){const data=await live(file.path);assert.ok(data,'Missing dependency '+file.path);assert.equal(sha(data),file.sha256,'Live dependency changed: '+file.path);}for(const file of manifest.files){const data=await live(file.path),digest=data&&sha(data);assert.ok(digest===file.before||digest===file.sha256,'Unexpected existing file: '+file.path);}}
async function prepare(){assert.equal(execFileSync('git',['-C','.private-workspace-source','rev-parse','HEAD'],{encoding:'utf8'}).trim(),manifest.source);await mkdir(backup,{recursive:true});await cp(root,stage,{recursive:true});
 for(const file of manifest.files){assert.match(file.path,/^(private\/[a-z]+\.html|assets\/(?:hub|private-[a-z-]+)\.(?:js|css))$/);const bytes=await readFile(resolve(root,file.path));assert.equal(sha(bytes),file.sha256);assert.equal(bytes.length,file.bytes);const before=await live(file.path);assert.ok((before&&sha(before))===file.before||(before&&sha(before))===file.sha256,'Existing file changed: '+file.path);if(before){const path=resolve(backup,'before',file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,before);}}
 for(const file of manifest.dependencies){const bytes=await live(file.path);assert.ok(bytes);assert.equal(sha(bytes),file.sha256,'Dependency changed: '+file.path);const path=resolve(stage,file.path);await mkdir(dirname(path),{recursive:true});await writeFile(path,bytes);}
 await writeFile(resolve(backup,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log('Prepared exact source patch against '+manifest.dependencies.length+' verified live dependencies.');}
const az=(name,file,type)=>execFileSync('az',['storage','blob','upload','--account-name','missionarytube','--auth-mode','login','--container-name','$web','--name',name,'--file',file,'--content-type',type,'--content-cache-control','no-cache','--overwrite','true','--only-show-errors'],{stdio:'pipe'});
async function publish(){await checkLive();const ordered=[...manifest.files].sort((a,b)=>(a.path==='assets/hub.js')-(b.path==='assets/hub.js'));
 for(const file of ordered){const path=resolve(stage,file.path);assert.equal(sha(await readFile(path)),file.sha256);az(file.path,path,mime[extname(path)]);assert.equal(sha(await live(file.path)),file.sha256,'Live verification failed: '+file.path);}
 const receipt={schema:1,kind:'private-workspace-static-patch',source:manifest.source,orchestration:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,files:manifest.files.map(({path,sha256})=>({path,sha256})),dependencies:manifest.dependencies,workerChanged:false,authorizationChanged:false,collaboration:'unavailable-existing-service-has-no-owner-browser-read',verifiedAt:new Date().toISOString()};
 const file=resolve(backup,'private-workspace-release.json');await writeFile(file,JSON.stringify(receipt,null,2)+'\n');az('private-workspace-release.json',file,'application/json');assert.equal(sha(await live('private-workspace-release.json')),sha(await readFile(file)));console.log('Verified '+manifest.files.length+' live files and release receipt.');}
const mode=process.argv[2];if(mode==='prepare')await prepare();else if(mode==='publish')await publish();else throw Error('Use prepare or publish');
