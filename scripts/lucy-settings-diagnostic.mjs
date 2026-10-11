import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readWorkerSettings} from './check-music-worker-bindings.mjs';
import {activeVersion} from './worker-release-identity.mjs';

export const FLAG='RELAY_AGENT_LUCY_OAUTH_ENABLED';
const SOURCE='c28c1b2f70aabb5217b08bf31ffe4c93d0353765';
const ORCHESTRATION='5425b86e9661665dea5d06c0c616385a23d6c7a6';
const BEFORE_VERSION='3be007a0-cad1-45c8-8580-7a1105840d66';
const LIVE_VERSION='373ce184-a738-428f-b2c9-3088f9f75336';
const BASELINE='ff0e42eea34106d9ddf694dc50600bb2aea4101b21a4e3a18464ebc48691e415';
const fail=code=>{throw Error(code);};
// Never sort arrays: only object-key representation is normalized.
export function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value!==null&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
export const canonicalDigest=value=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
// Reproduce the retained legacy fingerprint without treating an unexpected
// binding as deployable. This diagnostic can describe such a difference only;
// the actual deployment validator is untouched.
export function settingsDigest(settings){
  if(!Array.isArray(settings?.bindings)||settings.bindings.some(binding=>typeof binding?.name!=='string'))fail('invalid_binding_metadata');
  return createHash('sha256').update(JSON.stringify(settings.bindings.map(binding=>({...binding})).sort((a,b)=>a.name.localeCompare(b.name)))).digest('hex');
}
export function checkedCheckpoint(checkpoint){
  if(checkpoint?.candidate?.source!==SOURCE||checkpoint.candidate.orchestration!==ORCHESTRATION||
    checkpoint.live?.version!==BEFORE_VERSION||checkpoint.live.settingsDigest!==BASELINE||
    checkpoint.proof?.reuse!==false||checkpoint.settingsTransition?.kind!=='lucy-oauth-discovery'||
    !/^[a-f0-9]{64}$/.test(checkpoint.settingsTransition.expectedSettingsDigest||''))fail('checkpoint_mismatch');
}
function knownDifferences(settings,baselineBindings){
  const live=new Map(settings.bindings.map(binding=>[binding.name,binding]));
  const prior=new Map(baselineBindings.map(binding=>[binding.name,binding]));
  const differences=[];
  for(const [name,binding] of prior){
    if(name===FLAG)continue;
    if(!live.has(name))differences.push({binding:name,change:'missing'});
    else{
      const fields=Object.keys(binding).filter(key=>canonicalDigest(binding[key])!==canonicalDigest(live.get(name)[key]??null));
      if(fields.length)differences.push({binding:name,changedFields:fields});
    }
  }
  for(const name of live.keys())if(name!==FLAG&&!prior.has(name))differences.push({binding:name,change:'added'});
  return differences;
}
// The legacy receipt hash is representation-sensitive and name-sorts the outer
// binding list. Prove its baseline preimage before using a canonical comparison;
// a digest alone cannot reconstruct or identify changed private values.
export function compareBindings(settings,{baselineDigest,expectedDigest,baselineBindings=[]}){
  const matches=settings.bindings.filter(binding=>binding.name===FLAG);
  if(matches.length!==1||matches[0].type!=='plain_text'||matches[0].text!=='true'||
    JSON.stringify(Object.keys(matches[0]).sort())!==JSON.stringify(['name','text','type']))
    return {verified:false,reason:'approved_flag_not_exact_plaintext_true'};
  if(new Set(settings.bindings.map(binding=>binding.name)).size!==settings.bindings.length)
    return {verified:false,reason:'duplicate_binding_names'};
  const index=settings.bindings.indexOf(matches[0]);
  const absent={...settings,bindings:settings.bindings.filter(binding=>binding.name!==FLAG)};
  const disabled={...settings,bindings:settings.bindings.map(binding=>binding.name===FLAG?{...binding,text:'false'}:binding)};
  const candidates=[['absent',absent],['false',disabled]].filter(([,value])=>settingsDigest(value)===baselineDigest);
  if(candidates.length!==1)return {verified:false,reason:'pinned_baseline_not_reconstructed',
    knownDifferences:knownDifferences(settings,baselineBindings),privateValueDifferences:'not_locatable_from_digest_only_baseline'};
  const [priorFlag,baseline]=candidates[0];
  const expectedFlag={name:FLAG,type:'plain_text',text:'true'};
  const expected={...baseline,bindings:[...baseline.bindings.filter(binding=>binding.name!==FLAG),expectedFlag]};
  if(settingsDigest(expected)!==expectedDigest)return {verified:false,reason:'retained_expected_checkpoint_mismatch'};
  // Place the approved new binding at its actual position without reordering
  // any existing array or binding contents. Array payloads remain order-sensitive.
  const comparable=baseline.bindings.filter(binding=>binding.name!==FLAG);
  comparable.splice(index,0,expectedFlag);
  const expectedCanonical=canonicalDigest(comparable),actualCanonical=canonicalDigest(settings.bindings);
  if(expectedCanonical!==actualCanonical)return {verified:false,reason:'canonical_semantic_mismatch'};
  return {verified:true,scope:'all Worker bindings covered by the pinned receipt',priorFlag,
    approvedDifference:{name:FLAG,type:'plain_text',text:'true'},otherSemanticDifferences:[],
    baselineReconstructed:true,baselineDigest,retainedExpectedDigest:expectedDigest,
    actualLegacyDigest:settingsDigest(settings),expectedCanonicalDigest:expectedCanonical,actualCanonicalDigest:actualCanonical,
    objectOrderingExplainsMismatch:settingsDigest(settings)!==expectedDigest,
    actualFlagKeyOrder:Object.keys(matches[0]),expectedFlagKeyOrder:Object.keys(expectedFlag),arraysPreserveOrder:true};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==2)fail('unexpected_arguments');
    const checkpoint=JSON.parse(await readFile('.lucy-diagnostic-checkpoint/worker-identity-before.json','utf8'));
    const baselineBindings=JSON.parse(await readFile('.lucy-diagnostic-checkpoint/worker-bindings-before.json','utf8'));
    checkedCheckpoint(checkpoint);
    const credentials={account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN};
    const settings=await readWorkerSettings(credentials);
    const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${credentials.account}/workers/scripts/jarvis-hub-api/deployments?per_page=1`,
      {method:'GET',redirect:'error',headers:{Authorization:`Bearer ${credentials.token}`},signal:AbortSignal.timeout(30000)});
    if(!response.ok)fail('diagnostic_unavailable');
    const version=activeVersion(await response.json());
    if(version!==LIVE_VERSION)fail('live_worker_changed');
    const second=await readWorkerSettings(credentials);
    if(settingsDigest(settings)!==settingsDigest(second))fail('settings_changed_between_reads');
    const result=compareBindings(settings,{baselineDigest:BASELINE,expectedDigest:checkpoint.settingsTransition.expectedSettingsDigest,baselineBindings});
    console.log(JSON.stringify({readOnly:true,workerVersion:version,...result}));
    if(!result.verified)process.exitCode=1;
  }catch(error){
    const codes=new Set(['checkpoint_mismatch','unexpected_arguments','live_worker_changed','settings_changed_between_reads','invalid_binding_metadata']);
    console.error(JSON.stringify({readOnly:true,verified:false,error:codes.has(error.message)?error.message:'diagnostic_unavailable'}));
    process.exitCode=1;
  }
}
