import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function sourceDependencyIdentity(root=process.cwd()){
  return Object.fromEntries(['package.json','package-lock.json'].map(file=>[file,hash(readFileSync(resolve(root,'.jarvis-source',file)))]));
}
export function prepareWorkerTools(root=process.cwd()){
  const before=sourceDependencyIdentity(root),directory=resolve(root,'.worker-tools');
  mkdirSync(directory,{recursive:true});
  // Wrangler action installs its CLI into workingDirectory. Keep that package
  // installation outside the qualified source and outside root dependencies.
  writeFileSync(resolve(directory,'package.json'),JSON.stringify({name:'jarvis-worker-tooling',private:true,type:'module'},null,2)+'\n');
  const after=sourceDependencyIdentity(root);
  if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Preparing isolated Worker tools changed qualified dependencies');
  writeFileSync(resolve(root,'worker-tooling-source-before.json'),JSON.stringify(before,null,2)+'\n');
  return {directory,source:before};
}
export function verifyWorkerTools(root=process.cwd()){
  const before=JSON.parse(readFileSync(resolve(root,'worker-tooling-source-before.json'),'utf8'));
  if(JSON.stringify(before)!==JSON.stringify(sourceDependencyIdentity(root)))throw Error('Worker tooling mutated the qualified source dependency files');
  return true;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv[2]==='prepare')prepareWorkerTools();
  else if(process.argv[2]==='verify')verifyWorkerTools();
  else throw Error('Use prepare or verify');
  console.log('Wrangler tooling is isolated; qualified source dependency identities remain unchanged');
}
