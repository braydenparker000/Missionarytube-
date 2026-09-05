import {Input, UrlSource, ALL_FORMATS, EncodedPacketSink, EncodedVideoPacketSource, EncodedAudioPacketSource, AudioSampleSink, AudioSampleSource, AudioSample, Output, Mp4OutputFormat, WebMOutputFormat, AppendOnlyStreamTarget, canEncodeAudio} from 'mediabunny';
import {registerAc3Decoder} from '@mediabunny/ac3';
import {registerDtsDecoder} from '@mediabunny/dts';
registerAc3Decoder();
registerDtsDecoder();

const cancelled = () => new DOMException('Playback cancelled', 'AbortError');
const check = signal => { if(signal?.aborted)throw cancelled(); };
const failureType = error => error?.playbackType || (/fetch|network|http|load failed|connection/i.test(error?.message||'')?'network':/codec|decod|encod/i.test(error?.message||'')?'decode':'unsupported');
const tagFailure = (error,stage) => {if(error&&typeof error==='object'&&error.name!=='AbortError'){if(!error.playbackType)error.playbackType=failureType(error);if(stage&&!error.playbackStage)error.playbackStage=stage;}return error;};
const atStage = async(stage,operation) => {try{return await operation();}catch(error){throw tagFailure(error,stage);}};
const playbackError = (code,stage,message,type='unsupported') => Object.assign(new Error(message),{playbackCode:code,playbackStage:stage,playbackType:type});

function createInput(config) {
  // Mediabunny numbers failed requests from one. Body interruptions also use
  // one, so a shared budget bounds retries across both reads and HLS children.
  let retries=1;
  return new Input({formats:ALL_FORMATS,source:new UrlSource(config.url,{maxCacheSize:16*1024*1024,parallelism:2,
    getRetryDelay:(_attempt,error)=>{
      if(!retries||error?.name==='AbortError'||error?.playbackType==='access'||(failureType(error)!=='network'&&error?.name!=='TypeError'))return null;
      retries--;return .25;
    },requestInit:{credentials:'omit'},fetchFn:(url,init)=>{
      const requests=globalThis.AstraPlayback?.requests;
      if(config.requestPolicy&&!requests)throw new Error('Stream request support did not load. Retry playback.');
      return fetch(url,requests?requests.fetchInit(config.requestPolicy,url,init):init);
    }})});
}

// Probe and plan conversion without touching the playing media element. The
// handle owns its input until take() transfers it once to the new adapter.
export async function prepareRepair(config) {
  check(config.signal);
  let input=createInput(config),plan=null;
  const dispose=()=>{config.signal?.removeEventListener('abort',dispose);if(input){input.dispose();input=null;}};
  config.signal?.addEventListener('abort',dispose,{once:true});
  try {
    plan=await preparePipeline(input,{startTime:config.startTime||0,audioId:config.audioId||'',supports:type=>globalThis.MediaSource?.isTypeSupported(type)||false});
    check(config.signal);
    return {
      take(){check(config.signal);if(!input)throw cancelled();const ready={input,plan};input=null;config.signal?.removeEventListener('abort',dispose);return ready;},
      dispose
    };
  }catch(error){dispose();if(config.signal?.aborted)throw cancelled();throw tagFailure(error);}
}

