import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {createHash} from 'node:crypto';
const {storageOrigin}=JSON.parse(await readFile('jarvis-release.json','utf8'));
const cutover=process.argv.includes('--cutover');
const files=[];async function walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())await walk(p);else if(cutover||p!=='dist/index.html')files.push(p);}}
await walk('dist');
const mime={'.html':'text/html','.js':'javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json'};
const hash=b=>createHash('sha256').update(b).digest('hex');
// A bounded four-request pool checks every shipped byte, including decoder MIME.
let index=0;await Promise.all(Array.from({length:4},async()=>{while(index<files.length){
 const file=files[index++],path='/'+file.slice(5),response=await fetch(storageOrigin+path,{cache:'no-store',signal:AbortSignal.timeout(30000)});
 assert.equal(response.status,200,path);const type=mime[extname(file)];if(type)assert.ok(response.headers.get('content-type')?.includes(type),`${path}: incorrect MIME type`);
 assert.equal(hash(new Uint8Array(await response.arrayBuffer())),hash(await readFile(file)),`${path}: deployed bytes differ`);
}}));
for(const route of ['/jarvis/','/daily-board/','/drawercast/','/media/','/portal/','/notes/','/tools/','/settings/','/favorites/','/server/','/reader/','/respond/','/connect/']){
 const response=await fetch(storageOrigin+route,{signal:AbortSignal.timeout(20000)});assert.equal(response.status,200,route);
 assert.equal(hash(new Uint8Array(await response.arrayBuffer())),hash(await readFile('dist'+route+'index.html')),`${route}: directory index differs`);
}
if(cutover){const response=await fetch(storageOrigin+'/',{signal:AbortSignal.timeout(20000)});assert.equal(response.status,200);assert.equal(hash(new Uint8Array(await response.arrayBuffer())),hash(await readFile('dist/index.html')));}
console.log(`Verified ${files.length} files byte-for-byte, MIME types, and 13 directory routes${cutover?' plus root':''}.`);
