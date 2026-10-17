import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayOwnerApi,OWNER_SESSION_KEY,OwnerApiError} from '../public/assets/relay-owner-api.js';
import {createRelayOwnerController,createRelayOwnerUI} from '../public/assets/relay-owner-ui.js';
const id='11111111-1111-4111-8111-111111111111',deviceId='22222222-2222-4222-8222-222222222222',token='a'.repeat(64);
const delivery=state=>({state,pending:state==='queued'?1:0,failed:state==='delivery_failed'?1:0,callbackAcceptedAt:null,retryable:state==='delivery_failed',retryAfter:null});
const message={id,sequence:1,body:'Private fixture text',role:'user',createdAt:new Date().toISOString(),visibility:'private',author_authenticated:true,delivery:delivery('queued')};
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const json=(data,status=200)=>Response.json(data,{status});
function api(fetcher){return createRelayOwnerApi({origin:'https://owner.example',storage:{getItem:key=>key===OWNER_SESSION_KEY?JSON.stringify({device_token:token,device_id:deviceId}):null,removeItem(){}},fetcher});}

test('private delivery API strictly validates ordered bounded evidence and projects away unexpected fields',async()=>{
  let response={deliveries:[{message_id:id,...delivery('delivery_failed'),callback:'https://secret.example',secret:token}]};
  const a=api(async(_url,options)=>{assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer '+token);return json(response);});
  const result=await a.deliveries([id]);assert.equal(result.deliveries[0].state,'delivery_failed');assert.ok(!JSON.stringify(result).includes(token));assert.ok(!JSON.stringify(result).includes('secret.example'));
  for(const invalid of [{deliveries:[]},{deliveries:[{message_id:deviceId,...delivery('queued')}]},{deliveries:[{message_id:id,...delivery('working')}]},{deliveries:[{message_id:id,...delivery('queued'),retryable:true}]},{deliveries:[{message_id:id,...delivery('saved'),pending:9}]}]){response=invalid;await assert.rejects(()=>a.deliveries([id]),e=>e.kind==='invalid');}
  await assert.rejects(()=>a.deliveries([id,id]),e=>e.kind==='invalid');
});

test('malformed save receipts preserve private text and the retry UUID',async()=>{
  const sends=[];let valid=false;
  const a=api(async(url,options)=>{
    if(url.endsWith('/session'))return json({status:'approved',device:{id:deviceId,label:'Fixture phone'}});
    if(url.includes('/messages?'))return json({messages:[],nextCursor:null});
    const body=JSON.parse(options.body);sends.push(body);return json(valid?{entry:{...message,id:body.id,body:body.body},newWrite:true}:{ok:true});
  });
  const c=createRelayOwnerController({api:a,uuid:()=>id});await c.refresh();c.setDraft('Keep private text');await c.send();assert.equal(c.snapshot().draft,'Keep private text');
  valid=true;await c.send();assert.equal(c.snapshot().draft,'');assert.equal(sends.length,2);assert.equal(sends[0].id,sends[1].id);
});

test('incremental private history refreshes mutable callback state and manual recovery without rewinding its cursor',async()=>{
  let current='queued',retried=0;const cursors=[];
  const a=api(async(url,options)=>{
    if(url.endsWith('/session'))return json({status:'approved',device:{id:deviceId,label:'Fixture phone'}});
    if(url.includes('/messages?')){const cursor=new URL(url).searchParams.get('after');cursors.push(cursor);return json({messages:cursor==='0'?[message]:[],nextCursor:null});}
    if(url.endsWith('/delivery/retry')){retried++;current='queued';return json({retried:1});}
    if(url.endsWith('/delivery'))return json({deliveries:[{message_id:id,...delivery(current)}]});
    assert.fail(url);
  });
  const c=createRelayOwnerController({api:a});await c.refresh();assert.equal(c.snapshot().messages[0].delivery.state,'queued');
  current='delivery_failed';await c.refresh();assert.equal(c.snapshot().messages[0].delivery.state,'delivery_failed');
  await c.retryDelivery(id);assert.equal(retried,1);assert.equal(c.snapshot().messages[0].delivery.state,'queued');assert.deepEqual(cursors,['0','1','1']);
});

test('revocation or removed stored session during a delivery refresh cannot repopulate private memory',async()=>{
  for(const mode of ['removed','revoked']){
    const wait=deferred();let block=false,stored=true;
    const a=createRelayOwnerApi({origin:'https://owner.example',storage:{getItem:()=>stored?JSON.stringify({device_token:token,device_id:deviceId}):null,removeItem(){stored=false;}},fetcher:async(url)=>{
      if(url.endsWith('/session'))return json({status:'approved',device:{id:deviceId,label:'Fixture phone'}});
      if(url.includes('/messages?'))return json({messages:[message],nextCursor:null});
      if(url.endsWith('/delivery'))return block?wait.promise:json({deliveries:[{message_id:id,...delivery('queued')}]});
      assert.fail(url);
    }});
    const c=createRelayOwnerController({api:a});await c.refresh();block=true;const pending=c.refresh();await new Promise(r=>setTimeout(r,0));
    if(mode==='removed'){stored=false;await c.storedSessionChanged();}
    else {a.session=async()=>{throw new OwnerApiError('revoked',401);};c.connect();await c.refresh();}
    wait.resolve(json({deliveries:[{message_id:id,...delivery('callback_accepted')}]}));await pending;
    assert.equal(c.snapshot().messages.length,0);
  }
});

function documentFixture(){
  class Node{
    constructor(tag){this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.attributes={};this.style={};this.value='';this.scrollHeight=240;this.clientHeight=160;this.scrollTop=0;this.isConnected=true;this.classList={add:(...values)=>{this.className=[this.className||'',...values].join(' ');}};}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=[];this.append(...items);}
    setAttribute(key,value){this.attributes[key]=value;}
    contains(node){return node===this||this.children.some(child=>child.contains?.(node));}
    focus(){}
  }
  const doc={hidden:true,activeElement:null,createElement:tag=>new Node(tag),getElementById:()=>null};
  const root=doc.createElement('main'),all=()=>{const walk=node=>[node,...node.children.flatMap(walk)];return walk(root);};
  return {doc,root,all};
}

test('actual private renderer labels callback acceptance separately and exposes retry only for a failed occurrence',async()=>{
  let current='queued',retryCount=0;
  const a={hasCredential:true,storageWarning:'',session:async()=>({device:{id:deviceId,label:'Fixture'}}),messages:async after=>({messages:after==='0'?[message]:[],nextCursor:null}),deliveries:async()=>({deliveries:[{message_id:id,...delivery(current)}]}),retryDelivery:async()=>{retryCount++;current='queued';}};
  const controller=createRelayOwnerController({api:a}),fixture=documentFixture();await controller.refresh();
  const ui=createRelayOwnerUI({controller,document:fixture.doc});ui.mount(fixture.root);
  try{
    assert.ok(fixture.all().some(node=>node.textContent?.includes('Saved · awaiting assistant')));
    current='callback_accepted';await controller.refresh();assert.ok(fixture.all().some(node=>node.textContent?.includes('Sent · awaiting reply')));
    assert.ok(!fixture.all().some(node=>/working|Retry callback delivery/.test(node.textContent||'')));
    current='delivery_failed';await controller.refresh();const button=fixture.all().find(node=>node.textContent==='Retry callback delivery');assert.ok(button);assert.equal(button.disabled,false);
    button.onclick();await new Promise(resolve=>setImmediate(resolve));assert.equal(retryCount,1);assert.ok(fixture.all().some(node=>node.textContent?.includes('Saved · awaiting assistant')));
  }finally{ui.dispose();}
});
