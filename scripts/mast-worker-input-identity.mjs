import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {backendInputIdentity} from './worker-release-identity.mjs';
// esbuild metafile keys include URL suffixes. Resolve only absent literal names;
// the original guard still verifies every input against immutable tracked bytes.
// Any suffix forces a fresh publication; actual bundle bytes remain sealed.
export function suffixAwareBundler(compiler,source){return {version:compiler.version,buildSync(options){
 const result=compiler.buildSync(options),inputs={};let suffixed=false;
 for(const [path,metadata] of Object.entries(result.metafile.inputs)){
  const file=existsSync(resolve(source,path))?path:path.split(/[?#]/,1)[0];
  if(file!==path)suffixed=true;
  inputs[file]=inputs[file]?{...metadata,imports:[...inputs[file].imports,...metadata.imports]}:metadata;
 }
 return {...result,metafile:{...result.metafile,inputs},warnings:[...result.warnings,...(suffixed?[{text:'URL suffix requires fresh Worker publication'}]:[])]};
}};}
export function mastBackendInputIdentity(source){return backendInputIdentity(source,{bundler:suffixAwareBundler(createRequire(resolve(source,'package.json'))('esbuild'),source)});}
