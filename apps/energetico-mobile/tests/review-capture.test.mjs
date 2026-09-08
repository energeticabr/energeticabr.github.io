import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('review capture selects accepted iPhone and iPad sizes from actual Simulator inventory', async () => {
  const { selectReviewDevices } = await import('../scripts/capture-review.mjs');
  const result = selectReviewDevices({ devicetypes: [
    { name: 'iPhone 13 Pro Max', identifier: 'phone' },
    { name: 'iPad Pro 13-inch (M4) (16GB)', identifier: 'tablet' },
  ], runtimes: [{ name: 'iOS 26.0', identifier: 'ios', isAvailable: true }] });
  assert.equal(result.runtime, 'ios');
  assert.equal(result.phone, 'phone');
  assert.equal(result.tablet, 'tablet');
  assert.throws(() => selectReviewDevices({ devicetypes: [], runtimes: [] }), /Simulator/);
});

for (const navigationFails of [false, true]) {
  test(`prelogin diagnostics exclude secrets and survive navigation failure=${navigationFails}`, async t => {
    const { capturePreloginDiagnostics } = await import('../scripts/capture-review.mjs');
    assert.equal(typeof capturePreloginDiagnostics, 'function');
    const output = mkdtempSync(join(tmpdir(), 'review-prelogin-'));
    t.after(() => rmSync(output, { recursive: true, force: true }));
    const calls = [];
    const execute = (binary, args, options) => {
      calls.push([binary, args]);
      assert.equal(options.env.MAESTRO_REVIEW_USER, undefined);
      assert.equal(options.env.MAESTRO_REVIEW_PASSWORD, undefined);
      assert.equal(options.env.PATH, 'system-path');
      if (args.includes('test') && navigationFails) throw new Error('navigation failed');
      return args.includes('hierarchy') ? '<node text="Blank demonstration form"/>' : '';
    };
    const run = () => capturePreloginDiagnostics({ id: 'created-simulator', output, execute,
      environment: { PATH: 'system-path', MAESTRO_REVIEW_USER: 'private-user', MAESTRO_REVIEW_PASSWORD: 'private-password' } });
    if (navigationFails) assert.throws(run, /navigation failed/);
    else run();
    assert.equal(calls.length, 3);
    assert.ok(calls[0][1].includes('tests/review-prelogin.yaml'));
    assert.deepEqual(calls[1][1].slice(0, 4), ['simctl', 'io', 'created-simulator', 'screenshot']);
    assert.deepEqual(calls[2][1], ['--device', 'created-simulator', 'hierarchy']);
    assert.equal(readFileSync(join(output, 'hierarchy.txt'), 'utf8'), '<node text="Blank demonstration form"/>');
  });
}
