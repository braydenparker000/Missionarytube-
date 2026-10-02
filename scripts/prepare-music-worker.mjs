import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

// This prepares a local candidate only. Running it never calls Cloudflare.
export function musicWorkerConfig(source, {uploadPublicKeys} = {}) {
  if (source?.name !== 'jarvis-hub-api' || source.main !== 'worker.js' ||
      !source.durable_objects?.bindings?.some(binding => binding.name === 'HUBS' && binding.class_name === 'Hub')) {
    throw Error('Unexpected Worker configuration; refusing to replace a different service');
  }
  const result = structuredClone(source);
  const bindings = result.r2_buckets ?? [];
  if (!Array.isArray(bindings) || bindings.some(binding => binding.binding === 'MUSIC_R2' && binding.bucket_name !== 'jarvis-music')) {
    throw Error('Conflicting music bucket binding');
  }
  result.r2_buckets = [...bindings.filter(binding => binding.binding !== 'MUSIC_R2'), {binding:'MUSIC_R2', bucket_name:'jarvis-music'}];
  result.vars = {...result.vars, MUSIC_PUBLIC_READ:'true', MUSIC_ROOT_ID:'1VlEUztloW5saoM7iF11fodDKSmCGP2ZZ'};
  if(uploadPublicKeys!==undefined){
    if(!Array.isArray(uploadPublicKeys)||uploadPublicKeys.length>8||uploadPublicKeys.some(k=>typeof k!=='string'||!/^[a-f0-9]{64}$/.test(k)))throw Error('Invalid nonsecret upload public keys');
    result.vars.MUSIC_UPLOAD_PUBLIC_KEYS=JSON.stringify([...new Set(uploadPublicKeys)]);
  }
  result.keep_vars = true;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const sourceRoot = process.argv[2];
  if (!sourceRoot) throw Error('A checked-out Jarvis source directory is required');
  // The repository currently uses strict JSON in its .jsonc file. Fail if that
  // changes; do not strip comments or rewrite values with regular expressions.
  const input = path.join(sourceRoot, 'backend/wrangler.jsonc');
  const uploadPublicKeys=process.argv[3]?JSON.parse(await fs.readFile(process.argv[3],'utf8')):undefined;
  const config = musicWorkerConfig(JSON.parse(await fs.readFile(input, 'utf8')), {uploadPublicKeys});
  await fs.access(path.join(sourceRoot, 'backend/music.js'));
  await fs.writeFile(path.join(sourceRoot, 'backend/wrangler.music.generated.json'), JSON.stringify(config, null, 2) + '\n');
  console.log('Prepared jarvis-hub-api with the approved read-only public music route');
}
