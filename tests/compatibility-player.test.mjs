import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AppendOnlyStreamTarget,AudioSample,Input,BufferSource,BufferTarget,AudioSampleSink,EncodedPacketSink,ALL_FORMATS} from 'mediabunny';
import {preparePipeline,pumpPipeline,stereoSample,alignAudioSample,createAdapter,prepareRepair} from '../src/compatibility-player.js';
import '../assets/js/playback/request-policy.js';
const inputFor=async name=>new Input({source:new BufferSource(Buffer.from(await readFile(new URL(`./fixtures/media/${name}.mkv.base64`,import.meta.url),'utf8'),'base64')),formats:ALL_FORMATS});

test('the reported MP4 H264/AC3 combination has readable video and decodable audio',async()=>{
 const input=new Input({source:new BufferSource(Buffer.from(await readFile(new URL('./fixtures/media/avc-ac3.mp4.base64',import.meta.url),'utf8'),'base64')),formats:ALL_FORMATS});
 try{
  assert.equal(await (await input.getPrimaryVideoTrack()).getCodec(),'avc');
  const audio=await input.getPrimaryAudioTrack();assert.equal(await audio.getCodec(),'ac3');
  let frames=0;for await(const sample of new AudioSampleSink(audio).samples(0,.15)){frames+=sample.numberOfFrames;sample.close();}
  assert.ok(frames>1000);
 }finally{input.dispose();}
});

test('real MKV AVC/AAC is repackaged to fragmented MP4 with video bytes intact',async()=>{
 const input=await inputFor('avc-aac');const plan=await preparePipeline(input);const chunks=[];const target=new AppendOnlyStreamTarget(new WritableStream({write:bytes=>{chunks.push(Buffer.from(bytes));}}));
 await pumpPipeline(plan,{target});
 const bytes=Buffer.concat(chunks);
 const output=new Input({source:new BufferSource(bytes),formats:ALL_FORMATS});
 try {
  assert.match(await output.getMimeType(),/video\/mp4/);
  assert.equal(await (await output.getPrimaryVideoTrack()).getCodec(),'avc');
  assert.equal(await (await output.getPrimaryAudioTrack()).getCodec(),'aac');
  const original=await new EncodedPacketSink(plan.video).getFirstPacket();
  const copied=await new EncodedPacketSink(await output.getPrimaryVideoTrack()).getFirstPacket();
  assert.deepEqual(copied.data,original.data);
  assert.ok((await output.computeDuration())>3.8);
  assert.ok(bytes.includes(Buffer.from('moof')));
 }finally{input.dispose();output.dispose();}
});
for(const codec of ['ac3','eac3','dts'])test(`real ${codec} audio decodes to samples using the bundled decoder`,async()=>{
 const input=await inputFor('avc-'+codec);
 try {
  const audio=await input.getPrimaryAudioTrack();assert.equal(await audio.canDecode(),true);
  let frames=0;
  for await(const sample of new AudioSampleSink(audio).samples(0,.15)){frames+=sample.numberOfFrames;sample.close();}
  assert.ok(frames>1000);
 }finally{input.dispose();}
});
test('seeking starts at a preceding keyframe and unsupported video is explicit',async()=>{
 const input=await inputFor('avc-aac');
 try {
  const plan=await preparePipeline(input,{startTime:2.5});
  assert.ok(plan.first.timestamp<=2.5&&plan.first.timestamp>1);
  await assert.rejects(preparePipeline(input,{supports:()=>false}),/cannot decode the video codec/);
  const abort=new AbortController();abort.abort();
  await assert.rejects(pumpPipeline(plan,{target:new BufferTarget(),signal:abort.signal}),{name:'AbortError'});
 }finally{input.dispose();}
});


test('surround audio is downmixed to bounded stereo samples',()=>{
 const sample=new AudioSample({data:new Float32Array(600).fill(.5),format:'f32-planar',sampleRate:48000,numberOfChannels:6,timestamp:7});
 const stereo=stereoSample(sample);
 try {assert.equal(stereo.numberOfChannels,2);assert.equal(stereo.timestamp,7);assert.equal(stereo.numberOfFrames,100);
  const plane=new Float32Array(100);stereo.copyTo(plane,{planeIndex:0,format:'f32-planar'});assert.ok(plane.every(x=>x>0&&x<=.5));
 }finally{stereo.close();sample.close();}
});


