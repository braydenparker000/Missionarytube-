import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('source qualification is complete once, with locked dependencies on each executing runner',async()=>{
  const source=await readFile(new URL('../.github/workflows/qualify-jarvis.yml',import.meta.url),'utf8');
  const component=source.slice(source.indexOf('\n  component:'),source.indexOf('\n  build:'));
  const checkout=component.indexOf('path: .jarvis-source'),install=component.indexOf('run: npm --prefix .jarvis-source ci'),execute=component.indexOf('node scripts/plan-jarvis-qualification.mjs run');
  assert.ok(checkout>=0&&checkout<install&&install<execute);
  assert.doesNotMatch(component.slice(install,execute),/--ignore-scripts|--omit(?:=|\s)|NODE_ENV:\s*production/);
  assert.match(source,/needs: \[plan, component, build\]/);
  assert.match(source,/test "\$COMPONENT_RESULT" = success/);
  for(const file of ['ci.yml','deploy-azure-storage.yml']){
    const workflow=await readFile(new URL('../.github/workflows/'+file,import.meta.url),'utf8');
    assert.match(workflow,/uses: \.\/\.github\/workflows\/qualify-jarvis\.yml/);
    assert.doesNotMatch(workflow,/npm run test:jarvis|npm --prefix \.jarvis-source test/);
  }
});
