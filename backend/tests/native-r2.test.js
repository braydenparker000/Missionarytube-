import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {nativeMusic} from '../music-upload.js';
import {LIBRARY_KEY,validateLibrary,libraryMapping,restoreLibrarySnapshot,signatureMessage} from '../../frontend/drawercast/r2-library.js';
import {r2Tracks,commitR2Catalog} from '../../frontend/drawercast/r2-api.js';
const api='https://jarvis-hub-api.braydenparker999.workers.dev',origin='https://missionarytube.z13.web.core.windows.net';
const sha=b=>createHash('sha256').update(b).digest('hex');
const audio=Buffer.concat([Buffer.from('OggS'),Buffer.alloc(24),Buffer.from('OpusHead'),Buffer.alloc(32)]);
const art=Buffer.from([137,80,78,71,13,10,26,10,0]);
function fixture(){
  const keys=generateKeyPairSync('ed25519'),pub=keys.publicKey.export({type:'spki',format:'der'}).subarray(-32).toString('hex');
  const objects=new Map(),calls=[];let serial=0,conflicts=0;
  function stored(key,bytes,options={}){bytes=Buffer.from(bytes);const etag=sha(bytes).slice(0,32);
    return {key,bytes,size:bytes.length,etag,httpEtag:'"'+etag+'"',uploaded:new Date(1700000000000+(++serial)*1000),customMetadata:options.customMetadata||{},httpMetadata:options.httpMetadata||{}};}
  objects.set(LIBRARY_KEY,stored(LIBRARY_KEY,JSON.stringify({version:1,kind:'r2-library',complete:true,count:0,generatedAt:new Date().toISOString(),tracks:[]})));
  const bucket={async head(k){calls.push(['head',k]);return objects.get(k)||null;},async get(k,options={}){
    calls.push(['get',k]);const o=objects.get(k);if(!o)return null;if(options.onlyIf&&options.onlyIf.etagMatches!==o.etag)return {...o};
    let b=o.bytes;if(options.range)b=b.subarray(options.range.offset,options.range.offset+options.range.length);
    return {...o,body:new Response(b).body};},async put(k,b,options={}){
    calls.push(['put',k]);if(k===LIBRARY_KEY&&conflicts){conflicts--;return null;}
    const old=objects.get(k);if(options.onlyIf instanceof Headers&&options.onlyIf.get('If-None-Match')==='*'&&old)return null;
    if(options.onlyIf?.etagMatches!==undefined&&old?.etag!==options.onlyIf.etagMatches)return null;
    const o=stored(k,b,options);objects.set(k,o);return o;}};
  const env={MUSIC_R2:bucket,MUSIC_PUBLIC_READ:'true',MUSIC_UPLOAD_PUBLIC_KEYS:JSON.stringify([pub])};
  function request(path,body,method='PUT',type='audio/ogg',change={}){
    const time=String(Math.floor(Date.now()/1000)),hash=sha(body),size=String(body.length);
    const sig=sign(null,Buffer.from(signatureMessage({method,origin:api,path,type,hash,size,time,key:pub})),keys.privateKey).toString('hex');
    return new Request(api+path,{method,body,headers:{'Content-Type':type,'X-Music-Public-Key':pub,'X-Music-Timestamp':time,
      'X-Music-Size':size,'X-Music-Sha256':hash,'X-Music-Signature':sig,...change}});
  }
  const send=(path,b,m,t,c)=>nativeMusic(request(path,b,m,t,c),env);
  async function putAudio(b=audio){const r=await send('/music/uploads/audio/'+sha(b)+'.opus',b);assert.equal(r.status,200);return r.json();}
  function registration(b=audio,extra={}){return Buffer.from(JSON.stringify({sha256:sha(b),size:b.length,name:'Ready.opus',metadata:{title:'Ready',artist:'Artist',album:'Album',dur:10,codec:'Opus'},...extra}));}
  const register=b=>send('/music/uploads/register',b,'POST','application/json');
  const get=(path,h={},method='GET')=>nativeMusic(new Request(api+path,{method,headers:{Origin:origin,...h}}),env);
  return {env,objects,calls,pub,request,send,putAudio,register,registration,get,conflict:()=>{conflicts=1;}};
}
test('upload rejects unregistered, tampered, stale and cross-destination signatures before R2',async()=>{
  const f=fixture(),path='/music/uploads/audio/'+sha(audio)+'.opus';
  for(const changes of [{'X-Music-Public-Key':'a'.repeat(64)},{'X-Music-Timestamp':'1700000000'},
    {'X-Music-Sha256':'a'.repeat(64)},{'Content-Type':'image/png'},{'X-Music-Size':'100'},{'X-Music-Signature':'0'.repeat(128)}]){
    assert.equal((await f.send(path,audio,'PUT','audio/ogg',changes)).status,401);assert.equal(f.calls.length,0);
  }
  f.env.MUSIC_UPLOAD_PUBLIC_KEYS='[]';assert.equal((await f.send(path,audio)).status,401);assert.equal(f.calls.length,0);
});
test('blobs stay invisible until verified audio and artwork registration; retries are idempotent',async()=>{
  const f=fixture();await f.putAudio();
  assert.equal((await (await f.get('/music/library.json')).json()).count,0);
  const cover={sha256:sha(art),size:art.length,ext:'png'},body=f.registration(audio,{cover});
  assert.equal((await f.register(body)).status,409);
  assert.equal((await f.send('/music/uploads/art/'+sha(art)+'.png',art,'PUT','image/png')).status,200);
  const first=await (await f.register(body)).json();assert.equal(first.registered,true);assert.equal(first.duplicate,false);
  await f.putAudio();const second=await (await f.register(body)).json();assert.equal(second.duplicate,true);assert.equal(second.id,first.id);assert.equal(second.count,1);
  const index=await (await f.get('/music/library.json')).json();assert.equal(index.count,1);validateLibrary(index);
  const {mapping,tracks}=libraryMapping(index,api+'/music/library.json');assert.ok(mapping.matches(tracks));
  assert.equal(tracks[0].source,'r2');assert.equal(tracks[0].coverURL,api+'/music/library/art/'+first.id);
  assert.equal(mapping.mediaURL({...tracks[0],sha256:'a'.repeat(64)}),null);
});
test('content-addressed PUT cannot overwrite existing data and registration survives a CAS conflict',async()=>{
  const f=fixture();await f.putAudio();f.conflict();
  assert.equal((await f.register(f.registration())).status,200);
  assert.equal(f.calls.filter(c=>c[0]==='put'&&c[1]===LIBRARY_KEY).length,2);
  const key='native/audio/'+sha(audio)+'.opus';f.objects.get(key).customMetadata['verified-sha256']='a'.repeat(64);
  assert.equal((await f.send('/music/uploads/audio/'+sha(audio)+'.opus',audio)).status,409);
  assert.equal((await f.get('/music/library/audio/r2_native_'+sha(audio))).status,503);
});
test('valid signatures cannot publish altered, oversized, malformed or incomplete bodies',async()=>{
  const f=fixture(),path='/music/uploads/audio/'+sha(audio)+'.opus',signed=f.request(path,audio);
  const changed=Buffer.from(audio);changed[changed.length-1]=1;
  assert.equal((await nativeMusic(new Request(signed.url,{method:'PUT',headers:signed.headers,body:changed}),f.env)).status,422);
  assert.equal((await nativeMusic(new Request(signed.url,{method:'PUT',headers:signed.headers,body:Buffer.concat([audio,Buffer.from('overflow')])}),f.env)).status,413);
  assert.equal(f.calls.length,0);
  assert.equal((await f.register(Buffer.from('{}'))).status,422);
  assert.equal((await f.register(f.registration())).status,409);
  assert.equal((await (await f.get('/music/library.json')).json()).count,0);
});
test('different concurrent registrations preserve both songs',async()=>{
  const f=fixture(),b=Buffer.concat([audio,Buffer.from('second')]);await f.putAudio();await f.putAudio(b);
  const responses=await Promise.all([f.register(f.registration()),f.register(f.registration(b))]);
  assert.ok(responses.every(r=>r.status===200));const index=await (await f.get('/music/library.json')).json();
  assert.equal(index.count,2);assert.equal(new Set(index.tracks.map(t=>t.sha256)).size,2);
});
test('native audio supports actual byte ranges, ETags and artwork; changed identities fail closed',async()=>{
  const f=fixture();await f.putAudio();await f.send('/music/uploads/art/'+sha(art)+'.png',art,'PUT','image/png');
  await f.register(f.registration(audio,{cover:{sha256:sha(art),size:art.length,ext:'png'}}));
  const path='/music/library/audio/r2_native_'+sha(audio);
  const full=await f.get(path);assert.equal(full.status,200);assert.deepEqual(Buffer.from(await full.arrayBuffer()),audio);
  const etag=full.headers.get('ETag');assert.equal((await f.get(path,{'If-None-Match':etag})).status,304);
  const range=await f.get(path,{Range:'bytes=2-5'});assert.equal(range.status,206);assert.deepEqual(Buffer.from(await range.arrayBuffer()),audio.subarray(2,6));
  assert.equal(range.headers.get('Content-Range'),'bytes 2-5/'+audio.length);assert.equal(range.headers.get('Access-Control-Allow-Origin'),origin);
  assert.equal((await f.get(path,{Range:'bytes=99999-'})).status,416);
  assert.equal((await f.get(path,{Range:'bytes=2-5'},'HEAD')).headers.get('Content-Length'),String(audio.length));
  const cover=await f.get('/music/library/art/r2_native_'+sha(audio));assert.equal(cover.status,200);assert.deepEqual(Buffer.from(await cover.arrayBuffer()),art);
  f.objects.get('native/audio/'+sha(audio)+'.opus').uploaded=new Date();assert.equal((await f.get(path)).status,503);
  assert.equal((await f.get(path,{Origin:'https://evil.example'})).status,403);
});
test('repeated range and catalog reads reuse validation but still check live catalog and media identities',async()=>{
  const f=fixture();await f.putAudio();await f.register(f.registration());f.calls.length=0;
  const path='/music/library/audio/r2_native_'+sha(audio);
  for(let i=0;i<4;i++){
    const r=await f.get(path,{Range:'bytes=2-5'});assert.equal(r.status,206);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()),audio.subarray(2,6));
    assert.equal((await (await f.get('/music/library.json')).json()).count,1);
  }
  assert.equal(f.calls.filter(c=>c[0]==='get'&&c[1]===LIBRARY_KEY).length,1);
  assert.equal(f.calls.filter(c=>c[0]==='head'&&c[1]===LIBRARY_KEY).length,8);
  assert.equal(f.calls.filter(c=>c[0]==='head'&&c[1].startsWith('native/audio/')).length,4);
  f.objects.get('native/audio/'+sha(audio)+'.opus').customMetadata.verification='altered';
  assert.equal((await f.get(path)).status,503);
});
test('a cached catalog immediately sees registration and removal; an invalid replacement or deletion keeps the last valid one, reported',async()=>{
  const f=fixture();await f.putAudio();await f.register(f.registration());
  const first=await (await f.get('/music/library.json')).json(),path='/music/library/audio/'+first.tracks[0].id;
  const b=Buffer.concat([audio,Buffer.from('later upload')]);await f.putAudio(b);await f.register(f.registration(b));
  assert.equal((await (await f.get('/music/library.json')).json()).count,2);
  const latest=await (await f.get('/music/library.json')).json();latest.tracks.shift();latest.count=1;
  await f.env.MUSIC_R2.put(LIBRARY_KEY,JSON.stringify(latest));
  assert.equal((await f.get(path)).status,404);
  latest.count=99;await f.env.MUSIC_R2.put(LIBRARY_KEY,JSON.stringify(latest));
  const kept=await f.get('/music/library.json');
  assert.equal(kept.status,200);assert.equal(kept.headers.get('X-Music-Catalog'),'last-good');assert.equal((await kept.json()).count,1);
  assert.equal((await f.get('/music/library/audio/'+latest.tracks[0].id)).status,200,'music keeps playing');
  assert.equal((await f.get(path)).status,404,'what the last valid catalog removed stays removed');
  let health=await (await f.get('/music/health')).json();
  assert.deepEqual([health.ok,health.servingLastGood,health.problem.reason,health.catalog.count],[false,true,'The stored catalog is invalid',1]);
  // A fresh Worker (no memory) finds the copy the last valid catalog left in R2.
  const fresh={...f.env,MUSIC_R2:{...f.env.MUSIC_R2}};
  const cold=await nativeMusic(new Request(api+'/music/library.json',{headers:{Origin:origin}}),fresh);
  assert.equal(cold.status,200);assert.equal(cold.headers.get('X-Music-Catalog'),'last-good');assert.equal((await cold.json()).count,1);
  f.objects.delete(LIBRARY_KEY);assert.equal((await f.get('/music/library.json')).status,200,'a deleted catalog too');
  latest.count=1;await f.env.MUSIC_R2.put(LIBRARY_KEY,JSON.stringify(latest));
  health=await (await f.get('/music/health')).json();assert.deepEqual([health.ok,health.servingLastGood,health.problem],[true,false,null]);
  assert.equal((await f.get('/music/library.json')).headers.get('X-Music-Catalog'),null,'a valid catalog is served again');
  // With no valid catalog ever seen, there is nothing to fall back to.
  const empty=fixture();await empty.env.MUSIC_R2.put(LIBRARY_KEY,'{"broken":');
  assert.equal((await empty.get('/music/library.json')).status,503);
  assert.equal((await empty.get('/music/health')).status,503);
});

