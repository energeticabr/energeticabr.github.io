import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const workerSource = await readFile(new URL('../pwa/service-worker.js', import.meta.url), 'utf8');

async function workerRequest(url, response, cachedResponse) {
  const handlers = new Map(), writes = [], network = [];
  runInNewContext(workerSource, {
    URL,
    self: { location: new URL('https://app.test/energetico/service-worker.js'), addEventListener: (name, fn) => handlers.set(name, fn) },
    caches: { match: async () => cachedResponse, open: async () => ({ put: async (key, value) => writes.push({ key, status: value.status }) }) },
    fetch: async (request, options) => { network.push({ request, options }); return response; },
  });
  let task;
  handlers.get('fetch')({ request: new Request(url), respondWith: promise => { task = promise; } });
  const result = await task;
  await new Promise(resolve => setImmediate(resolve));
  return { result, writes, network };
}

test('a missing old JavaScript chunk is not cached as a permanent failed report', async () => {
  const { result, writes } = await workerRequest('https://app.test/energetico/assets/report-old.js', new Response('Not found', { status: 404 }));
  assert.equal(result.status, 404);
  assert.equal(writes.length, 0);
});

test('an old cached 404 is replaced when the retained report asset becomes available again', async () => {
  const { result, writes, network } = await workerRequest('https://app.test/energetico/assets/report-old.js', new Response('export const report = 1'), new Response('Not found', { status: 404 }));
  assert.equal(result.status, 200);
  assert.equal(await result.text(), 'export const report = 1');
  assert.equal(network.length, 1);
  assert.equal(writes.length, 1);
});

test('a previously cached successful report continues to open without a network request', async () => {
  const { result, network } = await workerRequest('https://app.test/energetico/assets/report-old.js', new Response('', { status: 503 }), new Response('export const report = 1'));
  assert.equal(await result.text(), 'export const report = 1');
  assert.equal(network.length, 0);
});

test('successful immutable report assets remain available for offline caching', async () => {
  const { result, writes } = await workerRequest('https://app.test/energetico/assets/report-current.js', new Response('export const report = 1', { headers: { 'Content-Type': 'application/javascript' } }));
  assert.equal(result.status, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key.url, 'https://app.test/energetico/assets/report-current.js');
});
