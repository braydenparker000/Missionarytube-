import test from 'node:test';
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {createHmac} from 'node:crypto';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,conversationMenu,assertBrowserContained,writeSyntheticEvidence,
  MUSE_URL,WORKER} from './helpers/relay-conversation-browser-fixture.js';
import {sharedStore} from '../shared.js';
import {COMMENT_URL,ISSUE_URL} from '../publications.js';
import {relaySubscribe,drainRelayOutbox} from '../relay-events.js';
import {PUBLIC_RESULT_EVENT} from '../public-coordination-tools.js';
import {RELAY_INBOX} from '../relay-common.js';
import {MUSE_PREFIX} from '../../frontend/assets/channels.js';

test('fixed-comment hint delivers through durable import, separate signed notification, exact MCP read and existing mobile conversation within the five-minute cooldown', {timeout:120000}, async t=>{
  const browser=await launchQualifiedBrowser(t);if(!browser)return;
  const h=createConversationFixture(t),phones=[];t.after(()=>closeConversationHarness(browser,h,phones));
  const requestId=crypto.randomUUID(),holdId=crypto.randomUUID();
  sharedStore(h.ctx,'/internal/shared/message',{id:requestId,body:MUSE_PREFIX+'Fictional hint-to-final request'});
  sharedStore(h.ctx,'/internal/shared/reply',{id:holdId,replyTo:requestId,body:'Fictional stale hold: awaiting source links.'});
  const phone=await openConversationPage(browser,h);phones.push(phone);const {page}=phone;
  await page.goto(MUSE_URL);await page.waitForFunction(()=>!document.querySelector('#refresh').disabled);
  const cooldown=h.rows("SELECT value FROM shared_meta WHERE key='publisher-next-attempt'")[0].value;
  assert.ok(Number(JSON.parse(cooldown))>Date.now(),'Normal reconciler is currently throttled');
  const publication={schema:'jarvis-coordination-v2',eventId:crypto.randomUUID(),requestId,attemptId:crypto.randomUUID(),stage:'final',resultVersion:1,
    body:'Fictional hinted final with corrected source links.',artifacts:[{id:crypto.randomUUID(),revision:1,label:'Fictional reviewed source',url:'https://example.test/hinted-source'}]};
  let githubFetches=0;t.mock.method(globalThis,'fetch',async(url,init)=>{
    assert.equal(url,COMMENT_URL+9001);assert.equal(init.redirect,'manual');assert.equal(init.headers.Authorization,undefined);githubFetches++;
    return Response.json({id:9001,user:{id:183016859},issue_url:ISSUE_URL,body:JSON.stringify(publication),created_at:'2026-10-01T12:00:00Z',updated_at:'2026-10-01T12:00:00Z'});
  });
  const auth=await h.oauth('relay:read relay:events'),secret='whsec_'+Buffer.alloc(32,11).toString('base64'),notifications=[];
  const receiver=async(url,init)=>{
    assert.equal(url,'https://fixture-lucy.example.test/result');const data=JSON.parse(init.body);
    assert.equal(init.headers['webhook-signature'],'v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${init.headers['webhook-id']}.${init.headers['webhook-timestamp']}.${init.body}`).digest('base64'));
    if(data.challenge)return Response.json({challenge:data.challenge});notifications.push(data);return new Response(null,{status:204});
  };
  await relaySubscribe(h.ctx,auth,{name:PUBLIC_RESULT_EVENT,arguments:{inbox_id:RELAY_INBOX,request_id:requestId},delivery:{mode:'webhook',url:'https://fixture-lucy.example.test/result',secret},cursor:null},h.fixture.env,receiver);
  const started=performance.now();
  const receipt=await page.evaluate(async origin=>{const response=await fetch(origin+'/shared/import-hint',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commentId:9001})});return {status:response.status,data:await response.json()};},WORKER);
  const importedMs=performance.now()-started;assert.equal(receipt.status,200);assert.equal(receipt.data.status,'imported');
  await drainRelayOutbox(h.ctx,h.fixture.env,receiver);const callbackAcceptedMs=performance.now()-started;
  assert.equal(notifications.length,1);assert.equal(notifications[0].data.should_execute,false);
  const exact=await h.rpc(auth,'relay_read_public_result',{inbox_id:RELAY_INBOX,message_id:notifications[0].data.message_id});
  assert.equal(exact.events.at(-1).eventId,publication.eventId);assert.equal(exact.reply.id,holdId);const exactReadMs=performance.now()-started;
  await conversationMenu(page,'Refresh inbox');
  const report=page.locator(`[data-message-id="coordination:${publication.eventId}"]`);await report.waitFor();
  const renderedMs=performance.now()-started;assert.equal(await report.getByRole('link',{name:'Fictional reviewed source · revision 1'}).getAttribute('href'),publication.artifacts[0].url);
  assert.equal(await report.getByText('Public report · private execution unverified.',{exact:true}).isVisible(),true);
  assert.match(await page.locator(`[data-message-id="${holdId}"]`).textContent(),/Fictional stale hold/);
  assert.equal(githubFetches,1);assert.equal(h.rows("SELECT value FROM shared_meta WHERE key='publisher-next-attempt'")[0].value,cooldown);
  await page.reload();await report.waitFor();assert.equal(await report.count(),1);
  assert.equal(await report.getByText('Public report · private execution unverified.',{exact:true}).isVisible(),true);
  const retry=await page.evaluate(async origin=>{const response=await fetch(origin+'/shared/import-hint',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"commentId":9001}'});return response.status;},WORKER);
  assert.equal(retry,200);assert.equal(githubFetches,1);await drainRelayOutbox(h.ctx,h.fixture.env,receiver);assert.equal(notifications.length,1);
  assert.equal(phone.records.filter(record=>record.path==='/shared/messages'&&record.method==='POST').length,0);
  assert.equal(phone.records.some(record=>record.path.startsWith('/relay/owner/')),false);assertBrowserContained(phone);
  await writeSyntheticEvidence(phone,'communication-hint-to-render-390x844',{scope:'Synthetic local GitHub/Worker/SQLite/MCP/signed-callback/browser; not live Lucy/Muse host latency',
    importedMs,callbackAcceptedMs,exactReadMs,renderedMs,githubFetches,newExecutionRequests:0,cooldownBypassedWithoutChangingCadence:true});
});
