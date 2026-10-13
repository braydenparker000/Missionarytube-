import {RELAY_ATTACHMENT_TYPES,RELAY_ATTACHMENT_MAX_BYTES,attachmentUuid,attachmentMetadata,messageAttachments,assistantDeliverable} from './relay-attachment-contract.js';
import { API_ORIGIN } from './config.js';

// This key is deliberately unrelated to public inbox, drafts, transfers or module state.
export const OWNER_SESSION_KEY = 'jarvis.relay.owner-session.v1';
export const OWNER_MODE_KEY = 'jarvis.relay.owner-mode.v1';
const opaque = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,512}$/.test(value);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
const deviceFrom = data => {
  const device = data?.device;
  if (!device || !identifier(device.id) || typeof device.label !== 'string') throw new OwnerApiError('invalid');
  return device;
};

const deliveryStates=['saved','queued','callback_accepted','delivery_failed','reply_saved'];
function validDelivery(value){
  return value&&deliveryStates.includes(value.state)&&Number.isSafeInteger(value.pending)&&value.pending>=0&&value.pending<=8
    &&Number.isSafeInteger(value.failed)&&value.failed>=0&&value.failed<=8&&typeof value.retryable==='boolean'
    &&(value.callbackAcceptedAt===null||typeof value.callbackAcceptedAt==='string'&&Number.isFinite(Date.parse(value.callbackAcceptedAt)))
    &&(value.retryAfter===null||typeof value.retryAfter==='string'&&Number.isFinite(Date.parse(value.retryAfter)))
    &&!(value.retryable&&value.state!=='delivery_failed');
}
const jobIdentifier=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const validDate=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const jobStages=['queued','running','waiting_for_owner','completed','failed','cancelled','outcome_unknown'];
const jobKinds=['unclassified','read_only','draft','consequential'];
function completionRecord(value,job){
  if(!value||job.stage!=='completed'||!jobIdentifier(value.eventId)||!jobIdentifier(value.runId)||!jobIdentifier(value.replyId)
    ||value.runId!==job.execution?.runId||value.replyId!==job.result?.replyId||value.eventId===value.replyId
    ||!Number.isInteger(value.resultVersion)||value.resultVersion<1||value.resultVersion>5||value.resultVersion>(job.resultVersion??(job.result?1:0))
    ||typeof value.summary!=='string'||!value.summary.trim()||value.summary.length>1000||!validDate(value.createdAt)||job.finishedAt!==value.createdAt
    ||value.authentication_source!=='owner-oauth-mcp'||value.author_authenticated!==true||value.visibility!=='private')throw new OwnerApiError('invalid');
  return {eventId:value.eventId,runId:value.runId,replyId:value.replyId,resultVersion:value.resultVersion,summary:value.summary,createdAt:value.createdAt,
    authentication_source:'owner-oauth-mcp',author_authenticated:true,visibility:'private'};
}
// A saved reply is data, including when an older service called it completed.
// Shared by the parser and controller so API stubs cannot infer work completion.
export function normalizeOwnerJobCompletion(job){
  const completion=job.completion==null?null:completionRecord(job.completion,job);
  if(!completion&&job.result&&!['waiting_for_owner','failed','cancelled'].includes(job.stage)){
    const inferred=!Object.hasOwn(job,'completion')||job.stage!=='outcome_unknown'||job.failure?.code!=='completion_unverified';
    return {...job,stage:'outcome_unknown',finishedAt:null,completion:null,
      failure:inferred?{code:'completion_unverified',message:'A private reply is available; work completion has not been explicitly acknowledged.',outcome:'unknown'}:job.failure,
      retryAllowed:inferred?false:job.retryAllowed,retryRequiresConfirmation:inferred?false:job.retryRequiresConfirmation};
  }
  return {...job,completion};
}
function resultRecord(value,original){
  if(!value||!original||!jobIdentifier(value.id)||!Number.isInteger(value.version)||value.version<1||value.version>5
    ||value.format!=='plain_text'||typeof value.body!=='string'||!value.body.trim()||value.body.length>6000
    ||value.replyId!==original.replyId||!validDate(value.createdAt)||value.authentication_source!=='owner-oauth-mcp'
    ||value.author_authenticated!==true||value.visibility!=='private'
    ||(value.version===1?(value.id!==original.replyId||value.body!==original.body||value.createdAt!==original.createdAt||value.correctionSummary!==null)
      :value.id===original.replyId||typeof value.correctionSummary!=='string'||!value.correctionSummary.trim()||value.correctionSummary.length>1000))throw new OwnerApiError('invalid');
  return {id:value.id,version:value.version,format:'plain_text',body:value.body,replyId:value.replyId,createdAt:value.createdAt,
    correctionSummary:value.correctionSummary,authentication_source:'owner-oauth-mcp',author_authenticated:true,visibility:'private'};
}
function privateJob(value){
  if(!value||!jobIdentifier(value.id)||value.messageId!==value.id||!Number.isSafeInteger(value.sequence)||value.sequence<1
    ||typeof value.title!=='string'||!value.title.trim()||value.title.length>120||typeof value.body!=='string'||value.body.length>4000
    ||!jobStages.includes(value.stage)||!jobKinds.includes(value.actionKind)||!validDate(value.createdAt)||!validDate(value.updatedAt)
    ||!(value.finishedAt===null||validDate(value.finishedAt))||value.visibility!=='private'||value.author_authenticated!==true
    ||value.principal!=='github:183016859'||!identifier(value.device_id)||!['owner-device-session','owner-password-session'].includes(value.authentication_source)
    ||!(value.parentJobId===null||jobIdentifier(value.parentJobId))||!jobIdentifier(value.rootJobId)||!Number.isInteger(value.attempt)||value.attempt<1||value.attempt>5
    ||typeof value.cancelRequested!=='boolean'||!(value.cancelRequestedAt===null||validDate(value.cancelRequestedAt))
    ||typeof value.retryAllowed!=='boolean'||typeof value.retryRequiresConfirmation!=='boolean'||!(value.retryJobId===null||jobIdentifier(value.retryJobId))
    ||!validDelivery(value.delivery))throw new OwnerApiError('invalid');
  const execution=value.execution,result=value.result,failure=value.failure;
  if(!(execution===null||execution&&jobIdentifier(execution.runId)&&validDate(execution.acknowledgedAt)&&validDate(execution.leaseExpiresAt))
    ||value.stage==='running'&&!execution
    ||!(result===null||result&&result.format==='plain_text'&&typeof result.body==='string'&&result.body.length<=6000&&identifier(result.replyId)&&validDate(result.createdAt))
    ||value.stage==='completed'&&!result
    ||!(failure===null||failure&&typeof failure.code==='string'&&failure.code.length<=120&&typeof failure.message==='string'&&failure.message.length<=1000&&['unknown','known','not_started'].includes(failure.outcome)))throw new OwnerApiError('invalid');
  const revisionFields='resultVersion' in value||'latestResult' in value;
  const resultVersion=revisionFields?value.resultVersion:result?1:0;
  if(!Number.isInteger(resultVersion)||resultVersion<0||resultVersion>5||Boolean(result)!==Boolean(resultVersion))throw new OwnerApiError('invalid');
  let latestResult=null;
  if(resultVersion){latestResult=resultRecord(revisionFields?value.latestResult:{id:result.replyId,version:1,...result,correctionSummary:null,authentication_source:'owner-oauth-mcp',author_authenticated:true,visibility:'private'},result);if(latestResult.version!==resultVersion)throw new OwnerApiError('invalid');}
  else if(revisionFields&&value.latestResult!==null)throw new OwnerApiError('invalid');
  let presentation;
  if(value.presentation!==undefined){
    const p=value.presentation,u=p?.latestUpdate;
    const label=text=>text===null||typeof text==='string'&&!!text.trim()&&text.length<=120&&!/[\u0000-\u001f\u007f]/.test(text);
    if(!p||!label(p.projectTitle)||!label(p.goalTitle)||p.goalTitle&&!p.projectTitle
      ||!(u===null||u&&jobIdentifier(u.id)&&u.jobId===value.id
        &&['claimed','running','waiting_for_owner','failed','cancelled','work_completed','result_corrected'].includes(u.kind)
        &&typeof u.summary==='string'&&!!u.summary.trim()&&u.summary.length<=1000&&validDate(u.createdAt)
        &&u.authentication_source==='owner-oauth-mcp'&&u.author_authenticated===true&&u.visibility==='private'))throw new OwnerApiError('invalid');
    let work;
    if(p.work!==undefined && p.work!==null){
      const w=p.work;
      if(!jobIdentifier(w.workId)||!Number.isInteger(w.revision)||w.revision<0||w.revision>20
        ||w.authentication_source!=='owner-oauth-mcp'||w.author_authenticated!==true||w.visibility!=='private'
        ||!Array.isArray(w.plan)||w.plan.length>8||w.plan.some(step=>typeof step!=='string'||!step.trim()||step.length>1000)
        ||(w.revision===0 ? w.title!==null||w.goal!==null||w.plan.length!==0||w.updatedAt!==null||w.workId===value.id
          : w.workId!==value.rootJobId||!label(w.title)||w.title===null||typeof w.goal!=='string'||!w.goal.trim()||w.goal.length>1000||!w.plan.length||!validDate(w.updatedAt)))throw new OwnerApiError('invalid');
      work={workId:w.workId,revision:w.revision,title:w.title,goal:w.goal,plan:[...w.plan],updatedAt:w.updatedAt,
        authentication_source:'owner-oauth-mcp',author_authenticated:true,visibility:'private'};
    }
    presentation={...(p.work!==undefined?{work:work??null}:{}),projectTitle:p.projectTitle,goalTitle:p.goalTitle,latestUpdate:u?{id:u.id,jobId:u.jobId,kind:u.kind,summary:u.summary,createdAt:u.createdAt,
      authentication_source:'owner-oauth-mcp',author_authenticated:true,visibility:'private'}:null};
  }
  // Project the contract: unexpected credential, HTML or transport fields never
  // enter the controller or the private request inspector.
  return normalizeOwnerJobCompletion({id:value.id,sequence:value.sequence,messageId:value.messageId,title:value.title,body:value.body,actionKind:value.actionKind,stage:value.stage,
    createdAt:value.createdAt,updatedAt:value.updatedAt,finishedAt:value.finishedAt,visibility:'private',author_authenticated:true,principal:value.principal,
    device_id:value.device_id,authentication_source:value.authentication_source,parentJobId:value.parentJobId,rootJobId:value.rootJobId,attempt:value.attempt,
    cancelRequested:value.cancelRequested,cancelRequestedAt:value.cancelRequestedAt,execution:execution?{runId:execution.runId,acknowledgedAt:execution.acknowledgedAt,leaseExpiresAt:execution.leaseExpiresAt}:null,
    result:result?{format:'plain_text',body:result.body,replyId:result.replyId,createdAt:result.createdAt}:null,
    resultVersion,latestResult,...('completion' in value?{completion:value.completion}:{}),
    failure:failure?{code:failure.code,message:failure.message,outcome:failure.outcome}:null,
    retryAllowed:value.retryAllowed,retryRequiresConfirmation:value.retryRequiresConfirmation,retryJobId:value.retryJobId,
    delivery:{state:value.delivery.state,pending:value.delivery.pending,failed:value.delivery.failed,callbackAcceptedAt:value.delivery.callbackAcceptedAt,retryable:value.delivery.retryable,retryAfter:value.delivery.retryAfter},
    ...(presentation?{presentation}:{})});
}

