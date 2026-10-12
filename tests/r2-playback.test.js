import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {MAX_R2_MANIFEST_BYTES, readR2Manifest, validateR2Manifest, r2Tracks, commitR2Catalog} from '../public/drawercast/r2-api.js';
import {catalogTrack} from '../public/drawercast/drive-catalog.js';

const root = 'musicFolder12345', url = 'https://music.example.test/catalog/drive-r2-map-v1.json';
const verification = 'r2-get-hash-v1';
function fixture() {
  const files = ['driveSong12345', 'driveSong67890'].map((driveId, i) => {
    const md5 = String(i + 1).repeat(32), sha256 = String(i + 3).repeat(64);
    const key = `audio/${driveId}/${md5}.opus`, size = (i + 1) * 320;
    return {driveId, size, md5, sourceMd5:md5, sha256, key, url:'https://music.example.test/' + key,
      mimeType:'audio/ogg', status:i ? 'skipped' : 'copied', verifiedBytes:size, verification};
  });
  const data = {version:1, mode:'full', complete:true, verification, driveRootId:root,
    generatedAt:'2026-10-01T00:00:00Z', publicBaseUrl:'https://music.example.test',
    inventoryCount:2, selectedCount:2, verifiedCount:2, inventoryBytes:960,
    failedCount:0, failures:[], copiedCount:1, skippedCount:1, files};
  const tracks = files.map(file => ({id:'gd_' + file.driveId, remoteId:file.driveId, driveFolder:root,
    source:'drive', remote:true, size:file.size, md5:file.md5, mimeType:file.mimeType, path:'Music/song.opus',
    title:'Prepared title', album:'Prepared album', rating:5, plays:17, artKey:'user-cover', customArt:true, coverURL:'/assets/cover.jpg'}));
  return {data, tracks, options:{root, manifestURL:url, tracks}};
}
const validate = f => validateR2Manifest(f.data, f.options);
const partialURL = 'https://music.example.test/music/partial/manifest.json';
function partialFixture() {
  const f = fixture();
  Object.assign(f.data, {mode:'partial', complete:false, sourceRevision:'a'.repeat(64),
    publicBaseUrl:'https://music.example.test/music/partial', selectedCount:1, verifiedCount:1,
    copiedCount:1, skippedCount:0, verifiedBytesTotal:320, files:f.data.files.slice(0, 1)});
  f.data.files[0].url = f.data.publicBaseUrl + '/' + f.data.files[0].key;
  f.options.manifestURL = partialURL;
  return f;
}

test('complete content-verified maps validate playback without changing catalog metadata', () => {
  const f = fixture(), before = structuredClone(f.tracks), map = validate(f);
  assert.equal(map.count, 2); assert.equal(map.mediaURL(f.tracks[0]), f.data.files[0].url);
  assert.deepEqual(f.tracks, before); assert.equal(Object.isFrozen(map), true);
  f.data.files[0].url = 'https://other.test/injected';
  assert.notEqual(map.mediaURL(f.tracks[0]), f.data.files[0].url, 'validated values are copied');
});

test('smoke, partial, failed, unverified and wrong-root manifests cannot activate R2', () => {
  for (const change of [
    d => {d.mode = 'smoke';}, d => {d.mode = 'partial';d.complete = false;}, d => {delete d.complete;}, d => {d.version = 2;},
    d => {d.driveRootId = 'anotherFolder123';}, d => {d.verification = 'head-only';},
    d => {d.inventoryCount++;}, d => {d.selectedCount--;}, d => {d.verifiedCount--;},
    d => {d.inventoryBytes--;}, d => {d.failedCount = 1;}, d => {d.failures = [{}];},
    d => {d.copiedCount++;}, d => {d.skippedCount--;}, d => {d.generatedAt = 'invalid';},
    d => {d.files.pop();}, d => {d.files[1] = {...d.files[0]};}
  ]) {
    const f = fixture(); change(f.data); assert.throws(() => validate(f), /complete, verified/);
  }
});

