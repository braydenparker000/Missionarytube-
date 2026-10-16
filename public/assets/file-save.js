// Call saveToDevice synchronously from a click on an already prepared file.
// File sharing is a handoff, not confirmation that a destination saved the bytes.
export function nativeSaveMode(download, env = globalThis) {
  if (typeof env.showSaveFilePicker === 'function') return 'file-picker';
  try {
    if (typeof env.File !== 'function' || typeof env.navigator?.share !== 'function' || typeof env.navigator?.canShare !== 'function') return null;
    return env.navigator.canShare({ files: [shareFile(download, env)] }) ? 'share' : null;
  } catch { return null; }
}
function shareFile(download, env) {
  return new env.File([download.blob], download.name, { type: download.blob.type || 'application/octet-stream' });
}
export async function saveToDevice(download, env = globalThis) {
  const mode = nativeSaveMode(download, env);
  if (mode === 'file-picker') {
    const handle = await env.showSaveFilePicker({ suggestedName: download.name });
    const writable = await handle.createWritable();
    try { await writable.write(download.blob); await writable.close(); }
    catch (error) { try { await writable.abort?.(); } catch {} throw error; }
  } else if (mode === 'share') {
    await env.navigator.share({ files: [shareFile(download, env)], title: download.name });
  }
  return mode;
}
export function triggerDownload(download, documentApi = document) {
  download.handoff?.();
  const link = documentApi.createElement('a');
  link.href = download.url; link.download = download.name; link.hidden = true;
  documentApi.body.append(link); link.click(); link.remove();
}
// Keep accessible URLs alive. After a browser handoff, allow time for the new
// document/download to consume them even if this view is immediately replaced.
export function createFileDownload(blob, name, urlApi = URL, schedule = setTimeout) {
  const url = urlApi.createObjectURL(blob);
  let active = true, handedOff = false;
  return { blob, name, url, handoff() { handedOff = true; }, revoke() {
    if (!active) return;
    active = false;
    if (handedOff) schedule(() => urlApi.revokeObjectURL(url), 300000);
    else urlApi.revokeObjectURL(url);
  } };
}
