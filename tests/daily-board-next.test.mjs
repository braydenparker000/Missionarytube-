import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {validateReport,safeURL,canonical} from '../daily-board-next/schema.js';
import {prepare,verifyReadback} from '../daily-board-next/publisher.mjs';
import {publishReport,readReport} from '../daily-board-next/store.js';
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
  assert.equal(prepare(r,{reviewedPublic:true}).id,r.id);assert(verifyReadback(r,JSON.parse(canonical(r))));const other=structuredClone(r);other.title='Different';assert(!verifyReadback(r,other));
});
test('SQLite sidecar preserves IDs, conflict behavior, readback and legacy rows across rollback',async()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE shared_entries(id TEXT PRIMARY KEY,kind TEXT,body TEXT); CREATE TABLE dates(date TEXT PRIMARY KEY,id TEXT);');
  db.exec(readFileSync(new URL('../daily-board-next/migrations/001-up.sql',import.meta.url),'utf8'));
  const ctx={storage:{sql:{exec:(q,...args)=>db.prepare(q).all(...args)},transactionSync:fn=>{db.exec('SAVEPOINT report');try{const v=fn();db.exec('RELEASE report');return v;}catch(e){db.exec('ROLLBACK TO report');throw e;}}}};
  const options={reviewedPublic:true,sharedSchema:()=>{},sharedStore:(ctx,path,b)=>{
    const prior=db.prepare('SELECT * FROM shared_entries WHERE id=?').get(b.id),dated=db.prepare('SELECT id FROM dates WHERE date=?').get(b.date);
    if(prior)return Response.json({}, {status:prior.body===b.body?200:409});if(dated)return Response.json({}, {status:409});
    db.prepare('INSERT INTO shared_entries VALUES(?,?,?)').run(b.id,'briefing',b.body);db.prepare('INSERT INTO dates VALUES(?,?)').run(b.date,b.id);return Response.json({}, {status:201});
  }};
  const r=fixture('one');assert.equal(publishReport(ctx,r,{...options,reviewedPublic:false}).status,403);
  assert.equal(publishReport(ctx,r,options).status,201);assert.equal(publishReport(ctx,r,options).status,200);assert.deepEqual(readReport(ctx,r.id),r);
  const changed=structuredClone(r);changed.stories[0].blocks[0].text='Changed';assert.equal(publishReport(ctx,changed,options).status,409);
  const second=fixture('two');second.date=r.date;assert.equal(publishReport(ctx,second,options).status,409);
  db.exec(readFileSync(new URL('../daily-board-next/migrations/001-down.sql',import.meta.url),'utf8'));assert.equal(db.prepare('SELECT count(*) AS n FROM shared_entries').get().n,1);db.close();
});
