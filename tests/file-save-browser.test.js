import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {launchQualifiedBrowser} from './helpers/relay-conversation-browser-fixture.js';
const ORIGIN='https://file-save.test';
async function setup(t){
 const browser=await launchQualifiedBrowser(t);if(!browser)return;
 t.after(()=>browser.close());const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,acceptDownloads:true});
 await context.route('**/*',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/')return route.fulfill({contentType:'text/html',body:'<html><body><main></main></body></html>'});if(!['/assets/file-save.js','/assets/relay-attachment-content.js'].includes(path))throw Error('Unexpected request '+path);return route.fulfill({contentType:'application/javascript',body:await readFile(new URL('../public'+path,import.meta.url))});});
 const page=await context.newPage();await page.goto(ORIGIN);await page.evaluate(async()=>{
  const {createPrivateAttachmentContent}=await import('/assets/relay-attachment-content.js');window.reads=0;window.calls=[];
  window.content=createPrivateAttachmentContent({document,read:async(item,{signal})=>{reads++;window.signal=signal;return new Promise(resolve=>window.finishRead=()=>resolve(new Blob(['%PDF-1.4\n% synthetic fixture\n%%EOF'],{type:'application/pdf'})));}});
  document.querySelector('main').append(content.row({id:'synthetic-id',name:'Synthetic.pdf',mimeType:'application/pdf',sizeBytes:40}));
 });return page;
}
async function ready(page){await page.getByRole('button',{name:'Save to Files: Synthetic.pdf',exact:true}).click();await page.evaluate(()=>finishRead());await page.getByRole('link',{name:'Download Synthetic.pdf',exact:true}).waitFor();}
test('mobile Relay prepares once, shares on a fresh tap, handles repeat clicks and cancellation',async t=>{
 const page=await setup(t);if(!page)return;await page.evaluate(()=>{
  window.showSaveFilePicker=undefined;Object.defineProperty(navigator,'canShare',{configurable:true,value:()=>true});Object.defineProperty(navigator,'share',{configurable:true,value:({files})=>{calls.push({active:navigator.userActivation.isActive,name:files[0].name,type:files[0].type});return new Promise((resolve,reject)=>{window.acceptShare=resolve;window.cancelShare=()=>reject(new DOMException('cancel','AbortError'));});}});
 });
 const button=page.getByRole('button',{name:'Save to Files: Synthetic.pdf',exact:true});await button.click();await page.evaluate(()=>document.querySelector('button').click());assert.equal(await page.evaluate(()=>reads),1);assert.equal(await page.evaluate(()=>calls.length),0);await page.evaluate(()=>finishRead());await page.getByRole('link',{name:'Open Synthetic.pdf',exact:true}).waitFor();await button.click();await page.evaluate(()=>document.querySelector('button').click());assert.deepEqual(await page.evaluate(()=>calls),[{active:true,name:'Synthetic.pdf',type:'application/pdf'}]);await page.evaluate(()=>cancelShare());await page.getByRole('status').filter({hasText:'Save cancelled'}).waitFor();await button.click();await page.evaluate(()=>acceptShare());await page.getByRole('status').filter({hasText:'Saving there is not confirmed'}).waitFor();assert.equal(await page.evaluate(()=>reads),1);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
});
test('mobile Relay fallback downloads exact synthetic bytes and retains its URL after view disposal',async t=>{
 const page=await setup(t);if(!page)return;await page.evaluate(()=>{window.showSaveFilePicker=undefined;Object.defineProperty(navigator,'canShare',{value:()=>false});window.revoked=[];const original=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=u=>{revoked.push(u);original(u);};});await ready(page);
 await page.getByRole('button',{name:'Save to Files: Synthetic.pdf',exact:true}).click();await page.getByRole('status').filter({hasText:'unavailable'}).waitFor();
 const url=await page.getByRole('link',{name:'Open Synthetic.pdf',exact:true}).getAttribute('href');const waiting=page.waitForEvent('download');await page.getByRole('link',{name:'Download Synthetic.pdf',exact:true}).click();const file=await waiting;assert.equal(file.suggestedFilename(),'Synthetic.pdf');assert.equal((await readFile(await file.path())).toString(),'%PDF-1.4\n% synthetic fixture\n%%EOF');await page.evaluate(()=>content.clear());assert.equal(await page.evaluate(u=>revoked.includes(u),url),false);assert.match(await page.evaluate(async u=>(await fetch(u)).text(),url),/synthetic fixture/);
});
test('closing private content aborts an in-flight read without creating ready-file controls',async t=>{
 const page=await setup(t);if(!page)return;await page.getByRole('button',{name:'Save to Files: Synthetic.pdf',exact:true}).click();await page.evaluate(()=>{content.clear();finishRead();});assert.equal(await page.evaluate(()=>signal.aborted),true);assert.equal(await page.getByRole('link',{name:'Download Synthetic.pdf',exact:true}).isVisible(),false);
});
test('preparation can be cancelled and retried; late bytes never replace the retry',async t=>{
 const page=await setup(t);if(!page)return;const save=page.getByRole('button',{name:'Save to Files: Synthetic.pdf',exact:true});await save.click();await page.evaluate(()=>window.oldRead=finishRead);await page.getByRole('button',{name:'Cancel file preparation',exact:true}).click();assert.equal(await page.evaluate(()=>signal.aborted),true);await save.click();await page.evaluate(()=>oldRead());assert.equal(await page.getByRole('link',{name:'Open Synthetic.pdf',exact:true}).isVisible(),false);await page.evaluate(()=>finishRead());await page.getByRole('link',{name:'Open Synthetic.pdf',exact:true}).waitFor();assert.equal(await page.evaluate(()=>reads),2);
});
test('picker uses the ready-file gesture; duplicate taps do not open a second picker',async t=>{
 const page=await setup(t);if(!page)return;await ready(page);await page.evaluate(()=>{window.showSaveFilePicker=options=>{calls.push({active:navigator.userActivation.isActive,name:options.suggestedName});return new Promise(resolve=>window.pick=()=>resolve({createWritable:async()=>({write:async blob=>{window.written=await blob.text();},close:async()=>{}})}));};});const save=page.getByRole('button',{name:'Save to Files: Synthetic.pdf',exact:true});await save.focus();await page.keyboard.press('Enter');await page.evaluate(()=>document.querySelector('button').click());assert.deepEqual(await page.evaluate(()=>calls),[{active:true,name:'Synthetic.pdf'}]);await page.evaluate(()=>pick());await page.getByRole('status').filter({hasText:'File saved to the location you chose.'}).waitFor();assert.match(await page.evaluate(()=>written),/synthetic fixture/);
});
