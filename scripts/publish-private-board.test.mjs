import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedPins,checkedExisting,unchangedInventory,orderedFiles,hash} from './publish-private-board.mjs';
const h='a'.repeat(64),s='b'.repeat(40);
const valid=()=>({schema:1,ready:true,source:s,parentReceiptSha256:h,worker:{version:'11111111-1111-1111-1111-111111111111',codeSha256:h,settingsDigest:h,schedulesDigest:h},recipe:Object.fromEntries(['.github/workflows/validate-r2.yml','scripts/install-qualification-browser.mjs','scripts/qualification-proof.mjs','tests/helpers/ci-test-inventory.mjs'].map(p=>[p,s])),files:[{path:'assets/private-board.js',sha256:h,before:null,bytes:1}],dependencies:[]});
test('pins fail closed before final source, Worker and byte identities exist',()=>{assert.throws(()=>checkedPins({...valid(),ready:false}));assert.throws(()=>checkedPins({...valid(),source:null}));assert.equal(checkedPins(valid()).source,s);});
test('reject duplicate, escaping and unrelated assets or missing proof recipe',()=>{for(const change of [p=>p.files.push({...p.files[0]}),p=>p.files[0].path='../secret',p=>p.files[0].path='drawercast/player.js',p=>delete p.recipe['scripts/qualification-proof.mjs'],p=>p.dependencies.push({path:p.files[0].path,sha256:h}),p=>delete p.worker.schedulesDigest]){const p=valid();change(p);assert.throws(()=>checkedPins(p));}});
test('exact prewrite hashes reject unknown bytes and unexpected existing new files',()=>{checkedExisting(null,{path:'a',before:null});assert.throws(()=>checkedExisting(Buffer.from('x'),{path:'a',before:null}));checkedExisting(Buffer.from('x'),{path:'a',before:hash('x')});assert.throws(()=>checkedExisting(Buffer.from('y'),{path:'a',before:hash('x')}));});
test('inventory forbids unrelated changes, additions and deletions',()=>{const p=valid(),before=[{name:'other',etag:'1'},{name:'private-workspace-release.json',etag:'old'}],after=[{name:'other',etag:'1'},{name:'private-workspace-release.json',etag:'new'},{name:'assets/private-board.js',etag:'new'}];unchangedInventory(before,after,p);assert.throws(()=>unchangedInventory(before,[...after,{name:'evil'}],p));assert.throws(()=>unchangedInventory(before,after.map(x=>x.name==='other'?{...x,etag:'2'}:x),p));assert.throws(()=>unchangedInventory(before,after.slice(1),p));});
test('dependencies precede controller and HTML publication',()=>{assert.deepEqual(orderedFiles([{path:'private/index.html'},{path:'assets/private-workspace.js'},{path:'assets/private-board-api.js'}]).map(x=>x.path),['assets/private-board-api.js','assets/private-workspace.js','private/index.html']);});
test('workflow is manual, keeps qualification and existing identity, never deploys Worker',()=>{const y=readFileSync(new URL('../.github/workflows/publish-private-board.yml',import.meta.url),'utf8'),s=readFileSync(new URL('./publish-private-board.mjs',import.meta.url),'utf8');assert.match(y,/workflow_dispatch:/);assert.doesNotMatch(y,/\n  (push|pull_request|schedule):/);assert.match(y,/PRIVATE_WORKSPACE_CHROME="\$JARVIS_CHROME"/);assert.match(y,/azure\/login@v2/);assert.doesNotMatch(y,/continue-on-error|wrangler|publish-private-collaboration.mjs (deploy|verify)/);assert.doesNotMatch(s,/method:\s*['"](?:PUT|POST|DELETE)|publishWorker\(/);assert.match(s,/proof.qualified,true/);});
test('preview defaults to read-only staging and every Azure side effect requires publish',()=>{
 const y=readFileSync(new URL('../.github/workflows/publish-private-board.yml',import.meta.url),'utf8');
 assert.match(y,/default: preview/);assert.match(y,/options:\n          - preview\n          - publish/);
 const steps=y.split(/\n      - /).slice(1);
 for(const step of steps){if(/azure\/login@|run: az logout|run: node scripts\/publish-private-board\.mjs (publish|verify)/.test(step))assert.match(step,/if: \$\{\{.*inputs\.mode == 'publish'/);}
 assert.equal((y.match(/inputs\.mode == 'publish'/g)||[]).length,4);
 assert.ok(y.indexOf('Require exact mobile visual evidence')<y.indexOf('Sign in using existing Azure identity'));
 assert.ok(y.indexOf('private-board-before-')<y.indexOf('Sign in using existing Azure identity'));
 assert.match(y,/PRIVATE_CHAT_SCREENSHOT_DIR:/);
 for(const file of ['group-normal.png','group-menu.png','group-spectrum.png','makima.png'])assert.ok(y.includes(file));
 assert.match(y,/readUInt32BE\(16\),390/);assert.match(y,/readUInt32BE\(20\),844/);
 assert.doesNotMatch(y,/permissions:\n(?:.*\n)*?  (?:contents|actions): write/);
});

test('public Muse race guard permits exactly its two reviewed assets',()=>{
 for(const path of ['muse/index.html','assets/muse.js']){const p=valid();p.files[0].path=path;assert.equal(checkedPins(p).files[0].path,path);}
 for(const path of ['muse/other.html','assets/muse-shell.js','assets/muse.css','mast/index.html','jarvis/index.html']){const p=valid();p.files[0].path=path;assert.throws(()=>checkedPins(p));}
});

test('existing private Muse route may only be pinned as an unchanged dependency',()=>{const p=valid();p.dependencies=[{path:'mast/index.html',sha256:h}];checkedPins(p);p.files[0].path='mast/index.html';assert.throws(()=>checkedPins(p));for(const path of ['mast/other.html','admin/index.html']){const x=valid();x.dependencies=[{path,sha256:h}];assert.throws(()=>checkedPins(x));}});
