import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createOrdersGalleryData } from '../src/chat/orders-gallery-data.js';
import { createGalleryRecordActions } from '../src/ui/gallery-record-actions.js';

const fields = { FILIAL: 'CENTRAL', FORNECEDOR: 'COFER LTDA', VALORTOTAL: 25, NOTAFISCAL: 'SUBMISSÃO DISPENSADA', OBSFISCAL: 'REGULAR', CONSTACNO: 'SIM', STATUS: 'PENDENTE AUDITORIA', DATAPGTOEFETUADO: '2026-10-03' };
const orderColumns = [
  { name: 'FILIAL', displayName: 'FILIAL', text: {} }, { name: 'FORNECEDOR', displayName: 'FORNECEDOR', text: {} },
  { name: 'VALORTOTAL', displayName: 'VALORTOTAL', currency: {} }, { name: 'NOTAFISCAL', displayName: 'NOTA FISCAL', choice: { choices: ['PENDENTE', 'SUBMETIDO', 'SUBMISSÃO DISPENSADA'] } },
  { name: 'OBSFISCAL', displayName: 'OBS FISCAL', text: { allowMultipleLines: true } }, { name: 'CONSTACNO', displayName: 'CONSTACNO', choice: { choices: ['SIM', 'NÃO', 'DISPENSADO'] } },
  { name: 'STATUS', displayName: 'STATUS', choice: { choices: ['PENDENTE AUDITORIA', 'APROVADO'] } },
  { name: 'DATAPGTOEFETUADO', displayName: 'DATAPGTOEFETUADO', dateTime: { format: 'dateOnly' } },
];
const launchLabels = ['AGRUPAR', 'FILIAL', 'FORNECEDOR', 'QUANTIDADE', 'VALOR UNITÁRIO', 'FRETE'];
const launchColumns = launchLabels.map((displayName, i) => ({ name: `launch_${i}`, displayName, text: {} }));
const launch = (id, values = {}) => ({ id: String(id), fields: Object.fromEntries(launchLabels.map((label, i) => [`launch_${i}`, ({ AGRUPAR: '42', FILIAL: 'CENTRAL', FORNECEDOR: 'COFER LTDA', QUANTIDADE: 2, 'VALOR UNITÁRIO': 10, FRETE: 5, ...values })[label]])) });
function fixture(overrides = {}) {
  const writes = []; const reads = []; let active = [launch(1)]; let attachments = [];
  const order = { id: '42', eTag: '"loaded"', fields: { ...fields } };
  const repository = {
    async resolveList(_site, aliases) { return { id: aliases[0], status: 'resolved' }; },
    async getColumns(_site, list) { return list === 'LANCAMENTOS' ? launchColumns : orderColumns; },
    async getItem(_site, list, id) { reads.push({ list, id }); return { ...order, id }; },
    async getItemsPage(_site, list, query) { reads.push({ list, query }); assert.equal(list, 'LANCAMENTOS', 'status approval must not require archive reads'); return { items: active, hasMore: false }; },
    async listAttachments(_site, list, id) { reads.push({ list, id, attachments: true }); return attachments; },
    async updateItem(_site, _list, id, values, options) { writes.push({ id, values, options }); return { id, fields: { ...order.fields, ...values } }; },
    ...overrides,
  };
  return { data: createOrdersGalleryData({ repository }), repository, writes, reads, order, setActive(value) { active = value; }, setAttachments(value) { attachments = value; } };
}

test('Form43 context exposes the source STATUS lock and valid normalized suppliers unlock it', async () => {
  const f = fixture(); f.setActive([launch(1, { FORNECEDOR: ' cofer\u00a0 \n\r ltda ' })]);
  const context = await f.data.loadEditor('42');
  assert.equal(typeof context.evaluateFieldLocks, 'function', 'Form43 requires effective conditional field locks');
  const locks = await context.evaluateFieldLocks({});
  assert.equal(locks.STATUS.editable, true);
  assert.deepEqual(locks.STATUS.reasons, []);
});

