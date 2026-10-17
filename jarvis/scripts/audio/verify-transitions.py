#!/usr/bin/env python3
"""Independent output-peak scan of production graph edits, not endpoint curves."""
import argparse,json
from pathlib import Path
import numpy as np
from scipy.signal import firwin,resample_poly
p=argparse.ArgumentParser();p.add_argument('--input',type=Path,default=Path('/workspace/scratch/audio-transition-pcm.json'));p.add_argument('--output',type=Path,default=Path('docs/audio-evidence/transitions.json'));a=p.parse_args()
d=json.loads(a.input.read_text());kernel=firwin(8193,1/32,window=('kaiser',12));rows=[]
for x in d['rows']:
    pcm=np.array(x.pop('channels'),dtype=np.float64);finite=bool(np.isfinite(pcm).all());peak=0
    for ch in pcm:peak=max(peak,float(np.max(np.abs(resample_poly(ch,32,1,window=kernel)))))
    db=20*np.log10(max(peak,1e-15));tail=float(np.max(np.abs(pcm[:,-x['rate']//2:])))
    rows.append({**x,'finite':finite,'outputTruePeakDbtp':db,'lastHalfSecondPeak':tail,'passed':finite and db<=-.9 and tail<1e-12})
result={'browser':d['browser'],'oracle':'SciPy 32x, 8193-tap Kaiser beta 12','rows':rows,'passed':all(x['passed'] for x in rows)};a.output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'passed':result['passed'],'peaks':[x['outputTruePeakDbtp'] for x in rows]}));raise SystemExit(0 if result['passed'] else 1)
