import {createPrivateAttachmentContent} from './relay-attachment-content.js';
import { createRelayOwnerApi, OwnerApiError, normalizeOwnerJobCompletion } from './relay-owner-api.js';
import { icon, autosize, copyText, richText, messageDay } from './ui.js';
import { createOwnerDraftStore } from './relay-draft-store.js';

// Private history and failed sends exist only in this closure; unsent drafts
// also survive in tab storage. In particular,
// never pass them to conversation(), public submitMessage() or shared sync.
export function createRelayOwnerController({ api = createRelayOwnerApi(), draftStore = createOwnerDraftStore(), uuid = () => crypto.randomUUID(), onModeChange = () => {} } = {}) {
  const listeners = new Set();
  let attachmentProvider=null;
  let generation = 0, reading = null, failedSend = null, cursor = '0', accountConsent = null, detailEpoch = 0;
  let jobCursor='0',jobFence=null,jobChangesSupported=typeof api.jobChanges==='function',jobResetCache=null,jobReading=null;
  const retryAttempts=new Map(),deliveryReads=new Map();
  function cancelDeliveryReads(){for(const read of deliveryReads.values())read.abort();deliveryReads.clear();for(const page of Object.values(state.deliveryPages))page.busy=false;}
  const queries={chat:'',work:''};
  let state = { mode: api.selectedMode==='owner'||(api.selectedMode===undefined&&api.hasCredential)?'owner':'public', status: api.hasCredential ? 'unknown' : 'none',
    messages: [], deliveryPages:{}, draft: draftStore.read(), devices: [], device: null, pairing: null, error: '', warning: '', busy: false, sending: false, query: '', authenticating: false, account: null, accountReady: false, accountNotice: '', loginDevices: [],
    attachmentsEnabled:false,attachmentCount:0,attachmentRetry:false,jobsEnabled:false,jobs:[],jobsError:'',syncStale:false,jobMode:false,taskDraftKept:false,jobTitle:'',jobKind:'consequential',jobProject:'',jobGoal:'',requestsOnly:false,workFilter:'all',sendUnconfirmed:false,sendNotice:'',jobDetailId:null,jobDetail:null,jobDetailBusy:false,jobDetailError:'',jobDetailStale:false,jobBusy:false };
  const emit = () => { for (const listener of listeners) listener(); };
  const mode = next => { if (next !== state.mode) { cancelDeliveryReads();state.mode = next; onModeChange(next); } emit(); };
  function clearPrivate({preserveDraft = false} = {}) { attachmentProvider?.()?.clear(); state.loginDevices = []; accountConsent = null; state.account = null; state.accountReady = false; state.accountNotice = ''; state.messages = [];cancelDeliveryReads();state.deliveryPages={}; if (!preserveDraft) {state.draft = '';draftStore.save('');} state.devices = []; state.device = null; failedSend = null; cursor = '0';
    jobCursor='0';jobFence=null;jobChangesSupported=typeof api.jobChanges==='function';jobResetCache=null;jobReading=null;
    ++detailEpoch;retryAttempts.clear();queries.chat='';queries.work='';state.attachmentsEnabled=false;state.attachmentCount=0;state.attachmentRetry=false;state.jobsEnabled=false;state.jobs=[];state.jobsError='';state.syncStale=false;state.query='';state.jobMode=false;state.taskDraftKept=false;state.jobTitle='';state.jobKind='consequential';state.jobProject='';state.jobGoal='';state.requestsOnly=false;state.workFilter='all';state.sendUnconfirmed=false;state.sendNotice='';state.jobDetailId=null;state.jobDetail=null;state.jobDetailBusy=false;state.jobDetailError='';state.jobDetailStale=false;state.jobBusy=false; }
  function failure(error) {
    const safe = error instanceof OwnerApiError ? error : new OwnerApiError('network');
    state.error = safe.message;
    if(['network','unavailable','invalid'].includes(safe.kind))state.syncStale=true;
    if (['expired', 'revoked', 'unauthorized'].includes(safe.kind)) {
      // Invalidate every concurrent read/send, including a response which was
      // authenticated before another operation confirmed revocation.
      ++generation; reading = null; state.busy = false; state.sending = false; state.authenticating = false; api.cancelAuthentication?.();
      clearPrivate({preserveDraft: safe.kind === 'expired'}); state.pairing = null;
      state.status = ['expired', 'revoked'].includes(safe.kind) ? safe.kind : 'unknown';
      emit();
    }
    return safe;
  }
  async function readMessages(epoch) {
    let after = cursor;
    const seen = new Set([after]);
    do {
      const data = await api.messages(after);
      if (epoch !== generation) return;
      const map = new Map(state.messages.map(m => [m.id, m]));
      for (const message of data.messages) map.set(message.id, { ...message, saved: true });
      state.messages = [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      // Every successful page is an authenticated use. Keep the last received
      // numeric position so later reads are incremental even when nextCursor=null.
      if (data.messages.length) {
        const final = data.messages.at(-1);
        if (/^\d{1,15}$/.test(String(final.sequence))) cursor = String(final.sequence);
      }
      if (data.nextCursor !== null) {
        const next = String(data.nextCursor);
        if (seen.has(next) || Number(next) <= Number(after)) throw new OwnerApiError('invalid');
        seen.add(next); cursor = next; after = next;
      } else after = null;
    } while (after !== null);
    // Entry sequences are append-only; transport state is mutable. Refresh that
    // evidence separately so an incremental history cursor cannot hide failures.
    const replied=new Set(state.messages.filter(m=>m.replyTo).map(m=>m.replyTo));
    const recent=Date.now()-30*86400000;
    const ids=state.messages.filter(m=>m.role==='user'&&m.delivery&&!replied.has(m.id)&&Date.parse(m.createdAt)>=recent).map(m=>m.id);
    for(const message of state.messages)if(replied.has(message.id)&&message.delivery)message.delivery={...message.delivery,state:'reply_saved',retryable:false,retryAfter:null};
    if(api.deliveries)for(let i=0;i<ids.length;i+=50){
      const result=await api.deliveries(ids.slice(i,i+50));
      if(epoch!==generation)return;
      const updates=new Map(result.deliveries.map(d=>[d.message_id,d]));
      for(const message of state.messages)if(updates.has(message.id)){
        const {message_id,...delivery}=updates.get(message.id);message.delivery=delivery;
      }
    }
  }
  async function readJobs(epoch){
    if(jobReading?.epoch===epoch){await jobReading.promise;if(epoch!==generation)return;return readJobs(epoch);}
    const reading={epoch,promise:null};jobReading=reading;reading.promise=readJobPages(epoch);
    try{return await reading.promise;}finally{if(jobReading===reading)jobReading=null;}
  }
  async function readJobPages(epoch){
    if(!state.jobsEnabled||!api.jobs&&!api.jobChanges)return;
    try{
      if(jobChangesSupported){
        const seen=new Set();let complete=false,resetOnce=false;
        // Cache and committed cursor stay together in this private closure. A
        // reload starts from zero; a failed page resumes from the last good one.
        // Bound one refresh even while a large migration or active writers run.
        for(let page=0;page<20;++page){
          const position=jobCursor+':'+(jobFence??'fresh');
          if(seen.has(position))throw new OwnerApiError('invalid');seen.add(position);
          let data;
          try{data=await api.jobChanges(jobCursor,jobFence);}
          catch(error){
            if(epoch!==generation)return;
            if(error instanceof OwnerApiError&&[404,405].includes(error.status)){jobChangesSupported=false;return readJobPages(epoch);}
            if(error?.jobCursorReset&&!resetOnce){resetOnce=true;jobCursor='0';jobFence=null;jobResetCache=new Map();seen.clear();continue;}
            throw error;
          }
          if(epoch!==generation)return;
          const valid=value=>typeof value==='string'&&/^\d{1,15}$/.test(value)&&Number.isSafeInteger(Number(value));
          if(!data||!Array.isArray(data.changes)||data.changes.length>50||!valid(data.cursor)||!valid(data.through)
            ||Number(data.cursor)<Number(jobCursor)||Number(data.cursor)>Number(data.through)||typeof data.bootstrapPending!=='boolean'
            ||jobFence!==null&&data.through!==jobFence
            ||!(data.nextCursor===null&&data.cursor===data.through||data.nextCursor===data.cursor&&Number(data.cursor)<Number(data.through)))throw new OwnerApiError('invalid');
          const updates=data.changes.map((change,i)=>{
            if(!change||!valid(change.cursor)||Number(change.cursor)<=Number(jobCursor)||Number(change.cursor)>Number(data.cursor)
              ||i>0&&Number(change.cursor)<=Number(data.changes[i-1].cursor))throw new OwnerApiError('invalid');
            return normalizeOwnerJobCompletion(change.job);
          });
          if(new Set(updates.map(job=>job.id)).size!==updates.length
            ||data.nextCursor!==null&&(!updates.length||data.changes.at(-1).cursor!==data.cursor))throw new OwnerApiError('invalid');
          const jobs=new Map(jobResetCache??state.jobs.map(job=>[job.id,job]));
          for(const job of updates)jobs.set(job.id,job);
          if(jobResetCache)jobResetCache=jobs;else state.jobs=[...jobs.values()].sort((a,b)=>a.sequence-b.sequence);
          jobCursor=data.cursor;jobFence=data.nextCursor===null?null:data.through;
          if(data.nextCursor===null&&!data.bootstrapPending){complete=true;break;}
        }
        if(!complete){state.jobsError='Private request history is still refreshing. Refresh again to continue.';state.syncStale=true;return;}
        if(jobResetCache){state.jobs=[...jobResetCache.values()].sort((a,b)=>a.sequence-b.sequence);jobResetCache=null;}
      }else{
        // Restored older services retain their original creation-page contract.
        let after='0';const seen=new Set([after]),jobs=new Map();
        do{
          const data=await api.jobs(after);if(epoch!==generation)return;
          for(const job of data.jobs)jobs.set(job.id,normalizeOwnerJobCompletion(job));
          if(data.nextCursor!==null){const next=String(data.nextCursor);if(seen.has(next)||Number(next)<=Number(after))throw new OwnerApiError('invalid');seen.add(next);after=next;}else after=null;
        }while(after!==null);
        state.jobs=[...jobs.values()].sort((a,b)=>a.sequence-b.sequence);
      }
      state.jobsError='';state.syncStale=false;
      if(state.jobDetailId)await controller.inspectJob(state.jobDetailId,{refresh:true});
    }catch(error){if(epoch!==generation)return;const safe=error instanceof OwnerApiError?error:new OwnerApiError('network');if(['expired','revoked','unauthorized'].includes(safe.kind))failure(safe);else{state.jobsError=safe.message;state.syncStale=true;}}
  }
  function mergeJob(job){const jobs=new Map(state.jobs.map(j=>[j.id,j]));jobs.set(job.id,normalizeOwnerJobCompletion(job));state.jobs=[...jobs.values()].sort((a,b)=>a.sequence-b.sequence);}
  const controller = {
    get mode() { return state.mode; },
    get hasCredential() { return api.hasCredential; },
    get status() { return state.status; },
    get requestsOnly() { return state.requestsOnly; },
    get jobMode() { return state.jobMode; },
    get sending() { return state.sending; },
    get busy() { return state.busy; },
    get attachmentsEnabled(){return state.attachmentsEnabled;},
    get attachmentCount(){return state.attachmentCount;},
    bindAttachments(provider){attachmentProvider=provider;},
    setAttachmentCount(count){if(state.attachmentCount!==count){state.attachmentCount=count;if(!count)state.attachmentRetry=false;emit();}},
    closeDeliverables(id){deliveryReads.get(id)?.abort();deliveryReads.delete(id);if(state.deliveryPages[id]){state.deliveryPages[id].open=false;state.deliveryPages[id].busy=false;}emit();},
    async loadDeliverables(id,{more=false}={}){
      if(state.status!=='approved'||state.mode!=='owner'||!state.messages.some(m=>m.id===id&&m.role==='user')||deliveryReads.has(id))return;
      const previous=state.deliveryPages[id],after=more?previous?.nextCursor:'0';if(more&&!after)return;
      const abort=new AbortController(),epoch=generation;deliveryReads.set(id,abort);
      const page=state.deliveryPages[id]={items:previous?.items||[],nextCursor:previous?.nextCursor??null,open:true,busy:true,error:''};emit();
      try{
        const data=await api.deliverables(id,after,{signal:abort.signal});if(epoch!==generation||abort.signal.aborted||deliveryReads.get(id)!==abort)return;
        const known=new Map(page.items.map(item=>[item.id,item])),items=new Map(more?known:[]);
        for(const item of data.deliverables){if(state.messages.some(m=>m.id===item.id)||known.has(item.id)&&JSON.stringify(known.get(item.id))!==JSON.stringify(item))throw new OwnerApiError('invalid');items.set(item.id,item);}
        if(items.size>32)throw new OwnerApiError('invalid');page.items=[...items.values()];page.nextCursor=data.nextCursor;
      }catch(error){if(epoch===generation&&!abort.signal.aborted){if(['expired','revoked','unauthorized'].includes(error.kind))failure(error);else page.error=error instanceof OwnerApiError?error.message:'Could not load private files. Try again.';}}
      finally{if(deliveryReads.get(id)===abort){deliveryReads.delete(id);page.busy=false;emit();}}
    },
    async uploadAttachment(messageId,id,file,options){
      if(state.status!=='approved'||!state.attachmentsEnabled)throw new OwnerApiError('unauthorized');const epoch=generation;
      try{const result=await api.uploadAttachment(messageId,id,file,options);if(epoch!==generation)throw new OwnerApiError('unauthorized');return result;}catch(error){if(epoch===generation&&error.kind!=='attachment_cancelled'){failure(error);emit();}throw error;}
    },
    async discardAttachment(messageId,id){
      if(state.status!=='approved')throw new OwnerApiError('unauthorized');const epoch=generation;
      try{return await api.discardAttachment(messageId,id);}catch(error){if(epoch===generation){failure(error);emit();}throw error;}
    },
    async attachmentContent(metadata,options){
      if(state.status!=='approved')throw new OwnerApiError('unauthorized');const epoch=generation;
      try{const result=await api.attachmentContent(metadata,options);if(epoch!==generation)throw new OwnerApiError('unauthorized');return result;}catch(error){if(epoch===generation&&error.kind!=='attachment_cancelled'){failure(error);emit();}throw error;}
    },
    get hasTaskDraft() { return !!(state.taskDraftKept||state.jobTitle||state.jobProject||state.jobGoal); },
    snapshot() { return structuredClone(state); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    setDraft(value) { state.draft = value.slice(0, 4000); const saved = draftStore.save(state.draft); if (!saved) state.warning = 'Could not retain this private draft in the tab. Copy it before leaving.'; return saved; },
    setQuery(value) { state.query = value.trim().toLowerCase();queries[state.requestsOnly?'work':'chat']=state.query; emit(); },
    setWorkFilter(value){if(['all','queued','working','blocked','finished','waiting_for_owner','execution_unknown','failed','cancellation_pending','completion_unverified'].includes(value)){state.workFilter=value;emit();}},
    beginTask({projectTitle='',goalTitle=''}={}){
      const label=value=>typeof value==='string'&&value.length<=120&&!/[\u0000-\u001f\u007f]/.test(value);
      if(state.status!=='approved'||state.mode!=='owner'||!state.jobsEnabled||state.busy||state.sending||!label(projectTitle)||!label(goalTitle)||goalTitle.trim()&&!projectTitle.trim())return false;
      if(failedSend||state.attachmentCount||state.draft||state.jobTitle||state.jobProject||state.jobGoal){
        if(failedSend)state.sendUnconfirmed=true;
        state.sendNotice=failedSend?'Resolve your unconfirmed send before adding a task.':'Finish or clear your current draft before adding a task.';emit();return false;
      }
      state.jobMode=true;state.jobProject=projectTitle.trim();state.jobGoal=goalTitle.trim();state.sendNotice='';emit();return true;
    },
    setJobMode(value){if(!state.jobsEnabled||state.sending)return;if(state.jobMode&&value!==true)state.taskDraftKept=!!(state.draft||state.jobTitle||state.jobProject||state.jobGoal||state.jobKind!=='consequential');state.jobMode=value===true;state.sendUnconfirmed=!!failedSend;emit();},
    setJobTitle(value){state.jobTitle=value.slice(0,120);},
    setJobProject(value){state.jobProject=value.slice(0,120);},
    setJobGoal(value){state.jobGoal=value.slice(0,120);},
    setJobKind(value){if(['read_only','draft','consequential'].includes(value)){state.jobKind=value;emit();}},
    setRequestsOnly(value){const next=value===true;if(next===state.requestsOnly)return;queries[state.requestsOnly?'work':'chat']=state.query;state.requestsOnly=next;state.query=queries[next?'work':'chat'];emit();},
    toggleRequests(){controller.setRequestsOnly(!state.requestsOnly);},
    closeJobDetail(){++detailEpoch;state.jobDetailId=null;state.jobDetail=null;state.jobDetailBusy=false;state.jobDetailError='';state.jobDetailStale=false;emit();},
    connect() {
      api.selectMode?.('owner');
      ++generation; reading = null; state.busy = false; state.sending = false; state.authenticating = false; state.loginDevices = []; accountConsent = null; state.accountReady = false; api.cancelAuthentication?.();
      state.error = ''; state.pairing = null; state.status = 'none'; api.cancelPairing(); mode('pairing');
    },
    cancelSensitive() {
      if (!state.authenticating && state.mode !== 'account' && !state.loginDevices.length) return;
      ++generation; reading = null; accountConsent = null; state.accountReady = false;
      state.authenticating = false; state.loginDevices = []; state.busy = false; api.cancelAuthentication?.(); emit();
    },
    showPublic() { api.selectMode?.('public');controller.closeJobDetail();controller.cancelSensitive(); mode('public'); },
    showOwner() { api.selectMode?.('owner');controller.closeJobDetail();controller.cancelSensitive(); mode(api.hasCredential ? 'owner' : 'pairing'); },
    async login(username, password, label, remember = false, replacement = {}) {
      if (state.busy || state.sending) return;
      if (replacement.deviceId !== undefined && (replacement.confirmed !== true || !state.loginDevices.some(d => d.id === replacement.deviceId))) { state.error = 'Choose an active device session and confirm its replacement.'; emit(); return; }
      const epoch = ++generation;
      api.cancelPairing(); state.pairing = null; state.busy = true; state.authenticating = true; state.error = ''; emit();
      try {
        const data = await api.login(username, password, label.trim().slice(0, 80) || 'This browser', { remember: remember === true, ...(replacement.deviceId === undefined ? {} : { replaceDeviceId: replacement.deviceId, confirmReplacement: true }) });
        if (epoch !== generation) return;
        clearPrivate({preserveDraft: true}); state.device = data.device; state.status = 'approved'; state.warning = api.storageWarning;state.jobsEnabled=data.jobs_enabled===true;state.attachmentsEnabled=data.attachments_enabled===true;
        state.authenticating = false; mode('owner'); await readMessages(epoch);await readJobs(epoch);
      } catch (error) { if (epoch === generation) { if (error instanceof OwnerApiError && error.kind === 'device_limit') state.loginDevices = error.devices;
          if (error instanceof OwnerApiError && error.kind === 'device_unavailable') state.loginDevices = []; failure(error); } }
      finally { if (epoch === generation) { state.busy = false; state.authenticating = false; emit(); } }
    },
    async showAccount() {
      if (state.busy || state.sending) return;
      if (!api.hasCredential) { controller.connect(); return; }
      controller.closeJobDetail();
      const epoch = ++generation;
      accountConsent = null; state.account = null; state.accountReady = false; state.accountNotice = ''; state.error = '';
      state.busy = true; mode('account');
      try {
        const account = await api.credentials();
        if (epoch !== generation) return;
        state.account = { configured: account.configured, ...(account.configured ? { username: account.username } : {}) };
        const prepared = await api.prepareCredentials(account.configured ? 'change' : 'setup');
        if (epoch !== generation) return;
        accountConsent = prepared.consent_token; state.accountReady = true;
      } catch (error) { if (epoch === generation) failure(error); }
      finally { if (epoch === generation) { state.busy = false; emit(); } }
    },
    async saveCredentials({ username, password, confirmation, currentPassword, consent }) {
      if (state.busy || !state.accountReady || !accountConsent) return;
      if (consent !== true) { state.error = 'Confirm that you want to save this account sign-in.'; emit(); return; }
      if (!/^[a-z0-9][a-z0-9._-]{2,31}$/.test(username.trim().toLowerCase())) { state.error = 'Use a username of 3–32 letters, numbers, dots, underscores or hyphens, starting with a letter or number.'; emit(); return; }
      if (password.length < 16 || password.length > 128 || new TextEncoder().encode(password).length > 256) { state.error = 'Use a password of 16–128 characters and no more than 256 bytes.'; emit(); return; }
      if (password !== confirmation) { state.error = 'The new passwords do not match. Enter them again.'; emit(); return; }
      const epoch = generation, consentToken = accountConsent, change = state.account.configured;
      accountConsent = null; state.accountReady = false; state.busy = true; state.error = ''; emit();
      try {
        const data = await api.saveCredentials({ username, password, password_confirmation: confirmation, consent_token: consentToken,
          ...(change ? { current_password: currentPassword } : {}) });
        if (epoch !== generation) return;
        state.account = { configured: data.configured, username: data.username };
        state.accountNotice = 'Account sign-in saved. You can sign in here with your username and password after clearing browser data. Existing device sessions remain active.';
      } catch (error) { if (epoch === generation) failure(error); }
      finally { if (epoch === generation) { state.busy = false; emit(); } }
    },
    async startPairing(label, remember = false) {
      if (state.busy) return;
      const epoch = ++generation;
      state.busy = true; state.error = ''; state.pairing = null; state.status = 'none'; emit();
      try {
        const pairing = await api.startPairing(label.trim().slice(0, 80) || 'This phone', { remember: remember === true });
        if (epoch !== generation) return;
        clearPrivate({preserveDraft: true}); state.pairing = pairing; state.status = 'pending';
      } catch (error) { if (epoch === generation) failure(error); }
      finally { if (epoch === generation) { state.busy = false; emit(); } }
    },
    async checkPairing() {
      if (!state.pairing || state.status !== 'pending' || state.busy) return;
      const epoch = generation;
      state.busy = true; state.error = ''; emit();
      try {
        const data = await api.pairingStatus();
        if (epoch !== generation) return;
        state.status = data.status;
        if (data.status === 'approved') {
          state.device = data.device; state.pairing = null; state.warning = api.storageWarning;state.jobsEnabled=data.jobs_enabled===true;state.attachmentsEnabled=data.attachments_enabled===true;
          if (state.mode === 'pairing') mode('owner');
          await readMessages(epoch);
          await readJobs(epoch);
        }
      } catch (error) { if (epoch === generation) failure(error); }
      finally { if (epoch === generation) { state.busy = false; emit(); } }
    },
    async refresh() {
      if (!api.hasCredential || state.status === 'pending') return;
      if (reading) return reading;
      const epoch = generation;
      state.busy = true; state.error = ''; if (state.status === 'unknown') state.status = 'checking'; emit();
      const task = (async () => {
        try {
          const data = await api.session();
          if (epoch !== generation) return;
          state.status = 'approved'; state.device = data.device; state.warning = api.storageWarning;state.jobsEnabled=data.jobs_enabled===true;state.attachmentsEnabled=data.attachments_enabled===true;
          await readMessages(epoch);
          await readJobs(epoch);
        } catch (error) { if (epoch === generation) { failure(error); if (state.status === 'checking') state.status = 'unknown'; } }
        finally { if (epoch === generation) { state.busy = false; emit(); } }
      })();
      reading = task;
      try { await task; } finally { if (reading === task) reading = null; }
    },
    async send({retryOriginal=false}={}) {
      if (state.sending || state.status !== 'approved'||state.mode!=='owner') return;
      if(state.taskDraftKept&&!state.jobMode&&!retryOriginal){state.sendNotice='Task draft kept. Resume it to review its requested scope before sending.';emit();return;}
      const attachmentDraft=retryOriginal?failedSend?.attachmentDraft:attachmentProvider?.(),attachmentState=attachmentDraft?.snapshot(),attachmentIds=attachmentState?.items.map(item=>item.id)||[];
      if(attachmentIds.length&&(!state.attachmentsEnabled||state.jobMode)){state.error=state.jobMode?'Send files from private messages. Keep the task draft or switch to a message first.':'Sending attachments is not available yet.';emit();return;}
      const draftBody=state.draft.trim();if(!draftBody&&!attachmentIds.length&&!retryOriginal)return;
      if(state.jobMode&&!state.jobTitle.trim()&&!retryOriginal){state.error='Give this private request a short title.';emit();return;}
      if(state.jobMode&&state.jobGoal.trim()&&!state.jobProject.trim()&&!retryOriginal){state.error='Give this goal a project name.';emit();return;}
      const epoch = generation;
      const specification=state.jobMode?{title:state.jobTitle.trim(),actionKind:state.jobKind,projectTitle:state.jobProject.trim(),goalTitle:state.jobGoal.trim()}:{};
      const unchanged=failedSend&&JSON.stringify(failedSend.attachmentIds||[])===JSON.stringify(attachmentIds)&&failedSend.body===draftBody&&failedSend.jobMode===state.jobMode&&failedSend.title===specification.title&&failedSend.actionKind===specification.actionKind&&failedSend.projectTitle===specification.projectTitle&&failedSend.goalTitle===specification.goalTitle;
      if(failedSend&&!unchanged&&!retryOriginal){state.sendUnconfirmed=true;state.error='Your earlier request is unconfirmed. Retry its original details before sending an edited request.';emit();return;}
      const item=failedSend||{id:attachmentIds.length?attachmentState.messageId:uuid(),body:draftBody,jobMode:state.jobMode,...specification,attachmentIds,attachmentDraft:attachmentIds.length?attachmentDraft:null};
      let accepted=false;
      if(!item.attachmentDraft)failedSend = item; state.sending = true; state.error = '';state.sendUnconfirmed=false;state.attachmentRetry=false;state.sendNotice=''; emit();
      try {
        if(item.attachmentDraft){
          const ready=await item.attachmentDraft.start();if(epoch!==generation)return;
          if(!ready||JSON.stringify(item.attachmentDraft.snapshot().items.map(file=>file.id))!==JSON.stringify(item.attachmentIds))throw new OwnerApiError('attachment_invalid');
          item.attachmentDraft.lock();failedSend=item;
        }
        const data=item.jobMode?await api.createJob(item):await api.sendMessage(item.id, item.body,item.attachmentIds);
        if (epoch !== generation) return;
        accepted=true;item.attachmentDraft?.clear();if(data.job)mergeJob(data.job);
        const matches=state.draft.trim()===item.body&&state.jobMode===item.jobMode&&(!item.jobMode||state.jobTitle.trim()===item.title&&state.jobKind===item.actionKind&&state.jobProject.trim()===item.projectTitle&&state.jobGoal.trim()===item.goalTitle);
        if(matches){state.draft='';draftStore.save('');state.jobTitle='';state.jobProject='';state.jobGoal='';state.jobMode=false;state.taskDraftKept=false;state.sendNotice=item.jobMode?'Work request saved':'';}else state.sendNotice='Earlier request confirmed · your edited draft is still here';
        failedSend = null;
        await readMessages(epoch);
        await readJobs(epoch);
      } catch (error) { if (epoch === generation) {
        // Only explicit pre-acceptance attachment rejection releases the send
        // lock. Transport failures and conflicts retain the immutable attempt.
        const rejected={attachment_expired:410,attachment_not_found:404,attachment_invalid:400,attachment_type_unsupported:415,attachment_too_large:413};
        if(!accepted&&item.attachmentDraft&&error instanceof OwnerApiError&&Object.hasOwn(rejected,error.kind)&&rejected[error.kind]===error.status){failedSend=null;item.attachmentDraft.reject(error.message);}
        state.sendUnconfirmed=!accepted&&!!failedSend;state.attachmentRetry=!accepted&&!failedSend&&!!item.attachmentDraft?.snapshot().items.length;failure(error);
      } }
      finally { if (epoch === generation) { state.sending = false; emit(); } }
    },
    retryUnconfirmed(){if(failedSend)return controller.send({retryOriginal:true});},
    async inspectJob(id,{refresh=false}={}){
      if(state.status!=='approved'||state.mode!=='owner'||!state.jobsEnabled)return;
      const epoch=generation,detail=++detailEpoch;
      state.jobDetailId=id;state.jobDetailError='';state.jobDetailBusy=true;
      if(!refresh){state.jobDetail=state.jobs.find(j=>j.id===id)?{job:state.jobs.find(j=>j.id===id),events:[]}:null;state.jobDetailStale=false;}
      emit();
      try{const data=await api.jobDetail(id);if(epoch!==generation||detail!==detailEpoch||state.jobDetailId!==id)return;const job=normalizeOwnerJobCompletion(data.job);state.jobDetail={...data,job};state.jobDetailStale=false;mergeJob(job);}
      catch(error){if(epoch===generation&&detail===detailEpoch){const safe=error instanceof OwnerApiError?error:new OwnerApiError('network');if(['expired','revoked','unauthorized'].includes(safe.kind))failure(safe);else{state.jobDetailError=safe.message;state.jobDetailStale=true;}}}
      finally{if(epoch===generation&&detail===detailEpoch){state.jobDetailBusy=false;emit();}}
    },
    async cancelJob(id){
      const job=state.jobs.find(j=>j.id===id);if(state.jobBusy||state.status!=='approved'||state.mode!=='owner'||!job||job.cancelRequested||['completed','failed','cancelled'].includes(job.stage))return;
      const epoch=generation;state.jobBusy=true;state.jobDetailError='';emit();
      try{const data=await api.cancelJob(id);if(epoch!==generation)return;mergeJob(data.job);await controller.inspectJob(id,{refresh:true});}
      catch(error){if(epoch===generation){const safe=failure(error);state.jobDetailError=safe.message;}}
      finally{if(epoch===generation){state.jobBusy=false;emit();}}
    },
    async retryJob(id,confirmed=false){
      const job=state.jobs.find(j=>j.id===id);if(state.jobBusy||state.status!=='approved'||state.mode!=='owner'||!job?.retryAllowed)return;
      if(job.retryRequiresConfirmation&&confirmed!==true){state.jobDetailError='Confirm the risk of repeating work before creating another attempt.';emit();return;}
      const epoch=generation,item=retryAttempts.get(id)||{id:uuid(),confirmed:confirmed===true};retryAttempts.set(id,item);state.jobBusy=true;state.jobDetailError='';emit();
      try{const data=await api.retryJob(id,item.id,item.confirmed);if(epoch!==generation)return;mergeJob(data.job);retryAttempts.delete(id);await readMessages(epoch);await readJobs(epoch);}
      catch(error){if(epoch===generation){const safe=failure(error);state.jobDetailError=safe.message;}}
      finally{if(epoch===generation){state.jobBusy=false;emit();}}
    },
    async retryDelivery(messageId){
      if(state.busy||state.sending||state.status!=='approved'||state.mode!=='owner'||!state.messages.some(m=>m.id===messageId&&m.delivery?.retryable))return;
      const epoch=generation;state.busy=true;state.error='';emit();
      try{
        await api.retryDelivery(messageId);
        if(epoch!==generation)return;
        await readMessages(epoch);
      }catch(error){if(epoch===generation)failure(error);}
      finally{if(epoch===generation){state.busy=false;emit();}}
    },
    async showDevices() {
      if (!api.hasCredential) { controller.showOwner(); return; }
      if (state.status !== 'approved') await controller.refresh();
      if (state.status !== 'approved') { controller.showOwner(); return; }
      controller.closeJobDetail();controller.cancelSensitive(); mode('devices');
      return controller.refreshDevices();
    },
    async refreshDevices() {
      if (state.busy) return;
      const epoch = generation;
      state.busy = true; state.error = ''; emit();
      try {
        const data = await api.devices();
        if (epoch !== generation) return;
        state.devices = data.devices;
      } catch (error) { if (epoch === generation) failure(error); }
      finally { if (epoch === generation) { state.busy = false; emit(); } }
    },
    async revoke(deviceId) {
      if (state.busy || state.sending) return;
      const epoch = generation, self = deviceId === api.deviceId;
      state.busy = true; state.error = ''; emit();
      try {
        await api.revoke(deviceId);
        if (epoch !== generation) return;
        if (self) { ++generation; clearPrivate(); state.status = 'revoked'; state.warning = api.storageWarning; state.busy = false; mode('owner'); }
        else { state.busy = false; await controller.refreshDevices(); }
      } catch (error) { if (epoch === generation) failure(error); }
      finally { if (epoch === generation) { state.busy = false; emit(); } }
    },
    disconnect() { if (api.deviceId) return controller.revoke(api.deviceId); },
    storedSessionChanged() {
      ++generation; reading = null; clearPrivate(); api.refreshStoredCredential();
      state.status = api.hasCredential ? 'unknown' : 'none'; state.error = ''; state.warning = ''; state.busy = false; state.sending = false; state.authenticating = false; state.pairing = null;
      emit();
      if (state.mode !== 'public' && api.hasCredential) return controller.refresh();
    }
  };
  return controller;
}

const stamp = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Unknown';
const messageClock=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'});
const messageStamp=value=>Number.isFinite(Date.parse(value))?messageClock.format(new Date(value)):'Unknown';
const jobLabelBase=job=>{
  if(job.result&&!job.completion&&!['waiting_for_owner','failed','cancelled'].includes(job.stage))return 'Reply received · completion unverified'+(job.cancelRequested?' · cancellation requested':'');
  if(job.stage==='running'&&job.execution&&Date.parse(job.execution.leaseExpiresAt)<=Date.now())return job.cancelRequested?'Cancellation requested · outcome unconfirmed':'Acknowledgement expired · outcome unconfirmed';
  if(job.cancelRequested&&!['completed','failed','cancelled'].includes(job.stage))return 'Cancellation requested · awaiting acknowledgement';
  return {queued:'Queued · awaiting assistant',running:'Working · owner-connected assistant acknowledged',waiting_for_owner:'Needs your input',completed:job.completion?'Work reported complete':'Completion unverified',failed:'Failed · review details',cancelled:'Cancelled · assistant acknowledged',outcome_unknown:'Outcome unconfirmed · review details'}[job.stage]||'Status unavailable';
};
const jobLabel=job=>plainWorkLabel(job);

export function ownerWorkStatus(job, now=Date.now()) {
  if(job.stage==='completed'&&job.completion)return {state:'finished',attention:null,label:'Finished · work reported complete'};
  if(job.stage==='cancelled')return {state:'finished',attention:null,label:'Finished · cancellation acknowledged'};
  if(job.cancelRequested)return {state:'blocked',attention:'cancellation_pending',label:'Cancellation pending · outcome unconfirmed'};
  if(job.stage==='failed')return {state:'blocked',attention:'failed',label:'Failed · review details'};
  if(job.stage==='waiting_for_owner')return {state:'blocked',attention:'waiting_for_owner',label:'Waiting for you · input needed'};
  if(job.result&&!job.completion||job.stage==='completed')return {state:'blocked',attention:'completion_unverified',label:'Completion unverified'+(job.result?' · reply saved':'')};
  if(job.stage==='queued')return {state:'queued',attention:null,label:'Queued · awaiting assistant'};
  if(job.stage==='running'&&job.execution&&Date.parse(job.execution.leaseExpiresAt)>now)return {state:'working',attention:null,label:'Working · execution acknowledged'};
  return {state:'blocked',attention:'execution_unknown',label:'Execution unknown · outcome unconfirmed'};
}

function plainWorkLabel(job,status=ownerWorkStatus(job)){
  return {waiting_for_owner:'Waiting for you',execution_unknown:'Status unknown',failed:'Failed',cancellation_pending:'Stopping…',completion_unverified:'Finish not confirmed'}[status.attention]||{queued:'Queued',working:'Working',finished:job.completion?'Finished':'Stopped'}[status.state]||'Status unknown';
}
const attentionLabels=[['waiting_for_owner','Waiting for you'],['execution_unknown','Status unknown'],['failed','Failed'],['cancellation_pending','Stopping…'],['completion_unverified','Finish not confirmed']];
export function ownerWorkAttention(tasks) {
  return attentionLabels.map(([reason,label])=>({reason,label,count:tasks.filter(task=>task.status.attention===reason).length}));
}

const workTitle=job=>job.presentation?.work?.title||job.title;
const linkedWork=job=>job.presentation?.work?.revision===0?job.presentation.work.workId:null;
const actionableWork=job=>!!job.presentation?.work||job.actionKind!=='unclassified'||job.attempt>1||!!job.execution||!!job.completion;

export function groupOwnerWork(jobs, {query='', filter='all', now=Date.now()}={}) {
  query=query.trim().toLowerCase();
  const roots=new Map(),activity=new Map();
  for(const job of jobs){if(linkedWork(job))continue;const attempts=roots.get(job.rootJobId)||[];attempts.push(job);roots.set(job.rootJobId,attempts);}
  const tasks=[...roots.values()].map(attempts=>{
    attempts.sort((a,b)=>a.attempt-b.attempt||a.sequence-b.sequence);
    const job=attempts.at(-1);activity.set(job.id,Date.parse(ownerWorkActivity(job)));return {job,attempts,status:ownerWorkStatus(job,now)};
  }).filter(({job,attempts})=>actionableWork(job)||attempts.some(attempt=>attempt.execution||attempt.completion))
    .filter(({status})=>filter==='all'||status.state===filter||status.attention===filter)
    .filter(({job})=>!query||[workTitle(job),job.presentation?.work?.goal,...(job.presentation?.work?.plan||[]),job.body,job.presentation?.projectTitle,job.presentation?.goalTitle,job.presentation?.latestUpdate?.summary,job.latestResult?.body||job.result?.body,job.latestResult?.correctionSummary].some(text=>text?.toLowerCase().includes(query)));
  tasks.sort((a,b)=>activity.get(b.job.id)-activity.get(a.job.id)||b.job.sequence-a.job.sequence);
  return tasks;
}

function meaningfulUpdate(job, events=[]) {
  const update=job.presentation?.latestUpdate;
  if(update&&!(update.kind==='running'&&update.summary==='Authenticated execution progress acknowledged.'))return update;
  return events.filter(e=>e.authentication_source==='owner-oauth-mcp'
    &&['claimed','running','waiting_for_owner','failed','cancelled','work_completed','result_corrected'].includes(e.kind)
    &&!(e.kind==='running'&&e.summary==='Authenticated execution progress acknowledged.')).at(-1)||null;
}

// Activity comes from saved content and typed outcomes, not lease heartbeats.
export function ownerWorkActivity(job) {
  const candidates=[job.createdAt,meaningfulUpdate(job)?.createdAt,job.latestResult?.createdAt||job.result?.createdAt,job.completion?.createdAt,job.cancelRequestedAt,job.finishedAt];
  return candidates.filter(value=>Number.isFinite(Date.parse(value))).sort((a,b)=>Date.parse(b)-Date.parse(a))[0]||job.createdAt;
}

export function ownerWorkPreview(job, status=ownerWorkStatus(job)) {
  const update=meaningfulUpdate(job),latest=job.latestResult||job.result;
  if(status.attention==='cancellation_pending')return 'Cancellation was requested; execution has not been confirmed stopped.';
  if(status.attention==='failed')return job.failure?.message||update?.summary||'The execution reported failure. Review its evidence.';
  if(status.attention==='waiting_for_owner')return update?.summary||'The execution needs your input before continuing.';
  if(status.attention==='completion_unverified')return 'Reply saved; work completion is still unverified. Review the request evidence.';
  if(status.attention==='execution_unknown')return 'The execution outcome is unconfirmed. Refresh or inspect the request evidence.';
  if(update&&update.kind!=='claimed')return update.kind==='result_corrected'&&latest?.correctionSummary?latest.correctionSummary:update.summary;
  return status.state==='queued'?'Waiting for an execution acknowledgement.':status.state==='working'?'Execution acknowledged; awaiting a progress update.':job.completion?.summary||'Cancellation was acknowledged by the execution.';
}

export function createRelayOwnerUI({ controller = createRelayOwnerController(), document: doc = globalThis.document } = {}) {
  const attachmentContent=createPrivateAttachmentContent({document:doc,read:(item,options)=>controller.attachmentContent(item,options)});
  let root, timer, viewKey = '', chatNodes = null, pairLabel = '', pairRemember = false, readingAnchor=null, detailDialog=null, detailSignature='',detailFocus=null,connectionDialog=null,workSignature='',workVisible=50,workContext='',workOpen=new Map(),messageView=false;
  const positions={chat:null,work:null};let taskFocus=null,taskWasOpen=false;
  const sensitiveInputs = new Set();
  function clearSensitiveFields() {
    for (const input of sensitiveInputs) { input.value = ''; if (input.type === 'checkbox') input.checked = false; }
    sensitiveInputs.clear();
  }
  function field(form, labelText, id, { type = 'text', required = true, minLength, maxLength = 128, value = '', sensitive = true } = {}) {
    const label = make('label', labelText); label.htmlFor = id;
    const input = make('input'); input.id = id; input.name = id; input.type = type; input.required = required; input.maxLength = maxLength;
    input.autocomplete = 'off'; input.spellcheck = false; input.autocapitalize = 'none'; input.value = value;
    if (minLength !== undefined) input.minLength = minLength;
    if (sensitive) sensitiveInputs.add(input);
    form.append(label, input); return input;
  }
  function loginForm(section, state) {
    section.append(make('h3', 'Sign in with username and password'), make('p', 'Once account sign-in is set up, use it on this same page after clearing cookies or browser data. No pairing code or other phone is needed to sign in.', 'relay-owner-note'));
    const form = make('form', '', 'relay-owner-auth-form'); form.id = 'relay-owner-login-form'; form.autocomplete = 'off';
    const username = field(form, 'Username', 'relay-owner-login-username', { maxLength: 32 });
    const password = field(form, 'Password', 'relay-owner-login-password', { type: 'password' });
    const label = field(form, 'Device name', 'relay-owner-login-label', { required: false, maxLength: 80, sensitive: false }); label.placeholder = 'For example, my restricted phone';
    const remember = make('label', '', 'relay-owner-remember'), checkbox = make('input');
    checkbox.type = 'checkbox'; checkbox.id = 'relay-owner-login-remember'; checkbox.checked = false;
    remember.append(checkbox, make('span', 'Remember this device session on this browser'));
    const notice = make('p', 'If checked, this browser saves only a device token and device ID. Access expires after exactly 365 days of inactivity and renews on authenticated use. Scripts on this shared website origin can read the token. Anyone using this browser can use this access. Your account username and password and private history are not saved by Relay in browser storage. Unsent drafts are kept in this tab, separate from public Relay drafts. Clearing browser data ends this device session; sign in here again with your account credentials.', 'relay-owner-note');
    notice.id = 'relay-owner-login-storage-notice'; checkbox.setAttribute('aria-describedby', notice.id);
    let replacementSelect = null, replacementConsent = null;
    if (state.loginDevices.length) {
      form.append(make('p', 'Your password was verified, but ten device sessions are already active. Re-enter your username and password and choose exactly one session to revoke and replace. That device will be signed out. Labels are supplied by devices and are not verified.', 'relay-owner-note'));
      const selectLabel = make('label', 'Device session to replace'); selectLabel.htmlFor = 'relay-owner-replace-device';
      replacementSelect = make('select'); replacementSelect.id = 'relay-owner-replace-device'; replacementSelect.required = true;
      const empty = make('option', 'Choose one existing session'); empty.value = ''; replacementSelect.append(empty);
      for (const device of state.loginDevices) { const option = make('option', device.label + ' · last used ' + stamp(device.lastSeenAt) + ' · ' + device.id.slice(-8)); option.value = device.id; replacementSelect.append(option); }
      replacementSelect.value = '';
      const replacementLabel = make('label', '', 'relay-owner-remember'); replacementConsent = make('input'); replacementConsent.type = 'checkbox'; replacementConsent.id = 'relay-owner-replacement-consent'; replacementConsent.required = true; replacementConsent.checked = false; sensitiveInputs.add(replacementConsent);
      replacementLabel.append(replacementConsent, make('span', 'I approve revoking the selected device session and replacing it with this browser. Other device sessions stay active.'));
      form.append(selectLabel, replacementSelect, replacementLabel);
    }
    const submit = action(state.authenticating ? 'Signing in…' : state.loginDevices.length ? 'Confirm replacement and sign in' : 'Sign in', () => {}, 'primary'); submit.type = 'submit'; submit.disabled = state.busy;
    form.append(remember, notice, submit);
    form.onsubmit = event => {
      event.preventDefault(); if (state.busy) return;
      const entered = { username: username.value, password: password.value, label: label.value, remember: checkbox.checked, replacement: replacementSelect ? { deviceId: replacementSelect.value, confirmed: replacementConsent.checked } : {} };
      clearSensitiveFields(); controller.login(entered.username, entered.password, entered.label, entered.remember, entered.replacement);
    };
    section.append(form);
  }
  const make = (tag, text = '', cls = '') => { const n = doc.createElement(tag); n.textContent = text; n.className = cls; return n; };
  function action(label, handler, cls = 'secondary') { const n = make('button', label, cls); n.type = 'button'; n.onclick = handler; return n; }
  function statusNodes(container, state) {
    const error = make('p', state.error, 'relay-owner-error'); error.setAttribute('role', 'status'); error.hidden = !state.error;
    const warning = make('p', state.warning, 'relay-owner-note'); warning.hidden = !state.warning;
    container.append(error, warning);
  }
  function position(panel){
    if(!panel)return null;
    const rect=panel.getBoundingClientRect?.();
    const row=rect?[...panel.children].find(n=>n.dataset?.messageId&&n.getBoundingClientRect?.().bottom>=rect.top):null;
    return {id:row?.dataset.messageId,offset:row?row.getBoundingClientRect().top-rect.top:0,scroll:panel.scrollTop,bottom:panel.scrollHeight-panel.scrollTop-panel.clientHeight<70};
  }
  function restorePosition(panel,anchor){
    if(!anchor||anchor.bottom){panel.scrollTop=panel.scrollHeight;return;}
    const row=[...panel.children].find(n=>n.dataset?.messageId===anchor.id);
    if(row?.getBoundingClientRect&&panel.getBoundingClientRect)panel.scrollTop+=row.getBoundingClientRect().top-panel.getBoundingClientRect().top-anchor.offset;
    else panel.scrollTop=anchor.scroll;
  }
  function workPosition(panel){const bounds=panel.getBoundingClientRect?.(),node=bounds?[...panel.querySelectorAll?.('[data-work-anchor]')||[]].find(n=>n.getBoundingClientRect().bottom>bounds.top):null;return {scroll:panel.scrollTop,id:node?.dataset.workAnchor,offset:node?node.getBoundingClientRect().top-bounds.top:0};}
  function rememberWork(panel){for(const node of panel.querySelectorAll?.('details[data-work-key]')||[])workOpen.set(node.dataset.workKey,node.open);}
  function startTask(){const state=controller.snapshot();if(!state.sendUnconfirmed&&!state.error&&(state.jobMode||controller.hasTaskDraft))controller.setJobMode(true);else controller.beginTask();if(chatNodes&&controller.jobMode)chatNodes.title.focus({preventScroll:true});}
  function closeInspector(){
    if(!detailDialog)return;const dialog=detailDialog;detailDialog=null;detailSignature='';dialog.close?.();dialog.remove?.();
    if(doc.body)delete doc.body.dataset.relayDetailOpen;
    const target=detailFocus?.isConnected?detailFocus:detailFocus?.id?doc.getElementById(detailFocus.id):null;target?.focus?.({preventScroll:true});detailFocus=null;
  }
  function renderInspector(state){
    if(state.mode!=='owner'||state.status!=='approved'||!state.jobDetailId){closeInspector();return;}
    if(!doc.body||!doc.createTextNode)return;
    if(!detailDialog){
      detailFocus=doc.activeElement;const dialog=make('dialog','','app-sheet conversation-sheet owner-request-detail');dialog.id='relay-owner-request-dialog';dialog.setAttribute('aria-label','Task detail');detailDialog=dialog;
      dialog.addEventListener('close',()=>{if(detailDialog!==dialog)return;detailDialog=null;detailSignature='';dialog.remove();delete doc.body.dataset.relayDetailOpen;controller.closeJobDetail();const target=detailFocus?.isConnected?detailFocus:detailFocus?.id?doc.getElementById(detailFocus.id):null;target?.focus({preventScroll:true});detailFocus=null;});
      doc.body.dataset.relayDetailOpen='true';doc.body.append(dialog);dialog.showModal();
    }
    const currentRefresh=detailDialog.querySelector('#relay-owner-request-refresh');if(currentRefresh){currentRefresh.textContent=state.jobDetailBusy?'Refreshing…':'Refresh';currentRefresh.disabled=state.jobDetailBusy||state.jobBusy;}
    const signature=JSON.stringify([state.jobDetailId,state.jobDetail,state.jobDetailError,state.jobDetailStale,state.syncStale,state.jobsError,state.jobBusy,jobLabel(state.jobDetail?.job||{})]);if(signature===detailSignature)return;
    const scroll=detailDialog.scrollTop,consent=detailDialog.querySelector('#relay-owner-retry-consent')?.checked===true;
    const open=new Map([...detailDialog.querySelectorAll('details[id]')].map(n=>[n.id,n.open]));
    const focused=detailDialog.contains(doc.activeElement)?{id:doc.activeElement.id,label:doc.activeElement.getAttribute('aria-label')||doc.activeElement.textContent}:null;
    const bounds=detailDialog.getBoundingClientRect(),visible=[...detailDialog.querySelectorAll('[data-reading-anchor]')].find(n=>n.getBoundingClientRect().bottom>=bounds.top+68&&n.getBoundingClientRect().top<bounds.bottom);
    const reading=visible?{id:visible.dataset.readingAnchor,offset:visible.getBoundingClientRect().top-bounds.top}:null;
    detailSignature=signature;detailDialog.replaceChildren();
    const heading=make('div','','dialog-heading'),close=action('',()=>controller.closeJobDetail(),'icon-button request-back');close.id='relay-owner-detail-back';close.innerHTML=icon('back');close.append(make('span','Back'));close.setAttribute('aria-label','Back from task');heading.append(close);
    detailDialog.append(heading);
    const content=make('div','','request-screen-content');detailDialog.append(content);
    const data=state.jobDetail,job=data?.job;
    if(!job){content.append(make('p',state.jobDetailError||'Opening task…','sheet-context'));const refresh=action('Try again',()=>controller.inspectJob(state.jobDetailId,{refresh:true}));refresh.disabled=state.jobDetailBusy;refresh.hidden=!state.jobDetailError;content.append(refresh);return;}
    const status=ownerWorkStatus(job),title=make('h2',workTitle(job),'request-title');title.id='relay-owner-detail-title';title.dataset.readingAnchor='request-title';detailDialog.setAttribute('aria-labelledby',title.id);content.append(title);
    const labels=job.presentation;if(labels?.projectTitle)content.append(make('p',[labels.projectTitle,labels.goalTitle].filter(Boolean).join(' · '),'request-meta request-project'));
    const stateLabel=make('p',jobLabel(job),'request-state');stateLabel.dataset.attention=status.attention||status.state;content.append(stateLabel);
    if(state.jobDetailStale||state.syncStale||state.jobsError)content.append(make('p','Last saved status · refresh unavailable','relay-owner-note'));
    const update=meaningfulUpdate(job,data.events),latest=job.latestResult||job.result;
    const card=(title,cls='')=>{const section=make('section','','request-card '+cls);section.append(make('h3',title));return section;};
    const workPlan=job.presentation?.work;
    if(workPlan?.revision){
      const overview=card('Goal and plan');overview.id='relay-owner-work-plan';overview.append(make('p',workPlan.goal,'request-body'));
      const steps=make('ol');for(const step of workPlan.plan)steps.append(make('li',step,'request-copy'));overview.append(steps,make('p','Plan revision '+workPlan.revision+' · planning does not confirm execution','request-meta'));content.append(overview);
    }
    if(linkedWork(job))content.append(action('View original work',()=>controller.inspectJob(linkedWork(job)),'secondary'));
    const followUps=state.jobs.filter(other=>linkedWork(other)===job.id);
    if(followUps.length){const related=card('Follow-up messages');for(const follow of followUps)related.append(action(follow.body.slice(0,100),()=>controller.inspectJob(follow.id),'text-button'));content.append(related);}
    if(latest){
      const output=card('Output','request-output'),body=make('div','','request-body rich-body');body.id='relay-owner-result-latest';body.dataset.readingAnchor='saved-result';body.dataset.resultVersion=String(latest.version||job.resultVersion||1);richText(body,latest.body);output.append(body,make('p','Version '+(latest.version||job.resultVersion||1)+' · '+stamp(latest.createdAt),'request-meta'));content.append(output);
    }else if(update){
      const progress=card('Latest update','request-progress');progress.id='relay-owner-latest-progress';const copy=make('p',update.summary,'request-copy');copy.dataset.readingAnchor='latest-update';progress.append(copy,make('p',stamp(update.createdAt),'request-meta'));content.append(progress);
    }
    if(job.failure&&status.attention==='failed'){
      const failure=card('What happened');failure.append(make('p',job.failure.message,'request-copy'));if(job.failure.outcome==='not_started')failure.append(make('p','The work did not start.','request-meta'));else if(job.failure.outcome==='unknown')failure.append(make('p','Some work may already have happened.','request-meta'));content.append(failure);
    }
    if(job.completion){
      const report=card('Completion report','request-completion');report.id='relay-owner-completion';report.dataset.resultVersion=String(job.completion.resultVersion);
      const summary=make('p',job.completion.summary,'request-body');summary.id='relay-owner-completion-summary';summary.dataset.readingAnchor='completion-summary';report.append(summary,make('p',stamp(job.completion.createdAt)+' · reply version '+job.completion.resultVersion,'request-meta'));content.append(report);
    }
    const next=card('Next step','request-next-card');
    let nextCopy={waiting_for_owner:'Reply with the input or decision needed to continue.',execution_unknown:'The latest outcome is not known. Refresh to check.',failed:'Review what happened before another attempt.',cancellation_pending:'A stop was requested. Confirmation is still pending.',completion_unverified:'Review the saved output. A saved reply does not confirm the work finished.'}[status.attention]||{queued:'Waiting for a first update.',working:'Read the latest update.',finished:job.completion?'Review the completion report and output.':'The stop was confirmed.'}[status.state];
    if(job.cancelRequested&&job.completion)nextCopy='Completion was reported after the stop request. Review the result; this does not confirm that the work stopped.';
    next.append(make('p',nextCopy,'request-copy'));
    const actions=make('div','','request-actions');const refresh=action(state.jobDetailBusy?'Refreshing…':'Refresh',()=>controller.inspectJob(job.id,{refresh:true}),'secondary');refresh.id='relay-owner-request-refresh';refresh.setAttribute('aria-label','Refresh task');refresh.disabled=state.jobDetailBusy||state.jobBusy;actions.append(refresh);
    if(status.attention==='waiting_for_owner')actions.append(action('Reply in chat',()=>{controller.closeJobDetail();controller.setRequestsOnly(false);controller.setJobMode(false);chatNodes?.input.focus({preventScroll:true});},'primary'));
    next.append(actions);content.append(next);
    const historyPanel=make('details','','request-disclosure');historyPanel.id='relay-owner-request-history';historyPanel.open=open.get(historyPanel.id)||false;const historySummary=make('summary','History');historySummary.id='relay-owner-request-history-toggle';historyPanel.append(historySummary);
    if(latest){
      const versions=make('details','','request-versions');versions.id='relay-owner-result-history';versions.open=open.get(versions.id)||false;const summary=make('summary','Output versions');summary.id='relay-owner-result-history-toggle';versions.append(summary);
      for(const record of data.resultHistory||[{version:1,...job.result}]){const section=make('section','','request-result-version');section.dataset.resultVersion=String(record.version);section.append(make('h3','Version '+record.version));if(record.correctionSummary)section.append(make('p',record.correctionSummary,'request-meta'));const body=make('div','','request-body rich-body');body.dataset.readingAnchor='result-version-'+record.version;richText(body,record.body);section.append(body,make('p',stamp(record.createdAt),'request-meta'));versions.append(section);}
      if(!data.resultHistory)versions.append(make('p','Refresh to load all output versions.','request-meta'));historyPanel.append(versions);
    }
    if(data.events?.length){const list=make('ol','','request-events');for(const event of data.events){const item=make('li');item.append(make('p',event.summary),make('p',stamp(event.createdAt)+(event.authentication_source==='owner-oauth-mcp'?' · authenticated owner assistant':' · authenticated owner device'),'request-meta'));item.dataset.readingAnchor='event:'+event.id;list.append(item);}historyPanel.append(list);}
    const attempts=state.jobs.filter(j=>j.rootJobId===job.rootJobId&&j.id!==job.id).sort((a,b)=>a.attempt-b.attempt);if(attempts.length){historyPanel.append(make('h3','Other attempts'));for(const prior of attempts)historyPanel.append(action('Attempt '+prior.attempt+' · '+jobLabel(prior),()=>controller.inspectJob(prior.id),'secondary'));}
    if(!latest&&!data.events?.length&&!attempts.length)historyPanel.append(make('p','No saved history yet.','request-meta'));content.append(historyPanel);
    const properties=make('details','','request-disclosure');properties.id='relay-owner-request-properties';properties.open=open.get(properties.id)||false;properties.append(make('summary','Details'));
    const objective=make('details');objective.id='relay-owner-objective';objective.open=open.get(objective.id)||false;const requestBody=make('p',job.body,'request-body');requestBody.dataset.readingAnchor='request-body';objective.append(make('summary','Original request'),requestBody);properties.append(objective);
    const kinds={unclassified:'Ordinary message',read_only:'Read-only report',draft:'Draft only',consequential:'Needs review'};properties.append(make('h3','Scope'),make('p',(kinds[job.actionKind]||'Scope unavailable')+' · attempt '+job.attempt+' · saved '+stamp(job.createdAt),'request-meta'),make('p',jobLabelBase(job),'request-meta'));
    if(job.execution)properties.append(make('p','The owner-connected assistant acknowledged execution '+stamp(job.execution.acknowledgedAt)+'. '+(Date.parse(job.execution.leaseExpiresAt)<=Date.now()?'The recorded acknowledgement window ended ':'The acknowledgement expires ')+stamp(job.execution.leaseExpiresAt)+'.'+(job.stage==='running'&&Date.parse(job.execution.leaseExpiresAt)<=Date.now()?' Refresh to check the current outcome.':''),'request-meta'));
    if(job.failure&&status.attention!=='failed')properties.append(make('h3','Saved outcome note'),make('p',job.failure.message,'request-meta'));
    if(update&&latest)properties.append(make('h3','Latest update'),make('p',update.summary+' · '+stamp(update.createdAt),'request-meta'));
    if(job.delivery){const deliveryLabels={saved:'Request saved privately.',queued:'Request saved; callback delivery is queued.',callback_accepted:'The callback accepted delivery. This does not confirm execution.',delivery_failed:'Callback delivery failed. The saved request remains private.',reply_saved:'An authenticated owner reply is saved.'};properties.append(make('h3','Delivery'),make('p',deliveryLabels[job.delivery.state]||'Delivery evidence unavailable.','request-meta'));}
    if(job.completion)properties.append(make('h3','Completion evidence'),make('p','The authenticated owner-connected assistant reported work complete. This attestation does not certify factual claims or external outcomes.','request-meta'));
    else if(latest)properties.append(make('h3','Reply evidence'),make('p','A saved owner reply does not establish that the work finished. Authentication identifies the publisher; factual claims may still need checking.','request-meta'));
    if(latest?.correctionSummary){const rationale=make('p',latest.correctionSummary,'request-meta');rationale.id='relay-owner-result-rationale';properties.append(make('h3','Latest revision'),rationale);}
    const runActions=make('div','','request-actions');
    {
      if(!job.cancelRequested&&!['completed','failed','cancelled'].includes(job.stage)){const cancel=action('Request stop',()=>controller.cancelJob(job.id),'secondary');cancel.disabled=state.jobBusy;runActions.append(cancel);}
      if(job.delivery?.retryable){const retryDelivery=action('Retry delivery',()=>controller.retryDelivery(job.id),'secondary');retryDelivery.disabled=state.busy||state.sending;runActions.append(retryDelivery);}
      if(job.retryAllowed){let checkbox=null;if(job.retryRequiresConfirmation){const label=make('label','','relay-owner-remember');checkbox=make('input');checkbox.type='checkbox';checkbox.id='relay-owner-retry-consent';checkbox.checked=consent;label.append(checkbox,make('span','I understand the earlier attempt may already have done the work. Create a separate attempt.'));properties.append(label,make('p','This retries the saved request. Existing explicit authorization still governs actions.','request-meta'));}const retry=action('Try again',()=>controller.retryJob(job.id,checkbox?.checked===true),'primary');retry.disabled=state.jobBusy;runActions.append(retry);}
      else if(['failed','cancelled','outcome_unknown'].includes(job.stage)&&!job.retryJobId)properties.append(make('p','Outcome needs review before another attempt.','request-meta'));
    }
    if(job.retryJobId)runActions.append(action('View retry attempt',()=>controller.inspectJob(job.retryJobId),'secondary'));if(runActions.children.length)properties.append(runActions);content.append(properties);
    if(state.jobDetailError){const error=make('p',state.jobDetailError,'relay-owner-error');error.setAttribute('role','status');content.append(error);}
    detailDialog.scrollTop=scroll;if(reading&&scroll>0){const anchor=[...detailDialog.querySelectorAll('[data-reading-anchor]')].find(n=>n.dataset.readingAnchor===reading.id);if(anchor)detailDialog.scrollTop+=anchor.getBoundingClientRect().top-detailDialog.getBoundingClientRect().top-reading.offset;}
    if(focused){const node=focused.id?detailDialog.querySelector('#'+focused.id):[...detailDialog.querySelectorAll('button,summary,input')].find(n=>(n.getAttribute('aria-label')||n.textContent)===focused.label);node?.focus({preventScroll:true});}
  }
  function renderWork(state,restore=null) {
    const panel=chatNodes.messages,allTasks=groupOwnerWork(state.jobs),tasks=groupOwnerWork(state.jobs,{query:state.query,filter:state.workFilter}),attention=ownerWorkAttention(groupOwnerWork(state.jobs,{query:state.query}));
    const signature=JSON.stringify([state.jobs,state.query,state.workFilter,state.jobsError,state.syncStale,state.busy&&!state.jobs.length,workVisible,tasks.map(t=>t.status),attention]);
    if(workSignature===signature)return;workSignature=signature;
    rememberWork(panel);
    const bounds=panel.getBoundingClientRect?.(),visible=bounds?[...panel.querySelectorAll?.('[data-work-anchor]')||[]].find(node=>{const rect=node.getBoundingClientRect();return rect.height>0&&rect.bottom>bounds.top&&rect.top<bounds.bottom;}):null;
    const reading=restore|| (visible?{id:visible.dataset.workAnchor,offset:visible.getBoundingClientRect().top-bounds.top}:null);
    const context=JSON.stringify([state.query,state.workFilter]),contextChanged=context!==workContext;workContext=context;
    const scroll=restore?.scroll??(contextChanged?0:panel.scrollTop),focused=panel.contains?.(doc.activeElement)?doc.activeElement?.id:null;
    const body=make('section','','owner-work');body.id='relay-owner-current-work';body.setAttribute('aria-label','Private current work');
    const heading=make('div','','owner-work-heading'),newTask=action(state.jobMode||state.jobTitle||state.jobProject||state.jobGoal?'Resume task':'New task',startTask,'primary');newTask.id='relay-owner-new-task';newTask.disabled=state.busy||state.sending;
    const filters=make('div','','owner-work-filters'),filterLabel=make('label','Filter work by status','sr-only');filterLabel.htmlFor='relay-owner-work-filter';const filter=make('select');filter.id='relay-owner-work-filter';
    const matching=groupOwnerWork(state.jobs,{query:state.query});
    for(const [value,label] of [['all','All work'],['queued','Queued'],['working','Working'],['blocked','Needs attention'],['finished','Finished'],...attentionLabels]){const count=value==='all'?matching.length:matching.filter(task=>task.status.state===value||task.status.attention===value).length;const option=make('option',label+' · '+count);option.value=value;filter.append(option);}
    filter.value=state.workFilter;filter.onchange=()=>controller.setWorkFilter(filter.value);filters.append(filterLabel,filter);heading.append(filters,newTask);body.append(heading);
    if(state.syncStale||state.jobsError){const stale=make('p','Last known records · '+(state.jobsError||'refresh unavailable'),'relay-owner-note');stale.setAttribute('role','status');body.append(stale);}
    function taskRow(task){
      const {job,status}=task,row=action('',()=>controller.inspectJob(job.id),'owner-work-task');row.id='owner-work-task-'+job.id;row.dataset.jobId=job.id;row.dataset.workAnchor='task:'+job.id;row.dataset.state=status.state;if(status.attention)row.dataset.attention=status.attention;
      const content=make('span','','owner-work-row-content');content.append(make('span',workTitle(job),'owner-work-title'));const context=[job.presentation?.projectTitle,job.presentation?.goalTitle].filter(Boolean).join(' · ');if(context)content.append(make('span',context,'owner-work-project-label'));content.append(make('span',plainWorkLabel(job,status),'job-state'));const arrow=make('span','','owner-work-row-arrow');arrow.innerHTML=icon('chevron');row.append(content,arrow);return row;
    }
    function flatTasks(list,container){for(const task of list)container.append(taskRow(task));}
    const current=tasks.filter(t=>t.status.state!=='finished'),finished=tasks.filter(t=>t.status.state==='finished');
    if(current.length)flatTasks(current.slice(0,workVisible),body);else if(!finished.length)body.append(make('p',state.busy&&!state.jobs.length?'Loading saved requests…':state.query||state.workFilter!=='all'?'No work matches this search and status.':'No current work is recorded.','relay-owner-note'));
    if(current.length>workVisible){const more=action('Show more current work ('+Math.min(workVisible,current.length)+' of '+current.length+')',()=>{workVisible+=50;renderMessages(controller.snapshot());},'text-button');body.append(more);}
    if(finished.length){flatTasks(finished.slice(0,workVisible),body);if(finished.length>workVisible)body.append(action('Show more finished work',()=>{workVisible+=50;renderMessages(controller.snapshot());},'text-button'));}
    panel.replaceChildren(body);panel.scrollTop=scroll;
    if(reading&&(restore||!contextChanged)&&scroll>0){const anchor=[...panel.querySelectorAll?.('[data-work-anchor]')||[]].find(node=>node.dataset.workAnchor===reading.id);if(anchor)panel.scrollTop+=anchor.getBoundingClientRect().top-panel.getBoundingClientRect().top-reading.offset;}
    if(focused)[...panel.querySelectorAll?.('[id]')||[]].find(n=>n.id===focused)?.focus({preventScroll:true});
  }
  function renderMessages(state) {
    if (!chatNodes) return;
    const search=doc.getElementById('relay-owner-search'),searchLabel=doc.getElementById('relay-owner-search-label');
    const searchText=state.requestsOnly&&state.jobsEnabled?'Search current work':'Search private messages';
    if(search){search.placeholder=searchText;if(search.value.trim().toLowerCase()!==state.query)search.value=state.query;}if(searchLabel)searchLabel.textContent=searchText;
    const panel=chatNodes.messages,work=state.requestsOnly&&state.jobsEnabled,changed=work!==messageView;
    if(changed){if(!chatNodes.first){if(messageView)rememberWork(panel);positions[messageView?'work':'chat']=messageView?workPosition(panel):position(panel);}messageView=work;}
    // Apply the destination layout before restoring its saved reading position.
    chatNodes.section.dataset.workView=String(work);chatNodes.section.dataset.taskEditor=String(state.jobMode);
    const anchor=changed?(positions.chat||{bottom:true}):chatNodes.first&&readingAnchor?readingAnchor:position(panel),jobs=new Map(state.jobs.map(j=>[j.messageId,j]));
    const existing=new Map([...panel.children].filter(n=>n.dataset?.messageId).map(n=>[n.dataset.messageId,n])),nodes=[];
    if(work)renderWork(state,changed?positions.work:null);else workSignature='';
    const selected = work?[]:state.messages.filter(m => (!state.query || m.body.toLowerCase().includes(state.query)||(m.attachments||[]).some(item=>item.name.toLowerCase().includes(state.query))||(state.deliveryPages[m.id]?.items||[]).some(delivery=>delivery.body.toLowerCase().includes(state.query)||delivery.attachments.some(item=>item.name.toLowerCase().includes(state.query))))&&(!state.requestsOnly||jobs.has(m.id)));
    let previousDay,previousMessage;
    for (const m of selected) {
      const day=messageDay(m.createdAt),dayStart=day.key!==previousDay?day.label:'';previousDay=day.key;
      const grouped=!!previousMessage&&previousMessage.role===m.role&&!dayStart&&Date.parse(m.createdAt)-Date.parse(previousMessage.createdAt)<300000;previousMessage=m;
      const candidate=jobs.get(m.id),job=candidate&&(actionableWork(candidate)||candidate.result)?candidate:null,replyJob=m.replyTo?jobs.get(m.replyTo):null,stale=state.syncStale||state.jobsError||state.jobDetailStale&&state.jobDetailId===job?.id,signature=JSON.stringify([m,state.deliveryPages[m.id],job,replyJob?.resultVersion,state.busy,state.sending,stale,job?jobLabel(job):null,dayStart,grouped]);let row=existing.get(m.id);
      if(row?._signature===signature){nodes.push(row);continue;}
      row = make('article', '', 'message-row ' + (m.role === 'user' ? 'outgoing' : 'incoming')+(grouped?' message-group-continuation':''));row._signature=signature;
      row.dataset.messageId = m.id;
      if(dayStart)row.append(make('p',dayStart,'message-day'));
      const heading=make('div','','message-heading'),copy=action('',async()=>{copy.setAttribute('aria-label',await copyText(m.body)?'Private message copied':'Copy private message');},'message-actions');copy.innerHTML=icon('copy');copy.setAttribute('aria-label','Copy private message');copy.hidden=!m.body;heading.append(make('span',m.role==='user'?'You':'dot','message-author'));row.append(heading);
      if(job&&workTitle(job)!=='Owner request')row.append(make('p',workTitle(job),'owner-request-title'));
      // Request text is inert. The inspector alone formats the saved result.
      const bubble=make('div','','bubble');if(m.body)bubble.append(make('p',m.body,'message-body'));for(const item of m.attachments||[])bubble.append(attachmentContent.row(item));row.append(bubble);
      if(m.role==='user'&&state.attachmentsEnabled){
        const deliveries=state.deliveryPages[m.id],section=make('section','','relay-assistant-deliveries');section.dataset.originalId=m.id;
        const toggle=action(deliveries?.open?'Close assistant files':'Files from assistant',()=>deliveries?.open?controller.closeDeliverables(m.id):controller.loadDeliverables(m.id),'text-button');toggle.setAttribute('aria-expanded',String(!!deliveries?.open));section.append(toggle);
        if(deliveries?.open){
          const status=make('p',deliveries.busy?'Loading private files…':deliveries.error||(!deliveries.items.length?'No later files have been delivered.':''),'request-meta');status.setAttribute('role','status');section.append(status);
          for(const delivery of deliveries.items){const entry=make('article','','relay-assistant-deliverable');entry.dataset.deliveryId=delivery.id;entry.append(make('p','Files from assistant · '+messageStamp(delivery.createdAt),'request-meta'));if(delivery.body)entry.append(make('p',delivery.body,'message-body'));for(const item of delivery.attachments)entry.append(attachmentContent.row(item));section.append(entry);}
          const refresh=action(deliveries.error?'Retry loading files':'Refresh files',()=>controller.loadDeliverables(m.id),'text-button');refresh.disabled=deliveries.busy;section.append(refresh);
          if(deliveries.nextCursor){const more=action('Load more files',()=>controller.loadDeliverables(m.id,{more:true}),'text-button');more.disabled=deliveries.busy;section.append(more);}
        }row.append(section);
      }
      let status='';
      if(m.role==='user'){
        const labels={saved:'Saved privately · awaiting reply',queued:'Saved · awaiting assistant',callback_accepted:'Sent · awaiting reply',delivery_failed:'Delivery needs retry',reply_saved:'Reply saved'};
        status=job?'':labels[m.delivery?.state]||'Saved privately';
        if(job){
          row.dataset.jobId=job.id;const info=make('div','','message-job');info.dataset.state=job.stage;const inspect=action(linkedWork(job)?'View original work':'Inspect request',()=>controller.inspectJob(linkedWork(job)||job.id),'text-button');inspect.id='relay-owner-inspect-'+job.id;info.append(make('span',(stale?'Last known: ':'')+(linkedWork(job)?'Follow-up · ':'')+jobLabel(job),'job-state'),inspect);const progress=job.presentation?.latestUpdate;if(progress)info.append(make('p',progress.summary,'request-copy'));row.append(info);
        }else if(m.delivery?.retryable){
          const retry=action('Retry callback delivery',()=>controller.retryDelivery(m.id));
          retry.disabled=state.busy||state.sending;row.append(retry);
        }
      }else if(replyJob?.resultVersion>1){
        const correction=make('div','','message-job');correction.dataset.state=replyJob.stage;const inspect=action('Inspect result',()=>controller.inspectJob(replyJob.id),'text-button');inspect.id='relay-owner-inspect-result-'+replyJob.id;correction.append(make('span','A correction is saved · version '+replyJob.resultVersion,'job-state'),inspect);row.append(correction);
      }
      const footer=make('div','','message-footer');footer.append(make('span',messageStamp(m.createdAt)+(status?' · '+status:''),'message-time'),copy);bubble.append(footer);nodes.push(row);
    }
    if (!selected.length&&!work){const empty=make('div','','chat-empty');empty.append(make('p','Private owner conversation','empty-label'),make('h2',state.query?'No matching messages':state.requestsOnly?'No requests to show':state.busy?'Opening your conversation…':'What would you like to work on?'),make('p',state.query?'Try a different phrase.':state.requestsOnly?'Send a message or a work request. Both stay in your private conversation.':state.busy?'Checking your private inbox.':state.jobsEnabled?'Ask naturally. When the assistant identifies actionable work, its plan and progress appear here and in Work.':'Message dot privately. Replies appear here after the assistant checks the inbox.'));nodes.push(empty);}
    if(!work){if(panel.insertBefore){const wanted=new Set(nodes);for(const child of [...panel.children])if(!wanted.has(child))child.remove();for(let i=0;i<nodes.length;i++)if(panel.children[i]!==nodes[i])panel.insertBefore(nodes[i],panel.children[i]||null);}else panel.replaceChildren(...nodes);restorePosition(panel,anchor);}attachmentContent.prune();chatNodes.first=false;
    if (chatNodes.input.value !== state.draft) { chatNodes.input.value = state.draft; autosize(chatNodes.input); }
    chatNodes.section.dataset.workView=String(work);chatNodes.section.dataset.taskEditor=String(state.jobMode);chatNodes.section.dataset.taskDraft=String(controller.hasTaskDraft);
    const newTask=doc.getElementById('relay-owner-new-task');if(newTask){newTask.textContent=state.jobMode||controller.hasTaskDraft?'Resume task':'New task';newTask.disabled=state.busy||state.sending;}
    if(state.jobMode&&!taskWasOpen)taskFocus=doc.activeElement;taskWasOpen=state.jobMode;
    chatNodes.taskHeader.hidden=!state.jobMode;chatNodes.taskActions.hidden=!state.jobMode;
    chatNodes.taskBack.setAttribute('aria-label',state.requestsOnly?'Back to work':'Back to messages');
    const target=state.jobMode?chatNodes.taskActions:chatNodes.inputRow;if(chatNodes.send.parentNode!==target)target.append(chatNodes.send);
    chatNodes.sendLabel.textContent=state.jobMode?'Save request':'';
    updateComposerSend(state);
    chatNodes.send.setAttribute('aria-label',state.sending?'Sending privately':state.jobMode?'Send private request':'Send private message');
    chatNodes.input.placeholder=state.jobMode?'Describe the work privately…':'Message dot privately…';
    chatNodes.inputLabel.textContent=state.jobMode?'Describe the work':'Message dot privately';
    chatNodes.status.textContent=state.sending?'Saving privately…':state.sendUnconfirmed?state.sendNotice||'Send unconfirmed · your text is still here':state.error?'Private sync unavailable':state.busy?'Refreshing private inbox…':state.sendNotice|| (!state.jobMode&&controller.hasTaskDraft?'Task draft kept · resume to send':state.requestsOnly?'Private requests · all saved attempts':state.jobsEnabled?'Private · messages and work requests':'Private · replies arrive after an inbox check');
    chatNodes.jobToggle.hidden=!state.jobsEnabled;chatNodes.jobToggle.disabled=state.sending;chatNodes.jobToggle.setAttribute('aria-pressed',String(state.jobMode));chatNodes.jobToggle.setAttribute('aria-label',state.jobMode?'Switch to private message':'Create work request');chatNodes.jobToggleLabel.textContent=state.jobMode?'Message instead':controller.hasTaskDraft?'Resume task':'New task';
    chatNodes.jobFields.hidden=!state.jobMode;
    chatNodes.title.required=state.jobMode;if(chatNodes.title.value!==state.jobTitle)chatNodes.title.value=state.jobTitle;if(chatNodes.kind.value!==state.jobKind)chatNodes.kind.value=state.jobKind;
    if(chatNodes.project.value!==(state.jobProject||''))chatNodes.project.value=state.jobProject||'';if(chatNodes.goal.value!==(state.jobGoal||''))chatNodes.goal.value=state.jobGoal||'';
    chatNodes.jobNote.textContent=state.jobKind==='read_only'?'Ask for a report without changing anything. The assistant reviews the request before starting.':state.jobKind==='draft'?'Ask for prepared work to review. This draft scope grants no permission to publish or make other changes.':'The assistant reviews the requested scope and your existing authorization.';
    chatNodes.error.textContent = state.sendNotice||state.error; chatNodes.error.hidden = !state.error&&!state.sendNotice;chatNodes.notice.dataset.kind=state.error||state.sendUnconfirmed?'error':'note';
    chatNodes.warning.textContent = state.warning; chatNodes.warning.hidden = !state.warning;
    chatNodes.notice.hidden=!state.error&&!state.sendUnconfirmed&&!state.sendNotice;chatNodes.retry.hidden=!state.error&&!state.sendUnconfirmed;chatNodes.retry.textContent=state.sendUnconfirmed?'Retry private send':state.attachmentRetry?'Retry file send':'Retry private sync';chatNodes.retry.disabled=state.busy||state.sending;
  }
  function updateComposerSend(state=controller){if(!chatNodes)return;chatNodes.input.required=!(state.attachmentCount&&state.attachmentsEnabled&&!state.jobMode);const taskDraft=!state.jobMode&&(state.hasTaskDraft??(state.taskDraftKept||state.jobTitle||state.jobProject||state.jobGoal));chatNodes.send.disabled=state.sending||state.busy||!chatNodes.input.value.trim()&&!state.attachmentCount||state.jobMode&&!chatNodes.title.value.trim()||!!taskDraft;}
  function render() {
    const state = controller.snapshot();
    // The subscription also runs while private UI is hidden or unmounted.
    if(state.status!=='approved'){readingAnchor=null;positions.chat=null;positions.work=null;messageView=false;taskFocus=null;taskWasOpen=false;workOpen.clear();workContext='';workSignature='';workVisible=50;}
    if (!root?.isConnected || controller.mode === 'public') { clearSensitiveFields(); return; }
    if(connectionDialog&&(state.status!=='approved'||state.mode!=='owner')){connectionDialog.close?.();connectionDialog.remove?.();connectionDialog=null;}
    renderInspector(state);
    const key = state.mode === 'owner' && state.status === 'approved' ? 'chat' : state.mode + ':' + state.status;
    const searchToggle = doc.getElementById('chat-search-toggle'); if (searchToggle) searchToggle.hidden = state.status!=='approved';
    if (key === 'chat' && viewKey === key) { renderMessages(state); return; }
    const active = doc.activeElement;
    // Preserve unsent setup choices when a status repaint follows network work.
    if (root.contains(active) && active?.id === 'relay-owner-label') pairLabel = active.value;
    if(chatNodes)readingAnchor=position(chatNodes.messages);
    attachmentContent.clear();clearSensitiveFields(); root.classList.add('relay-owner-content'); root.replaceChildren(); viewKey = key; chatNodes = null;
    const section = make('section', '', 'relay-owner-panel'); root.append(section);
    if(key!=='chat'&&state.requestsOnly)section.append(make('p','Work requires private owner access. Sign in or reconnect this phone to view saved tasks.','relay-owner-note'));
    if (key !== 'chat' && state.draft) section.append(make('p', 'Your unsent private draft is kept in this tab. Sign in to review it.', 'relay-owner-notice'));
    if (key === 'chat') {
      section.classList.add('relay-owner-chat');
      const heading = make('div', '', 'relay-owner-heading'); heading.append(make('h2', 'Owner chat')); section.append(heading);
      const search = make('div', '', 'conversation-search'); search.id = 'relay-owner-search-bar'; search.hidden = true;
      const searchLabel = make('label', 'Search private messages', 'sr-only'); searchLabel.htmlFor = 'relay-owner-search';searchLabel.id='relay-owner-search-label';
      const searchInput = make('input'); searchInput.id = 'relay-owner-search'; searchInput.type = 'search'; searchInput.placeholder = 'Search private messages'; searchInput.autocomplete = 'off';searchInput.value=state.query;search.hidden=!state.query; searchInput.oninput = () => controller.setQuery(searchInput.value);const searchClose=action('',()=>ui.toggleSearch(),'icon-button');searchClose.innerHTML=icon('close');searchClose.setAttribute('aria-label','Close search');search.append(searchLabel,searchInput,searchClose); section.append(search);
      workSignature='';workVisible=50;const messages = make('div', '', 'messages'); messages.setAttribute('aria-label', 'Private owner conversation'); messages.setAttribute('aria-live', 'polite'); section.append(messages);
      const form = make('form', '', 'composer'); form.id = 'relay-owner-message-form';
      const taskHeader=make('div','','owner-task-heading'),back=action('',()=>{const previous=taskFocus;controller.setJobMode(false);(previous?.isConnected?previous:doc.getElementById(controller.requestsOnly?'relay-owner-new-task':'relay-owner-job-toggle')||chatNodes?.input)?.focus({preventScroll:true});},'text-button');back.id='relay-owner-task-back';back.innerHTML=icon('back');back.append(make('span','Back'));back.setAttribute('aria-label','Back to messages');taskHeader.append(back,make('h2','New task'));form.append(taskHeader);
      const fields=make('div','','owner-job-fields');fields.hidden=true;
      const titleLabel=make('label','Request title');titleLabel.htmlFor='relay-owner-job-title';const title=make('input');title.id='relay-owner-job-title';title.maxLength=120;title.placeholder='What would you like to do?';title.autocomplete='off';title.oninput=()=>{controller.setJobTitle(title.value);updateComposerSend();};const titleField=make('div');titleField.append(titleLabel,title);
      const kindLabel=make('label','Requested scope');kindLabel.htmlFor='relay-owner-job-kind';const kind=make('select');kind.id='relay-owner-job-kind';for(const [value,text] of [['consequential','Needs review'],['read_only','Read-only report'],['draft','Draft only']]){const option=make('option',text);option.value=value;kind.append(option);}kind.onchange=()=>controller.setJobKind(kind.value);const kindField=make('div');kindField.append(kindLabel,kind);const jobNote=make('p');fields.append(titleField,kindField,jobNote);form.append(fields);
      const organization=make('details','','owner-job-organization');organization.append(make('summary','Project and goal (optional)'));
      const labels=make('div','','owner-job-labels');
      const projectLabel=make('label','Project');projectLabel.htmlFor='relay-owner-job-project';const project=make('input');project.id='relay-owner-job-project';project.maxLength=120;project.autocomplete='off';project.oninput=()=>controller.setJobProject(project.value);const projectField=make('div');projectField.append(projectLabel,project);
      const goalLabel=make('label','Goal');goalLabel.htmlFor='relay-owner-job-goal';const goal=make('input');goal.id='relay-owner-job-goal';goal.maxLength=120;goal.autocomplete='off';goal.oninput=()=>controller.setJobGoal(goal.value);const goalField=make('div');goalField.append(goalLabel,goal);labels.append(projectField,goalField);organization.append(labels);fields.append(organization);
      const label = make('label', 'Describe the work', 'sr-only owner-message-label'); label.htmlFor = 'relay-owner-message-text';
      const input = make('textarea'); input.id = 'relay-owner-message-text'; input.rows = 1; input.maxLength = 4000; input.placeholder = 'Message dot privately…'; input.autocomplete = 'off'; input.required = true; input.value = state.draft;
      input.oninput = () => { controller.setDraft(input.value); autosize(input);updateComposerSend(); };
      input.onkeydown = event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); form.requestSubmit(); } };
      const bottom = make('div', '', 'composer-bottom'), status = make('span'); status.setAttribute('role', 'status');
      const toggle=action('',()=>{const opening=!controller.jobMode;controller.setJobMode(opening);if(opening)chatNodes?.title.focus({preventScroll:true});},'composer-mode-button');toggle.id='relay-owner-job-toggle';toggle.innerHTML=icon('plus');const toggleLabel=make('span','Work request');toggle.append(toggleLabel);bottom.append(status,toggle);
      const send = action('', () => {}, 'primary send-icon'); send.type = 'submit'; send.innerHTML = icon('send');const sendLabel=make('span');send.append(sendLabel);const inputRow=make('div','','composer-input');inputRow.append(label,input,send);const taskActions=make('div','','owner-task-actions');form.append(inputRow,bottom,taskActions);
      form.onsubmit = event => { event.preventDefault(); controller.setDraft(input.value); controller.send(); };
      section.append(form);
      const error = make('p', '', 'relay-owner-error'); error.setAttribute('role', 'status');
      const warning = make('p', '', 'relay-owner-note owner-storage-warning');
      const retry = action('Retry private sync', () => {const state=controller.snapshot();return state.sendUnconfirmed?controller.retryUnconfirmed():state.attachmentRetry?controller.send():controller.refresh();},'text-button'),notice=make('div','','conversation-notice');notice.append(error,retry);section.insertBefore?.(notice,form);if(!section.insertBefore)section.append(notice);section.append(warning);
      chatNodes = { section,messages, input,inputLabel:label,status, send,sendLabel,inputRow,taskHeader,taskBack:back,taskActions,error, warning, retry,notice,jobToggle:toggle,jobToggleLabel:toggleLabel,jobFields:fields,title,kind,jobNote,project,goal,organization,first:true };messageView=false;renderMessages(state); autosize(input);
      return;
    }
    if (state.mode === 'account') {
      section.append(make('h2', 'Account sign-in'), make('p', 'Your account username and password let you recover private owner access on this same URL. Each successful sign-in creates a separate revocable device session. Account credentials are separate from remembered device access.', 'relay-owner-note'));
      if (state.accountNotice) { const notice = make('p', state.accountNotice, 'relay-owner-note'); notice.setAttribute('role', 'status'); section.append(notice); }
      if (state.accountReady) {
        const change = state.account.configured;
        section.append(make('h3', change ? 'Change username or password' : 'Set up username and password'));
        const form = make('form', '', 'relay-owner-auth-form'); form.id = 'relay-owner-credentials-form'; form.autocomplete = 'off';
        const username = field(form, 'Account username', 'relay-owner-account-username', { minLength: 3, maxLength: 32, value: change ? state.account.username : '' });
        username.setAttribute('pattern', '[A-Za-z0-9][A-Za-z0-9._-]{2,31}');
        const current = change ? field(form, 'Current password', 'relay-owner-current-password', { type: 'password' }) : null;
        const password = field(form, 'New password', 'relay-owner-new-password', { type: 'password', minLength: 16 });
        const confirmation = field(form, 'Confirm new password', 'relay-owner-confirm-password', { type: 'password', minLength: 16 });
        const policy = make('p', 'Choose a unique password of 16–128 characters (at most 256 bytes). Relay stores a salted password verifier on the owner service. Your account credentials remain valid until you change them; the 365-day inactivity limit applies to each device session. There is no email reset: keep your password safely and retain a trusted device session for account management.', 'relay-owner-note');
        const consent = make('label', '', 'relay-owner-remember'), checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.id = 'relay-owner-credentials-consent'; checkbox.required = true; checkbox.checked = false; sensitiveInputs.add(checkbox);
        consent.append(checkbox, make('span', 'I approve saving this account sign-in for owner access until I change it. Device sessions expire after 365 days of inactivity; existing sessions stay active until individually revoked.'));
        policy.id = 'relay-owner-password-policy'; checkbox.setAttribute('aria-describedby', policy.id);
        const submit = action(change ? 'Save account changes' : 'Save account sign-in', () => {}, 'primary'); submit.type = 'submit'; submit.disabled = state.busy;
        form.append(policy, consent, submit); form.onsubmit = event => {
          event.preventDefault(); if (state.busy) return;
          const entered = { username: username.value, password: password.value, confirmation: confirmation.value, currentPassword: current?.value, consent: checkbox.checked };
          clearSensitiveFields(); controller.saveCredentials(entered);
        };
        section.append(form);
      } else if (state.busy) section.append(make('p', state.account ? 'Saving account sign-in…' : 'Verifying owner access and preparing your form…', 'relay-owner-note'));
      else { const fresh = action(state.accountNotice ? 'Change account sign-in' : 'Open a fresh account form', () => controller.showAccount(), 'primary'); section.append(fresh); }
      statusNodes(section, state); section.append(action(state.busy ? 'Close account form' : 'Cancel / owner chat', () => controller.showOwner())); return;
    }
    if (state.mode === 'pairing') {
      section.append(make('h2', 'Connect this phone'));
      if (state.status === 'pending') {
        section.append(make('p', 'On your unrestricted phone, open your existing private chat with dot and ask it to approve this Relay pairing code. Keep this page open.', 'relay-owner-note'));
        const code = make('p', state.pairing.code, 'relay-owner-code'); code.setAttribute('aria-label', 'Pairing code ' + state.pairing.code); section.append(code);
        const copy = action('Copy approval request', async () => { copy.textContent = await copyText('Please approve this Relay phone pairing code: ' + state.pairing.code) ? 'Approval request copied' : 'Select the displayed code to copy it'; }); section.append(copy);
        section.append(make('p', 'Approval code expires ' + stamp(state.pairing.expires_at) + '. This phone has no owner access until you approve it.', 'relay-owner-note'));
        const check = action(state.busy ? 'Checking approval…' : 'Check approval', () => controller.checkPairing(), 'primary'); check.disabled = state.busy; section.append(check);
        section.append(action('Cancel pairing', () => { controller.connect(); render(); }));
      } else {
        loginForm(section, state);
        section.append(make('h3', 'Pair a device or set up account sign-in'), make('p', 'First-time account setup requires an already verified owner session. Pair once below, then open Account sign-in in private owner chat. After setup, your username and password work here independently of the other phone.', 'relay-owner-note'));
        if (['expired', 'revoked'].includes(state.status)) section.append(make('p', state.status === 'expired' ? 'This pairing request has expired. Create a new code.' : 'This pairing request was revoked. Create a new code.', 'relay-owner-error'));
        section.append(make('p', 'Approve a one-time code from your existing private dot chat on your unrestricted phone. Pair each phone separately so either can be revoked.', 'relay-owner-note'));
        const form = make('form'); form.id = 'relay-owner-pair-form';
        const label = make('label', 'Device name'); label.htmlFor = 'relay-owner-label';
        const input = make('input'); input.id = 'relay-owner-label'; input.maxLength = 80; input.placeholder = 'For example, my restricted phone'; input.value = pairLabel; input.autocomplete = 'off'; input.oninput = () => { pairLabel = input.value; };
        const remember = make('label', '', 'relay-owner-remember');
        const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.id = 'relay-owner-remember'; checkbox.checked = pairRemember; checkbox.onchange = () => { pairRemember = checkbox.checked; };
        remember.append(checkbox, make('span', 'Remember owner access on this browser'));
        const consent = make('p', 'If checked, this browser saves only a device token and device ID. Access expires after exactly 365 days of inactivity and renews on authenticated use. Scripts on this shared website origin can read the token. Anyone using this browser can use this access. Clearing browser data requires signing in again with account credentials, or pairing again if account sign-in is not configured. Private history is not saved in browser storage. Unsent drafts are kept in this tab, separate from public Relay drafts.', 'relay-owner-note'); consent.id = 'relay-owner-storage-notice'; checkbox.setAttribute('aria-describedby', consent.id);
        const start = action(state.busy ? 'Creating code…' : 'Create pairing code', () => {}, 'primary'); start.type = 'submit'; start.disabled = state.busy;
        form.append(label, input, remember, consent, start); form.onsubmit = event => { event.preventDefault(); pairLabel = input.value; pairRemember = checkbox.checked; controller.startPairing(pairLabel, pairRemember); }; section.append(form);
      }
      statusNodes(section, state); section.append(action('Public chat', () => controller.showPublic())); return;
    }
    if (state.mode === 'devices' && state.status === 'approved') {
      section.append(make('h2', 'Owner devices'), make('p', 'Each phone has its own revocable session. Successful authenticated use renews that session’s 365-day inactivity expiry.', 'relay-owner-note'));
      if (!state.devices.length) section.append(make('p', state.busy ? 'Checking devices…' : 'No device list is available yet.', 'relay-owner-note'));
      for (const device of state.devices) {
        const row = make('div', '', 'relay-owner-device');
        row.append(make('h3', device.label + (device.id === state.device?.id ? ' · this phone' : '')),
          make('p', device.revokedAt ? 'Revoked' : 'Last used ' + stamp(device.lastSeenAt) + ' · expires ' + stamp(device.expiresAt), 'relay-owner-note'));
        const revoke = action('Revoke ' + device.label, () => controller.revoke(device.id)); revoke.disabled = state.busy || !!device.revokedAt; row.append(revoke); section.append(row);
      }
      statusNodes(section, state); const refresh = action('Refresh devices', () => controller.refreshDevices()); refresh.disabled = state.busy; section.append(refresh, action('Account sign-in', () => controller.showAccount()), action('Owner chat', () => controller.showOwner())); return;
    }
    section.append(make('h2', 'Owner chat'));
    const text = state.status === 'checking' ? 'Verifying owner access for this phone…' : state.status === 'expired' ? 'This phone’s owner session has expired.' : state.status === 'revoked' ? 'This phone’s owner access has been revoked.' : 'Owner access has not been verified.';
    section.append(make('p', text, 'relay-owner-note')); statusNodes(section, state);
    if (controller.hasCredential) { const retry = action('Retry owner connection', () => controller.refresh(), 'primary'); retry.disabled = state.busy; section.append(retry); }
    else section.append(action('Connect this phone', () => controller.connect(), 'primary'));
    section.append(action('Public chat', () => controller.showPublic()));
  }
  const hideSensitive = () => { if (doc.hidden) { clearSensitiveFields(); controller.cancelSensitive(); } };
  const leavePage = () => { clearSensitiveFields(); controller.cancelSensitive(); };
  doc.addEventListener?.('visibilitychange', hideSensitive);
  doc.defaultView?.addEventListener('pagehide', leavePage);
  doc.defaultView?.addEventListener('beforeunload', leavePage);
  const unsubscribe = controller.subscribe(render);
  const ui={
    controller,
    get mode() { return controller.mode; },
    mount(node) {
      root = node; viewKey = ''; render(); clearInterval(timer);
      if (controller.mode === 'owner' && controller.hasCredential && ['unknown', 'checking'].includes(controller.status)) controller.refresh();
      if (controller.mode === 'pairing' && controller.status === 'pending') controller.checkPairing();
      timer = setInterval(() => {
        if (!root?.isConnected || doc.hidden) return;
        if (controller.status === 'pending' && controller.mode === 'pairing') controller.checkPairing();
        else if (controller.mode === 'owner' && controller.hasCredential) controller.refresh();
      }, controller.status === 'pending' || controller.mode === 'pairing' ? 5000 : 30000);
    },
    unmount() { attachmentContent.clear();if(chatNodes){if(messageView){rememberWork(chatNodes.messages);positions.work=workPosition(chatNodes.messages);}else positions.chat=position(chatNodes.messages);readingAnchor=positions.chat;}closeInspector();connectionDialog?.close?.();connectionDialog?.remove?.();connectionDialog=null;clearSensitiveFields(); if (viewKey.startsWith('account:') || controller.snapshot().authenticating || controller.snapshot().loginDevices.length) controller.cancelSensitive(); root = null; chatNodes = null; viewKey = ''; clearInterval(timer); },
    toggleSearch() { const bar = doc.getElementById('relay-owner-search-bar'); if (!bar) return; bar.hidden = !bar.hidden; if (!bar.hidden) doc.getElementById('relay-owner-search').focus(); else { doc.getElementById('relay-owner-search').value = ''; controller.setQuery(''); } },
    latest() { if(controller.requestsOnly)controller.setRequestsOnly(false);controller.setQuery('');if(chatNodes)chatNodes.messages.scrollTop=chatNodes.messages.scrollHeight; },
    requests(){controller.toggleRequests();if(chatNodes)chatNodes.messages.scrollTop=0;},
    connection(){
      if(!doc.body)return;connectionDialog?.close?.();const state=controller.snapshot(),dialog=make('dialog','','app-sheet conversation-sheet');connectionDialog=dialog;dialog.setAttribute('aria-label','Private owner connection');const heading=make('div','','dialog-heading'),close=action('',()=>dialog.close(),'icon-button');close.innerHTML=icon('close');close.setAttribute('aria-label','Close connection details');heading.append(make('h2','Private owner connection'),close);dialog.append(heading);
      dialog.append(make('p',state.status==='approved'?'Owner access was verified for this device.':state.status==='expired'?'This device session has expired.':state.status==='revoked'?'This device session was revoked.':'Private owner access has not been verified.','sheet-context'));
      if(state.device)dialog.append(make('p','Device access expires '+stamp(state.device.expiresAt)+'. Successful authenticated use renews the inactivity period.','sheet-note'));
      dialog.append(make('p',state.status!=='approved'?'Sign in or reconnect this phone to use the private conversation. Public Relay is available only when you choose it explicitly.':state.jobsEnabled?state.jobsError||'Messages and durable requests are available. A callback receipt confirms delivery only. Working appears only after authenticated assistant acknowledgement.':'Private messages remain available. Durable request details need a newer owner service.','sheet-note'));
      if(state.error)dialog.append(make('p',state.error,'relay-owner-error'));dialog.addEventListener('close',()=>{dialog.remove();if(connectionDialog===dialog)connectionDialog=null;},{once:true});doc.body.append(dialog);dialog.showModal();
    },
    refresh() { return controller.status === 'pending' ? controller.checkPairing() : controller.mode === 'devices' ? controller.refreshDevices() : controller.refresh(); },
    dispose() { this.unmount(); unsubscribe(); doc.removeEventListener?.('visibilitychange', hideSensitive); doc.defaultView?.removeEventListener('pagehide', leavePage); doc.defaultView?.removeEventListener('beforeunload', leavePage); }
  };return ui;
}
