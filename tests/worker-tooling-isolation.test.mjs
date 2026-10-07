import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {prepareWorkerTools,verifyWorkerTools,sourceDependencyIdentity} from '../scripts/prepare-worker-tools.mjs';
import {identityDifferences} from '../scripts/qualified-artifact.mjs';

test('identity failure diagnostics identify changed fields without exposing their values',()=>{
  assert.deepEqual(identityDifferences({sourceDependencies:'qualified',releaseDigest:'same'},{sourceDependencies:'installer mutation',releaseDigest:'same'}),['sourceDependencies']);
});

test('installer writes are isolated from both qualified source dependency files',async()=>{
  const root=await mkdtemp(join(tmpdir(),'worker-tools-'));
  try{
    await mkdir(join(root,'.jarvis-source'));await writeFile(join(root,'.jarvis-source/package.json'),'{"private":true,"type":"module"}');
    await writeFile(join(root,'.jarvis-source/package-lock.json'),'{"lockfileVersion":3}');
    const before=sourceDependencyIdentity(root),prepared=prepareWorkerTools(root);
    assert.equal(prepared.directory,join(root,'.worker-tools'));
    // Reproduce the installer's intended mutation, in its isolated cwd.
    await writeFile(join(root,'.worker-tools/package.json'),'{"dependencies":{"wrangler":"4.136.3"}}');
    await writeFile(join(root,'.worker-tools/package-lock.json'),'{"packages":{"node_modules/wrangler":{"version":"4.136.3"}}}');
    assert.deepEqual(sourceDependencyIdentity(root),before);assert.equal(verifyWorkerTools(root),true);
    await writeFile(join(root,'.jarvis-source/package-lock.json'),'{"unexpected":"installer mutation"}');
    assert.throws(()=>verifyWorkerTools(root),/mutated/);
  }finally{await rm(root,{recursive:true,force:true});}
});
test('production action uses an isolated installer cwd and the same absolute qualified source config',async()=>{
  const flow=await readFile(new URL('../.github/workflows/deploy-azure-storage.yml',import.meta.url),'utf8');
  const action=flow.slice(flow.indexOf('      - name: Deploy the exact qualified changed Worker'),flow.indexOf('      - name: Verify real podcast search'));
  assert.match(action,/workingDirectory: \.worker-tools/);
  assert.match(action,/command: deploy --config "\$\{\{ github.workspace \}\}\/\.jarvis-source\/backend\/wrangler.music.generated.json"/);
  assert.doesNotMatch(action,/workingDirectory: \.jarvis-source/);
  assert.match(action,/node scripts\/prepare-worker-tools\.mjs verify/);
  assert.ok(flow.indexOf('node scripts/prepare-worker-tools.mjs prepare')<flow.indexOf('uses: cloudflare/wrangler-action@v4'));
});