function mastEntry(value) {
  let attachments;
  try{attachments=(value?.attachments??[]).map(item=>attachmentMetadata(item,{messageId:value.id,state:'linked'}));}catch{throw new OwnerApiError('invalid');}
  if(attachments.length>4||new Set(attachments.map(a=>a.id)).size!==attachments.length)throw new OwnerApiError('invalid');
  if(!value || !jobIdentifier(value.id) || !Number.isSafeInteger(value.sequence) || value.sequence<1
    || !['owner','mast'].includes(value.role) || typeof value.body!=='string' || !value.body.trim()&&!attachments.length || value.body.length>6000
    || !validDate(value.createdAt) || value.visibility!=='private' || value.destination!=='mast'
    || (value.role==='owner'?value.replyTo!==null:!jobIdentifier(value.replyTo))) throw new OwnerApiError('invalid');
  return {id:value.id,sequence:value.sequence,role:value.role,body:value.body,createdAt:value.createdAt,replyTo:value.replyTo,attachments};
}

export class OwnerApiError extends Error {
  constructor(kind = 'network', status = 0) {
    const messages = {
      attachment_cancelled: 'Attachment transfer cancelled.',
      attachment_too_large: 'Choose files no larger than 1 MB each.',
      attachment_type_unsupported: 'This file format is not supported.',
      attachment_invalid: 'This file could not be accepted. Check its format and name.',
      attachment_quota_exceeded: 'Private file storage or today’s upload allowance is full. Try a smaller file or retry later.',
      attachment_expired: 'This upload has expired. Remove the file and select it again.',
      attachment_not_found: 'This private file is no longer available.',
      attachment_already_linked: 'This file is already attached to a saved message.',
      attachment_id_conflict: 'This file upload conflicts with an earlier attempt. Retry the original selection.',
      attachment_message_conflict: 'This message must be retried with its original files.',
      network: 'Owner connection unavailable. Check your connection and retry.',
      invalid: 'The owner service returned an unreadable response. Retry later.',
      expired: 'This owner session has expired. Connect this phone again.',
      revoked: 'This phone’s owner access was revoked. Connect this phone again.',
      unauthorized: 'Owner access could not be verified. Connect this phone again.',
      unavailable: 'The owner service is temporarily unavailable. Retry later.',
      disabled: 'Owner pairing is not enabled on this Relay service yet. Public chat remains available.',
      conflict: 'This message could not be accepted. Your text is still here.',
      rejected: 'The owner service could not complete this action. Retry later.',
      login_failed: 'The username or password could not be verified. Check them and try again.',
      rate_limited: 'Too many attempts. Wait a while before trying again.',
      credential_conflict: 'Account sign-in changed while this form was open. Open a fresh form and retry.',
      consent_required: 'This account sign-in form has expired. Open a fresh form and confirm again.',
      cancelled: 'This sign-in attempt was closed.',
      device_unavailable: 'The selected device session is no longer available. Sign in again to refresh the choices.',
      device_limit: 'Ten device sessions are already active. Re-enter your account credentials and explicitly choose one session to replace.',
      duplicate_risk: 'The previous outcome is uncertain. Review and confirm the risk before creating another attempt.'
    };
    super(messages[kind] || messages.rejected);
    this.name = 'OwnerApiError';
    this.kind = kind;
    this.status = status;
  }
}

