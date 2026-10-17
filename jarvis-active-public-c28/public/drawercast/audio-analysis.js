// Analysis is optional, immutable-audio-bound metadata. It is NOT a capability
// to alter audio bytes or a measurement of Android's output hardware.
const hash=/^[a-f0-9]{64}$/;
const number=(v,lo,hi)=>typeof v==='number'&&Number.isFinite(v)&&v>=lo&&v<=hi;
const text=v=>typeof v==='string'&&v.length>0&&v.length<=256&&!/[\x00-\x1f]/.test(v);
export function validateAnalysis(a,sha256,size){
  if(!a||a.version!==1||a.sha256!==sha256||!hash.test(a.sha256)||a.audioBytes!==size||
    a.gainBasis!=='decoded-container-gain'||!text(a.decoder)||!text(a.method)||!Number.isFinite(Date.parse(a.analyzedAt))||
    !Number.isInteger(a.sampleRate)||!number(a.sampleRate,8000,384000)||!Number.isInteger(a.channels)||!number(a.channels,1,8)||
    !number(a.integratedLufs,-100,20)||!number(a.samplePeakDbfs,-180,60)||!number(a.truePeakDbtp,-180,60)||
    a.truePeakDbtp<a.samplePeakDbfs-.15||!number(a.containerGainDb,-128,128))throw Error('Invalid or stale audio analysis');
  const out={version:1,sha256:a.sha256,audioBytes:size,gainBasis:a.gainBasis,decoder:a.decoder,method:a.method,
    analyzedAt:a.analyzedAt,sampleRate:a.sampleRate,channels:a.channels,integratedLufs:a.integratedLufs,
    samplePeakDbfs:a.samplePeakDbfs,truePeakDbtp:a.truePeakDbtp,containerGainDb:a.containerGainDb};
  if(a.album!=null){
    const g=a.album;
    if(!text(g.id)||g.complete!==true||!number(g.integratedLufs,-100,20)||!number(g.truePeakDbtp,-180,60)||
      !Array.isArray(g.members)||g.members.length<1||g.members.length>500||
      !g.members.every(m=>hash.test(m.sha256)&&Number.isSafeInteger(m.size)&&m.size>0)||
      new Set(g.members.map(m=>m.sha256)).size!==g.members.length||!g.members.some(m=>m.sha256===sha256&&m.size===size))throw Error('Invalid album analysis');
    out.album={id:g.id,complete:true,integratedLufs:g.integratedLufs,truePeakDbtp:g.truePeakDbtp,members:g.members.map(m=>({sha256:m.sha256,size:m.size}))};
  }
  return out;
}
export function analysisForTrack(t){try{return validateAnalysis(t?.audioAnalysis,t?.sha256,t?.size);}catch{return null;}}
