import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const timezone of ['UTC', 'America/Sao_Paulo']) {
  test(`due-date controller and adapter regressions pass in ${timezone}`, () => {
    const env = { ...process.env, TZ: timezone };
    // Node otherwise treats the nested runner as a recursive test worker and skips it.
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', '--test-reporter=tap',
      'tests/pending-provision-due-date-controller-integration.test.mjs',
      'tests/provision-description-edit-integration.test.mjs',
      'tests/pending-provision-date-calendar.test.mjs'], {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      env, encoding: 'utf8', timeout: 30000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${timezone}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /^# tests 19$/m, 'all 19 regressions must actually execute');
    assert.match(result.stdout, /^# pass 19$/m);
    assert.match(result.stdout, /^# fail 0$/m);
  });
}