test('phones download a light index: waveforms come per track, and an unchanged index costs a 304',async()=>{
  const f=fixture();await f.putAudio();await f.register(f.registration());
  // Waveforms are written into the stored catalog (today by Muse, directly).
  const stored=JSON.parse(f.objects.get(LIBRARY_KEY).bytes.toString());
  const bars=Buffer.from(Array.from({length:500},(_,i)=>i%256));stored.tracks[0].metadata.waveform=bars.toString('base64');
  await f.env.MUSIC_R2.put(LIBRARY_KEY,JSON.stringify(stored));
  const res=await f.get('/music/library.json'),etag=res.headers.get('ETag'),index=await res.json(),t=index.tracks[0];
  assert.equal(t.metadata.waveform,undefined);assert.equal(t.waveformBars,true);validateLibrary(index);
  assert.equal(res.headers.get('Cache-Control'),'no-cache');assert.match(etag,/^"[^"]+-p1"$/);
  assert.equal((await f.get('/music/library.json',{'If-None-Match':etag})).status,304);
  const wave=await f.get('/music/library/waveform/'+t.id);
  assert.equal(wave.status,200);assert.equal(wave.headers.get('Content-Type'),'application/octet-stream');
  assert.deepEqual(Buffer.from(await wave.arrayBuffer()),bars);
  assert.equal((await f.get('/music/library/waveform/'+t.id,{'If-None-Match':wave.headers.get('ETag')})).status,304);
  assert.equal((await f.get('/music/library/waveform/r2_native_'+'f'.repeat(64))).status,404);
  const health=await (await f.get('/music/health')).json();
  assert.deepEqual([health.ok,health.catalog.count,health.catalog.waveforms],[true,1,1]);
  assert.ok(health.catalog.publicBytes<f.objects.get(LIBRARY_KEY).size);
});
test('catalog cache is isolated by storage binding and fails closed on replacement between HEAD and GET',async()=>{
  const f=fixture(),other=fixture();await f.putAudio();await f.register(f.registration());
  assert.equal((await (await f.get('/music/library.json')).json()).count,1);
  assert.equal((await (await other.get('/music/library.json')).json()).count,0);
  const old=other.env.MUSIC_R2.head;let replace=true;
  other.env.MUSIC_R2.head=async k=>{const h=await old(k);if(k===LIBRARY_KEY&&replace){replace=false;await other.env.MUSIC_R2.put(k,JSON.stringify({version:1,kind:'r2-library',complete:true,count:0,generatedAt:'2026-10-03T00:00:00Z',tracks:[]}));}return h;};
  // Force a cold load of the first replacement before the race above.
  await other.env.MUSIC_R2.put(LIBRARY_KEY,JSON.stringify({version:1,kind:'r2-library',complete:true,count:0,generatedAt:'2026-10-02T00:00:00Z',tracks:[]}));
  assert.equal((await other.get('/music/library.json')).status,503);
  assert.equal((await (await other.get('/music/library.json')).json()).generatedAt,'2026-10-03T00:00:00Z');
  other.objects.get(LIBRARY_KEY).size=16*1024*1024+1;
  const over=await other.get('/music/library.json');
  assert.equal(over.status,200,'an oversized catalog keeps the last valid one');assert.equal(over.headers.get('X-Music-Catalog'),'last-good');
  assert.equal((await (await other.get('/music/health')).json()).problem.reason,'The stored catalog is over the size limit');
});
test('native source preserves prior migrated track identity and source-local user state',()=>{
  const id='r2_legacyDriveID123',t={id,audioKey:'audio/legacyDriveID123/'+'b'.repeat(32)+'.opus',sha256:'a'.repeat(64),md5:'b'.repeat(32),size:64,
    mimeType:'audio/ogg',path:'Artist/Ready.opus',folder:'Cloudflare R2/Artist',metadata:{title:'Ready',artist:'Artist',dur:10},
    r2Identity:{etag:'b'.repeat(32),size:64,lastModified:new Date().toISOString()}};
  const {tracks,mapping}=libraryMapping({version:1,kind:'r2-library',complete:true,count:1,generatedAt:new Date().toISOString(),tracks:[t]},api+'/music/library.json');
  const old={...tracks[0],sha256:undefined,rating:5,plays:9,artKey:'saved',resumeAt:12};
  const result=r2Tracks(mapping,tracks,[old,{...old,id:'gd_legacyDriveID123',source:'drive',rating:1}]);
  assert.equal(result[0].id,id);assert.equal(result[0].rating,5);assert.equal(result[0].artKey,'saved');assert.equal(result[0].resumeAt,12);
  assert.equal(mapping.mediaURL({...tracks[0],source:'drive'}),null);
});

