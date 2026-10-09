// A fixed, same-origin loader. Canonical URLs, browser storage and UI stay intact.
// A pointer read selects one immutable document; it is never consulted mid-page.
(async () => {
  const fail = () => {
    document.body.replaceChildren();
    const p = document.createElement('p');
    p.textContent = 'Jarvis could not open. Please reload to try again.';
    document.body.append(p);
  };
  const bounded = async (url, limit, type) => {
    const r = await fetch(url, {cache:'no-store', redirect:'error', credentials:'omit', signal:AbortSignal.timeout(15000)});
    if (!r.ok || !r.headers.get('content-type')?.toLowerCase().startsWith(type)) throw Error();
    const reader = r.body.getReader(), chunks = []; let size = 0;
    try { for (;;) { const {done,value} = await reader.read(); if (done) break;
      size += value.length; if (size > limit) throw Error(); chunks.push(value);
    } } finally { await reader.cancel().catch(()=>{}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
    return bytes;
  };
  try {
    const pointer = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bounded('/jarvis-active-release.json',131072,'application/json')));
    if (pointer.schema !== 1 || !/^[a-f0-9]{64}$/.test(pointer.releaseId || '') || pointer.prefix !== '/_jarvis/releases/'+pointer.releaseId+'/' ||
        !Array.isArray(pointer.documents) || !pointer.documents.length || pointer.documents.length > 256) throw Error();
    const route = document.querySelector('meta[name="jarvis-document"]')?.content;
    const matches = pointer.documents.filter(d=>d.path===route);
    if (matches.length !== 1 || !/^[A-Za-z0-9_./-]+\.html$/.test(route || '') || route.split('/').some(p=>!p || p==='.' || p==='..')) throw Error();
    const expected = matches[0];
    if (!/^[a-f0-9]{64}$/.test(expected.sha256 || '') || !Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || expected.bytes > 2097152) throw Error();
    const bytes = await bounded(pointer.prefix+route,2097152,'text/html');
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
    if (bytes.length !== expected.bytes || digest !== expected.sha256) throw Error();
    const html = new TextDecoder('utf-8',{fatal:true}).decode(bytes);
    // document.write preserves the canonical path used by route and auth code.
    // Resource URLs in this sealed document are already immutable and absolute.
    document.open(); document.write(html); document.close();
  } catch { fail(); }
})();
