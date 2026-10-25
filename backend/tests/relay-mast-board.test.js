import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createConversationFixture} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../relay-common.js';
import {boardDate,checkProfile} from '../relay-mast-board.js';
import {decodeReport} from '../../frontend/daily-board/v1/schema.js';

const fixture=JSON.parse(readFileSync(new URL('../../tests/fixtures/daily-board/one.json',import.meta.url),'utf8'));
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
