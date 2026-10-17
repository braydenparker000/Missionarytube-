import {analysisForTrack} from './audio-analysis.js';
// Browser audio math. Original implementation of the RBJ cookbook and a
// windowed-sinc, linked-stereo lookahead guard. No integer quantization.
export const finite=(v,f=0)=>Number.isFinite(v)?v:f;
export const bound=(v,lo,hi,f=lo)=>Math.max(lo,Math.min(hi,finite(v,f)));
export const linear=db=>10**(bound(db,-1200,60,0)/20);
export const decibels=x=>x>0?20*Math.log10(x):-180;
export const GUARD_CEILING_DB=-1;
export const GUARD_MARGIN_DB=2;
// This is an explicit preparation allowance, not another true-peak reading.
// FFmpeg's summary rounds to 0.1 dB; decoder/SRC and detector differences also
// need room if fixed gain is to keep the guard idle on measured originals.
export const MEASURED_PEAK_RESERVE_DB=.25;
export const DSP={
  coeff(type,freq,gain,q,sr){
    if(!Number.isFinite(sr)||sr<8000||sr>384000)throw Error('Invalid processing rate');
    gain=bound(gain,-15,15,0);if(gain===0)return [1,0,0,1,0,0];
    q=bound(q,.1,12,1.4142);freq=bound(freq,10,sr*.49,1000);
    const w=2*Math.PI*freq/sr,c=Math.cos(w),s=Math.sin(w),A=10**(gain/40),alpha=s/(2*q);
    let b0,b1,b2,a0,a1,a2;
    if(type==='lowshelf'||type==='highshelf'){
      // Shelf Q: alpha=sin(w)/(2Q), equivalent to RBJ S through
      // 1/Q²=(A+1/A)*(1/S-1)+2. Q is NOT the shelf slope S.
      const k=2*Math.sqrt(A)*alpha,p=A+1,m=A-1;
      if(type==='lowshelf'){b0=A*(p-m*c+k);b1=2*A*(m-p*c);b2=A*(p-m*c-k);a0=p+m*c+k;a1=-2*(m+p*c);a2=p+m*c-k;}
      else{b0=A*(p+m*c+k);b1=-2*A*(m+p*c);b2=A*(p+m*c-k);a0=p-m*c+k;a1=2*(m-p*c);a2=p-m*c-k;}
    }else{b0=1+alpha*A;b1=-2*c;b2=1-alpha*A;a0=1+alpha/A;a1=-2*c;a2=1-alpha/A;}
    const result=[b0/a0,b1/a0,b2/a0,1,a1/a0,a2/a0];
    // Jury stability criterion for a real second order denominator.
    if(!result.every(Number.isFinite)||Math.abs(result[5])>=1||1+result[4]+result[5]<=0||1-result[4]+result[5]<=0)throw Error('Unstable EQ');
    return result;
  },
  db(a,f,sr){
    const w=2*Math.PI*f/sr,c=Math.cos(w),s=Math.sin(w),c2=Math.cos(2*w),s2=Math.sin(2*w);
    return 10*Math.log10(Math.max(1e-30,((a[0]+a[1]*c+a[2]*c2)**2+(a[1]*s+a[2]*s2)**2)/Math.max(1e-30,(1+a[4]*c+a[5]*c2)**2+(a[4]*s+a[5]*s2)**2)));
  },
  responsePeak(filters,sr){
    if(!filters.length)return 0;
    // Locate all sampled maxima, then refine each in log frequency. This
    // estimates steady-state response; the final guard covers transients.
    const at=x=>filters.reduce((v,c)=>v+DSP.db(c,Math.exp(x),sr),0);
    const lo=Math.log(10),hi=Math.log(sr*.499),step=(hi-lo)/2048;
    let peak=Math.max(at(lo),at(hi)),a=at(lo),b=at(lo+step);
    for(let i=2;i<=2048;i++){
      const x=lo+i*step,d=at(x);peak=Math.max(peak,b);
      if(b>=a&&b>=d){let l=x-2*step,r=x;
        for(let k=0;k<24;k++){const u=l+(r-l)/3,v=r-(r-l)/3;if(at(u)>at(v))r=v;else l=u;}
        peak=Math.max(peak,at((l+r)/2));
      }a=b;b=d;
    }
    return peak;
  },
  headroom(filters,preamp,sr){
    if(!filters.length)return -Math.max(0,finite(preamp));
    const peak=DSP.responsePeak(filters,sr)+finite(preamp);
    return peak>.01?-peak-.5:0;
  },
  cascadePlan(filters,preamp,sr,auto=true){
    const responsePeakDb=DSP.responsePeak(filters,sr),peak=responsePeakDb+finite(preamp);
    const estimate=filters.length?(peak>.01?-peak-.5:0):-Math.max(0,finite(preamp));
    // Ordinary presets retain their existing graph and constant gain. An
    // extreme cascade needs distributed attenuation: a tiny input GainNode
    // can underflow before hundreds of dB of later boost, or those boosts can
    // overflow before the final protective gain when auto headroom is off.
    if(estimate>=-120)return {filters,inputDb:auto?estimate:0,headroomDb:auto?estimate:0,estimate,responsePeakDb,distributed:false};
    const stages=filters.map(c=>Math.max(0,-DSP.headroom([c],0,sr)-.5));
    const inputDb=-Math.max(0,finite(preamp))-.5;
    return {filters:filters.map((c,i)=>{const g=linear(-stages[i]);return [c[0]*g,c[1]*g,c[2]*g,...c.slice(3)];}),
      inputDb,headroomDb:inputDb-stages.reduce((a,b)=>a+b,0),estimate,responsePeakDb,distributed:true};
  }
};
export function normalization(track,settings){
  if(!track||!settings.rgEnabled)return {db:0,reason:'Off',reference:null};
  const album=settings.rgSource==='album',a=analysisForTrack(track);
  const valid=!!a;
  const target=bound(settings.normalizationTarget,-23,-14,-16);
  let db,reason,reference;
  if(valid&&(!album||a.album?.complete===true)){
    const lufs=album?a.album.integratedLufs:a.integratedLufs;
    if(Number.isFinite(lufs)){db=target-lufs;reason=album?'Measured complete album':'Measured track';reference=target;}
  }
  // R128 is relative to the ALREADY decoded OpusHead gain. Never add it.
  const r128=album?track.r128AlbumGain:track.r128TrackGain;
  if(db==null&&Number.isInteger(r128)&&r128>=-32768&&r128<=32767){db=r128/256+target+23;reason=album?'R128 album tag':'R128 track tag';reference=target;}
  // Legacy ReplayGain uses its original ~89 dB reference; do not pretend
  // that reference is a BS.1770 loudness measurement or convert it to LUFS.
  const rg=album?track.rgAlbum:track.rgTrack;
  if(db==null&&Number.isFinite(rg)&&Math.abs(rg)<=60){db=rg;reason=album?'Legacy album ReplayGain':'Legacy track ReplayGain';reference='Legacy 89 dB';}
  // Missing album data stays unnormalized, preserving album relationships.
  // Track mode also never silently substitutes album normalization.
  if(db==null)return {db:bound(settings.rgPreampNoTag,-12,12,0),reason:album?'Album evidence missing; no track fallback':'Analysis/tags missing',reference:null};
  return {db:bound(db+bound(settings.rgPreamp,-12,12,0),-60,30,0),reason,reference};
}
export function gainLedger(track,settings,{headroom=0,effectPeakDb=0,overlapDb=0,degraded=false}={}){
  const norm=normalization(track,settings),transparent=settings.audioMode==='transparent';
  const userPreampDb=transparent?0:settings.eqEnabled?bound(settings.preamp,-15,15,0):0;
  const volume=bound(settings.volume,0,1,1),volumeDb=decibels(volume*volume);
  const a=analysisForTrack(track),valid=!!a;
  const album=settings.rgEnabled&&settings.rgSource==='album';
  const peak=valid?(album?(a.album?.complete?a.album.truePeakDbtp:null):a.truePeakDbtp):null;
  // Unknown peak is an explicit +3 dBTP working assumption, never a bound
  // on all possible files. Protection remains enabled for unknown audio.
  const peakDb=Number.isFinite(peak)?peak:3;
  const peakMeasurementReserveDb=Number.isFinite(peak)?MEASURED_PEAK_RESERVE_DB:0;
  // Exact float sample peaks sometimes exceed the rounded true-peak summary.
  // Album mode uses the SAME common peak/reserve for every member.
  const peakBoundDb=(Number.isFinite(peak)&&!album?Math.max(peak,a.samplePeakDbfs):peakDb)+peakMeasurementReserveDb;
  const effectiveCeiling=GUARD_CEILING_DB-GUARD_MARGIN_DB-(degraded?6:0);
  const eqHeadroomDb=transparent?0:Math.min(0,finite(headroom));
  const expected=peakBoundDb+norm.db+userPreampDb+eqHeadroomDb+finite(effectPeakDb)+finite(overlapDb)+volumeDb;
  const protectiveDb=Math.min(0,effectiveCeiling-expected);
  return {...norm,normalizationDb:norm.db,userPreampDb,eqHeadroomDb,volumeDb,overlapDb,protectiveDb,
    peakDb,peakBoundDb,peakMeasurementReserveDb,peakKnown:Number.isFinite(peak),ceilingDb:GUARD_CEILING_DB,detectorMarginDb:GUARD_MARGIN_DB,
    degraded,trackGain:linear(norm.db),finalGain:linear(protectiveDb)};
}
export class TruePeakGuard{
  constructor(rate=48000){
    this.rate=rate;this.taps=128;this.half=64;this.delay=Math.round(rate*.006)+this.half;
    this.size=this.delay+this.taps+4;this.left=new Float32Array(this.size);this.right=new Float32Array(this.size);
    this.peaks=new Float64Array(this.size);this.indices=new Float64Array(this.size);
    this.kernels=[];
    for(let p=1;p<4;p++){
      const k=new Float64Array(this.taps);let sum=0;
      for(let j=0;j<this.taps;j++){const x=j-(this.taps-1-this.half)-p/4;
        const sinc=Math.abs(x)<1e-12?1:Math.sin(Math.PI*x)/(Math.PI*x);
        const window=.42+.5*Math.cos(Math.PI*x/this.half)+.08*Math.cos(2*Math.PI*x/this.half);
        k[j]=sinc*window;sum+=k[j];
      }for(let j=0;j<k.length;j++)k[j]/=sum;this.kernels.push(k);
    }
    this.ceiling=linear(GUARD_CEILING_DB-GUARD_MARGIN_DB);this.release=Math.exp(-1/(rate*.08));this.enabled=true;this.reset();
  }
  reset(){this.left.fill(0);this.right.fill(0);this.head=0;this.tail=0;this.n=0;this.gain=1;this.reduction=1;this.activeFrames=0;this.inputPeak=0;this.outputPeak=0;this.outL=0;this.outR=0;}
  tick(l,r){
    l=finite(l);r=finite(r);const n=this.n++,slot=n%this.size;this.left[slot]=l;this.right[slot]=r;
    // The centered FIR becomes available half a window later. Only the
    // detector is oversampled; output PCM remains at the context rate.
    const center=n-this.half,start=n-this.taps+1;
    let peak=Math.max(Math.abs(this.left[(center+this.size)%this.size]),Math.abs(this.right[(center+this.size)%this.size]));
    for(let p=0;p<this.kernels.length;p++){
      const k=this.kernels[p];let a=0,b=0,s=(start+this.size)%this.size;
      for(let j=0;j<this.taps;j++){a+=this.left[s]*k[j];b+=this.right[s]*k[j];if(++s===this.size)s=0;}
      peak=Math.max(peak,Math.abs(a),Math.abs(b));
    }
    this.inputPeak=Math.max(this.inputPeak,peak);
    while(this.head!==this.tail&&this.indices[this.head]<n-this.delay-this.half)this.head=(this.head+1)%this.size;
    while(this.head!==this.tail){const last=(this.tail+this.size-1)%this.size;if(this.peaks[last]>peak)break;this.tail=last;}
    this.peaks[this.tail]=peak;this.indices[this.tail]=center;this.tail=(this.tail+1)%this.size;
    const target=this.enabled?Math.min(1,this.ceiling/Math.max(1e-20,this.peaks[this.head])):1;
    // Stereo-linked instantaneous attack into a 6 ms future window, 80 ms
    // exponential release. The margin is tested AFTER gain modulation.
    this.gain=target<this.gain?target:target+(this.gain-target)*this.release;
    const out=(n-this.delay+this.size)%this.size;
    this.outL=n<this.delay?0:this.left[out]*this.gain;this.outR=n<this.delay?0:this.right[out]*this.gain;
    this.reduction=Math.min(this.reduction,this.gain);if(this.gain<.999)this.activeFrames++;
    this.outputPeak=Math.max(this.outputPeak,Math.abs(this.outL),Math.abs(this.outR));
  }
}

