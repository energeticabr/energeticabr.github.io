import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

const key = 'a'.repeat(64);
const date = '2090-08-15';
const itemId = 12;
const rows = [
  { id: String(itemId), fields: { Title: 'Fornecedor de teste', SITUACAO: 'Em aberto', CHAVE_DDA: key,
    CODIGO_BARRAS: '1'.repeat(44) } },
  { id: '13', fields: { Title: 'Pago', SITUACAO: 'Pago', CHAVE_DDA: 'b'.repeat(64),
    CODIGO_BARRAS: '2'.repeat(44) } },
];

async function gallery(t, schedulePayment) {
  const dom = new JSDOM('<body></body>');
  const view = createRegistrationGallery({ document: dom.window.document, kind: 'dda',
    data: { loadSnapshot: async () => ({ rows }) }, schedulePayment });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open();
  return dom.window.document;
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('AGENDAR asks for a date, reviews the bank quote and shows the scheduled day only after confirmation', async t => {
  const calls = [];
  const doc = await gallery(t, async (action, body) => {
    calls.push([action, body]);
    if (action === 'list') return { status: 'available', entries: [] };
    if (action === 'quote') return { status: 'quoted', date, amountCents: 1542,
      beneficiary: 'Beneficiário do banco', quoteId: 'c'.repeat(32), canConfirm: true };
    return { status: 'scheduled', itemId, key, date };
  });
  await flush();
  const button = doc.querySelector('[data-dda-schedule]');
  assert.equal(button.textContent, 'AGENDAR');
  assert.equal(doc.querySelectorAll('[data-dda-schedule]').length, 1);
  button.click();
  const dialog = doc.querySelector('[data-dda-schedule-dialog]');
  assert.ok(dialog);
  const input = dialog.querySelector('input[type=date]');
  input.value = date;
  dialog.querySelector('[data-dda-schedule-next]').click();
  await flush();
  assert.match(dialog.textContent, /Beneficiário do banco/);
  assert.match(dialog.textContent, /15,42/);
  assert.deepEqual(calls[1], ['quote', { itemId, key, date }]);
  assert.equal(calls.length, 2);
  dialog.querySelector('[data-dda-schedule-confirm]').click();
  await flush();
  assert.deepEqual(calls[2], ['confirm', { quoteId: 'c'.repeat(32) }]);
  const status = doc.querySelector('[data-registration-row="12"] [data-field="SITUACAO"]');
  assert.equal(status.dataset.statusTone, 'scheduled');
  assert.match(status.textContent, /Agendado.*15\/08\/2090/s);
});

test('a read-only bank quote leaves the calendar usable and never offers dispatch', async t => {
  const calls = [];
  const doc = await gallery(t, async (action, body) => {
    calls.push([action, body]);
    return action === 'list' ? { status: 'available', entries: [] }
      : { status: 'quoted', date, amountCents: 1542, beneficiary: 'Beneficiário do banco', canConfirm: false };
  });
  await flush();
  doc.querySelector('[data-dda-schedule]').click();
  const dialog = doc.querySelector('[data-dda-schedule-dialog]');
  dialog.querySelector('input[type=date]').value = date;
  dialog.querySelector('[data-dda-schedule-next]').click();
  await flush();
  assert.match(dialog.textContent, /Sicoob.*liber/i);
  assert.equal(dialog.querySelector('[data-dda-schedule-confirm]'), null);
  assert.deepEqual(calls.map(([action]) => action), ['list', 'quote']);
});
