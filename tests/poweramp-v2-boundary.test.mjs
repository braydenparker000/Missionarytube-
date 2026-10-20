import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {execFileSync} from 'node:child_process';

test('V2 is a closed static module graph with no proprietary/media payload or legacy imports',async()=>{
  const root=resolve('frontend/poweramp-v2'),files=await readdir(root);let bytes=0;
  for(const name of files){
    const file=resolve(root,name),info=await lstat(file);assert.ok(info.isFile()&&!info.isSymbolicLink());
    assert.match(name,/\.(js|html|css)$/,'Azure publisher knows these content types');
    const body=await readFile(file,'utf8');bytes+=Buffer.byteLength(body);
    assert.doesNotMatch(body,/(?:drawercast|private-poweramp-analysis|\/workspace\/scratch)\//);
    if(name.endsWith('.js')){
      execFileSync(process.execPath,['--check',file]);
      for(const match of body.matchAll(/(?:from\s+|import\()['"]([^'"]+)['"]/g)){
        assert.match(match[1],/^\.\/[a-z-]+\.js$/);assert.ok(files.includes(match[1].slice(2)));
      }
    }
  }
  assert.ok(bytes<150*1024,'new static runtime stays below its initial 150KiB budget');
  const html=await readFile(resolve(root,'index.html'),'utf8');
  assert.match(html,/Content-Security-Policy/);assert.match(html,/connect-src 'self'/);assert.doesNotMatch(html,/https:\/\/|unsafe-eval|maximum-scale|user-scalable=no/);
  // This tests the existing publisher contract rather than changing it for V2.
  const publisher=await readFile('scripts/publish-frontend.mjs','utf8');assert.match(publisher,/js:'application\/javascript/);
});
