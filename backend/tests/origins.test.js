import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker.js';
import {FRONTEND_ORIGINS} from '../origins.js';

for (const origin of FRONTEND_ORIGINS) {
  test(`normal and OAuth responses support ${origin}`, async () => {
    for (const [path,method,status] of [
      ['/health','GET',200],
      ['/shared/messages','OPTIONS',204],
      ['/.well-known/oauth-authorization-server','GET',200],
      ['/oauth/approve','OPTIONS',204],
      ['/oauth/approve','POST',401]
    ]) {
      const response=await worker.fetch(new Request('https://api.example'+path,{method,headers:{Origin:origin}}),{});
      assert.equal(response.status,status);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'),origin);
      assert.equal(response.headers.get('Vary'),'Origin');
    }
  });
}
test('the Thunderhead site may call it while its ported apps use this Worker (MIGRATION.md §6)',()=>{
  assert.deepEqual([...FRONTEND_ORIGINS],['https://missionarytube.z13.web.core.windows.net','https://thunderhead.z13.web.core.windows.net']);
});
test('only the Storage sites are allowed; lookalikes and the retired Static Web App are rejected',async()=>{
  for(const origin of ['https://evil.example','https://missionarytube.z13.web.core.windows.net.evil.example','https://thunderhead.z13.web.core.windows.net.evil.example','https://gray-meadow-09216fd10.1.azurestaticapps.net']) {
    for(const path of ['/health','/shared/messages','/oauth/approve']) {
      const response=await worker.fetch(new Request('https://api.example'+path,{method:'OPTIONS',headers:{Origin:origin}}),{});
      assert.equal(response.status,403);
      assert.notEqual(response.headers.get('Access-Control-Allow-Origin'),origin);
    }
  }
});