test('audio crossing a video keyframe is trimmed before encoding to avoid negative timestamps',()=>{
 const sample=new AudioSample({data:new Float32Array(2048),format:'f32-planar',sampleRate:48000,numberOfChannels:1,timestamp:.145});
 const aligned=alignAudioSample(sample,.166);
 try{assert.ok(aligned.timestamp>=.166);assert.ok(aligned.numberOfFrames<sample.numberOfFrames);assert.equal(alignAudioSample(sample,1),null);}
 finally{aligned.close();sample.close();}
});


test('an unsupported default audio track falls back to usable audio in the same file',async()=>{
 const input=await inputFor('avc-aac');
 try {
  const video=await input.getPrimaryVideoTrack(),aac=await input.getPrimaryAudioTrack();
  const unsupported={id:'truehd',getCodecParameterString:async()=>null,canDecode:async()=>false};
  const source={getPrimaryVideoTrack:async()=>video,getPrimaryAudioTrack:async()=>unsupported,getAudioTracks:async()=>[unsupported,aac],getDurationFromMetadata:()=>input.getDurationFromMetadata()};
  const plan=await preparePipeline(source);
  assert.equal(plan.audio,aac);assert.equal(plan.copyAudio,true);
  const chunks=[];
  await pumpPipeline(plan,{target:new AppendOnlyStreamTarget(new WritableStream({write:bytes=>chunks.push(Buffer.from(bytes))}))});
  const output=new Input({source:new BufferSource(Buffer.concat(chunks)),formats:ALL_FORMATS});
  try{assert.equal(await (await output.getPrimaryAudioTrack()).getCodec(),'aac');assert.ok(await output.computeDuration()>3.8);}
  finally{output.dispose();}
  await assert.rejects(preparePipeline(source,{audioId:'truehd'}),/No playable audio track/);
 }finally{input.dispose();}
});

test('replacing an in-flight startup reports the old read as cancelled, not a new playback failure',{timeout:3000},async t=>{
 const fixture=Buffer.from(await readFile(new URL('./fixtures/media/avc-aac.mkv.base64',import.meta.url),'utf8'),'base64');
 const requests=[];
 const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};};
 const started=[deferred(),deferred()];
 t.mock.method(globalThis,'fetch',()=>{
  const request=deferred(),index=requests.length;
  requests.push(request);started[index]?.resolve();return request.promise;
 });
 const adapter=createAdapter({media:{},url:'https://media.example.test/movie.mkv'});
 try {
  const first=adapter.attach();
  const firstFailure=assert.rejects(first,{name:'AbortError'});
  await started[0].promise;
  const second=adapter.attach();
  const secondFailure=assert.rejects(second,/format|media|input/i);
  await started[1].promise;
  requests[0].resolve(new Response(fixture,{status:206,headers:{'Content-Range':`bytes 0-${fixture.length-1}/${fixture.length}`}}));
  requests[1].resolve(new Response('not a media file',{status:206,headers:{'Content-Range':'bytes 0-15/16'}}));
  await Promise.all([firstFailure,secondFailure]);
 }finally{adapter.destroy();}
});


test('real 40-second MKV VP8/Vorbis uses WebM when MP4 is unavailable, preserving both tracks',async()=>{
 const input=await inputFor('vp8-vorbis');
 const plan=await preparePipeline(input,{supports:type=>type.startsWith('video/webm;')});
 assert.equal(plan.container,'webm');assert.equal(plan.copyAudio,true);assert.equal(plan.audioCodec,'vorbis');
 const chunks=[];
 await pumpPipeline(plan,{target:new AppendOnlyStreamTarget(new WritableStream({write:bytes=>chunks.push(Buffer.from(bytes))}))});
 const output=new Input({source:new BufferSource(Buffer.concat(chunks)),formats:ALL_FORMATS});
 try {
  assert.match(await output.getMimeType(),/video\/webm/);
  assert.equal(await (await output.getPrimaryVideoTrack()).getCodec(),'vp8');
  assert.equal(await (await output.getPrimaryAudioTrack()).getCodec(),'vorbis');
  assert.ok(await output.computeDuration()>39.8);
  for(const [before,after] of [[plan.video,await output.getPrimaryVideoTrack()],[plan.audio,await output.getPrimaryAudioTrack()]]){
   const first=before===plan.audio?plan.firstAudio:plan.first;
   const copied=await new EncodedPacketSink(after).getFirstPacket();
   assert.deepEqual(copied.data,first.data);
  }
 }finally{input.dispose();output.dispose();}
});

