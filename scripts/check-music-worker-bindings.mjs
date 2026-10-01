import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// Variables and secrets are retained by keep_vars and Wrangler's secret handling.
// Refuse a deployment if source configuration would drop another resource.
export function checkedBindings(settings) {
  const bindings = settings?.bindings;
  if (!Array.isArray(bindings)) throw Error('Worker settings did not contain bindings');
  const hubs = bindings.filter(b => b.name === 'HUBS');
  if (hubs.length !== 1 || hubs[0].type !== 'durable_object_namespace' || hubs[0].class_name !== 'Hub' ||
      (hubs[0].script_name && hubs[0].script_name !== 'jarvis-hub-api')) {
    throw Error('Existing HUBS binding does not match the tested Worker');
  }
  for (const binding of bindings) {
    if (['plain_text', 'secret_text'].includes(binding.type)) continue;
    if (binding.name === 'HUBS') continue;
    if (binding.name === 'MUSIC_R2' && binding.type === 'r2_bucket' && binding.bucket_name === 'jarvis-music') continue;
    throw Error('An additional resource binding requires preservation before deploying');
  }
  return bindings.map(b => ({name:b.name,type:b.type,
    ...(b.name === 'HUBS' ? {class_name:b.class_name,namespace_id:b.namespace_id} : {}),
    ...(b.type === 'r2_bucket' ? {bucket_name:b.bucket_name} : {})}));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const account = process.env.CLOUDFLARE_ACCOUNT_ID;
    const token = process.env.CLOUDFLARE_API_TOKEN;
    if (!/^[a-f0-9]{32}$/.test(account || '') || !token) throw Error('Missing deployment credentials');
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`,
      {headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw Error('Worker settings could not be read; deployment stopped');
    const data = await response.json();
    if (!data.success) throw Error('Worker settings were not available');
    await writeFile('worker-bindings-before.json',JSON.stringify(checkedBindings(data.result),null,2)+'\n');
    console.log('Existing HUBS and resource bindings checked; values were not logged.');
  } catch {
    console.error('Worker binding preflight failed; no Worker deployment was attempted.');
    process.exitCode = 1;
  }
}
