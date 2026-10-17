import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {folderId,createDriveApi,driveTrack} from '../public/drawercast/drive-api.js';
const root='folder123456789',file='song12345678901',child='child1234567890',key='AIza'+'x'.repeat(35);
const folder={id:root,name:'Music',mimeType:'application/vnd.google-apps.folder'};
const song={id:file,name:'01 - Example [abcdefghijk].webm',mimeType:'video/webm',size:'4000',modifiedTime:'2026-09-20T00:00:00Z',md5Checksum:'one'};
test('accepts only a folder ID or Google Drive folder URL',()=>{
  assert.equal(folderId('https://drive.google.com/drive/folders/'+root+'?usp=sharing'),root);
  assert.throws(()=>folderId('https://evil.test/drive/folders/'+root));
  assert.throws(()=>folderId("x' in parents"));
  assert.throws(()=>folderId('https://drive.google.com/file/d/'+file));
});
test('lists every page and subfolder, deduplicates songs, skips non-audio and follows no foreign URL',async()=>{
  const calls=[];const responses=[folder,{files:[song,{id:child,name:'Sub',mimeType:'application/vnd.google-apps.folder'}],nextPageToken:'next'},
    {files:[song,{id:'image123456789',name:'cover.jpg',mimeType:'image/jpeg'}]},
    {files:[{...song,id:'second123456789',name:'Two.m4a'}]}];
  const api=createDriveApi(key,async(url,options)=>{calls.push({url:new URL(url),options});return Response.json(responses.shift());});
  const result=await api.list(root);
  assert.equal(result.files.length,2);assert.equal(result.files[1].folder,'Music/Sub');
  assert.equal(calls[2].url.searchParams.get('pageToken'),'next');
  assert.ok(calls.every(c=>c.url.origin==='https://www.googleapis.com'&&c.options.credentials==='omit'));
});
test('scans sibling folders concurrently and reports useful progress',async()=>{
  const firstChild='childA123456789',secondChild='childB123456789';
  let active=0,maxActive=0,release;const gate=new Promise(resolve=>release=resolve),updates=[];
  const api=createDriveApi(key,async url=>{
    const request=new URL(url),q=request.searchParams.get('q')||'';
    if(request.pathname.endsWith('/'+root))return Response.json(folder);
    if(q.includes("'"+root+"'"))return Response.json({files:[
      {id:firstChild,name:'A',mimeType:'application/vnd.google-apps.folder'},
      {id:secondChild,name:'B',mimeType:'application/vnd.google-apps.folder'}
    ]});
    active++;maxActive=Math.max(maxActive,active);if(active===2)release();await gate;active--;
    const id=q.includes(firstChild)?'parallelSongOne':'parallelSongTwo';
    return Response.json({files:[{...song,id,name:id+'.opus'}]});
  });
  const result=await api.list(root,undefined,update=>updates.push(update));
  assert.equal(result.files.length,2);assert.equal(maxActive,2);
  assert.deepEqual(updates.at(-1),{files:2,folders:3});
});
test('supports music collections with more than 500 subfolders',async()=>{
  const children=Array.from({length:510},(_,i)=>({
    id:'folder'+String(i).padStart(8,'0'),name:'Album '+i,mimeType:'application/vnd.google-apps.folder'
  }));
  let calls=0;
  const api=createDriveApi(key,async url=>{
    calls++;const request=new URL(url),q=request.searchParams.get('q')||'';
    if(request.pathname.endsWith('/'+root))return Response.json(folder);
    if(q.includes("'"+root+"'"))return Response.json({files:children});
    return Response.json({files:[]});
  });
  const result=await api.list(root);
  assert.equal(result.files.length,0);assert.equal(calls,512);
});
test('a failure on a later page rejects the entire snapshot',async()=>{
  const responses=[Response.json(folder),Response.json({files:[song],nextPageToken:'next'}),Response.json({error:{}},{status:403})];
  const api=createDriveApi(key,async()=>responses.shift());
  await assert.rejects(api.list(root),/refused access/);
});
test('repeated pagination tokens stop rather than looping',async()=>{
  let call=0;const api=createDriveApi(key,async()=>Response.json(call++===0?folder:{files:[song],nextPageToken:'repeat'}));
  await assert.rejects(api.list(root),/pagination repeated/);
  assert.equal(call,3);
});
test('media descriptor streams from the API with no token embedded in stored track metadata',()=>{
  const api=createDriveApi(key);
  const url=new URL(api.mediaURL(song));
  assert.equal(url.searchParams.get('alt'),'media');assert.equal(url.searchParams.get('key'),key);
  const track=driveTrack(song,root,null,{rating:5,plays:9});
  assert.equal(track.title,'Example');assert.equal(track.source,'drive');assert.equal(track.rating,5);
  assert.equal(JSON.stringify(track).includes(key),false);assert.equal(track.waveformVersion,0);
  assert.throws(()=>api.mediaURL({id:'../private'}));
});
test('loads the prepared metadata manifest from the selected Drive folder',async()=>{
  const manifestId='manifest12345678',calls=[];
  const api=createDriveApi(key,async(url,options)=>{
    calls.push({url:new URL(url),options});
    if(calls.length===1)return Response.json({files:[{id:manifestId,md5Checksum:'manifest-md5',size:'123'}]});
    return Response.json({version:1,files:{[file]:{size:4000,md5:'one',title:'Prepared title'}}});
  });
  const files=await api.manifest(root);
  assert.equal(files[file].title,'Prepared title');
  assert.equal(calls[0].url.searchParams.get('q'),"'"+root+"' in parents and name = 'drive-prepared.json' and trashed = false");
  assert.equal(calls[0].url.searchParams.get('fields'),'files(id,md5Checksum,size)');
  assert.equal(calls[1].url.pathname,'/drive/v3/files/'+manifestId);
  assert.equal(calls[1].url.searchParams.get('alt'),'media');
  assert.equal(calls[1].options.cache,'no-store');
  assert.ok(calls.every(c=>c.options.credentials==='omit'));
});
test('missing, corrupt, or unsupported Drive manifests reject for graceful caller fallback',async()=>{
  const missing=createDriveApi(key,async()=>Response.json({files:[]}));
  await assert.rejects(missing.manifest(root),/not found/);
  const corrupt=createDriveApi(key,async(url)=>url.includes('alt=media')?new Response('{',{headers:{'content-type':'application/json'}}):Response.json({files:[{id:'manifest12345678'}]}));
  await assert.rejects(corrupt.manifest(root),SyntaxError);
  const unsupported=createDriveApi(key,async(url)=>url.includes('alt=media')?Response.json({version:2,files:{}}):Response.json({files:[{id:'manifest12345678'}]}));
  await assert.rejects(unsupported.manifest(root),/invalid/);
});
test('prepared metadata is accepted only for the matching file revision and never points at bundled waveforms',()=>{
  const prepared={size:4000,md5:'one',dur:200,codec:'opus',waveform:true};
  const valid=driveTrack(song,root,prepared,{waveformVersion:1,waveformFile:'/drawercast/drive-waveforms/x.dcw'});
  assert.equal(valid.dur,200);assert.equal(valid.waveformVersion,0);assert.equal(valid.waveformFile,null);
  const changed=driveTrack({...song,md5Checksum:'two'},root,prepared,valid);
  assert.equal(changed.dur,0);
});
const source=await readFile(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
function integration({fail=false,storageFail=false,unchanged=false,files=[song]}={}){
  const tracks=new Map([['a15',{id:'a15',remote:true}],['local',{id:'local'}],['gd_old12345678',{id:'gd_old12345678',source:'drive'}]]);
  const removed=[];let writes=0,redraws=0,reads=0;
  const component=source.slice(source.indexOf('const DriveSource={'),source.indexOf('\nconst Engine = {'));
  const context=vm.createContext({AbortController,AbortSignal,setTimeout,clearTimeout,navigator:{onLine:true},document:{visibilityState:'visible',addEventListener(){}},SourceLibrary:{enabled:()=>true},sourceTrackEnabled:t=>!!t,MusicSources:{refresh(){}},LIB:{map:tracks,ids:[...tracks.keys()]},FILES:new Map(),
    allTracks:()=>[...tracks.values()],IDB:{async catalog(module,snapshot){if(storageFail)throw Error('Storage full');writes++;const fresh=snapshot.records.map(f=>driveTrack(f,root));const ids=new Set(fresh.map(t=>t.id));const gone=[...tracks.values()].filter(t=>t.source==='drive'&&!ids.has(t.id)).map(t=>t.id);removed.push(...gone);return {fresh,gone};}},libAdd:t=>tracks.set(t.id,t),
    Engine:{queue:[],order:[],pos:0,current:null,buildOrder(){this.order=this.queue.map((_,i)=>i);},saveState(){},stop(){throw Error('Must not stop audio');}},
    Views:{refreshAll(){redraws++}},UI:{renderNowPlaying(){},renderPlayState(){}},localStorage:{setItem(){},removeItem(){}},
    toast(){},$:()=>null,Waveform:{load(){}}});
  const drive=vm.runInContext(component+'\nDriveSource;',context);
  drive.api={async list(){throw Error('Phone scan forbidden');},async manifest(){throw Error('Manifest discovery forbidden');}};
  drive.catalog={async readCatalog(){reads++;if(fail)throw Error('Network failure');return {unchanged,pointer:{rootId:root,count:files.length,name:'Music',generation:'new',publishedAt:new Date().toISOString()},records:files};}};
  drive.helper={driveTrack,folderId};drive.folder=root;drive.scheduleManifestCheck=()=>{};
  return {drive,tracks,removed,engine:context.Engine,get reads(){return reads;},get writes(){return writes;},get redraws(){return redraws;}};
}
test('Drive startup and refresh have no browser folder listing or v1 manifest discovery',()=>{
  const component=source.slice(source.indexOf('const DriveSource={'),source.indexOf('\nconst Engine = {'));
  assert.doesNotMatch(component,/this\.api\.(list|manifest)\(/);
  assert.match(component,/scheduleManifestCheck\(delay=300000\)/);
  assert.match(component,/manifestDelay=0/);
});
test('Drive catalog applies a complete snapshot without touching local and A15 sources',async()=>{
  const state=integration();assert.equal(await state.drive.connect(root),true);
  assert.equal(state.reads,1);assert.equal(state.writes,1);
  assert.ok(state.tracks.has('a15'));assert.ok(state.tracks.has('local'));assert.ok(state.tracks.has('gd_'+file));
  assert.equal(state.tracks.has('gd_old12345678'),false);
});
test('network and storage failures both leave all previous songs and UI untouched',async()=>{
  for(const options of [{fail:true},{storageFail:true}]){
    const state=integration(options);assert.equal(await state.drive.connect(root),false);
    assert.equal(state.tracks.size,3);assert.equal(state.removed.length,0);assert.equal(state.redraws,0);assert.match(state.drive.status,/update delayed/);
  }
});
test('unchanged generation causes no track writes or redraws',async()=>{
  const state=integration({unchanged:true});assert.equal(await state.drive.checkManifest(),true);
  assert.equal(state.writes,0);assert.equal(state.redraws,0);
});
test('catalog work yields to playing Drive audio until pause',async()=>{
  const state=integration();state.engine.current={id:'gd_current',source:'drive'};state.engine.playing=true;
  assert.equal(await state.drive.checkManifest(),false);assert.equal(state.reads,0);
  assert.equal(await state.drive.connect(root),false);assert.equal(state.reads,0);
  state.engine.playing=false;assert.equal(await state.drive.checkManifest(),true);assert.equal(state.reads,1);
});
test('v2 records never start phone metadata range requests',async()=>{
  const state=integration();await state.drive.ensureMetadata({id:'gd_track',source:'drive',catalogVersion:2});
  assert.equal(state.drive.tagQueue.length,0);
});
test('unmanaged roots fail without scanning or replacing the cached library',async()=>{
  const state=integration();assert.equal(await state.drive.connect('anotherFolder123'),false);assert.equal(state.reads,0);assert.equal(state.tracks.size,3);
});
test('numbered Muse filenames provide immediate artist/title while embedded tags load',()=>{
  const t=driveTrack({...song,name:'10 - Alice In Chains - Nutshell (Unplugged).opus'},root);
  assert.equal(t.title,'Nutshell (Unplugged)');assert.equal(t.artist,'Alice In Chains');
});
test('cached embedded tags and art survive refresh only for identical bytes',()=>{
  const old={size:4000,md5:'one',driveTagVersion:1,title:'Tagged title',artist:'Tagged artist',album:'Album',track:10,year:2000,artKey:'cover',dur:200,rating:5};
  const same=driveTrack(song,root,null,old);assert.equal(same.album,'Album');assert.equal(same.artKey,'cover');assert.equal(same.driveTagVersion,1);assert.equal(same.track,10);
  const changed=driveTrack({...song,md5Checksum:'new'},root,null,old);assert.equal(changed.artKey,null);assert.equal(changed.driveTagVersion,0);assert.equal(changed.album,'');assert.equal(changed.rating,5);
});
function rangeMock(bytes,calls){return async(url,options)=>{
  const [,start,end]=options.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);calls.push({start,end});
  return new Response(bytes.subarray(start,end+1),{status:206,headers:{'content-range':`bytes ${start}-${end}/${bytes.length}`}});
};}
test('metadata ranges reuse fetched bytes without reading the full song',async()=>{
  const bytes=new Uint8Array(500000),calls=[];bytes[40000]=123;
  const f=createDriveApi(key,rangeMock(bytes,calls)).metadataFile({remoteId:file,size:bytes.length});
  await f.slice(0,32000).arrayBuffer();const part=new Uint8Array(await f.slice(32000,65536).arrayBuffer());
  assert.equal(part[8000],123);assert.equal(calls.length,1);assert.equal(calls[0].end,131071);
});
test('range refusal cancels the response instead of downloading a complete song',async()=>{
  let cancelled=false;const response=new Response(new ReadableStream({cancel(){cancelled=true;}}));
  const f=createDriveApi(key,async()=>response).metadataFile({remoteId:file,size:500000});
  await assert.rejects(f.slice(0,32768).arrayBuffer(),/requested metadata range/);assert.ok(cancelled);
});
test('wrong revision ranges, oversized reads and aborted jobs fail without retries',async()=>{
  let calls=0;const api=createDriveApi(key,async()=>{calls++;return new Response(new Uint8Array(32),{status:206,headers:{'content-range':'bytes 0-31/32'}});});
  await assert.rejects(api.metadataFile({remoteId:file,size:500000}).slice(0,32).arrayBuffer(),/range/);
  await assert.rejects(api.metadataFile({remoteId:file,size:5000000}).slice(0,3000000).arrayBuffer(),/budget/);assert.equal(calls,1);
  const c=new AbortController();c.abort();await assert.rejects(api.metadataFile({remoteId:file,size:1000},c.signal).slice(0,32).arrayBuffer(),/Aborted/);assert.equal(calls,1);
});
const tagCode=source.slice(source.indexOf("const TD=new TextDecoder"),source.indexOf('function buildTagWorkerURL'));
function oggPage(packet,seq=0){
  const lengths=[];let left=packet.length;while(left>=255){lengths.push(255);left-=255;}lengths.push(left);
  const b=Buffer.alloc(27+lengths.length+packet.length);b.write('OggS');b[26]=lengths.length;b.set(lengths,27);b.set(packet,27+lengths.length);return b;
}
function opusFixture(){
  const head=Buffer.alloc(19);head.write('OpusHead');head[8]=1;head[9]=2;
  const jpeg=Buffer.alloc(200,7),mime=Buffer.from('image/jpeg');
  const picture=Buffer.alloc(4+4+mime.length+4+16+4+jpeg.length);let at=4;picture.writeUInt32BE(mime.length,at);at+=4;picture.set(mime,at);at+=mime.length+4+16;picture.writeUInt32BE(jpeg.length,at);picture.set(jpeg,at+4);
  const comments=['TITLE=懸想','ARTIST=Miraidempa','ALBUM=Test Album','ALBUMARTIST=Album Artist','TRACKNUMBER=4/10','DISCNUMBER=2','DATE=2024','METADATA_BLOCK_PICTURE='+picture.toString('base64')].map(s=>Buffer.from(s));
  const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32LE(n);return b;};
  const tags=Buffer.concat([Buffer.from('OpusTags'),u32(0),u32(comments.length),...comments.flatMap(b=>[u32(b.length),b])]);
  return Buffer.concat([oggPage(head),oggPage(tags),Buffer.alloc(500000)]);
}
test('actual embedded Opus parser reads tags and artwork from a bounded head, with no tail or waveform decode',async()=>{
  const bytes=opusFixture(),calls=[];
  const ctx=vm.createContext({TextDecoder,Uint8Array,atob,performance});const read=vm.runInContext(tagCode+'\nreadTags',ctx);
  const f=createDriveApi(key,rangeMock(bytes,calls)).metadataFile({remoteId:file,size:bytes.length});
  const tags=await read(f,{remote:true,headerOnly:true,throwErrors:true});
  assert.equal(tags.title,'懸想');assert.equal(tags.artist,'Miraidempa');assert.equal(tags.album,'Test Album');assert.equal(tags.track,4);assert.equal(tags.disc,2);assert.equal(tags.year,2024);
  assert.equal(tags.pic.mime,'image/jpeg');assert.equal(tags.pic.data.length,200);assert.equal(tags.sampleRate,48000);assert.equal(tags.bits,undefined);assert.equal(tags.tagDur,undefined);
  assert.equal(calls.length,1);assert.equal(calls[0].start,0);assert.equal(calls[0].end,131071);
});
test('metadata scheduler deduplicates covers and caches completed jobs',async()=>{
  const {drive,tracks}=integration();drive.catalog=null;let release;const order=[];
  const t1={id:'gd_one',source:'drive',md5:'one',size:1000},t2={id:'gd_two',source:'drive',md5:'two',size:1000};tracks.set(t1.id,t1);tracks.set(t2.id,t2);
  drive.readMetadata=async t=>{order.push(t.id);if(t===t1)await new Promise(r=>release=r);t.driveTagVersion=1;};
  const first=drive.ensureMetadata(t1);assert.equal(first,drive.ensureMetadata(t1));const second=drive.ensureMetadata(t2);
  assert.deepEqual(order,['gd_one']);release();await first;await second;clearTimeout(drive.tagTimer);assert.deepEqual(order,['gd_one','gd_two']);
  await drive.ensureMetadata(t1);assert.equal(order.length,2);
});


