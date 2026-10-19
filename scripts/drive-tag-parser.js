const TD=new TextDecoder('utf-8');
const TDL=new TextDecoder('latin1');
let TD16, TD16BE;
try{ TD16=new TextDecoder('utf-16le'); TD16BE=new TextDecoder('utf-16be'); }catch(e){ TD16=TD; TD16BE=TD; }
const NUL=String.fromCharCode(0);
function clean(s){ return String(s==null?'':s).split(NUL).join('').replace(/^\s+|\s+$/g,''); }
function readStr(buf,off,len,enc){
  if(len<=0) return '';
  const sl=buf.slice(off,off+len);
  try{
    if(enc===1){
      if(sl.length>1 && sl[0]===0xff && sl[1]===0xfe) return clean(TD16.decode(sl.slice(2)));
      if(sl.length>1 && sl[0]===0xfe && sl[1]===0xff) return clean(TD16BE.decode(sl.slice(2)));
      return clean(TD16.decode(sl));
    }
    if(enc===2) return clean(TD16BE.decode(sl));
    if(enc===3) return clean(TD.decode(sl));
    return clean(TDL.decode(sl));
  }catch(e){ return ''; }
}
function b64toBytes(s){
  try{
    const bin=atob(String(s).replace(/\s+/g,''));
    const a=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) a[i]=bin.charCodeAt(i);
    return a;
  }catch(e){ return null; }
}
function syncsafe(b,o){ return (b[o]<<21)|(b[o+1]<<14)|(b[o+2]<<7)|b[o+3]; }
function u32be(b,o){ return ((b[o]<<24)|(b[o+1]<<16)|(b[o+2]<<8)|b[o+3])>>>0; }
function u32le(b,o){ return (b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24))>>>0; }

function applyTagKV(key,val,out){
  const k=clean(key).toUpperCase();
  val=clean(val);
  if(!val) return;
  if(k==='TITLE') out.title=val;
  else if(k==='ARTIST') out.artist=val;
  else if(k==='ALBUM') out.album=val;
  else if(k==='ALBUMARTIST'||k==='ALBUM ARTIST') out.albumArtist=val;
  else if(k==='GENRE') out.genre=val;
  else if(k==='DATE'||k==='YEAR') out.year=parseInt(val,10)||out.year;
  else if(k==='TRACKNUMBER'||k==='TRACK') out.track=parseInt(val,10)||out.track;
  else if(k==='DISCNUMBER'||k==='DISC') out.disc=parseInt(val,10)||out.disc;
  else if(k==='COMPOSER') out.composer=val;
  else if(k==='REPLAYGAIN_TRACK_PEAK') out.rgTrackPeak=parseFloat(val);
  else if(k==='REPLAYGAIN_ALBUM_PEAK') out.rgAlbumPeak=parseFloat(val);
  else if(k==='REPLAYGAIN_TRACK_GAIN') out.rgTrack=parseFloat(val);
  else if(k==='REPLAYGAIN_ALBUM_GAIN') out.rgAlbum=parseFloat(val);
  else if(k==='LYRICS'||k==='UNSYNCEDLYRICS') out.lyrics=val;
  else if(k==='METADATA_BLOCK_PICTURE'){
    const bytes=b64toBytes(val);
    if(bytes){ const pic=parseFlacPicture(bytes); if(pic&&!out.pic) out.pic=pic; }
  }
}
function parseVorbisComments(b,off,out,skipArt){
  try{
    const vlen=u32le(b,off); off+=4+vlen;
    let n=u32le(b,off); off+=4;
    if(!(n>=0)||n>1024) n=1024;
    for(let i=0;i<n;i++){
      if(off+4>b.length){ out._needPacket=b.length+4096; break; }
      const len=u32le(b,off); off+=4;
      if(len<=0) break;
      if(off+len>b.length){ out._needPacket=off+len; break; }
      if(skipArt && len>4096){
        /* a huge comment is the embedded picture - step over it */
        const head=TD.decode(b.slice(off,off+Math.min(len,24)));
        if(head.indexOf('METADATA_BLOCK_PICTURE')===0){ off+=len; continue; }
      }
      const str=TD.decode(b.slice(off,off+len)); off+=len;
      const eq=str.indexOf('=');
      if(eq>0) applyTagKV(str.slice(0,eq), str.slice(eq+1), out);
    }
  }catch(e){}
}
function parseFlacPicture(b){
  try{
    let o=4;
    const mlen=u32be(b,o); o+=4;
    if(mlen>200) return null;
    const mime=TDL.decode(b.slice(o,o+mlen)); o+=mlen;
    const dlen=u32be(b,o); o+=4+dlen;
    o+=16;
    const len=u32be(b,o); o+=4;
    if(len<=100||o+len>b.length) return null;
    return { mime:mime||'image/jpeg', data:b.slice(o,o+len) };
  }catch(e){ return null; }
}
const ID3GENRES=['Blues','Classic Rock','Country','Dance','Disco','Funk','Grunge','Hip-Hop','Jazz','Metal','New Age','Oldies','Other','Pop','R&B','Rap','Reggae','Rock','Techno','Industrial','Alternative','Ska','Death Metal','Pranks','Soundtrack','Euro-Techno','Ambient','Trip-Hop','Vocal','Jazz+Funk','Fusion','Trance','Classical','Instrumental','Acid','House','Game','Sound Clip','Gospel','Noise','Alt Rock','Bass','Soul','Punk','Space','Meditative','Instrumental Pop','Instrumental Rock','Ethnic','Gothic','Darkwave','Techno-Industrial','Electronic','Pop-Folk','Eurodance','Dream','Southern Rock','Comedy','Cult','Gangsta Rap','Top 40','Christian Rap','Pop/Funk','Jungle','Native American','Cabaret','New Wave','Psychedelic','Rave','Showtunes','Trailer','Lo-Fi','Tribal','Acid Punk','Acid Jazz','Polka','Retro','Musical','Rock and Roll','Hard Rock'];

