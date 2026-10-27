#!/usr/bin/env python3
"""Seek-bar waveforms for the R2 music library: loudness, not peaks.

The reference player (Poweramp) scans a file natively into per-block mean
squares, takes 100 bars as the RMS of equal spans of blocks, divides them by
sqrt(max^2 + 0.01) and raises them to the power 1.35 (notebook F99). This tool
stores the measurement part, at higher resolution, so the player can do the
rest exactly:

  waveformKind "rms": 500 bins, each the RMS of an equal span of the decoded
  audio (every channel's samples, full scale 1.0), coded one byte per bin as
  round(255 * sqrt(min(1, rms))). Absolute, not normalised: a quiet song stays
  quieter than a loud one, as in the reference.

FFmpeg measures the blocks (astats, 4096 samples per block); nothing is
written to the audio. A song whose decode stops short of its length (a cut
stream) is an error, never a waveform of its first seconds. Modes:

  waveform.py FILE...                      print {"file", "waveform"} lines
  waveform.py --backfill --key KEY.pem     every library track without an
      [--jobs 4] [--limit N] [--state F]   "rms" waveform: download its audio
                                           from the Worker (one request a
                                           song), measure, send signed
                                           batches of 200
  waveform.py --backfill --redo-bad ...    also re-measure "rms" waveforms
                                           that are only a few flat steps
                                           (a short decode); use a new --state
"""
import argparse, base64, importlib.util, json, math, os, subprocess, sys, tempfile, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

BINS = 500
BLOCK = 4096
BATCH = 200
MIN_STEPS = 100   # a measured song has hundreds of distinct bins; a few flat steps is a cut decode
ORIGIN = 'https://jarvis-hub-api.braydenparker999.workers.dev'
KIND = 'rms'


def block_mean_squares(source, timeout=600):
    """Mean square of each 4096-sample block of the first audio stream (all channels)."""
    out = subprocess.run(
        ['ffmpeg', '-nostdin', '-v', 'error', '-i', str(source), '-map', '0:a:0', '-af',
         f'asetnsamples=n={BLOCK}:p=0,astats=metadata=1:reset=1:measure_perchannel=none:measure_overall=RMS_level,'
         'ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'],
        capture_output=True, text=True, timeout=timeout, check=True).stdout
    squares = []
    for line in out.splitlines():
        if line.startswith('lavfi.astats.Overall.RMS_level='):
            value = line.split('=', 1)[1].strip()
            db = float(value) if value not in ('-inf', 'inf', 'nan') else -math.inf
            squares.append(10 ** (db / 10) if math.isfinite(db) else 0.0)
    return squares


def bins_of(squares, bins=BINS):
    """RMS of equal spans of blocks (the reference's bar rule); nearest block when there are fewer."""
    n = len(squares)
    if not n:
        raise ValueError('No audio decoded')
    out = []
    for i in range(bins):
        if n < bins:
            out.append(math.sqrt(squares[min(n - 1, int(i * n / bins + 0.5))]))
            continue
        a = i * n // bins
        b = max(a + 1, (i + 1) * n // bins)
        out.append(math.sqrt(sum(squares[a:b]) / (b - a)))
    return out


def encode(rms):
    return base64.b64encode(bytes(round(255 * math.sqrt(min(1.0, max(0.0, x)))) for x in rms)).decode()


def probe(source, timeout=120):
    """(duration s, sample rate) of the first audio stream, or (None, None) when unknown."""
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'format=duration:stream=sample_rate',
         '-of', 'json', str(source)], capture_output=True, text=True, timeout=timeout, check=True).stdout
    info = json.loads(out or '{}')
    try:
        duration = float(info.get('format', {}).get('duration'))
    except (TypeError, ValueError):
        duration = None
    try:
        rate = int(info.get('streams', [{}])[0].get('sample_rate'))
    except (TypeError, ValueError, IndexError):
        rate = None
    return duration, rate


def waveform(source):
    squares = block_mean_squares(source)
    duration, rate = probe(source)
    if duration and rate:
        decoded = len(squares) * BLOCK / rate
        if decoded < 0.9 * duration - 1:
            raise ValueError(f'Decoded only {decoded:.1f} s of {duration:.1f} s')
    return encode(bins_of(squares))


def download(url, folder, timeout=300):
    """The whole file in one request (the Worker's daily request budget), checked against its length."""
    path = Path(folder) / 'audio'
    request = urllib.request.Request(url, headers={'User-Agent': 'JarvisWaveforms/1.0'})
    with urllib.request.urlopen(request, timeout=timeout) as response, path.open('wb') as out:
        expected = response.headers.get('Content-Length')
        while chunk := response.read(1 << 20):
            out.write(chunk)
    if expected is not None and path.stat().st_size != int(expected):
        raise ValueError(f'Downloaded {path.stat().st_size} of {expected} bytes')
    return path