test('audio conversion selects AAC when MP4 cannot accept Opus',async()=>{
 const input=await inputFor('avc-ac3');
 try {
  const encoders=[];
  const plan=await preparePipeline(input,{supports:type=>type.startsWith('video/mp4;')&&!/opus|ac-3/.test(type),encodeAudio:async codec=>{encoders.push(codec);return codec==='aac';}});
  assert.equal(plan.copyAudio,false);assert.equal(plan.audioCodec,'aac');assert.match(plan.mime,/mp4a\.40\.2/);
  assert.deepEqual(encoders,['aac']);
 }finally{input.dispose();}
});

test('a WebM repair seek retains a preceding keyframe beyond the initial read-ahead window',async()=>{
 const input=await inputFor('vp8-vorbis');
 try {
  const plan=await preparePipeline(input,{startTime:34.5,supports:type=>type.startsWith('video/webm;')});
  assert.ok(plan.base>=32&&plan.base<=34.5);
  const chunks=[];
  await pumpPipeline(plan,{target:new AppendOnlyStreamTarget(new WritableStream({write:bytes=>chunks.push(Buffer.from(bytes))}))});
  const output=new Input({source:new BufferSource(Buffer.concat(chunks)),formats:ALL_FORMATS});
  try {assert.ok(await output.computeDuration()>5);assert.ok(await output.computeDuration()<8);}
  finally{output.dispose();}
 }finally{input.dispose();}
});


test('copied AAC audio crossing a seek keyframe keeps its timing and no longer fails the muxer',async()=>{
 const input=await inputFor('avc-aac');
 try {
  const plan=await preparePipeline(input,{startTime:2.5});
  assert.ok(plan.firstAudio.timestamp<plan.first.timestamp);
  assert.equal(plan.base,plan.firstAudio.timestamp);
  const chunks=[];
  await pumpPipeline(plan,{target:new AppendOnlyStreamTarget(new WritableStream({write:bytes=>chunks.push(Buffer.from(bytes))}))});
  const output=new Input({source:new BufferSource(Buffer.concat(chunks)),formats:ALL_FORMATS});
  try {
   const v=await new EncodedPacketSink(await output.getPrimaryVideoTrack()).getFirstPacket();
   const a=await new EncodedPacketSink(await output.getPrimaryAudioTrack()).getFirstPacket();
   assert.ok(Math.abs(v.timestamp+plan.base-plan.first.timestamp)<.002);
   assert.ok(Math.abs(a.timestamp+plan.base-plan.firstAudio.timestamp)<.002);
   assert.deepEqual(a.data,plan.firstAudio.data);
  }finally{output.dispose();}
 }finally{input.dispose();}
});


test('compatibility fetch keeps addon headers on their origin and follows demuxer byte ranges',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{calls.push({url,init});return new Response('invalid media input',{headers:{'Content-Length':'19'}});});
 const url='https://media.example.test/movie.mkv';
 const requestPolicy=globalThis.AstraPlayback.requests.analyze(url,{request:{Authorization:'Bearer synthetic',Range:'bytes=500-600'}});
 const adapter=createAdapter({media:{},url,requestPolicy});
 try {await assert.rejects(adapter.attach());assert.ok(calls.length);
  for(const {init} of calls){assert.equal(init.headers.get('authorization'),'Bearer synthetic');assert.match(init.headers.get('range'),/^bytes=0-/);assert.equal(init.redirect,'error');assert.equal(init.credentials,'omit');}
 }finally{adapter.destroy();}
});