function parseID3v2(b,out,skipArt){
  const ver=b[3], flags=b[5], size=syncsafe(b,6);
  let o=10;
  if(flags&0x40) o+=u32be(b,o);
  const end=Math.min(10+size,b.length);
  let guard=0;
  while(o+10<=end && guard++<500){
    let id,fsize,fo;
    if(ver>=3){
      id=TDL.decode(b.slice(o,o+4));
      fsize = ver>=4 ? syncsafe(b,o+4) : u32be(b,o+4);
      fo=o+10;
      if(!/^[A-Z0-9]{4}$/.test(id)) break;
      o=fo+fsize;
    } else {
      id=TDL.decode(b.slice(o,o+3));
      fsize=(b[o+3]<<16)|(b[o+4]<<8)|b[o+5];
      fo=o+6;
      if(!/^[A-Z0-9]{3}$/.test(id)) break;
      o=fo+fsize;
    }
    if(fsize<=0||fo+fsize>b.length) break;
    const enc=b[fo];
    const txt=function(){ return readStr(b,fo+1,fsize-1,enc); };
    if(id==='TIT2'||id==='TT2') out.title=txt();
    else if(id==='TPE1'||id==='TP1') out.artist=txt();
    else if(id==='TALB'||id==='TAL') out.album=txt();
    else if(id==='TPE2'||id==='TP2') out.albumArtist=txt();
    else if(id==='TCON'||id==='TCO'){
      let g=txt();
      g=g.replace(/^\((\d+)\)\s*/, function(m,n){ return ID3GENRES[+n] ? ID3GENRES[+n]+' ' : ''; });
      out.genre=g.trim();
    }
    else if(id==='TRCK'||id==='TRK') out.track=parseInt(txt(),10)||out.track;
    else if(id==='TPOS') out.disc=parseInt(txt(),10)||out.disc;
    else if(id==='TYER'||id==='TYE'||id==='TDRC') out.year=parseInt(txt(),10)||out.year;
    else if(id==='TCOM'||id==='TCM') out.composer=txt();
    else if(id==='TLEN') out.tagDur=(parseInt(txt(),10)||0)/1000;
    else if(id==='USLT'||id==='ULT') out.lyrics=readStr(b,fo+4,fsize-4,enc);
    else if(id==='TXXX'||id==='TXX'){
      const raw=TD.decode(b.slice(fo+1,fo+fsize));
      const parts=raw.split(NUL).filter(function(x){ return x!==''; });
      if(parts.length>=2) applyTagKV(parts[0],parts[1],out);
    }
    else if(id==='APIC'||id==='PIC'){
      if(out.pic||skipArt) continue;
      let p=fo+1, mime='image/jpeg';
      if(id==='PIC'){ mime='image/'+TDL.decode(b.slice(p,p+3)).toLowerCase(); p+=3; }
      else { const st=p; while(p<fo+fsize && b[p]!==0) p++; mime=TDL.decode(b.slice(st,p)); p++; }
      p++;
      if(enc===1||enc===2){ while(p+1<fo+fsize && !(b[p]===0&&b[p+1]===0)) p+=2; p+=2; }
      else { while(p<fo+fsize && b[p]!==0) p++; p++; }
      const len=fo+fsize-p;
      if(len>100){
        let mm=String(mime||'').toLowerCase();
        if(!/^image\/(jpeg|png|gif|webp|bmp)$/.test(mm)) mm = /png/.test(mm) ? 'image/png' : 'image/jpeg';
        out.pic={ mime:mm, data:b.slice(p,p+len) };
      }
    }
  }
}