test('explicit partial manifests keep the full catalog and expose only verified playback URLs', () => {
  const f = partialFixture(), before = structuredClone(f.tracks), map = validate(f);
  assert.equal(map.count, 1); assert.equal(map.mode, 'partial'); assert.equal(map.complete, false);
  assert.equal(map.matches(f.tracks), true);
  assert.equal(map.mediaURL(f.tracks[0]), f.data.files[0].url);
  assert.equal(map.mediaURL(f.tracks[1]), null, 'unmapped catalog songs are excluded from R2');
  assert.deepEqual(f.tracks, before);
  f.data.complete = true; f.data.mode = 'full'; f.data.files[0].url = 'https://other.test/injected';
  assert.equal(map.complete, false); assert.equal(map.mode, 'partial');
  assert.notEqual(map.mediaURL(f.tracks[0]), f.data.files[0].url);
});

test('partial playback requires its dedicated configured endpoint, exact media prefix and explicit mode', () => {
  for (const endpoint of [url, 'https://music.example.test/music/manifest.json',
    partialURL + '/', partialURL + '?partial=true', 'https://music.example.test/music/smoke/manifest.json']) {
    const f = partialFixture(); f.options.manifestURL = endpoint; assert.throws(() => validate(f));
  }
  for (const change of [
    d => {d.mode = 'full';d.complete = true;}, d => {d.mode = 'smoke';},
    d => {d.complete = true;}, d => {delete d.complete;},
    d => {d.publicBaseUrl = 'https://music.example.test/music';},
    d => {d.publicBaseUrl += '/';}, d => {d.files[0].url = d.files[0].url.replace('/partial/', '/');}
  ]) {const f = partialFixture(); change(f.data); assert.throws(() => validate(f));}
});

test('partial manifests require successful counts, inventory bounds and actual verified byte totals', () => {
  for (const change of [
    d => {d.inventoryCount = 0;}, d => {d.inventoryCount = 1.5;}, d => {d.inventoryCount = 50001;},
    d => {d.selectedCount++;}, d => {d.verifiedCount++;}, d => {d.copiedCount++;}, d => {d.skippedCount++;},
    d => {d.failedCount = 1;}, d => {d.failures = [{}];}, d => {d.files = [];},
    d => {d.inventoryBytes = 319;}, d => {d.inventoryBytes = '960';},
    d => {delete d.verifiedBytesTotal;}, d => {d.verifiedBytesTotal--;}, d => {d.verifiedBytesTotal++;},
    d => {delete d.sourceRevision;}, d => {d.sourceRevision = 'unverified';},
    d => {d.files.push({...d.files[0]});d.selectedCount++;d.verifiedCount++;d.copiedCount++;d.verifiedBytesTotal *= 2;}
  ]) {const f = partialFixture(); change(f.data); assert.throws(() => validate(f));}
});

test('partial file proofs and source identity remain as strict as full manifests', () => {
  for (const change of [
    file => {file.sourceMd5 = '9'.repeat(32);}, file => {file.sha256 = '';},
    file => {file.verification = 'head-only';}, file => {file.verifiedBytes--;},
    file => {file.status = 'failed';}, file => {file.key = file.key.replace(file.md5, '9'.repeat(32));},
    file => {file.url += '?key=secret';}, file => {file.url = file.url.replace('music.example.test', 'other.test');}
  ]) {const f = partialFixture(); change(f.data.files[0]); assert.throws(() => validate(f));}
  for (const change of [
    t => {t.id = 'other_id';}, t => {t.remoteId = 'otherSong12345';}, t => {t.size++;},
    t => {t.md5 = '9'.repeat(32);}, t => {t.driveFolder = 'anotherFolder123';}, t => {t.source = 'server';}
  ]) {const f = partialFixture(); change(f.tracks[0]); assert.throws(() => validate(f));}
});