test('signed analysis upgrades bind the existing object, preserve IDs and handle CAS/idempotency/conflicts',async()=>{
  const f=fixture();await f.putAudio();await f.register(f.registration());
  const index=await (await f.get('/music/library.json')).json(),t=index.tracks[0];
  const a={version:1,sha256:t.sha256,audioBytes:t.size,gainBasis:'decoded-container-gain',decoder:'fixture FFmpeg',method:'fixture analysis',analyzedAt:new Date().toISOString(),sampleRate:48000,channels:2,integratedLufs:-12,samplePeakDbfs:0,truePeakDbtp:1,containerGainDb:0};
  const body={id:t.id,sha256:t.sha256,size:t.size,r2Identity:t.r2Identity,previousAnalysisSha256:null,audioAnalysis:a};
  const update=b=>f.send('/music/uploads/analysis',Buffer.from(JSON.stringify(b)),'POST','application/json');
  assert.equal((await update({...body,sha256:'a'.repeat(64)})).status,422);
  assert.equal((await update({...body,r2Identity:{...t.r2Identity,etag:'b'.repeat(32)}})).status,409);
  f.conflict();const r=await update(body);assert.equal(r.status,200);assert.equal((await r.json()).analysisUpdated,true);
  const updated=await (await f.get('/music/library.json')).json();assert.equal(updated.count,1);assert.equal(updated.tracks[0].id,t.id);assert.equal(updated.tracks[0].audioKey,t.audioKey);assert.deepEqual(updated.tracks[0].r2Identity,t.r2Identity);
  assert.deepEqual(updated.tracks[0].metadata.audioAnalysis,a);
  const mapped=libraryMapping(updated,api+'/music/library.json');assert.deepEqual(mapped.tracks[0].audioAnalysis,a);
  assert.equal((await (await update(body)).json()).analysisUpdated,false);
  assert.equal((await update({...body,audioAnalysis:{...a,integratedLufs:-14}})).status,409);
  const unsigned=new Request(api+'/music/uploads/analysis',{method:'POST',body:JSON.stringify(body)});assert.equal((await nativeMusic(unsigned,f.env)).status,401);
  f.objects.get(t.audioKey).uploaded=new Date();assert.equal((await update(body)).status,409);
});

