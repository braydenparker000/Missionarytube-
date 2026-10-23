// Collects the text subtitles inside a Matroska file while it plays.
//
// Subtitle blocks are scattered through every cluster, so they are read from
// clusters the video pipeline has already downloaded: the scanner only parses
// byte ranges that are in the shared cache and never asks the network itself.

import {header, clusterSubtitleBlocks, decodeBlock, MKV_ID} from './mkv.js';
import {srtBlockCue, assBlockCue, parseAssHeader} from '../subtitles/parse.js';

const MAX_CLUSTER = 64 << 20;
const DEFAULT_DURATION = 5;
const text = new TextDecoder();

export class MkvSubtitleScanner {
  /**
   * @param {import('./http-source.js').HttpSource} source
   * @param {object} layout  from readLayout()
   * @param {Array} tracks   subtitleTracks(layout) entries
   * @param {(trackId: string, cues: Array) => void} onCues
   */
  constructor(source, layout, tracks, onCues) {
    this.source = source;
    this.layout = layout;
    this.tracks = new Map(tracks.filter(t => t.format && !t.encrypted).map(t => [t.number, t]));
    this.raw = new Map(layout.tracks.map(t => [t.number, t]));
    this.headers = new Map([...this.tracks.values()].filter(t => t.format === 'ass').map(t => [t.number, parseAssHeader(t.header)]));
    this.onCues = onCues;
    this.scanned = new Map(); // cluster position -> length
    this.cursor = layout.firstCluster;
    this.stopped = false;
    this.wake = null;
    this.unlisten = source.onBlock(() => this.wake?.());
    this.clusters = 0;
  }

  get active() { return this.tracks.size > 0; }

  /** Moves the scan to the cluster holding `time`. */
  seek(time) {
    const cues = this.layout.cues;
    if (!cues?.length) return;
    let best = cues[0].position;
    for (const c of cues) if (c.time <= time + 0.01) best = c.position; else break;
    this.cursor = best;
    this.wake?.();
  }

  start() { if (this.active) this.loop().catch(() => {}); }

  idle() {
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.wake = null; resolve(); };
      const timer = setTimeout(done, 2000);
      this.wake = done;
    });
  }

  async loop() {
    const {source, layout} = this;
    const scale = layout.timestampScale, wanted = new Set(this.tracks.keys());
    while (!this.stopped) {
      const pos = this.cursor;
      if (pos == null || pos + 12 > source.size) { await this.idle(); continue; }
      if (this.scanned.has(pos)) { this.cursor = pos + this.scanned.get(pos); continue; }
      if (!source.has(pos, pos + 16)) { await this.idle(); continue; }
      const h = header(await source.read(pos, Math.min(source.size, pos + 16)), 0);
      if (!h || h.size == null || h.size > MAX_CLUSTER) { this.stopped = true; break; } // live or damaged file
      const length = h.dataStart + h.size;
      if (h.id !== MKV_ID.Cluster) { this.scanned.set(pos, length); continue; } // cue index, tags, padding
      if (!source.has(pos, pos + length)) { await this.idle(); continue; }
      const bytes = await source.read(pos, pos + length);
      const found = new Map();
      for (const block of clusterSubtitleBlocks(bytes, wanted, scale)) {
        const track = this.tracks.get(block.track);
        const payload = text.decode(await decodeBlock(this.raw.get(block.track), block.data));
        const end = block.start + (block.duration ?? DEFAULT_DURATION);
        const cue = track.format === 'ass' ? assBlockCue(payload, block.start, end, this.headers.get(block.track)) : srtBlockCue(payload, block.start, end);
        if (!cue) continue;
        if (!found.has(track.id)) found.set(track.id, []);
        found.get(track.id).push(cue);
      }
      for (const [id, cues] of found) this.onCues(id, cues);
      this.scanned.set(pos, length);
      this.clusters++;
    }
  }

  stop() { this.stopped = true; this.unlisten(); this.wake?.(); }
}