test('partial libraries allow new unmapped tracks but reject removed, duplicated or changed mapped tracks', () => {
  const f = partialFixture(), map = validate(f);
  const added = {...f.tracks[1], id:'gd_newSong12345', remoteId:'newSong12345'};
  assert.equal(map.matches([...f.tracks, added]), true);
  assert.equal(map.mediaURL(added), null);
  assert.equal(map.matches([f.tracks[0]]), true, 'removing an unmapped song does not invalidate verified bytes');
  assert.equal(map.matches([f.tracks[1]]), false, 'mapped songs must still exist');
  assert.equal(map.matches([...f.tracks, {...f.tracks[0]}]), false);
  assert.equal(map.matches([...f.tracks, {...f.tracks[1]}]), false);
  f.tracks[0].md5 = '9'.repeat(32);
  assert.equal(map.matches(f.tracks), false); assert.equal(map.mediaURL(f.tracks[0]), null);
  const duplicate = partialFixture(); duplicate.tracks.push({...duplicate.tracks[0]});
  assert.throws(() => validate(duplicate));
});

test('a full manifest cannot become partial by supplying partial byte totals or extra catalog tracks', () => {
  const f = fixture(); f.data.verifiedBytesTotal = 320; f.data.files.pop();
  f.data.selectedCount = f.data.verifiedCount = 1; f.data.skippedCount = 0;
  assert.throws(() => validate(f));
  const full = validate(fixture());
  assert.equal(full.mode, 'full'); assert.equal(full.complete, true);
});

test('file identity, actual body hashes, byte counts and content-addressed keys are required', () => {
  for (const change of [
    f => {f.md5 = '';}, f => {f.sourceMd5 = '';}, f => {f.sourceMd5 = '9'.repeat(32);},
    f => {f.sha256 = '';}, f => {delete f.verifiedBytes;}, f => {f.verifiedBytes--;},
    f => {f.verification = 'head-only';}, f => {f.status = 'failed';},
    f => {f.size = '320';}, f => {f.size = 0;}, f => {f.mimeType = 'audio/ogg\r\nInjected: x';},
    f => {f.key = f.key.replace(f.md5, '9'.repeat(32));},
    f => {f.key = f.key.replace(f.driveId, 'otherSong12345');},
    f => {f.key = 'audio/../' + f.key;}
  ]) {
    const f = fixture(); change(f.data.files[0]); assert.throws(() => validate(f), /complete, verified/);
  }
  const f = fixture(); f.data.files[0].key = `audio/${f.data.files[0].driveId}/${f.data.files[0].sha256}.opus`;
  f.data.files[0].url = f.data.publicBaseUrl + '/' + f.data.files[0].key;
  assert.ok(validate(f).mediaURL(f.tracks[0]), 'actual SHA-256 content keys are supported');
});

test('mapping must match every catalog track by stable ID, Drive root, size and MD5', () => {
  for (const change of [
    t => {t.id = 'new_id';}, t => {t.remoteId = 'otherSong12345';}, t => {t.size++;},
    t => {t.md5 = '9'.repeat(32);}, t => {t.md5 = '';}, t => {t.driveFolder = 'otherFolder123';},
    t => {t.source = 'server';}
  ]) {
    const f = fixture(); change(f.tracks[0]); assert.throws(() => validate(f), /complete, verified/);
  }
  const f = fixture(); f.tracks[1] = {...f.tracks[0]}; assert.throws(() => validate(f), /complete, verified/);
});

test('new and changed songs fail closed, without retaining stale revision URLs', () => {
  const f = fixture(), map = validate(f);
  assert.equal(map.matches(f.tracks), true);
  assert.equal(map.matches([...f.tracks, {...f.tracks[0], remoteId:'newSong12345'}]), false);
  assert.equal(map.matches(f.tracks.slice(0, 1)), false);
  f.tracks[0].md5 = 'a'.repeat(32);
  assert.equal(map.mediaURL(f.tracks[0]), null); assert.equal(map.matches(f.tracks), false);
});

