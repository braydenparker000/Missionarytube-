import {cp,mkdir,readFile,readdir,rm,writeFile,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {r2PlayerConfig} from './r2-player-config.mjs';
import {frontendDirectory,frontendProvenance} from './frontend-source.mjs';
const release=JSON.parse(await readFile('jarvis-release.json','utf8'));
const provenance=await frontendProvenance();
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await cp(frontendDirectory(),'dist',{recursive:true});
// Keep editable music filenames stable; derive immutable URLs from actual bytes.
// These are the same transformations used by the accepted music publication.
try{
 let html=await readFile('dist/drawercast/index.html','utf8');
 const assets=['drawercast/player.js',...(await readdir('dist/drawercast/fonts')).filter(f=>f.endsWith('.woff')).sort().map(f=>'drawercast/fonts/'+f)];
 for(const path of assets){
  const bytes=await readFile('dist/'+path),hash=createHash('sha256').update(bytes).digest('hex').slice(0,12);
  const output=path.replace(/\.(js|woff)$/,`.${hash}.$1`);
  const from='./'+path.slice('drawercast/'.length),to='./'+output.slice('drawercast/'.length);
  assert.ok(html.includes(from),'Music entry point does not reference '+path);
  html=path==='drawercast/player.js'?html.replace(/\.\/player\.js(\?[^"']*)?/,to):html.replaceAll(from,to);
  await writeFile('dist/'+output,bytes);await rm('dist/'+path);
 }
 await writeFile('dist/drawercast/index.html',html);
}catch(error){
 // Minimal build fixtures need not contain music, but partial inputs must fail.
 if(error.code!=='ENOENT'||await stat('dist/drawercast').then(()=>true,()=>false))throw error;
}
await writeFile('dist/assets/r2-config.json',JSON.stringify(r2PlayerConfig(release))+'\n');
const files=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){
 const p=join(dir,e.name);if(e.isDirectory())await walk(p);else files.push(p);
}}
await walk('dist');
let total=0;
for(const file of files){
 const bytes=await readFile(file);total+=bytes.length;
 if(file.endsWith('.html')&&!/http-equiv=["']Content-Security-Policy["']/i.test(bytes.toString())){
  // Preserve the accepted legacy document exactly. New or edited documents
  // must declare their policy explicitly instead of silently losing the gate.
  const legacy=JSON.parse(await readFile('scripts/private-board-pins.json','utf8'));
  const accepted=[...legacy.files,...legacy.dependencies].find(f=>f.path===file.slice(5));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),accepted?.sha256,'HTML requires an explicit CSP: '+file);
 }
 if(/\.(mp4|mkv|webm|mp3|opus|flac|wav)$/i.test(file))throw Error('Media payload is not allowed in the frontend artifact: '+file);
}
if(total>25*1024*1024)throw Error('Frontend exceeds the 25 MiB budget');
await cp('dist/index.html','dist/jarvis-preview.html');
assert.deepEqual(await frontendProvenance(),provenance,'Frontend source changed during the build');
// Public release metadata names the actual frontend input, not a historical fixture.
await writeFile('dist/release.json',JSON.stringify({schema:2,source:provenance.frontend.repository,commit:provenance.frontend.commit,bytes:total,...provenance},null,2)+'\n');
console.log(`Built frontend ${provenance.frontend.commit}${provenance.frontend.dirty?' (local edits)':''}: ${files.length} frontend files, ${(total/1024/1024).toFixed(2)} MiB; no media payloads.`);
