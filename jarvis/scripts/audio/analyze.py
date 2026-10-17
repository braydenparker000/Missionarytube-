#!/usr/bin/env python3
"""Bounded, optional FFmpeg analysis; reads originals, writes metadata only.
No normalization filter and no audio rewrite. Measurements include container gain.
"""
import argparse, array, hashlib, json, math, re, subprocess, sys, tempfile
from datetime import datetime, timezone
from pathlib import Path


def analyze(path, timeout=180):
    path=Path(path)
    version=subprocess.run(['ffmpeg','-version'],capture_output=True,text=True,check=True,timeout=10).stdout.splitlines()[0]
    probe=json.loads(subprocess.run(['ffprobe','-v','error','-select_streams','a:0','-show_streams','-of','json',str(path)],capture_output=True,text=True,check=True,timeout=15).stdout)['streams'][0]
    rate=int(probe['sample_rate']);channels=int(probe['channels'])
    if not 8000<=rate<=192000 or not 1<=channels<=8:raise ValueError('Unsupported analysis rate/channel count')
    container_gain=0
    with path.open('rb') as f:
        header=f.read(65536)
        start=header.find(b'OpusHead')
        if probe.get('codec_name')=='opus' and start>=0:container_gain=int.from_bytes(header[start+16:start+18],'little',signed=True)/256
    # PCM goes to a temporary analysis file, bounded by input duration and timeout.
    # FFmpeg's ebur128 is a mature independent meter; retain its version/basis.
    duration=float(probe.get('duration') or 0)
    if duration>1800:raise ValueError('Optional analysis is limited to 30-minute tracks')
    with tempfile.TemporaryDirectory(prefix='jarvis-audio-analysis-') as folder:
        pcm=Path(folder)/'decoded.f32';log=Path(folder)/'meter.log'
        with log.open('wb') as err:
            subprocess.run(['ffmpeg','-nostdin','-hide_banner','-y','-i',str(path),'-map','0:a:0','-t','1800',
                            '-af','ebur128=peak=true:framelog=verbose','-c:a','pcm_f32le','-f','f32le',str(pcm)],stderr=err,stdout=subprocess.DEVNULL,check=True,timeout=timeout)
        if pcm.stat().st_size>=rate*channels*4*1800:raise ValueError('Analysis duration limit reached')
        meter=log.read_text();summary=meter[meter.rfind('Summary:'):]
        integrated=float(re.search(r'I:\s*([-+\d.]+) LUFS',summary).group(1))
        true_peak=float(re.search(r'Peak:\s*([-+\d.]+) dBFS',summary).group(1))
        peak=0
        with pcm.open('rb') as f:
            while chunk:=f.read(1024*1024):
                values=array.array('f');values.frombytes(chunk)
                if sys.byteorder!='little':values.byteswap()
                peak=max(peak,max((abs(x) for x in values),default=0))
        if not peak or not math.isfinite(integrated) or integrated<=-70:raise ValueError('Silence/ungated analysis is unavailable')
    with path.open('rb') as original:sha=hashlib.file_digest(original,'sha256').hexdigest()
    return {'version':1,'sha256':sha,'audioBytes':path.stat().st_size,'gainBasis':'decoded-container-gain',
            'decoder':version,'method':'FFmpeg ebur128 BS.1770 true-peak / float PCM sample peak v1',
            'analyzedAt':datetime.now(timezone.utc).isoformat(),'sampleRate':rate,'channels':channels,
            'integratedLufs':integrated,'samplePeakDbfs':20*math.log10(peak),'truePeakDbtp':true_peak,
            'containerGainDb':container_gain}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('file',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--timeout',type=int,default=180)
    a=p.parse_args();a.output.write_text(json.dumps(analyze(a.file,min(300,max(15,a.timeout))),indent=2)+'\n')
