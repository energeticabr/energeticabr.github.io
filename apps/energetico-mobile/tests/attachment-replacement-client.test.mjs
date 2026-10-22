import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatClient } from '../src/chat/chat-client.js';

const id = 'a'.repeat(64), newId = 'b'.repeat(64), sha = 'c'.repeat(64);
const requestId = '74728688-9c56-41d6-924a-7261dd4f7d10';
const file = new File(['%PDF-fixture'], 'foto.pdf', { type: 'application/pdf' });
function receipt(overrides = {}) {
  const replacement = { id: newId, fileName: file.name, mimeType: 'application/pdf', size: file.size, mediaUrl: '/api/portal-media/new' };
  return { status: 'processed', messages: [], operation: 'attachment_replaced', requestId, previousAttachmentId: id, replacement,
    attachments: [replacement], ...overrides };
}
function setup(reply) {
  const sent = [];
  const client = createChatClient({ apiBaseUrl: 'https://example.test', tokenProvider: async () => 'token', retryDelay: async () => {},
    fetchImpl: async (url, options) => { sent.push({ url: new URL(url), options }); return Response.json(await reply(sent)); } });
  return { client, sent };
}

test('replacement sends an idempotent raw PDF to the scoped upload operation, not a chat reply', async () => {
  const { client, sent } = setup(() => receipt());
  const progress = [];
  const result = await client.replaceAttachment(id, file, { expectedSha256: sha, requestId, onProgress: p => progress.push(p.percent) });
  assert.equal(result.replacement.id, newId);
  assert.equal(sent.length, 1);
  const { url, options } = sent[0];
  assert.equal(url.pathname, '/api/portal-upload');
  assert.deepEqual(Object.fromEntries(url.searchParams), { operation: 'attachment_replace', attachment_id: id, expected_sha256: sha, request_id: requestId });
  assert.equal(options.headers.Authorization, 'Bearer token');
  assert.equal(options.headers['Content-Type'], 'application/pdf');
  assert.equal(options.headers['X-Portal-Message-Id'], requestId);
  assert.equal(options.body, file);
  assert.equal(options.cache, 'no-store');
  assert.equal(progress.at(-1), 100);
});

test('replacement rejects generic or mismatched acknowledgements without reporting completion', async () => {
  for (const response of [
    { status: 'processed', messages: [] }, receipt({ requestId: 'different' }), receipt({ previousAttachmentId: newId }),
    receipt({ attachments: [] }), receipt({ replacement: { ...receipt().replacement, size: file.size + 1 } }),
    receipt({ attachments: [...receipt().attachments, { id }] }),
  ]) {
    const { client } = setup(() => response), progress = [];
    await assert.rejects(client.replaceAttachment(id, file, { expectedSha256: sha, requestId, onProgress: p => progress.push(p.percent) }), /confirm|substitui/i);
    assert.ok(!progress.includes(100));
  }
});

test('replacement validates target and original hash before network and honours cancelled uploads', async () => {
  const { client, sent } = setup(() => receipt());
  await assert.rejects(client.replaceAttachment('wrong', file, { expectedSha256: sha, requestId }), /identific|inválid/i);
  await assert.rejects(client.replaceAttachment(id, file, { expectedSha256: 'wrong', requestId }), /hash|inválid/i);
  const abort = new AbortController(); abort.abort();
  await assert.rejects(client.replaceAttachment(id, file, { expectedSha256: sha, requestId, progressSignal: abort.signal }), { name: 'AbortError' });
  assert.equal(sent.length, 0);
});

test('transient retry retains exact replacement identity and PDF bytes', async () => {
  const { client, sent } = setup(calls => { if (calls.length === 1) throw new TypeError('network'); return receipt(); });
  await client.replaceAttachment(id, file, { expectedSha256: sha, requestId });
  assert.equal(sent.length, 2);
  assert.equal(sent[0].url.href, sent[1].url.href);
  assert.equal(sent[0].options.headers['X-Portal-Message-Id'], sent[1].options.headers['X-Portal-Message-Id']);
  assert.equal(sent[0].options.body, sent[1].options.body);
});
