import {Input, UrlSource, ALL_FORMATS, EncodedPacketSink, EncodedVideoPacketSource, EncodedAudioPacketSource, AudioSampleSink, AudioSampleSource, AudioSample, Output, Mp4OutputFormat, AppendOnlyStreamTarget, canEncodeAudio} from 'mediabunny';
import {registerAc3Decoder} from '@mediabunny/ac3';
import {registerDtsDecoder} from '@mediabunny/dts';
registerAc3Decoder();
registerDtsDecoder();

const cancelled = () => new DOMException('Playback cancelled', 'AbortError');
const check = signal => { if(signal?.aborted)throw cancelled(); };

// Shared by the browser adapter and real-file regression tests. Only audio
// requiring conversion is decoded; video packets retain their original bytes.
export async function preparePipeline(input, {startTime=0,audioId='',supports=()=>true,encodeAudio=canEncodeAudio}={}) {
  const video=await input.getPrimaryVideoTrack();
  if(!video)throw new Error('This file has no supported video track.');
  const videoCodec=await video.getCodecParameterString();
  if(!videoCodec||!supports(`video/mp4; codecs="${videoCodec}"`))throw new Error('This device cannot decode the video codec. A transcoding server or an external player is required.');
  const audioTracks=await input.getAudioTracks();
  const audio=audioTracks.find(t=>String(t.id)===String(audioId))||await input.getPrimaryAudioTrack();
  const audioCodec=audio&&await audio.getCodecParameterString();
  const copyAudio=!!audioCodec&&supports(`audio/mp4; codecs="${audioCodec}"`);
  if(audio&&!copyAudio&&(!(await audio.canDecode())||!(await encodeAudio('opus'))))throw new Error('The selected audio track cannot be converted on this device. Try another audio track or an external player.');
  const sink=new EncodedPacketSink(video);
  const first=await sink.getKeyPacket(startTime)||await sink.getFirstKeyPacket();
  if(!first)throw new Error('No usable video keyframe was found.');
  const base=Math.max(0,first.timestamp);
  const mime=`video/mp4; codecs="${videoCodec}${audio?','+(copyAudio?audioCodec:'opus'):''}"`;
  if(!supports(mime))throw new Error('Chrome cannot combine these tracks. Use an external player or server conversion.');
  return {video,audio,audioTracks,copyAudio,sink,first,base,mime,duration:await input.getDurationFromMetadata()};
}

export function stereoSample(sample) {
  if(sample.numberOfChannels<=2)return sample;
  const count=sample.numberOfFrames, channels=sample.numberOfChannels;
  const planes=Array.from({length:channels},()=>new Float32Array(count));
  planes.forEach((plane,index)=>sample.copyTo(plane,{planeIndex:index,format:'f32-planar'}));
  const data=new Float32Array(count*2), weight=1+.707+.5+Math.ceil((channels-4)/2)*.707;
  for(let i=0;i<count;i++){
    let left=planes[0][i]+planes[2][i]*.707+(planes[3]?.[i]||0)*.5;
    let right=planes[1][i]+planes[2][i]*.707+(planes[3]?.[i]||0)*.5;
    for(let c=4;c<channels;c++)if(c%2)right+=planes[c][i]*.707;else left+=planes[c][i]*.707;
    data[i]=left/weight;data[count+i]=right/weight;
  }
  return new AudioSample({data,format:'f32-planar',sampleRate:sample.sampleRate,numberOfChannels:2,timestamp:sample.timestamp});
}

export async function pumpPipeline(plan,{target,signal,pace=async()=>{},onOutput=()=>{}}) {
  const {video,audio,copyAudio,sink,first,base}=plan;
  const output=new Output({format:new Mp4OutputFormat({fastStart:'fragmented',minimumFragmentDuration:2}),target});
  onOutput(output);
  const vSource=new EncodedVideoPacketSource(video.codec);
  output.addVideoTrack(vSource);
  const aSource=audio?(copyAudio?new EncodedAudioPacketSource(audio.codec):new AudioSampleSource({codec:'opus',bitrate:160000})):null;
  if(aSource)output.addAudioTrack(aSource);
  await output.start();
  const vConfig=await video.getDecoderConfig();
  const videoJob=async()=>{
    try {for await(const packet of sink.packets(first)) {
      check(signal);await pace(packet.timestamp);check(signal);
      await vSource.add(packet.clone({timestamp:packet.timestamp-base}),{decoderConfig:vConfig});
    }} finally {vSource.close();}
  };
  const audioJob=async()=>{
    if(!audio)return;
    try {
      if(copyAudio){
        const aSink=new EncodedPacketSink(audio),config=await audio.getDecoderConfig();
        const aFirst=await aSink.getPacket(base)||await aSink.getFirstPacket();
        if(aFirst)for await(const packet of aSink.packets(aFirst)) {
          check(signal);await pace(packet.timestamp);check(signal);
          if(packet.timestamp+packet.duration<=base)continue;
          await aSource.add(packet.clone({timestamp:packet.timestamp-base}),{decoderConfig:config});
        }
      }else{
        for await(const sample of new AudioSampleSink(audio).samples(base)) {
          try {check(signal);await pace(sample.timestamp);check(signal);const stereo=stereoSample(sample);try{stereo.setTimestamp(sample.timestamp-base);await aSource.add(stereo);}finally{if(stereo!==sample)stereo.close();}}finally{sample.close();}
        }
      }
    }finally{aSource.close();}
  };
  try {await Promise.all([videoJob(),audioJob()]);check(signal);await output.finalize();}
  catch(error){await output.cancel().catch(()=>{});throw error;}
}

