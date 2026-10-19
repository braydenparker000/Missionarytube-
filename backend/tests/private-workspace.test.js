import test from 'node:test';
import assert from 'node:assert/strict';
import {readTaskPages,taskStatus} from '../../frontend/assets/private-tasks.js';
test('task projection preserves immutable identity, evidence and versions across pages',async()=>{const first={id:'same-id',completion:{replyId:'original',resultVersion:1},latestResult:{version:2},stage:'completed'};const result=await readTaskPages(async cursor=>cursor==='0'?{jobs:[first],nextCursor:'1'}:{jobs:[{id:'second'}],nextCursor:null});assert.equal(result[0],first);assert.match(taskStatus('Mast',first),/not confirmed/);assert.equal(result[0].completion.replyId,'original');assert.equal(taskStatus('Lucy',{stage:'completed'}),'Finish not confirmed');});
test('task pagination refuses cycles without partial results',async()=>{await assert.rejects(readTaskPages(async()=>({jobs:[],nextCursor:'0'})),/advance/);});
