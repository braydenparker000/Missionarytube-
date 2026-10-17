import {LIBRARY_KEY,MAX_LIBRARY_BYTES,readStoredLibrary} from '../public/drawercast/r2-library.js';

// One validated snapshot per current R2 binding. Never retain a request, body,
// or pending I/O promise across Worker requests. Each read still checks R2 HEAD:
// new uploads, replacements, deletions, and invalid catalogs cannot use old data.
const snapshots=new WeakMap();
export async function publicLibrary(bucket){
  const head=await bucket.head(LIBRARY_KEY);
  if(!head||!Number.isSafeInteger(head.size)||head.size>MAX_LIBRARY_BYTES||head.size<=0||
    typeof head.etag!=='string'||!head.etag||!(head.uploaded instanceof Date)||!Number.isFinite(head.uploaded.getTime()))throw Error('Invalid music library');
  const current=snapshots.get(bucket);
  if(current&&current.etag===head.etag&&current.size===head.size&&current.modified===head.uploaded.getTime())return current;
  snapshots.delete(bucket);
  // Bind the loaded bytes to the version checked above. An intervening catalog
  // replacement fails closed and the next request loads the latest snapshot.
  const stored=await readStoredLibrary(bucket,{etagMatches:head.etag});
  if(stored.etag!==head.etag||stored.size!==head.size||stored.uploaded?.getTime()!==head.uploaded.getTime())throw Error('Music library changed');
  const result={etag:head.etag,size:head.size,modified:head.uploaded.getTime(),
    text:stored.text,tracks:new Map(stored.data.tracks.map(t=>[t.id,t]))};
  snapshots.set(bucket,result);
  return result;
}
