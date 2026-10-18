// Guarded, additive enablement of the dedicated Daily Board issue source.
// The legacy Jarvis issue remains active; rollback removes only the two
// destination bindings and republishes the exact same Worker bytes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {checkedBindings} from './check-music-worker-bindings.mjs';
import {preservingMetadata,observe} from './publish-private-collaboration.mjs';
import {fullSettingsDigest} from './saving-worker-reconciliation.mjs';
import {settingsDigest} from './worker-release-identity.mjs';
import {BASELINE,CANDIDATE,CREATION_SETTINGS_DIGEST,UPLOAD_SETTINGS_DIGEST} from './publications-import-release.mjs';

export const DESTINATION=Object.freeze({repository:'braydenparker000/Missionarytube-',issue:250,
  title:'Jarvis publications — replies and Daily Board (Missionarytube)',
  issueVariable:'JARVIS_DAILY_BOARD_DESTINATION_ISSUE',enableVariable:'JARVIS_DAILY_BOARD_DESTINATION_ENABLED'});
export const OUT=resolve('daily-board-reader-cutover');
const sha=value=>createHash('sha256').update(value).digest('hex');
const credentials=()=>({account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN});
const uploadMarker='workers/triggered_by';
const flagNames=[DESTINATION.issueVariable,DESTINATION.enableVariable];