function parseMP4(b,out){
  const TEXT={};
  TEXT[String.fromCharCode(169)+'nam']='title';
  TEXT[String.fromCharCode(169)+'ART']='artist';
  TEXT[String.fromCharCode(169)+'alb']='album';
  TEXT[String.fromCharCode(169)+'gen']='genre';
  TEXT[String.fromCharCode(169)+'wrt']='composer';
  TEXT[String.fromCharCode(169)+'day']='year';
  TEXT[String.fromCharCode(169)+'lyr']='lyrics';
  TEXT['aART']='albumArtist';
  TEXT['gnre']='genre';
  function walk(start,end,depth){
    let o=start, guard=0;
    while(o+8<=end && guard++<800){
      let size=u32be(b,o);
      const type=TDL.decode(b.slice(o+4,o+8));
      let hs=8;
      if(size===1){ hs=16; size=u32be(b,o+8)*4294967296+u32be(b,o+12); }
      if(size<8) break;
      const cs=o+hs, ce=Math.min(o+size,end);
      if(depth<12 && ['moov','udta','trak','mdia','minf','stbl','ilst','meta'].includes(type)){
        walk(type==='meta'?cs+4:cs, ce, depth+1);
      } else if(type==='stsd'){
        walk(cs+8,ce,depth+1);
      } else if(['mp4a','alac','Opus','fLaC'].includes(type)&&cs+28<=ce){
        const channels=(b[cs+16]<<8)|b[cs+17],rate=u32be(b,cs+24)/65536;
        if(channels>0&&channels<=32)out.channels=channels;
        if(rate>=8000&&rate<=768000)out.sampleRate=Math.round(rate);
        out.codec=type==='mp4a'?'aac':type.toLowerCase();
        if(type==='alac'||type==='fLaC')out.bits=(b[cs+18]<<8)|b[cs+19];
      } else if(type==='mvhd'){
        const v=b[cs];
        const ts = v===1 ? u32be(b,cs+20) : u32be(b,cs+12);
        const du = v===1 ? (u32be(b,cs+28)*4294967296+u32be(b,cs+32)) : u32be(b,cs+16);
        if(ts>0 && du>0) out.tagDur=du/ts;
      } else if(TEXT[type]||type==='trkn'||type==='disk'||type==='covr'){
        let p=cs, g2=0;
        while(p+8<=ce && g2++<12){
          const dsz=u32be(b,p), dty=TDL.decode(b.slice(p+4,p+8));
          if(dsz<8) break;
          if(dty==='data'){
            const flag=u32be(b,p+8)&0xffffff;
            const dstart=p+16, dlen=dsz-16;
            if(dlen<0||dstart+dlen>ce||dstart+dlen>b.length){p+=dsz;continue;}
            if(dlen>0){
              if(type==='covr'){
                if(!out.pic && dlen>100) out.pic={ mime: flag===13?'image/jpeg':'image/png', data:b.slice(dstart,dstart+dlen) };
              } else if(type==='trkn'||type==='disk'){
                const n=(b[dstart+2]<<8)|b[dstart+3];
                if(type==='trkn') out.track=n||out.track; else out.disc=n||out.disc;
              } else if(type==='gnre'){
                const n=(b[dstart]<<8)|b[dstart+1];
                if(ID3GENRES[n-1]) out.genre=ID3GENRES[n-1];
              } else {
                const vv=clean(TD.decode(b.slice(dstart,dstart+dlen)));
                const f=TEXT[type];
                if(f==='year') out.year=parseInt(vv,10)||out.year;
                else if(f && vv) out[f]=vv;
              }
            }
          }
          p+=dsz;
        }
      }
      o+=size;
    }
  }
  walk(0,b.length,0);
  out.codec=out.codec||'aac';
}

