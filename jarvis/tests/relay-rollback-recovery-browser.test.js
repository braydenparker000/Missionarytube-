import test from 'node:test';
import assert from 'node:assert/strict';
import {createRollbackHarness,ROLLBACK_NOW as NOW,rollbackId as id,rollbackMessage as message,
  rollbackStamp as stamp,rollbackComment as comment} from './helpers/relay-rollback-recovery-harness.js';
import {launchQualifiedBrowser,openConversationPage,closeConversationHarness,assertBrowserContained,RELAY_URL,
  writeSyntheticEvidence} from './helpers/relay-conversation-browser-fixture.js';
import {STORAGE_KEY} from '../public/assets/shared-store.js';

const idle=page=>page.waitForFunction(()=>!/(Opening|Refreshing|Sending)/.test(document.getElementById('relay-status')?.textContent||''));
const saved=page=>page.evaluate(key=>localStorage.getItem(key),STORAGE_KEY);
const history=phone=>phone.records.filter(record=>record.method==='GET'&&['/shared/state','/shared/changes'].includes(record.path));
const hide=page=>page.evaluate(()=>{window.rollbackHidden=true;Object.defineProperty(document,'hidden',{configurable:true,get:()=>window.rollbackHidden});});
async function show(page){await page.evaluate(()=>{window.rollbackHidden=false;document.dispatchEvent(new Event('visibilitychange'));});await idle(page);}

