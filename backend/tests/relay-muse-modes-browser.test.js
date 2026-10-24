import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,cp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,assertBrowserContained,SITE} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../relay-common.js';

test('Muse phone: one launcher, explicit mode switch, owner auth and isolated drafts/history',{timeout:60000},async t=>{
 const browser=await launchQualifiedBrowser(t);if(!browser)return;
 const token=random(),h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(token)}}),pages=[];
 try{
  // Hold the actual public module at startup while its HTML is already visible.
  // This deterministically covers the early-input race exposed by animated navigation.
  const delayedRoot=await mkdtemp(join(tmpdir(),'muse-startup-'));t.after(()=>rm(delayedRoot,{recursive:true,force:true}));
  await cp(process.env.PRIVATE_WORKSPACE_ROOT||fileURLToPath(new URL('../../frontend/',import.meta.url)),delayedRoot,{recursive:true});
  const museModule=join(delayedRoot,'assets/muse.js');
  await writeFile(museModule,"if(!sessionStorage.getItem('fixture.muse-started'))await new Promise(resolve=>{window.releaseMuseStartup=()=>{sessionStorage.setItem('fixture.muse-started','1');resolve();};});\n"+await readFile(museModule,'utf8'));
  const signedOut=await openConversationPage(browser,h,{clock:false,root:delayedRoot});pages.push(signedOut);
  let p=signedOut.page;await p.goto(SITE+'/');
  assert.equal(await p.locator('a[href="/mast/"]').count(),0);
  // The hub's Chats tile opens /chats/; the classic workspace is opened directly.
  await p.goto(SITE+'/private/');
  await p.locator('#open-drawer').click();
  await p.getByRole('link',{name:'Public Muse',exact:true}).click();
  await p.waitForURL(SITE+'/muse/',{waitUntil:'commit'});
  await p.waitForFunction(()=>typeof window.releaseMuseStartup==='function');
  assert.equal(await p.locator('#prompt').isDisabled(),true,'public draft cannot be edited before initialization');
  assert.equal(await p.locator('#send').isDisabled(),true,'public draft cannot be sent before initialization');
  await p.evaluate(()=>window.releaseMuseStartup());
  await p.waitForFunction(()=>{const input=document.querySelector('#prompt'),form=document.querySelector('#composer');return location.pathname==='/muse/'&&input&&!input.disabled&&typeof input.oninput==='function'&&typeof form?.onsubmit==='function';});
  await p.locator('#prompt').fill('Synthetic public draft');
  await p.waitForFunction(()=>sessionStorage.getItem('jarvis.muse.v1.composer.v1')==='Synthetic public draft'&&JSON.parse(localStorage.getItem('jarvis.muse.v1')).composer==='Synthetic public draft');
  await p.getByRole('button',{name:'Open Muse menu',exact:true}).click();
  await p.getByRole('button',{name:'Chats',exact:true}).click();
  await p.getByRole('button',{name:'Private',exact:true}).click();await p.waitForURL(SITE+'/mast/');
  await p.locator('#login:not([hidden])').waitFor();assert.ok(await p.locator('#composer').isHidden());
  assert.equal(await p.locator('#message').inputValue(),'');
  assert.ok(!signedOut.records.some(r=>r.path.startsWith('/relay/owner/mast')));
  await p.getByRole('button',{name:'Open Muse menu',exact:true}).click();
  await p.getByRole('button',{name:'Chats',exact:true}).click();
  await p.getByRole('button',{name:'Public',exact:true}).click();await p.waitForURL(SITE+'/muse/');
  await p.waitForFunction(()=>document.querySelector('#prompt')?.value==='Synthetic public draft');
  assert.equal(await p.locator('#prompt').inputValue(),'Synthetic public draft');
  const owner=await h.pair(await h.oauth());
  await h.phone('/mast',{id:crypto.randomUUID(),body:'Synthetic PRIVATE history'},owner.device_token);
  const phone=await openConversationPage(browser,h,{owner,clock:false,...(process.env.PRIVATE_WORKSPACE_ROOT?{root:process.env.PRIVATE_WORKSPACE_ROOT}:{})});pages.push(phone);p=phone.page;
  await p.goto(SITE+'/mast/');await p.getByText('Synthetic PRIVATE history',{exact:true}).waitFor();
  await p.locator('#message').fill('Synthetic PRIVATE draft');
  const evidence=process.env.JARVIS_SCREENSHOT_DIR||'/tmp/muse-modes-evidence';await mkdir(evidence,{recursive:true});
  await p.getByRole('button',{name:'Open Muse menu',exact:true}).click();
  await p.getByRole('button',{name:'Chats',exact:true}).click();
  await p.screenshot({path:evidence+'/private-menu-390.png'});
  await p.getByRole('button',{name:'Public',exact:true}).click();await p.waitForURL(SITE+'/muse/');
  await p.locator('#prompt').waitFor();assert.equal(await p.locator('#prompt').inputValue(),'');
  assert.ok(!(await p.locator('body').innerText()).includes('Synthetic PRIVATE'));
  await p.getByRole('button',{name:'Open Muse menu',exact:true}).click();
  await p.getByRole('button',{name:'Chats',exact:true}).click();
  await p.screenshot({path:evidence+'/public-menu-390.png'});
  await p.getByRole('button',{name:'Private',exact:true}).click();await p.waitForURL(SITE+'/mast/');
  await p.locator('#composer:not([hidden])').waitFor();assert.equal(await p.locator('#message').inputValue(),'Synthetic PRIVATE draft');
  assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal(h.rows('SELECT COUNT(*) AS n FROM relay_mast_entries')[0].n,1);
  assert.ok(phone.records.every(r=>r.method!=='POST'||!r.path.startsWith('/shared/')));
  for(const page of pages)assertBrowserContained(page);
 }finally{await closeConversationHarness(browser,h,pages);}
});
