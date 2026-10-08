import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import path from 'node:path';

// SHA-256 of Muse's existing 32 raw Ed25519 public-key bytes, not its hex text.
// The diagnostic accepts no CLI/env override for the Worker, route or target.
export const MUSE_RAW_KEY_SHA256 = '9bad5445d83597de67f864295b464616c3c00cfcfa42ce17241c4e85a4c437fd';
const HEX = /^[a-f0-9]{64}$/;
const blocked = (blocker, binding_present = null) => ({
  binding_present, parsed_public_key_count:null, raw_fingerprint_match:null, blocker,
});

export function publicKeySummary(settings, expectedRawKeySha256 = MUSE_RAW_KEY_SHA256) {
  try {
    if (!Array.isArray(settings?.bindings) || !settings.bindings.every(binding => binding &&
      typeof binding === 'object' && !Array.isArray(binding) && typeof binding.name === 'string' && binding.name.length > 0 &&
      typeof binding.type === 'string' && binding.type.length > 0) ||
      typeof expectedRawKeySha256 !== 'string' || !HEX.test(expectedRawKeySha256))
      return blocked('invalid_settings_response');
    const bindings = settings.bindings.filter(binding => binding?.name === 'MUSIC_UPLOAD_PUBLIC_KEYS');
    if (bindings.length === 0)
      return {binding_present:false, parsed_public_key_count:0, raw_fingerprint_match:false};
    if (bindings.length !== 1) return blocked('duplicate_public_key_binding',true);
    const binding = bindings[0];
    // Secret values cannot be read by this settings GET. Do not access them or
    // turn an unavailable value into evidence that Muse's public key is absent.
    if (binding.type === 'secret_text') return blocked('public_key_binding_value_unavailable',true);
    if (binding.type !== 'plain_text' || typeof binding.text !== 'string')
      return blocked('invalid_public_key_binding',true);
    let keys;
    try {keys = JSON.parse(binding.text || '[]');}
    catch {return blocked('invalid_public_key_binding',true);}
    // Match backend/music-upload.js's allowlist checks, including its 8-key cap.
    if (!Array.isArray(keys) || keys.length > 8 || !keys.every(key => typeof key === 'string' && HEX.test(key)))
      return blocked('invalid_public_key_binding',true);
    const match = keys.some(key => createHash('sha256').update(Buffer.from(key,'hex')).digest('hex') === expectedRawKeySha256);
    return {binding_present:true, parsed_public_key_count:keys.length, raw_fingerprint_match:match};
  } catch {return blocked('invalid_settings_response');}
}

// Use only the existing deployment account and credential in CI. This is the
// established binding-preflight GET; no response/body/header is logged or saved.
export async function diagnoseMusePublicKey({account, token, fetcher = globalThis.fetch}) {
  try {
    if (!account) return blocked('missing_r2_account_id');
    if (typeof account !== 'string' || !/^[a-f0-9]{32}$/.test(account)) return blocked('invalid_r2_account_id');
    if (typeof token !== 'string' || !token) return blocked('missing_cloudflare_api_token');
    let response;
    try {
      response = await fetcher(`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/jarvis-hub-api/settings`,
        {method:'GET', redirect:'error', headers:{Authorization:`Bearer ${token}`}, signal:AbortSignal.timeout(30000)});
    } catch {return blocked('cloudflare_transport_failure');}
    if (!response.ok) {
      return blocked(response.status === 401 ? 'cloudflare_authentication_failed' :
        response.status === 403 ? 'cloudflare_settings_read_forbidden' :
        response.status === 404 ? 'cloudflare_worker_settings_not_found' : 'cloudflare_settings_http_failure');
    }
    let data;
    try {data = await response.json();}
    catch {return blocked('cloudflare_response_unreadable');}
    if (data?.success !== true) return blocked('cloudflare_settings_api_failure');
    return publicKeySummary(data.result);
  } catch {return blocked('diagnostic_failed');}
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  let result;
  try {
    result = process.argv.length === 2
      ? await diagnoseMusePublicKey({account:process.env.CLOUDFLARE_ACCOUNT_ID, token:process.env.CLOUDFLARE_API_TOKEN})
      : blocked('unexpected_diagnostic_arguments');
  } catch {result = blocked('diagnostic_failed');}
  console.log(JSON.stringify(result));
  if (Object.hasOwn(result,'blocker')) process.exitCode = 1;
}
