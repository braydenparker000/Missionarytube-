#!/usr/bin/env python3
import importlib.util,json,subprocess,tempfile
from pathlib import Path
import numpy as np
from scipy.signal import resample_poly
root=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('analyzer',Path(__file__).parent/'analyze.py');analyzer=importlib.util.module_from_spec(spec);spec.loader.exec_module(analyzer)
corpus=json.loads((root/'docs/audio-evidence/corpus.json').read_text());rows=[]
folder=Path('/workspace/scratch/audio-corpus')
for t in corpus['tracks']:
 file=next(folder.glob(t['id']+'.*'));a=analyzer.analyze(file);rows.append({'id':t['id'],'analysis':a,'variants':[]})
 print('Analyzed',t['id'],a['integratedLufs'],a['truePeakDbtp'],flush=True)
 with tempfile.TemporaryDirectory(prefix='jarvis-corpus-') as d:
  d=Path(d)
  subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(file),'-map','0:a:0','-ar','48000','-ac','2','-f','f32le',str(d/'in.f32')],check=True)
  # Whole-file old limiter establishes the baseline, new guard at volume50
  # and fixed per-file protection uses measured peaks with detector margin.
  fixed=10**(min(0,-3-a['truePeakDbtp'])/20)
  for backend,gain,label in [('old',1,'baseline100'),('old',.25,'volume-before50'),('new',.25,'new-volume50'),('new',fixed,'new-fixed100')]:
   r=subprocess.run(['node',str(root/'scripts/audio/guard-measure.mjs'),str(d/'in.f32'),str(d/'out.f32'),'48000',str(gain),backend],capture_output=True,text=True,check=True)
   v=json.loads(r.stdout);v['variant']=label
   # Separate FFmpeg output scan evaluates guard modulation over the full file.
   r=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-f','f32le','-ar','48000','-ac','2','-i',str(d/'out.f32'),'-af','ebur128=peak=true:framelog=verbose','-f','null','-'],capture_output=True,text=True,check=True)
   import re
   summary=r.stderr[r.stderr.rfind('Summary:'):];v['ffmpegOutputTruePeakDbtp']=float(re.search(r'Peak:\s*([-+\d.]+) dBFS',summary).group(1))
   v['ffmpegOutputLufs']=float(re.search(r'I:\s*([-+\d.]+) LUFS',summary).group(1));rows[-1]['variants'].append(v)
   print(label,v['activePercent'],v['maxReductionDb'],v['ffmpegOutputTruePeakDbtp'],flush=True)
(root/'docs/audio-evidence/corpus-measurements.json').write_text(json.dumps({'decoderVersion':a['decoder'],'tracks':rows},indent=2)+'\n')
