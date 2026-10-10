import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {artifactIdentity,fileManifest,checkedConfigurationDelta,checkedManifest} from './qualified-artifact.mjs';

const execute=promisify(execFile);
export const SOURCE='000ce4089bffc8201370d3491d0b52ea7fed3680';
const ORIGIN='https://missionarytube.z13.web.core.windows.net';
export const DEPENDENCIES=Object.freeze([
  Object.freeze({path:'assets/relay-transfer.js',bytes:5992,sha256:'de1bafae504abaea90c058f3e06d48c1c04c77605b8d3f68287fe32a4d92531b'}),
  Object.freeze({path:'assets/relay-draft-store.js',bytes:1030,sha256:'d5dcacb7770e6d0ee980c22feaf25cbf9c9e40db3a9f3e0245985c56e98c3f6b'}),
  Object.freeze({path:'assets/public-coordination.js',bytes:10678,sha256:'c6987811ec2096652b84138c4d1c7609909a0aa2c4133c883be745c8f90e7291'}),
  Object.freeze({path:'assets/public-reader-cache.js',bytes:9283,sha256:'ed2f6710658c940c708f34ac748e572065df2ed7183e6e6401f81d2764404aa9'}),
]);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const FAILURE='Relay dependency staging failed; no importer overwrite is authorized';

async function verifyDependency(response,dependency){
  if(response.status!==200||! /^(?:application|text)\/javascript(?:\s*;\s*charset\s*=\s*"?utf-8"?\s*)?$/i.test(response.headers.get('content-type')||'')){
    await response.body?.cancel();throw Error(FAILURE);
  }
  if(!response.body)throw Error(FAILURE);
  const reader=response.body.getReader(),chunks=[];let length=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;
      length+=value.byteLength;
      if(length>dependency.bytes){await reader.cancel();throw Error(FAILURE);}
      chunks.push(Buffer.from(value));
    }
  }finally{reader.releaseLock();}
  if(length!==dependency.bytes||hash(Buffer.concat(chunks))!==dependency.sha256)throw Error(FAILURE);
}

// The production workflow calls this only after its full Worker identity, full backup
// and uploaded rollback gates. Failure stops that step before any importer is
// overwritten. Transport injection is for fictional tests, never an authority.
export async function stageRelayCoreDependencies({root=process.cwd(),env=process.env,runner=execute,fetcher=globalThis.fetch}={}){
  try{
    root=resolve(root);
    const release=JSON.parse(await readFile(resolve(root,'jarvis-release.json'),'utf8'));
    if(env.STORAGE_ACCOUNT!=='missionarytube'||release.commit!==SOURCE||release.storageOrigin!==ORIGIN)throw Error(FAILURE);
    const identity=await artifactIdentity({root,env}),files=await fileManifest(resolve(root,'dist'));
    const before=JSON.parse(await readFile(resolve(root,'qualified-artifact.json'),'utf8'));
    if(JSON.stringify(before.identity)!==JSON.stringify(identity))throw Error(FAILURE);
    checkedConfigurationDelta(before.files,files);
    checkedManifest(JSON.parse(await readFile(resolve(root,'configured-artifact.json'),'utf8')),
      {...identity,baseManifestDigest:hash(JSON.stringify(before))},files);
    for(const dependency of DEPENDENCIES){
      const actual=files.find(file=>file.path===dependency.path);
      if(!actual||actual.bytes!==dependency.bytes||actual.sha256!==dependency.sha256)throw Error(FAILURE);
    }
    for(const dependency of DEPENDENCIES){
      await runner('az',['storage','blob','upload','--account-name','missionarytube','--auth-mode','login',
        '--container-name','$web','--name',dependency.path,'--file',resolve(root,'dist',dependency.path),
        '--content-type','application/javascript; charset=utf-8','--content-cache-control','no-cache',
        '--overwrite','true','--only-show-errors'],{cwd:root,env,timeout:30000,killSignal:'SIGKILL',maxBuffer:32768});
      await verifyDependency(await fetcher(ORIGIN+'/'+dependency.path,{method:'GET',cache:'no-store',redirect:'error',
        credentials:'omit',signal:AbortSignal.timeout(30000)}),dependency);
    }
    return {dependencies:DEPENDENCIES.length,verified:DEPENDENCIES.length};
  }catch{throw Error(FAILURE);}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    if(process.argv.length!==2)throw Error(FAILURE);
    await stageRelayCoreDependencies();
    console.log('All four exact Relay dependencies are uploaded and verified; importer staging may proceed');
  }catch{console.error(FAILURE);process.exitCode=1;}
}
