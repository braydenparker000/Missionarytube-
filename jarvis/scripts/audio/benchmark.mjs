import {performance} from 'node:perf_hooks';
import {writeFile} from 'node:fs/promises';
import {TruePeakGuard} from '../../public/drawercast/audio-core.js';
import {execFileSync} from 'node:child_process';
const original=execFileSync('git',['show','79452a07cdc456700e0ebf8b2b5b8ca4bd589d8c:public/drawercast/player.js'],{encoding:'utf8',maxBuffer:8*1024*1024});
const {default:baseline}=await import('data:text/javascript;base64,'+Buffer.from(original.match(/class SamplePeakLimiter\{[\s\S]*?\n\}/)[0]+';export default SamplePeakLimiter;').toString('base64'));
const rows=[];
for(const [backend,Guard] of [['previous sample-only limiter',baseline],['new true-peak guard',TruePeakGuard]])for(const rate of [44100,48000,96000]){
 const g=new Guard(rate),blocks=2000,times=new Float64Array(blocks),input=Float32Array.from({length:128},(_,i)=>1.4*Math.sin(i*.7));
 for(let b=0;b<blocks;b++){const start=performance.now();for(let i=0;i<input.length;i++)g.tick(input[i],-input[i]*.7);times[b]=performance.now()-start;}
 const sorted=[...times.subarray(100)].sort((a,b)=>a-b),deadline=128/rate*1000;
 rows.push({backend,rate,framesPerBlock:128,deadlineMs:deadline,p50Ms:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],p99Ms:sorted[Math.floor(sorted.length*.99)],maxMs:Math.max(...sorted),allocatedTypedBufferBytes:g.left.byteLength+g.right.byteLength+g.peaks.byteLength+g.indices.byteLength+(g.kernels||[]).reduce((n,k)=>n+k.byteLength,0)});
}
await writeFile('docs/audio-evidence/callback-benchmark.json',JSON.stringify({runtime:process.version,host:'Managed Linux desktop Node; excludes browser/Android scheduler and is not an underrun measurement',rows},null,2)+'\n');console.log(JSON.stringify(rows));
