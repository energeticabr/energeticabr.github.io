import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatClient } from '../src/chat/chat-client.js';

const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const create = fetchImpl => createChatClient({ apiBaseUrl: 'https://vm.example', tokenProvider: async () => 'safe-test-token', randomUUID: () => 'progress-request', fetchImpl });
const confirmed = { status: 'processed', messages: [], operationProgress: { requestId: 'progress-request', percent: 100, status: 'complete' } };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('resume reports authenticated stages then VM progress without resubmitting the conversation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveMain; const requests = [], seen = [];
  const client = create(async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (body.action === 'operation_progress') return json({ requestId: body.requestId, percent: 60, status: 'running', completed: 3, total: 5 });
    return new Promise(resolve => { resolveMain = resolve; });
  });
  const pending = client.sendText({ replyId: 'input_continue', onOperationProgress: value => seen.push(value.percent) });
  await flush();
  assert.equal(requests[0].progressRequestId, 'progress-request');
  assert.equal(requests[0].trackDiaryEvidence, undefined);
  assert.ok(seen.includes(33));
  t.mock.timers.tick(1000); await flush();
  assert.ok(seen.includes(53), seen.join(','));
  assert.equal(requests.filter(body => body.replyId === 'input_continue').length, 1);
  resolveMain(json(confirmed)); await pending;
  assert.equal(seen.at(-1), 100);
});

test('optional progress failure and early server completion never retry or finish the pending write', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let resolveMain; const seen = [], requests = [];
  const client = create(async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (body.action === 'operation_progress') return json({ requestId: body.requestId, percent: 100, status: 'complete' });
    return new Promise(resolve => { resolveMain = resolve; });
  });
  const pending = client.sendText({ text: 'SIM', onOperationProgress: value => seen.push(value.percent) });
  await flush(); t.mock.timers.tick(1000); await flush();
  assert.ok(seen.every(value => value < 100));
  resolveMain(json({ status: 'processed_with_recovery', messages: [], error: 'uncertain' }));
  await pending;
  assert.ok(seen.every(value => value < 100));
  assert.equal(requests.filter(body => body.text === 'SIM').length, 1);
});

test('gallery progress is separately scoped and never leaks telemetry metadata into filters', async () => {
  let sent; const seen = [];
  const client = create(async (_url, options) => {
    sent = JSON.parse(options.body);
    return json({ ...confirmed, launchGallery: { rows: [] } });
  });
  await client.launchGalleryRequest('snapshot', { filters: { search: 'Luiz' } }, { onProgress: value => seen.push(value.percent) });
  assert.equal(sent.progressRequestId, 'progress-request');
  assert.deepEqual(sent.payload, { filters: { search: 'Luiz' } });
  assert.equal(seen.at(-1), 100);
});

test('aborted presentation ignores late progress without cancelling or repeating a business write', async () => {
  const controller = new AbortController(); let resolveMain; const seen = [];
  const client = create(async () => new Promise(resolve => { resolveMain = resolve; }));
  const pending = client.sendText({ text: 'SIM', progressSignal: controller.signal, onOperationProgress: value => seen.push(value.percent) });
  await flush(); controller.abort(); const previous = [...seen];
  resolveMain(json(confirmed)); await pending;
  assert.deepEqual(seen, previous);
});
