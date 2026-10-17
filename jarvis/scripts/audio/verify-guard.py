#!/usr/bin/env python3
"""Independent 32x long Kaiser-sinc oracle; evaluates rendered OUTPUT."""
import argparse,json,subprocess,tempfile,time
from pathlib import Path
import numpy as np
from scipy.signal import resample_poly, firwin
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--quick',action='store_true');args=p.parse_args()
oracle_filter=firwin(32*256+1,1/32,window=('kaiser',12))
rows=[];root=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='jarvis-guard-oracle-') as d:
 d=Path(d)
 for rate in [44100,48000,96000]:
  count=rate//4;t=np.arange(count);signals=[('impulse',np.where(t==100,3.,0)),('bass-modulation',2*np.sin(2*np.pi*70*t/rate)*(1+.8*np.sin(2*np.pi*7*t/rate))),('nyquist',2*(-1.)**t)]
  for freq in [.25,.45,.49,.499]:
   for phase in np.linspace(0,2*np.pi,8 if args.quick else 24,endpoint=False):signals.append((f'tone-{freq}-{phase:.4f}',2*np.sin(2*np.pi*freq*t+phase)))
  for name,x in signals:
   x=x.astype('<f4');stereo=np.column_stack([x,-x*.3]);stereo.tofile(d/'in.f32')
   r=subprocess.run(['node',str(root/'scripts/audio/guard-measure.mjs'),str(d/'in.f32'),str(d/'out.f32'),str(rate)],capture_output=True,text=True,check=True)
   metrics=json.loads(r.stdout);y=np.fromfile(d/'out.f32',dtype='<f4').reshape(-1,2)
   # Long FIR, different window/length than the realtime detector. Include
   # edges and release tails; no trimming away difficult samples.
   truepeak=max(np.max(np.abs(resample_poly(y[:,c],32,1,window=oracle_filter))) for c in range(2))
   metrics.update(name=name,oracleTruePeakDbtp=float(20*np.log10(truepeak)),passed=bool(20*np.log10(truepeak)<=-.9))
   rows.append(metrics)
 # Idle path must be exact float identity after the declared delay.
 x=np.column_stack([.1*np.sin(np.arange(10000)*.13),.05*np.cos(np.arange(10000)*.27)]).astype('<f4');x.tofile(d/'in.f32')
 metrics=json.loads(subprocess.run(['node',str(root/'scripts/audio/guard-measure.mjs'),str(d/'in.f32'),str(d/'out.f32')],capture_output=True,text=True,check=True).stdout)
 y=np.fromfile(d/'out.f32',dtype='<f4').reshape(-1,2)[metrics['delay']:]
 residual=y-x;idle={'maxResidual':float(np.max(abs(residual))),'rmsResidual':float(np.sqrt(np.mean(residual**2))),'activePercent':metrics['activePercent']}
report={'oracle':'SciPy resample_poly 32x, 8193-tap Kaiser beta12; SciPy '+__import__('scipy').__version__,'vectors':rows,'idle':idle,'passed':all(x['passed'] for x in rows) and idle['maxResidual']==0}
args.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({'passed':report['passed'],'worstDbtp':max(x['oracleTruePeakDbtp'] for x in rows),'failed':[(x['rate'],x['name'],x['oracleTruePeakDbtp']) for x in rows if not x['passed']][:10],'idle':idle}))
