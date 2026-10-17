import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../backend/worker.js';
import {byteRange, deliveryManifest, handleMusic} from '../backend/music.js';
import {validateR2Manifest, readR2Manifest} from '../public/drawercast/r2-api.js';

const origin = 'https://missionarytube.z13.web.core.windows.net';
const api = 'https://jarvis-hub-api.braydenparker999.workers.dev';
const root = 'root_1234567890';
const id = 'track_1234567890';
const md5 = 'a'.repeat(32), sha256 = 'b'.repeat(64);
const key = `audio/${id}/${md5}.mp3`;
const etag = 'd'.repeat(32);
const bytes = new TextEncoder().encode('0123456789');
const file = {driveId:id, key, url:'', name:'Private name', folder:'Private folder', size:10,
  md5, sourceMd5:md5, sha256, verifiedBytes:10, verification:'r2-get-hash-v1', mimeType:'audio/mpeg', status:'copied',
  r2Identity:{etag:'\"'+etag+'\"',lastModified:'2026-10-01T05:00:00Z',size:10}};
const report = () => ({version:1, mode:'full', complete:true, verification:'r2-get-hash-v1',
  sourceRevision:'c'.repeat(64), generatedAt:'2026-10-01T05:00:00Z', driveRootId:root,
  r2Bucket:'private-bucket', publicBaseUrl:'', inventoryCount:1, inventoryBytes:10,
  selectedCount:1, verifiedCount:1, copiedCount:1, skippedCount:0, failedCount:0, failures:[], files:[structuredClone(file)]});
const track = {source:'drive', id:'gd_'+id, remoteId:id, driveFolder:root, size:10, md5};
const audioMetadata = () => ({size:10, etag, httpEtag:'"'+etag+'"', uploaded:new Date('2026-10-01T05:00:00Z'),
  customMetadata:{'source-drive-id':id, 'source-size':'10', 'source-md5':md5, 'source-sha256':sha256}});
function fixture(mapping=report()) {
  const calls=[];
  const e={MUSIC_PUBLIC_READ:'true', MUSIC_ROOT_ID:root, MUSIC_R2:{
    async head(k) { calls.push(['head',k]); return k===key ? audioMetadata() : null; },
    async get(k, options) {
      calls.push(['get',k,options]);
      if(k==='catalog/drive-r2-map-v1.json'||k==='catalog/drive-r2-partial-v1.json') {
        const body=new TextEncoder().encode(JSON.stringify(mapping));
        return {size:body.length, body:new Response(body).body};
      }
      if(k!==key) return null;
      const range=options?.range;
      const body=range ? bytes.slice(range.offset,range.offset+range.length) : bytes;
      return {...audioMetadata(), body:new Response(body).body};
    }
  }};
  return {e,calls};
}
const req=(path='manifest.json',headers={},method='GET')=>new Request(api+'/music/'+path,{method,headers:{Origin:origin,...headers}});
const call=(e,path,headers,method)=>worker.fetch(req(path,headers,method),e);

