import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {sha256} from './static-publication.mjs';
import {previousSource} from './rollback-pair-proof.mjs';
const execute=promisify(execFile);
export const ADVERSARIAL_TESTS=Object.freeze(['tests/relay-owner-jobs.test.js','tests/relay-owner-jobs-adversarial.test.js','tests/relay-events.test.js']);
export async function schemaAt(source,commit,{runner=execute}={}){
  if(!/^[a-f0-9]{40}$/.test(commit||''))throw Error('Immutable schema source required');
  const git=async args=>(await runner('git',['-C',source,...args],{encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024})).stdout;
  const files=(await git(['ls-tree','-r','--name-only',commit,'backend'])).trim().split('\n').filter(path=>/^backend\/(?:[A-Za-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.js$/.test(path));
  const rows=[];
  for(const path of files){
    const code=await git(['show',commit+':'+path]),statements=[];
    for(const match of code.matchAll(/\.exec\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)){
      const text=match[2].replace(/\\n/g,'\n').replace(/\\'/g,"'").replace(/\\"/g,'"').trim();
      if(!/^(?:CREATE|ALTER|DROP|RENAME)\s+(?:(?:UNIQUE|VIRTUAL)\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)/i.test(text))continue;
      if(!/^CREATE (?:TABLE|(?:UNIQUE )?INDEX) IF NOT EXISTS /i.test(text)||text.includes('${')||text.includes('\\'))throw Error('Unsupported or destructive schema recipe requires migration review');
      statements.push(text.replace(/;\s*$/,'')+';');
    }
    const occurrences=[...code.matchAll(/\b(?:CREATE|ALTER|DROP|RENAME)\s+(?:(?:UNIQUE|VIRTUAL)\s+)?(?:TABLE|INDEX|VIEW|TRIGGER)\b/gi)].length;
    if(occurrences!==statements.length)throw Error('Unresolved schema statement requires migration review');
    rows.push(...statements.map(sql=>({path,sql})));
  }
  if(rows.length<1||rows.length>1000)throw Error('Bounded complete schema contract required');
  return rows;
}
export async function rollbackPairContracts({root,previous,backend}){
  const source=join(root,'.jarvis-source'),before=await schemaAt(source,previousSource(previous)),after=await schemaAt(source,backend.candidate.source);
  // Bind and verify the complete tracked source closure, including transitive
  // test helpers, publication JSON and package locks. An edited helper must not
  // turn a failed pending-work check into an apparently qualified result.
  const rows=(await execute('git',['-C',source,'ls-tree','-rz',backend.candidate.source],{encoding:'utf8',maxBuffer:2*1024*1024})).stdout.split('\0').filter(Boolean);
  if(!rows.length||rows.length>10000)throw Error('Bounded immutable runtime source required');
  const runtime=[];
  for(const row of rows){
    const match=/^(100644|100755) blob ([a-f0-9]{40})\t([A-Za-z0-9_./-]+)$/.exec(row);
    if(!match||match[3].split('/').some(part=>!part||part==='.'||part==='..'))throw Error('Unsupported immutable runtime source type');
    const [,mode,gitDigest,path]=match,bytes=await readFile(join(source,path)),info=await lstat(join(source,path));
    const actual=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    if(!info.isFile()||info.isSymbolicLink()||((info.mode&0o111)?'100755':'100644')!==mode||actual!==gitDigest)throw Error('Candidate runtime/fixture differs from its immutable source');
    runtime.push({path,mode,sha256:sha256(bytes)});
  }
  return {before,after,schemaInputsDigest:sha256({before,after}),pendingRuntimeDigest:sha256(runtime),
    runtimeRecipeDigest:sha256(await Promise.all(['scripts/rollback-pair-runtime.mjs','tests/fixtures/release-recovery/schema-recovery.py'].map(async path=>({path,sha256:sha256(await readFile(join(root,path)))}))))};
}
