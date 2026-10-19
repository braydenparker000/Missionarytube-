import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../.github/workflows/'+file,import.meta.url),'utf8');
const qualification=read('qualify-jarvis.yml'),production=read('deploy-azure-storage.yml');

test('CI qualifies once and publication requires its exact successful main artifact',()=>{
  assert.match(read('ci.yml'),/uses: \.\/\.github\/workflows\/qualify-jarvis\.yml/);
  assert.match(production,/node scripts\/guard-validation\.mjs/);
  assert.doesNotMatch(production,/npm run test:jarvis|npm --prefix \.jarvis-source test|run: npm test|run: npm run build/);
  assert.match(qualification,/fail-fast: false/);
  assert.match(qualification,/needs: \[plan, component, build, runtime\]/);
  for(const name of ['PLAN','COMPONENT','BUILD','RUNTIME'])assert.match(qualification,new RegExp('test "\\$'+name+'_RESULT" = success'));
  assert.doesNotMatch(qualification,/continue-on-error|secrets\.|azure\/login|wrangler-action/);
});
test('every source lane has its own exact checkout dependencies and mandatory locked browser',()=>{
  const lane=qualification.slice(qualification.indexOf('\n  component:'),qualification.indexOf('\n  build:'));
  assert.ok(lane.indexOf('path: .jarvis-source')<lane.indexOf('npm --prefix .jarvis-source ci'));
  assert.ok(lane.indexOf('npm --prefix .jarvis-source ci')<lane.indexOf('node scripts/install-jarvis-browser.mjs'));
  assert.ok(lane.indexOf('test -x "$JARVIS_CHROME"')<lane.indexOf('node scripts/plan-jarvis-qualification.mjs run'));
  assert.match(lane,/QUALIFICATION_NODE24:/);assert.match(lane,/QUALIFICATION_PYTHON:/);
  assert.match(lane,/if: \$\{\{ matrix.component == 'migration' \}\}/);
  const install=/name: Install exact source dependencies for fresh or fallback execution\n        if: \$\{\{ matrix.reuse != true \}\}\n        run: npm --prefix \.jarvis-source ci/;
  assert.match(lane,install);
  assert.ok(!install.test(lane.replace('matrix.reuse != true','matrix.reuse == true')),'Fresh or missing-proof lanes must not skip their locked install');
  assert.ok(!install.test(lane.replace('run: npm --prefix .jarvis-source ci','run: true')),'Fallback must retain the exact dependency installation');
});
test('immutable artifact is built once and verified before any provider credentials',()=>{
  assert.equal((qualification.match(/run: npm run build/g)||[]).length,1);
  assert.match(qualification,/node scripts\/qualified-artifact\.mjs create/);
  const verification=production.indexOf('node scripts/qualified-artifact.mjs verify');
  assert.ok(verification>0&&verification<production.indexOf('azure/login@v2'));
  assert.ok(production.indexOf('node scripts/check-jarvis-api.mjs')>verification);
  assert.ok(production.indexOf('node scripts/check-jarvis-api.mjs')<production.indexOf('azure/login@v2'));
  assert.match(production,/name: \$\{\{ needs.validation.outputs.artifact_name \}\}/);
  assert.match(production,/run-id: \$\{\{ needs.validation.outputs.run_id \}\}/);
  assert.match(production,/needs: validation/);assert.match(production,/github.ref == 'refs\/heads\/main'/);
  assert.doesNotMatch(production,/path: \.jarvis-source|source_commit|Read historical qualification identity/);
});
test('static releases cannot write Worker settings or data, and backup precedes publication',()=>{
  assert.doesNotMatch(production,/CLOUDFLARE|wrangler|configure-drive|configure-quick-ai|upload-batch|activate-|continue-on-error/);
  assert.match(production,/group: azure-production\n  cancel-in-progress: false/);
  const backup=production.indexOf('name: Save rollback artifact before any overwrite'),publish=production.indexOf('run: node scripts/publish-frontend.mjs publish');
  assert.ok(backup>0&&backup<publish);
  assert.match(production,/retention-days: 90/);
  assert.match(production,/FRONTEND_EXPECTED_COMMIT: \$\{\{ inputs.expected_commit \}\}/);
  assert.match(production,/needs.validation.result == 'success'/);
  assert.match(production,/group: jarvis-worker-production/);
  assert.match(production,/DAILY_BOARD_ORIGIN: https:\/\/missionarytube.z13.web.core.windows.net/);
  assert.match(production,/inputs.action == 'rollback' && inputs.rollback_run_id != ''/);
  for(const mode of ['publish_poweramp_background','publish_simple_chat_tasks','publish_media_only','activate_lucy_muse'])assert.ok(!production.includes(mode));
});