test('delivery is off by default and touches no R2 resource before approval', async()=>{
  const {e,calls}=fixture();
  delete e.MUSIC_PUBLIC_READ;
  assert.equal((await call(e)).status,403);
  assert.equal((await handleMusic(req(),{...e,MUSIC_PUBLIC_READ:'true'})).status,403);
  assert.deepEqual(calls,[]);
  assert.equal(await handleMusic(new Request(api+'/health'),{}),null);
});
test('configured policy still fails closed without binding or root',async()=>{
  for(const e of [{MUSIC_PUBLIC_READ:'true'}, {...fixture().e,MUSIC_ROOT_ID:''}]) assert.equal((await call(e)).status,503);
});
test('full canonical map adapts private URLs and is accepted by Poweramp',async()=>{
  const {e}=fixture();
  const response=await call(e);
  assert.equal(response.status,200);
  const map=await response.json();
  assert.equal(map.files[0].url,api+'/music/'+key);
  assert.equal(map.r2Bucket,undefined);
  assert.equal(map.files[0].name,undefined);
  const validated=validateR2Manifest(map,{root,manifestURL:api+'/music/manifest.json',tracks:[track]});
  assert.equal(validated.mediaURL(track),api+'/music/'+key);
  const fetched=await readR2Manifest({url:api+'/music/manifest.json',root,tracks:[track],fetcher:async(url,options)=>{
    assert.equal(options.credentials,'omit');
    return call(e);
  }});
  assert.equal(fetched.count,1);
});
test('rejects partial, smoke, stale-root, invalid-proof, inconsistent and duplicate mappings',async()=>{
  const changes=[
    x=>x.complete=false,x=>x.mode='smoke',x=>x.driveRootId='wrong_1234567890',x=>x.verification='head-only',
    x=>x.failedCount=1,x=>x.inventoryBytes=11,x=>x.sourceRevision='',x=>x.files[0].sourceMd5='f'.repeat(32),
    x=>x.files[0].verifiedBytes=9,x=>x.files[0].key='catalog/secrets.json',x=>x.files[0].mimeType='text/html',
    x=>x.files.push(structuredClone(x.files[0])),x=>x.copiedCount=0,
  ];
  for(const change of changes){const map=report();change(map);const {e,calls}=fixture(map);assert.equal((await call(e,key)).status,503);assert.equal(calls.filter(x=>x[0]==='head').length,0);}
});
test('strict CORS accepts only Azure and exposes the seeking headers',async()=>{
  const {e,calls}=fixture();
  const blocked=await call(e,key,{Origin:'https://evil.example'});
  assert.equal(blocked.status,403);assert.equal(blocked.headers.get('Access-Control-Allow-Origin'),null);
  assert.deepEqual(calls,[]);
  const preflight=await call(e,key,{'Access-Control-Request-Method':'GET'},'OPTIONS');
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),origin);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/Range/);
  assert.match(preflight.headers.get('Access-Control-Expose-Headers'),/Content-Range/);
  assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'),null);
  assert.deepEqual(calls,[]);
});
test('uncredentialed direct-link playback works after explicit public policy',async()=>{
  const {e}=fixture();
  const response=await worker.fetch(new Request(api+'/music/'+key),e);
  assert.equal(response.status,200);assert.equal(await response.text(),'0123456789');
  assert.equal(response.headers.get('Cache-Control'),'private, no-store');
  assert.equal(response.headers.get('Content-Length'),'10');
  assert.equal(response.headers.get('Content-Type'),'audio/mpeg');
});
test('GET supports middle, suffix, open-ended and clamped ranges with exact bytes',async()=>{
  for(const [range,body,contentRange] of [
    ['bytes=2-5','2345','bytes 2-5/10'],['bytes=-3','789','bytes 7-9/10'],
    ['bytes=7-','789','bytes 7-9/10'],['bytes=8-500','89','bytes 8-9/10'],
    ['bytes=-500','0123456789','bytes 0-9/10'],['bytes=0-0','0','bytes 0-0/10'],
  ]){
    const {e,calls}=fixture();const response=await call(e,key,{Range:range});
    assert.equal(response.status,206);assert.equal(await response.text(),body);
    assert.equal(response.headers.get('Content-Length'),String(body.length));
    assert.equal(response.headers.get('Content-Range'),contentRange);
    assert.equal(calls.at(-1)[2].onlyIf.etagMatches,etag);
  }
});
test('malformed, unsatisfiable and multiple ranges are bounded and return 416',async()=>{
  for(const range of ['bytes=10-','bytes=3-2','bytes=-0','bytes=-','bytes=0-1,4-5','other=0-1','bytes=9007199254740992-','bytes=0-9007199254740992']) {
    const {e,calls}=fixture();const response=await call(e,key,{Range:range});
    assert.equal(response.status,416,range);assert.equal(response.headers.get('Content-Range'),'bytes */10');
    assert.equal(calls.filter(x=>x[0]==='get'&&x[1]===key).length,0);
  }
  assert.equal(byteRange(null,10),null);
});
test('HEAD returns full metadata without downloading audio, ignoring Range',async()=>{
  const {e,calls}=fixture();const response=await call(e,key,{Range:'bytes=2-3'},'HEAD');
  assert.equal(response.status,200);assert.equal(await response.text(),'');
  assert.equal(response.headers.get('Content-Length'),'10');
  assert.equal(response.headers.get('Content-Range'),null);
  assert.equal(calls.filter(x=>x[0]==='get'&&x[1]===key).length,0);
});
test('conditional requests respect strong If-Range and weak If-None-Match',async()=>{
  for(const [ifRange,status,body] of [['"'+etag+'"',206,'23'],['"old"',200,'0123456789'],['W/"'+etag+'"',200,'0123456789'],['Thu, 01 Oct 2026 05:00:00 GMT',200,'0123456789']]){
    const {e}=fixture();const response=await call(e,key,{Range:'bytes=2-3','If-Range':ifRange});
    assert.equal(response.status,status);assert.equal(await response.text(),body);
  }
  const {e,calls}=fixture();const response=await call(e,key,{'If-None-Match':'"old", W/"'+etag+'"'});
  assert.equal(response.status,304);assert.equal(await response.text(),'');
  assert.equal(calls.filter(x=>x[0]==='get'&&x[1]===key).length,0);
});
test('only catalog-listed immutable audio keys can be read',async()=>{
  for(const path of ['catalog/drive-r2-map-v1.json','incoming/upload.mp3','audio/unknown_123456/'+md5+'.mp3','audio%2F'+id+'/'+md5+'.mp3',key+'?token=not-a-supported-path']){
    const {e,calls}=fixture();assert.ok([400,404].includes((await call(e,path)).status));
    assert.equal(calls.filter(x=>x[0]==='head').length,0);
  }
});
test('no upload, delete or bucket listing API is exposed',async()=>{
  for(const method of ['POST','PUT','PATCH','DELETE']){
    const {e,calls}=fixture();assert.equal((await call(e,key,{},method)).status,405);assert.deepEqual(calls,[]);
  }
});
test('R2 metadata drift and a head/get race fail closed without stale audio',async()=>{
  const {e}=fixture();e.MUSIC_R2.head=async()=>({...audioMetadata(),size:9});assert.equal((await call(e,key)).status,503);
  const changed=fixture();const get=changed.e.MUSIC_R2.get;
  changed.e.MUSIC_R2.get=async(k,o)=>k===key?{...audioMetadata(),etag:'revision-two'}:get(k,o);
  const response=await call(changed.e,key,{Range:'bytes=2-3'});
  assert.equal(response.status,503);assert.equal(response.headers.get('Content-Length'),null);
});
test('missing/truncated/oversized/malformed canonical map cannot expose audio',async()=>{
  for(const object of [null,{size:20*1024*1024,body:new Response('{}').body},{size:20,body:new Response('{}').body},{size:3,body:new Response('bad').body}]){
    const {e}=fixture();e.MUSIC_R2.get=async()=>object;
    assert.equal((await call(e,key)).status,503);
  }
});
test('SDK failures never echo secrets, URLs or stack traces',async()=>{
  const {e}=fixture();e.MUSIC_R2.get=async()=>{throw Error('SECRET https://signed.invalid/?token=sensitive');};
  const response=await call(e);assert.equal(response.status,503);
  assert.doesNotMatch(await response.text(),/SECRET|sensitive|signed.invalid|Error:/);
});
test('Worker health and existing routes remain available with music disabled',async()=>{
  const response=await worker.fetch(new Request(api+'/health'),{});
  assert.equal(response.status,200);assert.equal((await response.json()).version,7);
});

