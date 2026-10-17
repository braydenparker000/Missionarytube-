import {readFileSync,lstatSync,realpathSync,existsSync,openSync,writeFileSync,closeSync,linkSync,unlinkSync} from 'node:fs';
import {createHash,createPublicKey,createPrivateKey,publicEncrypt,privateDecrypt,createCipheriv,createDecipheriv,randomBytes,constants} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,basename} from 'node:path';
import {pathToFileURL} from 'node:url';

export const TARGET=Object.freeze({
  repository:'braydenparker000/Missionarytube-',
  branch:'review/core-provider-usage-20261009',
  actorId:'183016859',actor:'braydenparker999',
  base:'9c01243ad03b921a0b0614d5eb003944a2807a6c',
  worker:'jarvis-hub-api',binding:'HUBS',className:'Hub',
});
export const LIMITS=Object.freeze({requests:3,timeoutMs:30000,responseBytes:256*1024,totalBytes:768*1024,responseChunks:1024,namespaceRows:100,usageRows:16,frameBytes:4096,envelopeBytes:8192});
export const PUBLIC_FILES=Object.freeze([
  '.github/workflows/core-provider-usage.yml',
  'docs/core-provider-usage-20261009.md',
  'scripts/core-provider-usage.mjs',
  'scripts/core-provider-usage.test.mjs',
]);
export const FROZEN=Object.freeze([
  'jarvis-release.json',
  '.github/workflows/deploy-azure-storage.yml',
  '.github/workflows/qualify-jarvis.yml',
  'scripts/plan-jarvis-qualification.mjs',
  'scripts/install-jarvis-browser.mjs',
  'scripts/worker-release-identity.mjs',
  'scripts/prepare-music-worker.mjs',
  'scripts/prepare-worker-tools.mjs',
  'scripts/check-music-worker-bindings.mjs',
  'scripts/qualified-artifact.mjs',
  'scripts/backup-jarvis-storage.mjs',
  'scripts/overlap-jarvis-prewrite.mjs',
  '.github/workflows/astra-worker-reuse-preflight.yml',
  'scripts/astra-worker-reuse-preflight.mjs',
  'scripts/astra-worker-reuse-preflight.test.mjs',
]);

export const RECIPIENT_FINGERPRINT='90139e1eb2462f9ccdab4adc70b6bcf79debd7ecca058ede857c6c613aeddda8';
export const RECIPIENT_PUBLIC_KEY=`-----BEGIN PUBLIC KEY-----
MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEA3LpIoL2WIQrV9AVcuGGA
w+d/PO+zaXF7PmYthz2Gc7EKuyIZFeCgzOxUlJW0D51AH7HKMe7kqlCfpLb+/DEs
q+u0IYpW7AqPjcSwDG49i0hBEjnBw+jgAVOZvSEh4DxhIMknJfrUJQbzVNTFZLwJ
33eX4uozcHPiWnmiQxWgikUobIff6ptrBcqxUJpTosC0tPnA9ZpYG/kjWR1Bjjvq
GwDBP1aapQJuDEVA84svDo4iVP6Y1xhaHg78gjfJ7r4cFxmSmCdhtxEqZOQnFGAb
EOfZv6o8TgmE2hC5yzQtRruQUqTIZiOorcdsEfwrinDXzScp6axh5yu1gEG7x880
5ZxUjUczKq7qpT4EnZ9TnCxTfyuat7oFI9g9pCOSlYoRaJdWQGw3SJ43IMUOS12m
TLWbI10HxOJpAUXC+tGasfi0NPMN93ttyFoxr3KIzd+emIhyWNcoVFksEW2jQ3LW
NkuYoLXDpV0Qt0T3QOaI75tjKK7V5tHI661XD3FuuMNrk3uGSVBr5WzcajtdZKKD
Sq59tDsR3RPDBqoIuNblGO7dMWblGkuC8aVnA47J499d4mcyAyPEjtI5Xgm6X2yr
J1h5WaVWdjlzNqKvNJ4v5o2nXdcggqusRObLWxYo7ojreJE8Ez7CPnsz/cP1FiXk
ViXUCvPk5QnC716SRv0ooZ8CAwEAAQ==
-----END PUBLIC KEY-----
`;