function parseFLAC(b,out){
  let o=4,last=false,guard=0;
  while(!last && o+4<=b.length && guard++<64){
    const h=b[o]; last=!!(h&0x80);
    const type=h&0x7f;
    const len=(b[o+1]<<16)|(b[o+2]<<8)|b[o+3];
    const start=o+4;
    if(start+len>b.length) break;
    if(type===0){
      const sr=(b[start+10]<<12)|(b[start+11]<<4)|(b[start+12]>>4);
      const total=((b[start+13]&0x0f)*4294967296)+u32be(b,start+14);
      if(sr>0){ out.sampleRate=sr; if(total>0) out.tagDur=total/sr; }
      out.bits=((((b[start+12]&1)<<4)|(b[start+13]>>4))+1);
      out.channels=((b[start+12]>>1)&7)+1;
    } else if(type===4) parseVorbisComments(b,start,out);
    else if(type===6){ const pic=parseFlacPicture(b.slice(start,start+len)); if(pic&&!out.pic) out.pic=pic; }
    o=start+len;
  }
  out.codec=out.codec||'flac';
}

function oggPackets(b, maxPackets){
  /* Reassemble logical bitstream packets across Ogg pages.
     Vorbis/Opus comment headers holding cover art routinely span several
     pages, so a naive contiguous read would splice page headers into the data. */
  const out=[]; let parts=[], len=0, o=0, guard=0, truncated=false;
  const flush=function(){
    if(!parts.length) return null;
    const a=new Uint8Array(len); let at=0;
    parts.forEach(function(p){ a.set(p,at); at+=p.length; });
    parts=[]; len=0;
    return a;
  };
  while(o+27<=b.length && guard++<4000){
    if(!(b[o]===79&&b[o+1]===103&&b[o+2]===103&&b[o+3]===83)){ o++; continue; }
    const segs=b[o+26], tbl=o+27;
    if(tbl+segs>b.length) break;
    let d=tbl+segs;
    for(let i=0;i<segs;i++){
      const sl=b[tbl+i];
      if(d+sl>b.length){ truncated=true; break; }
      parts.push(b.slice(d,d+sl)); len+=sl; d+=sl;
      if(sl<255){
        const pk=flush();
        if(pk){ out.push(pk); if(maxPackets && out.length>=maxPackets){ out.truncated=false; return out; } }
      }
    }
    if(truncated) break;
    o=d;
  }
  if(parts.length){ out.push(flush()); truncated=true; }
  out.truncated=truncated;
  return out;
}
function parseOgg(b,out,skipArt){
  const packets=oggPackets(b,6);
  for(let i=0;i<packets.length;i++){
    const pk=packets[i];
    if(pk.length<8) continue;
    const head=TDL.decode(pk.slice(0,8));
    if(head==='OpusHead'){
      out.codec='opus'; out.channels=pk[9]; out.sampleRate=48000;
    } else if(head==='OpusTags'){
      parseVorbisComments(pk,8,out,skipArt);
      out.codec='opus';
      if(!skipArt && !out.pic && packets.truncated && i===packets.length-1){
        out.needMore=true;
        out.needBytes=Math.ceil((out._needPacket||pk.length)*1.02)+65536;
      }
      return;
    } else if(head.slice(1,7)==='vorbis'){
      if(pk[0]===1){ out.codec='vorbis'; out.channels=pk[11]; out.sampleRate=u32le(pk,12); }
      else if(pk[0]===3){
        parseVorbisComments(pk,7,out,skipArt);
        out.codec='vorbis';
        if(!skipArt && !out.pic && packets.truncated && i===packets.length-1){
          out.needMore=true;
          out.needBytes=Math.ceil((out._needPacket||pk.length)*1.02)+65536;
        }
        return;
      }
    }
  }
  if(packets.truncated && !skipArt){
    out.needMore=true;
    out.needBytes=Math.ceil((out._needPacket||b.length*2)*1.02)+65536;
  }
}

