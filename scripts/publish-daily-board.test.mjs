import test from 'node:test';
import assert from 'node:assert/strict';
import {guardSnapshot,publicationOrder,PATHS} from './publish-daily-board.mjs';
test('Daily Board upload publishes dependencies before the sole route',()=>{assert.equal(publicationOrder(PATHS).at(-2),'daily-board/index.html');assert.equal(publicationOrder(PATHS).at(-1),'assets/app.js');assert.throws(()=>publicationOrder([...PATHS,'drawercast/player.js']));});
test('Daily Board prewrite guard refuses existence, ETag and byte drift',()=>{const prior={exists:true,etag:'one',hash:'a'};guardSnapshot(prior,{...prior});for(const next of [{...prior,exists:false},{...prior,etag:'two'},{...prior,hash:'b'}])assert.throws(()=>guardSnapshot(prior,next));guardSnapshot({exists:false},{exists:false});});

import {readFileSync} from 'node:fs';
import {dailyBoardNavigation} from './daily-board-navigation.mjs';
test('navigation changes only the Daily Board link on the exact retained app',()=>{const source=readFileSync(new URL('../jarvis/public/assets/app.js',import.meta.url),'utf8');const result=dailyBoardNavigation(source);assert.equal(result.replace("  if (link.dataset.route === 'board') { location.assign(paths.board); return; }\n",''),source);assert.throws(()=>dailyBoardNavigation(source+'changed'));});