const hash=value=>createHash('sha256').update(value).digest('hex');
export const QUERY_HASH=hash(JSON.stringify({v:1,worker:TARGET.worker,binding:TARGET.binding,className:TARGET.className,
  routes:['GET settings','GET namespaces?page=1&per_page=100','GET billable/usage?from=D&to=D'],limits:LIMITS}));
const LABEL=Buffer.from('CORE_USAGE_V1');
const PUBLIC_STATUS=new Set(['checkout_verified','observation_sealed','decode_verified','invalid_invocation','context_refused',
  'checkout_refused','credentials_unavailable','response_invalid','response_limit','timeout','day_changed','sealing_refused','decode_refused']);
const FACT_STATUS=new Set(['validated','confirmed','reported','unknown','denied','unavailable','rate_limited','refused','response_invalid','response_limit']);
class Refusal extends Error{constructor(classification){super('Bounded diagnosis refused');this.classification=classification;}}
const refuse=classification=>{throw new Refusal(classification);};
const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const keys=(value,expected)=>isObject(value)&&Object.keys(value).sort().join('|')===[...expected].sort().join('|');
const git=(root,...args)=>execFileSync('git',['--no-optional-locks','-C',root,...args],
  {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:10000,maxBuffer:1024*1024}).trim();
const file=path=>{
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024*1024)refuse('checkout_refused');
  return readFileSync(path);
};
const validDay=day=>typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&
  Number.isFinite(Date.parse(day+'T00:00:00.000Z'))&&new Date(day+'T00:00:00.000Z').toISOString().slice(0,10)===day;
const interval=day=>({start:day+'T00:00:00.000Z',end:new Date(Date.parse(day+'T00:00:00.000Z')+86400000).toISOString()});
const fingerprint=key=>hash(createPublicKey(key).export({format:'der',type:'spki'}));

export function authorizedContext(env,head,event){
  return env.GITHUB_REPOSITORY===TARGET.repository&&env.GITHUB_EVENT_NAME==='push'&&
    env.GITHUB_REF==='refs/heads/'+TARGET.branch&&env.GITHUB_ACTOR_ID===TARGET.actorId&&
    env.GITHUB_ACTOR===TARGET.actor&&env.GITHUB_TRIGGERING_ACTOR===TARGET.actor&&env.GITHUB_RUN_ATTEMPT==='1'&&
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA||'')&&env.GITHUB_SHA===head&&
    event?.repository?.full_name===TARGET.repository&&event.repository.fork===false&&
    event.sender?.id===Number(TARGET.actorId)&&event.sender.login===TARGET.actor&&
    event.ref===env.GITHUB_REF&&event.after===head&&event.before==='0'.repeat(40)&&
    event.created===true&&event.deleted===false&&event.forced===false;
}

export function checkedReleaseHead(root=process.cwd(),head=git(root,'rev-parse','HEAD')){
  root=resolve(root);
  if(realpathSync(root)!==root||!lstatSync(root).isDirectory()||git(root,'rev-parse','--show-toplevel')!==root||
    !/^[a-f0-9]{40}$/.test(head)||git(root,'rev-parse','HEAD')!==head||git(root,'rev-parse','HEAD^')!==TARGET.base)refuse('checkout_refused');
  git(root,'diff','HEAD','--exit-code');
  const delta=git(root,'diff','--name-status','--no-renames',TARGET.base,head,'--');
  if(delta!==PUBLIC_FILES.map(path=>'A\t'+path).sort().join('\n'))refuse('checkout_refused');
  for(const path of FROZEN){
    file(resolve(root,path));
    if(git(root,'rev-parse',head+':'+path)!==git(root,'rev-parse',TARGET.base+':'+path))refuse('checkout_refused');
  }
  PUBLIC_FILES.forEach(path=>file(resolve(root,path)));
}

