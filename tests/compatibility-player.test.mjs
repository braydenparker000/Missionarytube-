import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AppendOnlyStreamTarget,AudioSample,Input,BufferSource,BufferTarget,AudioSampleSink,EncodedPacketSink,ALL_FORMATS} from 'mediabunny';
import {preparePipeline,pumpPipeline,stereoSample} from '../src/compatibility-player.js';
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