// Blob module uses the SAME implementation; no transitive network fetch in
// the audio rendering thread. CSP already permits worklet blob modules.
export function guardWorkletSource(){
  return `const finite=${finite};const bound=${bound};const linear=${linear};\nconst GUARD_CEILING_DB=${GUARD_CEILING_DB},GUARD_MARGIN_DB=${GUARD_MARGIN_DB};\n${TruePeakGuard}\nclass GuardProcessor extends AudioWorkletProcessor{
  constructor(){super();this.guard=new TruePeakGuard(sampleRate);this.frames=0;
    this.port.onmessage=e=>{if(e.data.reset){this.guard.reset();this.frames=0;}if(typeof e.data.enabled==='boolean')this.guard.enabled=e.data.enabled;};
  }
  process(inputs,outputs){
    const input=inputs[0],out=outputs[0];if(!out?.length)return true;
    const frames=out[0].length;
    for(let i=0;i<frames;i++){this.guard.tick(input?.[0]?.[i]??0,input?.[1]?.[i]??input?.[0]?.[i]??0);out[0][i]=this.guard.outL;if(out[1])out[1][i]=this.guard.outR;}
    this.frames+=frames;
    if(this.frames>=sampleRate/4){const g=this.guard;this.port.postMessage({reduction:g.reduction,activeFrames:g.activeFrames,frames:this.frames,inputPeak:g.inputPeak,outputPeak:g.outputPeak,delay:g.delay});g.reduction=1;g.activeFrames=0;g.inputPeak=0;g.outputPeak=0;this.frames=0;}
    return true;
  }
}
registerProcessor('jarvis-true-peak',GuardProcessor);
`;
}