test('compatibility HLS children on another origin never receive addon credentials',async t=>{
 const calls=[];
 const playlist='#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4.0,\nhttps://cdn.example.test/segment.ts\n#EXT-X-ENDLIST\n';
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  calls.push({url:String(url),init});
  const body=String(url).endsWith('m3u8')?playlist:'invalid segment';
  return new Response(body,{headers:{'Content-Length':String(body.length)}});
 });
 const url='https://media.example.test/movie.m3u8';
 const requestPolicy=globalThis.AstraPlayback.requests.analyze(url,{request:{Authorization:'Bearer synthetic','X-Playback-Key':'synthetic'}});
 const adapter=createAdapter({media:{},url,requestPolicy});
 try {await assert.rejects(adapter.attach());
  const child=calls.find(call=>call.url.startsWith('https://cdn.example.test/'));
  assert.ok(child,'the real demuxer requested the cross-origin HLS segment');
  assert.equal(child.init.headers.get('authorization'),null);assert.equal(child.init.headers.get('x-playback-key'),null);
  assert.equal(calls[0].init.headers.get('authorization'),'Bearer synthetic');
 }finally{adapter.destroy();}
});


test('compatibility startup distinguishes blocked access and connection failures',async t=>{
 const url='https://media.example.test/movie.mkv';
 let attempts=0;
 t.mock.method(globalThis,'fetch',async()=>{attempts++;throw new TypeError('Failed to fetch');});
 const requestPolicy=globalThis.AstraPlayback.requests.analyze(url,{request:{Cookie:'synthetic'}});
 const blocked=createAdapter({media:{},url,requestPolicy});
 try {await assert.rejects(blocked.attach(),error=>error.playbackType==='access');assert.equal(attempts,0);}
 finally{blocked.destroy();}
 const disconnected=createAdapter({media:{},url});
 try {await assert.rejects(disconnected.attach(),error=>error.playbackType==='network');assert.ok(attempts>0);}
 finally{disconnected.destroy();}
});

const fixtureResponse=(fixture,init)=>{
 const start=Number(/^bytes=(\d+)-/.exec(new Headers(init.headers).get('range'))?.[1]||0);
 return new Response(fixture.subarray(start),{status:206,headers:{'Content-Range':`bytes ${start}-${fixture.length-1}/${fixture.length}`,'Content-Length':String(fixture.length-start)}});
};

function mockMediaSource(t) {
 const previous=globalThis.MediaSource;
 let finish;
 const completed=new Promise(resolve=>{finish=resolve;});
 class Buffer extends EventTarget {
  buffered={length:0,start:()=>0,end:()=>4};
  appendBuffer(){this.buffered.length=1;queueMicrotask(()=>this.dispatchEvent(new Event('updateend')));}
  remove(){queueMicrotask(()=>this.dispatchEvent(new Event('updateend')));}
 }
 globalThis.MediaSource=class extends EventTarget {
  static isTypeSupported(type){return type.startsWith('video/mp4;');}
  readyState='closed';
  addSourceBuffer(){return new Buffer();}
  endOfStream(){this.readyState='ended';finish();}
 };
 t.after(()=>{if(previous===undefined)delete globalThis.MediaSource;else globalThis.MediaSource=previous;});
 t.mock.method(URL,'createObjectURL',source=>{queueMicrotask(()=>{source.readyState='open';source.dispatchEvent(new Event('sourceopen'));});return 'blob:synthetic-playback';});
 t.mock.method(URL,'revokeObjectURL',()=>{});
 return completed;
}

test('audio repair retries a transient request and transfers the real prepared input without rereading',async t=>{
 const fixture=Buffer.from(await readFile(new URL('./fixtures/media/avc-aac.mkv.base64',import.meta.url),'utf8'),'base64');
 const completed=mockMediaSource(t);
 let requests=0,plays=0,mediaWrites=0;
 t.mock.method(globalThis,'fetch',async(_url,init)=>{if(++requests===1)throw new TypeError('Failed to fetch');return fixtureResponse(fixture,init);});
 const media={currentTime:2.5,paused:true,buffered:{length:0},set src(_value){mediaWrites++;},play(){plays++;this.paused=false;return Promise.resolve();}};
 const prepared=await prepareRepair({url:'https://media.example.test/movie.mkv',startTime:2.5});
 assert.equal(mediaWrites,0,'probing never replaced the existing video');
 assert.equal(requests,2,'the transient failure used exactly one retry');
 const originalTake=prepared.take;let taken;
 prepared.take=()=>{taken=originalTake();t.mock.method(taken.input,'dispose');return taken;};
 const adapter=createAdapter({media,url:'https://media.example.test/movie.mkv',startTime:2.5,prepared,autoplay:false});
 try {
  await adapter.attach();await completed;
  assert.equal(taken.plan.audio.codec,'aac');assert.equal(taken.plan.video.codec,'avc');
  assert.equal(requests,2,'the adapter reused the parsed and cached input');
  assert.equal(mediaWrites,1);assert.equal(plays,0,'paused repairs stay paused');
  assert.ok(media.currentTime>=2.5);
  assert.throws(()=>prepared.take(),{name:'AbortError'});
 }finally{adapter.destroy();}
 assert.equal(taken.input.dispose.mock.callCount(),1,'the adapter released the transferred input');
});

