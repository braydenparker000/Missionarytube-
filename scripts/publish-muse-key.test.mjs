import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {checkedDestination} from './publish-muse-key.mjs';
test('publication permits only the three additive helper files',()=>{
 for(const file of ['key.css','key.js','index.html'])assert.equal(checkedDestination(file),'muse-key/'+file);
 for(const file of ['../index.html','release.json','release-qualified.json','staticwebapp.config.json','assets/app.js'])assert.throws(()=>checkedDestination(file));
 const script=readFileSync('scripts/publish-muse-key.mjs','utf8');
 assert.match(script,/'--overwrite','false'/);assert.match(script,/proof.qualified,true/);
 const flow=readFileSync('.github/workflows/publish-muse-key.yml','utf8');
 assert.match(flow,/group: azure-production/);assert.ok(!/CLOUDFLARE|wrangler|schedule:/.test(flow));
});
