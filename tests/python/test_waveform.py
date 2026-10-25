"""Seek-bar waveform measurement (scripts/audio/waveform.py): loudness bins, coded as the player reads them."""
import base64, importlib.util, math, shutil, struct, subprocess, tempfile, unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('jarvis_waveform', Path(__file__).parents[2] / 'scripts' / 'audio' / 'waveform.py')
waveform = importlib.util.module_from_spec(spec)
spec.loader.exec_module(waveform)


class Bins(unittest.TestCase):
    def test_bins_are_rms_of_equal_spans(self):
        squares = [0.01] * 500 + [0.16] * 500
        bins = waveform.bins_of(squares, 10)
        self.assertEqual([round(b, 6) for b in bins], [0.1] * 5 + [0.4] * 5)
        mixed = waveform.bins_of([0.01, 0.16] * 50, 10)
        self.assertAlmostEqual(mixed[0], math.sqrt((0.01 + 0.16) / 2))

    def test_fewer_blocks_take_the_nearest(self):
        self.assertEqual([round(b, 6) for b in waveform.bins_of([0.01, 0.09, 0.25], 6)], [0.1, 0.3, 0.3, 0.5, 0.5, 0.5])
        with self.assertRaises(ValueError):
            waveform.bins_of([])

    def test_bytes_are_square_root_coded_absolute_rms(self):
        coded = base64.b64decode(waveform.encode([0, 0.25, 1, 2]))
        self.assertEqual(list(coded), [0, 128, 255, 255])

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg is required')
    def test_a_tone_measures_its_rms(self):
        # 2 s of a sine at 0.5 x FFmpeg's default 1/8 amplitude (RMS 0.0442), then 2 s of silence.
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'tone.wav'
            subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
                            '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-filter_complex',
                            '[0]volume=0.5[a];[1]atrim=duration=2[b];[a][b]concat=n=2:v=0:a=1', str(path)], check=True)
            rms = [(b / 255) ** 2 for b in base64.b64decode(waveform.waveform(path))]
            self.assertEqual(len(rms), waveform.BINS)
            self.assertAlmostEqual(sum(rms[:200]) / 200, 0.5 / 8 / math.sqrt(2), delta=0.002)
            self.assertLess(max(rms[260:]), 0.001)


if __name__ == '__main__':
    unittest.main()
