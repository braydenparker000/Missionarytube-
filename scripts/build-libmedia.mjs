import {cp, mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// libmedia 1.3.1 requires WebGL before considering its WritableStream renderer.
// That renderer writes VideoFrames directly and does not use a GL context.
// Preserve all other prerequisites and keep the exception MediaStream-only.
export function patchMediaStreamGuard(source){
  const before='if(!y.A.wasmPlayerSupported)';
  const after='if(!y.A.wasmPlayerSupported&&!(this.isMediaStreamMode()&&y.A.trackGenerator&&y.A.wasmBaseSupported&&y.A.fetch&&y.A.audioContext))';
  if(source.split(before).length!==2)throw new Error('libmedia capability patch no longer matches the pinned runtime');
  return source.replace(before,after);
}

// Runtime chunks and decoder binaries stay together, on Astra's own origin.
// Downloads are pinned to a commit AND verified against reviewed SHA-256s.
export async function buildLibmedia() {
  const manifest=JSON.parse(await readFile(new URL('./libmedia-assets.json',import.meta.url),'utf8'));
  const destination=new URL('../dist/assets/js/playback/libmedia/',import.meta.url);
  await mkdir(destination,{recursive:true});
  await cp(new URL('../node_modules/@libmedia/avplayer/dist/umd/',import.meta.url),destination,{recursive:true});
  const runtime=new URL('avplayer.js',destination);
  await writeFile(runtime,patchMediaStreamGuard(await readFile(runtime,'utf8')));
  await Promise.all(manifest.assets.map(async asset=>{
    const cache=new URL('../.browser-check/libmedia/'+asset.path,import.meta.url);
    let bytes;try{bytes=await readFile(cache);}catch{}
    const valid=value=>value&&createHash('sha256').update(value).digest('hex')===asset.sha256;
    if(!valid(bytes)){
      const response=await fetch(`https://raw.githubusercontent.com/zhaohappy/libmedia/${manifest.commit}/dist/${asset.path}`,{signal:AbortSignal.timeout(60000)});
      if(!response.ok)throw new Error('Decoder download failed: '+asset.path);
      bytes=Buffer.from(await response.arrayBuffer());
      if(!valid(bytes))throw new Error('Decoder checksum mismatch: '+asset.path);
      await mkdir(new URL('./',cache),{recursive:true});await writeFile(cache,bytes);
    }
    const target=new URL(asset.path,destination);
    await mkdir(new URL('./',target),{recursive:true});await writeFile(target,bytes);
  }));
}
