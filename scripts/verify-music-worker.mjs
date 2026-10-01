import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readCatalog,catalogTrack} from '../.jarvis-source/public/drawercast/drive-catalog.js';
import {validateR2Manifest} from '../.jarvis-source/public/drawercast/r2-api.js';

const api='https://jarvis-hub-api.braydenparker999.workers.dev';
const origin='https://missionarytube.z13.web.core.windows.net';
const root='1VlEUztloW5saoM7iF11fodDKSmCGP2ZZ';
const endpoint=api+'/music/partial/manifest.json';
const get=(url,options={})=>fetch(url,{...options,headers:{Origin:origin,...options.headers},signal:AbortSignal.timeout(40000)});
const manifestResponse=await get(endpoint);
assert.equal(manifestResponse.status,200);
assert.equal(manifestResponse.headers.get('access-control-allow-origin'),origin);
const manifest=await manifestResponse.json();
const catalog=await readCatalog({root,pointerURL:origin+'/assets/drive-catalog-v2.json',baseURL:origin+'/assets/drive-catalog-v2/'});
const tracks=catalog.records.map(record=>catalogTrack(record,root));
const mapping=validateR2Manifest(manifest,{root,manifestURL:endpoint,tracks});
assert.equal(mapping.complete,false);
const expectedPath=process.argv[2];
if(expectedPath){
 const expected=JSON.parse(await readFile(expectedPath,'utf8'));
 for(const key of ['verifiedCount','inventoryCount','inventoryBytes','verifiedBytesTotal','sourceRevision'])assert.equal(manifest[key],expected[key]);
}
await mkdir('music-verification',{recursive:true});
const result={checkedAt:new Date().toISOString(),mode:manifest.mode,complete:false,verifiedCount:mapping.count,inventoryCount:manifest.inventoryCount,
 verifiedBytesTotal:manifest.verifiedBytesTotal,catalogMatches:true,samples:[]};
const files=manifest.files;
for(const [i,file] of [files[0],files[Math.floor(files.length/2)],files.at(-1)].entries()){
 const full=await get(file.url);
 assert.equal(full.status,200);
 assert.equal(full.headers.get('access-control-allow-origin'),origin);
 assert.equal(full.headers.get('accept-ranges'),'bytes');
 const bytes=Buffer.from(await full.arrayBuffer());
 assert.equal(bytes.length,file.size);
 assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
 const audioPath=`music-verification/audio-${i}.bin`;
 await writeFile(audioPath,bytes);
 execFileSync('ffmpeg',['-nostdin','-v','error','-i',audioPath,'-f','null','-'],{stdio:'pipe',timeout:60000});
 const metadata=JSON.parse(execFileSync('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,codec_type','-of','json',audioPath],{encoding:'utf8'}));
 assert.ok(metadata.streams.some(s=>s.codec_type==='audio'));
 assert.ok(Number(metadata.format.duration)>0);
 const head=await get(file.url,{method:'HEAD'});
 assert.equal(head.status,200);assert.equal(Number(head.headers.get('content-length')),file.size);
 const start=Math.min(4096,Math.floor(file.size/2)),end=Math.min(start+2047,file.size-1);
 const range=await get(file.url,{headers:{Range:`bytes=${start}-${end}`}});
 assert.equal(range.status,206);
 assert.equal(range.headers.get('content-range'),`bytes ${start}-${end}/${file.size}`);
 assert.equal(range.headers.get('access-control-allow-origin'),origin);
 assert.deepEqual(Buffer.from(await range.arrayBuffer()),bytes.subarray(start,end+1));
 const suffix=await get(file.url,{headers:{Range:'bytes=-128'}});
 assert.equal(suffix.status,206);assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),bytes.subarray(-128));
 const invalid=await get(file.url,{headers:{Range:`bytes=${file.size}-`}});
 assert.equal(invalid.status,416);await invalid.body?.cancel();
 const unchanged=await get(file.url,{headers:{'If-None-Match':full.headers.get('etag')}});
 assert.equal(unchanged.status,304);
 const preflight=await get(file.url,{method:'OPTIONS',headers:{'Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'range'}});
 assert.equal(preflight.status,204);
 assert.equal(preflight.headers.get('access-control-allow-origin'),origin);
 result.samples.push({driveId:file.driveId,bytes:bytes.length,hashMatched:true,decoded:true,duration:Number(metadata.format.duration),
  GET:200,HEAD:200,Range:206,suffix:206,invalidRange:416,ETag:304,preflight:204,CORS:true});
}
const denied=await get(endpoint,{headers:{Origin:'https://unapproved.example.test'}});
assert.equal(denied.status,403);await denied.body?.cancel();
const canonical=await get(api+'/music/manifest.json');
assert.equal(canonical.status,503);await canonical.body?.cancel();
const unmapped=tracks.find(track=>!mapping.mediaURL(track));
assert.ok(unmapped,'Partial playback must leave an unmapped Drive track available');
result.unmappedDriveTrack=unmapped.remoteId;
result.unapprovedOrigin=403;result.unpublishedCanonicalMap=503;
await writeFile('music-verification/report.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
