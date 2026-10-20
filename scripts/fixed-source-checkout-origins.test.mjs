import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {recipeIdentity} from './worker-release-identity.mjs';

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
  assert.deepEqual(checkoutRefs('.github/workflows/deploy-azure-storage.yml'),[]);
  assert.deepEqual(checkoutRefs('.github/workflows/verify-music-sources.yml'),[]);
  assert.deepEqual(checkoutRefs('.github/workflows/publish-drive-catalog.yml'),[]);
  const release=JSON.parse(read('jarvis-release.json'));
  assert.equal(release.repository,prior);assert.equal(release.commit,'c28c1b2f70aabb5217b08bf31ffe4c93d0353765');
  // Historical publication records are retained, never source selectors for normal releases.
  assert.equal(JSON.parse(read('scripts/private-board-pins.json')).source,'324d4c4196dc7ee602a23210c62cc92238c7da96');
  assert.equal(JSON.parse(read('scripts/private-workspace-pins.json')).source,'72f86e00b0c8b4f7e1fdb41e1ab2601b50fb365c');
  const deploy=read('.github/workflows/deploy-azure-storage.yml'),workflowBlob=blob(Buffer.from(deploy));
  const recipe=recipeIdentity();
  assert.deepEqual(release.workerDeploymentPolicy,{schema:2,mode:'reconcile-lucy-discovery'});
  assert.equal(recipe.find(x=>x.path==='.github/workflows/deploy-azure-storage.yml').sha,workflowBlob);
  const qualification=read('.github/workflows/qualify-jarvis.yml');
  assert.equal(recipe.find(x=>x.path==='.github/workflows/qualify-jarvis.yml').sha,blob(Buffer.from(qualification)));
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
  const analysis=read('.github/workflows/analyze-r2-audio.yml');
  assert.deepEqual(checkoutRefs('.github/workflows/analyze-r2-audio.yml'),[]);
  assert.doesNotMatch(analysis,/path: \.jarvis-source|inputs.source_commit/);
  assert.match(analysis,/github\.ref == 'refs\/heads\/main'/);
  assert.match(analysis,/test "\$SOURCE_COMMIT" = "\$GITHUB_SHA"/);
  assert.match(analysis,/check-source-commit-reachable\.mjs \. "\$SOURCE_COMMIT"/);
  const guard=analysis.indexOf('check-source-commit-reachable.mjs');
  assert.ok(guard>=0&&analysis.indexOf('npm ci')>guard,'source ancestry must be checked before source tests or install');
  assert.match(analysis,/node --test tests\/audio-fidelity.test.mjs backend\/tests\/native-r2.test.js/);
  assert.ok(analysis.indexOf('node --test')<analysis.indexOf('secrets.R2_ACCESS_KEY_ID'));
  const worker=read('.github/workflows/deploy-music-worker.yml');
  assert.deepEqual(checkoutRefs('.github/workflows/deploy-music-worker.yml'),[]);
  assert.match(worker,/check-source-commit-reachable.mjs \. "\$SOURCE_COMMIT"/);
  assert.match(worker,/test "\$GITHUB_SHA" = "\$SOURCE_COMMIT"/);
  assert.match(worker,/node scripts\/build-backend\.mjs verify/);
  const migration=read('.github/workflows/migrate-music-r2.yml');
  assert.deepEqual(checkoutRefs('.github/workflows/migrate-music-r2.yml'),[]);
  assert.doesNotMatch(migration,/path: \.jarvis-source|dd0797bd/);
  assert.match(migration,/ref: \$\{\{ needs.validate.outputs.source_sha \}\}/);
  assert.match(migration,/permissions:\s+contents: read/);
  assert.match(migration,/workflow_dispatch:/);
  assert.match(migration,/github.event_name == 'workflow_dispatch' && github.ref == 'refs\/heads\/main'/);
  assert.match(migration,/test "\$EXPECTED_COMMIT" = "\$GITHUB_SHA"/);
  assert.ok(migration.indexOf('test "\$EXPECTED_COMMIT" = "\$GITHUB_SHA"')<migration.indexOf('secrets.GOOGLE_DRIVE_CLIENT_SECRET'));
  assert.match(migration,/python -m unittest discover -s tests\/python -p 'test_r2\*\.py' -v/);
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

// Execute the actual workflow validator: an artifact from another source must
// fail before it can be downloaded or supplied to the conditional R2 writer.
test('audio metadata apply accepts only successful analysis from the same reviewed main source',async()=>{
  const workflow=read('.github/workflows/analyze-r2-audio.yml');
  const block=workflow.match(/name: Validate reviewed analysis artifact[\s\S]*?script: \|\n((?: {12}[^\n]*\n)+)/)?.[1];
  assert.ok(block,'actual artifact validation script is present');
  const validate=new Function('github','context','core','process','return (async()=>{'+block+'})();');
  const source='a'.repeat(40),repo={owner:'braydenparker000',repo:'Missionarytube-'};
  const accepted={status:'completed',conclusion:'success',path:'.github/workflows/analyze-r2-audio.yml',
    event:'workflow_dispatch',head_branch:'main',head_sha:source,head_repository:{full_name:origin}};
  const run=async(candidate)=>{
    const outputs=[],reads=[];
    const github={rest:{actions:{getWorkflowRun:async()=>({data:candidate}),
      listWorkflowRunArtifacts:async()=>{reads.push('artifacts');return {data:{artifacts:[{name:'audio-analysis-42',expired:false}]}};}}}};
    await validate(github,{repo},{setOutput:(...v)=>outputs.push(v)},{env:{ANALYSIS_RUN_ID:'42',SOURCE_COMMIT:source}});
    assert.deepEqual(reads,['artifacts']);assert.deepEqual(outputs,[['name','audio-analysis-42']]);
  };
  await run(accepted);
  for(const mutation of [{head_sha:'b'.repeat(40)},{head_branch:'unreviewed'},{event:'pull_request'},
    {head_repository:{full_name:'example/fork'}},{conclusion:'failure'},{status:'in_progress'},
    {path:'.github/workflows/another.yml'}])await assert.rejects(run({...accepted,...mutation}),/Unexpected analysis run/);
});
