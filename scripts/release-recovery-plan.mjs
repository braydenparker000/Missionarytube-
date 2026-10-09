// Non-sensitive, offline recovery decisions. No private jobs, payloads,
// credentials, provider settings, callback URLs or message bodies are read.
const HASH=/^[a-f0-9]{64}$/,VERSION=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export const PHASES=Object.freeze(['prepared','staging','staged','bootstrap','selected','verified','blocked']);
export const CHECKS=Object.freeze(['artifact','static_backup','database_recovery','backend_identity','api_origin','podcast_readiness','static_bytes','static_mime','directory_routes','pointer','mobile','schema','pending_work']);
export function boundedEvidence(value){
  if(!value||!PHASES.includes(value.phase)||!HASH.test(value.releaseId||'')||!Array.isArray(value.checks)||value.checks.length>CHECKS.length)throw Error('Bounded release evidence required');
  const seen=new Set();
  const checks=value.checks.map(item=>{
    if(!CHECKS.includes(item.name)||seen.has(item.name)||!['pass','fail','unknown','not_applicable'].includes(item.status))throw Error('Unknown or duplicate readiness check');
    seen.add(item.name);return {name:item.name,status:item.status};
  });
  const result={schema:1,phase:value.phase,releaseId:value.releaseId,checks};
  for(const name of ['artifactDigest','backupDigest','backendDigest','settingsDigest','pointerDigest'])if(value[name]!==undefined){if(!HASH.test(value[name]))throw Error('Invalid evidence digest');result[name]=value[name];}
  if(value.workerVersion!==undefined){if(!VERSION.test(value.workerVersion))throw Error('Invalid Worker identity');result.workerVersion=value.workerVersion;}
  if(value.completed!==undefined||value.total!==undefined){if(!Number.isSafeInteger(value.completed)||!Number.isSafeInteger(value.total)||value.completed<0||value.completed>value.total||value.total>10000)throw Error('Unbounded stage counts');result.completed=value.completed;result.total=value.total;}
  // Projection is intentional: arbitrary error text and extra fields never get
  // persisted. Digests authenticate bytes; they are not proof of a database backup.
  return result;
}
export function recoveryDecision(e){
  const good=name=>e?.[name]===true;
  const all=(...keys)=>keys.every(good);
  const actions=[];
  if(!all('exactArtifact','staticBackup','providerIdentity','originReadiness'))return {go:false,reason:'missing_release_evidence',actions};
  if(e.pointer==='old'&&e.upload==='partial')return {go:true,reason:'resume_immutable_stage',actions:['approve_exact_resume','reconcile_remote_hashes_and_mime','recheck_backend_and_readiness']};
  if(e.pointer==='candidate'&&e.verification!=='pass'){
    if(!all('previousStaticVerified','previousFrontendCompatible'))return {go:false,reason:'rollback_frontend_not_proven',actions};
    actions.push('approve_pointer_rollback','recheck_backend_and_readiness','compare_and_swap_previous_pointer','verify_canonical_routes_and_mobile');
    return {go:true,reason:'frontend_rollback_only',actions};
  }
  if(e.worker==='rollback_requested'){
    if(!all('previousWorkerProven','schemaBackwardCompatible','pendingWorkCompatible'))return {go:false,reason:'worker_or_schema_rollback_not_proven',actions};
    return {go:true,reason:'worker_rollback_separate_approval',actions:['approve_exact_worker_version','verify_preserved_bindings','verify_schema_and_pending_work','verify_actual_100_percent_version','requalify_frontend_pair']};
  }
  if(e.schema==='restore_requested'){
    if(!all('databaseSnapshotVerified','providerRestoreProcedureVerified','pendingWorkReconciliationVerified'))return {go:false,reason:'database_restore_unproven',actions};
    return {go:true,reason:'database_restore_separate_approval',actions:['approve_database_restore_and_loss_window','approved_provider_restore','reconcile_pending_work_without_replay','verify_private_and_public_boundaries']};
  }
  if(e.pointer==='unknown'||e.pointer==='other')return {go:false,reason:'inspect_pointer_before_mutation',actions};
  if(e.pointer==='candidate'&&e.verification==='pass')return {go:true,reason:'verify_receipt_before_completion',actions:['verify_digest_bound_receipt']};
  return {go:false,reason:'fresh_exact_qualification_required',actions};
}
