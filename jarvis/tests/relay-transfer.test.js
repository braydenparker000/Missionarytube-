import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelayTransferStore, quickAITransfer, RELAY_TRANSFER_KEY, LEGACY_TRANSFER_KEY} from '../public/assets/relay-transfer.js';
import {createOwnerDraftStore, OWNER_DRAFT_KEY} from '../public/assets/relay-draft-store.js';
import {createRelayOwnerController} from '../public/assets/relay-owner-ui.js';
import {OwnerApiError} from '../public/assets/relay-owner-api.js';

const storage = () => {const map = new Map();return {map,getItem: key => map.get(key) ?? null,setItem: (key, value) => map.set(key, value),removeItem: key => map.delete(key)};};
const transfer = destination => quickAITransfer('A retained question', 'An answer', destination);
for (const destination of ['owner', 'public']) {
  test(`${destination} transfer preserves destination, visibility, existing draft and exact replay after interrupted navigation`, () => {
    const store = storage(), manager = createRelayTransferStore({storage: store}), incoming = transfer(destination);
    manager.stage(incoming); let draft = 'Existing unsent text', calls = 0;
    const other = destination === 'owner' ? 'public' : 'owner';
    assert.equal(manager.apply({destination: other, draft, saveDraft: () => assert.fail('Wrong destination must never accept text')}).status, 'different_destination');
    assert.throws(() => manager.apply({destination, draft, saveDraft: value => {draft = value;calls++;throw Error('Navigation interrupted');}}), /interrupted/);
    assert.equal(manager.peek().visibility, destination === 'owner' ? 'private' : 'public');
    const reloaded = createRelayTransferStore({storage: store});
    assert.equal(reloaded.apply({destination, draft, saveDraft: value => {draft = value;calls++;return true;}}).status, 'applied');
    assert.equal(draft, 'Existing unsent text\n\n' + incoming.body);
    assert.equal(draft.split(incoming.body).length, 2);assert.equal(reloaded.peek(), null);assert.equal(calls, 2);
  });
  test(`${destination} oversized combined draft stays pending without truncating either draft`, () => {
    const store = storage(), manager = createRelayTransferStore({storage: store}), incoming = transfer(destination);manager.stage(incoming);
    assert.equal(manager.apply({destination, draft: 'x'.repeat(3950), saveDraft: () => assert.fail('No partial draft')}).status, 'too_long');
    assert.deepEqual(manager.peek(), incoming);
    assert.equal(manager.apply({destination, draft: 'Shortened existing draft', saveDraft: () => true}).status, 'applied');
  });
}
test('legacy transfers require an explicit destination and never default to public', () => {
  const store = storage();store.setItem(LEGACY_TRANSFER_KEY, 'Legacy incoming draft');const manager = createRelayTransferStore({storage: store});
  assert.equal(manager.peek().legacy, true);
  assert.equal(manager.apply({destination: 'public', draft: '', saveDraft: () => assert.fail('No destination was chosen')}).status, 'choose_destination');
  manager.selectLegacy('owner');assert.equal(manager.peek().visibility, 'private');
  assert.equal(manager.apply({destination: 'owner', draft: '', saveDraft: () => true}).status, 'applied');
  assert.equal(store.getItem(LEGACY_TRANSFER_KEY), null);
});
test('new transfers cannot overwrite an existing or legacy pending draft', () => {
  for (const legacy of [false, true]) {
    const store = storage(), manager = createRelayTransferStore({storage: store});
    if (legacy) store.setItem(LEGACY_TRANSFER_KEY, 'Existing legacy draft'); else manager.stage(transfer('owner'));
    const before = JSON.stringify([...store.map]);assert.throws(() => manager.stage(transfer('public')), /already waiting/);
    assert.equal(JSON.stringify([...store.map]), before);
  }
});
test('visibility mismatch, unknown fields and corrupted transfer journals fail closed', () => {
  const store = storage(), manager = createRelayTransferStore({storage: store}), incoming = transfer('owner');
  for (const candidate of [{...incoming,visibility:'public'},{...incoming,device_token:'must-never-be-stored'},{...incoming,destination:'muse'}]) assert.throws(() => manager.stage(candidate), /Invalid/);
  assert.equal(store.map.size, 0);
  store.setItem(RELAY_TRANSFER_KEY, '{invalid');assert.throws(() => manager.peek(), /retain/);
  store.setItem(RELAY_TRANSFER_KEY, JSON.stringify({version:2,pending:incoming,application:{base:'A',merged:'Forged different text'}}));assert.throws(() => manager.peek(), /retain/);
});
test('a failed storage write or edited draft cannot consume or duplicate a pending transfer', () => {
  const store = storage(), manager = createRelayTransferStore({storage: store}), incoming = transfer('public');manager.stage(incoming);
  let draft = '';
  assert.equal(manager.apply({destination:'public',draft,saveDraft:()=>false}).status, 'storage_unavailable');assert.deepEqual(manager.peek(), incoming);
  draft = 'User edited existing draft';
  assert.equal(manager.apply({destination:'public',draft,saveDraft:()=>assert.fail('Do not overwrite edits')}).status, 'draft_changed');
  assert.deepEqual(manager.peek(), incoming);
  const blocked = createRelayTransferStore({storage:{...store,setItem:()=>{throw Error('Quota');}}});
  assert.throws(() => blocked.stage(transfer('owner')), /already waiting/);
  assert.throws(() => createRelayTransferStore({storage:{getItem:()=>null,setItem:()=>{throw Error('Quota');}}}).stage(transfer('owner')), /retain/);
});
test('long Quick AI answers carry an explicit shortening notice and remain review-only data', () => {
  const data = quickAITransfer('Question', 'a'.repeat(5000), 'owner');assert.ok(data.body.length <= 4000);assert.match(data.body,/Text shortened/);
  assert.deepEqual(Object.keys(data).sort(), ['body','destination','id','version','visibility']);
});
for (const destination of ['owner', 'public']) test(`${destination} reviewed dismissal resolves an edited interrupted transfer without changing its composer`, () => {
  const store=storage(), manager=createRelayTransferStore({storage:store}), incoming=transfer(destination);manager.stage(incoming);
  let draft='Existing unsent draft';
  assert.equal(manager.apply({destination,draft,saveDraft:()=>false}).status,'storage_unavailable');
  draft='User edited draft during recovery';
  assert.equal(manager.apply({destination,draft,saveDraft:()=>assert.fail('Preserve the edit')}).status,'draft_changed');
  const review=manager.prepareDismissal();assert.deepEqual(review.pending,incoming);
  assert.throws(()=>manager.stage(transfer(destination)),/already waiting/);
  assert.deepEqual(manager.peek(),incoming,'Opening a confirmation must keep the saved incoming text');
  assert.equal(review.dismiss(),true);assert.equal(manager.peek(),null);assert.equal(draft,'User edited draft during recovery');
  const next=transfer(destination);manager.stage(next);assert.deepEqual(manager.peek(),next);
});
test('dismissal is bound to the full journal, including changes with the same transfer ID and body', () => {
  const store=storage(),manager=createRelayTransferStore({storage:store}),incoming=transfer('owner');manager.stage(incoming);
  const review=manager.prepareDismissal();
  assert.equal(manager.apply({destination:'owner',draft:'Existing draft',saveDraft:()=>false}).status,'storage_unavailable');
  const changed=store.getItem(RELAY_TRANSFER_KEY);assert.throws(()=>review.dismiss(),/changed/);
  assert.equal(store.getItem(RELAY_TRANSFER_KEY),changed);assert.deepEqual(manager.peek(),incoming);
  manager.prepareDismissal().dismiss();assert.equal(manager.peek(),null);
});
test('dismissal fails closed when storage cannot be re-read or removed', () => {
  for(const failure of ['read','remove']){
    const store=storage();let fail=false;
    const manager=createRelayTransferStore({storage:{...store,getItem:key=>{if(fail&&failure==='read')throw Error('Blocked');return store.getItem(key);},
      removeItem:key=>{if(fail&&failure==='remove')throw Error('Blocked');return store.removeItem(key);}}});
    manager.stage(transfer('public'));const before=store.getItem(RELAY_TRANSFER_KEY),review=manager.prepareDismissal();fail=true;
    assert.throws(()=>review.dismiss(),/retain/);assert.equal(store.getItem(RELAY_TRANSFER_KEY),before);
  }
});
test('legacy dismissal removes only the reviewed incoming text, and never an unrelated legacy transfer', () => {
  const store=storage(),manager=createRelayTransferStore({storage:store});store.setItem(LEGACY_TRANSFER_KEY,'Reviewed legacy draft');
  manager.selectLegacy('owner');manager.prepareDismissal().dismiss();assert.equal(manager.peek(),null);
  manager.stage(transfer('owner'));store.setItem(LEGACY_TRANSFER_KEY,'Unrelated legacy incoming draft');
  manager.prepareDismissal().dismiss();assert.deepEqual(manager.peek(),{legacy:true,body:'Unrelated legacy incoming draft'});
  manager.prepareDismissal().dismiss();assert.equal(manager.peek(),null);
});
test('an unreadable private draft is not overwritten when an incoming transfer is prepared',()=>{
  const tab=storage();tab.setItem(OWNER_DRAFT_KEY,'{corrupted-existing-draft');const draftStore=createOwnerDraftStore({storage:tab});
  assert.equal(draftStore.read(),'');assert.equal(draftStore.save('Incoming text'),false);assert.equal(tab.getItem(OWNER_DRAFT_KEY),'{corrupted-existing-draft');
});
test('private draft survives expiry, navigation and reauthentication without history, token exposure or automatic send', async () => {
  const tab = storage(), draftStore = createOwnerDraftStore({storage:tab}), manager = createRelayTransferStore({storage:tab});
  let expiry = false, posts = 0;
  const device = {id:'synthetic-device',label:'Test phone'};
  const api = {selectedMode:'owner',hasCredential:true,storageWarning:'',session:async()=>{if(expiry)throw new OwnerApiError('expired');return {device};},
    messages:async()=>({messages:[{id:'message',body:'Private stored history',role:'user',createdAt:'2026-10-09T00:00:00Z'}],nextCursor:null}),
    login:async()=>{expiry=false;return {device};},cancelPairing(){},cancelAuthentication(){},selectMode(){},sendMessage(){posts++;assert.fail('Transfer must not send');}};
  let owner = createRelayOwnerController({api,draftStore});await owner.refresh();owner.setDraft('Existing private draft');
  const incoming = transfer('owner');manager.stage(incoming);
  assert.equal(manager.apply({destination:'owner',draft:owner.snapshot().draft,saveDraft:value=>owner.setDraft(value)}).status, 'applied');
  expiry = true;await owner.refresh();assert.equal(owner.status,'expired');assert.deepEqual(owner.snapshot().messages,[]);
  assert.equal(owner.snapshot().draft,'Existing private draft\n\n'+incoming.body);
  owner = createRelayOwnerController({api,draftStore});assert.equal(owner.mode,'owner');await owner.refresh();assert.equal(owner.status,'expired');
  await owner.login('synthetic.owner','synthetic-password','Phone');assert.equal(owner.status,'approved');assert.equal(posts,0);
  const raw=JSON.stringify([...tab.map]);assert.equal(raw.includes('synthetic-password'),false);assert.equal(raw.includes('Private stored history'),false);
  assert.deepEqual(Object.keys(JSON.parse(tab.getItem(OWNER_DRAFT_KEY))),['body']);
});
test('replacement or revocation clears the private draft and history instead of carrying it to a new session', async () => {
  for (const change of ['replacement','revoked']) {
    const tab = storage(), draftStore = createOwnerDraftStore({storage:tab});draftStore.save('Private unsent text');
    const api={selectedMode:'owner',hasCredential:true,refreshStoredCredential(){this.hasCredential=false;},session:async()=>{throw new OwnerApiError('revoked');},cancelAuthentication(){}};
    const owner=createRelayOwnerController({api,draftStore});
    if(change==='replacement')owner.storedSessionChanged();else await owner.refresh();
    assert.equal(owner.snapshot().draft,'');assert.equal(tab.getItem(OWNER_DRAFT_KEY),null);assert.deepEqual(owner.snapshot().messages,[]);assert.notEqual(owner.mode,'public');
  }
});
