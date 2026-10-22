/** Synthetic and explicitly selected local sources. No personal media is bundled. */
const SAMPLE_RATE = 22050;
const DEMO_SECONDS = 18;

function pcmWave(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const word = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  word(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true);
  word(8, 'WAVE'); word(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  word(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
  return new Blob([buffer], { type: 'audio/wav' });
}

function compose(root, notes, variant) {
  const samples = new Float32Array(SAMPLE_RATE * DEMO_SECONDS);
  const pulse = 0.375 + variant * 0.0625;
  const twoPi = Math.PI * 2;
  for (let i = 0; i < samples.length; i++) {
    const t = i / SAMPLE_RATE;
    const beat = Math.floor(t / pulse);
    const phase = t % pulse;
    const pitch = root * 2 ** (notes[beat % notes.length] / 12);
    const fade = Math.min(1, t / 0.04, (DEMO_SECONDS - t) / 0.6);
    const envelope = Math.min(1, phase / 0.009) * Math.exp(-phase * 7);
    const lead = Math.sin(twoPi * pitch * phase) + 0.22 * Math.sin(twoPi * pitch * 2 * phase);
    const bass = Math.sin(twoPi * root / 2 * t) * 0.07;
    samples[i] = fade * (lead * envelope * 0.2 + bass);
  }
  const peaks = Array.from({ length: 96 }, (_, bin) => {
    let peak = 0;
    for (let i = Math.floor(bin * samples.length / 96); i < Math.floor((bin + 1) * samples.length / 96); i++) peak = Math.max(peak, Math.abs(samples[i]));
    return peak;
  });
  const scale = Math.max(...peaks, 0.001);
  return { blob: pcmWave(samples, SAMPLE_RATE), peaks: Object.freeze(peaks.map(peak => peak / scale)) };
}

function catalog(tracks, urls) {
  let disposed = false;
  return {
    tracks,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const url of urls) URL.revokeObjectURL(url);
    }
  };
}

/** Original generated audio; peaks come from the very same PCM samples. */
export async function createDemoCatalog() {
  const definitions = [
    { id: 'demo-01', title: 'Night Transit', artist: 'V2 Sound Lab', album: 'Synthetic sessions', root: 220, notes: [0, 7, 12, 3, 10, 7, 15, 12], palette: ['#101728', '#49788a', '#dba56c'] },
    { id: 'demo-02', title: 'Glass Horizon', artist: 'V2 Sound Lab', album: 'Synthetic sessions', root: 174.614, notes: [0, 4, 7, 11, 12, 7, 4, 2], palette: ['#14211f', '#5b8d7d', '#cae8b9'] },
    { id: 'demo-03', title: 'After the Rain', artist: 'V2 Sound Lab', album: 'Synthetic sessions', root: 196, notes: [0, 3, 7, 10, 14, 10, 7, 5], palette: ['#20172b', '#7d608f', '#e9b1aa'] }
  ];
  const tracks = [];
  const urls = [];
  try {
    for (const [variant, definition] of definitions.entries()) {
      // Yield between compositions so the shell can paint while audio is prepared.
      await new Promise(resolve => setTimeout(resolve, 0));
      const { blob, peaks } = compose(definition.root, definition.notes, variant);
      const src = URL.createObjectURL(blob);
      urls.push(src);
      const { root, notes, ...metadata } = definition;
      tracks.push({ ...metadata, duration: DEMO_SECONDS, src, peaks, source: 'demo', artwork: definition.id });
    }
    return catalog(tracks, urls);
  } catch (error) {
    for (const url of urls) URL.revokeObjectURL(url);
    throw error;
  }
}

function fileId(file) {
  let hash = 2166136261;
  for (const char of `${file.name}\0${file.size}\0${file.lastModified}`) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return 'local-' + (hash >>> 0).toString(16);
}

/** Blob URLs live only for this session; the caller disposes a replaced catalog. */
export function createLocalCatalog(files) {
  const tracks = [];
  const urls = [];
  const ids = new Set();
  try {
    for (const file of Array.from(files || [])) {
      if (!file.type?.startsWith('audio/') && !/\.(mp3|mp4|m4a|aac|ogg|opus|wav|flac|webm)$/i.test(file.name || '')) continue;
      let id = fileId(file);
      while (ids.has(id)) id += '-copy';
      ids.add(id);
      const src = URL.createObjectURL(file);
      urls.push(src);
      tracks.push({
        id, src, title: file.name.replace(/\.[^.]+$/, '') || 'Untitled audio',
        artist: 'Local files', album: 'On this device', duration: 0, source: 'local',
        artwork: 'local', peaks: null
      });
    }
    return catalog(tracks, urls);
  } catch (error) {
    for (const url of urls) URL.revokeObjectURL(url);
    throw error;
  }
}