// Shared by the browser adapter and real-file regression tests. Only audio
// requiring conversion is decoded; video packets retain their original bytes.
export async function preparePipeline(input, {startTime=0,audioId='',supports=()=>true,encodeAudio=canEncodeAudio}={}) {
  const video=await atStage('metadata',()=>input.getPrimaryVideoTrack());
  if(!video)throw playbackError('VIDEO_TRACK_MISSING','metadata','This file has no supported video track.');
  const sourceVideoCodec=await atStage('video-read',()=>video.getCodecParameterString());
  // The pinned MP4 muxer writes hvc1 sample entries even when its demuxer
  // reports hev1. Advertise the output bytes, preserving profile/level fields.
  const videoCodec=video.codec==='hevc'?sourceVideoCodec?.replace(/^hev1\./,'hvc1.'):sourceVideoCodec;
  const formats=[
    {container:'mp4',format:new Mp4OutputFormat({fastStart:'fragmented',minimumFragmentDuration:2})},
    {container:'webm',format:new WebMOutputFormat({appendOnly:true,minimumClusterDuration:2})}
  ].filter(({format})=>videoCodec&&format.getSupportedVideoCodecs().includes(video.codec)&&supports(`${format.mimeType}; codecs="${videoCodec}"`));
  if(!formats.length)throw Object.assign(playbackError('VIDEO_CODEC_UNSUPPORTED','video-support','This device cannot decode the video codec. A transcoding server or an external player is required.'),{playbackCodec:videoCodec});
  const audioTracks=await atStage('metadata',()=>input.getAudioTracks());
  const requestedAudio=audioTracks.find(t=>String(t.id)===String(audioId));
  const primaryAudio=requestedAudio||await atStage('metadata',()=>input.getPrimaryAudioTrack());
  let audio=null,copyAudio=false,audioCodec=null,selected=formats[0];
  let mime=`${selected.format.mimeType}; codecs="${videoCodec}"`;
  const encoders=new Map();
  const canEncode=codec=>{if(!encoders.has(codec))encoders.set(codec,atStage('audio-support',()=>encodeAudio(codec)));return encoders.get(codec);};
  // Preserve a usable selected/default track, trying both browser containers
  // before decoding its audio. A bad default track can fall back within this file.
  const choices=requestedAudio?[requestedAudio]:[primaryAudio,...audioTracks.filter(t=>t!==primaryAudio)].filter(Boolean);
  for(const track of choices){
    const codec=await atStage('audio-read',()=>track.getCodecParameterString());
    const type=codec?await atStage('audio-read',()=>track.getCodec()):null;
    const combined=(format,aCodec)=>`${format.mimeType}; codecs="${videoCodec},${aCodec}"`;
    const copy=codec&&!['ac3','eac3','dts'].includes(type)&&formats.find(({format})=>format.getSupportedAudioCodecs().includes(type)&&supports(combined(format,codec)));
    if(copy){audio=track;copyAudio=true;audioCodec=type;selected=copy;mime=combined(copy.format,codec);break;}
    if(!(await atStage('audio-support',()=>track.canDecode())))continue;
    // Some browsers accept Opus only in WebM, while others expose AAC encoding.
    // Check the full output codec combination instead of assuming MP4 + Opus.
    for(const candidate of formats){
      for(const encoded of ['opus','aac']){
        const parameter=encoded==='aac'?'mp4a.40.2':encoded;
        if(!candidate.format.getSupportedAudioCodecs().includes(encoded)||!supports(combined(candidate.format,parameter))||!(await canEncode(encoded)))continue;
        audio=track;audioCodec=encoded;selected=candidate;mime=combined(candidate.format,parameter);break;
      }
      if(audio)break;
    }
    if(audio)break;
  }
  if(choices.length&&!audio)throw playbackError('AUDIO_CODEC_UNSUPPORTED','audio-support','No playable audio track is available on this device. Try another source or an external player.');
  const sink=new EncodedPacketSink(video);
  const first=await atStage('video-read',async()=>await sink.getKeyPacket(startTime)||await sink.getFirstKeyPacket());
  if(!first)throw playbackError('VIDEO_KEYFRAME_MISSING','video-read','No usable video keyframe was found.');
  // Audio packets commonly overlap the chosen video keyframe. Give both
  // copied tracks one shared origin instead of creating negative mux timestamps
  // or dropping/re-timing the overlapping audio packet during a seek.
  const audioSink=audio&&copyAudio?new EncodedPacketSink(audio):null;
  const firstAudio=audioSink?await atStage('audio-read',async()=>startTime===0?await audioSink.getFirstPacket():await audioSink.getPacket(first.timestamp)||await audioSink.getFirstPacket()):null;
  const base=firstAudio?Math.min(first.timestamp,firstAudio.timestamp):Math.max(0,first.timestamp);
  if(!supports(mime))throw Object.assign(playbackError('TRACK_COMBINATION_UNSUPPORTED','video-support','Chrome cannot combine these tracks. Use an external player or server conversion.'),{playbackCodec:videoCodec});
  return {video,audio,audioTracks,copyAudio,audioCodec,format:selected.format,container:selected.container,sink,first,audioSink,firstAudio,base,mime,duration:await atStage('metadata',()=>input.getDurationFromMetadata())};
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

export function alignAudioSample(sample, base) {
  const skip=Math.max(0,Math.ceil((base-sample.timestamp)*sample.sampleRate));
  if(skip>=sample.numberOfFrames)return null;
  return skip?sample.trim(skip):sample;
}

export async function pumpPipeline(plan,{target,signal,pace=async()=>{},onOutput=()=>{}}) {
  const {video,audio,copyAudio,sink,first,base}=plan;
  const output=new Output({format:plan.format,target});
  onOutput(output);
  const vSource=new EncodedVideoPacketSource(video.codec);
  output.addVideoTrack(vSource);
  // Match the 48 kHz stereo configuration checked by canEncodeAudio. Source
  // files may contain 96/192 kHz audio that the browser encoder cannot accept.
  const aSource=audio?(copyAudio?new EncodedAudioPacketSource(audio.codec):new AudioSampleSource({codec:plan.audioCodec,bitrate:160000,transform:{sampleRate:48000,numberOfChannels:2}})):null;
  if(aSource)output.addAudioTrack(aSource);
  await atStage('mux',()=>output.start());
  const vConfig=await atStage('video-read',()=>video.getDecoderConfig());
  const videoJob=async()=>{
    try {for await(const packet of sink.packets(first)) {
      check(signal);await pace(packet.timestamp);check(signal);
      // HEVC open GOPs can place leading RASL pictures after the chosen CRA
      // keyframe in decode order. Their presentation times precede that random
      // access point and they depend on pictures omitted by a seek. Discard
      // those leading pictures; keep every retained encoded packet unchanged.
      if(video.codec==='hevc'&&packet.timestamp<first.timestamp)continue;
      await atStage('mux',()=>vSource.add(packet.clone({timestamp:packet.timestamp-base}),{decoderConfig:vConfig}));
    }} catch(error){throw tagFailure(error,'video-read');}finally {vSource.close();}
  };
  const audioJob=async()=>{
    if(!audio)return;
    try {
      if(copyAudio){
        const aSink=plan.audioSink,config=await atStage('audio-read',()=>audio.getDecoderConfig());
        const aFirst=plan.firstAudio;
        if(aFirst)for await(const packet of aSink.packets(aFirst)) {
          check(signal);await pace(packet.timestamp);check(signal);
          if(packet.timestamp<base&&packet.timestamp+packet.duration<=base)continue;
          await atStage('mux',()=>aSource.add(packet.clone({timestamp:packet.timestamp-base}),{decoderConfig:config}));
        }
      }else{
        for await(const sample of new AudioSampleSink(audio).samples(base)) {
          let aligned=sample;
          try {check(signal);await pace(sample.timestamp);check(signal);aligned=alignAudioSample(sample,base);if(!aligned)continue;
            const stereo=stereoSample(aligned);try{stereo.setTimestamp(Math.max(0,aligned.timestamp-base));await atStage('audio-encode',()=>aSource.add(stereo));}finally{if(stereo!==aligned)stereo.close();}
          }finally{if(aligned&&aligned!==sample)aligned.close();sample.close();}
        }
      }
    }catch(error){throw tagFailure(error,copyAudio?'audio-read':'audio-decode');}finally{aSource.close();}
  };
  try {await Promise.all([videoJob(),audioJob()]);check(signal);await atStage('mux',()=>output.finalize());}
  catch(error){await output.cancel().catch(()=>{});throw error;}
}

export function createAdapter(config) {
  const media=config.media;
  let destroyed=false,current=null,audioId='',tracks=[],duration=0,prepared=config.prepared||null;
  const fail=error=>{if(!destroyed&&error?.name!=='AbortError')config.onError?.({type:failureType(error),detail:error?.message||'Compatibility playback failed.',playbackCode:error?.playbackCode,playbackStage:error?.playbackStage,playbackCodec:error?.playbackCodec});};
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
    const ready=prepared?.take();prepared=null;
    const run={controller:new AbortController(),input:ready?.input||createInput(config)};current=run;
    const signal=run.controller.signal;
    try {
    const plan=ready?.plan||await preparePipeline(run.input,{startTime:time,audioId,supports:type=>MediaSource.isTypeSupported(type)});check(signal);
    duration=plan.duration||0;
    tracks=await Promise.all(plan.audioTracks.map(async(t,i)=>({id:String(t.id),label:(await t.getName())||(await t.getLanguageCode())||`Audio ${i+1}`,lang:await t.getLanguageCode(),active:t===plan.audio})));
    audioId=plan.audio?String(plan.audio.id):'';config.onAudioTracksChanged?.(tracks);check(signal);
    const ms=new MediaSource();run.ms=ms;run.objectUrl=URL.createObjectURL(ms);
    await atStage('media-source',()=>event(run,ms,'sourceopen',()=>{media.src=run.objectUrl;}));check(signal);
    const sb=await atStage('media-source',()=>ms.addSourceBuffer(plan.mime));sb.timestampOffset=plan.base;
    if(duration>0)ms.duration=duration;
    let positioned=false;
    const append=async bytes=>{
      check(signal);
      const cutoff=media.currentTime-20;
      if(sb.buffered.length&&cutoff>sb.buffered.start(0)+5)await atStage('media-append',()=>event(run,sb,'updateend',()=>sb.remove(0,cutoff)));
      await atStage('media-append',()=>event(run,sb,'updateend',()=>sb.appendBuffer(bytes)));
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
    }catch(error){
      // A cancelled metadata read may reject with InputDisposedError instead
      // of AbortError. Do not let that stale attempt fail a newer seek/retry.
      const stale=current!==run||signal.aborted;
      if(current===run)disposeRun();
      if(stale)throw cancelled();
      throw tagFailure(error);
    }
  }
  config.scope?.listen?.(media,'error',()=>fail(playbackError('MEDIA_DECODE_FAILED','media-playback','Chrome could not decode the converted stream. This video may need server conversion.','decode')));
  const api={kind:'compatibility',attach:()=>start(config.startTime||0,config.autoplay!==false),destroy(){destroyed=true;prepared?.dispose();prepared=null;disposeRun();},getAudioTracks:()=>tracks,
    selectAudioTrack(id){if(!tracks.some(t=>t.id===String(id)))return false;if(audioId===String(id))return true;audioId=String(id);start(media.currentTime,!media.paused).catch(fail);return true;},
    seekTo(time){const target=Math.max(0,Math.min(duration||Infinity,time));for(let i=0;i<media.buffered.length;i++)if(target>=media.buffered.start(i)&&target<media.buffered.end(i)){media.currentTime=target;return;}start(target,!media.paused).catch(fail);},
    getVideoQualities:()=>[],selectVideoQuality:()=>false};
  config.scope?.onDispose?.(()=>api.destroy());return api;
}

globalThis.AstraCompatibility={createAdapter,prepareRepair};
