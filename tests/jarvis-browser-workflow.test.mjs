import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=file=>readFileSync(new URL('../.github/workflows/'+file,import.meta.url),'utf8');
const qualification=read('qualify-jarvis.yml'),production=read('deploy-azure-storage.yml');

test('PR and production qualification share one complete reusable pipeline',()=>{
  for(const file of ['ci.yml','deploy-azure-storage.yml'])assert.match(read(file),/uses: \.\/\.github\/workflows\/qualify-jarvis\.yml/);
  assert.doesNotMatch(production,/npm run test:jarvis|npm --prefix \.jarvis-source test|run: npm test|run: npm run build/);
  assert.match(qualification,/fail-fast: false/);
  assert.match(qualification,/needs: \[plan, component, build\]/);
  for(const name of ['PLAN','COMPONENT','BUILD'])assert.match(qualification,new RegExp('test "\\$'+name+'_RESULT" = success'));
  assert.doesNotMatch(qualification,/continue-on-error|secrets\.|azure\/login|wrangler-action/);
});
test('every source lane has its own exact checkout dependencies and mandatory locked browser',()=>{
  const lane=qualification.slice(qualification.indexOf('\n  component:'),qualification.indexOf('\n  build:'));
  assert.ok(lane.indexOf('path: .jarvis-source')<lane.indexOf('npm --prefix .jarvis-source ci'));
  assert.ok(lane.indexOf('npm --prefix .jarvis-source ci')<lane.indexOf('node scripts/install-jarvis-browser.mjs'));
  assert.ok(lane.indexOf('test -x "$JARVIS_CHROME"')<lane.indexOf('node scripts/plan-jarvis-qualification.mjs run'));
  assert.match(lane,/QUALIFICATION_NODE24:/);assert.match(lane,/QUALIFICATION_PYTHON:/);
  assert.match(lane,/if: \$\{\{ matrix.component == 'migration' \}\}/);
});
test('immutable artifact is built once and verified before any provider credentials',()=>{
  assert.equal((qualification.match(/run: npm run build/g)||[]).length,1);
  assert.match(qualification,/node scripts\/qualified-artifact\.mjs create/);
  const verification=production.indexOf('node scripts/qualified-artifact.mjs verify');
  assert.ok(verification>0&&verification<production.indexOf('secrets.CLOUDFLARE_API_TOKEN'));
  assert.match(production,/name: jarvis-\$\{\{ github.sha \}\}-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
  assert.match(production,/needs: qualification/);assert.match(production,/github.ref == 'refs\/heads\/main'/);
});
test('backend stays serialized and its actual identity is rechecked before homepage promotion',()=>{
  assert.match(production,/group: jarvis-worker-production\n      cancel-in-progress: false/);
  const backend=production.indexOf('node scripts/worker-release-identity.mjs verify'),promotion=production.indexOf('name: Promote Jarvis homepage');
  assert.ok(backend>0&&backend<promotion);
  assert.ok(production.indexOf('Save rollback artifact before any overwrite')<production.indexOf('Stage Jarvis'));
  assert.ok(production.indexOf('Check every staged file')<promotion);
  assert.ok(production.indexOf('node scripts/worker-release-identity.mjs receipt')>production.indexOf("--test-name-pattern='live podcast discovery'"));
});
