import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// A CI=1 recovery browser test must have the pinned source runtime and a
// verified executable path before npm test; an optional local skip is not proof.
for (const file of ['ci.yml', 'deploy-azure-storage.yml']) {
  test(file + ': release checks provide the locked Jarvis Chromium before validation', async () => {
    const source = await readFile(new URL('../.github/workflows/' + file, import.meta.url), 'utf8');
    const start = source.indexOf('      - name: Install locked Jarvis browser for recovery validation');
    const finish = source.indexOf('      - name: Validate Jarvis');
    assert.ok(start >= 0 && finish > start);
    const step = source.slice(start, finish);
    assert.match(step, /working-directory: \.jarvis-source/);
    assert.match(step, /npx --no-install playwright-core install --with-deps chromium/);
    assert.match(step, /chromium\.executablePath\(\)/);
    assert.match(step, /test -x "\$jarvis_chromium_path"/);
    assert.match(step, /JARVIS_CHROME=%s\\n/);
    assert.match(step, />> "\$GITHUB_ENV"/);
    assert.match(source.slice(finish), /run: npm run test:jarvis/);
    assert.ok(source.indexOf('run: npm --prefix .jarvis-source ci') < start);
    assert.ok(source.indexOf('run: npm test') < start);
    assert.doesNotMatch(step, /CLOUDFLARE|AZURE|secret|token|--browser=|skip/);
  });
}
