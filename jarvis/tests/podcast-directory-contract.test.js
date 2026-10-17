import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {appleDirectoryURLs, normalizeDirectory, clientDirectory} from '../public/podcasts/directory.js';
import {directory, podcasts} from '../backend/podcasts.js';
const fixtures = await Promise.all(['apple-search','apple-alternate'].map(name => readFile(new URL(`./fixtures/podcasts/${name}.json`, import.meta.url), 'utf8').then(JSON.parse)));
const response = fixture => new Response(JSON.stringify(fixture.body), {status:fixture.status,headers:fixture.headers});

for (const [index, fixture] of fixtures.entries()) test(`captured Apple ${index ? 'alternate' : 'search'} contract parses as JSON on client and Worker`, async () => {
  assert.equal(fixture.status,200);assert.equal(fixture.headers['Access-Control-Allow-Origin'],'*');assert.match(fixture.headers['Content-Type'],/^text\/javascript/);
  const expected=normalizeDirectory(fixture.body);assert.equal(expected.shows.length,2);
  assert.equal(expected.shows[0].title,fixture.body.results[0].collectionName);assert.equal(expected.shows[0].feedUrl,fixture.body.results[0].feedUrl);
  let calls=0;
  const fetcher=async(url,init)=>{
    const parsed=new URL(url);assert.equal(parsed.origin,'https://itunes.apple.com');assert.equal(parsed.searchParams.get('term'),'History & science');
    assert.equal(parsed.searchParams.get('country'),'ar');assert.equal(parsed.searchParams.get('entity'),'podcast');assert.equal(parsed.searchParams.has('callback'),false);
    assert.equal(init.credentials,'omit');assert.equal(init.referrerPolicy,'no-referrer');assert.equal(init.headers.Authorization,undefined);
    if(calls++<index)throw TypeError('CORS/network rejection');return response(fixture);
  };
  assert.deepEqual(await clientDirectory('History & science','AR',undefined,fetcher),expected);assert.equal(calls,index+1);
  let workerCalls=0;
  assert.deepEqual(await directory('History & science','AR',{fetcher:async()=>workerCalls++<index?new Response('Rejected',{status:403}):response(fixture)}),expected);
  const served=await podcasts(new Request('https://fixture.example.org/podcasts/browse?category=history&country=ar'),(data,status=200)=>Response.json(data,{status}),{fetcher:async()=>response(fixture)});
  assert.equal(served.status,200);assert.deepEqual(await served.json(),expected);
});
test('client never evaluates callback or executable text, and keeps using the alternate JSON provider', async () => {
  delete globalThis.__podcastContractExecuted;let calls=0;
  const output=await clientDirectory('History','us',undefined,async()=>++calls===1?new Response('globalThis.__podcastContractExecuted=true;someCallback({results:[]})', {headers:{'Content-Type':'text/javascript'}}):response(fixtures[1]));
  assert.equal(output.shows.length,2);assert.equal(globalThis.__podcastContractExecuted,undefined);assert.equal(calls,2);
});
test('provider metadata is type checked, bounded, escaped by the view, and credential URLs are rejected', () => {
  const good=fixtures[0].body.results[0];
  const data={results:[null,0,{}, {...good,collectionName:42},{...good,feedUrl:'javascript:alert(1)'},{...good,feedUrl:'https://user:password@example.org/feed'},
    {...good,collectionName:'<script>untrusted text</script>',artistName:'a'.repeat(500),genres:[{},'History']}]};
  const parsed=normalizeDirectory(data);assert.equal(parsed.shows.length,1);assert.equal(parsed.shows[0].author.length,200);assert.deepEqual(parsed.shows[0].genres,['History']);
  assert.match(parsed.shows[0].title,/<script>/,'Parser returns data; view is responsible for text escaping');
  assert.throws(()=>normalizeDirectory([]),/Invalid/);assert.throws(()=>normalizeDirectory({results:{}},'gpodder'),/Invalid/);
});
test('data-only fallback preserves genuine empty results, bounded response size and abort semantics', async () => {
  assert.deepEqual(await clientDirectory('nothing','us',undefined,async()=>Response.json({results:[]})),{shows:[]});
  const controller=new AbortController();controller.abort();let calls=0;
  await assert.rejects(clientDirectory('History','us',controller.signal,()=>{calls++;assert.fail('Already aborted');}),{name:'AbortError'});assert.equal(calls,0);
  await assert.rejects(clientDirectory('History','us',undefined,async()=>new Response('x'.repeat(1024*1024+1))),/unavailable/);
  let cancelled=false;
  await assert.rejects(clientDirectory('History','us',undefined,async()=>new Response(new ReadableStream({start(c){c.enqueue(new Uint8Array(1024*1024+1));},cancel(){cancelled=true;}}))),/unavailable/);
  assert.equal(cancelled,true);
});
test('only the two existing Apple endpoints are used; query text cannot add callback or credentials', () => {
  const urls=appleDirectoryURLs('history&callback=malicious','bad-country');assert.equal(urls.length,2);
  for(const value of urls){const url=new URL(value);assert.equal(url.searchParams.get('term'),'history&callback=malicious');assert.equal(url.searchParams.has('callback'),false);assert.equal(url.searchParams.get('country'),'us');assert.equal(url.username,'');}
});
