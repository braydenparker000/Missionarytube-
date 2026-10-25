import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../relay-common.js';
import {boardDate,checkProfile} from '../relay-mast-board.js';
import {decodeReport} from '../../frontend/daily-board/v1/schema.js';
import {decodeReport as decodeV2,REPORT_MARKER as V2_MARKER} from '../../frontend/daily-board/v2/schema.js';

const fixture=JSON.parse(readFileSync(new URL('../../tests/fixtures/daily-board/one.json',import.meta.url),'utf8'));
const premium=JSON.parse(readFileSync(new URL('../../tests/fixtures/daily-board/premium.json',import.meta.url),'utf8'));
const report=(date,extra={})=>({...structuredClone(fixture),id:crypto.randomUUID(),date,synthetic:false,...extra});
const profile={focus:'What matters to me today: tech, Argentina and music.',depth:'standard',stories:{min:4,max:7},lookbackHours:36,
  interests:[{topic:'AI and developer tools',priority:'high'},{topic:'Argentina economy',priority:'normal',notes:'Rosario angle when there is one'}],
  avoid:['celebrity gossip'],sources:{prefer:['primary sources']}};

test('Muse publishes the Daily Board directly and keeps the owner\'s brief',async t=>{
  const token=random(),h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(token)}});t.after(()=>h.close());
  const owner=await h.pair(await h.oauth());
  const call=(path,body,credential=token,headers={})=>h.fixture.request('/relay/mast/board'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+credential,...headers},...(body?{body:JSON.stringify(body)}:{})});
  const today=boardDate(),day=n=>new Date(Date.parse(today)+n*86400000).toISOString().slice(0,10);

  // Mast token only, server to server.
  assert.equal((await call('',null,owner.device_token)).status,401);
  assert.equal((await call('',null,'x'.repeat(40))).status,401);
  assert.equal((await call('',null,token,{Origin:'https://missionarytube.z13.web.core.windows.net'})).status,403);
  assert.equal((await call('?x=1')).status,404);

  let board=await (await call('')).json();
  assert.equal(board.today,today);assert.equal(board.publishedToday,false);assert.equal(board.profile,null);assert.equal(board.version,0);
  assert.equal(board.missing.length,7);assert.match(board.board,/\/daily-board\/$/);

  // The brief: checked field by field, versioned so two edits never overwrite each other.
  const bad=await call('/profile',{version:0,profile:{...profile,depth:'very'}});
  assert.equal(bad.status,400);assert.match((await bad.json()).error,/^depth:/);
  assert.equal((await call('/profile',{version:0,profile:{...profile,extra:1}})).status,400);
  assert.equal((await call('/profile',{version:0,profile:{...profile,stories:{min:8,max:3}}})).status,400);
  const saved=await call('/profile',{version:0,profile});assert.equal(saved.status,200);
  assert.equal((await saved.json()).version,1);
  const stale=await call('/profile',{version:0,profile:{...profile,depth:'deep'}});assert.equal(stale.status,409);
  assert.equal((await stale.json()).current.version,1);

  // Publishing: same checks as the offline publisher, a sane date, one report per day.
  const synthetic=await call('/publish',{report:{...report(today),synthetic:true}});
  assert.equal(synthetic.status,400);assert.match((await synthetic.json()).error,/Synthetic/);
  const broken=report(today);broken.stories[0].sources[0].url='http://example.com/x';
  assert.match((await (await call('/publish',{report:broken})).json()).error,/Invalid source/);
  assert.equal((await call('/publish',{report:report(day(1))})).status,400);
  assert.equal((await call('/publish',{report:report(day(-8))})).status,400);
  assert.equal((await call('/publish',{report:report(today),extra:1})).status,400);

  const first=report(today),published=await call('/publish',{report:first});
  assert.equal(published.status,201);const result=await published.json();
  assert.equal(result.published,true);assert.equal(result.entry.id,first.id);assert.equal(result.entry.date,today);
  const again=await call('/publish',{report:first});assert.equal(again.status,200);assert.equal((await again.json()).duplicate,true);
  const second=await call('/publish',{report:report(today,{title:'Another take'})});
  assert.equal(second.status,409);assert.equal((await second.json()).existing.id,first.id);
  assert.equal((await call('/publish',{report:{...first,title:'Changed title'}})).status,409);
  assert.equal((await call('/publish',{report:report(day(-2))})).status,201);

  // It is on the board at once, as a structured report.
  const state=await (await h.fixture.request('/shared/state')).json();
  const entry=state.posts.find(p=>p.id===first.id);assert.ok(entry);
  assert.equal(decodeReport(entry).id,first.id);

  board=await (await call('')).json();
  assert.equal(board.publishedToday,true);assert.deepEqual(board.recent.map(r=>r.date),[today,day(-2)]);
  assert.equal(board.missing.includes(today),false);assert.equal(board.missing.includes(day(-1)),true);
  assert.deepEqual(board.profile,profile);assert.equal(board.version,1);
});

test('the brief rejects what a run could not use',()=>{
  assert.doesNotThrow(()=>checkProfile(profile));
  for(const change of [{focus:''},{interests:[]},{interests:[{topic:'x',priority:'urgent'}]},{lookbackHours:2},{avoid:['x'.repeat(201)]},{sources:{trusted:[]}},{notes:''}])
    assert.throws(()=>checkProfile({...profile,...change}));
});