for (const [name, configure, reason] of [
  ['no linked active rows', f => f.setActive([launch(2, { AGRUPAR: '420' })]), /lançamento ativo/i],
  ['blank branch', f => { f.order.fields.FILIAL = ''; }, /filial/i],
  ['different branch', f => f.setActive([launch(1, { FILIAL: 'OUTRA' })]), /filial/i],
  ['blank supplier', f => { f.order.fields.FORNECEDOR = ''; }, /fornecedor/i],
  ['different supplier', f => f.setActive([launch(1, { FORNECEDOR: 'OUTRO' })]), /fornecedor/i],
  ['single supplier cannot use DIVERSOS', f => { f.order.fields.FORNECEDOR = 'DIVERSOS'; }, /fornecedor/i],
  ['total beyond one cent', f => { f.order.fields.VALORTOTAL = 25.011; }, /valor|centavo/i],
  ['blank fiscal state', f => { f.order.fields.NOTAFISCAL = ''; }, /nota fiscal/i],
  ['pending fiscal state', f => { f.order.fields.NOTAFISCAL = ' PENDENTE '; }, /nota fiscal/i],
  ['submitted fiscal state without an existing attachment', f => { f.order.fields.NOTAFISCAL = 'SUBMETIDO'; }, /anexo/i],
  ['blank fiscal observation', f => { f.order.fields.OBSFISCAL = '   '; }, /observação fiscal/i],
  ['invalid CNO state', f => { f.order.fields.CONSTACNO = 'NÃO'; }, /CNO/i],
]) test(`Form43 blocks every STATUS change when ${name}`, async () => {
  const f = fixture(); configure(f);
  f.order.fields.STATUS = 'APROVADO';
  const context = await f.data.loadEditor('42');
  await assert.rejects(f.data.saveEditor(context, { STATUS: 'PENDENTE AUDITORIA' }), reason);
  assert.equal(f.writes.length, 0);
});

test('Form43 permits multiple normalized suppliers under DIVERSOS and exactly one-cent monetary tolerance', async () => {
  const f = fixture();
  f.order.fields.FORNECEDOR = '  diversos  '; f.order.fields.VALORTOTAL = 25.01; f.order.fields.CONSTACNO = 'DISPENSADO';
  f.setActive([launch(10, { FORNECEDOR: 'A', QUANTIDADE: 1 }), launch(11, { FORNECEDOR: 'B', QUANTIDADE: 1, FRETE: 0 })]);
  const context = await f.data.loadEditor('42');
  await f.data.saveEditor(context, { STATUS: 'APROVADO' });
  assert.deepEqual(f.writes[0].values, { STATUS: 'APROVADO' });
  assert.equal(f.writes[0].options.eTag, '"loaded"');
});

test('Form43 re-reads current linked rows and attachments at save instead of trusting a previous UI unlock', async () => {
  const f = fixture(); f.order.fields.NOTAFISCAL = 'SUBMETIDO'; f.setAttachments([{ name: 'nf.pdf' }]);
  const context = await f.data.loadEditor('42');
  assert.equal(typeof context.evaluateFieldLocks, 'function');
  assert.equal((await context.evaluateFieldLocks({})).STATUS.editable, true);
  f.setAttachments([]);
  await assert.rejects(f.data.saveEditor(context, { STATUS: 'APROVADO' }), /anexo/i);
  assert.equal(f.writes.length, 0);
  f.setAttachments([{ name: 'nf.pdf' }]); f.setActive([]);
  await assert.rejects(f.data.saveEditor(context, { STATUS: 'APROVADO' }), /lançamento ativo/i);
  assert.equal(f.writes.length, 0);
});

test('Form43 validates outgoing draft fields and preserves the originally loaded ETag', async () => {
  const f = fixture(); const context = await f.data.loadEditor('42');
  f.order.fields.OBSFISCAL = ''; f.order.eTag = '"newer"';
  await assert.rejects(f.data.saveEditor(context, { STATUS: 'APROVADO' }), /observação fiscal/i);
  await f.data.saveEditor(context, { STATUS: 'APROVADO', OBSFISCAL: 'Fiscal conferido' });
  assert.equal(f.writes[0].options.eTag, '"loaded"');
});

test('blank audit date allows choosing STATUS but rejects submitting APROVADO without writes', async () => {
  const f = fixture(); f.order.fields.DATAPGTOEFETUADO = '';
  const context = await f.data.loadEditor('42');
  assert.equal((await context.evaluateFieldLocks({})).STATUS.editable, true, 'the source DisplayMode does not depend on the date');
  await assert.rejects(f.data.saveEditor(context, { STATUS: 'APROVADO' }), /data.*auditoria|DATAPGTOEFETUADO/i);
  assert.equal(f.writes.length, 0);
});

test('an approved draft with a newly supplied audit date passes with the originally loaded ETag', async () => {
  const f = fixture(); f.order.fields.DATAPGTOEFETUADO = '';
  const context = await f.data.loadEditor('42');
  await f.data.saveEditor(context, { STATUS: 'APROVADO', DATAPGTOEFETUADO: '2026-10-03' });
  assert.equal(f.writes[0].values.STATUS, 'APROVADO');
  assert.ok(f.writes[0].values.DATAPGTOEFETUADO.startsWith('2026-10-03'));
  assert.equal(f.writes[0].options.eTag, '"loaded"');
});

