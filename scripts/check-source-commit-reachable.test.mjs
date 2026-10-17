import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {checkSourceCommitReachable} from './check-source-commit-reachable.mjs';

const destination='https://github.com/braydenparker000/Missionarytube-.git';
const git=(root,...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function fixture(){
  const root=await mkdtemp(join(tmpdir(),'source-reachability-'));
  git(root,'init','--quiet');git(root,'config','user.name','Fixture');git(root,'config','user.email','fixture@example.invalid');
  git(root,'remote','add','origin',destination);
  await writeFile(join(root,'source.txt'),'approved base\n');git(root,'add','source.txt');git(root,'commit','--quiet','-m','approved base');
  const base=git(root,'rev-parse','HEAD');git(root,'update-ref','refs/remotes/origin/main',base);
  await writeFile(join(root,'source.txt'),'later main change\n');git(root,'commit','--quiet','-am','later approved main change');
  const head=git(root,'rev-parse','HEAD');git(root,'update-ref','refs/remotes/origin/main',head);
  await writeFile(join(root,'source.txt'),'unapproved side change\n');git(root,'commit','--quiet','-am','unapproved side change');
  const side=git(root,'rev-parse','HEAD');
  return {root,base,head,side};
}

test('accepts only the exact checked-out commit when it is an ancestor of destination main',async()=>{
  const f=await fixture();
  try{
    git(f.root,'checkout','--quiet',f.base);
    assert.equal(checkSourceCommitReachable(f.root,f.base),f.base);
    git(f.root,'checkout','--quiet',f.head);
    assert.equal(checkSourceCommitReachable(f.root,f.head),f.head);
    git(f.root,'remote','set-url','origin',destination.slice(0,-4));
    assert.equal(checkSourceCommitReachable(f.root,f.head),f.head);
  }finally{await rm(f.root,{recursive:true,force:true});}
});

test('rejects malformed, mismatched, unreachable or wrong-origin source commits',async()=>{
  const f=await fixture();
  try{
    git(f.root,'checkout','--quiet',f.side);
    assert.throws(()=>checkSourceCommitReachable(f.root,'not-a-commit'));
    assert.throws(()=>checkSourceCommitReachable(f.root,f.base));
    assert.throws(()=>checkSourceCommitReachable(f.root,f.side));
    git(f.root,'remote','set-url','origin','https://github.com/braydenparker999/jarvis.git');
    assert.throws(()=>checkSourceCommitReachable(f.root,f.side));
  }finally{await rm(f.root,{recursive:true,force:true});}
});
