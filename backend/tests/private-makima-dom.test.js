import test from 'node:test';
import assert from 'node:assert/strict';
import {renderMakima} from '../../frontend/assets/private-makima.js';
class Element {
 constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.value='';this.textContent='';this.listeners={};this.hidden=false;}
 append(...items){for(const item of items){this.children.push(item);item.parent=this;}}
 replaceChildren(...items){this.children=[];this.append(...items);}
 setAttribute(k,v){this[k]=v;}
 addEventListener(k,fn){this.listeners[k]=fn;}
 querySelectorAll(selector){const nodes=this.children.flatMap(c=>[c,...c.querySelectorAll(selector)]);return nodes.filter(c=>c.tagName===selector.toUpperCase());}
 querySelector(){return null;}
 insertBefore(item,before){this.children.splice(this.children.indexOf(before),0,item);item.parent=this;}
 focus(){} scrollIntoView(){} remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);}
}
const find=(root,predicate)=>[root,...root.children.flatMap(c=>all(c))].find(predicate);
const all=root=>[root,...root.children.flatMap(all)];
const tick=()=>new Promise(r=>setImmediate(r));

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const entry={id,sequence:1,identity:'owner',body:'Exact message ',reply_to:null,created_at:'2026-10-16T00:00:00Z',author_authenticated:true};
const page={messages:[],nextCursor:null};
function setup(api){globalThis.document={createElement:tag=>new Element(tag)};globalThis.window={addEventListener(){},removeEventListener(){}};return renderMakima({container:new Element('div'),api});}
test('private composer preserves uncertain text and reconciles without duplicate send',async()=>{let calls=0,reject,sent;const view=setup({read:async()=>page,send:p=>{sent=p;calls++;return new Promise((_,r)=>reject=r);},lookup:async()=>({...entry,id:sent.id})});await tick();const input=find(view.element,n=>n.id==='makima-message'),form=find(view.element,n=>n.tagName==='FORM');input.value=entry.body;input.listeners.input();form.onsubmit({preventDefault(){}});form.onsubmit({preventDefault(){}});assert.equal(calls,1);assert.equal(input.disabled,true);reject(Error('timeout'));await tick();assert.equal(input.value,entry.body);await find(view.element,n=>n.textContent==='Check whether saved').onclick();assert.equal(input.value,'');assert.equal(calls,1);assert.ok(find(view.element,n=>n.textContent.includes('Delivery and reading are not confirmed')));view.destroy();});
test('refresh retains draft and renders message content strictly as text',async()=>{const view=setup({read:async()=>({messages:[{...entry,body:'<img onerror=evil()>'}],nextCursor:null})});await tick();const input=find(view.element,n=>n.id==='makima-message');input.value='draft';await view.refresh();assert.equal(input.value,'draft');assert.ok(find(view.element,n=>n.textContent==='<img onerror=evil()>'));assert.equal(all(view.element).filter(n=>n.dataset.messageId===id).length,1);view.destroy();});
test('unavailable service does not falsely assert connection or enable sending',async()=>{const view=setup({read:async()=>{throw Object.assign(Error(),{status:503});}});await tick();assert.equal(find(view.element,n=>n.textContent==='Send').disabled,true);assert.ok(find(view.element,n=>n.textContent.includes('channel is unavailable')));view.destroy();});
test('sign-in guidance appears for absent owner session without leaking error details',async()=>{const view=setup({read:async()=>{throw Object.assign(Error('sensitive server detail'),{kind:'unauthorized'});}});await tick();assert.ok(find(view.element,n=>n.textContent.startsWith('Sign in through Lucy')));assert.equal(find(view.element,n=>n.textContent==='Send').disabled,true);assert.ok(!find(view.element,n=>n.textContent.includes('sensitive server detail')));view.destroy();});
test('destroyed views ignore late network completion',async()=>{let finish;const view=setup({read:()=>new Promise(r=>finish=r)});view.destroy();finish({messages:[entry],nextCursor:null});await tick();assert.ok(!find(view.element,n=>n.dataset.messageId===id));});

test('session loss invokes shell invalidation so other cached private surfaces are cleared',async()=>{let invalidated=0;globalThis.document={createElement:tag=>new Element(tag)};globalThis.window={addEventListener(){},removeEventListener(){}};const view=renderMakima({container:new Element('div'),api:{read:async()=>{throw Object.assign(Error(),{kind:'revoked'});}},onAccessLost:()=>invalidated++});await tick();assert.equal(invalidated,1);view.destroy();});

test('accepted own send scrolls timeline to latest without scrolling refresh',async()=>{let sent;const view=setup({read:async()=>page,send:async p=>{sent=p;return {...entry,id:p.id};}});await tick();const log=find(view.element,n=>n.className==='makima-messages'),input=find(view.element,n=>n.id==='makima-message'),form=find(view.element,n=>n.tagName==='FORM');log.scrollHeight=1200;log.scrollTop=40;input.value='New own message';input.listeners.input();form.onsubmit({preventDefault(){}});await tick();assert.ok(sent);assert.equal(log.scrollTop,1200);log.scrollTop=150;await view.refresh();assert.equal(log.scrollTop,150);view.destroy();});
