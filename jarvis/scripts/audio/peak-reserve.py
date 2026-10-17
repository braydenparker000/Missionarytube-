import json,subprocess,tempfile,hashlib
from pathlib import Path
import argparse
p=argparse.ArgumentParser();p.add_argument('corpus_folder',type=Path);args=p.parse_args()
root=Path(__file__).resolve().parents[2];old=json.loads((root/'docs/audio-evidence/corpus-measurements.json').read_text());rows=[]
for t in old['tracks']:
 a=t['analysis'];file=next(args.corpus_folder.glob(t['id']+'.*'))
 assert hashlib.sha256(file.read_bytes()).hexdigest()==a['sha256']
 with tempfile.TemporaryDirectory(prefix='jarvis-fixed-peak-') as d:
  d=Path(d);subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(file),'-map','0:a:0','-ar','48000','-ac','2','-f','f32le',str(d/'in.f32')],check=True)
  track={'sha256':a['sha256'],'size':a['audioBytes'],'audioAnalysis':a}
  ledger=json.loads(subprocess.run(['node','--input-type=module','-e',"import{gainLedger}from'./public/drawercast/audio-core.js';console.log(JSON.stringify(gainLedger(JSON.parse(process.argv[1]),{audioMode:'transparent',volume:1,rgEnabled:false})));",json.dumps(track)],cwd=root,check=True,capture_output=True,text=True).stdout)
  r=json.loads(subprocess.run(['node',str(root/'scripts/audio/guard-measure.mjs'),str(d/'in.f32'),str(d/'out.f32'),'48000',str(ledger['finalGain']),'new'],capture_output=True,text=True,check=True).stdout)
  assert r['activePercent']==0 and r['maxReductionDb']==0, r
  import re
  v=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-f','f32le','-ar','48000','-ac','2','-i',str(d/'out.f32'),'-af','ebur128=peak=true:framelog=verbose','-f','null','-'],capture_output=True,text=True,check=True).stderr
  s=v[v.rfind('Summary:'):];r['ffmpegOutputTruePeakDbtp']=float(re.search(r'Peak:\s*([-+\d.]+) dBFS',s).group(1))
  rows.append({'id':t['id'],'sha256':a['sha256'],'ledger':ledger,'priorRelease100':next(v for v in t['variants'] if v['variant']=='new-fixed100'),'followup100':r});print(t['id'],r['activePercent'],r['maxReductionDb'],flush=True)
(root/'docs/audio-evidence/followup-peak.json').write_text(json.dumps({'source':'hash-verified original corpus; FFmpeg 7.1.5 float decode/SRC to 48 kHz','passed':True,'tracks':rows},indent=2)+'\n')