test('already approved edits require the current audit date even when STATUS is retained', async () => {
  const f = fixture(); f.order.fields.STATUS = 'APROVADO';
  const context = await f.data.loadEditor('42');
  f.order.fields.DATAPGTOEFETUADO = '';
  await assert.rejects(f.data.saveEditor(context, { OBSFISCAL: 'Nova conferência' }), /data.*auditoria|DATAPGTOEFETUADO/i);
  assert.equal(f.writes.length, 0);
});

for (const [name, values, configure, reason] of [
  ['pending fiscal state', { NOTAFISCAL: 'PENDENTE' }, () => {}, /nota fiscal/i],
  ['blank fiscal observation', { OBSFISCAL: '' }, () => {}, /observação fiscal/i],
  ['supplier discrepancy in freshly read launches', { OBSFISCAL: 'Nova conferência' }, f => f.setActive([launch(1, { FORNECEDOR: 'OUTRO' })]), /fornecedor/i],
  ['branch discrepancy in freshly read launches', { OBSFISCAL: 'Nova conferência' }, f => f.setActive([launch(1, { FILIAL: 'OUTRA' })]), /filial/i],
  ['no exactly linked active launches', { OBSFISCAL: 'Nova conferência' }, f => f.setActive([launch(1, { AGRUPAR: '420' })]), /lançamento ativo/i],
]) test(`retained APROVADO submit rejects ${name} without writes`, async () => {
  const f = fixture(); f.order.fields.STATUS = 'APROVADO';
  const context = await f.data.loadEditor('42');
  assert.equal((await context.evaluateFieldLocks({})).STATUS.editable, true);
  configure(f);
  await assert.rejects(f.data.saveEditor(context, values), reason);
  assert.equal(f.writes.length, 0);
});

test('retained APROVADO unrelated edits use the button rules without adding money, CNO or attachment conditions', async () => {
  const f = fixture({ async getColumns(_site, list) {
    return list === 'LANCAMENTOS' ? launchColumns.slice(0, 3) : orderColumns;
  } });
  Object.assign(f.order.fields, { STATUS: 'APROVADO', VALORTOTAL: 9999, CONSTACNO: 'NÃO', NOTAFISCAL: 'SUBMETIDO' });
  const context = await f.data.loadEditor('42');
  await f.data.saveEditor(context, { OBSFISCAL: 'Nova conferência' });
  assert.deepEqual(f.writes[0].values, { OBSFISCAL: 'NOVA CONFERÊNCIA' });
  assert.equal(f.writes[0].options.eTag, '"loaded"');
  assert.equal(f.reads.some(read => read.attachments), false, 'the source SUBMETER rule does not read attachment count');
  assert.equal(f.reads.filter(read => read.list === 'LANCAMENTOS').length, 1);
});

test('failed active or attachment reads never unlock Form43 STATUS', async () => {
  for (const overrides of [
    { async getItemsPage() { throw new Error('Lançamentos indisponíveis'); } },
    { async listAttachments() { throw new Error('Anexos indisponíveis'); } },
  ]) {
    const f = fixture(overrides); f.order.fields.NOTAFISCAL = 'SUBMETIDO';
    const context = await f.data.loadEditor('42');
    await assert.rejects(f.data.saveEditor(context, { STATUS: 'APROVADO' }), /indisponíveis/i);
    assert.equal(f.writes.length, 0);
  }
});

