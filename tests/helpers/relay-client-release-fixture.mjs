import {after} from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const SOURCE='c85a42d2bea5d12d576ac84080660a34f11732c4';
let fixture;
const git=(...args)=>execFileSync('git',['-C',join(repository,'.jarvis-source'),...args],
  {encoding:'utf8',stdio:'pipe',timeout:30000,maxBuffer:131072});
export function relayClientRecipePath(path){
  return ({'jarvis-release.json':'scripts/release-identities/relay-client-approved-jarvis-release.json',
    '.github/workflows/deploy-azure-storage.yml':'scripts/release-identities/relay-client-approved-deploy-azure-storage.yml',
    '.github/workflows/qualify-jarvis.yml':'scripts/release-identities/relay-client-approved-qualify-jarvis.yml'})[path]||path;
}
// Historical assertion fixtures use a genuine retained ancestor, never a
// declared/fabricated source HEAD. No fetch, provider or credential is needed.
export function relayClientSource(){
  fixture??=(async()=>{
    git('cat-file','-e',SOURCE+'^{commit}');
    const root=await mkdtemp(join(tmpdir(),'relay-client-approved-source-')),source=join(root,'source');
    try{git('worktree','add','--detach',source,SOURCE);return {root,source};}
    catch(error){await rm(root,{recursive:true,force:true});throw error;}
  })();
  return fixture.then(value=>value.source);
}
after(async()=>{
  if(!fixture)return;const {root,source}=await fixture;
  try{git('worktree','remove','--force',source);}finally{await rm(root,{recursive:true,force:true});}
});
