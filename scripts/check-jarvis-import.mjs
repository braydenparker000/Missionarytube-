import { createHash } from 'node:crypto';
import { readFile, readdir, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../jarvis/', import.meta.url));
export const IMPORT_TREE = 'db715e9f474bb302b9dea28829f7976d5957b6c3';
function objectHash(type, bytes) {
  return createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest();
}
/** Verify every imported byte and mode, including nested workflow/SOP files. */
export async function importedTree(directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.map(entry => ({ entry, sort: Buffer.from(entry.name + (entry.isDirectory() ? '/' : '')) }));
  names.sort((a, b) => Buffer.compare(a.sort, b.sort));
  const rows = [];
  for (const { entry } of names) {
    const path = join(directory, entry.name);
    let mode, hash;
    if (entry.isDirectory()) {
      mode = '40000';
      hash = Buffer.from(await importedTree(path), 'hex');
    } else if (entry.isFile()) {
      mode = (await lstat(path)).mode & 0o111 ? '100755' : '100644';
      hash = objectHash('blob', await readFile(path));
    } else {
      throw new Error(`Unexpected imported entry type: ${path}`);
    }
    rows.push(Buffer.concat([Buffer.from(`${mode} ${entry.name}\0`), hash]));
  }
  return objectHash('tree', Buffer.concat(rows)).toString('hex');
}
export async function checkJarvisImport() {
  const actual = await importedTree();
  if (actual !== IMPORT_TREE) throw new Error(`Imported Jarvis tree changed: expected ${IMPORT_TREE}, got ${actual}. Review source changes and update the import boundary explicitly.`);
  return actual;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`Verified exact Jarvis import tree ${await checkJarvisImport()}`);
}