export function checkedHubs(data){
  if(data?.success!==true||data.errors!==undefined&&(!Array.isArray(data.errors)||data.errors.length)||
    !isObject(data.result)||!Array.isArray(data.result.bindings)||data.result.bindings.length>128)refuse('refused');
  const hubs=data.result.bindings.filter(binding=>isObject(binding)&&binding.name===TARGET.binding);
  if(hubs.length!==1||hubs[0].type!=='durable_object_namespace'||hubs[0].class_name!==TARGET.className||
    !/^[a-f0-9]{32}$/.test(hubs[0].namespace_id||'')||
    hubs[0].script_name!==undefined&&hubs[0].script_name!==TARGET.worker||hubs[0].dispatch_namespace!==undefined||
    hubs[0].environment!==undefined&&hubs[0].environment!=='production')refuse('refused');
  return hubs[0].namespace_id;
}

export function checkedNamespace(data,namespace){
  if(data?.success!==true||data.errors!==undefined&&(!Array.isArray(data.errors)||data.errors.length)||
    !Array.isArray(data.result)||data.result.length>LIMITS.namespaceRows)refuse('refused');
  const matches=data.result.filter(row=>isObject(row)&&row.id===namespace);
  if(!matches.length)return {status:'unknown',backend:'unknown'};
  if(matches.length!==1||matches[0].class!==TARGET.className||matches[0].script!==TARGET.worker||
    typeof matches[0].use_sqlite!=='boolean')refuse('refused');
  return {status:'confirmed',backend:matches[0].use_sqlite?'sqlite':'legacy_kv'};
}

export function checkedUsage(data,account,day,forbiddenStrings=[]){
  if(!validDay(day)||data?.success!==true||data.errors!==undefined&&(!Array.isArray(data.errors)||data.errors.length)||
    !Array.isArray(data.result)||data.result.length>LIMITS.usageRows)refuse('refused');
  const window=interval(day),seen=new Set(),records=[];
  for(const row of data.result){
    if(!isObject(row)||row.BillingAccountId!==account||row.ChargeClass!==undefined||
      row.ChargeCategory!=='Usage'||row.ChargeFrequency!=='Usage-Based'||
      typeof row.ChargePeriodStart!=='string'||typeof row.ChargePeriodEnd!=='string'||
      row.ChargePeriodStart.length>32||row.ChargePeriodEnd.length>32||
      !/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?(?:Z|\+00:00)$/.test(row.ChargePeriodStart)||
      !/^\d{4}-\d{2}-\d{2}T00:00:00(?:\.000)?(?:Z|\+00:00)$/.test(row.ChargePeriodEnd)||
      Date.parse(row.ChargePeriodStart)!==Date.parse(window.start)||Date.parse(row.ChargePeriodEnd)!==Date.parse(window.end)||
      typeof row.x_BillableMetricId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(row.x_BillableMetricId)||
      typeof row.ConsumedUnit!=='string'||!/^[A-Za-z0-9][A-Za-z0-9 /_.%-]{0,23}$/.test(row.ConsumedUnit)||
      typeof row.ConsumedQuantity!=='number'||!Number.isFinite(row.ConsumedQuantity)||row.ConsumedQuantity<0||
      row.ConsumedQuantity>Number.MAX_SAFE_INTEGER||seen.has(row.x_BillableMetricId)||
      forbiddenStrings.some(secret=>typeof secret==='string'&&secret&&
        (row.x_BillableMetricId.includes(secret)||row.ConsumedUnit.includes(secret))))refuse('refused');
    seen.add(row.x_BillableMetricId);
    records.push({metricId:row.x_BillableMetricId,unit:row.ConsumedUnit,quantity:row.ConsumedQuantity});
  }
  return {status:records.length?'reported':'unknown',...window,records};
}

export function checkedContext(context){
  if(!keys(context,['v','repository','head','runId','attempt','job','day','recipient','queryHash'])||context.v!==1||
    context.repository!==TARGET.repository||!/^[a-f0-9]{40}$/.test(context.head||'')||
    !/^[1-9][0-9]{0,19}$/.test(context.runId||'')||context.attempt!==1||context.job!=='provider-observation'||
    !validDay(context.day)||!/^[a-f0-9]{64}$/.test(context.recipient||'')||context.queryHash!==QUERY_HASH)refuse('context_refused');
  const canonical={v:1,repository:context.repository,head:context.head,runId:context.runId,attempt:1,
    job:context.job,day:context.day,recipient:context.recipient,queryHash:QUERY_HASH};
  if(Buffer.byteLength(JSON.stringify(canonical))>512)refuse('context_refused');
  return canonical;
}