test('metadata waits during audio buffering and promotes the selected song',async()=>{
  const {drive,tracks,engine}=integration();drive.catalog=null;const order=[];
  engine.playing=true;engine.el=()=>({readyState:0});
  const a={id:'first',source:'drive',md5:'a'},b={id:'selected',source:'drive',md5:'b'};
  tracks.set(a.id,a);tracks.set(b.id,b);engine.current=b;
  drive.readMetadata=async t=>{order.push(t.id);};
  const first=drive.ensureMetadata(a),second=drive.ensureMetadata(b);
  assert.deepEqual(order,[]);engine.el=()=>({readyState:3});drive.pumpTags();await second;
  assert.deepEqual(order,['selected']);
  engine.playing=false;drive.pumpTags();await first;
  clearTimeout(drive.tagTimer);assert.deepEqual(order,['selected','first']);
});
test('rapid track changes abort abandoned artwork reads',()=>{
  const {drive}=integration();const controller=new AbortController();
  drive.tagActive={t:{id:'old'},controller};drive.prioritize({id:'new'});assert.ok(controller.signal.aborted);
});


test('Drive CORS may hide Content-Range; an exact bounded 206 body is still readable',async()=>{
  const api=createDriveApi(key,async()=>new Response(new Uint8Array(131072),{status:206,headers:{'content-length':'131072'}}));
  const f=api.metadataFile({remoteId:file,size:500000});assert.equal((await f.slice(0,32768).arrayBuffer()).byteLength,32768);
  const bad=createDriveApi(key,async()=>new Response(new Uint8Array(131073),{status:206}));
  await assert.rejects(bad.metadataFile({remoteId:file,size:500000}).slice(0,32768).arrayBuffer(),/exceeded/);
});

test('publisher rejects an incompleteSearch response instead of publishing deletions',async()=>{
  let calls=0;const api=createDriveApi(key,async()=>Response.json(calls++===0?folder:{incompleteSearch:true,files:[song]}));
  await assert.rejects(api.list(root),/incomplete/);
});

test('migration never probes legacy cached tracks once the catalog reader is installed',async()=>{
  const state=integration();await state.drive.ensureMetadata({id:'gd_legacy',source:'drive',md5:'old',size:4000});
  assert.equal(state.drive.tagQueue.length,0);
});

test('catalog metadata refresh preserves shuffled order and duplicate occurrences',async()=>{
  const state=integration();const a=state.tracks.get('a15'),b=state.tracks.get('local');
  state.engine.queue=[a,b,a];state.engine.order=[2,0,1];state.engine.pos=1;state.engine.current=a;
  assert.equal(await state.drive.connect(root),true);
  assert.deepEqual(Array.from(state.engine.order),[2,0,1]);assert.equal(state.engine.pos,1);
});
