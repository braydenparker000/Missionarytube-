import {cp,mkdir,readFile,readdir,rm,writeFile,stat} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {join,extname} from 'node:path';
import {r2PlayerConfig} from './r2-player-config.mjs';
import {frontendDirectory,frontendProvenance} from './frontend-source.mjs';
const release=JSON.parse(await readFile('jarvis-release.json','utf8'));
const provenance=await frontendProvenance();
await rm('dist',{recursive:true,force:true});
await mkdir('dist',{recursive:true});
await cp(frontendDirectory(),'dist',{recursive:true});
await writeFile('dist/assets/r2-config.json',JSON.stringify(r2PlayerConfig(release))+'\n');
const config=JSON.parse(await readFile('dist/staticwebapp.config.json','utf8'));
await rm('dist/staticwebapp.config.json');
const files=[];
async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){
 const p=join(dir,e.name);if(e.isDirectory())await walk(p);else files.push(p);
}}
await walk('dist');
let total=0;
for(const file of files){
 total+=(await stat(file)).size;
 if(/\.(mp4|mkv|webm|mp3|opus|flac|wav)$/i.test(file))throw Error('Media payload is not allowed in the frontend artifact: '+file);
 if(extname(file)!=='.html')continue;
 const route='/'+file.slice(5);
 const match=config.routes.find(r=>route.startsWith(r.route.replace('*','')));
 // Azure Storage cannot apply SWA headers. Retain the supported document
 // policy in HTML; frame-ancestors requires a response header and is omitted.
 let csp=(match?.headers?.['Content-Security-Policy']||config.globalHeaders['Content-Security-Policy']).replace(/frame-ancestors[^;]*(;|$)/g,'');
 if(route.startsWith('/daily-board/'))csp+='; font-src data:';
 const metas=`\n<meta http-equiv="Content-Security-Policy" content="${csp.replaceAll('&','&amp;').replaceAll('"','&quot;')}">\n<meta name="referrer" content="strict-origin-when-cross-origin">`;
 let html=await readFile(file,'utf8');
 if(!/<head(?:\s[^>]*)?>/i.test(html))throw Error('No HTML head: '+file);
 html=html.replace(/<head(?:\s[^>]*)?>/i,m=>m+metas);
 await writeFile(file,html);
}
if(total>25*1024*1024)throw Error('Frontend exceeds the 25 MiB budget');
await cp('dist/index.html','dist/jarvis-preview.html');
assert.deepEqual(await frontendProvenance(),provenance,'Frontend source changed during the build');
// source/commit retain the historical backend baseline for remaining release consumers.
// frontend/components identify the actual editable frontend, generated from this checkout.
await writeFile('dist/release.json',JSON.stringify({source:release.repository,commit:release.commit,bytes:total,...provenance},null,2)+'\n');
console.log(`Built frontend ${provenance.frontend.commit}${provenance.frontend.dirty?' (local edits)':''}: ${files.length} frontend files, ${(total/1024/1024).toFixed(2)} MiB; no media payloads.`);
