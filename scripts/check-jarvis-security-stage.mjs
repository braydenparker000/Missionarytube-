import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const index=process.argv.indexOf('--root');
const root=resolve(index>=0?process.argv[index+1]:'dist');
const paths=['podcasts/app.js','podcasts/directory.js','podcasts/index.html','podcasts/sw.js',
  'assets/app.js','assets/quick-ai.js','assets/relay-transfer.js','assets/relay-draft-store.js','assets/relay-owner-ui.js'];
const sources=new Map(await Promise.all(paths.map(async path=>[path,await readFile(join(root,path),'utf8')])));
// A release artifact must actually contain the data-only adapter and transfer
// modules. This read-only gate complements the source runtime/browser suites.
for(const path of ['podcasts/app.js','podcasts/directory.js']){
  const code=sources.get(path);
  assert.equal(/jsonpDirectory|__jarvis_podcast_|createElement\s*\(\s*['"]script['"]|\beval\s*\(|new\s+Function\s*\(/.test(code),false,`${path}: executable directory response path`);
}
for(const match of sources.get('podcasts/index.html').matchAll(/<script\b[^>]*\bsrc=["']([^"']+)/gi))
  assert.ok(match[1].startsWith('/podcasts/')||match[1].startsWith('/assets/'),`Podcasts contains an external executable source: ${match[1]}`);
assert.ok(sources.get('podcasts/sw.js').includes("'/podcasts/directory.js'"),'Offline shell must include the directory adapter');
assert.ok(sources.get('assets/relay-transfer.js').includes("'jarvis.relay.transfer.v2'"),'Destination-bound transfer contract missing');
assert.ok(sources.get('assets/relay-draft-store.js').includes("'jarvis.relay.owner-draft.v1'"),'Tab-local owner draft module missing');
const files=paths.map(path=>({path,bytes:Buffer.byteLength(sources.get(path)),sha256:createHash('sha256').update(sources.get(path)).digest('hex')}));
console.log(JSON.stringify({stage:'jarvis-security-transfer-v1',root,files},null,2));
