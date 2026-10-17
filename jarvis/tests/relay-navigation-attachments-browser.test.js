import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,conversationMenu,closeConversationHarness,assertBrowserContained,assertNoPrivatePersistence,writeSyntheticEvidence,RELAY_URL,OWNER_KEY} from './helpers/relay-conversation-browser-fixture.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO1sAAAAASUVORK5CYII=','base64');

test('side navigation keeps channel access, focus and drafts while plus opens a separate gated file picker',{timeout:120000},async t=>{
 const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[];
 try{
  const auth=await h.oauth(),owner=await h.pair(auth);
  for(const size of [{width:390,height:844},{width:1280,height:900}]){
   const phone=await openConversationPage(browser,h,{owner,clock:false,...size});pages.push(phone);const page=phone.page;
   // This scenario verifies an older/disabled service even when the paired backend supports files.
   phone.rule(r=>r.method==='GET'&&r.path==='/relay/owner/session',async({forward})=>{const response=await forward();if(!response.ok)return response;return Response.json({...await response.json(),attachments_enabled:false},{status:response.status,headers:response.headers});},100);
   await page.goto(RELAY_URL);const composer=page.locator('#relay-owner-message-text');await composer.waitFor();await composer.fill('Fictional attachment draft, kept unsent.');assert.equal(await page.locator('#relay-scope-toggle').count(),0);
   await page.locator('#relay-menu-button').click();let dialog=page.getByRole('dialog');await dialog.waitFor();await dialog.evaluate(node=>Promise.allSettled(node.getAnimations().map(animation=>animation.finished)));const bounds=await dialog.boundingBox();assert.equal(bounds.x,0);assert.equal(bounds.y,0);assert.ok(bounds.width<=340&&bounds.width<size.width&&bounds.height>=size.height-1);assert.match(await dialog.innerText(),/Private owner chat/);await writeSyntheticEvidence(phone,'relay-side-nav-'+size.width,{bounds});
   for(let i=0;i<10;i++){await page.keyboard.press('Tab');assert.equal(await dialog.evaluate(node=>node.contains(document.activeElement)),true);}
   await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.activeElement.id),'relay-menu-button');assert.equal(await composer.inputValue(),'Fictional attachment draft, kept unsent.');
   await page.locator('#relay-compose-menu').click();dialog=page.getByRole('dialog',{name:'Attachments',exact:true});await dialog.waitFor();assert.equal(await page.locator('dialog.relay-navigation-sheet').count(),0);assert.match(await dialog.innerText(),/not available yet/);
   await dialog.getByLabel('Choose images',{exact:true}).setInputFiles({name:'fictional-photo.png',mimeType:'image/png',buffer:png});await dialog.locator('img[alt="Preview of fictional-photo.png"]').waitFor();
   await dialog.getByLabel('Choose files',{exact:true}).setInputFiles({name:'<img onerror=alert(1)>.txt',mimeType:'text/plain',buffer:Buffer.from('Fictional attachment only.')});assert.equal(await dialog.locator('.relay-attachment-item').count(),2);assert.equal(await dialog.locator('img').count(),1);assert.match(await dialog.innerText(),/<img onerror=alert\(1\)>.txt/);await writeSyntheticEvidence(phone,'relay-attachments-'+size.width,{uploadAvailable:false});
   await page.goBack();await dialog.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.activeElement.id),'relay-compose-menu');assert.equal(await composer.inputValue(),'Fictional attachment draft, kept unsent.');assert.equal(await page.locator('.relay-attachment-chip').count(),2);
   const writes=phone.records.filter(r=>r.method==='POST'&&r.path.endsWith('/messages')).length;
   await page.getByRole('button',{name:'Send private message',exact:true}).click();await page.getByRole('dialog',{name:'Attachments',exact:true}).waitFor();assert.equal(phone.records.filter(r=>r.method==='POST'&&r.path.endsWith('/messages')).length,writes,'Unavailable transport cannot silently send text without its files');await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
   await conversationMenu(page,'Public chat');await page.locator('#message-text').waitFor();assert.equal(await page.locator('.relay-attachment-chip').count(),0,'Private files never become public draft attachments');assert.equal(await page.locator('#relay-compose-menu').isVisible(),false,'Public chat remains text only');
   await conversationMenu(page,'Owner chat');await composer.waitFor();assert.equal(await page.locator('.relay-attachment-chip').count(),2);assert.equal(await composer.inputValue(),'Fictional attachment draft, kept unsent.');
   await page.locator('.relay-attachment-summary').getByRole('button',{name:'Remove fictional-photo.png',exact:true}).click();await page.locator('.relay-attachment-summary').getByRole('button',{name:'Remove <img onerror=alert(1)>.txt',exact:true}).click();assert.equal(await page.locator('.relay-attachment-summary').count(),0);
   assert.equal(phone.records.some(r=>r.path.startsWith('/relay/')&&/attachment|upload/.test(r.path)),false,'Selection has no upload network effect');await assertNoPrivatePersistence(page,['fictional-photo.png','<img onerror=alert(1)>.txt'],{draft:'Fictional attachment draft, kept unsent.'});assertBrowserContained(phone);
  }
 }finally{await closeConversationHarness(browser,h,pages);}
});