def steps(raw):
    """Runs of equal bytes in a coded waveform: a measured song has hundreds."""
    return sum(1 for i, b in enumerate(raw) if i == 0 or b != raw[i - 1])


def signer():
    """The library uploader's signed request (same key, same message format)."""
    spec = importlib.util.spec_from_file_location('jarvis_music_upload', Path(__file__).parent.parent / 'upload-music-r2.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.upload_request


def public_key(key):
    der = subprocess.run(['openssl', 'pkey', '-in', str(key), '-pubout', '-outform', 'DER'],
                         check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout
    if len(der) != 44 or der[:12] != bytes.fromhex('302a300506032b6570032100'):
        raise RuntimeError('A dedicated Ed25519 PKCS8 PEM key is required.')
    return der[12:].hex()


def backfill(args):
    key_stat = args.key.stat()
    if key_stat.st_mode & 0o077 or key_stat.st_uid != os.getuid():
        raise RuntimeError('Signing key must belong to this user and have mode 0600 or 0400.')
    public, send = public_key(args.key), signer()
    request = urllib.request.Request(ORIGIN + '/music/library.json', headers={'User-Agent': 'JarvisWaveforms/1.0'})
    with urllib.request.urlopen(request, timeout=60) as response:
        tracks = json.loads(response.read())['tracks']
    done = set()
    if args.state and args.state.exists():
        done = {line.strip() for line in args.state.read_text().splitlines() if line.strip()}
    todo = [t['id'] for t in tracks if t.get('waveformKind') != KIND and t['id'] not in done]
    if args.redo_bad:
        def bad(track_id):
            url = f'{ORIGIN}/music/library/waveform/{track_id}'
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'JarvisWaveforms/1.0'}), timeout=60) as r:
                        return track_id, steps(r.read()) < MIN_STEPS
                except Exception:
                    time.sleep(2 * (attempt + 1))
            return track_id, False
        measured = [t['id'] for t in tracks if t.get('waveformKind') == KIND and t['id'] not in done]
        with ThreadPoolExecutor(max_workers=16) as pool:
            redo = [i for i, is_bad in pool.map(bad, measured) if is_bad]
        print(json.dumps({'checked': len(measured), 'bad': len(redo)}), flush=True)
        todo += redo
    if args.limit:
        todo = todo[:args.limit]
    print(json.dumps({'tracks': len(tracks), 'todo': len(todo)}), flush=True)

    def measure(track_id):
        for attempt in range(3):
            try:
                with tempfile.TemporaryDirectory() as folder:
                    return track_id, waveform(download(f'{ORIGIN}/music/library/audio/{track_id}', folder)), None
            except Exception as error:  # a network or decode failure: retried, then reported
                last = error
                time.sleep(2 * (attempt + 1))
        return track_id, None, str(last)[:200]

    pending, failed, sent = [], [], 0

    def flush():
        nonlocal pending, sent
        if not pending:
            return
        body = json.dumps({'items': pending}, separators=(',', ':')).encode()
        result = send('POST', '/music/uploads/waveforms', body, 'application/json', args.key, public)
        if args.state:
            with args.state.open('a') as f:
                f.writelines(item['id'] + '\n' for item in pending if item['id'] not in result.get('notFound', []))
        sent += result.get('updated', 0)
        print(json.dumps({'sent': sent, 'notFound': result.get('notFound', []), 'published': result.get('published')}), flush=True)
        pending = []

    with ThreadPoolExecutor(max_workers=args.jobs) as pool:
        for track_id, wave, error in pool.map(measure, todo):
            if wave is None:
                failed.append({'id': track_id, 'error': error})
                continue
            pending.append({'id': track_id, 'waveform': wave, 'kind': KIND})
            if len(pending) >= BATCH:
                flush()
    flush()
    print(json.dumps({'done': sent, 'failed': failed}), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('files', nargs='*', type=Path)
    parser.add_argument('--backfill', action='store_true')
    parser.add_argument('--key', type=Path)
    parser.add_argument('--jobs', type=int, default=4)
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--state', type=Path, help='Resumable: ids already sent, one per line')
    parser.add_argument('--redo-bad', action='store_true', help='Also re-measure "rms" waveforms of only a few flat steps')
    args = parser.parse_args()
    if args.backfill:
        if not args.key:
            parser.error('--backfill needs --key')
        return backfill(args)
    for f in args.files:
        print(json.dumps({'file': str(f), 'waveform': waveform(f)}), flush=True)


if __name__ == '__main__':
    sys.exit(main())
