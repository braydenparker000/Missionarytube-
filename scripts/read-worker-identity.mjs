// Read-only live Worker identity capture for the Poweramp worker checkpoint.
//
// Calls the EXACT liveIdentity() gate functions from
// worker-release-identity.mjs — the same functions the
// publish-poweramp-shuffle.mjs worker() gate uses. Two GET-only Cloudflare
// API reads per call (script settings + deployments list). No deployment,
// no settings mutation, no state change.
//
// The identity is read twice and must be stable across both reads (per the
// mobile-file-save pattern: stable complete settings over two reads).
// Output is {version, settingsDigest} — hashes only. No provider values,
// tokens, or secret material are returned, logged, or persisted.
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {liveIdentity} from './worker-release-identity.mjs';

const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!account || !token) throw new Error('Cloudflare credentials required');

const first = await liveIdentity({account, token});
const second = await liveIdentity({account, token});
assert.deepEqual(second, first, 'Live Worker identity not stable over two reads');

writeFileSync('worker-identity.json', JSON.stringify(first, null, 1) + '\n');
console.log(JSON.stringify(first));
