import {writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ownerGateClassification, ownerGateIsOff} from './relay-owner-gate.mjs';

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

// The same sealed CI credential and fixed GET are shared by normal binding
// checks and the read-only owner gate. Response bodies and credentials are
// never logged, persisted or included in errors.
export async function readWorkerSettings({account, token, fetcher = globalThis.fetch}) {
  if (!/^[a-f0-9]{32}$/.test(account || '') || typeof token !== 'string' || !token) throw Error('Missing deployment credentials');
  const response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`,
    {method:'GET',redirect:'error',headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw Error('Worker settings could not be read; deployment stopped');
  const data = await response.json();
  if (data?.success !== true || !Array.isArray(data.result?.bindings)) throw Error('Worker settings were not available');
  return data.result;
}

export async function workerBindingsPreflight({account, token, ownerGate = false, fetcher = globalThis.fetch}) {
  const settings = await readWorkerSettings({account, token, fetcher});
  const bindings = checkedBindings(settings);
  if (ownerGate) {
    const classification = ownerGateClassification(settings);
    return {classification, allowed:ownerGateIsOff(classification)};
  }
  return {bindings};
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), ownerGate = args.includes('--owner-gate');
  try {
    if (args.length !== (ownerGate ? 1 : 0)) throw Error('Unexpected preflight arguments');
    const result = await workerBindingsPreflight({account:process.env.CLOUDFLARE_ACCOUNT_ID,
      token:process.env.CLOUDFLARE_API_TOKEN,ownerGate});
    if (ownerGate) {
      // The branch-only provider read emits exactly one bounded classification,
      // writes no artifact, and cannot invoke deployment or a flag update.
      console.log(result.classification);
      if (!result.allowed) process.exitCode = 1;
    } else {
      await writeFile('worker-bindings-before.json',JSON.stringify(result.bindings,null,2)+'\n');
      console.log('Existing HUBS and resource bindings checked; values were not logged.');
    }
  } catch {
    if (ownerGate) console.log('invalid');
    else console.error('Worker binding preflight failed; no Worker deployment was attempted.');
    process.exitCode = 1;
  }
}
