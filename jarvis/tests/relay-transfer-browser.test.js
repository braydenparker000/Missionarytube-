import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {chromium} from 'playwright-core';
import {createConversationFixture,openConversationPage,assertBrowserContained,closeConversationHarness,SITE,RELAY_URL,OWNER_KEY} from './helpers/relay-conversation-browser-fixture.js';
import {OWNER_DRAFT_KEY} from '../public/assets/relay-draft-store.js';
import {RELAY_TRANSFER_KEY,LEGACY_TRANSFER_KEY,quickAITransfer} from '../public/assets/relay-transfer.js';
const chrome=process.env.JARVIS_CHROME;
const question='Synthetic question to continue',answer='Synthetic useful answer',sourceDraft='Unsent Quick AI question';
const existingPrivate='An existing private draft',existingPublic='An existing public draft';
const quickHistory={version:1,active:'chat',chats:[{id:'chat',title:'Synthetic saved chat',draft:sourceDraft,provider:'gemini',search:false,messages:[
  {id:'question',role:'user',content:question,createdAt:'2026-10-09T00:00:00Z',attachments:[]},{id:'answer',role:'assistant',content:answer,createdAt:'2026-10-09T00:00:01Z',status:'complete',attachments:[]}]}]};
const writes=phone=>phone.records.filter(record=>record.method==='POST'&&['/relay/owner/messages','/relay/owner/jobs','/shared/messages','/v1/messages'].includes(record.path));