test('signed duplicate analysis correction accepts the exact prior object without client JSON-number ambiguity',async()=>{
  const f=fixture();await f.putAudio();await f.register(f.registration());const t=(await (await f.get('/music/library.json')).json()).tracks[0];
  const a={version:1,sha256:t.sha256,audioBytes:t.size,gainBasis:'decoded-container-gain',decoder:'fixture',method:'fixture',analyzedAt:'2026-10-02T00:00:00Z',sampleRate:48000,channels:2,integratedLufs:-14,samplePeakDbfs:-1,truePeakDbtp:0,containerGainDb:0};
  const base={id:t.id,sha256:t.sha256,size:t.size,r2Identity:t.r2Identity,audioAnalysis:a,previousAnalysis:null};
  const update=b=>f.send('/music/uploads/analysis',Buffer.from(JSON.stringify(b)),'POST','application/json');
  assert.equal((await update(base)).status,200);
  assert.equal((await update({...base,previousAnalysis:a,audioAnalysis:{...a,integratedLufs:-13}})).status,200);
  assert.equal((await update({...base,audioAnalysis:{...a,integratedLufs:-12}})).status,409);
});

test('new partial album membership removes a stale complete-album analysis claim',async()=>{
  const f=fixture();await f.putAudio();await f.register(f.registration());let index=await (await f.get('/music/library.json')).json();const t=index.tracks[0];
  const a={version:1,sha256:t.sha256,audioBytes:t.size,gainBasis:'decoded-container-gain',decoder:'fixture',method:'fixture',analyzedAt:'2026-10-02T00:00:00Z',sampleRate:48000,channels:2,integratedLufs:-14,samplePeakDbfs:-1,truePeakDbtp:0,containerGainDb:0,album:{id:'Artist/Album',complete:true,members:[{sha256:t.sha256,size:t.size}],integratedLufs:-14,truePeakDbtp:0}};
  const body={id:t.id,sha256:t.sha256,size:t.size,r2Identity:t.r2Identity,audioAnalysis:a,previousAnalysis:null};
  assert.equal((await f.send('/music/uploads/analysis',Buffer.from(JSON.stringify(body)),'POST','application/json')).status,200);
  assert.ok((await (await f.get('/music/library.json')).json()).tracks[0].metadata.audioAnalysis.album);
  const second=Buffer.concat([audio,Buffer.from('new album member')]);await f.putAudio(second);await f.register(f.registration(second));
  index=await (await f.get('/music/library.json')).json();assert.equal(index.count,2);assert.equal(index.tracks[0].metadata.audioAnalysis.album,undefined);
});

