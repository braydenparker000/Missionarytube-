// Creates a local review build only. Does not modify pins or deployed assets.
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const output=resolve(process.argv[2]||'/tmp/daily-board-review-build');
if(!output.startsWith('/tmp/'))throw Error('Review output must be under /tmp');
await mkdir(output,{recursive:true});
for(const name of ['design.css','components.css','schema.js','render.js','live.js'])await cp(new URL(name,import.meta.url),`${output}/${name}`);
await cp(new URL('assets',import.meta.url),`${output}/assets`,{recursive:true});
let html=await readFile(new URL('index.html',import.meta.url),'utf8');
html=html.replace(/<nav aria-label="Review fixtures">.*?<\/nav>/,'').replace('preview.js','live.js').replace('Daily Board · review candidate','Daily Board');
await writeFile(`${output}/index.html`,html);console.log(output);
