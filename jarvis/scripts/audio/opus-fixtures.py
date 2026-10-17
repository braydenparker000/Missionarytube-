#!/usr/bin/env python3
"""Generate synthetic fixtures only; patch OpusHead gain and repair Ogg CRC."""
import argparse,json,struct,subprocess
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);a=p.parse_args();a.output.mkdir(parents=True,exist_ok=True)
subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-f','lavfi','-i','aevalsrc=0.07*sin(2*PI*997*t)|0.04*sin(2*PI*1511*t):s=48000:d=3','-c:a','libopus','-b:a','192k',str(a.output/'gain0.opus')],check=True)
base=(a.output/'gain0.opus').read_bytes()
for gain in [-6,6]:
 data=bytearray(base);segments=data[26];page_length=27+segments+sum(data[27:27+segments]);header=data.find(b'OpusHead',0,page_length);struct.pack_into('<h',data,header+16,gain*256)
 data[22:26]=bytes(4);crc=0
 for b in data[:page_length]:
  crc^=b<<24
  for _ in range(8):crc=((crc<<1)^0x04c11db7 if crc&0x80000000 else crc<<1)&0xffffffff
 struct.pack_into('<I',data,22,crc);(a.output/f'gain{gain}.opus').write_bytes(data)
# 44.1 input decoded/processed rates are exercised separately from OpusHead.
subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-f','lavfi','-i','aevalsrc=0.07*sin(2*PI*997*t)|0.04*sin(2*PI*1511*t):s=44100:d=3','-c:a','pcm_f32le',str(a.output/'rate44100.wav')],check=True)