test('cached native discovery restores only the exact endpoint and validated saved identities',async()=>{
  const f=fixture();await f.putAudio();await f.register(f.registration());
  const data=await (await f.get('/music/library.json')).json(),url=api+'/music/library.json';
  const {tracks,snapshot}=libraryMapping(data,url);
  assert.equal(restoreLibrarySnapshot(snapshot,url,tracks).mapping.mediaURL(tracks[0]),url.replace('.json','/audio/')+tracks[0].id);
  for(const changed of [{...snapshot,version:2},{...snapshot,endpoint:'https://other.test/music/library.json'},
    {...snapshot,data:{...data,complete:false}},{...snapshot,data:{...data,tracks:[{...data.tracks[0],audioKey:'native/audio/'+ 'f'.repeat(64)+'.opus'}]}}])assert.equal(restoreLibrarySnapshot(changed,url,tracks),null);
  assert.equal(restoreLibrarySnapshot(snapshot,url,[{...tracks[0],sha256:'e'.repeat(64)}]),null);
  assert.equal(restoreLibrarySnapshot(snapshot,url,[{...tracks[0],size:1}]),null);
  assert.equal(restoreLibrarySnapshot(snapshot,url,[]),null);
});
test('native catalog commit skips unchanged tracks, atomically saves discovery, and aborts on playback takeover',async()=>{
  const f=fixture();await f.putAudio();await f.register(f.registration());
  const data=await (await f.get('/music/library.json')).json();
  const {tracks,mapping,snapshot}=libraryMapping(data,api+'/music/library.json');
  const old=r2Tracks(mapping,tracks)[0];let tx,request,updates=0,saved=null;
  const db={transaction(names){assert.deepEqual(names,['tracks','kv']);tx={abort(){this.error=Error('Playback takeover');this.onabort();},objectStore(name){return name==='kv'?{put(value,key){saved={value,key};}}:{openCursor(){request={};return request;}};}};return tx;}};
  const pending=commitR2Catalog(db,mapping,tracks,{snapshot});
  let complete=false;pending.then(()=>complete=true);
  request.result={key:old.id,value:old,update(){updates++;},continue(){request.result=null;request.onsuccess();}};request.onsuccess();
  await Promise.resolve();assert.equal(complete,false);assert.equal(updates,0);assert.deepEqual(saved,{value:snapshot,key:'r2-native-snapshot'});
  tx.oncomplete();assert.equal((await pending).fresh.length,1);
  const rejected=commitR2Catalog(db,mapping,tracks,{snapshot,valid:()=>false});request.onsuccess();await assert.rejects(rejected,/Playback takeover/);
});