function normalizedSettings(settings){
  return {...settings,annotations:{...(settings.annotations||{}),[uploadMarker]:'create_version_api'}};
}
function binding(settings,name){return settings.bindings.filter(x=>x?.name===name);}
export function checkedInactiveSettings(settings){
  checkedBindings(settings);
  assert.equal(binding(settings,DESTINATION.issueVariable).length,0,'Destination issue binding must be absent before enablement');
  assert.equal(binding(settings,DESTINATION.enableVariable).length,0,'Destination enable binding must be absent before enablement');
  const marker=settings.annotations?.[uploadMarker];
  assert.ok(['create_version_api','upload'].includes(marker),'Unexpected Worker upload audit annotation');
  assert.ok([CREATION_SETTINGS_DIGEST,UPLOAD_SETTINGS_DIGEST].includes(fullSettingsDigest(settings)),'Worker settings differ from the pinned disabled baseline');
  assert.equal(settingsDigest(settings),BASELINE.settingsShapeDigest,'Worker resource bindings changed');
  return settings;
}
export function destinationBindings(bindings,enabled){
  assert.ok(Array.isArray(bindings));assert.equal(typeof enabled,'boolean');
  const plain=bindings.filter(item=>item.type==='plain_text'&&!flagNames.includes(item.name));
  if(enabled)plain.push({type:'plain_text',name:DESTINATION.issueVariable,text:String(DESTINATION.issue)},
    {type:'plain_text',name:DESTINATION.enableVariable,text:'true'});
  return plain;
}
export function destinationPlainText(settings,enabled){
  assert.equal(typeof enabled,'boolean');
  if(enabled)checkedInactiveSettings(settings);else checkedDestinationSettings(settings,true);
  const metadata=preservingMetadata(settings);
  // Explicitly carry forward the existing readable plain-text variables while
  // retaining opaque secret and resource bindings by type.
  metadata.keep_bindings=metadata.keep_bindings.filter(type=>type!=='plain_text');
  metadata.bindings=destinationBindings(settings.bindings,enabled);
  return metadata;
}
export function checkedDestinationSettings(settings,enabled){
  assert.equal(typeof enabled,'boolean');checkedBindings(settings);
  assert.deepEqual(binding(settings,DESTINATION.issueVariable),[{type:'plain_text',name:DESTINATION.issueVariable,text:String(DESTINATION.issue)}]);
  assert.deepEqual(binding(settings,DESTINATION.enableVariable),[{type:'plain_text',name:DESTINATION.enableVariable,text:String(enabled)}]);
  const marker=settings.annotations?.[uploadMarker];
  assert.ok(['create_version_api','upload'].includes(marker),'Unexpected Worker upload audit annotation');
  const expected={...settings,bindings:settings.bindings.filter(item=>!flagNames.includes(item.name))};
  assert.ok([CREATION_SETTINGS_DIGEST,UPLOAD_SETTINGS_DIGEST].includes(fullSettingsDigest(normalizedSettings(expected))),
    'Worker settings changed beyond the exact destination bindings and provider upload annotation');
  assert.equal(settingsDigest(expected),BASELINE.settingsShapeDigest,'Worker resource bindings changed');
  return settings;
}
export function checkedIssue(issue){
  assert.equal(issue?.number,DESTINATION.issue);assert.equal(issue?.title,DESTINATION.title);
  assert.equal(issue?.state,'open');assert.equal(issue?.pull_request,undefined,'Destination must be a dedicated issue');
  assert.equal(issue?.user?.id,183016859,'Destination issue must be owner-created');return issue;
}
export async function checkIssues(fetcher=fetch){
  const get=async(repository,number)=>{
    const response=await fetcher(`https://api.github.com/repos/${repository}/issues/${number}`,{
      method:'GET',redirect:'error',headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(15000)});
    assert.equal(response.status,200,'Publication issue could not be verified');return response.json();
  };
  const [source,destination]=await Promise.all([get('braydenparker999/jarvis',2),get(DESTINATION.repository,DESTINATION.issue)]);
  assert.equal(source.number,2);assert.equal(source.state,'open');assert.equal(source.title,'Jarvis publications — replies and Daily Board');
  assert.equal(source.user?.id,183016859,'Legacy source issue owner changed');
  checkedIssue(destination);return {sourceOpen:true,destinationOpen:true,destinationIssue:DESTINATION.issue};
}
async function workerBytes(fetcher=fetch){
  const {account,token}=credentials();
  const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/content/v2`,{
    method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,'Worker source bytes are unavailable');
  const files=[...(await response.formData()).entries()].filter(([,value])=>typeof value!=='string');
  assert.equal(files.length,1);assert.equal(files[0][0],'worker.js');return Buffer.from(await files[0][1].arrayBuffer());
}
function checkedCode(identity){
  assert.equal(identity.codeSha256,CANDIDATE.workerSha256,'Live Worker is not the qualified dual-source importer');
  assert.equal(identity.schedulesDigest,BASELINE.schedulesDigest,'Worker schedules changed');return identity;
}
async function publishBindings({settings,bundle,before,enabled,fetcher=fetch}){
  const {account,token}=credentials();
  const current=await observe({account,token,fetcher});assert.deepEqual(current.identity,before,'Worker changed before setting update');
  const body=new FormData();body.set('metadata',JSON.stringify(destinationPlainText(settings,enabled)));
  body.set('worker.js',new Blob([bundle],{type:'application/javascript+module'}),'worker.js');
  const response=await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api`,{
    method:'PUT',body,redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,'Worker setting update failed');assert.equal((await response.json()).success,true);
  const after=await observe({account,token,fetcher});checkedCode(after.identity);assert.notEqual(after.identity.version,before.version);
  const expectedBindings=enabled?[...settings.bindings.filter(item=>!flagNames.includes(item.name)),
    {type:'plain_text',name:DESTINATION.issueVariable,text:String(DESTINATION.issue)},
    {type:'plain_text',name:DESTINATION.enableVariable,text:'true'}]:settings.bindings.filter(item=>!flagNames.includes(item.name));
  assert.equal(fullSettingsDigest(normalizedSettings(after.settings)),fullSettingsDigest(normalizedSettings({...settings,bindings:expectedBindings})),
    'Worker settings changed beyond the exact destination bindings');
  if(enabled)checkedDestinationSettings(after.settings,true);else checkedInactiveSettings(after.settings);return after;
}
async function liveRead(fetcher=fetch){
  const origin='https://jarvis-hub-api.braydenparker999.workers.dev';
  const health=await fetcher(origin+'/health',{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000)});
  assert.equal(health.status,200,'Live Worker health check failed');
  const h=await health.json();assert.equal(h.ok,true);assert.equal(h.mode,'github-publications');
  const response=await fetcher(origin+'/v1/state',{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000)});
  assert.equal(response.status,200,'Public reader sync failed');const state=await response.json();
  assert.ok(Array.isArray(state.posts),'Public reader response has no posts collection');
  return {health:true,readerSync:true,postCount:state.posts.length};
}
async function prepare(mode,issueNumber){
  assert.ok(['enable','rollback'].includes(mode));const {account,token}=credentials();
  assert.equal(issueNumber,String(DESTINATION.issue),'Unexpected Daily Board destination issue');
  await checkIssues();
  const current=await observe({account,token});checkedCode(current.identity);
  const bytes=await workerBytes();assert.equal(sha(bytes),CANDIDATE.workerSha256);
  if(mode==='enable')checkedInactiveSettings(current.settings);else checkedDestinationSettings(current.settings,true);
  assert.equal(current.identity.settingsDigest,fullSettingsDigest(current.settings));
  const checkpoint={schema:1,mode,issue:DESTINATION.issue,repository:DESTINATION.repository,before:current.identity,
    beforeSettingsSha256:fullSettingsDigest(current.settings),workerSha256:sha(bytes),schedulesDigest:current.identity.schedulesDigest};
  await mkdir(OUT,{recursive:true});await writeFile(resolve(OUT,'worker-before.js'),bytes);
  await writeFile(resolve(OUT,'checkpoint.json'),JSON.stringify(checkpoint,null,2)+'\n');
  console.log(JSON.stringify({preflight:true,mode,issue:DESTINATION.issue,workerSha256:checkpoint.workerSha256,
    settingsCaptured:true,schedulesUnchanged:true,oldIssueOpen:true,destinationIssueOpen:true}));
}
async function apply(mode,issueNumber){
  assert.ok(['enable','rollback'].includes(mode));const checkpoint=JSON.parse(await readFile(resolve(OUT,'checkpoint.json'),'utf8'));
  assert.equal(issueNumber,String(DESTINATION.issue),'Unexpected Daily Board destination issue');
  assert.equal(checkpoint.mode,mode);assert.equal(checkpoint.issue,DESTINATION.issue);assert.equal(checkpoint.repository,DESTINATION.repository);
  const backup=await readFile(resolve(OUT,'worker-before.js'));assert.equal(sha(backup),checkpoint.workerSha256);
  const {account,token}=credentials(),current=await observe({account,token});checkedCode(current.identity);
  assert.equal(current.identity.settingsDigest,checkpoint.before.settingsDigest,'Worker changed after preflight');
  assert.equal(current.identity.schedulesDigest,checkpoint.schedulesDigest);
  assert.equal(sha(await workerBytes()),checkpoint.workerSha256);
  if(mode==='enable')checkedInactiveSettings(current.settings);else checkedDestinationSettings(current.settings,true);
  assert.equal(fullSettingsDigest(current.settings),checkpoint.beforeSettingsSha256);
  const after=await publishBindings({settings:current.settings,bundle:backup,before:current.identity,enabled:mode==='enable'});
  const live=await liveRead();
  const receipt={schema:1,mode,repository:DESTINATION.repository,issue:DESTINATION.issue,
    before:{version:checkpoint.before.version,codeSha256:checkpoint.before.codeSha256,settingsSha256:checkpoint.beforeSettingsSha256},
    after:{version:after.identity.version,codeSha256:after.identity.codeSha256,settingsSha256:fullSettingsDigest(after.settings),
      schedulesSha256:after.identity.schedulesDigest},reader:live,oldIssueRetained:true,writerAutomationChanged:false};
  await writeFile(resolve(OUT,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({complete:true,...receipt}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const [, , action, mode, issueNumber]=process.argv;
  assert.ok(['prepare','apply'].includes(action));
  (action==='prepare'?prepare(mode,issueNumber):apply(mode,issueNumber)).catch(error=>{
    console.error('Daily Board reader update stopped at a guarded step; inspect provider state before retrying.');
    if(process.env.DAILY_BOARD_READER_DEBUG==='1')console.error(String(error.message||error).split('\n')[0]);process.exitCode=1;
  });
}