test('picker selections survive Close and stale Forward safely but clear after owner access loss',{timeout:120000},async t=>{
 const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[];
 try{
  const owner=await h.pair(await h.oauth()),phone=await openConversationPage(browser,h,{owner,clock:false,width:320,height:568});pages.push(phone);const page=phone.page;await page.goto(RELAY_URL);await page.locator('#relay-owner-message-text').waitFor();await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('#relay-compose-menu').click();let dialog=page.getByRole('dialog');await dialog.getByLabel('Choose files',{exact:true}).setInputFiles({name:'private-fixture.txt',mimeType:'text/plain',buffer:Buffer.from('Private fixture')});await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'detached'});await page.goForward();assert.equal(await page.getByRole('dialog').count(),0);await page.locator('#relay-compose-menu').click();await page.getByRole('dialog').getByRole('button',{name:'Remove private-fixture.txt',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});await page.evaluate(key=>{localStorage.removeItem(key);dispatchEvent(new StorageEvent('storage',{key,newValue:null,storageArea:localStorage}));},OWNER_KEY);await page.waitForFunction(()=>!document.querySelector('.relay-attachment-summary'));assert.equal((await page.locator('body').innerText()).includes('private-fixture.txt'),false);assertBrowserContained(phone);
 }finally{await closeConversationHarness(browser,h,pages);}
});


test('a delayed private file chooser cannot attach its file to a newly selected public channel',{timeout:120000},async t=>{
 const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[];
 try{const owner=await h.pair(await h.oauth()),phone=await openConversationPage(browser,h,{owner,clock:false});pages.push(phone);const page=phone.page;await page.goto(RELAY_URL);await page.locator('#relay-owner-message-text').waitFor();await page.locator('#relay-compose-menu').click();await page.getByRole('dialog').getByLabel('Choose files',{exact:true}).evaluate(node=>window.stalePrivatePicker=node);await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});await conversationMenu(page,'Public chat');await page.locator('#message-text').waitFor();await page.evaluate(()=>{const data=new DataTransfer();data.items.add(new File(['Synthetic private contents'],'late-private-file.txt',{type:'text/plain'}));stalePrivatePicker.files=data.files;stalePrivatePicker.dispatchEvent(new Event('change'));});assert.equal(await page.locator('.relay-attachment-chip').count(),0);await conversationMenu(page,'Owner chat');assert.equal(await page.locator('.relay-attachment-chip').count(),0);assertBrowserContained(phone);
 }finally{await closeConversationHarness(browser,h,pages);}
});

for(const boundary of ['channel change','access loss'])test(`held multi-file preview cannot continue after ${boundary}`,{timeout:120000},async t=>{
 const browser=await launchQualifiedBrowser(t);if(!browser)return;const h=createConversationFixture(t),pages=[];
 try{const owner=await h.pair(await h.oauth()),phone=await openConversationPage(browser,h,{owner,clock:false});pages.push(phone);const page=phone.page;await page.goto(RELAY_URL);await page.locator('#relay-owner-message-text').waitFor();
  await page.evaluate(()=>{const original=FileReader.prototype.readAsDataURL;FileReader.prototype.readAsDataURL=function(file){(window.heldPreviews??=[]).push(()=>original.call(this,file));window.releaseHeldPreview=()=>heldPreviews.splice(0).forEach(release=>release());};});
  await page.locator('#relay-compose-menu').click();await page.getByRole('dialog').getByLabel('Choose images',{exact:true}).setInputFiles([{name:'held-first.png',mimeType:'image/png',buffer:png},{name:'held-second.png',mimeType:'image/png',buffer:png}]);await page.getByRole('dialog').getByRole('button',{name:'Remove held-first.png',exact:true}).waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'detached'});
  if(boundary==='channel change'){await conversationMenu(page,'Public chat');await page.locator('#message-text').waitFor();}else{await page.evaluate(key=>{localStorage.removeItem(key);dispatchEvent(new StorageEvent('storage',{key,newValue:null,storageArea:localStorage}));},OWNER_KEY);await page.waitForFunction(()=>!document.querySelector('.relay-attachment-summary'));}
  await page.evaluate(async()=>{releaseHeldPreview();await new Promise(resolve=>setTimeout(resolve,100));});assert.equal(await page.locator('.relay-attachment-chip').count(),0);
  if(boundary==='channel change'){await conversationMenu(page,'Owner chat');await page.locator('#relay-owner-message-text').waitFor();assert.equal(await page.locator('.relay-attachment-chip').count(),2);assert.equal(await page.getByRole('button',{name:'Remove held-second.png',exact:true}).count(),1);}
  assertBrowserContained(phone);
 }finally{await closeConversationHarness(browser,h,pages);}
});
