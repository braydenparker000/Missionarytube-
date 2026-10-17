import test from 'node:test';
import assert from 'node:assert/strict';
import {median,compareSetupModes,setupOperations} from './helpers/poweramp-performance.js';
const group=(mode,times)=>({mode,reports:times.map((total,i)=>({label:['first-mini-tap','warm-1-mini-tap','warm-2-mini-tap'][i],operations:setupOperations.map(operation=>({operation,phase:'shared:setup:expand',total_ms:total,self_ms:total/2}))}))});
test('serial setup comparison uses independent medians and two warm samples without summing overlapping costs',()=>{
  const summary=compareSetupModes([group('compact',[70,60,80]),group('baseline',[120,100,100])]);
  assert.equal(summary.operations['shared.create'].medianRatio,.7);assert.equal(summary.operations['shared.create'].warmRatio,.7);assert.equal(summary.materiallyImproved,true);
  assert.deepEqual(summary.operations['shared.clone'].compact.self_ms,[35,30,40]);
  assert.equal(median([7,1,3]),3);assert.equal(median([8,2]),5);
});
test('first-only or overlapping-total improvement cannot hide slow warm setup',()=>{
  const summary=compareSetupModes([group('baseline',[300,100,100]),group('compact',[60,90,90])]);
  assert.equal(summary.materiallyImproved,false);assert.equal(summary.operations['shared.create'].warmRatio,.9);
});
test('missing modes, sample labels, operations and invalid timings are rejected',()=>{
  assert.throws(()=>compareSetupModes([group('baseline',[100,100,100])]),/Both exhaustive/);
  const compact=group('compact',[10,10,10]);compact.reports[2].label='warm-1-mini-tap';assert.throws(()=>compareSetupModes([group('baseline',[100,100,100]),compact]),/Each mode requires/);
  const incomplete=group('compact',[10,10,10]);incomplete.reports[0].operations=[];assert.throws(()=>compareSetupModes([group('baseline',[100,100,100]),incomplete]),/Missing real setup/);
  for(const values of [[],[NaN],[Infinity],[-1]])assert.throws(()=>median(values),/finite nonnegative/);
});
