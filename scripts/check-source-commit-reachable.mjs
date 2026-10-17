import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const DESTINATION_PATH='/braydenparker000/Missionarytube-';

function isDestinationRemote(value){
  try{
    const url=new URL(value);
    return url.protocol==='https:'&&url.hostname==='github.com'&&!url.username&&!url.password&&
      url.pathname.replace(/\.git$/,'')===DESTINATION_PATH&&!url.search&&!url.hash;
  }catch{return false;}
}

export function checkSourceCommitReachable(root,sourceCommit){
  root=resolve(root);
  if(!/^[a-f0-9]{40}$/.test(sourceCommit||''))throw Error('Source commit is not approved');
  const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if(!isDestinationRemote(git('remote','get-url','origin'))||git('rev-parse','HEAD')!==sourceCommit)
    throw Error('Source commit is not approved');
  execFileSync('git',['-C',root,'merge-base','--is-ancestor',sourceCommit,'origin/main'],{stdio:'ignore'});
  return sourceCommit;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==4)throw Error();
    checkSourceCommitReachable(process.argv[2],process.argv[3]);
  }catch{
    process.stderr.write('The exact source commit must be reachable from destination main.\n');
    process.exitCode=1;
  }
}
