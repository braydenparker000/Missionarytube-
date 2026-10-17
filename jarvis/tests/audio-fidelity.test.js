import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {DSP,TruePeakGuard,normalization,gainLedger} from '../public/drawercast/audio-core.js';
import {validateAnalysis} from '../public/drawercast/audio-analysis.js';
const sha='a'.repeat(64),size=100;
const analysis={version:1,sha256:sha,audioBytes:size,gainBasis:'decoded-container-gain',decoder:'independent test decoder',method:'fixture v1',analyzedAt:'2026-10-02T00:00:00Z',sampleRate:48000,channels:2,integratedLufs:-8,samplePeakDbfs:2,truePeakDbtp:3,containerGainDb:6};
const settings={audioMode:'transparent',volume:1,rgEnabled:false,rgSource:'track',normalizationTarget:-16,rgPreamp:0,rgPreampNoTag:0};
test('R128 target conversion adds no already-decoded header gain',()=>{
  assert.equal(normalization({r128TrackGain:-573,opusHeadGainDb:6},{...settings,rgEnabled:true}).db,-573/256+7);
  assert.equal(normalization({r128TrackGain:256,opusHeadGainDb:-6},{...settings,rgEnabled:true,normalizationTarget:-23}).db,1);
  assert.equal(normalization({r128TrackGain:NaN,rgTrack:-8},{...settings,rgEnabled:true}).db,-8);
  assert.equal(normalization({rgTrack:-5},{...settings,rgEnabled:true,rgSource:'album'}).db,0);
});
test('validated decoded analysis overrides tags once and stale hashes are ignored',()=>{
  const t={sha256:sha,size,audioAnalysis:analysis,rgTrack:-3,r128TrackGain:-256};
  assert.equal(normalization(t,{...settings,rgEnabled:true}).db,-8);
  assert.equal(normalization({...t,sha256:'b'.repeat(64)},{...settings,rgEnabled:true}).db,6);
  for(const change of [{integratedLufs:Infinity},{truePeakDbtp:NaN},{gainBasis:'before-header-gain'},{sha256:'b'.repeat(64)}])assert.throws(()=>validateAnalysis({...analysis,...change},sha,size));
});
test('complete albums share normalization and protective gain; partial albums use common unknown policy',()=>{
  const album={id:'album-1',complete:true,members:[{sha256:sha,size}],integratedLufs:-10,truePeakDbtp:4};
  const t={sha256:sha,size,audioAnalysis:{...analysis,album}};
  const s={...settings,rgEnabled:true,rgSource:'album'};
  const l=gainLedger(t,s);assert.equal(l.normalizationDb,-6);assert.equal(l.peakDb,4);assert.equal(l.protectiveDb,-1.25);
  const u=gainLedger({...t,audioAnalysis:{...analysis,album:{...album,complete:false}}},s);assert.equal(u.normalizationDb,0);assert.equal(u.peakKnown,false);
});
test('protective gain accounts for volume before guard and never adds OpusHead twice',()=>{
  const t={sha256:sha,size,audioAnalysis:analysis};
  assert.equal(gainLedger(t,settings).protectiveDb,-6.25);
  assert.equal(gainLedger(t,{...settings,volume:.5}).protectiveDb,0);
  const q=gainLedger(t,{...settings,audioMode:'custom',eqEnabled:true,preamp:4},{headroom:-9,effectPeakDb:4});
  assert.equal(q.protectiveDb,-5.25);assert.ok(Number.isFinite(gainLedger(t,{...settings,volume:NaN}).finalGain));
});
test('fixed gain reserves measurement precision and honors a higher exact sample peak',()=>{
  const t={sha256:sha,size,audioAnalysis:{...analysis,samplePeakDbfs:3.04,truePeakDbtp:3}};
  const l=gainLedger(t,settings);
  assert.equal(l.peakDb,3);assert.equal(l.peakBoundDb,3.29);assert.equal(l.protectiveDb,-6.29);
  assert.equal(l.peakMeasurementReserveDb,.25);
  const unknown=gainLedger({},settings);assert.equal(unknown.peakBoundDb,3);assert.equal(unknown.peakMeasurementReserveDb,0);
});
test('extreme cascades allocate finite headroom per section even with automatic headroom disabled',()=>{
  for(const type of ['peaking','lowshelf','highshelf']){
    const c=DSP.coeff(type,997,15,12,48000),filters=Array.from({length:32},()=>c);
    const a=DSP.cascadePlan(filters,15,48000),b=DSP.cascadePlan(filters,15,48000,false);
    assert.equal(a.distributed,true);assert.deepEqual(a,b);assert.ok(a.headroomDb<=a.estimate+.001);
    assert.ok(a.filters.every(x=>x.every(Number.isFinite)));
  }
  const ordinary=[DSP.coeff('peaking',997,5,1,48000)];
  const a=DSP.cascadePlan(ordinary,0,48000);assert.equal(a.distributed,false);assert.equal(a.headroomDb,a.estimate);
  assert.equal(DSP.cascadePlan(ordinary,0,48000,false).headroomDb,0);
  const quiet=DSP.cascadePlan(ordinary,-15,48000);
  assert.equal(quiet.headroomDb,0);assert.ok(Math.abs(quiet.responsePeakDb-5)<.001);
  const l=gainLedger({sha256:sha,size,audioAnalysis:analysis},{...settings,audioMode:'custom',eqEnabled:true,preamp:-15},{headroom:quiet.headroomDb,effectPeakDb:quiet.responsePeakDb});
  assert.equal(l.protectiveDb,0);
});
test('guard idle output is exact delayed float identity; reset discards all state',()=>{
  const g=new TruePeakGuard(48000),x=Float32Array.from({length:2000},(_,i)=>.05*Math.sin(i*.7));
  for(let i=0;i<x.length+g.delay;i++){g.tick(x[i]||0,-(x[i]||0));if(i>=g.delay){assert.equal(g.outL,x[i-g.delay]||0);assert.equal(g.outR,-(x[i-g.delay]||0));}}
  assert.equal(g.reduction,1);g.tick(100,-100);g.reset();for(let i=0;i<g.delay*2;i++){g.tick(0,0);assert.equal(g.outL,0);assert.equal(g.outR,0);}
});
test('filter poles remain stable and zero gain is an exact bypass at exposed extremes',()=>{
  for(const rate of [44100,48000,96000])for(const type of ['peaking','lowshelf','highshelf'])for(const f of [20,20000])for(const q of [.1,12])for(const gain of [-15,0,15]){
    const c=DSP.coeff(type,f,gain,q,rate);assert.ok(c.every(Number.isFinite));if(gain===0)assert.deepEqual(c,[1,0,0,1,0,0]);
  }
  const c=DSP.coeff('peaking',937.23,15,12,48000);assert.ok(DSP.headroom([c],0,48000)<=-15.499);
});
test('actual tag parser rejects duplicate/malformed R128 and separates OpusHead',async()=>{
  const source=await readFile(new URL('../public/drawercast/player.js',import.meta.url),'utf8');
  const ctx=vm.createContext({clean:s=>s.trim(),b64toBytes:()=>null});
  const fn=vm.runInContext(source.slice(source.indexOf('function applyTagKV('),source.indexOf('function parseVorbisComments('))+'\napplyTagKV',ctx);
  const out={};fn('R128_TRACK_GAIN','-573',out);assert.equal(out.r128TrackGain,-573);fn('R128_TRACK_GAIN','100',out);assert.equal(out.r128TrackGain,null);
  for(const value of ['NaN','Infinity','32768','1.5','1234567']){const x={};fn('R128_ALBUM_GAIN',value,x);assert.equal(x.r128AlbumGain,null);}
});