export function createRelayOwnerApi({ fetcher = globalThis.fetch, origin = API_ORIGIN, storage, attachmentDestination='owner' } = {}) {
  if(!['owner','mast'].includes(attachmentDestination))throw new OwnerApiError('invalid');
  const attachmentPath=attachmentDestination==='mast'?'/relay/owner/mast/files':'/relay/owner/attachments';
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch {} }
  let credential = null, pending = null, remember = false, storageWarning = '', authenticationEpoch = 0, selectedMode=null;
  try{const mode=storage?.getItem(OWNER_MODE_KEY);if(['owner','public'].includes(mode))selectedMode=mode;}catch{}
  function readStored() {
    try {
      const saved = JSON.parse(storage?.getItem(OWNER_SESSION_KEY) || 'null');
      return saved && opaque(saved.device_token) && identifier(saved.device_id)
        ? { device_token: saved.device_token, device_id: saved.device_id } : null;
    } catch { return null; }
  }
  credential = readStored();
  function clearCredential(token) {
    if (credential?.device_token !== token) return;
    // A previously remembered owner session may predate the scope preference.
    // Keep its owner view on expiry; only an explicit public choice changes it.
    if(selectedMode===null){selectedMode='owner';try{storage?.setItem(OWNER_MODE_KEY,'owner');}catch{}}
    credential = null;
    try {
      // Do not remove a replacement session written by another tab.
      if (readStored()?.device_token === token) storage?.removeItem(OWNER_SESSION_KEY);
    } catch { storageWarning = 'Browser storage could not be cleared. Clear browser data before sharing this phone.'; }
  }
  function persist() {
    if (!remember || !credential) return;
    try {
      if (!storage) throw Error();
      // No approval code, principal, expiry, history or draft is persisted.
      storage.setItem(OWNER_SESSION_KEY, JSON.stringify(credential));
      storageWarning = '';
    } catch { storageWarning = 'This phone is connected for this page only. Browser storage could not remember it.'; }
  }
  async function call(path, { body, token, signal, binary=false } = {}) {
    let response;
    try {
      response = await fetcher(origin + path, {
        method: body === undefined ? 'GET' : 'POST',
        credentials: 'omit', cache: 'no-store', redirect: 'error',
        headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(15000)
      });
    } catch { throw new OwnerApiError(signal?.aborted?'attachment_cancelled':'network'); }
    if(binary&&response.ok)return response;
    let data;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) {
      // Never surface raw server error text, response bodies, URLs or credentials.
      const reported = data?.code || data?.error;
      if (reported === 'device_limit' && response.status === 429 && path === '/relay/owner/login') {
        if (!Array.isArray(data.devices) || data.devices.length < 1 || data.devices.length > 10
          || data.devices.some(d => !identifier(d.id) || typeof d.label !== 'string' || d.label.length > 80
            || !Number.isFinite(Date.parse(d.lastSeenAt)) || !Number.isFinite(Date.parse(d.expiresAt)))
          || new Set(data.devices.map(d => d.id)).size !== data.devices.length) throw new OwnerApiError('invalid');
        const error = new OwnerApiError('device_limit', response.status);
        error.devices = data.devices.map(d => ({ id: d.id, label: d.label, lastSeenAt: d.lastSeenAt, expiresAt: d.expiresAt }));
        throw error;
      }
      const unauthenticated = (response.status === 401 && reported !== 'invalid_credentials') || (response.status === 403 && ['session_expired', 'session_revoked', 'invalid_session'].includes(reported));
      if (unauthenticated && token) clearCredential(token);
      const attachmentErrors=['attachment_too_large','attachment_type_unsupported','attachment_invalid','attachment_quota_exceeded','attachment_expired','attachment_not_found','attachment_already_linked','attachment_id_conflict','attachment_message_conflict'];
      const kind = (path.startsWith('/relay/owner/attachments')||path.startsWith('/relay/owner/mast')||path==='/relay/owner/messages')&&attachmentErrors.includes(reported)?reported:reported === 'invalid_credentials' ? 'login_failed'
        : response.status === 429 ? 'rate_limited'
        : reported === 'device_unavailable' ? 'device_unavailable'
        : reported === 'credential_conflict' ? 'credential_conflict'
        : reported === 'consent_required' ? 'consent_required'
        : reported === 'duplicate_risk_confirmation_required' ? 'duplicate_risk'
        : unauthenticated
        ? reported === 'session_expired' ? 'expired' : reported === 'session_revoked' ? 'revoked' : 'unauthorized'
        : reported === 'owner_not_enabled' ? 'disabled' : response.status >= 500 ? 'unavailable' : response.status === 409 ? 'conflict' : 'rejected';
      throw new OwnerApiError(kind, response.status);
    }
    if (!data || typeof data !== 'object') throw new OwnerApiError('invalid');
    return data;
  }
  function validateAccountPolicy(data) {
    if (data.access_days !== 365 || data.preserve_existing_sessions !== true
      || data.policy?.min_password_length !== 16 || data.policy?.max_password_length !== 128
      || data.policy?.max_password_bytes !== 256 || data.policy?.username_pattern !== '[a-z0-9][a-z0-9._-]{2,31}') throw new OwnerApiError('invalid');
  }
  function validateAccountStatus(data) {
    validateAccountPolicy(data);
    if (typeof data.configured !== 'boolean' || (data.configured && (typeof data.username !== 'string' || !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(data.username)))) throw new OwnerApiError('invalid');
  }
  const authenticated = (path, body) => {
    if (!credential) throw new OwnerApiError('unauthorized');
    return call(path, { body, token: credential.device_token });
  };
  async function attachmentCall(path,options={}){
    if(!credential)throw new OwnerApiError('unauthorized');
    const token=credential.device_token,result=await call(path,{...options,token});
    if(credential?.device_token!==token)throw new OwnerApiError('unauthorized');
    if(options.signal?.aborted)throw new OwnerApiError('attachment_cancelled');return result;
  }
  function parseAttachments(entry){try{return messageAttachments(entry);}catch{throw new OwnerApiError('invalid');}}
  return {
    get hasCredential() { return !!credential; },
    get deviceId() { return credential?.device_id || null; },
    get storageWarning() { return storageWarning; },
    get selectedMode(){return selectedMode||(credential?'owner':'public');},
    selectMode(mode){if(!['owner','public'].includes(mode))return;selectedMode=mode;try{storage?.setItem(OWNER_MODE_KEY,mode);}catch{}},
    refreshStoredCredential() { ++authenticationEpoch; pending = null; credential = readStored(); return !!credential; },
    cancelAuthentication() { ++authenticationEpoch; },
    async login(username, password, label, { remember: approvedPersistence = false, replaceDeviceId, confirmReplacement } = {}) {
      const epoch = ++authenticationEpoch;
      if ((replaceDeviceId !== undefined || confirmReplacement !== undefined) && (!identifier(replaceDeviceId) || confirmReplacement !== true)) throw new OwnerApiError('invalid');
      const data = await call('/relay/owner/login', { body: { username, password, label,
        ...(replaceDeviceId === undefined ? {} : { replace_device_id: replaceDeviceId, confirm_replacement: true }) } });
      if (epoch !== authenticationEpoch) throw new OwnerApiError('cancelled');
      const device = deviceFrom(data);
      if (data.status !== 'approved' || !opaque(data.device_token) || data.access_days !== 365) throw new OwnerApiError('invalid');
      pending = null; remember = approvedPersistence === true; storageWarning = '';
      const previousToken = credential?.device_token;
      if (previousToken) clearCredential(previousToken);
      credential = { device_token: data.device_token, device_id: device.id };
      persist();
      return { status: data.status, device, access_days: data.access_days, ...(data.jobs_enabled===true?{jobs_enabled:true}:{}),...(data.attachments_enabled===true?{attachments_enabled:true}:{}) };
    },
    async credentials() {
      const data = await authenticated('/relay/owner/credentials');
      validateAccountStatus(data);
      return data;
    },
    async prepareCredentials(purpose) {
      if (!['setup', 'change'].includes(purpose)) throw new OwnerApiError('invalid');
      const data = await authenticated('/relay/owner/credentials/prepare', { purpose });
      if (!opaque(data.consent_token) || data.purpose !== purpose || !Number.isFinite(Date.parse(data.expires_at))) throw new OwnerApiError('invalid');
      validateAccountPolicy(data);
      return data;
    },
    async saveCredentials({ username, password, password_confirmation, consent_token, current_password }) {
      const data = await authenticated('/relay/owner/credentials', { username, password, password_confirmation, consent_token,
        confirm: true, access_days: 365, preserve_existing_sessions: true,
        ...(current_password === undefined ? {} : { current_password }) });
      validateAccountStatus(data);
      return data;
    },
    async startPairing(label, { remember: approvedPersistence = false } = {}) {
      const data = await call('/relay/owner/pair/start', { body: { label } });
      if (!identifier(data.request_id) || !opaque(data.device_token) || typeof data.code !== 'string'
        || !/^[A-Z0-9 -]{4,40}$/.test(data.code) || !Number.isFinite(Date.parse(data.expires_at))) throw new OwnerApiError('invalid');
      pending = { request_id: data.request_id, device_token: data.device_token };
      remember = approvedPersistence === true;
      storageWarning = '';
      // The pending verifier is memory-only and grants no owner identity.
      return { request_id: data.request_id, code: data.code, expires_at: data.expires_at };
    },
    async pairingStatus() {
      if (!pending) throw new OwnerApiError('unauthorized');
      const pairing = pending;
      const data = await call('/relay/owner/pair/status', { token: pairing.device_token, body: { request_id: pairing.request_id } });
      if (!['pending', 'approved', 'expired', 'revoked'].includes(data.status)) throw new OwnerApiError('invalid');
      if (pending !== pairing) throw new OwnerApiError('unauthorized');
      if (data.status === 'approved') {
        const device = deviceFrom(data);
        credential = { device_token: pairing.device_token, device_id: device.id };
        pending = null;
        persist();
      } else if (data.status !== 'pending') pending = null;
      return data;
    },
    cancelPairing() { pending = null; },
    async session() {
      const data = await authenticated('/relay/owner/session');
      deviceFrom(data);
      if (data.status !== 'approved') throw new OwnerApiError('invalid');
      if (data.device.id !== credential?.device_id) throw new OwnerApiError('invalid');
      return data;
    },
    async mastWork(operation,args={}) {
      const paths={list:'/relay/owner/mast/work?after='+encodeURIComponent(args.after||'0'),read:'/relay/owner/mast/work/detail?job_id='+encodeURIComponent(args.job_id||''),create:'/relay/owner/mast/work',cancel:'/relay/owner/mast/work/cancel',retry:'/relay/owner/mast/work/retry'};
      if(!Object.hasOwn(paths,operation))throw new OwnerApiError('invalid');
      const data=await attachmentCall(paths[operation],['list','read'].includes(operation)?{}:{body:args});
      const check=j=>{if(!j||!identifier(j.id)||typeof j.title!=='string'||typeof j.body!=='string'||!['queued','running','waiting_for_owner','completed','failed','cancelled','outcome_unknown'].includes(j.stage)||j.visibility!=='private'||j.destination!=='mast'||!Array.isArray(j.resultHistory))throw new OwnerApiError('invalid');return j;};
      if(operation==='list'){if(!Array.isArray(data.jobs)||data.jobs.length>50||!(data.nextCursor===null||/^[0-9]+$/.test(data.nextCursor)&&Number(data.nextCursor)>Number(args.after||0)))throw new OwnerApiError('invalid');data.jobs.forEach(check);}else check(data.job);
      if(['create','retry'].includes(operation)&&data.job.id!==args.id)throw new OwnerApiError('invalid');
      return data;
    },
    async mastMessages(after='0') {
      const data=await attachmentCall('/relay/owner/mast?after='+encodeURIComponent(after));
      if(typeof data.enabled!=='boolean' || !Array.isArray(data.messages) || data.messages.length>50
        || !(data.nextCursor===null || /^[0-9]+$/.test(data.nextCursor)&&Number(data.nextCursor)>Number(after))
        || !data.enabled&&(data.messages.length||data.nextCursor!==null)) throw new OwnerApiError('invalid');
      if(data.adapter!=null&&(!validDate(data.adapter.lastFetchedAt)||!Number.isSafeInteger(data.adapter.fetchedSequence)||data.adapter.fetchedSequence<0))throw new OwnerApiError('invalid');
      return {enabled:data.enabled,adapter:data.adapter||null,messages:data.messages.map(mastEntry),nextCursor:data.nextCursor};
    },
    async mastSend(id, body, attachmentIds=[]) {
      const data=await attachmentCall('/relay/owner/mast', {body:{id,body,...(attachmentIds.length?{attachment_ids:attachmentIds}:{})}});
      const entry=mastEntry(data.entry);
      if(entry.id!==id || entry.role!=='owner' || entry.body!==body.trim()||JSON.stringify(entry.attachments.map(a=>a.id))!==JSON.stringify(attachmentIds))throw new OwnerApiError('invalid');
      return {entry};
    },
    async messages(after = '0') {
      if (!/^\d{1,15}$/.test(String(after))) throw new OwnerApiError('invalid');
      const data = await authenticated('/relay/owner/messages?after=' + encodeURIComponent(after));
      if (!Array.isArray(data.messages) || data.messages.some(m => !identifier(m.id) || typeof m.body !== 'string'
        || !['user', 'assistant'].includes(m.role) || !Number.isFinite(Date.parse(m.createdAt))
        || m.visibility !== 'private' || m.author_authenticated !== true
        || m.delivery!==undefined&&!validDelivery(m.delivery))
        || !(data.nextCursor === null || /^\d{1,15}$/.test(String(data.nextCursor)))) throw new OwnerApiError('invalid');
      return {...data,messages:data.messages.map(entry=>({...entry,attachments:parseAttachments(entry)}))};
    },
    async chatUpdates(after='0'){
      if(!/^\d{1,15}$/.test(String(after)))throw new OwnerApiError('invalid');
      const data=await authenticated('/relay/owner/updates?after='+encodeURIComponent(after));
      if(data.visibility!=='private'||!Array.isArray(data.updates)||data.updates.length>50
        ||!(data.nextCursor===null||/^\d{1,15}$/.test(data.nextCursor)&&Number(data.nextCursor)>Number(after)))throw new OwnerApiError('invalid');
      let previous=Number(after);const updates=data.updates.map(item=>{
        if(!Number.isSafeInteger(item.sequence)||item.sequence<=previous)throw new OwnerApiError('invalid');previous=item.sequence;
        let parsed;try{parsed=assistantDeliverable(item,item.messageId);}catch{throw new OwnerApiError('invalid');}
        return {...parsed,replyTo:item.messageId,sequence:item.sequence};
      });
      if(new Set(updates.map(x=>x.id)).size!==updates.length||data.nextCursor!==null&&(!updates.length||Number(data.nextCursor)!==previous))throw new OwnerApiError('invalid');
      return {updates,nextCursor:data.nextCursor};
    },
    async deliverables(messageId,after='0',{signal}={}){
      if(!attachmentUuid(messageId)||!/^\d{1,15}$/.test(String(after)))throw new OwnerApiError('invalid');
      const query=new URLSearchParams({message_id:messageId,after:String(after),limit:'10'});
      const data=await attachmentCall('/relay/owner/deliverables?'+query,{signal});
      if(data.visibility!=='private'||data.message_id!==messageId||!Array.isArray(data.deliverables)||data.deliverables.length>10
        ||!(data.nextCursor===null||/^\d{1,15}$/.test(data.nextCursor)&&Number(data.nextCursor)>Number(after)))throw new OwnerApiError('invalid');
      let deliveries;try{deliveries=data.deliverables.map(item=>assistantDeliverable(item,messageId));}catch{throw new OwnerApiError('invalid');}
      if(new Set(deliveries.map(item=>item.id)).size!==deliveries.length||data.nextCursor!==null&&!deliveries.length)throw new OwnerApiError('invalid');
      return {deliverables:deliveries,nextCursor:data.nextCursor};
    },
    async uploadAttachment(messageId,id,file,{signal}={}){
      const token=credential?.device_token;if(!token)throw new OwnerApiError('unauthorized');
      if(!attachmentUuid(messageId)||!attachmentUuid(id)||!file||!RELAY_ATTACHMENT_TYPES.includes(file.type)||!file.size||file.size>RELAY_ATTACHMENT_MAX_BYTES)throw new OwnerApiError('attachment_invalid');
      const bytes=new Uint8Array(await file.arrayBuffer());if(credential?.device_token!==token)throw new OwnerApiError('unauthorized');if(signal?.aborted)throw new OwnerApiError('attachment_cancelled');
      let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
      const data=await attachmentCall(attachmentPath,{body:{id,message_id:messageId,name:file.name,mime_type:file.type,data_base64:btoa(binary)},signal});
      let attachment;try{attachment=attachmentMetadata(data.attachment,{messageId});}catch{throw new OwnerApiError('invalid');}
      if(data.visibility!=='private'||typeof data.newWrite!=='boolean'||attachment.id!==id||attachment.name!==file.name||attachment.mimeType!==file.type||attachment.sizeBytes!==bytes.length)throw new OwnerApiError('invalid');
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
      if(attachment.sha256!==hash)throw new OwnerApiError('invalid');return attachment;
    },
    async discardAttachment(messageId,id){
      if(!attachmentUuid(messageId)||!attachmentUuid(id))throw new OwnerApiError('invalid');
      return attachmentCall(attachmentPath+'/discard',{body:{message_id:messageId,attachment_id:id}});
    },
    async attachmentContent(metadata,{preview=false,signal}={}){
      const token=credential?.device_token;if(!token)throw new OwnerApiError('unauthorized');
      let item;try{item=attachmentMetadata(metadata,{state:'linked'});}catch{throw new OwnerApiError('invalid');}
      if(preview&&!['image/png','image/jpeg','image/webp'].includes(item.mimeType))throw new OwnerApiError('attachment_invalid');
      const query=new URLSearchParams({message_id:item.messageId,attachment_id:item.id,...(preview?{preview:'1'}:{})});
      const response=await attachmentCall(attachmentPath+'/content?'+query,{binary:true,signal});
      if(response.headers.get('content-type')?.split(';')[0].trim()!==item.mimeType)throw new OwnerApiError('invalid');
      const chunks=[];let size=0;const reader=response.body.getReader();
      try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>item.sizeBytes||signal?.aborted)throw new OwnerApiError(signal?.aborted?'attachment_cancelled':'invalid');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error instanceof OwnerApiError?error:new OwnerApiError('network');}
      if(size!==item.sizeBytes)throw new OwnerApiError('invalid');const blob=new Blob(chunks,{type:item.mimeType});
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
      if(credential?.device_token!==token)throw new OwnerApiError('unauthorized');if(signal?.aborted)throw new OwnerApiError('attachment_cancelled');
      if(hash!==item.sha256)throw new OwnerApiError('invalid');return blob;
    },
    async deliveries(messageIds){
      if(!Array.isArray(messageIds)||messageIds.length>50||messageIds.some(id=>!identifier(id))||new Set(messageIds).size!==messageIds.length)throw new OwnerApiError('invalid');
      const data=await authenticated('/relay/owner/delivery',{message_ids:messageIds});
      if(!Array.isArray(data.deliveries)||data.deliveries.length!==messageIds.length||data.deliveries.some((d,i)=>d.message_id!==messageIds[i]||!validDelivery(d)))throw new OwnerApiError('invalid');
      // Project only the owner-safe evidence fields. Ignore unexpected server data.
      return {deliveries:data.deliveries.map(d=>({message_id:d.message_id,state:d.state,pending:d.pending,failed:d.failed,
        callbackAcceptedAt:d.callbackAcceptedAt,retryable:d.retryable,retryAfter:d.retryAfter}))};
    },
    async retryDelivery(messageId){
      if(!identifier(messageId))throw new OwnerApiError('invalid');
      const data=await authenticated('/relay/owner/delivery/retry',{message_id:messageId});
      if(!Number.isSafeInteger(data.retried)||data.retried<0||data.retried>8)throw new OwnerApiError('invalid');
      return {retried:data.retried};
    },
    async sendMessage(id, body, attachmentIds=[]) {
      if(!identifier(id)||typeof body!=='string'||!body.trim()&&!attachmentIds.length||body.length>4000||!Array.isArray(attachmentIds)||attachmentIds.length>4||attachmentIds.some(id=>!attachmentUuid(id))||new Set(attachmentIds).size!==attachmentIds.length)throw new OwnerApiError('invalid');
      const data=await authenticated('/relay/owner/messages', { id, body,...(attachmentIds.length?{attachment_ids:attachmentIds}:{}) });
      const entry=data.entry;
      if(!entry||entry.id!==id||entry.body!==body.trim()||entry.role!=='user'||entry.visibility!=='private'
        ||entry.author_authenticated!==true||!Number.isFinite(Date.parse(entry.createdAt))||typeof data.newWrite!=='boolean'
        ||entry.delivery!==undefined&&!validDelivery(entry.delivery))throw new OwnerApiError('invalid');
      const attachments=parseAttachments(entry);if(JSON.stringify(attachments.map(item=>item.id))!==JSON.stringify(attachmentIds))throw new OwnerApiError('invalid');
      return {...data,entry:{...entry,attachments}};
    },
    async jobs(after='0'){
      if(!/^\d{1,15}$/.test(String(after)))throw new OwnerApiError('invalid');
      const data=await authenticated('/relay/owner/jobs?after='+encodeURIComponent(after)+'&limit=50');
      if(!Array.isArray(data.jobs)||data.jobs.length>50||!(data.nextCursor===null||/^\d{1,15}$/.test(String(data.nextCursor))))throw new OwnerApiError('invalid');
      const jobs=data.jobs.map(privateJob);
      if(jobs.some((job,i)=>job.sequence<=Number(after)||(i>0&&job.sequence<=jobs[i-1].sequence))||new Set(jobs.map(j=>j.id)).size!==jobs.length)throw new OwnerApiError('invalid');
      if(data.nextCursor!==null&&(!jobs.length||Number(data.nextCursor)!==jobs.at(-1).sequence))throw new OwnerApiError('invalid');
      return {jobs,nextCursor:data.nextCursor};
    },
    async jobChanges(after='0',through=null){
      const position=value=>typeof value==='string'&&/^\d{1,15}$/.test(value)&&Number.isSafeInteger(Number(value));
      if(!position(after)||through!==null&&(!position(through)||Number(through)<Number(after)))throw new OwnerApiError('invalid');
      let data;
      try{data=await authenticated('/relay/owner/jobs/changes?after='+encodeURIComponent(after)+'&limit=50'+(through===null?'':'&through='+encodeURIComponent(through)));}
      catch(error){if(error instanceof OwnerApiError&&error.status===409)error.jobCursorReset=true;throw error;}
      if(!Array.isArray(data.changes)||data.changes.length>50||!position(data.cursor)||!position(data.through)
        ||Number(data.cursor)<Number(after)||Number(data.cursor)>Number(data.through)||typeof data.bootstrapPending!=='boolean'
        ||through!==null&&data.through!==through
        ||!(data.nextCursor===null||position(data.nextCursor)&&data.nextCursor===data.cursor&&Number(data.cursor)<Number(data.through)))throw new OwnerApiError('invalid');
      const changes=data.changes.map((change,i)=>{
        if(!change||!position(change.cursor)||Number(change.cursor)<=Number(after)||Number(change.cursor)>Number(data.cursor)
          ||i>0&&Number(change.cursor)<=Number(data.changes[i-1].cursor))throw new OwnerApiError('invalid');
        return {cursor:change.cursor,job:privateJob(change.job)};
      });
      if(new Set(changes.map(change=>change.job.id)).size!==changes.length
        ||data.nextCursor!==null&&(!changes.length||changes.at(-1).cursor!==data.cursor)
        ||data.nextCursor===null&&data.cursor!==data.through)throw new OwnerApiError('invalid');
      return {changes,cursor:data.cursor,through:data.through,nextCursor:data.nextCursor,bootstrapPending:data.bootstrapPending};
    },
    async jobDetail(id){
      if(!jobIdentifier(id))throw new OwnerApiError('invalid');
      const data=await authenticated('/relay/owner/jobs/detail?job_id='+encodeURIComponent(id));
      const job=privateJob(data.job);
      if(job.id!==id||!Array.isArray(data.events)||data.events.length>110||data.events.some(e=>!e||typeof e.id!=='string'||e.id.length>256||e.jobId!==id||typeof e.kind!=='string'||e.kind.length>80||typeof e.summary!=='string'||e.summary.length>1000||!validDate(e.createdAt)||!['owner-device-session','owner-password-session','owner-oauth-mcp'].includes(e.authentication_source)))throw new OwnerApiError('invalid');
      const hasRevisionFields='resultVersion' in data.job||'latestResult' in data.job;
      const history=data.resultHistory===undefined&&!hasRevisionFields?(job.latestResult?[job.latestResult]:[]):data.resultHistory;
      if(!Array.isArray(history)||history.length!==job.resultVersion||history.length>5)throw new OwnerApiError('invalid');
      const resultHistory=history.map((value,i)=>{const record=resultRecord(value,job.result);if(record.version!==i+1)throw new OwnerApiError('invalid');return record;});
      if(new Set(resultHistory.map(record=>record.id)).size!==resultHistory.length
        ||resultHistory.length&&JSON.stringify(resultHistory.at(-1))!==JSON.stringify(job.latestResult))throw new OwnerApiError('invalid');
      return {job,resultHistory,events:data.events.map(e=>({id:e.id,jobId:e.jobId,kind:e.kind,summary:e.summary,createdAt:e.createdAt,authentication_source:e.authentication_source}))};
    },
    async createJob({id,title,body,actionKind,projectTitle='',goalTitle=''}){
      if(!jobIdentifier(id)||typeof title!=='string'||!title.trim()||title.length>120||typeof body!=='string'||!body.trim()||body.length>4000||!['read_only','draft','consequential'].includes(actionKind))throw new OwnerApiError('invalid');
      const label=text=>typeof text==='string'&&text.length<=120&&!/[\u0000-\u001f\u007f]/.test(text);
      if(!label(projectTitle)||!label(goalTitle)||goalTitle.trim()&&!projectTitle.trim())throw new OwnerApiError('invalid');
      const data=await authenticated('/relay/owner/jobs',{id,title,body,action_kind:actionKind,
        ...(projectTitle.trim()?{project_title:projectTitle.trim()}:{}),...(goalTitle.trim()?{goal_title:goalTitle.trim()}:{})});
      const job=privateJob(data.job);
      if(job.id!==id||job.body!==body.trim()||job.title!==title.trim()||job.actionKind!==actionKind||typeof data.newWrite!=='boolean')throw new OwnerApiError('invalid');
      if((projectTitle.trim()||goalTitle.trim())&&(!job.presentation||job.presentation.projectTitle!==(projectTitle.trim()||null)||job.presentation.goalTitle!==(goalTitle.trim()||null)))throw new OwnerApiError('invalid');
      return {job,newWrite:data.newWrite};
    },
    async cancelJob(id){
      if(!jobIdentifier(id))throw new OwnerApiError('invalid');
      const data=await authenticated('/relay/owner/jobs/cancel',{job_id:id});
      const job=privateJob(data.job);
      if(job.id!==id||typeof data.newWrite!=='boolean')throw new OwnerApiError('invalid');
      return {job,newWrite:data.newWrite};
    },
    async retryJob(jobId,id,confirmDuplicateRisk=false){
      if(!jobIdentifier(jobId)||!jobIdentifier(id)||id===jobId||typeof confirmDuplicateRisk!=='boolean')throw new OwnerApiError('invalid');
      const data=await authenticated('/relay/owner/jobs/retry',{job_id:jobId,id,...(confirmDuplicateRisk?{confirm_duplicate_risk:true}:{})});
      const job=privateJob(data.job);
      if(job.id!==id||job.parentJobId!==jobId||typeof data.newWrite!=='boolean')throw new OwnerApiError('invalid');
      return {job,newWrite:data.newWrite};
    },
    async devices() {
      const data = await authenticated('/relay/owner/devices');
      if (!Array.isArray(data.devices) || data.devices.some(d => !identifier(d.id) || typeof d.label !== 'string')) throw new OwnerApiError('invalid');
      return data;
    },
    async revoke(deviceId) {
      if (!identifier(deviceId)) throw new OwnerApiError('invalid');
      const token = credential?.device_token;
      const data = await authenticated('/relay/owner/devices/revoke', { device_id: deviceId });
      if (deviceId === credential?.device_id) clearCredential(token);
      return data;
    }
  };
}
