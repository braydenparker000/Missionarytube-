// Collects the subtitles inside a file while it plays (Matroska and MP4).
//
// Subtitle samples are scattered through the file between audio and video,
// so they are read from bytes the video pipeline has already downloaded: the
// scanners only parse what is in the shared block cache and never ask the
// network themselves. Each block is looked at as it arrives, so seeking (with
// or without a cue index) needs nothing special: the new position's data
// arrives and its subtitles come with it.

import {BLOCK} from './http-source.js';
import {header, parseCluster, decodeBlock, MKV_ID} from './mkv.js';
import {sampleText} from './mp4.js';
import {srtBlockCue, assBlockCue, parseAssHeader} from '../subtitles/parse.js';
import {PgsDecoder, PgsTimeline} from '../subtitles/pgs.js';
import {VobSubDecoder} from '../subtitles/vobsub.js';

const DEFAULT_DURATION = 5;
const MAX_UNKNOWN_CLUSTER = 48 << 20;
const text = new TextDecoder();

/** Shared plumbing: listens for cached blocks and processes them in batches. */
class BlockScanner {
  constructor(source, onCues, onChange) {
    this.source = source;
    this.onCues = onCues;
    this.onChange = onChange;
    this.pending = new Set();
    this.timer = 0;
    this.running = false;
    this.stopped = false;
    this.unlisten = () => {};
    this.blockSize = source.blockSize || BLOCK;
  }

  start() {
    if (!this.active) return;
    this.unlisten = this.source.onBlock(i => this.enqueue(i));
    for (const i of this.source.cachedBlocks()) this.enqueue(i);
  }

  /** Kept for callers that report seeks; arriving data drives the scan. */
  seek() {}

  enqueue(index) {
    this.pending.add(index);
    if (!this.timer && !this.running && !this.stopped) this.timer = setTimeout(() => { this.timer = 0; this.run(); }, 30);
  }

  /** Processes pending blocks until none are left; blocks that land meanwhile join the next pass. */
  async run() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.pending.size && !this.stopped) {
        const batch = [...this.pending].sort((a, b) => a - b);
        this.pending.clear();
        await this.process(batch).catch(() => {});
      }
    } finally { this.running = false; }
  }

  stop() { this.stopped = true; clearTimeout(this.timer); this.unlisten(); }
}

export class MkvSubtitleScanner extends BlockScanner {
  /**
   * @param {import('./http-source.js').HttpSource} source
   * @param {object} layout  from readLayout()
   * @param {Array} tracks   subtitleTracks(layout) entries
   * @param {(trackId: string, cues: Array) => void} onCues
   * @param {() => void} [onChange]  cue end times changed (picture subtitles)
   */
  constructor(source, layout, tracks, onCues, onChange = () => {}) {
    super(source, onCues, onChange);
    this.layout = layout;
    this.tracks = new Map(tracks.filter(t => t.format && !t.encrypted).map(t => [t.number, t]));
    this.raw = new Map(layout.tracks.map(t => [t.number, t]));
    this.wanted = new Set(this.tracks.keys());
    this.headers = new Map();
    this.pictures = new Map();
    for (const t of this.tracks.values()) {
      if (t.format === 'ass') this.headers.set(t.number, parseAssHeader(t.header));
      if (t.format === 'pgs') this.pictures.set(t.number, {decoder: new PgsDecoder(t.id), timeline: new PgsTimeline()});
      if (t.format === 'vobsub') this.pictures.set(t.number, {decoder: new VobSubDecoder(t.header, t.id)});
    }
    this.known = new Set(); // every cluster position seen
    this.waiting = new Set(); // positions not read or rejected yet
    this.searched = new Set();
    this.parsed = []; // sorted [start, end) of clusters already read, to drop matches inside them
    for (const c of layout.cues || []) this.add(c.position);
    if (layout.firstCluster != null) this.add(layout.firstCluster);
    this.clustersScanned = 0;
  }

  get active() { return this.tracks.size > 0; }
  get clustersRead() { return this.clustersScanned; }

  async process(batch) {
    for (const i of batch) await this.discover(i);
    await this.readReady();
  }

  /** Finds cluster headers inside a newly cached block. */
  async discover(index) {
    const {source} = this;
    const from = index * this.blockSize, to = Math.min(source.size, from + this.blockSize);
    if (this.searched.has(index) || !source.has(from, to)) return;
    this.searched.add(index);
    const start = from >= 3 && source.has(from - 3, from) ? from - 3 : from;
    const bytes = await source.read(start, to);
    const first = this.layout.firstCluster ?? 0;
    for (let p = bytes.indexOf(0x1f); p >= 0 && p + 4 <= bytes.length; p = bytes.indexOf(0x1f, p + 1)) {
      if (bytes[p + 1] !== 0x43 || bytes[p + 2] !== 0xb6 || bytes[p + 3] !== 0x75) continue;
      const pos = start + p;
      if (pos >= first && !this.inside(pos)) this.add(pos);
    }
  }

  add(pos) { if (!this.known.has(pos)) { this.known.add(pos); this.waiting.add(pos); } }

