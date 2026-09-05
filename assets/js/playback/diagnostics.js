/* Playback evidence stays in memory. Reports use allowlisted fields only:
   no source URLs, titles, provider names, request headers, or raw errors. */
(function(global){
  'use strict';
  const member=(value,allowed)=>allowed.includes(String(value))?String(value):'unknown';
  const number=value=>Number.isFinite(Number(value))?Math.max(0,Math.round(Number(value)*10)/10):0;
  const codes=['VIDEO_TRACK_MISSING','VIDEO_CODEC_UNSUPPORTED','AUDIO_CODEC_UNSUPPORTED','VIDEO_KEYFRAME_MISSING','TRACK_COMBINATION_UNSUPPORTED','MEDIA_DECODE_FAILED'];
  const stages=['metadata','video-support','audio-support','video-read','audio-read','audio-decode','audio-encode','mux','media-source','media-append','media-playback'];
  const codecParameter=value=>typeof value==='string'&&/^(?:avc[13]\.[a-f\d]{6}|h(?:vc|ev)1\.[A-C]?\d{1,2}\.[A-F\d]{1,8}\.[LH]\d{1,3}(?:\.[A-F\d]{1,2}){0,6})$/i.test(value)?value:null;
  function failureCode(failure={}){
    if(codes.includes(failure.playbackCode))return failure.playbackCode;
    const message=String(failure.detail||failure.message||'');
    if(/server did not honor the range request/i.test(message))return 'RANGE_UNSUPPORTED';
    const status=message.match(/(?:HTTP(?: error| status)?|status(?: code)?|response)[:\s]+(4\d\d|5\d\d)\b/i)?.[1];
    if(status)return 'HTTP_'+status;
    const kind=member(failure.kind||failure.type||failure.playbackType,['access','network','manifest','decode','unsupported','library','timeout']);
    return kind==='network'?'NETWORK_OR_BROWSER_ACCESS':kind.toUpperCase();
  }
  function describe(failure={}){
    const code=failureCode(failure);
    if(code==='VIDEO_CODEC_UNSUPPORTED')return 'Chrome does not accept this video format for conversion on this device. Try another source, such as H.264, or an external player.';
    if(code==='AUDIO_CODEC_UNSUPPORTED')return 'Astra could not decode or convert an audio track in this file. Try another source or an external player.';
    if(code==='VIDEO_TRACK_MISSING')return 'Astra could not find a readable video track in this file.';
    if(code==='VIDEO_KEYFRAME_MISSING')return 'Astra could not find a video frame to start from at this position.';
    if(code==='TRACK_COMBINATION_UNSUPPORTED')return 'Chrome does not accept this combination of video and audio tracks.';
    if(code==='MEDIA_DECODE_FAILED')return 'Chrome rejected the converted media. Another source or an external player may work.';
    if(code==='HTTP_401'||code==='HTTP_403')return 'The provider refused this request. The link may require authorization or access through another player.';
    if(code==='HTTP_404'||code==='HTTP_410')return 'This stream link is missing or expired. Choose another source or refresh the source list.';
    if(code==='HTTP_429')return 'The provider is limiting requests. Wait before retrying.';
    if(code.startsWith('HTTP_5'))return 'The provider returned a server error. Try another source.';
    if(code==='NETWORK_OR_BROWSER_ACCESS')return 'Chrome could not read the stream. This can be a connection problem or a provider restriction; the browser does not always reveal which.';
    if(code==='RANGE_UNSUPPORTED')return 'The provider does not support the file reads needed to repair or seek this stream. Choose another source or an external player.';
    if(code==='ACCESS')return 'The stream requires access settings that Chrome cannot apply. Use another source or a configured media server.';
    if(code==='TIMEOUT')return 'Playback stopped making progress. Retry this stream or choose another source.';
    if(code==='DECODE'||code==='UNSUPPORTED')return 'This playback method could not decode the media. Another source or an external player may work.';
    if(code==='MANIFEST')return 'The streaming playlist could not be read.';
    if(code==='LIBRARY')return 'A playback component could not load. Retry after checking your connection.';
    return 'Playback could not continue. Retry or choose another source.';
  }
  function create({now=()=>Date.now()}={}){
    const began=now(),events=[];let source={};
    function select(stream={}){
      const f=stream.facts||{};
      source={delivery:member(stream.kind,['direct','hls','dash','youtube','torrent','external']),container:member(f.container,['MP4','MKV','WebM','MOV','TS','AVI','MP3','M4A','AAC','FLAC','OGG','Opus','WAV']),video:member(f.codec,['H.264','H.265','HEVC','AV1','VP8','VP9','MPEG-2','MPEG-4']),audio:member(f.audioCodec,['AAC','AC3','AC-3','EAC3','E-AC-3','DTS','DTS-HD','TrueHD','FLAC','MP3','Opus','Vorbis','PCM']),requestHeaders:!!stream.requestPolicy?.required};
    }
    function record(event,details={}){
      const entry={event:member(event,['start','playing','buffering','seeking','seeked','paused','ended','failure','retry','restart','repair','repair-check','repair-unavailable','repair-cancelled','picture-missing']),seconds:number((now()-began)/1000)};
      if(details.engine)entry.engine=member(details.engine,['native','hls','dash','compatibility']);
      if(details.currentTime!=null)entry.position=number(details.currentTime);
      if(details.failure)entry.failure=failureCode(details.failure);
      if(stages.includes(details.failure?.playbackStage))entry.stage=details.failure.playbackStage;
      const codec=codecParameter(details.failure?.playbackCodec);if(codec)entry.codec=codec;
      // Repeated waiting/playing events should not erase the useful history.
      const previous=events.at(-1);
      if(previous&&previous.event===entry.event&&previous.engine===entry.engine&&previous.failure===entry.failure&&entry.seconds-previous.seconds<1)return;
      events.push(entry);if(events.length>40)events.shift();
    }
    function report({release='',media=null,capabilities={}}={}){
      const metrics=global.AstraPlayback.videoHealth.readMedia(media);
      const data={astra:/^\d+\.\d+\.\d+$/.test(release)?release:'unknown',source:{...source},capabilities:{mediaSource:!!capabilities.mediaSource,webCodecs:!!capabilities.webCodecs},playback:{position:number(media?.currentTime),duration:number(media?.duration),readyState:number(media?.readyState),paused:media?.paused!==false,seeking:media?.seeking===true,videoWidth:metrics.videoWidth,videoHeight:metrics.videoHeight,frameMetricsAvailable:metrics.frameMetricsAvailable,droppedFrames:metrics.droppedFrames,totalFrames:metrics.totalFrames},events:events.map(e=>({...e}))};
      return JSON.stringify(data,null,2);
    }
    return {select,record,report};
  }
  global.AstraPlayback=global.AstraPlayback||{};
  global.AstraPlayback.diagnostics={create,failureCode,describe};
})(typeof globalThis!=='undefined'?globalThis:this);
