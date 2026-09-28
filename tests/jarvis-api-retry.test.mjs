import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=await readFile(new URL('../scripts/check-jarvis-api.mjs',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function checkedFetch'),source.indexOf('const release='));
function checker(fetch){return vm.runInNewContext(code+'\ncheckedFetch',{fetch,AbortSignal,setTimeout:fn=>fn()});}
test('backend deployment gate recovers from a connection reset without bypassing status checks',async()=>{
 let calls=0;const response=await checker(async()=>{if(++calls===1)throw Error('ECONNRESET');return new Response('ok');})('https://example.test',{});
 assert.equal(calls,2);assert.equal(response.status,200);
});
test('backend gate does not retry permission failures and caps persistent connection failures',async()=>{
 let calls=0;const denied=await checker(async()=>{calls++;return new Response('',{status:403});})('https://example.test',{});assert.equal(calls,1);assert.equal(denied.status,403);
 calls=0;await assert.rejects(checker(async()=>{calls++;throw Error('ECONNRESET');})('https://example.test',{}));assert.equal(calls,4);
});
