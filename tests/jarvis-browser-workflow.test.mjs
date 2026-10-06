import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// The full source gate uses the runner's Google Chrome, with Chromium fallback.
// Supplying that same validated path lets the CI-required recovery journey run
// without replacing the already-qualified player browser with another build.
for (const file of ['ci.yml', 'deploy-azure-storage.yml']) {
  test(file + ': release checks provide the source-validated browser before Jarvis validation', async () => {
    const source = await readFile(new URL('../.github/workflows/' + file, import.meta.url), 'utf8');
    const start = source.indexOf('      - name: Use the source-validated browser for Jarvis checks');
    const finish = source.indexOf('      - name: Validate Jarvis');
    assert.ok(start >= 0 && finish > start);
    const step = source.slice(start, finish);
    assert.match(step, /command -v google-chrome \|\| command -v chromium/);
    assert.match(step, /test -n "\$jarvis_chromium_path"/);
    assert.match(step, /test -x "\$jarvis_chromium_path"/);
    assert.match(step, /JARVIS_CHROME=%s\\n/);
    assert.match(step, />> "\$GITHUB_ENV"/);
    assert.match(source.slice(finish), /run: npm run test:jarvis/);
    assert.ok(source.indexOf('run: npm --prefix .jarvis-source ci') < start);
    assert.ok(source.indexOf('run: npm test') < start);
    assert.doesNotMatch(step, /CLOUDFLARE|AZURE|secret|token|--browser=|skip|install/);
  });
}
