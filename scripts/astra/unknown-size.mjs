// Rewrites a Matroska file the way a live recorder writes it: every cluster's
// size field says "unknown", so a reader must find where each cluster ends.
// Usage: node scripts/astra/unknown-size.mjs in.mkv out.mkv

import {readFileSync, writeFileSync} from 'node:fs';
import {header} from '../../frontend/astra/src/engine/mkv.js';

const CLUSTER = 0x1f43b675, SEGMENT = 0x18538067;
const bytes = readFileSync(process.argv[2]);
const ebml = header(bytes, 0);
const segment = header(bytes, ebml.dataStart + ebml.size);
if (segment.id !== SEGMENT) throw Error('not Matroska');
let pos = segment.dataStart, clusters = 0;
while (pos < bytes.length) {
  const h = header(bytes, pos);
  if (!h || h.size == null) break;
  if (h.id === CLUSTER) {
    const sizeAt = pos + 4, length = h.dataStart - sizeAt;
    bytes[sizeAt] = (0xff >> (length - 1)); // marker bit plus all ones
    for (let i = 1; i < length; i++) bytes[sizeAt + i] = 0xff;
    clusters++;
  }
  pos = h.dataStart + h.size;
}
writeFileSync(process.argv[3], bytes);
console.log(`${clusters} clusters now have unknown sizes`);
