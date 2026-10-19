// Build the current Worker and discover its actual input graph. No source pins,
// alternate checkout, provider access or settings mutation are involved.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFile,writeFile,mkdir,lstat,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {existsSync} from 'node:fs';
import {resolve,relative,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe'}).trim();
export async function buildBackend({root=process.cwd(),bundler}={}){
 root=resolve(root);assert.equal(await realpath(resolve(root,'backend')),resolve(root,'backend'),'Worker source must be a real directory');
 const config=JSON.parse(await readFile(resolve(root,'backend/wrangler.jsonc'),'utf8'));
 assert.equal(config.name,'jarvis-hub-api');assert.equal(config.main,'worker.js');
 const compiler=bundler||createRequire(resolve(root,'backend/package.json'))('esbuild');
 const result=await compiler.build({absWorkingDir:root,entryPoints:['backend/worker.js'],bundle:true,write:false,metafile:true,preserveSymlinks:true,format:'esm',platform:'browser',target:'es2022',external:['node:*','cloudflare:*'],logLevel:'silent'});
 assert.equal(result.outputFiles.length,1);
 // esbuild retains browser cache suffixes in metafile keys, while resolving the
 // corresponding local file without that suffix.
 const files=new Set([...Object.keys(result.metafile.inputs).map(path=>path.replace(/[?#].*$/,'')),'backend/wrangler.jsonc','backend/package.json','package.json','package-lock.json','scripts/build-backend.mjs']);
 for(const input of [...files]){
  for(let directory=dirname(resolve(root,input));directory===root||directory.startsWith(root+'/');directory=dirname(directory)){
   for(const name of ['package.json','tsconfig.json','jsconfig.json'])if(existsSync(resolve(directory,name)))files.add(relative(root,resolve(directory,name)));
   if(directory===root)break;
  }
 }
 for(let directory=dirname(root);;directory=dirname(directory)){
  assert.ok(!['tsconfig.json','jsconfig.json'].some(name=>existsSync(resolve(directory,name))),'External Worker resolver config is not qualified');
  if(dirname(directory)===directory)break;
 }
 const paths=[...files].sort();
 const commit=git(root,'rev-parse','HEAD'),inputs=[];let dirty=false;
 const rows=git(root,'ls-tree','-rz','HEAD','--',...paths).split('\0').filter(Boolean);
 const tracked=new Map(rows.map(row=>{const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);assert.ok(match,'Unsupported Worker source type');return [match[3],{mode:match[1],sha:match[2]}];}));
 for(const path of paths){
  const file=resolve(root,path);assert.ok(relative(root,file)&&!relative(root,file).startsWith('..'),'Worker input escaped repository');
  assert.equal(await realpath(file),file,'Worker input uses a symbolic link');
  const info=await lstat(file);assert.ok(info.isFile());const bytes=await readFile(file),mode=info.mode&0o111?'100755':'100644';
  const blob=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex'),previous=tracked.get(path);
  if(!path.split('/').includes('node_modules')&&(!previous||previous.mode!==mode||previous.sha!==blob))dirty=true;
  inputs.push({path,mode,sha256:hash(bytes)});
 }
 const bundle=Buffer.from(result.outputFiles[0].contents);
 return {bundle,provenance:{schema:1,repository:'braydenparker000/Missionarytube-',commit,path:'backend',dirty,compiler:compiler.version,inputs,digest:hash(JSON.stringify(inputs)),bundleSha256:hash(bundle)}};
}
export async function checkedBackendBuild({root=process.cwd(),bundler}={}){
 const current=await buildBackend({root,bundler});assert.equal(current.provenance.dirty,false,'Commit Worker inputs and rebuild before publication');
 const saved=JSON.parse(await readFile(resolve(root,'.backend-release/provenance.json'),'utf8'));
 assert.deepEqual(saved,current.provenance,'Stale Worker provenance');
 assert.equal(hash(await readFile(resolve(root,'.backend-release/worker.js'))),saved.bundleSha256,'Worker artifact bytes changed');
 return saved;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(process.argv[2]==='verify')await checkedBackendBuild();
 else{
  assert.equal(process.argv.length,2);const {bundle,provenance}=await buildBackend();
  await mkdir('.backend-release',{recursive:true});await writeFile('.backend-release/worker.js',bundle);
  await writeFile('.backend-release/provenance.json',JSON.stringify(provenance,null,2)+'\n');
  console.log(`Built Worker ${provenance.commit}${provenance.dirty?' (local edits)':''}: ${provenance.inputs.length} discovered inputs; settings untouched.`);
 }
}