export function createAdapter(config) {
  const media=config.media;
  let destroyed=false,current=null,audioId='',tracks=[],duration=0;
  const fail=error=>{if(!destroyed&&error?.name!=='AbortError')config.onError?.({type:'unsupported',detail:error?.message||'Compatibility playback failed.'});};
  function disposeRun(){
    const run=current;current=null;if(!run)return;
    run.controller.abort();run.input.dispose();run.output?.cancel().catch(()=>{});
    if(run.objectUrl)URL.revokeObjectURL(run.objectUrl);
  }
  function event(run,target,name,action){
    return new Promise((resolve,reject)=>{
      const done=()=>{cleanup();resolve();},bad=()=>{cleanup();reject(new Error('Chrome rejected the converted media.'));},abort=()=>{cleanup();reject(cancelled());};
      const cleanup=()=>{target.removeEventListener(name,done);target.removeEventListener('error',bad);run.controller.signal.removeEventListener('abort',abort);};
      target.addEventListener(name,done,{once:true});target.addEventListener('error',bad,{once:true});run.controller.signal.addEventListener('abort',abort,{once:true});
      try{check(run.controller.signal);action?.();}catch(e){cleanup();reject(e);}
    });
  }
  async function start(time=0,autoplay=true){
    disposeRun();if(destroyed)return;
    const run={controller:new AbortController(),input:new Input({formats:ALL_FORMATS,source:new UrlSource(config.url,{maxCacheSize:16*1024*1024,parallelism:2,getRetryDelay:n=>n<1?1:null,requestInit:{credentials:'omit'}})})};current=run;
    const signal=run.controller.signal;
    const plan=await preparePipeline(run.input,{startTime:time,audioId,supports:type=>MediaSource.isTypeSupported(type)});check(signal);
    duration=plan.duration||0;
    tracks=await Promise.all(plan.audioTracks.map(async(t,i)=>({id:String(t.id),label:(await t.getName())||(await t.getLanguageCode())||`Audio ${i+1}`,lang:await t.getLanguageCode(),active:t===plan.audio})));
    audioId=plan.audio?String(plan.audio.id):'';config.onAudioTracksChanged?.(tracks);check(signal);
    const ms=new MediaSource();run.ms=ms;run.objectUrl=URL.createObjectURL(ms);
    await event(run,ms,'sourceopen',()=>{media.src=run.objectUrl;});check(signal);
    const sb=ms.addSourceBuffer(plan.mime);sb.timestampOffset=plan.base;
    if(duration>0)ms.duration=duration;
    let positioned=false;
    const append=async bytes=>{
      check(signal);
      const cutoff=media.currentTime-20;
      if(sb.buffered.length&&cutoff>sb.buffered.start(0)+5)await event(run,sb,'updateend',()=>sb.remove(0,cutoff));
      await event(run,sb,'updateend',()=>sb.appendBuffer(bytes));
      if(!positioned&&sb.buffered.length){positioned=true;media.currentTime=Math.max(time,sb.buffered.start(0));if(autoplay)media.play().catch(()=>{});}
    };
    const pace=async timestamp=>{
      // Bound decoded work and network read-ahead even while paused.
      while(timestamp>Math.max(time,media.currentTime)+30){check(signal);await new Promise((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(cancelled());};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},250);signal.addEventListener('abort',abort,{once:true});});}
      check(signal);
    };
    run.job=pumpPipeline(plan,{target:new AppendOnlyStreamTarget(new WritableStream({write:append})),signal,pace,onOutput:out=>run.output=out})
      .then(()=>{check(signal);if(ms.readyState==='open')ms.endOfStream();})
      .catch(error=>{if(current===run&&!signal.aborted){disposeRun();fail(error);}});
  }
  config.scope?.listen?.(media,'error',()=>fail(new Error('Chrome could not decode the converted stream. This video may need server conversion.')));
  const api={kind:'compatibility',attach:()=>start(config.startTime||0),destroy(){destroyed=true;disposeRun();},getAudioTracks:()=>tracks,
    selectAudioTrack(id){if(!tracks.some(t=>t.id===String(id)))return false;if(audioId===String(id))return true;audioId=String(id);start(media.currentTime,!media.paused).catch(fail);return true;},
    seekTo(time){const target=Math.max(0,Math.min(duration||Infinity,time));for(let i=0;i<media.buffered.length;i++)if(target>=media.buffered.start(i)&&target<media.buffered.end(i)){media.currentTime=target;return;}start(target,!media.paused).catch(fail);},
    getVideoQualities:()=>[],selectVideoQuality:()=>false};
  config.scope?.onDispose?.(()=>api.destroy());return api;
}

globalThis.AstraCompatibility={createAdapter};
