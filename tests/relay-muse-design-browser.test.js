import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir} from 'node:fs/promises';
import {createConversationFixture,launchQualifiedBrowser,openConversationPage,closeConversationHarness,conversationMenu,assertBrowserContained,SITE} from './helpers/relay-conversation-browser-fixture.js';
import {hash,random} from '../backend/relay-common.js';

test('Muse uses Relay visual primitives at 390px in public, owner and sign-in states',{timeout:60000},async t=>{
 const browser=await launchQualifiedBrowser(t);if(!browser)return;
 const h=createConversationFixture(t,{env:{RELAY_MAST_ENABLED:'true',RELAY_MAST_TOKEN_SHA256:await hash(random())}}),pages=[];
 const dir=process.env.JARVIS_SCREENSHOT_DIR||'/tmp/muse-relay-design';await mkdir(dir,{recursive:true});
 const metrics=page=>page.evaluate(()=>Object.fromEntries(['.topbar','.conversation-identity .brand','.composer-input','.composer-input textarea','.send-icon','.outgoing .bubble'].map(selector=>{const n=document.querySelector(selector);if(!n)return[selector,null];const s=getComputedStyle(n),b=n.getBoundingClientRect();return[selector,{background:s.backgroundColor,color:s.color,font:s.fontFamily,fontSize:s.fontSize,lineHeight:s.lineHeight,radius:s.borderRadius,padding:s.padding,...(selector.includes('.brand')?{}:{x:b.x,width:b.width})}];})));
 try{
  const owner=await h.pair(await h.oauth());
  for(const path of ['/messages','/mast'])assert.equal((await h.phone(path,{id:crypto.randomUUID(),body:'A quiet moment to think.'},owner.device_token)).status,201);
  const shots={};
  for(const [name,route,privateView] of [['relay-public','/jarvis/',false],['muse-public','/muse/',false],['relay-private','/jarvis/',true],['muse-private','/mast/',true]]){
   const phone=await openConversationPage(browser,h,{owner,clock:false});pages.push(phone);const p=phone.page;await p.goto(SITE+route);
   if(route==='/jarvis/')await conversationMenu(p,privateView?'Owner chat':'Public chat');
   if(privateView)await p.locator('.outgoing .bubble').waitFor();else await p.locator('.composer-input textarea').waitFor();
   await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:dir+'/'+name+'.png',animations:'disabled'});shots[name]=await metrics(p);
   assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   const composer=await p.locator('.composer-input').boundingBox();assert.ok(composer.y>650&&composer.y+composer.height<844,'composer stays at phone bottom');
   await p.locator('#relay-menu-button').click();await p.screenshot({path:dir+'/'+name+'-menu.png',animations:'disabled'});
   const before=p.url();await p.goBack();await p.waitForFunction(()=>!document.querySelector('dialog[open]'));assert.equal(p.url(),before,'phone Back closes the sheet without leaving chat');
   assertBrowserContained(phone);
  }
  for(const mode of ['public','private'])assert.deepEqual(shots['muse-'+mode],shots['relay-'+mode],mode+' uses exact Relay visual primitives');
  for(const [name,route] of [['relay-signin','/jarvis/'],['muse-signin','/mast/']]){
   const phone=await openConversationPage(browser,h,{clock:false});pages.push(phone);await phone.page.goto(SITE+route);
   if(route==='/jarvis/')await conversationMenu(phone.page,'Owner chat');
   await phone.page.locator('input[type=password]').waitFor();await phone.page.screenshot({path:dir+'/'+name+'.png',animations:'disabled'});assertBrowserContained(phone);
  }
 }finally{await closeConversationHarness(browser,h,pages);}
});
