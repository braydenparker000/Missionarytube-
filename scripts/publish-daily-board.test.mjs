import test from 'node:test';
import assert from 'node:assert/strict';
import {guardSnapshot,publicationOrder,PATHS} from './publish-daily-board.mjs';
test('Daily Board upload publishes dependencies before the sole route',()=>{assert.equal(publicationOrder(PATHS).at(-1),'daily-board/index.html');assert.throws(()=>publicationOrder([...PATHS,'drawercast/player.js']));});
test('Daily Board prewrite guard refuses existence, ETag and byte drift',()=>{const prior={exists:true,etag:'one',hash:'a'};guardSnapshot(prior,{...prior});for(const next of [{...prior,exists:false},{...prior,etag:'two'},{...prior,hash:'b'}])assert.throws(()=>guardSnapshot(prior,next));guardSnapshot({exists:false},{exists:false});});
