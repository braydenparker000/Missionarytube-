// Makima-only code repair. Retrieved Worker bytes and settings stay in memory.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {immutableSourceSnapshot,recipeAllowed} from './plan-jarvis-qualification.mjs';
import {SAVING_RECIPE} from './publish-mobile-file-save.mjs';
import {observe,publishWorker} from './publish-private-collaboration.mjs';
export const SOURCE='416d41a83c5819aae3e3a34d3d76919c217e1f97';
export const BASE='01a17019bdca592ef14d183aabc81c58ea7928ff';
export const BEFORE={version:'9cc2ad69-2052-4b01-b003-1b5d9c8e9498',codeSha256:'53b7fd3dc05f41a37e0d246a1b3876bd05bba952609c03aa522b3d9f1f4455a3',settingsDigest:'0cf6bb029536a278c7141132fc9f96110f7b43d81f674c3ceb16e306a6aaa7bc'};
const root=resolve('.makima-cookie-source'),out=resolve('makima-cookie-publication');
const hash=x=>createHash('sha256').update(x).digest('hex');
const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:'pipe'}).trim();
const json=async p=>JSON.parse(await readFile(p,'utf8'));
export function checkedPaths(paths){assert.deepEqual(paths,["backend/relay-makima-policy.js","backend/relay-oauth.js","backend/worker.js","tests/relay-makima-cookie-browser.test.js","tests/relay-makima.test.js"]);}
export function checkedBaseline(identity){for(const [key,value] of Object.entries(BEFORE))assert.equal(identity[key],value,'Production baseline changed: '+key);}
async function source(){
 assert.equal(git('rev-parse','HEAD'),SOURCE);immutableSourceSnapshot(root);assert.ok(recipeAllowed(root,SAVING_RECIPE));
 checkedPaths(git('diff','--name-only',BASE,'HEAD').split('\n'));
 const q=await import(pathToFileURL(resolve(root,'scripts/qualification-proof.mjs')));
 const plan=q.makePlan(q.localEntries(root),q.declaredEnvironment(root,{QUALIFICATION_NODE22:'v22.23.3',QUALIFICATION_NODE24:'v24.21.0',QUALIFICATION_PYTHON:'Python 3.12.15'}));
 const proof=await q.findProof(plan,{sourceSha:SOURCE});assert.equal(proof.qualified,true,'Exact trusted source proof required');
 const {build}=await import(pathToFileURL(resolve(root,'node_modules/esbuild/lib/main.js')));
 const compile=async dir=>{const r=await build({absWorkingDir:dir,entryPoints:['backend/worker.js'],bundle:true,write:false,platform:'browser',format:'esm',target:'es2022',external:['node:crypto'],logLevel:'silent'});assert.equal(r.outputFiles.length,1);return r.outputFiles[0].contents;};
 const baseline=resolve('.makima-cookie-baseline');
 try{await readFile(resolve(baseline,'backend/worker.js'));}catch{git('worktree','add','--detach',baseline,BASE);}
 assert.equal(hash(await compile(baseline)),BEFORE.codeSha256,'Baseline must reproduce deployed Makima bytes');
 return {source:SOURCE,proof,bundle:await compile(root)};
}
export async function deploy({credentials,bundle,checkpoint,fetcher=globalThis.fetch}){
 const current=(await observe({...credentials,fetcher})).identity;checkedBaseline(current);
 await checkpoint(current); // Must persist before the only mutation; never retry upload blindly.
 const after=await publishWorker({...credentials,fetcher,bundle,before:current});
 return {before:current,after};
}
async function main(mode){
 assert.ok(['prepare','deploy','verify'].includes(mode));const s=await source();await mkdir(out,{recursive:true});
 const credentials={account:process.env.CLOUDFLARE_ACCOUNT_ID,token:process.env.CLOUDFLARE_API_TOKEN};
 const expected={source:SOURCE,proof:s.proof,bundleSha256:hash(s.bundle),before:BEFORE};
 if(mode==='prepare'){await writeFile(resolve(out,'plan.json'),JSON.stringify(expected,null,2)+'\n');return;}
 const plan=await json(resolve(out,'plan.json'));assert.deepEqual(plan,expected);
 if(mode==='deploy'){
  const result=await deploy({credentials,bundle:s.bundle,checkpoint:async before=>writeFile(resolve(out,'checkpoint.json'),JSON.stringify({...expected,before},null,2)+'\n')});
  const receipt={schema:1,kind:'makima-session-worker',source:SOURCE,proof:s.proof,orchestration:process.env.GITHUB_SHA,runId:process.env.GITHUB_RUN_ID,...result,settingsUnchanged:true,schedulesUnchanged:true,credentialsChanged:false};
  await writeFile(resolve(out,'release.json'),JSON.stringify(receipt,null,2)+'\n');
  console.log(JSON.stringify({source:SOURCE,version:result.after.version,codeSha256:result.after.codeSha256,settingsUnchanged:true,schedulesUnchanged:true}));return;
 }
 const receipt=await json(resolve(out,'release.json'));assert.equal(receipt.source,SOURCE);assert.equal(receipt.after.codeSha256,hash(s.bundle));assert.deepEqual((await observe(credentials)).identity,receipt.after);
 console.log('Exact Makima repair Worker and preserved settings/schedules verified');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main(process.argv[2]).catch(()=>{console.error('Makima publication stopped: source proof, baseline or preservation check failed. No provider body logged. Inspect checkpoint and active identity before any retry.');process.exitCode=1;});