test('replacement since byte verification fails despite same size and copied metadata',async()=>{
  const {e}=fixture();e.MUSIC_R2.head=async()=>({...audioMetadata(),etag:'e'.repeat(32),httpEtag:'"'+'e'.repeat(32)+'"'});
  assert.equal((await call(e,key)).status,503);
  const missing=report();delete missing.files[0].r2Identity;
  assert.equal((await call(fixture(missing).e,key)).status,503);
  const newer=fixture();newer.e.MUSIC_R2.head=async()=>({...audioMetadata(),uploaded:new Date('2026-10-01T06:00:00Z')});
  assert.equal((await call(newer.e,key)).status,503);
});

function partialReport(){
  const map=report();
  return {...map,mode:'partial',complete:false,inventoryCount:3,inventoryBytes:100,verifiedBytesTotal:10};
}
test('partial route exposes only verified copied songs and never claims a complete library',async()=>{
  const {e}=fixture(partialReport());
  const response=await call(e,'partial/manifest.json');
  assert.equal(response.status,200);
  const map=await response.json();
  assert.equal(map.mode,'partial');assert.equal(map.complete,false);
  assert.equal(map.inventoryCount,3);assert.equal(map.verifiedCount,1);
  assert.equal(map.files[0].url,api+'/music/partial/'+key);
  const media=await call(e,'partial/'+key,{Range:'bytes=2-5'});
  assert.equal(media.status,206);assert.equal(await media.text(),'2345');
  assert.equal((await call(e,'manifest.json')).status,503);
});
test('partial route rejects full/smoke maps, wrong totals and missing original object identity',async()=>{
  const invalid=[report(),{...report(),mode:'smoke',complete:false},
    {...partialReport(),complete:true},{...partialReport(),verifiedBytesTotal:9},
    {...partialReport(),inventoryCount:0}];
  const missing=partialReport();delete missing.files[0].r2Identity;invalid.push(missing);
  for(const map of invalid)assert.equal((await call(fixture(map).e,'partial/'+key)).status,503);
});
