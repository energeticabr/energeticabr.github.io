import test from 'node:test';
import assert from 'node:assert/strict';
import { createReportSessionCache } from '../src/report-session-cache.js';

test('default options and signal-only options share a key across frozen data sources', async () => {
  const cache = createReportSessionCache(); let reads = 0;
  const source = () => Object.freeze({ loadSnapshot: async () => ({ rows: [{ id: ++reads }] }) });
  assert.deepEqual(await cache.wrap('a', source()).loadSnapshot(), { rows: [{ id: 1 }] });
  assert.deepEqual(await cache.wrap('a', source()).loadSnapshot({ signal: new AbortController().signal }), { rows: [{ id: 1 }] });
});

for (const flag of ['incomplete', 'aborted', 'truncated', 'error', 'partial', 'hasMore', 'complete']) {
  test(`resolved ${flag} snapshot is not stored`, async () => {
    const cache = createReportSessionCache(); let reads = 0;
    const data = cache.wrap('a', { loadSnapshot: async () => ({ rows: [], [flag]: flag === 'complete' ? false : true, reads: ++reads }) });
    await data.loadSnapshot(); await data.loadSnapshot(); assert.equal(reads, 2);
  });
}

test('writes, permission checks and ordinary reads are never memoized', async () => {
  const cache = createReportSessionCache(); let writes = 0, grants = 0, pages = 0;
  const original = Object.freeze({ loadSnapshot: async () => ({ rows: [] }),
    saveEditor() { assert.equal(this, original); return ++writes; },
    checkPermissions() { return ++grants; }, loadPage() { return ++pages; } });
  const data = cache.wrap('a', original);
  await data.saveEditor(); await data.saveEditor(); await data.checkPermissions(); await data.checkPermissions();
  await data.loadPage(); await data.loadPage();
  assert.deepEqual([writes, grants, pages], [2, 2, 2]);
});

test('namespace invalidation retains unrelated successful snapshots', async () => {
  const cache = createReportSessionCache(); let a = 0, b = 0;
  const first = cache.wrap('a', { loadSnapshot: async () => ({ count: ++a }) });
  const second = cache.wrap('b', { loadSnapshot: async () => ({ count: ++b }) });
  await first.loadSnapshot(); await second.loadSnapshot(); cache.invalidate('a');
  assert.deepEqual(await first.loadSnapshot(), { count: 2 });
  assert.deepEqual(await second.loadSnapshot(), { count: 1 });
  cache.reset(); assert.deepEqual(await second.loadSnapshot(), { count: 2 });
});

test('provider and consumer mutations cannot corrupt a fulfilled snapshot', async () => {
  const cache = createReportSessionCache();
  const providerSnapshot = { rows: [{ id: '1', fields: { total: 120 } }] };
  const data = cache.wrap('a', { loadSnapshot: async () => providerSnapshot });
  const first = await data.loadSnapshot();
  providerSnapshot.rows[0].fields.total = 900;
  first.rows.push({ id: '2' });
  const hit = await data.loadSnapshot();
  assert.deepEqual(hit, { rows: [{ id: '1', fields: { total: 120 } }] });
  hit.rows[0].fields.total = 800;
  assert.deepEqual(await data.loadSnapshot(), { rows: [{ id: '1', fields: { total: 120 } }] });
});
