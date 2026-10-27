import test from 'node:test';
import assert from 'node:assert/strict';
import { createMealVoucherTray } from '../src/chat/meal-voucher-tray.js';

function fixture(load, deleteAttachment = async () => {}) {
  const state = { attachments: ['a', 'b'].map(id => ({ id, fileName: id + '.pdf', size: 3, mimeType: 'application/pdf', mediaUrl: '/' + id })), pendingFiles: [] };
  const store = { getState: () => state, removeAttachment: id => { state.attachments = state.attachments.filter(item => item.id !== id); } };
  const tray = createMealVoucherTray({ store, assertSession() {}, load, deleteAttachment });
  return { tray, selected: tray.snapshot() };
}

test('tray reads forward scoped bytes and report completed files while another read is pending', async () => {
  let release, count = 0; const seen = [];
  const { tray, selected } = fixture(async (_item, options) => {
    count++;
    options?.onProgress?.({ loaded: 1, total: 3, percent: 33 });
    if (count === 2) await new Promise(resolve => { release = resolve; });
    return new Blob(['pdf'], { type: 'application/pdf' });
  });
  const read = tray.read(selected, [], { onProgress: value => seen.push(value) });
  await new Promise(setImmediate);
  assert.ok(seen.some(value => value.percent > 0 && value.percent < 100));
  assert.ok(seen.every(value => value.percent < 100));
  release();
  assert.equal((await read).length, 2);
  assert.equal(seen.at(-1).percent, 100);
});

test('tray cleanup only reaches completion after all durable delete confirmations', async () => {
  const seen = []; let release, count = 0;
  const { tray, selected } = fixture(async () => new Blob(), async () => {
    if (++count === 2) await new Promise(resolve => { release = resolve; });
  });
  const pending = tray.consume(selected, { onProgress: value => seen.push(value.percent) });
  await new Promise(setImmediate);
  assert.ok(seen.some(value => value > 0 && value < 100));
  assert.ok(seen.every(value => value < 100));
  release(); await pending; assert.equal(seen.at(-1), 100);
});

test('cleanup failures and cancelled reads cannot fabricate successful progress', async () => {
  const seen = [], { tray, selected } = fixture(async () => new Blob(), async () => { throw new Error('network'); });
  await assert.rejects(tray.consume(selected, { onProgress: value => seen.push(value.percent) }), /Não repita o lançamento/);
  assert.ok(seen.every(value => value < 100));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(tray.read(tray.snapshot(), [], { signal: controller.signal }), { name: 'AbortError' });
});
