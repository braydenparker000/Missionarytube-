import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {TruePeakGuard} from '../../public/drawercast/audio-core.js';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const [input,output,rateText='48000',gainText='1',backend='new']=process.argv.slice(2),rate=Number(rateText),gain=Number(gainText);
const bytes=await readFile(input),pcm=new Float32Array(bytes.buffer,bytes.byteOffset,bytes.length/4);
let Guard=TruePeakGuard;
if(backend==='old'){
 const source=execFileSync('git',['show','2104c37:public/drawercast/player.js'],{encoding:'utf8',maxBuffer:4*1024*1024});
 Guard=vm.runInNewContext(source.slice(source.indexOf('class SamplePeakLimiter{'),source.indexOf('/* Chrome playback improvements;'))+'\nSamplePeakLimiter');
}
const g=new Guard(rate),frames=pcm.length/2,out=new Float32Array((frames+g.delay)*2);
let active=0,min=1,inputEnergy=0,outputEnergy=0,peak=0;
const started=performance.now();
for(let i=0;i<frames+g.delay;i++){
 const l=(pcm[i*2]||0)*gain,r=(pcm[i*2+1]||0)*gain;g.tick(l,r);
 out[i*2]=g.outL;out[i*2+1]=g.outR;if(g.gain<.999)active++;min=Math.min(min,g.gain);
 inputEnergy+=l*l+r*r;outputEnergy+=g.outL*g.outL+g.outR*g.outR;peak=Math.max(peak,Math.abs(g.outL),Math.abs(g.outR));
}
await writeFile(output,Buffer.from(out.buffer));
console.log(JSON.stringify({backend,rate,frames,delay:g.delay,gain,activePercent:100*active/frames,maxReductionDb:-20*Math.log10(min),rmsChangeDb:10*Math.log10(outputEnergy/inputEnergy),samplePeakDbfs:20*Math.log10(peak),cpuMs:performance.now()-started,audioMs:1000*frames/rate}));