test('incomplete active pagination and ambiguous AGRUPAR metadata cannot unlock STATUS', async () => {
  for (const overrides of [
    { async getItemsPage() { return { items: [launch(1)], hasMore: true }; } },
    { async getColumns(_site, list) { return list === 'LANCAMENTOS' ? [...launchColumns, { name: 'other', displayName: 'AGRUPAR' }] : orderColumns; } },
  ]) {
    const f = fixture(overrides); const context = await f.data.loadEditor('42');
    await assert.rejects(f.data.saveEditor(context, { STATUS: 'APROVADO' }), /paginação|coluna|AGRUPAR/i);
    assert.equal(f.writes.length, 0);
  }
});

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
test('native Form43 STATUS and its visible selector follow changing draft locks while other fields remain editable', async t => {
  const dom = new JSDOM('<main></main>', { url: 'https://example.test' });
  const f = fixture();
  const actions = createGalleryRecordActions({ document: dom.window.document, host: dom.window.document.querySelector('main'), loadEditor: f.data.loadEditor, saveEditor: f.data.saveEditor });
  const buttons = actions.render({ id: '42', fields: {} }); dom.window.document.body.append(buttons);
  t.after(() => { actions.destroy(); dom.window.close(); });
  buttons.querySelector('[data-gallery-action="edit"]').click();
  for (let i = 0; i < 30 && !dom.window.document.querySelector('[data-dynamic-form]'); i++) await tick();
  await tick(); await tick();
  const form = dom.window.document.querySelector('[data-dynamic-form]'); assert.ok(form);
  const status = form.querySelector('[name="STATUS"]');
  assert.equal(status.disabled, false);
  const fiscal = form.querySelector('[name="NOTAFISCAL"]');
  fiscal.value = 'PENDENTE'; fiscal.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(); await tick();
  assert.equal(status.disabled, true, 'native selector must reflect DisplayMode.Disabled');
  const visible = status.closest('label').querySelector('input[role="combobox"]');
  assert.ok(visible); assert.equal(visible.disabled, true, 'visible searchable selector must also lock');
  assert.match(form.querySelector('[data-form43-status-lock]').textContent, /nota fiscal/i);
  assert.equal(form.querySelector('[name="OBSFISCAL"]').disabled, false);
  fiscal.value = 'SUBMISSÃO DISPENSADA'; fiscal.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  await tick(); await tick();
  assert.equal(status.disabled, false); assert.equal(visible.disabled, false);
});

test('a rejected STATUS save restores the effective native lock after the form restores disabled snapshots', async t => {
  const dom = new JSDOM('<main></main>', { url: 'https://example.test' });
  const f = fixture();
  const actions = createGalleryRecordActions({ document: dom.window.document, host: dom.window.document.querySelector('main'), loadEditor: f.data.loadEditor, saveEditor: f.data.saveEditor });
  const buttons = actions.render({ id: '42', fields: {} }); dom.window.document.body.append(buttons);
  t.after(() => { actions.destroy(); dom.window.close(); });
  buttons.querySelector('[data-gallery-action="edit"]').click();
  for (let i = 0; i < 30 && !dom.window.document.querySelector('[data-dynamic-form]'); i++) await tick();
  await tick(); await tick();
  const form = dom.window.document.querySelector('[data-dynamic-form]');
  const status = form.querySelector('[name="STATUS"]');
  const selector = status.closest('label').querySelector('input[role="combobox"]');
  selector.value = 'APROVADO'; selector.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  for (const key of ['ArrowDown', 'Enter']) selector.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  assert.equal(status.value, 'APROVADO');
  f.setActive([]);
  form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  await tick(); await tick();
  assert.equal(f.writes.length, 0);
  assert.match(dom.window.document.querySelector('.gallery-record-dialog-error').textContent, /lançamento ativo/i);
  assert.equal(status.disabled, true, 'failed persistence must not restore a stale unlocked status control');
  assert.equal(selector.disabled, true);
});

test('a stale Form43 unlock cannot bypass a newer draft waiting for attachment evidence', async t => {
  const active = deferred(); const attachments = deferred();
  const dom = new JSDOM('<main></main>', { url: 'https://example.test' });
  const f = fixture({ getItemsPage() { return active.promise; }, listAttachments() { return attachments.promise; } });
  const actions = createGalleryRecordActions({ document: dom.window.document, host: dom.window.document.querySelector('main'), loadEditor: f.data.loadEditor, saveEditor: f.data.saveEditor });
  const buttons = actions.render({ id: '42', fields: {} }); dom.window.document.body.append(buttons);
  t.after(() => { actions.destroy(); dom.window.close(); });
  buttons.querySelector('[data-gallery-action="edit"]').click();
  for (let i = 0; i < 30 && !dom.window.document.querySelector('[data-dynamic-form]'); i++) await tick();
  const form = dom.window.document.querySelector('[data-dynamic-form]');
  const status = form.querySelector('[name="STATUS"]');
  const fiscal = form.querySelector('[name="NOTAFISCAL"]');
  fiscal.value = 'SUBMETIDO'; fiscal.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  active.resolve({ items: [launch(1)], hasMore: false });
  await tick(); await tick();
  assert.equal(status.disabled, true, 'old attachment-free draft must not unlock the latest submitted draft');
  assert.match(form.querySelector('[data-form43-status-lock]').textContent, /Conferindo/);
  attachments.resolve([{ name: 'nf.pdf' }]); await tick(); await tick();
  assert.equal(status.disabled, false);
});
