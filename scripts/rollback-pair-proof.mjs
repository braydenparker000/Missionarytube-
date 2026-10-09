import {isDeepStrictEqual} from 'node:util';
import {sha256} from './static-publication.mjs';

export const PAIR_CHECKS=Object.freeze(['artifact','static_backup','static_bytes','backend_identity','api_origin','podcast_readiness','schema','pending_work','previous_frontend']);
export const PAIR_STAMP='verified-recovery-pair-';
const SHA=/^[a-f0-9]{40}$/,DIGEST=/^[a-f0-9]{64}$/,UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export function previousSource(previous){
  const release=JSON.parse(previous.payload.get('release.json')||'null');
  if(release?.source!=='braydenparker999/jarvis'||!SHA.test(release.commit||'')||
    (previous.plan.proof.kind==='same-run-configured-artifact'&&release.commit!==previous.plan.proof.identity.source))throw Error('Exact previous frontend source required');
  return release.commit;
}
export function pairBindings({candidate,previous,context,backend,contracts}){
  const identity=candidate.plan.proof.identity;
  if(!SHA.test(identity?.source||'')||!SHA.test(identity?.orchestration||'')||
    backend?.candidate.source!==identity.source||backend.candidate.orchestration!==identity.orchestration||sha256(backend)!==context.backendIdentityDigest||
    !DIGEST.test(backend.candidate.backendDigest||'')||!DIGEST.test(backend.beforeLive?.settingsDigest||'')||!UUID.test(backend.beforeLive?.version||'')||
    !DIGEST.test(contracts?.schemaInputsDigest||'')||!DIGEST.test(contracts?.pendingRuntimeDigest||'')||!DIGEST.test(contracts?.runtimeRecipeDigest||''))throw Error('Exact candidate backend, source and tested contracts required');
  return {schema:2,scope:'static-pointer-only',previousReleaseId:previous.plan.releaseId,candidateReleaseId:candidate.plan.releaseId,
    previousSource:previousSource(previous),identity,artifactDigest:context.artifactDigest,backupDigest:context.backupDigest,
    previousPublicationDigest:sha256(previous.plan),candidatePublicationDigest:sha256(candidate.plan),
    backendIdentityDigest:context.backendIdentityDigest,backendDigest:backend.candidate.backendDigest,previousWorkerVersion:backend.beforeLive.version,settingsDigest:backend.beforeLive.settingsDigest,
    schemaInputsDigest:contracts.schemaInputsDigest,pendingRuntimeDigest:contracts.pendingRuntimeDigest,runtimeRecipeDigest:contracts.runtimeRecipeDigest};
}
export function checkedCompatibilityEvidence(evidence){
  const {schema,runtime}=evidence||{};
  if(!schema||!Number.isSafeInteger(schema.ddlInterruptionPoints)||schema.ddlInterruptionPoints<2||schema.ddlInterruptionPoints>1001||schema.pendingRowsPreserved!==4||
    schema.runningLeasePreserved!==true||schema.immutableReplyPreserved!==true||schema.sqliteRestoreLossWindowDemonstrated!==true||schema.providerRestoreVerified!==false)throw Error('Executed schema compatibility evidence required');
  if(!runtime||runtime.pendingRowsPreserved!==4||runtime.runningLeasePreserved!==true||runtime.immutableReplyPreserved!==true||runtime.deliveryReceiptsPreserved!==true||
    runtime.previousFrontendRendered!==true||runtime.privatePublicBoundaryPreserved!==true||runtime.unexpectedNetworkRequests!==0||runtime.productionOperations!==0||
    !Number.isSafeInteger(runtime.browserRequests)||runtime.browserRequests<1||runtime.browserRequests>500)throw Error('Executed previous frontend and pending-work evidence required');
  if(evidence.sourceAdversarialTests!=='pass')throw Error('Executed source adversarial evidence required');
  const allowedSchema=['ddlInterruptionPoints','pendingRowsPreserved','runningLeasePreserved','immutableReplyPreserved','sqliteRestoreLossWindowDemonstrated','providerRestoreVerified'];
  const allowedRuntime=['pendingRowsPreserved','runningLeasePreserved','immutableReplyPreserved','deliveryReceiptsPreserved','previousFrontendRendered','privatePublicBoundaryPreserved','unexpectedNetworkRequests','productionOperations','browserRequests'];
  const projection={schema:Object.fromEntries(allowedSchema.map(key=>[key,schema[key]])),runtime:Object.fromEntries(allowedRuntime.map(key=>[key,runtime[key]])),
    sourceAdversarialTests:'pass'};
  if(!isDeepStrictEqual(evidence,projection))throw Error('Unbounded compatibility evidence refused');return projection;
}
export function recoveryPairRecord(inputs,evidence){
  const record={bindings:pairBindings(inputs),checks:PAIR_CHECKS.map(name=>({name,status:'pass'})),evidence:checkedCompatibilityEvidence(evidence)};
  return {schema:2,pairDigest:sha256(record),record,orchestration:inputs.context.orchestration,
    runId:inputs.candidate.plan.proof.identity.runId,attempt:inputs.candidate.plan.proof.identity.attempt,recipe:inputs.backend.candidate.recipe};
}
export function checkedPairRecord(proof,inputs){
  if(proof?.schema!==2||!isDeepStrictEqual(proof.record?.bindings,pairBindings(inputs))||
    !isDeepStrictEqual(proof.record?.checks,PAIR_CHECKS.map(name=>({name,status:'pass'})))||sha256(proof.record)!==proof.pairDigest)throw Error('Exact digest-bound recovery pair record required');
  checkedCompatibilityEvidence(proof.record.evidence);return true;
}
