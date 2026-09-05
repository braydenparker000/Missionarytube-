/* Playback evidence stays in memory. Reports use allowlisted fields only:
   no source URLs, titles, provider names, request headers, or raw errors. */
(function(global){
  'use strict';
  const member=(value,allowed)=>allowed.includes(String(value))?String(value):'unknown';
  const number=value=>Number.isFinite(Number(value))?Math.max(0,Math.round(Number(value)*10)/10):0;
  function failureCode(failure={}){
    const message=String(failure.detail||failure.message||'');
    if(/server did not honor the range request/i.test(message))return 'RANGE_UNSUPPORTED';
    const status=message.match(/(?:HTTP(?: error| status)?|status(?: code)?|response)[:\s]+(4\d\d|5\d\d)\b/i)?.[1];
    if(status)return 'HTTP_'+status;
    const kind=member(failure.kind||failure.type||failure.playbackType,['access','network','manifest','decode','unsupported','library','timeout']);
    return kind==='network'?'NETWORK_OR_BROWSER_ACCESS':kind.toUpperCase();
  }
  function describe(failure={}){
    const code=failureCode(failure);
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
      const entry={event:member(event,['start','playing','buffering','seeking','seeked','paused','ended','failure','retry','repair','repair-check','repair-unavailable','repair-cancelled']),seconds:number((now()-began)/1000)};
      if(details.engine)entry.engine=member(details.engine,['native','hls','dash','compatibility']);
      if(details.currentTime!=null)entry.position=number(details.currentTime);
      if(details.failure)entry.failure=failureCode(details.failure);
      // Repeated waiting/playing events should not erase the useful history.
      const previous=events.at(-1);
      if(previous&&previous.event===entry.event&&previous.engine===entry.engine&&previous.failure===entry.failure&&entry.seconds-previous.seconds<1)return;
      events.push(entry);if(events.length>40)events.shift();
    }
    function report({release='',media=null,capabilities={}}={}){
      let droppedFrames=0,totalFrames=0;
      try{const q=media?.getVideoPlaybackQuality?.();droppedFrames=number(q?.droppedVideoFrames);totalFrames=number(q?.totalVideoFrames)}catch{}
      const data={astra:/^\d+\.\d+\.\d+$/.test(release)?release:'unknown',source:{...source},capabilities:{mediaSource:!!capabilities.mediaSource,webCodecs:!!capabilities.webCodecs},playback:{position:number(media?.currentTime),duration:number(media?.duration),readyState:number(media?.readyState),paused:media?.paused!==false,droppedFrames,totalFrames},events:events.map(e=>({...e}))};
      return JSON.stringify(data,null,2);
    }
    return {select,record,report};
  }
  global.AstraPlayback=global.AstraPlayback||{};
  global.AstraPlayback.diagnostics={create,failureCode,describe};
})(typeof globalThis!=='undefined'?globalThis:this);
