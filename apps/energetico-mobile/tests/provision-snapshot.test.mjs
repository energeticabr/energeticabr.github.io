import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createChatClient } from '../src/chat/chat-client.js';
import { provisionSnapshot, provisionFlow } from './helpers/provision-summary-fixture.mjs';

const module = await import('../src/chat/provision-snapshot.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const normalize = value => {
  assert.equal(typeof module.normalizeProvisionSnapshot, 'function', 'normalizer must be exported');
  return module.normalizeProvisionSnapshot(value);
};

test('canonical provision values are preserved exactly and detached from mutable input', () => {
  const source = provisionSnapshot();
  source.secret = 'private';
  Object.assign(source.lines[0], { unit: 'SC', editReply: 'unsafe', internal: { id: 4 } });
  source.lines[0].details.secret = 'private';
  const saved = normalize(source);
  assert.deepEqual(saved, provisionSnapshot());
  for (const object of [saved, saved.lines, saved.lines[0], saved.lines[0].details]) {
    assert.ok(Object.isFrozen(object));
  }
  source.lines[0].details.supplier = 'Mutated';
  source.lines[0].product = 'Mutated';
  source.lines.push(source.lines[0]);
  assert.equal(saved.lines.length, 2);
  assert.equal(saved.lines[0].details.supplier, 'Fornecedor A');
  assert.equal(saved.lines[0].product, 'Cimento');
});

test('malformed numbers and incomplete contracts are rejected as a whole', () => {
  const badNumbers = ['NaN', 'Infinity', '1e3', '1,25', 'R$ 2,00', ' 2', '2 ', '2\n', '2\r', '.5', '1.', '+2', '01', '', 2, null];
  for (const value of badNumbers) {
    assert.equal(normalize(provisionSnapshot({ total: value })), undefined, String(value));
    for (const key of ['quantity', 'unitPrice', 'freight', 'total']) {
      const source = provisionSnapshot();
      source.lines[1][key] = value;
      assert.equal(normalize(source), undefined, key + ': ' + String(value));
    }
  }
  for (const source of [undefined, null, {}, provisionSnapshot({ id: '' }),
    provisionSnapshot({ currency: 'USD' }), provisionSnapshot({ count: 3 }),
    provisionSnapshot({ count: '2' }), provisionSnapshot({ lines: null }),
    provisionSnapshot({ totalDisplay: 44.5 })]) assert.equal(normalize(source), undefined);
  for (const patch of [{ index: 0 }, { index: 1.5 }, { product: null },
    { details: null }, { details: {} }, { freightDisplay: 1.25 }]) {
    const source = provisionSnapshot();
    Object.assign(source.lines[0], patch);
    assert.equal(normalize(source), undefined);
  }
});

test('sparse line arrays cannot produce a misleading line count', () => {
  assert.equal(normalize(provisionSnapshot({ lines: new Array(2) })), undefined);
});

test('large precise values and zero-line snapshots do not pass through floating point', () => {
  const source = provisionSnapshot({ total: '9007199254740993.01', totalDisplay: 'R$ 9.007.199.254.740.993,01' });
  source.lines[0].quantity = '12345678901234567890.123456789';
  assert.equal(normalize(source).lines[0].quantity, '12345678901234567890.123456789');
  assert.equal(normalize(source).total, '9007199254740993.01');
  assert.deepEqual(normalize(provisionSnapshot({ count: 0, lines: [], total: '0', totalDisplay: 'R$ 0,00' })),
    { id: 'provision-batch-one', currency: 'BRL', count: 0, lines: [], total: '0', totalDisplay: 'R$ 0,00' });
});

test('store consumes provision snapshots on ingest, text confirmation and upload confirmation', () => {
  const store = createConversationStore();
  const source = provisionSnapshot();
  store.ingestRemoteMessages([], { activeFlow: provisionFlow(source) });
  assert.deepEqual(store.getState().activeFlow.provisionLines, provisionSnapshot());
  source.lines[0].product = 'Mutated';
  assert.equal(store.getState().activeFlow.provisionLines.lines[0].product, 'Cimento');
  const op = store.beginText('Próximo');
  store.confirmText(op, { activeFlow: provisionFlow(provisionSnapshot({ id: 'text-batch' })) });
  assert.equal(store.getState().activeFlow.provisionLines.id, 'text-batch');
  const [file] = store.queueFiles([{ name: 'nota.pdf', type: 'application/pdf', size: 1 }]);
  const upload = store.beginFile(file.id);
  store.confirmFile(upload, { activeFlow: provisionFlow(provisionSnapshot({ id: 'upload-batch' })) });
  assert.equal(store.getState().activeFlow.provisionLines.id, 'upload-batch');
});