for(const phase of ['fetch','body'])test(`audio repair bounds persistent ${phase} failures to one shared retry`,{timeout:2000},async t=>{
 let requests=0;
 t.mock.method(globalThis,'fetch',async()=>{
  requests++;
  if(phase==='fetch')throw new TypeError('Failed to fetch');
  return new Response(new ReadableStream({start(controller){controller.error(new TypeError('network interrupted'));}}),{status:206,headers:{'Content-Range':'bytes 0-999/1000'}});
 });
 await assert.rejects(prepareRepair({url:'https://media.example.test/movie.mkv'}),error=>error.playbackType==='network');
 assert.equal(requests,2);
});

test('cancelling repair during its retry delay stops it without another request',{timeout:2000},async t=>{
 let requests=0;
 t.mock.method(globalThis,'fetch',async()=>{requests++;throw new TypeError('Failed to fetch');});
 const controller=new AbortController();
 const preparation=prepareRepair({url:'https://media.example.test/movie.mkv',signal:controller.signal});
 const rejected=assert.rejects(preparation,{name:'AbortError'});
 await new Promise(resolve=>setTimeout(resolve,10));controller.abort();await rejected;
 await new Promise(resolve=>setTimeout(resolve,300));
 assert.equal(requests,1);
});

test('repair cancellation promptly rejects a pending metadata fetch',{timeout:1000},async t=>{
 let resolveRequest;
 t.mock.method(globalThis,'fetch',()=>new Promise(resolve=>{resolveRequest=resolve;}));
 const controller=new AbortController();
 const preparation=prepareRepair({url:'https://media.example.test/movie.mkv',signal:controller.signal});
 const rejected=assert.rejects(preparation,{name:'AbortError'});
 controller.abort();await rejected;
 resolveRequest(new Response('cancelled input',{headers:{'Content-Length':'15'}}));
});

test('prepared repair is disposed when abandoned or its adapter is destroyed before attach',async t=>{
 const fixture=Buffer.from(await readFile(new URL('./fixtures/media/avc-aac.mkv.base64',import.meta.url),'utf8'),'base64');
 mockMediaSource(t);
 t.mock.method(globalThis,'fetch',async(_url,init)=>fixtureResponse(fixture,init));
 const abandoned=await prepareRepair({url:'https://media.example.test/movie.mkv'});
 abandoned.dispose();assert.throws(()=>abandoned.take(),{name:'AbortError'});
 const prepared=await prepareRepair({url:'https://media.example.test/movie.mkv'});
 const adapter=createAdapter({media:{},url:'https://media.example.test/movie.mkv',prepared});
 adapter.destroy();assert.throws(()=>prepared.take(),{name:'AbortError'});
 await adapter.attach();
});

test('aborting an unconsumed prepared repair invalidates it; abort after transfer leaves ownership with the adapter',async t=>{
 const fixture=Buffer.from(await readFile(new URL('./fixtures/media/avc-aac.mkv.base64',import.meta.url),'utf8'),'base64');
 mockMediaSource(t);
 t.mock.method(globalThis,'fetch',async(_url,init)=>fixtureResponse(fixture,init));
 const controller=new AbortController();
 const prepared=await prepareRepair({url:'https://media.example.test/movie.mkv',signal:controller.signal});
 controller.abort();assert.throws(()=>prepared.take(),{name:'AbortError'});
 const transferredController=new AbortController();
 const transferred=await prepareRepair({url:'https://media.example.test/movie.mkv',signal:transferredController.signal});
 const ready=transferred.take();transferredController.abort();transferred.dispose();
 try{assert.equal((await ready.input.getPrimaryAudioTrack()).codec,'aac');}
 finally{ready.input.dispose();}
});
