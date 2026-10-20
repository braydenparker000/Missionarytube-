// Git-compatible identity of actual source bytes and executable modes.
import {createHash} from 'node:crypto';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
function objectHash(type, bytes) {
  return createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest();
}
/** Hash every source byte and executable mode, refusing links and special files. */
export async function gitTree(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries.map(entry => ({ entry, sort: Buffer.from(entry.name + (entry.isDirectory() ? '/' : '')) }));
  names.sort((a, b) => Buffer.compare(a.sort, b.sort));
  const rows = [];
  for (const { entry } of names) {
    const path = join(directory, entry.name);
    let mode, hash;
    if (entry.isDirectory()) {
      mode = '40000';
      hash = Buffer.from(await gitTree(path), 'hex');
    } else if (entry.isFile()) {
      mode = (await lstat(path)).mode & 0o111 ? '100755' : '100644';
      hash = objectHash('blob', await readFile(path));
    } else {
      throw new Error(`Unexpected source entry type: ${path}`);
    }
    rows.push(Buffer.concat([Buffer.from(`${mode} ${entry.name}\0`), hash]));
  }
  return objectHash('tree', Buffer.concat(rows)).toString('hex');
}