test('store preserves confirmed totals on failure but removes absent, invalid or unrelated snapshots', () => {
  const store = createConversationStore();
  store.ingestRemoteMessages([], { activeFlow: provisionFlow(provisionSnapshot()) });
  const saved = store.getState().activeFlow.provisionLines;
  assert.ok(saved);
  const op = store.beginText('Próximo');
  store.failText(op, new Error('Offline'));
  assert.equal(store.getState().activeFlow.provisionLines, saved);
  store.ingestRemoteMessages([]);
  assert.equal(store.getState().activeFlow.provisionLines, saved);
  for (const activeFlow of [provisionFlow(undefined), provisionFlow(provisionSnapshot({ total: 'NaN' })),
    { ...provisionFlow(provisionSnapshot()), id: 'launch' }, null]) {
    store.ingestRemoteMessages([], { activeFlow });
    assert.equal(store.getState().activeFlow?.provisionLines, undefined);
  }
  store.ingestRemoteMessages([], { activeFlow: provisionFlow(provisionSnapshot()) });
  store.ingestRemoteMessages([], { resetConversation: true });
  assert.equal(store.getState().activeFlow, null);
});

test('normalization preserves payment provenance and rejects an explicit foreign owner', () => {
  const source = provisionSnapshot({ ownerFlow: 'payment' });
  const saved = normalize(source);
  assert.equal(saved.ownerFlow, 'payment');
  assert.ok(Object.isFrozen(saved));
  source.ownerFlow = 'launch';
  assert.equal(saved.ownerFlow, 'payment');
  for (const ownerFlow of ['launch', 'measurement', '', 'Payment', ' payment ', null, true, {}]) {
    assert.equal(normalize(provisionSnapshot({ ownerFlow })), undefined);
  }
});

const registrationIds = [
  'supply_product_registration', 'supply_supplier_registration',
  'supply_subfamily_registration', 'supply_family_registration', 'supply_group_registration',
];

// Real client JSON parsing and store response paths; only the HTTP boundary is replaced.
function portalClient(activeFlow) {
  return createChatClient({
    apiBaseUrl: 'https://provision.test', tokenProvider: async () => 'test-token',
    fetchImpl: async () => new Response(JSON.stringify({
      status: 'processed', activeFlow,
      messages: [{ type: 'text', text: 'Informe o nome para o cadastro' }],
    }), { headers: { 'Content-Type': 'application/json' } }),
  });
}

for (const id of registrationIds) {
  for (const path of ['ingest', 'text', 'upload']) {
    test(`transport → store keeps payment-owned lines and navigation id in ${id} (${path})`, async () => {
      const store = createConversationStore();
      const client = portalClient({
        id, title: 'CADASTRO', contextId: `embedded:${id}`,
        provisionLines: provisionSnapshot({ ownerFlow: 'payment' }),
      });
      if (path === 'upload') {
        const file = new File(['nota'], 'nota.pdf', { type: 'application/pdf' });
        const [queued] = store.queueFiles([file]);
        const operation = store.beginFile(queued.id);
        store.confirmFile(operation, await client.sendFile(file));
      } else {
        const operation = path === 'text' ? store.beginText('Cadastrar') : null;
        const result = await client.sendText({ text: 'Cadastrar' });
        if (operation) store.confirmText(operation, result);
        else store.ingestRemoteMessages(result.messages, result);
      }
      const flow = store.getState().activeFlow;
      assert.equal(flow.id, id);
      assert.equal(flow.title, 'CADASTRO');
      assert.equal(flow.contextId, `embedded:${id}`);
      assert.deepEqual(flow.provisionLines, provisionSnapshot({ ownerFlow: 'payment' }));
      assert.ok(Object.isFrozen(flow.provisionLines.lines[0].details));
    });
  }
}

test('transport → store clears unproven embedded snapshots and forged unrelated ownership', async () => {
  const store = createConversationStore();
  const rejected = [
    ...registrationIds.flatMap(id => [undefined, 'launch', null, 'Payment', ' payment '].map(ownerFlow => ({
      id, provisionLines: provisionSnapshot(ownerFlow === undefined ? {} : { ownerFlow }),
    }))),
    ...['launch', 'measurement', 'document_signing', 'other_registration', 'payment_registration'].map(id => ({
      id, provisionLines: provisionSnapshot({ ownerFlow: 'payment' }),
    })),
    { id: 'payment', provisionLines: provisionSnapshot({ ownerFlow: 'launch' }) },
  ];
  for (const candidate of rejected) {
    store.ingestRemoteMessages([], { activeFlow: provisionFlow(provisionSnapshot()) });
    const result = await portalClient({ title: 'CADASTRO', ...candidate }).sendText({ text: 'Próximo' });
    store.ingestRemoteMessages(result.messages, result);
    assert.equal(store.getState().activeFlow.id, candidate.id);
    assert.equal(store.getState().activeFlow.provisionLines, undefined, `${candidate.id}: ${candidate.provisionLines.ownerFlow}`);
  }
});
