/* libmedia is loaded only when container/audio remuxing cannot decode a file. */
(function(global){
  'use strict';
  const base=new URL('libmedia/',document.currentScript.src);
  const releaseQuery=new URL(document.currentScript.src).search;
  const codecs={27:'h264',173:'hevc',139:'vp8',167:'vp9',225:'av1',86018:'aac',86019:'ac3',86056:'eac3',86020:'dca',86017:'mp3',86076:'opus',86028:'flac',86021:'vorbis'};
  const abort=()=>new DOMException('Playback cancelled','AbortError');
  const error=(code,type='decode')=>Object.assign(new Error('The decoder could not play this file.'),{playbackType:type,playbackCode:code});
  let library;
  function load(){
    if(global.AVPlayer)return Promise.resolve(global.AVPlayer);
    if(!library)library=new Promise((resolve,reject)=>{
      const script=document.createElement('script'),timer=setTimeout(()=>done(false),15000);
      const done=ok=>{clearTimeout(timer);script.onload=script.onerror=null;if(ok&&global.AVPlayer)resolve(global.AVPlayer);else{script.remove();library=null;reject(error(null,'library'));}};
      const url=new URL('avplayer.js',base);url.search=releaseQuery;
      script.src=url;script.onload=()=>done(true);script.onerror=()=>done(false);document.head.append(script);
    });
    return library;
  }
  // Bounded, seekable reads through the same credential/redirect policy as
  // remuxing. No provider URLs are handed to the third-party logging layer.
  function source(AVPlayer,config){
    return new class extends AVPlayer.IOLoader.CustomIOLoader {
      constructor(){super();this.position=0;this.total=0;this.bytes=new Uint8Array();this.offset=0;this.controller=null;this.closed=false;this.url=config.url;}
      get ext(){return '';}
      get name(){return 'Astra stream';}
      get flags(){return 5;}
      async open(){
        if(config.signal?.aborted)throw abort();
        this.closed=false;this.position=0;this.offset=0;this.bytes=new Uint8Array();
        if(!config.requestPolicy?.required&&global.AstraPlayback.delivery)this.url=await global.AstraPlayback.delivery.resolve(this.url,{signal:config.signal});
        if(this.closed||config.signal?.aborted)throw abort();
        await this.fill();return 0;
      }
      async fill(){
        if(this.closed||config.signal?.aborted)throw abort();
        if(this.total&&this.position>=this.total){this.bytes=new Uint8Array();this.offset=0;return;}
        const controller=new AbortController();this.controller=controller;
        const cancel=()=>controller.abort(),timer=setTimeout(cancel,20000);
        config.signal?.addEventListener('abort',cancel,{once:true});
        const start=this.position,limit=2*1024*1024;
        try{
          const init=global.AstraPlayback.requests.fetchInit(config.requestPolicy,this.url,{signal:controller.signal,headers:{Range:`bytes=${start}-${start+limit-1}`},credentials:'omit',mode:'cors',referrerPolicy:'no-referrer'});
          const response=await fetch(this.url,init);
          if(!response.ok)throw error(null,'network');
          const range=response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(\d+|\*)$/);
          if(range&&Number(range[1])!==start||start&&response.status!==206)throw error('RANGE_UNSUPPORTED','network');
          if(range&&range[3]!=='*')this.total=Number(range[3]);
          if(response.status===200){const length=Number(response.headers.get('content-length'));if(length>limit)throw error('RANGE_UNSUPPORTED','network');if(length)this.total=length;}
          const reader=response.body.getReader(),parts=[];let size=0;
          while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit)throw error('RANGE_UNSUPPORTED','network');parts.push(next.value);}
          this.bytes=new Uint8Array(size);let at=0;for(const part of parts){this.bytes.set(part,at);at+=part.length;}this.offset=0;
          if(size<limit&&!this.total)this.total=start+size;
        }catch(e){if(!this.closed&&!config.signal?.aborted)config.onReadError?.(e.playbackType?e:error(null,'network'));throw e;}
        finally{controller.abort();clearTimeout(timer);config.signal?.removeEventListener('abort',cancel);}
      }
      async read(buffer){
        if(this.closed) return -7;
        if(this.offset>=this.bytes.length){await this.fill();if(!this.bytes.length)return -7;}
        const count=Math.min(buffer.length,this.bytes.length-this.offset);buffer.set(this.bytes.subarray(this.offset,this.offset+count));this.offset+=count;this.position+=count;return count;
      }
      async seek(pos){
        const target=Number(pos);if(!Number.isSafeInteger(target)||target<0)return -3;
        const beginning=this.position-this.offset;
        if(target>=beginning&&target<=beginning+this.bytes.length)this.offset=target-beginning;
        else{this.controller?.abort();this.bytes=new Uint8Array();this.offset=0;}
        this.position=target;return 0;
      }
      async size(){return BigInt(this.total);}
      async stop(){this.closed=true;this.controller?.abort();this.bytes=new Uint8Array();}
    }();
  }
  async function prepare(config){
    const AVPlayer=await load();if(config.signal?.aborted)throw abort();
    AVPlayer.setLogLevel(config.debug===true?2:5);
    const stream=new MediaStream(),controller=new AbortController();
    let taken=false,disposed=false,rejectFailure,readFailure;
    const failed=new Promise((_,reject)=>rejectFailure=reject);failed.catch(()=>{});
    const engine=new AVPlayer({container:stream,checkUseMSE:()=>false,enableHardware:config.forceSoftware!==true,enableWebCodecs:config.forceSoftware!==true,enableWorker:true,enableWebGPU:false,preLoadTime:2,
      getWasm(type,id){const codec=codecs[id]||(id>=65536&&id<=65572?'pcm':null);const path=type==='decoder'&&codec?`decode/${codec}-simd.wasm`:type==='resampler'?'resample/resample-simd.wasm':type==='stretchpitcher'?'stretchpitch/stretchpitch-simd.wasm':null;if(!path)throw error('VIDEO_CODEC_UNSUPPORTED');return new URL(path,base).href;}
    });
    const io=source(AVPlayer,{...config,signal:controller.signal,onReadError:e=>{readFailure=e;rejectFailure(e);}});
    engine.on('error',()=>rejectFailure(readFailure||error('MEDIA_DECODE_FAILED')));
    function dispose(){if(disposed)return;disposed=true;controller.abort();config.signal?.removeEventListener('abort',cancel);io.stop();stream.getTracks().forEach(t=>t.stop());engine.destroy().catch(()=>{});}
    function cancel(){rejectFailure(abort());dispose();}
    config.signal?.addEventListener('abort',cancel,{once:true});
    try{
      await Promise.race([engine.load(io),failed]);
      if(config.signal?.aborted||disposed)throw abort();
      if(!engine.getStreams().some(s=>String(s.mediaType).toLowerCase()==='video'))throw error('VIDEO_TRACK_MISSING');
      return {kind:'software',dispose,take(){if(taken||disposed)throw abort();taken=true;config.signal?.removeEventListener('abort',cancel);return {engine,stream,dispose,failed};}};
    }catch(e){dispose();throw e;}
  }
  function createAdapter(config){
    const media=config.media,controller=new AbortController();let ready,dead=false,ended=false,seeking=false,duration=0,prepared=config.prepared,rate=media.playbackRate||1;
    let queue=Promise.resolve(),pendingSeek=null;
    const original=new Map(),listeners=[];
    const nativePlay=media.play.bind(media),nativePause=media.pause.bind(media);
    const emit=name=>{if(!dead)media.dispatchEvent(new Event(name));};
    const fail=e=>{if(!dead&&e?.name!=='AbortError')config.onError?.({type:e.playbackType||'decode',playbackCode:e.playbackCode,detail:'The decoder could not continue playback.'});};
    const serial=fn=>{queue=queue.then(()=>dead?undefined:fn()).catch(fail);return queue;};
    const define=(key,descriptor)=>{original.set(key,Object.getOwnPropertyDescriptor(media,key));Object.defineProperty(media,key,{configurable:true,...descriptor});};
    const tracks=()=>ready?ready.engine.getStreams().filter(s=>String(s.mediaType).toLowerCase()==='audio').map((s,i)=>({id:String(s.id),label:s.metadata?.title||s.metadata?.language||`Audio ${i+1}`,lang:s.metadata?.language||'',active:s.id===ready.engine.getSelectedAudioStreamId()})):[];
    const api={kind:'software',async attach(){
      if(!prepared)prepared=await prepare({...config,signal:controller.signal});
      if(dead){prepared.dispose();return;}
      ready=prepared.take();prepared=null;ready.failed.catch(fail);
      const engine=ready.engine;duration=Number(engine.getDuration())/1000;
      define('currentTime',{get:()=>Math.max(0,Number(engine.currentTime)/1000),set:value=>api.seekTo(value)});
      define('astraCaptionClock',{value:true});define('astraCaptionTrack',{writable:true,value:null});
      const captions=document.createElement('div');captions.className='software-captions';media.parentNode?.append(captions);
      const paintCaptions=()=>{
        const track=media.astraCaptionTrack,time=media.currentTime;
        const active=Array.from(track?.cues||[]).filter(cue=>cue.startTime<=time&&cue.endTime>time);
        captions.replaceChildren(...active.map(cue=>{const line=document.createElement('div');line.append(cue.getCueAsHTML());return line;}));
      };
      define('astraCaptionUpdate',{value:paintCaptions});
      config.scope?.onDispose?.(()=>captions.remove());
      listeners.push(['astra-destroy-captions',()=>captions.remove()]);
      define('duration',{get:()=>duration});define('seeking',{get:()=>seeking});define('ended',{get:()=>ended});
      define('playbackRate',{get:()=>rate,set:value=>{rate=value;engine.setPlaybackRate(rate);}});
      define('play',{value:()=>{const native=nativePlay();serial(async()=>{await engine.resume();await engine.play({audio:true,video:true,subtitle:false});});return native;}});
      define('pause',{value:()=>{nativePause();serial(()=>engine.pause());}});
      // PiP's controls invoke native methods; route those events too.
      const listen=(name,fn)=>{media.addEventListener(name,fn);listeners.push([name,fn]);};
      listen('pause',()=>{if(!ended)serial(()=>engine.pause());});
      listen('play',()=>serial(async()=>{await engine.resume();await engine.play({audio:true,video:true,subtitle:false});}));
      listen('timeupdate',paintCaptions);
      engine.on('seeking',()=>{seeking=true;emit('seeking');emit('waiting');});
      engine.on('seeked',()=>{seeking=false;ended=false;emit('seeked');emit('timeupdate');if(!media.paused)emit('playing');});
      engine.on('ended',()=>{ended=true;nativePause();emit('timeupdate');emit('ended');});
      engine.on('time',()=>emit('timeupdate'));
      engine.on('changed',()=>config.onAudioTracksChanged?.(tracks()));
      engine.setPlaybackRate(rate);
      await Promise.race([engine.play({audio:true,video:true,subtitle:false}),ready.failed]);
      if(dead)return;
      const language=String(config.audioLanguage||'').toLowerCase();
      const preferred=language&&tracks().find(t=>String(t.lang).toLowerCase().split('-')[0]===language.split('-')[0]);
      if(preferred&&!preferred.active)await engine.selectAudio(Number(preferred.id));
      if(config.startTime>0)await Promise.race([engine.seek(BigInt(Math.round(config.startTime*1000))),ready.failed]);
      if(dead)return;
      media.srcObject=ready.stream;emit('durationchange');
      config.onAudioTracksChanged?.(tracks());
      if(config.autoplay!==false){await engine.resume();nativePlay().catch(()=>{});}else await engine.pause();
    },destroy(){
      if(dead)return;dead=true;controller.abort();prepared?.dispose();ready?.dispose();
      listeners.forEach(([name,fn])=>{if(name==='astra-destroy-captions')fn();else media.removeEventListener(name,fn);});nativePause();media.srcObject=null;
      for(const [key,descriptor] of original){if(descriptor)Object.defineProperty(media,key,descriptor);else delete media[key];}
    },getAudioTracks:tracks,selectAudioTrack(id){if(!tracks().some(t=>t.id===String(id)))return false;serial(()=>ready.engine.selectAudio(Number(id)));return true;},
    seekTo(value){if(!ready||!Number.isFinite(value))return;pendingSeek=Math.max(0,Math.min(duration||Infinity,value));serial(async()=>{if(pendingSeek===null)return;const time=pendingSeek;pendingSeek=null;await ready.engine.seek(BigInt(Math.round(time*1000)));});},getVideoQualities:()=>[],selectVideoQuality:()=>false};
    config.scope?.onDispose?.(()=>api.destroy());return api;
  }
  global.AstraSoftware={prepare,createAdapter,source};
})(globalThis);
