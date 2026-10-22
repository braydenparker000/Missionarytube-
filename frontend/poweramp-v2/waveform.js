import {clamp} from './motion.js';

// Peaks are real sample maxima from the synthetic source. Unknown peaks use a timeline.
// Full-player display keeps the cursor centered, matching TopWaveseek's 50% resource.
export class Waveform {
  constructor(canvas) { this.canvas=canvas; this.peaks=null; this.position=0; this.duration=0; }
  update(peaks, position, duration) {
    this.peaks=peaks; this.position=position; this.duration=duration; this.draw();
  }
  draw() {
    const canvas=this.canvas, w=canvas.clientWidth,h=canvas.clientHeight;
    if(!w||!h)return;
    const dpr=Math.min(devicePixelRatio||1,3);
    if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);}
    const ctx=canvas.getContext('2d'); ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);
    if(!this.peaks?.length){ctx.fillStyle='#797979';ctx.fillRect(0,h/2-1,w,2);return;}
    const n=100, step=w/n, fraction=this.duration?clamp(this.position/this.duration):0;
    const offset=fraction*this.peaks.length;
    for(let i=0;i<n;i++) {
      const sample=Math.floor(offset+(i-n/2)*this.peaks.length/n), peak=this.peaks[sample];
      if(peak===undefined)continue;
      const height=10+clamp(peak)*(h-18),fade=Math.min(1,i/12,(n-i)/12);
      ctx.fillStyle=i<n/2?`rgba(255,255,255,${.88*fade})`:`rgba(255,255,255,${.32*fade})`;
      ctx.fillRect(i*step,(h-height)/2,Math.max(1,step-1.25),height);
    }
  }
}
