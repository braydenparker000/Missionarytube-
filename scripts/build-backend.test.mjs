import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,cp,rm,chmod,symlink} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {buildBackend,checkedBackendBuild} from './build-backend.mjs';
const bundler=createRequire(new URL('../backend/package.json',import.meta.url))('esbuild');
async function fixture(t){
 const root=await mkdtemp(join(tmpdir(),'backend-source-'));t.after(()=>rm(root,{recursive:true,force:true}));
 for(const p of ['backend','frontend','scripts','.backend-release'])await mkdir(join(root,p));
 await writeFile(join(root,'package.json'),'{"type":"module"}');await writeFile(join(root,'package-lock.json'),'{"lockfileVersion":3}');await writeFile(join(root,'backend/package.json'),'{"type":"module"}');
 await writeFile(join(root,'.gitignore'),'.backend-release/\n');
 await writeFile(join(root,'backend/wrangler.jsonc'),JSON.stringify({name:'jarvis-hub-api',main:'worker.js'}));
 await writeFile(join(root,'backend/worker.js'),"import {value} from '../frontend/shared.js?accepted-browser-suffix';export default {fetch(){return new Response(value)}};");
 await writeFile(join(root,'frontend/shared.js'),"export const value='first';");
 await cp(new URL('build-backend.mjs',import.meta.url),join(root,'scripts/build-backend.mjs'));
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe'}).trim();
 git('init');const commit=()=>{git('add','.');git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','-m','fixture');};commit();
 const options={root,bundler},build=()=>buildBackend(options);
 const save=async()=>{const result=await build();await writeFile(join(root,'.backend-release/worker.js'),result.bundle);await writeFile(join(root,'.backend-release/provenance.json'),JSON.stringify(result.provenance));return result;};
 return {root,git,commit,options,build,save};
}
test('Worker inputs and shared frontend dependencies are discovered automatically; edits require commit and rebuild',async t=>{
 const h=await fixture(t),old=await h.save();assert.equal(old.provenance.dirty,false);assert.ok(old.provenance.inputs.some(f=>f.path==='frontend/shared.js'));
 await checkedBackendBuild(h.options);
 await writeFile(join(h.root,'frontend/shared.js'),"export const value='second';");
 const edited=await h.build();assert.equal(edited.provenance.dirty,true);assert.notEqual(edited.provenance.bundleSha256,old.provenance.bundleSha256);
 await assert.rejects(checkedBackendBuild(h.options),/Commit Worker inputs/);
 h.commit();await assert.rejects(checkedBackendBuild(h.options),/Stale Worker/);await h.save();await checkedBackendBuild(h.options);
 assert.equal(h.git('diff-tree','--no-commit-id','--name-only','-r','HEAD'),'frontend/shared.js');
});
test('artifact tampering, source modes and recipe edits cannot borrow a clean Worker provenance',async t=>{
 const h=await fixture(t);await h.save();await writeFile(join(h.root,'.backend-release/worker.js'),'substituted');
 await assert.rejects(checkedBackendBuild(h.options),/artifact bytes changed/);await h.save();
 await chmod(join(h.root,'backend/worker.js'),0o755);await assert.rejects(checkedBackendBuild(h.options),/Commit Worker inputs/);
 await chmod(join(h.root,'backend/worker.js'),0o644);
 const path=join(h.root,'scripts/build-backend.mjs');await writeFile(path,(await readFile(path,'utf8'))+'\n// local recipe edit\n');await assert.rejects(checkedBackendBuild(h.options),/Commit Worker inputs/);
});
test('changed resolver configuration is part of provenance and symlinked shared inputs are rejected',async t=>{
 const h=await fixture(t);await h.save();await writeFile(join(h.root,'tsconfig.json'),'{"compilerOptions":{"target":"ES2022"}}');
 assert.equal((await h.build()).provenance.dirty,true);await assert.rejects(checkedBackendBuild(h.options),/Commit Worker inputs/);
 await rm(join(h.root,'tsconfig.json'));await rm(join(h.root,'frontend/shared.js'));await writeFile(join(h.root,'frontend/other.js'),"export const value='first';");await symlink('other.js',join(h.root,'frontend/shared.js'));
 await assert.rejects(h.build,/symbolic link/);
});
