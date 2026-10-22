// A minimal zip reader (the AutoEq project import, `zb2`): the central
// directory's entries, read one at a time; stored and deflated entries only.

/** The entries of a zip in a Blob: [{name, size, read(): Promise<Uint8Array>}]. */
export async function zipEntries(blob) {
  const tail = new DataView(await blob.slice(Math.max(0, blob.size - 65557)).arrayBuffer());
  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = tail.getUint16(eocd + 10, true), size = tail.getUint32(eocd + 12, true), offset = tail.getUint32(eocd + 16, true);
  const dir = new DataView(await blob.slice(offset, offset + size).arrayBuffer());
  const dec = new TextDecoder();
  const out = [];
  for (let p = 0, n = 0; n < count && p + 46 <= dir.byteLength; n++) {
    if (dir.getUint32(p, true) !== 0x02014b50) break;
    const method = dir.getUint16(p + 10, true), csize = dir.getUint32(p + 20, true), usize = dir.getUint32(p + 24, true);
    const nameLen = dir.getUint16(p + 28, true), extraLen = dir.getUint16(p + 30, true), commentLen = dir.getUint16(p + 32, true);
    const local = dir.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(dir.buffer, dir.byteOffset + p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    out.push({
      name, size: usize, method,
      async read() {
        const head = new DataView(await blob.slice(local, local + 30).arrayBuffer());
        const start = local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
        const raw = blob.slice(start, start + csize);
        if (method === 0) return new Uint8Array(await raw.arrayBuffer());
        if (method !== 8) throw new Error('zip method ' + method);
        return new Uint8Array(await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
      },
    });
  }
  return out;
}