export function checkedProjection(projection,context){
  if(!keys(projection,['v','day','capturedAt','binding','namespace','usage','metricSemantics','completeness','quota','plan','catalog','objectStorage','retainedBounds'])||
    projection.v!==1||projection.day!==context.day||typeof projection.capturedAt!=='string'||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(projection.capturedAt)||
    !Number.isFinite(Date.parse(projection.capturedAt))||new Date(projection.capturedAt).toISOString()!==projection.capturedAt||
    projection.capturedAt.slice(0,10)!==context.day||
    !FACT_STATUS.has(projection.binding)||['confirmed','reported'].includes(projection.binding)||
    !keys(projection.namespace,['status','backend'])||!FACT_STATUS.has(projection.namespace.status)||
    ['validated','reported'].includes(projection.namespace.status)||!['unknown','sqlite','legacy_kv'].includes(projection.namespace.backend)||
    (projection.namespace.status==='confirmed')!==(projection.namespace.backend!=='unknown')||
    !keys(projection.usage,['status','start','end','records'])||!FACT_STATUS.has(projection.usage.status)||
    ['validated','confirmed'].includes(projection.usage.status)||projection.usage.start!==interval(context.day).start||
    projection.usage.end!==interval(context.day).end||!Array.isArray(projection.usage.records)||
    projection.usage.records.length>LIMITS.usageRows||
    (projection.usage.status==='reported')!==(projection.usage.records.length>0)||
    ['metricSemantics','completeness','quota','plan','catalog','objectStorage','retainedBounds'].some(key=>projection[key]!=='unknown'))refuse('sealing_refused');
  const seen=new Set();
  for(const row of projection.usage.records){
    if(!keys(row,['metricId','unit','quantity'])||typeof row.metricId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(row.metricId)||
      typeof row.unit!=='string'||!/^[A-Za-z0-9][A-Za-z0-9 /_.%-]{0,23}$/.test(row.unit)||typeof row.quantity!=='number'||
      !Number.isFinite(row.quantity)||row.quantity<0||row.quantity>Number.MAX_SAFE_INTEGER||seen.has(row.metricId))refuse('sealing_refused');
    seen.add(row.metricId);
  }
  if(projection.binding!=='validated'&&(projection.namespace.status!=='unknown'||projection.usage.status!=='unknown'))refuse('sealing_refused');
  return projection;
}

export function encryptProjection(projection,context,{publicKey=RECIPIENT_PUBLIC_KEY}={}){
  context=checkedContext(context);checkedProjection(projection,context);
  const recipient=createPublicKey(publicKey);
  if(recipient.asymmetricKeyType!=='rsa'||recipient.asymmetricKeyDetails.modulusLength!==4096||
    fingerprint(publicKey)!==context.recipient)refuse('sealing_refused');
  const bytes=Buffer.from(JSON.stringify(projection)),frame=Buffer.alloc(LIMITS.frameBytes);
  if(bytes.length>LIMITS.frameBytes-4)refuse('sealing_refused');
  frame.writeUInt32BE(bytes.length);bytes.copy(frame,4);
  const key=randomBytes(32),nonce=randomBytes(12),aad=Buffer.from(JSON.stringify(context));
  try{
    const cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:16});cipher.setAAD(aad);
    const ciphertext=Buffer.concat([cipher.update(frame),cipher.final()]);
    const wrapped=publicEncrypt({key:recipient,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:LABEL},key);
    const envelope='CORE_USAGE_V1 '+JSON.stringify({v:1,context,wrapped:wrapped.toString('base64'),nonce:nonce.toString('base64'),
      ciphertext:ciphertext.toString('base64'),tag:cipher.getAuthTag().toString('base64')});
    if(Buffer.byteLength(envelope)>LIMITS.envelopeBytes)refuse('sealing_refused');
    return envelope;
  }finally{key.fill(0);frame.fill(0);bytes.fill(0);}
}