test('Quick AI transfers use explicit private/public destinations, retain drafts and never send on navigation',
  {skip:!chrome||!existsSync(chrome),timeout:120000},async t=>{
  const browser=await chromium.launch({executablePath:chrome,headless:true,args:['--no-sandbox']});
  const h=createConversationFixture(t),phones=[];t.after(()=>closeConversationHarness(browser,h,phones));
  const auth=await h.oauth(),owner=await h.pair(auth);
  async function open({remember=true,privateDraft=existingPrivate}={}){
    const phone=await openConversationPage(browser,h,{owner:remember?owner:undefined});phones.push(phone);
    phone.page.on('pageerror',error=>t.diagnostic('Transfer fixture browser error: '+error.message));
    // Seed before the first app load. Quick AI saves its live in-memory state on
    // pagehide, so writing external state just before reload is not a real setup.
    const script=await phone.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
      if(location.origin===${JSON.stringify(SITE)}){
        localStorage.setItem('jarvis.quick-ai.v1',${JSON.stringify(JSON.stringify(quickHistory))});
        ${privateDraft?`sessionStorage.setItem(${JSON.stringify(OWNER_DRAFT_KEY)},${JSON.stringify(JSON.stringify({body:privateDraft}))});`:''}
        localStorage.setItem('jarvis.shared.v1',${JSON.stringify(JSON.stringify({version:1,messages:[],posts:[],outbox:[],composer:existingPublic,syncedAt:null}))});
      }`});
    await phone.page.goto(SITE+'/quick-ai/');await phone.cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:script.identifier});
    await phone.page.locator('.reply-menu').waitFor();assert.deepEqual(phone.errors,[]);return phone;
  }
  async function choose(phone,destination){
    const {page}=phone;await page.locator('.reply-menu').click();await page.getByRole('button',{name:'Continue in Relay',exact:true}).click();
    await page.getByRole('heading',{name:'Choose Relay destination'}).waitFor();
    assert.equal(page.url(),SITE+'/quick-ai/','Choosing visibility must precede navigation');
    assert.deepEqual(writes(phone),[]);
    await page.getByRole('button',{name:destination==='owner'?'Owner chat · private':'Public Relay · shared',exact:true}).click();
    await page.waitForURL(RELAY_URL);
  }
  function contained(phone){
    assertBrowserContained(phone);
    for(const record of phone.records){assert.equal(record.url.includes(owner.device_token),false);
      if(!record.path.startsWith('/relay/owner/'))assert.equal(record.headers.authorization,undefined);}
  }
  for(const destination of ['owner','public'])await t.test(`${destination} choice overrides remembered mode and preserves independent existing/source drafts through reload`,async()=>{
    const phone=await open(),{page}=phone;await choose(phone,destination);
    const input=page.locator(destination==='owner'?'#relay-owner-message-text':'#message-text');await input.waitFor();
    const expected=(destination==='owner'?existingPrivate:existingPublic)+'\n\n'+quickAITransfer(question,answer,destination).body;
    assert.equal(await input.inputValue(),expected);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),RELAY_TRANSFER_KEY),null);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis.quick-ai.v1')).chats[0].draft),sourceDraft);
    const publicDraft=await page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis.shared.v1')).composer);
    assert.equal(publicDraft,destination==='owner'?existingPublic:expected);
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key))?.body,OWNER_DRAFT_KEY),destination==='owner'?expected:existingPrivate);
    await page.reload();await input.waitFor();assert.equal(await input.inputValue(),expected);assert.deepEqual(writes(phone),[]);contained(phone);
  });
  await t.test('private choice from public mode stays private while sign-in is required',async()=>{
    const phone=await open({remember:false}),{page}=phone;await choose(phone,'owner');
    await page.getByText('Your unsent private draft is kept in this tab. Sign in to review it.',{exact:true}).waitFor();
    assert.equal(await page.locator('#message-text').count(),0);assert.equal(await page.locator('#relay-owner-message-text').count(),0);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis.shared.v1')).composer),existingPublic);
    assert.deepEqual(writes(phone),[]);contained(phone);
  });
  await t.test('interrupted navigation leaves the requested private transfer pending; eventual adoption occurs exactly once',async()=>{
    const phone=await open(),{page}=phone,incoming=quickAITransfer(question,answer,'owner');
    await page.evaluate(async transfer=>(await import('/assets/relay-transfer.js')).createRelayTransferStore().stage(transfer),incoming);
    await page.goto(SITE+'/quick-ai/');await page.reload();
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).pending.destination,RELAY_TRANSFER_KEY),'owner');
    assert.deepEqual(writes(phone),[]);await page.goto(RELAY_URL);await page.locator('#relay-owner-message-text').waitFor();
    const expected=existingPrivate+'\n\n'+incoming.body;assert.equal(await page.locator('#relay-owner-message-text').inputValue(),expected);
    await page.reload();await page.locator('#relay-owner-message-text').waitFor();assert.equal(await page.locator('#relay-owner-message-text').inputValue(),expected);
    assert.deepEqual(writes(phone),[]);contained(phone);
  });
  await t.test('legacy transfer requires a destination and an oversized public draft remains untouched and recoverable',async()=>{
    const phone=await open(),{page}=phone;
    await page.evaluate(key=>sessionStorage.setItem(key,'Legacy retained draft'),LEGACY_TRANSFER_KEY);
    await page.goto(RELAY_URL);await page.locator('#relay-owner-message-text').waitFor();assert.equal(await page.locator('#relay-owner-message-text').inputValue(),existingPrivate);
    await page.getByRole('button',{name:'Choose destination',exact:true}).click();await page.getByRole('button',{name:'Public Relay · shared',exact:true}).click();
    await page.locator('#message-text').waitFor();assert.equal(await page.locator('#message-text').inputValue(),existingPublic+'\n\nLegacy retained draft');
    await page.locator('#message-text').fill('x'.repeat(3950));
    const incoming=quickAITransfer(question,answer,'public');await page.evaluate(async transfer=>(await import('/assets/relay-transfer.js')).createRelayTransferStore().stage(transfer),incoming);
    await page.reload();await page.locator('#message-text').waitFor();assert.equal(await page.locator('#message-text').inputValue(),'x'.repeat(3950));
    assert.match(await page.locator('#relay-transfer-notice').textContent(),/exceed the message limit/);
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).pending.body,RELAY_TRANSFER_KEY),incoming.body);
    await page.locator('#message-text').fill('Shortened existing draft');await page.getByRole('button',{name:'Review public draft',exact:true}).click();
    assert.equal(await page.locator('#message-text').inputValue(),'Shortened existing draft\n\n'+incoming.body);assert.deepEqual(writes(phone),[]);contained(phone);
  });
  for(const destination of ['owner','public'])await t.test(`${destination} edited interrupted transfer needs explicit dismissal; cancellation or changed journal preserves every draft`,async()=>{
    const phone=await open(),{page}=phone,incoming=quickAITransfer(question,answer,destination),edited='User edited '+destination+' draft during recovery';
    await page.evaluate(async({incoming,edited,existingPrivate,existingPublic,OWNER_DRAFT_KEY})=>{
      const manager=(await import('/assets/relay-transfer.js')).createRelayTransferStore();manager.stage(incoming);
      manager.apply({destination:incoming.destination,draft:incoming.destination==='owner'?existingPrivate:existingPublic,saveDraft:()=>false});
      if(incoming.destination==='owner')sessionStorage.setItem(OWNER_DRAFT_KEY,JSON.stringify({body:edited}));
      else{const shared=JSON.parse(localStorage.getItem('jarvis.shared.v1'));shared.composer=edited;localStorage.setItem('jarvis.shared.v1',JSON.stringify(shared));}
    },{incoming,edited,existingPrivate,existingPublic,OWNER_DRAFT_KEY});
    await page.goto(RELAY_URL);
    const input=page.locator(destination==='owner'?'#relay-owner-message-text':'#message-text');await input.waitFor();assert.equal(await input.inputValue(),edited);
    assert.match(await page.locator('#relay-transfer-notice').textContent(),/draft changed/);
    await page.locator('#relay-transfer-notice').getByRole('button',{name:'Dismiss saved transfer',exact:true}).click();
    await page.getByRole('button',{name:'Keep saved transfer',exact:true}).click();
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).pending.id,RELAY_TRANSFER_KEY),incoming.id);
    assert.equal(await input.inputValue(),edited);assert.deepEqual(writes(phone),[]);
    await page.locator('#relay-transfer-notice').getByRole('button',{name:'Dismiss saved transfer',exact:true}).click();
    await page.evaluate(key=>{const record=JSON.parse(sessionStorage.getItem(key));record.application=null;sessionStorage.setItem(key,JSON.stringify(record));},RELAY_TRANSFER_KEY);
    await page.locator('dialog.app-sheet').getByRole('button',{name:'Dismiss saved transfer',exact:true}).click();
    assert.match(await page.locator('#relay-transfer-notice').textContent(),/saved transfer changed/);
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).pending.id,RELAY_TRANSFER_KEY),incoming.id);assert.equal(await input.inputValue(),edited);
    await page.locator('#relay-transfer-notice').getByRole('button',{name:'Dismiss saved transfer',exact:true}).click();
    await page.locator('dialog.app-sheet').getByRole('button',{name:'Dismiss saved transfer',exact:true}).click();
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),RELAY_TRANSFER_KEY),null);assert.equal(await input.inputValue(),edited);
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).body,OWNER_DRAFT_KEY),destination==='owner'?edited:existingPrivate);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis.shared.v1')).composer),destination==='public'?edited:existingPublic);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis.quick-ai.v1')).chats[0].draft),sourceDraft);
    assert.deepEqual(writes(phone),[]);contained(phone);
    await page.evaluate(async incoming=>(await import('/assets/relay-transfer.js')).createRelayTransferStore().stage(incoming),quickAITransfer(question,'Next answer',destination));
    assert.deepEqual(writes(phone),[]);
  });
  for(const failure of ['tab','aggregate'])await t.test(`a real failed public ${failure} write keeps transfer actions reachable and reload recovers exactly once`,async()=>{
    const phone=await open(),{page}=phone,incoming=quickAITransfer(question,answer,'public');
    await page.evaluate(async incoming=>(await import('/assets/relay-transfer.js')).createRelayTransferStore().stage(incoming),incoming);
    const fault=await phone.cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`
      if(location.origin===${JSON.stringify(SITE)}){
        const original=Storage.prototype.setItem;
        Storage.prototype.setItem=function(key,value){
          if(!window.__publicTransferWriteFailed&&key===${JSON.stringify(failure==='tab'?'jarvis.shared.v1.composer.v1':'jarvis.shared.v1')}
              &&(key==='jarvis.shared.v1'?JSON.parse(value).composer:String(value)).includes(${JSON.stringify(incoming.body.slice(0,40))})){
            window.__publicTransferWriteFailed=true;throw new DOMException('Synthetic one-time draft storage failure','QuotaExceededError');
          }
          return original.call(this,key,value);
        };
      }`});
    await page.goto(RELAY_URL);await phone.cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:fault.identifier});
    await page.getByRole('heading',{name:'Unable to save on this device',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.__publicTransferWriteFailed),true);
    assert.equal(await page.locator('#message-text').count(),0);
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).pending.id,RELAY_TRANSFER_KEY),incoming.id);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis.shared.v1')).composer),existingPublic);
    await page.getByRole('button',{name:'Copy incoming draft',exact:true}).click();
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).pending.id,RELAY_TRANSFER_KEY),incoming.id);
    await page.locator('#relay-transfer-notice').getByRole('button',{name:'Dismiss saved transfer',exact:true}).click();
    await page.getByRole('button',{name:'Keep saved transfer',exact:true}).click();
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).pending.id,RELAY_TRANSFER_KEY),incoming.id);assert.deepEqual(writes(phone),[]);
    await page.reload();await page.locator('#message-text').waitFor();
    const expected=existingPublic+'\n\n'+incoming.body;assert.equal(await page.locator('#message-text').inputValue(),expected);
    assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),RELAY_TRANSFER_KEY),null);
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).body,OWNER_DRAFT_KEY),existingPrivate);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis.quick-ai.v1')).chats[0].draft),sourceDraft);
    assert.deepEqual(writes(phone),[]);contained(phone);
  });
  await t.test('expired owner access retains the transfer and existing draft through reload and genuine synthetic re-pairing; sending still requires a click',async()=>{
    const phone=await open(),{page}=phone;
    h.ctx.storage.sql.exec('UPDATE relay_owner_sessions SET expires_ms=? WHERE device_id=?',Date.now()-1,owner.device.id);
    await choose(phone,'owner');await page.waitForFunction(key=>localStorage.getItem(key)===null,OWNER_KEY);
    await page.getByText('Your unsent private draft is kept in this tab. Sign in to review it.',{exact:true}).waitFor();
    const expected=existingPrivate+'\n\n'+quickAITransfer(question,answer,'owner').body;
    assert.equal(await page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)).body,OWNER_DRAFT_KEY),expected);
    assert.equal(await page.locator('#message-text').count(),0);assert.deepEqual(writes(phone),[]);
    await page.reload();await page.getByText('Your unsent private draft is kept in this tab. Sign in to review it.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Connect this phone',exact:true}).click();
    await page.locator('#relay-owner-label').fill('Synthetic recovered transfer phone');
    await page.getByRole('button',{name:'Create pairing code',exact:true}).click();await page.locator('.relay-owner-code').waitFor();
    const code=await page.locator('.relay-owner-code').textContent();
    const inspected=await h.rpc(auth,'relay_owner_pairing_inspect',{code});
    await h.rpc(auth,'relay_owner_pairing_approve',{request_id:inspected.request_id,code,access_days:365,confirm:true});
    await page.getByRole('button',{name:'Check approval',exact:true}).click();await page.locator('#relay-owner-message-text').waitFor();
    assert.equal(await page.locator('#relay-owner-message-text').inputValue(),expected);assert.deepEqual(writes(phone),[]);contained(phone);
    await page.locator('#relay-owner-message-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('#relay-owner-message-text')?.value==='');
    assert.equal(writes(phone).length,1);assert.equal(writes(phone)[0].path,'/relay/owner/messages');
    assert.equal(JSON.parse(writes(phone)[0].body).body,expected);assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),OWNER_DRAFT_KEY),null);
    assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('jarvis.shared.v1')).composer),existingPublic);contained(phone);
  });
});