  /** True when pos falls strictly inside a cluster already read. */
  inside(pos) {
    let lo = 0, hi = this.parsed.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (this.parsed[mid][0] < pos) lo = mid + 1; else hi = mid; }
    const before = this.parsed[lo - 1];
    return !!before && pos < before[1];
  }

  markParsed(start, end) {
    let i = this.parsed.length;
    while (i > 0 && this.parsed[i - 1][0] > start) i--;
    this.parsed.splice(i, 0, [start, end]);
  }

  /** Reads every known cluster whose bytes are all cached. */
  async readReady() {
    const {source} = this;
    const scale = this.layout.timestampScale;
    const drop = pos => this.waiting.delete(pos);
    for (const pos of [...this.waiting].sort((a, b) => a - b)) {
      if (this.stopped) return;
      if (this.inside(pos)) { drop(pos); continue; }
      if (pos + 12 > source.size) { drop(pos); continue; }
      if (!source.has(pos, pos + 12)) continue;
      const h = header(await source.read(pos, pos + 12), 0);
      if (!h || h.id !== MKV_ID.Cluster) { drop(pos); continue; }
      const length = h.size == null ? null : h.dataStart + h.size;
      let parsed;
      if (length != null) {
        if (pos + length > source.size) { drop(pos); continue; }
        if (!source.has(pos, pos + length)) continue;
        parsed = parseCluster(await source.read(pos, pos + length), this.wanted, scale);
        if (!parsed.valid) { drop(pos); continue; }
      } else {
        // Unknown size (written live): read on until the next top-level element.
        const until = Math.min(source.cachedUntil(pos), pos + MAX_UNKNOWN_CLUSTER);
        const bytes = await source.read(pos, until);
        parsed = parseCluster(bytes, this.wanted, scale);
        if (!parsed.complete && until >= source.size) parsed = parseCluster(withEnd(bytes), this.wanted, scale);
        if (!parsed.complete) { if (until - pos >= MAX_UNKNOWN_CLUSTER) drop(pos); continue; }
        if (!parsed.valid) { drop(pos); continue; }
      }
      drop(pos);
      this.markParsed(pos, pos + parsed.length);
      this.clustersScanned++;
      await this.emit(parsed.blocks);
    }
  }

  async emit(blocks) {
    const found = new Map();
    let changed = false;
    for (const block of blocks) {
      const track = this.tracks.get(block.track);
      const payload = await decodeBlock(this.raw.get(block.track), block.data);
      let cue = null;
      const picture = this.pictures.get(block.track);
      if (picture?.timeline) {
        const result = picture.decoder.decode(payload, block.start);
        if (picture.timeline.add(result, block.duration)) changed = true;
        cue = result?.image ? result : null;
      } else if (picture) {
        cue = picture.decoder.decode(payload, block.start, block.duration);
      } else {
        const body = text.decode(payload);
        const end = block.start + (block.duration ?? DEFAULT_DURATION);
        cue = track.format === 'ass' ? assBlockCue(body, block.start, end, this.headers.get(block.track)) : srtBlockCue(body, block.start, end);
      }
      if (!cue) continue;
      if (!found.has(track.id)) found.set(track.id, []);
      found.get(track.id).push(cue);
    }
    for (const [id, cues] of found) this.onCues(id, cues);
    if (changed) this.onChange();
  }
}

function withEnd(bytes) {
  const out = new Uint8Array(bytes.length + 12);
  out.set(bytes);
  out.set([0x1f, 0x43, 0xb6, 0x75, 0x81, 0x00], bytes.length);
  return out;
}

export class Mp4SubtitleScanner extends BlockScanner {
  /**
   * @param {import('./http-source.js').HttpSource} source
   * @param {Array} tracks  readMp4Subtitles() entries (with samples)
   */
  constructor(source, tracks, onCues, onChange = () => {}) {
    super(source, onCues, onChange);
    this.tracks = tracks.filter(t => t.format && t.samples?.length);
    this.byBlock = new Map(); // block index -> [{track, sample}]
    for (const track of this.tracks) for (const sample of track.samples) {
      if (!sample.size) continue;
      for (let i = Math.floor(sample.offset / this.blockSize); i <= Math.floor((sample.offset + sample.size - 1) / this.blockSize); i++) {
        if (!this.byBlock.has(i)) this.byBlock.set(i, []);
        this.byBlock.get(i).push({track, sample});
      }
    }
    this.clustersScanned = 0;
  }

  get active() { return this.tracks.length > 0; }
  get clustersRead() { return this.clustersScanned; }

  async process(batch) {
    const found = new Map();
    for (const i of batch) {
      for (const entry of this.byBlock.get(i) || []) {
        const {track, sample} = entry;
        if (sample.done || !this.source.has(sample.offset, sample.offset + sample.size)) continue;
        sample.done = true;
        const body = sampleText(track.format, await this.source.read(sample.offset, sample.offset + sample.size));
        const cue = body.trim() ? srtBlockCue(body, sample.start, sample.end) : null;
        if (!cue) continue;
        if (!found.has(track.id)) found.set(track.id, []);
        found.get(track.id).push(cue);
      }
      this.clustersScanned++;
    }
    for (const [id, cues] of found) this.onCues(id, cues);
  }
}