const decodeBase64=(value,length)=>{
  if(typeof value!=='string'||value.length!==4*Math.ceil(length/3)||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))refuse('decode_refused');
  const bytes=Buffer.from(value,'base64');if(bytes.length!==length||bytes.toString('base64')!==value)refuse('decode_refused');return bytes;
};
export function decodeEnvelope(envelope,{privateKey,expectedContext}){
  try{
    if(typeof envelope!=='string'||Buffer.byteLength(envelope)>LIMITS.envelopeBytes||!envelope.startsWith('CORE_USAGE_V1 ')||/[\r\n]/.test(envelope))refuse('decode_refused');
    const encoded=envelope.slice(14),data=JSON.parse(encoded),context=checkedContext(expectedContext);
    if(!keys(data,['v','context','wrapped','nonce','ciphertext','tag'])||data.v!==1||JSON.stringify(data)!==encoded||
      JSON.stringify(data.context)!==JSON.stringify(context))refuse('decode_refused');
    const recipient=createPrivateKey(privateKey);
    if(recipient.asymmetricKeyType!=='rsa'||recipient.asymmetricKeyDetails.modulusLength!==4096||
      fingerprint(recipient)!==context.recipient)refuse('decode_refused');
    const key=privateDecrypt({key:recipient,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256',oaepLabel:LABEL},decodeBase64(data.wrapped,512));
    let frame;
    try{
      if(key.length!==32)refuse('decode_refused');
      const decipher=createDecipheriv('aes-256-gcm',key,decodeBase64(data.nonce,12),{authTagLength:16});
      decipher.setAAD(Buffer.from(JSON.stringify(context)));decipher.setAuthTag(decodeBase64(data.tag,16));
      frame=Buffer.concat([decipher.update(decodeBase64(data.ciphertext,LIMITS.frameBytes)),decipher.final()]);
      const length=frame.readUInt32BE();if(length<2||length>LIMITS.frameBytes-4||frame.subarray(4+length).some(byte=>byte!==0))refuse('decode_refused');
      const json=new TextDecoder('utf-8',{fatal:true}).decode(frame.subarray(4,4+length)),projection=JSON.parse(json);
      if(JSON.stringify(projection)!==json)refuse('decode_refused');
      return checkedProjection(projection,context);
    }finally{key.fill(0);frame?.fill(0);}
  }catch{refuse('decode_refused');}
}

// Authentication is confined to three fixed non-invoking GETs. Per-fact
// refusals stay inside the encrypted projection; raw provider objects do not.
export async function observeUsage({account,token,context,publicKey=RECIPIENT_PUBLIC_KEY,fetcher=globalThis.fetch,timeoutMs=LIMITS.timeoutMs,utcNow=()=>new Date().toISOString()}){
  if(!/^[a-f0-9]{32}$/.test(account||'')||typeof token!=='string'||!token||token.length>4096||/[\r\n]/.test(token))return {classification:'credentials_unavailable'};
  if(typeof fetcher!=='function'||typeof utcNow!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<1)return {classification:'invalid_invocation'};
  try{context=checkedContext(context);if(fingerprint(publicKey)!==context.recipient)refuse('context_refused');}catch{return {classification:'context_refused'};}
  const controller=new AbortController(),duration=Math.min(timeoutMs,LIMITS.timeoutMs),deadline=performance.now()+duration;
  let timer,total=0,requests=0,globalLimit=false,rateLimited=false;
  const active=()=>{
    if(controller.signal.aborted||performance.now()>=deadline){controller.abort();refuse('timeout');}
    const utc=utcNow();
    if(typeof utc!=='string'||utc.slice(0,10)!==context.day)refuse('day_changed');
  };
  const expired=new Promise(done=>{timer=setTimeout(()=>{controller.abort();done({classification:'timeout'});},duration);});
  const cancel=body=>{try{body?.cancel().catch(()=>{});}catch{}};
  const read=async url=>{
    active();if(rateLimited)refuse('rate_limited');
    if(globalLimit||++requests>LIMITS.requests){globalLimit=true;refuse('response_limit');}
    const response=await fetcher(url,{method:'GET',redirect:'error',credentials:'omit',signal:controller.signal,
      headers:{Authorization:'Bearer '+token,Accept:'application/json'}});
    try{active();}catch(error){cancel(response.body);throw error;}
    if(!response.ok){if(response.status===429)rateLimited=true;cancel(response.body);refuse(response.status===401||response.status===403?'denied':response.status===429?'rate_limited':'unavailable');}
    if(response.redirected||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')||'')){cancel(response.body);refuse('response_invalid');}
    const length=response.headers.get('content-length');
    if(length!==null&&(!/^\d+$/.test(length)||Number(length)>LIMITS.responseBytes)){globalLimit=true;cancel(response.body);refuse('response_limit');}
    let reader;
    try{
      reader=response.body.getReader();const chunks=[];let bytes=0,count=0;
      for(;;){
        active();const chunk=await reader.read();active();if(chunk.done)break;
        if(!(chunk.value instanceof Uint8Array)||!chunk.value.byteLength)refuse('response_invalid');
        if(++count>LIMITS.responseChunks){globalLimit=true;refuse('response_limit');}
        if(total+chunk.value.byteLength>LIMITS.totalBytes){globalLimit=true;refuse('response_limit');}
        if(bytes+chunk.value.byteLength>LIMITS.responseBytes){globalLimit=true;refuse('response_limit');}
        bytes+=chunk.value.byteLength;total+=chunk.value.byteLength;chunks.push(chunk.value);
      }
      let data;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{refuse('response_invalid');}
      active();return data;
    }catch(error){if(reader){try{reader.cancel().catch(()=>{});}catch{}}throw error;}
    finally{try{reader?.releaseLock();}catch{}}
  };
  const fact=async action=>{try{return await action();}catch(error){active();return error instanceof Refusal&&FACT_STATUS.has(error.classification)?error.classification:'unavailable';}};
  try{
    return await Promise.race([expired,(async()=>{
      try{
        active();const window=interval(context.day),projection={v:1,day:context.day,capturedAt:utcNow(),binding:'unknown',
          namespace:{status:'unknown',backend:'unknown'},usage:{status:'unknown',...window,records:[]},
          metricSemantics:'unknown',completeness:'unknown',quota:'unknown',plan:'unknown',catalog:'unknown',objectStorage:'unknown',retainedBounds:'unknown'};
        const namespace=await fact(async()=>checkedHubs(await read(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${TARGET.worker}/settings`)));
        if(/^[a-f0-9]{32}$/.test(namespace)){
          projection.binding='validated';
          const metadata=await fact(async()=>checkedNamespace(await read(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/durable_objects/namespaces?page=1&per_page=100`),namespace));
          projection.namespace=typeof metadata==='string'?{status:metadata,backend:'unknown'}:metadata;
          if(!globalLimit&&!rateLimited){
            const usage=await fact(async()=>checkedUsage(await read(`https://api.cloudflare.com/client/v4/accounts/${account}/billable/usage?from=${context.day}&to=${context.day}`),account,context.day,[account,token,namespace]));
            projection.usage=typeof usage==='string'?{status:usage,...window,records:[]}:usage;
          }else projection.usage.status=rateLimited?'rate_limited':'response_limit';
        }else projection.binding=namespace;
        active();projection.capturedAt=utcNow();checkedProjection(projection,context);active();
        const envelope=encryptProjection(projection,context,{publicKey});active();
        return {classification:'observation_sealed',envelope};
      }catch(error){return {classification:error instanceof Refusal&&PUBLIC_STATUS.has(error.classification)?error.classification:'sealing_refused'};}
    })()]);
  }finally{clearTimeout(timer);controller.abort();}
}

const externalPrivatePath=path=>{
  path=resolve(path);if(realpathSync(dirname(path))!==dirname(path))refuse('decode_refused');
  for(let cursor=dirname(path),depth=0;depth<64;depth++){
    const marker=resolve(cursor,'.git');
    let markerStat;try{markerStat=lstatSync(marker);}catch(error){if(error.code!=='ENOENT')throw error;}
    // Some sandboxes expose empty read-only .git placeholders at workspace
    // roots. A real worktree has a gitdir file or a directory with HEAD.
    if(markerStat&&(markerStat.isFile()||markerStat.isSymbolicLink()||existsSync(resolve(marker,'HEAD'))))refuse('decode_refused');
    // A bare repository is its own Git directory and has no .git marker.
    if(existsSync(resolve(cursor,'HEAD'))&&existsSync(resolve(cursor,'objects')))refuse('decode_refused');
    const parent=dirname(cursor);if(parent===cursor)return path;cursor=parent;
  }
  refuse('decode_refused');
};
const privateFile=path=>{
  path=externalPrivatePath(path);const stat=lstatSync(path);
  if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o777)!==0o600||stat.size>16384||
    (lstatSync(dirname(path)).mode&0o077)!==0)refuse('decode_refused');
  return readFileSync(path);
};
export function writeDecodedProjection(path,projection,expectedContext){
  checkedProjection(projection,checkedContext(expectedContext));
  path=externalPrivatePath(path);const parent=lstatSync(dirname(path));
  if(!parent.isDirectory()||(parent.mode&0o077)!==0||existsSync(path))refuse('decode_refused');
  const temporary=resolve(dirname(path),'.'+basename(path)+'.'+randomBytes(12).toString('hex'));
  let fd;
  try{fd=openSync(temporary,'wx',0o600);writeFileSync(fd,JSON.stringify(projection)+'\n');closeSync(fd);fd=undefined;linkSync(temporary,path);}
  catch{refuse('decode_refused');}finally{if(fd!==undefined)closeSync(fd);if(existsSync(temporary))unlinkSync(temporary);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const mode=process.argv[2],account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;delete process.env.CLOUDFLARE_API_TOKEN;
  let output='invalid_invocation',envelope,okay=false;
  try{
    if(mode==='decode'){
      if(process.argv.length!==7||process.env.GITHUB_ACTIONS==='true'||account||token)refuse('decode_refused');
      const expectedContext=checkedContext(JSON.parse(privateFile(process.argv[4])));
      if(expectedContext.recipient!==RECIPIENT_FINGERPRINT)refuse('decode_refused');
      const projection=decodeEnvelope(file(process.argv[3]).toString().replace(/\n$/,''),{privateKey:privateFile(process.argv[5]),expectedContext});
      writeDecodedProjection(process.argv[6],projection,expectedContext);output='decode_verified';okay=true;
    }else{
      if(process.argv.length!==3||!['verify','read'].includes(mode))refuse('invalid_invocation');
      const head=git(process.cwd(),'rev-parse','HEAD');
      if(mode==='read'||process.env.GITHUB_ACTIONS==='true'){
        output='context_refused';const event=JSON.parse(file(process.env.GITHUB_EVENT_PATH));
        if(!authorizedContext(process.env,head,event))refuse('context_refused');
      }
      output='checkout_refused';checkedReleaseHead(process.cwd(),head);
      if(mode==='verify'){
        if(account||token)refuse('invalid_invocation');output='checkout_verified';okay=true;
      }else{
        const context=checkedContext({v:1,repository:TARGET.repository,head,runId:process.env.GITHUB_RUN_ID,attempt:1,
          job:process.env.GITHUB_JOB,day:new Date().toISOString().slice(0,10),recipient:RECIPIENT_FINGERPRINT,queryHash:QUERY_HASH});
        const observation=await observeUsage({account,token,context});output=observation.classification;envelope=observation.envelope;
        okay=output==='observation_sealed';
      }
    }
  }catch(error){output=error instanceof Refusal&&PUBLIC_STATUS.has(error.classification)?error.classification:mode==='decode'?'decode_refused':output;}
  console.log(output);if(envelope)console.log(envelope);if(!okay)process.exitCode=1;
}