test('mobile browser resumes its saved pc2 cursor after actual native candidate-c4-candidate rollback and preserves draft, immutable hold and corrected artifact on reload', {timeout:120000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;
  const h=await createRollbackHarness(t),phones=[];
  const bridge={fixture:{request(path,init={}){assert.equal(init.method||'GET','GET','The recovery reader cannot issue new execution requests');
    assert.ok(path.startsWith('/shared/changes')||path.startsWith('/shared/state'));return h.read(path);}},close(){}};
  t.after(()=>closeConversationHarness(browser,bridge,phones));
  assert.equal((await h.control({op:'store',path:'/internal/shared/message',body:message(1),now:NOW})).status,201);
  const hold={id:id(2),replyTo:id(1),body:'Fictional browser immutable hold',createdAt:stamp};
  assert.equal((await h.control({op:'store',path:'/internal/shared/reply',body:hold})).status,201);
  const phone=await openConversationPage(browser,bridge);phones.push(phone);const {page}=phone;
  await page.goto(RELAY_URL);await page.locator('#message-text').waitFor();await idle(page);
  const held=page.locator(`[data-message-id="${hold.id}"]`);await held.waitFor();await held.evaluate(row=>{window.rollbackHold=row;});
  const draft='Fictional retained rollback draft';await page.locator('#message-text').fill(draft);
  const checkpoint=JSON.parse(await saved(page));assert.ok(checkpoint.publicReader);const cursor=checkpoint.publicReader.cursor;
  await hide(page);const hiddenReads=history(phone).length;await page.clock.fastForward(70000);assert.equal(history(phone).length,hiddenReads);
  const first={schema:'jarvis-coordination-v2',eventId:id(9),requestId:id(1),attemptId:id(10),stage:'final',body:'Fictional visible retained artifact',resultVersion:1,
    artifacts:[{id:id(14),revision:1,label:'Fictional browser source',url:'https://example.test/browser-rollback-r1'}]};
  const correction={...first,eventId:id(13),stage:'correction',supersedesEventId:first.eventId,resultVersion:2,
    body:'Fictional corrected retained artifact',artifacts:[{...first.artifacts[0],revision:2,url:'https://example.test/browser-rollback-r2'}]};
  const missing={...first,eventId:id(3),requestId:id(4),attemptId:id(5),body:'Fictional missing original final',artifacts:[]};
  await h.control({op:'sync',now:NOW+300001,comments:[comment(90001,missing),comment(90002,correction)]});
  await h.restart();
  assert.equal((await h.control({op:'store',old:true,path:'/internal/shared/message',body:message(6)})).status,201);
  const old=await h.control({op:'sync',old:true,now:NOW+3600000,comments:[
    comment(90003,{schema:'jarvis-publication-v1',type:'reply',id:id(7),replyTo:id(6),body:'Fictional browser rollback reply'}),
    comment(90004,{schema:'jarvis-publication-v1',type:'briefing',id:id(8),title:'Fictional browser rollback briefing',body:'Fictional retained briefing',date:'2026-10-01'})]});
  assert.equal(old.calls,1);assert.equal((await h.control({op:'store',old:true,path:'/internal/shared/message',body:message(4)})).status,201);
  await h.restart();await show(page);
  await page.locator(`[data-message-id="${id(6)}"]`).waitFor();await page.locator(`[data-message-id="${id(7)}"]`).waitFor();
  assert.equal(history(phone)[hiddenReads].path,'/shared/changes');assert.equal(new URL(history(phone)[hiddenReads].url).searchParams.get('cursor'),cursor);
  assert.equal(await held.evaluate(row=>row===window.rollbackHold),true);assert.equal(await page.locator('#message-text').inputValue(),draft);
  let restored=JSON.parse(await saved(page));assert.equal(restored.posts.filter(post=>post.id===id(8)).length,1);
  await hide(page);await page.clock.fastForward(70000);
  await h.control({op:'sync',now:NOW+3900001,comments:[comment(90005,first)]});
  const published=(await h.control({op:'snapshot'})).body;
  assert.deepEqual(published.events.map(event=>event.event_id),[missing.eventId,first.eventId,correction.eventId]);
  await show(page);
  const revised=page.locator(`[data-message-id="coordination:${correction.eventId}"]`);await revised.waitFor();
  assert.equal(await revised.getByRole('link').getAttribute('href'),correction.artifacts[0].url);assert.match(await revised.getAttribute('aria-label'),/no private execution authority/);
  assert.equal(await page.locator('#message-text').inputValue(),draft);restored=JSON.parse(await saved(page));
  const reloadAt=history(phone).length;await page.evaluate(()=>delete document.hidden);await page.reload();await idle(page);
  await held.waitFor();await revised.waitFor();await page.locator(`[data-message-id="${id(7)}"]`).waitFor();
  assert.equal(await revised.count(),1);assert.equal(await held.count(),1);assert.equal(await page.locator('#message-text').inputValue(),draft);
  assert.equal(history(phone).slice(reloadAt).every(record=>record.path==='/shared/changes'),true);
  assert.equal(new URL(history(phone)[reloadAt].url).searchParams.get('cursor'),restored.publicReader.cursor);
  assert.equal(phone.records.some(record=>record.method==='POST'||record.path.startsWith('/relay/owner/')),false);assertBrowserContained(phone);assert.equal(h.external,0);
  await writeSyntheticEvidence(phone,'rollback-pc2-native-reload',{scope:'Fictional actual native candidate-c4-candidate retained SQL rollback recovery',
    oldSource:h.oldSource,completedCursor:restored.publicReader.cursor,draftPreserved:true,immutableReplyPreserved:true,externalCalls:0});
});