test('Muse publishes a premium v2 edition, larger than the v1 limit, and it reads back exactly',async t=>{
  const token=random(),h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(token)}});t.after(()=>h.close());
  const call=(path,body)=>h.fixture.request('/relay/mast/board'+path,{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify(body)});
  const today=boardDate();
  const report={...structuredClone(premium),id:crypto.randomUUID(),date:today,synthetic:false};
  // Grow it past the old 20,000 limit with real story content, staying inside 48 KB.
  for(let i=0;i<5;i++)report.stories.push({...structuredClone(premium.stories[0]),id:`extra-${i}`,blocks:premium.stories[0].blocks.map(b=>({...structuredClone(b),id:`${b.id}-${i}`}))});
  const size=new TextEncoder().encode(JSON.stringify(report)).length;assert.ok(size>20000&&size<48000,String(size));

  const bad=structuredClone(report);bad.stories[0].blocks[0].type='html';
  const rejected=await call('/publish',{report:bad});assert.equal(rejected.status,400);
  assert.match((await rejected.json()).error,/^Report rejected: Story 1 block 1: unsupported block type/);

  const published=await call('/publish',{report});assert.equal(published.status,201);
  assert.equal((await call('/publish',{report})).status,200,'the same edition retried is a duplicate, not a second report');
  const state=await (await h.fixture.request('/shared/state')).json();
  const entry=state.posts.find(p=>p.id===report.id);assert.ok(entry.body.includes(V2_MARKER));
  assert.deepEqual(decodeV2(entry),report);

  // A v1 report on another day still publishes through the same endpoint.
  const old={...structuredClone(fixture),id:crypto.randomUUID(),date:new Date(Date.parse(today)-86400000).toISOString().slice(0,10),synthetic:false};
  assert.equal((await call('/publish',{report:old})).status,201);
});

test('the public message path keeps its own limits even when a body mentions the v2 marker',async t=>{
  const h=createConversationFixture(t,{env:{}});t.after(()=>h.close());
  const r=await h.fixture.request('/shared/messages',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),body:'x'.repeat(4100)+V2_MARKER})});
  assert.equal(r.status,400);assert.equal((await r.json()).error,'Invalid entry');
});

test('Muse can check and preview a draft before publishing, and each edition keeps its quality score',async t=>{
  const token=random(),h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(token)}});t.after(()=>h.close());
  const call=(path,body)=>h.fixture.request('/relay/mast/board'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token},...(body?{body:JSON.stringify(body)}:{})});
  const today=boardDate(),report={...structuredClone(premium),id:crypto.randomUUID(),date:today,synthetic:false};
  report.stories[1].title='Economy: '+report.stories[1].title;
  report.stories[1].sources[0].url='https://particle.news/story/x';report.stories[1].sources[1].url='https://en.wikipedia.org/wiki/Port';

  // Check: no publish, every hard error listed, quality warnings named.
  const bad=structuredClone(report);bad.stories[0].blocks[0].type='html';
  const failed=await (await call('/check',{report:bad})).json();
  assert.equal(failed.ok,false);assert.match(failed.errors[0],/unsupported block type/);assert.equal(failed.quality,null);
  const checked=await (await call('/check',{report})).json();
  assert.equal(checked.ok,true);assert.deepEqual(checked.errors,[]);
  const codes=checked.quality.warnings.map(w=>w.code);
  assert.ok(codes.includes('title-prefix')&&codes.includes('weak-sources')&&codes.includes('weak-source'),codes.join());
  assert.ok(checked.quality.score<100);
  assert.equal((await (await call('')).json()).publishedToday,false,'a check never publishes');

  // Draft: a private preview link; only its exact token reads it.
  const saved=await call('/draft',{report});assert.equal(saved.status,201);
  const draft=await saved.json();const preview=new URL(draft.preview);
  assert.match(preview.pathname,/\/daily-board\/$/);const draftToken=preview.searchParams.get('draft');assert.match(draftToken,/^[a-f0-9]{64}$/);
  const read=await h.fixture.request('/shared/board-draft?token='+draftToken);assert.equal(read.status,200);
  assert.deepEqual((await read.json()).report,report);
  for(const q of ['?token='+'0'.repeat(64),'?token=short','','?token='+draftToken+'&x=1'])
    assert.equal((await h.fixture.request('/shared/board-draft'+q)).status,404,q);
  assert.equal((await call('/draft',{report:{...report,date:'2099-01-01'}})).status,400);
  assert.equal((await h.fixture.request('/shared/state').then(r=>r.json())).posts.some(p=>p.id===report.id),false,'a draft is not on the board');

  // Publish: the score is returned and kept with the edition; the draft for that date is cleared.
  const published=await (await call('/publish',{report})).json();
  assert.equal(published.published,true);assert.equal(published.quality.score,checked.quality.score);
  assert.equal((await h.fixture.request('/shared/board-draft?token='+draftToken)).status,404,'publishing clears the draft');
  const board=await (await call('')).json();
  assert.equal(board.recent[0].quality.score,checked.quality.score);assert.ok(board.recent[0].quality.codes.includes('weak-sources'));
});
