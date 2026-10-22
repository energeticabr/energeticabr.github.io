import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatClient } from '../src/chat/chat-client.js';
import { createSharePointRestTransport } from '../../../portal/data/attachments.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function streamedResponse(headers) {
  let stream;
  const response = new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers });
  return { response, push: bytes => stream.enqueue(Uint8Array.from(bytes)), finish: () => stream.close() };
}
function request(channel, response, options) {
  if (channel === 'VM') return createChatClient({
    apiBaseUrl: 'https://api.example.test', tokenProvider: async () => 'test-only', fetchImpl: async () => response,
  }).fetchMedia({ mediaUrl: '/api/portal-media/attachment' }, options);
  return createSharePointRestTransport({
    tokenProvider: async () => 'test-only', allowedSites: [{ host: 'tenant.sharepoint.com', path: '/sites/test' }], fetch: async () => response,
  }).request({ host: 'tenant.sharepoint.com', path: '/sites/test' }, '/_api/web/test/$value', { ...options, responseType: 'arrayBuffer' });
}
for (const channel of ['VM', 'SharePoint']) {
  test(`${channel} hidden CORS encoding cannot mislabel or reject a complete decoded body`, async () => {
    const stream = streamedResponse({ 'Content-Length': '8' }), progress = [];
    Object.defineProperty(stream.response, 'type', { value: 'cors' });
    const pending = request(channel, stream.response, { onProgress: value => progress.push(value) });
    stream.push(new Array(20).fill(1)); await tick(); stream.finish();
    const result = await pending;
    assert.equal(result instanceof Blob ? result.size : result.byteLength, 20);
    assert.ok(progress.slice(0, -1).every(value => value.percent === null));
    assert.equal(progress.at(-1).percent, 100);
  });
  test(`${channel} a trusted identity response with missing bytes rejects without 100%`, async () => {
    const stream = streamedResponse({ 'Content-Length': '8', 'Content-Encoding': 'identity' }), progress = [];
    const pending = request(channel, stream.response, { onProgress: value => progress.push(value) });
    const rejection = assert.rejects(pending, channel === 'VM' ? /conexão foi interrompida/i : /incompleto/i);
    stream.push([1, 2]); stream.finish(); await rejection;
    assert.ok(!progress.some(value => value.percent === 100));
  });
  test(`${channel} attachment reports actual received bytes before the download finishes`, async () => {
    const stream = streamedResponse({ 'Content-Length': '8', 'Content-Type': 'application/pdf' }), progress = [];
    const pending = request(channel, stream.response, { onProgress: value => progress.push(value) });
    stream.push([1, 2]); await tick();
    assert.ok(progress.some(value => value.loaded === 2 && value.total === 8 && value.percent === 25));
    assert.ok(!progress.some(value => value.percent === 100));
    stream.push([3, 4]); await tick();
    assert.ok(progress.some(value => value.loaded === 4 && value.percent === 50));
    stream.push([5, 6, 7, 8]); stream.finish();
    const result = await pending;
    const bytes = result instanceof Blob ? await result.arrayBuffer() : result;
    assert.deepEqual([...new Uint8Array(bytes)], [1, 2, 3, 4, 5, 6, 7, 8]);
    assert.equal(progress.at(-1).percent, 100);
  });
  for (const headers of [{}, { 'Content-Length': '5', 'Content-Encoding': 'gzip' }]) {
    test(`${channel} unknown or encoded length never invents an intermediate percentage: ${JSON.stringify(headers)}`, async () => {
      const stream = streamedResponse(headers), progress = [];
      const pending = request(channel, stream.response, { onProgress: value => progress.push(value) });
      stream.push([1, 2]); await tick();
      assert.ok(progress.some(value => value.loaded === 2 && value.total === null && value.percent === null));
      stream.push([3, 4, 5, 6]); stream.finish(); await pending;
      assert.equal(progress.at(-1).percent, 100);
      assert.ok(progress.slice(0, -1).every(value => value.percent === null));
    });
  }
  test(`${channel} cancelling a stalled body rejects and never reports completion`, async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } }), { headers: { 'Content-Length': '10' } });
    const abort = new AbortController(), progress = [];
    const pending = request(channel, response, { signal: abort.signal, onProgress: value => progress.push(value) });
    const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    await tick(); abort.abort();
    await Promise.race([rejected, new Promise((_, reject) => { const timeout = setTimeout(() => reject(new Error('cancel did not interrupt the body')), 500); timeout.unref(); })]);
    assert.equal(cancelled, true);
    assert.ok(!progress.some(value => value.percent === 100));
  });
}