test('native dates use verified upload time through stale saved state, refresh and offline snapshot',async()=>{
  const f=fixture();await f.putAudio();await f.register(f.registration());
  const data=await (await f.get('/music/library.json')).json(),url=api+'/music/library.json';
  const expected=Date.parse(data.tracks[0].r2Identity.lastModified);
  const {tracks,mapping,snapshot}=libraryMapping(data,url);
  assert.equal(tracks[0].added,expected);assert.equal(tracks[0].addedSource,'r2-upload');
  const old={...tracks[0],added:Date.now(),rating:5,plays:8,resumeAt:4,customArt:true,artKey:'saved'};
  const merged=r2Tracks(mapping,tracks,[old])[0];
  assert.equal(merged.added,expected);assert.equal(merged.rating,5);assert.equal(merged.plays,8);assert.equal(merged.resumeAt,4);assert.equal(merged.artKey,'saved');
  assert.equal(restoreLibrarySnapshot(snapshot,url,[old]).tracks[0].added,expected);
  let tx,request,updated;
  const db={transaction(){tx={objectStore(){return {openCursor(){request={};return request;}};}};return tx;}};
  const committed=commitR2Catalog(db,mapping,tracks);
  request.result={key:old.id,value:old,update(t){updated=t;},continue(){request.result=null;request.onsuccess();}};
  request.onsuccess();tx.oncomplete();
  assert.equal((await committed).fresh[0].added,expected);assert.equal(updated.added,expected);assert.equal(updated.rating,5);
  data.generatedAt='2030-01-01T00:00:00Z';assert.equal(libraryMapping(data,url).tracks[0].added,expected);
});