test('only explicit credential-free HTTPS URLs on the configured map origin are accepted', () => {
  const bad = [
    'http://music.example.test/catalog/map.json', '/catalog/map.json', 'javascript:alert(1)',
    'https://user:secret@music.example.test/catalog/map.json',
    'https://music.example.test/catalog/map.json?token=secret', 'https://music.example.test/catalog/map.json#secret',
    ' https://music.example.test/catalog/map.json', 'https://music.example.test\\evil/catalog/map.json'
  ];
  for (const candidate of bad) {
    const f = fixture(); f.options.manifestURL = candidate; assert.throws(() => validate(f));
  }
  for (const candidate of ['', 'http://music.example.test', 'https://other.example.test',
    'https://user:secret@music.example.test', 'https://music.example.test?token=secret']) {
    const f = fixture(); f.data.publicBaseUrl = candidate; assert.throws(() => validate(f));
  }
  for (const change of [
    f => {f.url = f.url.replace('https:', 'http:');}, f => {f.url += '?token=secret';},
    f => {f.url += '#fragment';}, f => {f.url = f.url.replace('music.example.test', 'other.example.test');},
    f => {f.url = f.url.replace('/audio/', '/other/');}, f => {f.url = f.url.replace('https://', 'https://user:pass@');}
  ]) {
    const f = fixture(); change(f.data.files[0]); assert.throws(() => validate(f));
  }
});

test('a same-origin HTTPS Worker path prefix can supply the playback endpoint', () => {
  const f = fixture(); f.data.publicBaseUrl += '/music/';
  for (const file of f.data.files) file.url = f.data.publicBaseUrl + file.key;
  assert.equal(validate(f).mediaURL(f.tracks[0]), f.data.files[0].url);
});

test('manifest reads omit credentials and referrers, refuse redirects and use a bounded JSON stream', async () => {
  const f = fixture(), controller = new AbortController(); let call;
  const map = await readR2Manifest({url, root, tracks:f.tracks, signal:controller.signal,
    fetcher:async (endpoint, options) => {call = {endpoint, options}; return Response.json(f.data);}});
  assert.equal(map.count, 2); assert.equal(call.endpoint, url);
  assert.deepEqual(call.options, {signal:controller.signal, credentials:'omit', cache:'no-store', mode:'cors', redirect:'error', referrerPolicy:'no-referrer'});
});

test('partial manifest reads use only the configured endpoint and retain partial completion state', async () => {
  const f = partialFixture(); let call;
  const map = await readR2Manifest({url:partialURL, root, tracks:f.tracks,
    fetcher:async (endpoint, options) => {call = {endpoint, options}; return Response.json(f.data);}});
  assert.equal(call.endpoint, partialURL); assert.equal(call.options.credentials, 'omit');
  assert.equal(call.options.redirect, 'error'); assert.equal(map.mode, 'partial');
  assert.equal(map.complete, false); assert.equal(map.count, 1);
  assert.equal(map.mediaURL(f.tracks[1]), null);
});

test('invalid URLs never reach fetch; redirects, non-JSON, errors and corrupt responses reject', async () => {
  const f = fixture(); let calls = 0;
  await assert.rejects(readR2Manifest({url:'http://music.example.test/map', root, tracks:f.tracks, fetcher:async () => {calls++;}}));
  assert.equal(calls, 0);
  for (const response of [
    new Response('denied', {status:403}), new Response('<html>login</html>', {headers:{'content-type':'text/html'}}),
    new Response('{', {headers:{'content-type':'application/json'}}),
    new Response(new Uint8Array([0xff]), {headers:{'content-type':'application/json'}}),
    Object.defineProperty(Response.json(f.data), 'redirected', {value:true})
  ]) await assert.rejects(readR2Manifest({url, root, tracks:f.tracks, fetcher:async () => response}));
});

test('compressed or chunked manifests are bounded by decoded bytes, not a hidden wire encoding', async () => {
  const f = fixture();
  const map = await readR2Manifest({url, root, tracks:f.tracks, fetcher:async () =>
    Response.json(f.data, {headers:{'content-length':'100'}})});
  assert.equal(map.count, 2);
});

test('an aborted manifest request never installs a map', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(readR2Manifest({url, root, tracks:f.tracks, signal:controller.signal,
    fetcher:async (_, {signal}) => {signal.throwIfAborted();}}), {name:'AbortError'});
});

