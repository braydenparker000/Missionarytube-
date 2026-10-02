"""Create owner-generated audio/artwork inside Actions, without external downloads."""
import base64
import os
from pathlib import Path
import struct
import subprocess
import zlib
from mutagen.oggopus import OggOpus
from mutagen.flac import Picture

folder = Path('music-verification/native')
folder.mkdir(parents=True, exist_ok=True)
run = os.environ['GITHUB_RUN_ID'] + '-' + os.environ.get('GITHUB_RUN_ATTEMPT', '1')
audio = folder / 'canary.opus'
subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                'sine=frequency=' + str(400 + int(os.environ['GITHUB_RUN_ID']) % 600) + ':sample_rate=48000',
                '-t', '20', '-af', 'volume=0.02', '-c:a', 'libopus', '-b:a', '192k', '-y', str(audio)], check=True)

def chunk(name, data):
    return struct.pack('>I', len(data)) + name + data + struct.pack('>I', zlib.crc32(name + data) & 0xffffffff)

pixels = b''.join(b'\x00' + bytes([35, 99, 180]) * 320 for _ in range(320))
png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', 320, 320, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(pixels)) + chunk(b'IEND', b'')
picture = Picture()
picture.type, picture.mime, picture.width, picture.height, picture.depth, picture.data = 3, 'image/png', 320, 320, 24, png
song = OggOpus(audio)
song['title'] = 'Jarvis upload verification ' + run
song['artist'] = 'Jarvis generated test'
song['album'] = 'Temporary upload verification'
song['metadata_block_picture'] = base64.b64encode(picture.write()).decode()
song.save()
print('Prepared 20-second synthetic Opus and embedded 320x320 cover for this run only.')
