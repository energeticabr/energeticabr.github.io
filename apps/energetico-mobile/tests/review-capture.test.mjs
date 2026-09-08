import test from 'node:test';
import assert from 'node:assert/strict';

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
