import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationStore } from '../src/chat/conversation-store.js';
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
