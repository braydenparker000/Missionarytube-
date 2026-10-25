import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateReport,safeURL,canonical} from '../frontend/daily-board/v1/schema.js';
import {prepare,verifyReadback} from '../scripts/daily-board-report.mjs';
import {encodeReport,decodeReport} from '../frontend/daily-board/v1/schema.js';
const fixture=name=>JSON.parse(readFileSync(new URL(`./fixtures/daily-board/${name}.json`,import.meta.url)));
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

import * as v2 from '../frontend/daily-board/v2/schema.js';
test('v2 premium fixture validates and round-trips; v1 still decodes through v2',()=>{
  const r=fixture('premium');assert.equal(v2.validateReport(r).synthetic,true);
  const entry={id:r.id,title:r.title,body:v2.encodeReport(r)};
  assert.deepEqual(v2.decodeReport(entry),r);
  assert.equal(v2.decodeReport({...entry,id:'other'}),null);
  assert.equal(v2.plainText(entry),r.summary);
  const old=fixture('one');assert.deepEqual(v2.decodeReport({id:old.id,title:old.title,body:encodeReport(old)}),old);
  assert.equal(v2.decodeReport({body:'Legacy prose'}),null);
});
test('v2 names the field that is wrong and refuses unsafe or unknown content',()=>{
  const cases=[
    [r=>r.stories[0].dek=undefined,/dek/],
    [r=>r.stories[0].whyItMatters=undefined,/whyItMatters/],
    [r=>r.stories[0].composition='flow',/composition/],
    [r=>r.stories[0].blocks[0].type='script',/unsupported block type/],
    [r=>r.stories[0].blocks[0].html='<b>x</b>',/unknown field html/],
    [r=>r.stories[0].blocks[0].cites=[9],/cites/],
    [r=>r.stories[0].blocks[1].items[0].asOf='yesterday',/asOf/],
    [r=>r.stories[0].blocks[2].items[0].at='2026-10-25 08:00',/at \(ISO time/],
    [r=>r.stories[1].blocks[0].series[0].values.pop(),/one value per label/],
    [r=>r.stories[1].blocks[1].kind='pie',/kind/],
    [r=>r.stories[0].sources[0].url='https://example.com/?utm=1',/plain https url/],
    [r=>r.stories[0].sources[0].type='blog',/type primary/],
    [r=>r.edition.theme='neon',/theme/],
    [r=>r.edition.css='body{}',/unknown field css/],
    [r=>r.stories[1].id=r.stories[0].id,/unique/],
    [r=>r.summary='x'.repeat(50000),/too large/],
  ];
  for(const [change,message] of cases){const r=fixture('premium');change(r);assert.throws(()=>v2.validateReport(r),message);}
  const brief=fixture('premium').stories[3];assert.equal(brief.blocks.length,0,'briefs may have no blocks');
});
test('v2 publisher requires review, refuses synthetic content, and dispatches by schema',()=>{
  const r=fixture('premium');assert.throws(()=>v2.prepare(r));assert.throws(()=>v2.prepare(r,{reviewedPublic:true}),/Synthetic/);
  r.synthetic=false;const p=v2.prepareAny(r,{reviewedPublic:true});
  assert.equal(p.type,'briefing');assert.ok(p.body.includes(v2.REPORT_MARKER));
  const old=fixture('one');old.synthetic=false;assert.ok(v2.prepareAny(old,{reviewedPublic:true}).body.includes('[Jarvis structured report v1]'));
});

import {validatePublicEntry} from '../frontend/assets/public-coordination.js';
test('the shared public reader admits v2 editions up to 50,000 characters and keeps every other limit',()=>{
  const entry=(body,extra={})=>({id:'55555555-5555-4555-8555-555555555555',title:'T',body,createdAt:'2026-10-25T09:00:00Z',...extra});
  assert.doesNotThrow(()=>validatePublicEntry(entry('s'+v2.REPORT_MARKER+'x'.repeat(28000))));
  assert.throws(()=>validatePublicEntry(entry('s'+v2.REPORT_MARKER+'x'.repeat(50001))));
  assert.throws(()=>validatePublicEntry(entry('x'.repeat(20001))));
  assert.throws(()=>validatePublicEntry({id:'55555555-5555-4555-8555-555555555555',role:'user',body:'x'.repeat(4001)+v2.REPORT_MARKER,createdAt:'2026-10-25T09:00:00Z'}));
});

import {assess} from '../frontend/daily-board/v2/quality.js';
test('quality checks score an edition and name what would improve it, without blocking',()=>{
  const clean=assess(fixture('premium'));assert.ok(clean.score>=85,String(clean.score));
  const r=fixture('premium');
  r.stories[0].title='Region: '+r.stories[0].title;
  r.stories[1].sources.forEach(s=>{s.url='https://particle.news/x';});
  r.summary='Research cutoff: 07:00. '+r.summary;
  r.stories[0].blocks[1].items.push({label:'Extra',value:'1',asOf:'2026-10-24'});
  r.stories[1].blocks[1].labels[0]='A very long category label';
  r.stories[0].blocks[0].cites=undefined;
  const codes=assess(r,{profile:{depth:'deep',lookbackHours:36}}).warnings.map(w=>w.code);
  for(const code of ['title-prefix','weak-sources','weak-source','process-note','many-tiles','long-labels','uncited'])assert.ok(codes.includes(code),code);
  assert.ok(assess(r).score<clean.score);
  const stale=fixture('premium');stale.stories[0].sources.forEach(s=>{s.publishedOn='2026-09-01';});
  assert.ok(assess(stale,{profile:{depth:'standard',lookbackHours:36}}).warnings.some(w=>w.code==='stale'));
});
