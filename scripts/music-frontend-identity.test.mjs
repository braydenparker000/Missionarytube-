import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedMusicFrontend} from './music-frontend-identity.mjs';
const source='braydenparker999/jarvis';
test('ordinary releases retain strict exact source pin',()=>{
 assert.equal(checkedMusicFrontend({commit:'a'},{source,commit:'a'}).commit,'a');
 assert.throws(()=>checkedMusicFrontend({commit:'a'},{source,commit:'b'}));
 assert.throws(()=>checkedMusicFrontend({commit:'a'},{source:'fork/repo',commit:'a'}));
});
test('preserved frontend requires the complete pinned verified receipt',()=>{
 const receipt=JSON.parse(readFileSync(new URL('../docs/evidence/lucy-verified-receipt-38168396000.json',import.meta.url)));
 const release={commit:receipt.source,workerDeploymentPolicy:{mode:'reconcile-lucy-discovery'}};
 const current={source,commit:receipt.frontendSource};
 assert.equal(checkedMusicFrontend(release,current,receipt).commit,receipt.frontendSource);
 assert.throws(()=>checkedMusicFrontend(release,{...current,commit:release.commit},receipt));
 assert.throws(()=>checkedMusicFrontend({...release,commit:'f'.repeat(40)},current,receipt));
 for(const key of ['source','frontendSource','frontendOrchestration','version','runId','attempt','frontendArtifactDigest'])assert.throws(()=>checkedMusicFrontend(release,current,{...receipt,[key]:'changed'}));
 assert.throws(()=>checkedMusicFrontend(release,current,{...receipt,extra:true}));
});
