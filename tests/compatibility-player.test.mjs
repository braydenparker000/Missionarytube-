import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AppendOnlyStreamTarget,AudioSample,Input,BufferSource,BufferTarget,AudioSampleSink,EncodedPacketSink,ALL_FORMATS} from 'mediabunny';
import {preparePipeline,pumpPipeline,stereoSample,alignAudioSample,createAdapter} from '../src/compatibility-player.js';
const inputFor=async name=>new Input({source:new BufferSource(Buffer.from(await readFile(new URL(`./fixtures/media/${name}.mkv.base64`,import.meta.url),'utf8'),'base64')),formats:ALL_FORMATS});

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