test('oversized headers and chunked streams are cancelled before parsing', async () => {
  const f = fixture(); let cancelled = 0, reads = 0;
  const response = {status:200, headers:new Headers({'content-type':'application/json', 'content-length':String(MAX_R2_MANIFEST_BYTES + 1)}),
    body:{async cancel(){cancelled++;}, getReader(){throw Error('must not read');}}};
  await assert.rejects(readR2Manifest({url, root, tracks:f.tracks, fetcher:async () => response}));
  assert.equal(cancelled, 1);
  response.headers.delete('content-length');
  const chunk = new Uint8Array(1024 * 1024);
  response.body.getReader = () => ({async read(){reads++; return {done:false, value:chunk};}, async cancel(){cancelled++;}});
  await assert.rejects(readR2Manifest({url, root, tracks:f.tracks, fetcher:async () => response}));
  assert.equal(cancelled, 2); assert.equal(reads, MAX_R2_MANIFEST_BYTES / chunk.length + 1);
});

const source = await readFile(new URL('../public/drawercast/player.js', import.meta.url), 'utf8');
const block = (a,b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
function integration(f = partialFixture()) {
  const tracks = f.tracks.slice(), timers = [], messages = [], flags={drive:true,r2:true};
  const ctx = vm.createContext({AbortController, AbortSignal, setTimeout:fn => {timers.push(fn); return timers.length;}, clearTimeout(){},
    SET:{fadeOnPause:false},
    debounce:fn => fn, baseName:s => s.split('/').at(-1), MusicSources:{refresh(){}},PlaylistFiles:{seed(){}},
    SourceLibrary:{enabled:k => flags[k]!==false,kind:t => t?.source || (t?.remote?'server':'local')},
    allTracks:() => tracks, toast:s => messages.push(s), audioSource:f => f.__remoteURL,
    UI:{renderPlayState(){}, renderProgress(){}, renderMeta(){}, renderNowPlaying(){}, startLoop(){}},
    Views:{refreshAll(){}},LIB:{ids:tracks.map(t=>t.id),map:new Map(tracks.map(t=>[t.id,t]))},FILES:new Map(),
    URL:{revokeObjectURL(){}}, sourceTrackEnabled:t => flags[t.source]!==false,
    libAdd:t => {const i=tracks.findIndex(v=>v.id===t.id);if(i<0)tracks.push(t);else tracks[i]=t;ctx.LIB.map.set(t.id,t);},
    IDB:{r2Catalog:async (helper,map,catalog) => ({fresh:r2Tracks(map,catalog,tracks),gone:[]})}});
  const {drive,r2,engine} = vm.runInContext(block('const DriveSource={', 'function SET_repeat()') + '\n({drive:DriveSource,r2:R2Source,engine:Engine})', ctx);
  drive.folder=root;drive.api={mediaURL:({id})=>'https://www.googleapis.com/drive/v3/files/'+id+'?alt=media&key=test'};
  r2.root=root;r2.manifestURL=f.options.manifestURL;r2.helper={readR2Manifest:async()=>validate(f)};
  r2.catalog={readCatalog:async()=>({records:f.tracks}),catalogTrack:r=>r};
  const audio = src => ({src, currentTime:42, duration:100, events:{}, paused:false, plays:0,
    pause(){this.paused=true;}, play(){this.plays++; return Promise.resolve();}, load(){}, removeAttribute(){this.src='';},
    addEventListener(n,fn){this.events[n]=fn;}, removeEventListener(n){delete this.events[n];}});
  engine.els=[audio(''),audio('')];engine.cur=0;engine._playRequest=1;
  engine.queue=f.tracks.slice();engine.order=[0,1];engine.pos=0;engine.current=f.tracks[0];
  engine.ensureCtx=engine.setGain=engine.updateMediaSession=engine.applySpeed=engine.seekWhenReady=engine.saveState=()=>{};
  engine.rgGain=()=>1;
  ctx.getFileFor=async t=>t.source==='r2'?r2.fileFor(t):drive.fileFor(t);
  return {...f,tracks,drive,r2,engine,ctx,timers,messages,flags};
}

test('R2 has distinct track IDs, metadata and its own user state; unmapped songs are absent',()=>{
  const f=partialFixture(),before=structuredClone(f.tracks),mapping=validate(f);
  const tracks=r2Tracks(mapping,f.tracks);
  assert.equal(tracks.length,1);assert.equal(tracks[0].id,'r2_'+f.tracks[0].remoteId);
  assert.equal(tracks[0].source,'r2');assert.equal(tracks[0].rating,0);assert.equal(tracks[0].plays,0);
  assert.equal(tracks[0].artKey,null);assert.equal(tracks[0].coverURL,before[0].coverURL);
  assert.equal(mapping.mediaURL(tracks[0]),f.data.files[0].url);
  const saved={...tracks[0],rating:3,plays:4,artKey:'r2-user-cover',customArt:true};
  const refreshed=r2Tracks(mapping,f.tracks,[saved])[0];
  assert.equal(refreshed.rating,3);assert.equal(refreshed.plays,4);assert.equal(refreshed.artKey,'r2-user-cover');
  assert.deepEqual(f.tracks,before);assert.equal(mapping.complete,false);
});

test('R2 loads and plays without a Drive API or enabled Drive source',async()=>{
  const h=integration(),before=structuredClone(h.tracks);h.drive.api=null;h.flags.drive=false;
  assert.equal(await h.r2.connect(true),true);
  const r2=h.tracks.find(t=>t.source==='r2');
  assert.equal(h.r2.fileFor(r2).__remoteURL,h.data.files[0].url);
  assert.equal(h.drive.fileFor(r2),null);assert.deepEqual(h.tracks.filter(t=>t.source==='drive'),before);
});

test('Drive always uses Google even for a verified copied song and refuses R2 entries',async()=>{
  const h=integration();await h.r2.connect(true);h.flags.r2=false;
  assert.match(h.drive.fileFor(h.tracks[0]).__remoteURL,/^https:\/\/www.googleapis.com/);
  assert.equal(h.drive.fileFor(h.tracks.find(t=>t.source==='r2')),null);
  assert.equal(h.r2.fileFor(h.tracks[0]),null);
});

test('an unavailable R2 map does not rewrite the Drive library or select Drive playback',async()=>{
  const h=integration(),before=structuredClone(h.tracks);h.r2.helper.readR2Manifest=async()=>{throw Error('unavailable');};
  assert.equal(await h.r2.connect(true),false);assert.equal(h.r2.mapping,null);
  assert.deepEqual(h.tracks,before);assert.match(h.drive.fileFor(h.tracks[0]).__remoteURL,/^https:\/\/www.googleapis.com/);
  assert.doesNotMatch(h.r2.status,/Google|Drive/);
});

test('disabling R2 during map download prevents activation',async()=>{
  const h=integration(),map=validate(h);let resolve,started;const ready=new Promise(r=>{started=r;});
  h.r2.helper.readR2Manifest=()=>{started();return new Promise(r=>{resolve=r;});};
  const pending=h.r2.connect(true);await ready;
  h.flags.r2=false;resolve(map);assert.equal(await pending,false);assert.equal(h.r2.mapping,null);
  assert.ok(h.tracks.every(t=>t.source==='drive'));
});

test('R2 refresh yields to its own playback while unrelated Drive playback can continue',async()=>{
  const h=integration();await h.r2.connect(true);h.engine.current=h.tracks.find(t=>t.source==='r2');h.engine.playing=true;
  let calls=0;h.r2.helper.readR2Manifest=async()=>{calls++;return validate(h);};
  assert.equal(await h.r2.connect(true),false);assert.equal(calls,0);
  h.engine.current=h.tracks[0];assert.equal(await h.r2.connect(true),true);assert.equal(calls,1);assert.equal(h.engine.playing,true);
});

test('R2 audio errors stop on the same source and never invoke Drive or server retries',async()=>{
  const h=integration();await h.r2.connect(true);const selected=h.tracks.find(t=>t.source==='r2');
  h.engine.current=selected;h.engine.el().src=h.r2.fileFor(selected).__remoteURL;h.engine.playing=true;
  h.drive.retryFileFor=()=>{throw Error('must never switch to Drive');};
  const before=h.engine.el().src;h.engine.onError(0);
  assert.equal(h.engine.playing,false);assert.equal(h.engine.current,selected);assert.equal(h.engine.el().src,before);
  assert.equal(h.engine.el().paused,true);assert.match(h.messages.at(-1),/R2 audio could not play/);
  assert.equal(h.drive.playbackRetry.size,0);
});

test('Drive still retries Google once at the interrupted position',()=>{
  const h=integration();h.engine.el().src=h.drive.fileFor(h.tracks[0]).__remoteURL;h.engine.playing=true;
  h.engine.onError(0);assert.match(h.engine.el().src,/^https:\/\/www.googleapis.com/);
  h.engine.el().currentTime=0;h.engine.el().events.loadedmetadata();assert.equal(h.engine.el().currentTime,42);
  h.timers.at(-1)();assert.equal(h.engine.el().plays,1);
  h.engine.onError(0);h.engine.onError(0);assert.equal(h.messages.filter(s=>s.includes('still could not play')).length,1);
});

test('R2 database commit retains every other source and preserves its own saved state',async()=>{
  const f=partialFixture(),map=validate(f),r2=r2Tracks(map,f.tracks)[0];
  const rows=new Map([...f.tracks,{...r2,rating:4,plays:9},{id:'r2_removed',source:'r2'},
    {id:'local',rating:3},{id:'server',remote:true}].map(t=>[t.id,t]));
  const before=structuredClone(rows);let tx,request;
  const db={transaction(name,mode){assert.equal(name,'tracks');assert.equal(mode,'readwrite');
    tx={objectStore(){return {openCursor(){request={};return request;},put(t,id){rows.set(id,t);}}}};return tx;}};
  const pending=commitR2Catalog(db,map,f.tracks);let settled=false;pending.then(()=>settled=true);
  const entries=[...rows.entries()];let i=0;
  function next(){const entry=entries[i++];request.result=entry?{key:entry[0],value:entry[1],update:t=>rows.set(entry[0],t),delete:()=>rows.delete(entry[0]),continue:next}:null;request.onsuccess();}
  next();await Promise.resolve();assert.equal(settled,false);tx.oncomplete();const result=await pending;
  assert.equal(rows.get(r2.id).rating,4);assert.equal(rows.get(r2.id).plays,9);assert.equal(rows.has('r2_removed'),false);
  for(const [id,t] of before)if(t.source!=='r2')assert.deepEqual(rows.get(id),t);
  assert.deepEqual(result.gone,['r2_removed']);assert.equal(result.fresh.length,1);
});

test('catalog refresh still preserves stable IDs, prepared artwork and user state independently of R2', () => {
  const f = fixture(), old = f.tracks[0], file = f.data.files[0];
  const record = {id:file.driveId, name:'song.opus', folder:'Music', size:file.size, md5Checksum:file.md5,
    mimeType:'audio/ogg', modifiedTime:'2026-10-01T00:00:00Z', availability:'ready', cover:'c'.repeat(64),
    prepared:{size:file.size, md5:file.md5, title:'Prepared title', album:'Prepared album'}};
  const updated = catalogTrack(record, root, old);
  assert.equal(updated.id, old.id); assert.equal(updated.rating, old.rating); assert.equal(updated.plays, old.plays);
  assert.equal(updated.artKey, old.artKey); assert.equal(updated.customArt, true); assert.match(updated.coverURL, /covers\/c+\.jpg$/);
  assert.equal(updated.title, 'Prepared title'); assert.equal(updated.album, 'Prepared album');
  assert.doesNotMatch(JSON.stringify(updated), /music\.example\.test|r2-get-hash-v1/);
});

test('R2 database abort never reports a successfully saved library',async()=>{
  const f=partialFixture();let tx;
  const db={transaction(){tx={objectStore(){return {openCursor(){return {};}}}};return tx;}};
  let settled=false;const pending=commitR2Catalog(db,validate(f),f.tracks).then(()=>settled=true);
  await Promise.resolve();assert.equal(settled,false);tx.error=Error('Quota exceeded');tx.onabort();
  await assert.rejects(pending,/Quota/);assert.equal(settled,false);
});
