import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateReport,safeURL,canonical} from '../daily-board-next/schema.js';
import {prepare,verifyReadback} from '../daily-board-next/publisher.mjs';
import {encodeReport,decodeReport} from '../daily-board-next/schema.js';
const fixture=name=>JSON.parse(readFileSync(new URL(`../daily-board-next/fixtures/${name}.json`,import.meta.url)));
test('two independent compositions validate, including prose only',()=>{
  for(const name of ['one','two'])assert.equal(validateReport(fixture(name)).synthetic,true);
  const r=fixture('one');r.stories=r.stories.slice(0,1);r.stories[0].blocks=r.stories[0].blocks.slice(0,1);validateReport(r);
});
test('reject malformed metadata, private fields, URLs, duplicate IDs, unknown types and bounds',()=>{
  const mutations=[r=>r.visibility='private',r=>r.date='2026-02-30',r=>r.stories[0].privateNotes='secret',r=>r.stories[0].blocks[0].type='script',r=>r.stories[0].blocks[0].id=r.stories[0].id,r=>r.summary='x'.repeat(21000),r=>r.stories[0].sources[0].url='javascript:alert(1)'];
  for(const change of mutations){const r=fixture('one');change(r);assert.throws(()=>validateReport(r));}
  for(const u of ['http://example.com','https://user:pass@example.com','https://example.com/?token=secret','https://127.0.0.1','https://10.1.2.3','https://[::1]'])assert.equal(safeURL(u),false,u);
});
test('publisher requires review, refuses synthetic content and detects changed readback',()=>{
  const r=fixture('one');assert.throws(()=>prepare(r));assert.throws(()=>prepare(r,{reviewedPublic:true}));r.synthetic=false;
  assert.throws(()=>prepare({...r,title:' '+r.title},{reviewedPublic:true}));
  assert.equal(prepare(r,{reviewedPublic:true}).id,r.id);assert(verifyReadback(r,JSON.parse(canonical(r))));const other=structuredClone(r);other.title='Different';assert(!verifyReadback(r,other));
});
test('existing body envelope round-trips with stable identity and safe unknown fallback',()=>{
  const r=fixture('two'),entry={id:r.id,title:r.title,body:encodeReport(r)};
  assert.deepEqual(decodeReport(entry),r);
  assert.equal(decodeReport({...entry,id:'other'}),null);
  assert.equal(decodeReport({...entry,body:entry.body.replace('jarvis-daily-board-v1','unknown')}),null);
  assert.equal(decodeReport({body:'Legacy prose'}),null);
});
test('maintained production modules exactly match qualified component sources',()=>{
  for(const file of ['schema.js','render.js','live.js','design.css','components.css'])assert.equal(readFileSync(new URL('../jarvis/public/daily-board/v1/'+file,import.meta.url),'utf8'),readFileSync(new URL('../daily-board-next/'+file,import.meta.url),'utf8'));
});
