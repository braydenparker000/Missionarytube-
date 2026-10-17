import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {BASELINE,CANDIDATE,SOURCE,checkedBaseline} from './publications-import-release.mjs';
import {readFileSync} from 'node:fs';

const sha=value=>createHash('sha256').update(value).digest('hex');

test('candidate pins the reproduced live Worker and both source overlays',async()=>{
 assert.equal(SOURCE,'62ac633f367250ed21b3ecf7a4627263e9e07d9f');
 const importer=await readFile('jarvis/backend/publications.js');
 const cache=await readFile('jarvis/public/assets/public-reader-cache.js');
 assert.equal(sha(importer),CANDIDATE.importerSha256);
 assert.equal(sha(cache),CANDIDATE.cacheSha256);assert.equal(cache.length,CANDIDATE.cacheBytes);
 assert.equal(BASELINE.codeSha256,'642af5986b00aaa9d059204668dc0e1351cd0d0dbeee19f3b577c4a0a68232e8');
 assert.equal(CANDIDATE.workerSha256,'74c8bf880a674b19bfeab74f65cf87e069b9f88233c4e65eba37393b13d0064d');
});

test('publisher refuses any drift in current Worker version, code, settings or schedules',()=>{
 assert.deepEqual(checkedBaseline({...BASELINE}),BASELINE);
 for(const key of ['version','codeSha256','settingsDigest','schedulesDigest'])
  assert.throws(()=>checkedBaseline({...BASELINE,[key]:'drift'}));
});

test('publication route is manual, main-only and preserves rollback before writes',()=>{
 const workflow=readFileSync('.github/workflows/publish-publications-import.yml','utf8');
 assert.match(workflow,/workflow_dispatch:/);assert.doesNotMatch(workflow,/\n  (push|pull_request|schedule):/);
 assert.match(workflow,/default: false/);assert.match(workflow,/github\.ref == 'refs\/heads\/main'/);
 assert.ok(workflow.indexOf('Preserve rollback bytes before either publication')<workflow.indexOf('Publish pinned Worker and one cache asset'));
 assert.match(workflow,/vars\.AZURE_STORAGE_ACCOUNT == 'missionarytube'/);
 const ci=readFileSync('.github/workflows/ci.yml','utf8');
 assert.match(ci,/daily-board-import-candidate:/);assert.match(ci,/ref: 62ac633f367250ed21b3ecf7a4627263e9e07d9f/);
 assert.match(ci,/node scripts\/publications-import-release\.mjs prepare/);
});