function parseRIFF(b,out){
  let o=12,guard=0;
  while(o+8<=b.length && guard++<64){
    const id=TDL.decode(b.slice(o,o+4)), len=u32le(b,o+4);
    if(id==='LIST' && TDL.decode(b.slice(o+8,o+12))==='INFO'){
      let p=o+12; const end=Math.min(o+8+len,b.length);
      while(p+8<=end){
        const k=TDL.decode(b.slice(p,p+4)), l=u32le(b,p+4);
        const v=clean(TDL.decode(b.slice(p+8,p+8+l)));
        if(k==='INAM') out.title=v; else if(k==='IART') out.artist=v;
        else if(k==='IPRD') out.album=v; else if(k==='IGNR') out.genre=v;
        else if(k==='ICRD') out.year=parseInt(v,10)||out.year;
        if(l<=0) break;
        p+=8+l+(l%2);
      }
    } else if(id==='fmt '){
      out.channels=(b[o+10]|(b[o+11]<<8));
      out.sampleRate=u32le(b,o+12);
      out.byteRate=u32le(b,o+16);
      out.bits=(b[o+22]|(b[o+23]<<8));
    } else if(id==='data'){
      if(out.byteRate>0) out.tagDur=len/out.byteRate;
    }
    if(len<=0) break;
    o+=8+len+(len%2);
  }
  out.codec=out.codec||'pcm';
}

const MPEG_RATES={
  1:{1:[0,32,64,96,128,160,192,224,256,288,320,352,384,416,448],
     2:[0,32,48,56,64,80,96,112,128,160,192,224,256,320,384],
     3:[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]},
  2:{1:[0,32,48,56,64,80,96,112,128,144,160,176,192,224,256],
     2:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],
     3:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160]}
};
const MPEG_SR={3:[44100,48000,32000],2:[22050,24000,16000],0:[11025,12000,8000]};
function mp3Duration(b,start,fileSize,out){
  for(let i=start;i<Math.min(b.length-4,start+200000);i++){
    if(b[i]!==0xff || (b[i+1]&0xe0)!==0xe0) continue;
    const verBits=(b[i+1]>>3)&3, layerBits=(b[i+1]>>1)&3;
    if(verBits===1||layerBits===0) continue;
    const ver = verBits===3?1:2;
    const layer = 4-layerBits;
    const brIdx=(b[i+2]>>4)&15, srIdx=(b[i+2]>>2)&3;
    if(brIdx===0||brIdx===15||srIdx===3) continue;
    const rates=MPEG_RATES[ver] && MPEG_RATES[ver][layer];
    const sr=(MPEG_SR[verBits]||MPEG_SR[3])[srIdx];
    if(!rates||!sr) continue;
    const kbps=rates[brIdx];
    if(!kbps) continue;
    out.sampleRate=out.sampleRate||sr;
    out.channels=out.channels||(((b[i+3]>>6)&3)===3?1:2);
    /* Xing / Info / VBRI header for accurate VBR length */
    const side = ver===1 ? (out.channels===1?17:32) : (out.channels===1?9:17);
    const xo=i+4+side;
    const tag=TDL.decode(b.slice(xo,xo+4));
    if(tag==='Xing'||tag==='Info'){
      const flags=u32be(b,xo+4);
      if(flags&1){
        const frames=u32be(b,xo+8);
        const spf = layer===1?384:(ver===1?1152:576);
        if(frames>0){ out.tagDur=frames*spf/sr; return; }
      }
    }
    if(TDL.decode(b.slice(i+4+32,i+4+36))==='VBRI'){
      const frames=u32be(b,i+4+32+14);
      if(frames>0){ out.tagDur=frames*1152/sr; return; }
    }
    out.bitrate=kbps;
    out.tagDur=(fileSize-i)*8/(kbps*1000);
    return;
  }
}
/* content:// and SAF backed files charge a big fixed cost per read, so after
   a couple of slow reads we stop being clever and take one large bite. */