test('hidden mobile reader recovers original v2 final and correction ignored behind actual c4 since via a browser-free alarm, then reloads saved pc2 with unchanged draft and hold', {timeout:120000},async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;
  const h=await createRollbackHarness(t),phones=[];
  const bridge={fixture:{request(path,init={}){assert.equal(init.method||'GET','GET');assert.ok(path.startsWith('/shared/changes')||path.startsWith('/shared/state'));return h.read(path);}},close(){}};
  t.after(()=>closeConversationHarness(browser,bridge,phones));
  await h.control({op:'store',path:'/internal/shared/message',body:message(1),now:NOW});
  const hold={id:id(2),replyTo:id(1),body:'Fictional original replay hold',createdAt:stamp};await h.control({op:'store',path:'/internal/shared/reply',body:hold});
  const phone=await openConversationPage(browser,bridge);phones.push(phone);const {page}=phone;
  await page.goto(RELAY_URL);await page.locator('#message-text').waitFor();await idle(page);
  const held=page.locator(`[data-message-id="${hold.id}"]`);await held.waitFor();await held.evaluate(row=>{window.replayHold=row;});
  const draft='Fictional replay unsent draft';await page.locator('#message-text').fill(draft);
  const initial=JSON.parse(await saved(page)),cursor=initial.publicReader.cursor;
  await hide(page);const reads=history(phone).length;await page.clock.fastForward(70000);assert.equal(history(phone).length,reads);
  const first={schema:'jarvis-coordination-v2',eventId:id(31),requestId:id(1),attemptId:id(32),stage:'final',body:'Fictional original replay final',resultVersion:1,
    artifacts:[{id:id(33),revision:1,label:'Fictional original source',url:'https://example.test/mobile-replay-v1'}]};
  const correction={...first,eventId:id(34),stage:'correction',supersedesEventId:first.eventId,resultVersion:2,body:'Fictional original replay correction',
    artifacts:[{...first.artifacts[0],revision:2,url:'https://example.test/mobile-replay-v2'}]};
  const at=(payload,n,time)=>({...comment(n,payload),created_at:time,updated_at:time});
  await h.restart();await h.control({op:'append-history',comments:[at(first,91001,'2026-10-01T12:00:01.000Z'),at(correction,91002,'2026-10-01T12:00:02.000Z'),
    at({schema:'jarvis-publication-v1',type:'briefing',id:id(35),title:'Fictional later old cutoff',body:'Fictional later briefing',date:'2026-10-01'},91003,'2026-10-01T12:00:10.000Z')]});
  const old=await h.control({op:'sync',old:true,now:NOW+3600000});assert.equal(old.calls,1);
  let state=(await h.control({op:'snapshot'})).body;assert.equal(state.since,'2026-10-01T12:00:09.000Z');assert.equal(state.events.length,0);
  assert.equal(state.imported.some(row=>row.comment_id===91001||row.comment_id===91002),false);
  await h.restart();const alarm=await h.control({op:'alarm',now:NOW+3900001});assert.deepEqual(alarm.requested,[{page:1,since:null}]);
  state=(await h.control({op:'snapshot'})).body;assert.deepEqual(state.events.map(row=>row.event_id),[first.eventId,correction.eventId]);
  assert.equal(history(phone).length,reads,'Original history is recovered before any browser read, hint or repost');
  await show(page);const revised=page.locator(`[data-message-id="coordination:${correction.eventId}"]`);await revised.waitFor();
  assert.equal(new URL(history(phone)[reads].url).searchParams.get('cursor'),cursor);
  assert.equal(await revised.getByRole('link').getAttribute('href'),correction.artifacts[0].url);assert.equal(await held.evaluate(row=>row===window.replayHold),true);
  assert.equal(await page.locator('#message-text').inputValue(),draft);assert.match(await revised.getAttribute('aria-label'),/no private execution authority/);
  const complete=JSON.parse(await saved(page)),reloadAt=history(phone).length;
  await page.evaluate(()=>delete document.hidden);await page.reload();await idle(page);await revised.waitFor();await held.waitFor();
  assert.equal(await revised.count(),1);assert.equal(await held.count(),1);assert.equal(await page.locator('#message-text').inputValue(),draft);
  assert.equal(history(phone).slice(reloadAt).every(record=>record.path==='/shared/changes'),true);
  assert.equal(new URL(history(phone)[reloadAt].url).searchParams.get('cursor'),complete.publicReader.cursor);
  assert.equal(phone.records.some(record=>record.method==='POST'||record.path.includes('import-hint')||record.path.startsWith('/relay/owner/')),false);
  assertBrowserContained(phone);assert.equal(h.external,0);
  await writeSyntheticEvidence(phone,'rollback-since-native-replay-reload',{scope:'Fictional original issue history, actual c4 since, browser-free alarm and mobile saved pc2 recovery',
    oldSource:h.oldSource,completedCursor:complete.publicReader.cursor,hints:0,historyReposted:false,draftPreserved:true,immutableReplyPreserved:true,externalCalls:0});
});
