import json,subprocess,tempfile,hashlib,re
from pathlib import Path
import argparse
args=argparse.ArgumentParser();args.add_argument('analysis_report',type=Path);args=args.parse_args()
root=Path(__file__).resolve().parents[2];patches=json.loads(args.analysis_report.read_text())['patches'];rows=[]
assert 1<=len(patches)<=100
for p in sorted(patches,key=lambda p:p['audioAnalysis']['truePeakDbtp'],reverse=True)[:3]:
 t=p;a=p['audioAnalysis']
 assert re.fullmatch(r'r2_[A-Za-z0-9_-]+',t['id'])
 with tempfile.TemporaryDirectory(prefix='jarvis-loud-original-') as d:
  d=Path(d);file=d/'original.bin';subprocess.run(['curl','--fail','--silent','--show-error','--max-time','60','--retry','3','--retry-delay','1','--max-filesize','33554432','https://jarvis-hub-api.braydenparker999.workers.dev/music/library/audio/'+t['id'],'-o',str(file)],check=True)
  assert hashlib.sha256(file.read_bytes()).hexdigest()==t['sha256'] and file.stat().st_size==t['size']
  track={'sha256':t['sha256'],'size':t['size'],'audioAnalysis':a}
  ledger=json.loads(subprocess.run(['node','--input-type=module','-e',"import{gainLedger}from'./public/drawercast/audio-core.js';console.log(JSON.stringify(gainLedger(JSON.parse(process.argv[1]),{audioMode:'transparent',volume:1,rgEnabled:false})));",json.dumps(track)],cwd=root,capture_output=True,text=True,check=True).stdout)
  for rate in [48000,96000]:
   subprocess.run(['ffmpeg','-y','-nostdin','-v','error','-i',str(file),'-map','0:a:0','-ar',str(rate),'-ac','2','-f','f32le',str(d/'in.f32')],check=True)
   r=json.loads(subprocess.run(['node',str(root/'scripts/audio/guard-measure.mjs'),str(d/'in.f32'),str(d/'out.f32'),str(rate),str(ledger['finalGain']),'new'],capture_output=True,text=True,check=True).stdout)
   assert r['activePercent']==0 and r['maxReductionDb']==0,r
   log=subprocess.run(['ffmpeg','-nostdin','-hide_banner','-f','f32le','-ar',str(rate),'-ac','2','-i',str(d/'out.f32'),'-af','ebur128=peak=true:framelog=verbose','-f','null','-'],capture_output=True,text=True,check=True).stderr
   s=log[log.rfind('Summary:'):];r['ffmpegOutputTruePeakDbtp']=float(re.search(r'Peak:\s*([-+\d.]+) dBFS',s).group(1))
   rows.append({'id':t['id'],'sha256':t['sha256'],'size':t['size'],'sourceRate':a['sampleRate'],'preparedAnalysis':a,'ledger':ledger,'render':r});print(t['id'],rate,r['activePercent'],r['maxReductionDb'],flush=True)
(root/'docs/audio-evidence/followup-additional-files.json').write_text(json.dumps({'selection':'Three highest measured true peaks in the separately reviewed 100-track batch; thresholds unchanged','decoder':'FFmpeg 7.1.5; float PCM SRC to indicated output rate','passed':True,'rows':rows},indent=2)+'\n')