const IOSTAT={n:0, ms:0, slow:false};
function ioNote(ms){
  IOSTAT.n++; IOSTAT.ms+=ms;
  if(IOSTAT.n>=2 && (IOSTAT.ms/IOSTAT.n)>120) IOSTAT.slow=true;
}
function mergeTags(dst, src){
  for(const k in src){
    if(k==='needMore') continue;
    if(src[k]!=null && src[k]!=='') dst[k]=src[k];
  }
}
/* Reads as little of each file as the format allows: a small head first,
   extended only to the exact size the tag declares. */
async function readTags(file, opts){
  opts=opts||{};
  /* when reads are expensive, one big read already contains the art */
  const skipArt=!!opts.skipArt && (opts.remote || !IOSTAT.slow);
  const out={};
  let reads=0;
  const now=function(){ return (typeof performance!=='undefined'?performance.now():Date.now()); };
  const state={buf:null, have:0};
  const need=async function(n){
    n=Math.min(n, file.size);
    if(state.have>=n && state.buf) return state.buf;
    reads++;
    const t0=now();
    const extra=new Uint8Array(await file.slice(state.have, n).arrayBuffer());
    if(!opts.remote)ioNote(now()-t0);
    if(!state.buf){ state.buf=extra; }
    else {
      const merged=new Uint8Array(state.have+extra.length);
      merged.set(state.buf,0);
      merged.set(extra,state.have);
      state.buf=merged;
    }
    state.have=state.buf.length;
    return state.buf;
  };
  const tail=async function(n){
    n=Math.min(n, file.size);
    reads++;
    const t0=now();
    const t=new Uint8Array(await file.slice(file.size-n).arrayBuffer());
    if(!opts.remote)ioNote(now()-t0);
    return t;
  };
  try{
    let b=await need(opts.remote ? 128*1024 : IOSTAT.slow ? 256*1024 : 32*1024);
    const sig4=TDL.decode(b.slice(0,4));

    if(sig4.slice(0,3)==='ID3'){
      const size=syncsafe(b,6)+10;
      if(size>state.have && size<24*1024*1024 && !skipArt) b=await need(size+2048);
      else if(size>state.have && skipArt) b=await need(Math.min(size+2048, state.have+96*1024));
      parseID3v2(b,out,skipArt);
      out.codec=out.codec||'mp3';
      if(!out.tagDur) mp3Duration(b, Math.min(size,b.length), file.size, out);
    }
    else if(sig4==='fLaC'){
      let o=4, last=false, guard=0;
      while(!last && guard++<64){
        if(o+4>b.length){
          if(b.length>=file.size) break;
          b=await need(Math.min(file.size, Math.max(b.length*2, o+8192)));
          if(o+4>b.length) break;
        }
        const h=b[o];
        last=!!(h&0x80);
        const len=(b[o+1]<<16)|(b[o+2]<<8)|b[o+3];
        const end=o+4+len;
        const isPicture=((b[o]&0x7f)===6);
        if(end>b.length && end<12*1024*1024 && !(skipArt&&isPicture)) b=await need(end+512);
        else if(skipArt&&isPicture){ o=end; continue; }
        o=end;
        if(o>b.length) break;
      }
      parseFLAC(b,out);
    }
    else if(sig4==='OggS'){
      b=await need(64*1024);
      parseOgg(b,out,skipArt);
      let guard=0;
      while(out.needMore && state.have<file.size && guard++<3){
        const want=Math.min(file.size, Math.max(out.needBytes||0, state.have*4));
        if(want<=state.have) break;
        b=await need(Math.min(want, 12*1024*1024));
        const o2={};
        parseOgg(b,o2,skipArt);
        mergeTags(out,o2);
        out.needMore=o2.needMore;
        out.needBytes=o2.needBytes;
      }
      delete out.needMore;
      delete out.needBytes;
      delete out._needPacket;
      try{
        /* the granule position lives at the end of the file - on slow storage
           that second read is deferred to a background pass after the scan */
        if(opts.headerOnly || (IOSTAT.slow && !opts.wantDuration)){ out.needDur=true; throw 0; }
        const t=await tail(64*1024);
        let lastPage=-1;
        for(let i=t.length-27;i>=0;i--){
          if(t[i]===79&&t[i+1]===103&&t[i+2]===103&&t[i+3]===83){ lastPage=i; break; }
        }
        if(lastPage>=0){
          const lo=u32le(t,lastPage+6), hi=u32le(t,lastPage+10);
          const granule=hi*4294967296+lo;
          const rate=out.codec==='opus'?48000:(out.sampleRate||48000);
          if(granule>0 && rate>0) out.tagDur=granule/rate;
        }
      }catch(e){}
    }
    else if(sig4==='RIFF'){
      parseRIFF(b,out);
    }
    else if(TDL.decode(b.slice(4,8))==='ftyp'){
      // Read complete metadata atoms, even when moov follows a large mdat.
      // A title in the first 32 KiB does not mean that the cover is complete.
      let offset=0,atoms=0;
      while(offset+8<=file.size&&atoms++<512){
        const head=new Uint8Array(await file.slice(offset,offset+16).arrayBuffer());
        if(head.length<8)break;
        let size=u32be(head,0),header=8;const type=TDL.decode(head.slice(4,8));
        if(size===1){if(head.length<16)break;header=16;size=u32be(head,8)*4294967296+u32be(head,12);}
        if(size===0)size=file.size-offset;
        if(!Number.isSafeInteger(size)||size<header||offset+size>file.size)break;
        if(type==='moov'){
          if(size<=32*1024*1024){
            const complete=new Uint8Array(await file.slice(offset,offset+size).arrayBuffer());reads++;
            if(complete.length===size)parseMP4(complete,out);
          }
          break;
        }
        offset+=size;
      }
    }
    else if(b[0]===0xff && (b[1]&0xe0)===0xe0){
      out.codec=out.codec||'mp3';
      mp3Duration(b,0,file.size,out);
    }

    if(!opts.headerOnly && !out.title && file.size>128){
      const t=await tail(128);
      if(TDL.decode(t.slice(0,3))==='TAG'){
        const g=function(a,z){ return clean(TDL.decode(t.slice(a,z))); };
        out.title=g(3,33)||out.title; out.artist=g(33,63)||out.artist;
        out.album=g(63,93)||out.album; out.year=parseInt(g(93,97),10)||out.year;
        if(t[125]===0&&t[126]>0) out.track=t[126];
        if(ID3GENRES[t[127]]) out.genre=ID3GENRES[t[127]];
      }
    }
  }catch(e){if(opts.throwErrors)throw e;}
  out._reads=reads;
  out._slow=IOSTAT.slow;
  return out;
}
