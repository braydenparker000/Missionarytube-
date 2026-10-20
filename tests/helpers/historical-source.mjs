// Frozen compatibility fixtures, never an application build or publisher input.
// This is the accepted pre-cleanup commit; it does not advance with features.
import {execFileSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

export const HISTORICAL_COMMIT='0dfa38c9dfc1f2130e684652fa35d53769bb7fce';
const root=fileURLToPath(new URL('../..',import.meta.url));
const allowed=new Set([
 'src/compatibility-player.js','src/interaction-logic.js','src/astra-motion.js',
 'jarvis/public/assets/app.js','jarvis/public/assets/public-reader-cache.js',
 'jarvis/backend/publications.js','jarvis/scripts/qualification-proof.mjs',
 'jarvis/scripts/install-qualification-browser.mjs','jarvis/tests/helpers/ci-test-inventory.mjs'
]);
export function historicalBytes(path){
 if(!allowed.has(path))throw Error('Not a retained historical fixture: '+path);
 try{return execFileSync('git',['-C',root,'show',HISTORICAL_COMMIT+':'+path],{stdio:['ignore','pipe','pipe']});}
 catch{throw Error('Historical regression fixtures require repository history. Run git fetch --unshallow in a shallow checkout.');}
}
let directory;
export function historicalModulePath(path){
 if(!allowed.has(path))throw Error('Not a retained historical fixture: '+path);
 if(!directory){
  directory=mkdtempSync(join(tmpdir(),'jarvis-history-fixture-'));
  writeFileSync(join(directory,'package.json'),'{"type":"module"}');
  // Resolve the installed, lockfile-controlled dependencies without copying them.
  symlinkSync(join(root,'node_modules'),join(directory,'node_modules'),'dir');
  for(const name of allowed){const target=join(directory,name);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,historicalBytes(name));}
  process.once('exit',()=>rmSync(directory,{recursive:true,force:true}));
 }
 return join(directory,path);
}
