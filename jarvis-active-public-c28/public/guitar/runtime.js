export function filename(title, track) {
  const clean = s => String(s).normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/g, '').trim();
  const name = `${clean(title).slice(0, 110)} - ${clean(track).slice(0, 60)}`.trim();
  return `${name || 'Guitar tab'}.pdf`;
}
export function createDownload(blob, name, urlApi = URL) {
  if (!(blob instanceof Blob) || blob.size < 100) throw Error('Empty PDF');
  const url = urlApi.createObjectURL(blob);
  let active = true;
  return {
    blob,
    url,
    name,
    revoke() {
      if (!active) return;
      active = false;
      urlApi.revokeObjectURL(url);
    }
  };
}
export function nativeSaveMode(download, env = globalThis) {
  if (typeof env.showSaveFilePicker === 'function') return 'file-picker';
  if (typeof env.File !== 'function' || typeof env.navigator?.share !== 'function' || typeof env.navigator?.canShare !== 'function') return null;
  const file = new env.File([download.blob], download.name, { type: 'application/pdf' });
  return env.navigator.canShare({ files: [file] }) ? 'share' : null;
}
export async function saveToDevice(download, env = globalThis) {
  const mode = nativeSaveMode(download, env);
  if (mode === 'file-picker') {
    const handle = await env.showSaveFilePicker({
      suggestedName: download.name,
      types: [{ description: 'PDF document', accept: { 'application/pdf': ['.pdf'] } }]
    });
    const writable = await handle.createWritable();
    try { await writable.write(download.blob); } finally { await writable.close(); }
    return mode;
  }
  if (mode === 'share') {
    const file = new env.File([download.blob], download.name, { type: 'application/pdf' });
    await env.navigator.share({ files: [file], title: download.name });
    return mode;
  }
  return null;
}
export function triggerDownload(download, documentApi = document) {
  const link = documentApi.createElement('a');
  link.href = download.url; link.download = download.name; link.hidden = true;
  documentApi.body.append(link); link.click(); link.remove();
}
export async function withDeadline(work, ms) {
  const controller = new AbortController(); let timer;
  try { return await Promise.race([work(controller.signal), new Promise((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(Error("Couldn't generate this tab. Try another Songsterr version.")); }, ms);
  })]); } finally { clearTimeout(timer); controller.abort(); }
}
export function renderInWorker(data, signal) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./render-worker.js', import.meta.url), { type: 'module' });
    const cleanup = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(Error('Rendering timed out')); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { abort(); return; }
    worker.onmessage = ({ data }) => { cleanup(); data.ok ? resolve(data) : reject(Error('Rendering failed')); };
    worker.onerror = () => { cleanup(); reject(Error('Rendering failed')); };
    worker.postMessage(data);
  });
}
