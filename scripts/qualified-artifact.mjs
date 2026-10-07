import {createHash} from 'node:crypto';
import {readFile,writeFile,readdir,lstat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function fileManifest(root) {
  const files=[];
  async function walk(dir){for(const name of (await readdir(dir)).sort()){
    const path=join(dir,name),info=await lstat(path);
    if(info.isSymbolicLink())throw Error('Artifact symlinks are not permitted');
    if(info.isDirectory())await walk(path);
    else if(info.isFile())files.push({path:path.slice(root.length+1),sha256:hash(await readFile(path)),bytes:info.size});
    else throw Error('Unexpected artifact file type');
  }}
  await walk(root);return files;
}
export async function artifactIdentity({root=process.cwd(),source='.jarvis-source',env=process.env}={}) {
  const revision=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const sourceRevision=execFileSync('git',['-C',resolve(root,source),'rev-parse','HEAD'],{encoding:'utf8'}).trim();
  const release=JSON.parse(await readFile(resolve(root,'jarvis-release.json'),'utf8'));
  if(release.commit!==sourceRevision||release.repository!=='braydenparker999/jarvis')throw Error('Artifact source pin mismatch');
  return {schema:1,repository:'braydenparker000/Missionarytube-',orchestration:revision,source:sourceRevision,
    releaseDigest:hash(JSON.stringify(release)),dependencies:hash(await readFile(resolve(root,'package-lock.json'))),
    sourceDependencies:hash(await readFile(resolve(root,source,'package-lock.json'))),
    buildRecipe:hash(await readFile(resolve(root,'scripts/build-jarvis.mjs'))),
    runId:String(env.GITHUB_RUN_ID||''),attempt:String(env.GITHUB_RUN_ATTEMPT||'')};
}
export function checkedManifest(manifest,identity,files) {
  if(!manifest||JSON.stringify(manifest.identity)!==JSON.stringify(identity)||JSON.stringify(manifest.files)!==JSON.stringify(files)||
    !Array.isArray(files)||!files.length||!files.some(f=>f.path==='index.html')||files.some(f=>!/^[a-f0-9]{64}$/.test(f.sha256)||f.path.startsWith('/')||f.path.split('/').includes('..')))
    throw Error('Qualified artifact identity, files or digest mismatch');
  return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const identity=await artifactIdentity(),files=await fileManifest(resolve('dist'));
  if(process.argv[2]==='create')await writeFile('qualified-artifact.json',JSON.stringify({identity,files},null,2)+'\n');
  else if(process.argv[2]==='verify')checkedManifest(JSON.parse(await readFile('qualified-artifact.json','utf8')),identity,files);
  else throw Error('Use create or verify');
  console.log('Exact orchestration, source, dependency, release and artifact identities verified');
}
