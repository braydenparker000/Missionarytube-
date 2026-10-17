import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const origin='braydenparker000/Missionarytube-';
const prior='braydenparker999/jarvis';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function checkoutRefs(path){
  const yaml=read(path),lines=yaml.split(/\r?\n/),refs=[];
  for(let i=0;i<lines.length;i++)if(lines[i].trim()==='repository: '+origin){
    let ref;
    for(let j=i+1;j<lines.length&&!/^\s+- uses:/.test(lines[j]);j++){
      const match=/^\s+ref:\s*(.+)$/.exec(lines[j]);if(match){ref=match[1];break;}
    }
    assert.ok(ref,`${path}: checkout origin must retain its explicit ref`);refs.push(ref);
  }
  assert.doesNotMatch(yaml,new RegExp('repository: '+prior.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  return refs;
}
const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');

test('fixed pinned checkouts use destination history without changing commit refs or source provenance',()=>{
  assert.deepEqual(checkoutRefs('.github/workflows/deploy-azure-storage.yml'),[
    '${{ steps.jarvis.outputs.commit }}','126d4bc4c792a188b2e86cd334bd4bcd6ab3a74c','95d39031bb7b80f637c969a761e2aff9cc6a1040',
    '0636f664e063278eb93e7b743e89b8b04c20e9e5','42acd57ab44c23db738ee9db8c519d3aec3787ea','550c8395d23d42eea66686cfe21793505606115d',
    'd7daef3d6aa43fdb9d6622843aa50d9de8a075d5','46a26806f123de296d4e50b4ee7b753bbff0304b','fed236966d928a4f8221474e502459e13e82e2a4',
    '${{ steps.jarvis.outputs.commit }}',
    'd5428cae57e195405afbd140965f9fca16d65110'
  ]);
  for(const [path,ref] of [
    ['.github/workflows/publish-makima-cookie.yml','dcb111b7bc15642cabddbb8a8651fd4f918fe608'],
    ['.github/workflows/publish-muse-key.yml','833b97c4264c364dcce0789a6d64f938176a9057'],
    ['.github/workflows/publish-drive-catalog.yml','9f65e014f578d7947b97a88fd8a32b0b2e8e693d'],
    ['.github/workflows/verify-music-sources.yml','${{ steps.jarvis.outputs.commit }}'],
    ['.github/workflows/publish-private-board.yml','${{ steps.source.outputs.sha }}'],
    ['.github/workflows/publish-private-workspace.yml','${{ steps.source.outputs.sha }}']
  ])assert.deepEqual(checkoutRefs(path),[ref]);
  const release=JSON.parse(read('jarvis-release.json'));
  assert.equal(release.repository,prior);assert.equal(release.commit,'c28c1b2f70aabb5217b08bf31ffe4c93d0353765');
  for(const [path,pinsPath] of [['.github/workflows/publish-private-board.yml','scripts/private-board-pins.json'],['.github/workflows/publish-private-workspace.yml','scripts/private-workspace-pins.json']]){
    assert.equal(JSON.parse(read(pinsPath)).source,path.includes('board')?'324d4c4196dc7ee602a23210c62cc92238c7da96':'72f86e00b0c8b4f7e1fdb41e1ab2601b50fb365c');
  }
  const deploy=read('.github/workflows/deploy-azure-storage.yml'),workflowBlob=blob(Buffer.from(deploy));
  assert.equal(release.workerDeploymentPolicy.recipe.find(x=>x.path==='.github/workflows/deploy-azure-storage.yml').sha,workflowBlob);
  const qualification=read('.github/workflows/qualify-jarvis.yml');
  assert.equal(release.workerDeploymentPolicy.recipe.find(x=>x.path==='.github/workflows/qualify-jarvis.yml').sha,blob(Buffer.from(qualification)));
});

test('frontend qualification restores the exact historical My Media baseline without changing its source checkout',()=>{
  const workflow=read('.github/workflows/qualify-jarvis.yml');
  const start=workflow.indexOf('name: Fetch exact historical My Media comparison commit');
  assert.ok(start>=0);
  const end=workflow.indexOf('\n      - name:',start+1),step=workflow.slice(start,end<0?undefined:end);
  assert.match(step,/if: \$\{\{ matrix\.component == 'frontend' \}\}/);
  assert.match(step,/https:\/\/github\.com\/\$\{GITHUB_REPOSITORY\}\.git/);
  assert.match(step,/git -C \.jarvis-source fetch --no-tags .*\$GITHUB_REF/);
  assert.match(step,/8c4f6de790b3e06cd78b11706dfa2c055174bbf1/);
  assert.match(step,/git -C \.jarvis-source rev-parse HEAD/);
  assert.match(step,/git -C \.jarvis-source status --porcelain/);
  assert.doesNotMatch(step,/secrets\.|Authorization:|persist-credentials:\s*true/);
});

test('dynamic commits must pass destination-main ancestry and retained migration history stays separate',()=>{
  const deploy=read('.github/workflows/deploy-azure-storage.yml');
  assert.match(deploy,/github\.event_name == 'workflow_dispatch'/);assert.match(deploy,/vars\.AZURE_DEPLOY_ENABLED == 'true'/);
  assert.match(read('.github/workflows/publish-drive-catalog.yml'),/cron: '17 \* \* \* \*'/);
  for(const path of ['deploy-music-worker.yml','analyze-r2-audio.yml']){
    const flow=read('.github/workflows/'+path);assert.deepEqual(checkoutRefs('.github/workflows/'+path),['${{ inputs.source_commit }}']);
    assert.match(flow,/fetch-depth: 0/);assert.match(flow,/node scripts\/check-source-commit-reachable\.mjs \.jarvis-source "\$SOURCE_COMMIT"/);
    const guard=flow.indexOf('check-source-commit-reachable.mjs');
    const existingChecks=flow.indexOf(path==='deploy-music-worker.yml'?'npm --prefix .jarvis-source ci':'node --test tests/audio-fidelity.test.js');
    assert.ok(guard>=0&&existingChecks>guard,'source ancestry must be checked before source tests or install');
  }
  const migration=read('.github/workflows/migrate-music-r2.yml');
  assert.deepEqual(checkoutRefs('.github/workflows/migrate-music-r2.yml'),[
    'dd0797bd48431ea04354f83663c3df765cc8f5b0','${{ needs.validate.outputs.source_sha }}']);
  assert.match(migration,/permissions:\s+contents: read/);
  assert.match(migration,/workflow_dispatch:/);
  assert.match(migration,/if: \$\{\{ github\.event_name == 'workflow_dispatch' \}\}/);
  assert.match(migration,/python -m unittest discover -s tests -p 'test_r2\*\.py' -v/);
  const inventory=JSON.parse(read('docs/jarvis-source-import-inventory.json'));
  const astraComparison=inventory.components.find(identity=>identity.commit==='4532be6b6842320ed0cc64be973425d9505c7b03');
  assert.ok(astraComparison);
  assert.equal(astraComparison.includedInImportedAncestry,false);
  assert.equal(astraComparison.includedInDestinationAncestry,false,'preserve the original observedAt snapshot');
  assert.equal(astraComparison.currentDestinationAncestry.destinationMainAtVerification,'0c5ed469023dbfdafd76188558b7d190e42d4938');
  assert.equal(astraComparison.currentDestinationAncestry.isAncestor,true);
  assert.equal(astraComparison.currentDestinationAncestry.compareBehindBy,0);
  assert.match(astraComparison.preservation,/ancestor of current destination main/);
  const astra=read('.github/workflows/astra-worker-reuse-preflight.yml');
  assert.deepEqual(checkoutRefs('.github/workflows/astra-worker-reuse-preflight.yml'),[
    '4532be6b6842320ed0cc64be973425d9505c7b03','f999581aa979712b4b63a6783b7c56842fedb6a1']);
  const astraRelease=JSON.parse(read('scripts/release-identities/astra-approved-jarvis-release.json'));
  assert.equal(astraRelease.repository,prior);assert.equal(astraRelease.commit,'f999581aa979712b4b63a6783b7c56842fedb6a1');
});
