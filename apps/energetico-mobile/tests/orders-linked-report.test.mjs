import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createOrdersGalleryData } from '../src/chat/orders-gallery-data.js';
import { createOrdersGallery } from '../src/ui/orders-gallery-view.js';

const ORDER_FIELDS = ['DATAPGTOEFETUADO', 'FILIAL', 'FORNECEDOR', 'FORMAPGTO', 'VALORTOTAL', 'OBS', 'NOTA FISCAL', 'OBS FISCAL', 'STATUS'];
const ACTIVE_FIELDS = ['AGRUPAR', 'DATA', 'FILIAL', 'FORNECEDOR', 'CONTA', 'PRODUTO', 'DESCRIÇÃO', 'QUANTIDADE', 'VALOR UNITÁRIO', 'FRETE', 'APROVACAO'];
const ARCHIVE_FIELDS = ['AGRUPAR', 'DATA', 'FORNECEDOR', 'CONTA', 'PRODUTO', 'DESCRIÇÃO', 'QUANTIDADE', 'VALOR UNITÁRIO', 'FRETE', 'ID 2', 'DATAEXCLUSAO'];
const schemas = { NOTASPENDENTES: ORDER_FIELDS, LANCAMENTOS: ACTIVE_FIELDS, ARQUIVOLANCAMENTOS: ARCHIVE_FIELDS };
const columnsFor = name => schemas[name].map((displayName, index) => ({ name: `physical_${index}`, displayName }));
const encode = (name, fields) => Object.fromEntries(columnsFor(name).filter(column => Object.hasOwn(fields, column.displayName)).map(column => [column.name, fields[column.displayName]]));

function harness(overrides = {}) {
  const reads = [];
  const orderFields = { FILIAL: 'CENTRAL', FORNECEDOR: 'COFER', FORMAPGTO: 'CAIXA', VALORTOTAL: '125,015', OBS: '<img src=x onerror=alert(1)>', 'NOTA FISCAL': ' pendente ', STATUS: 'PAGO' };
  const active = [
    { id: '12', fields: encode('LANCAMENTOS', { AGRUPAR: '319', FILIAL: 'CENTRAL', FORNECEDOR: 'COFER', CONTA: 'CAIXA', PRODUTO: 'Cimento', 'DESCRIÇÃO': '<script>bad()</script>', QUANTIDADE: 2, 'VALOR UNITÁRIO': '10,005', FRETE: 5, APROVACAO: 'aprovado por pessoa' }) },
    { id: '15', fields: encode('LANCAMENTOS', { AGRUPAR: '319', FILIAL: 'OUTRA', FORNECEDOR: 'ZETA', CONTA: 'BANCO', PRODUTO: 'Areia', QUANTIDADE: 1, 'VALOR UNITÁRIO': 100, FRETE: '0,005', APROVACAO: ' PENDENTE DE APROVAÇÃO ' }) },
    { id: '16', fields: encode('LANCAMENTOS', { AGRUPAR: '320', FORNECEDOR: 'OUTRO PEDIDO', QUANTIDADE: 1000, 'VALOR UNITÁRIO': 500 }) },
    { id: '17', fields: encode('LANCAMENTOS', { AGRUPAR: '3190', FORNECEDOR: 'PREFIXO NÃO SERVE', QUANTIDADE: 1000, 'VALOR UNITÁRIO': 500 }) },
  ];
  const archived = [{ id: '90', createdBy: { user: { displayName: 'Bernardo' } }, fields: encode('ARQUIVOLANCAMENTOS', { AGRUPAR: '319', 'ID 2': 7, FORNECEDOR: 'COFER', PRODUTO: 'Deletado', QUANTIDADE: 999, 'VALOR UNITÁRIO': 500, DATAEXCLUSAO: '2026-10-01T17:35:00Z' }) }];
  const repository = {
    async resolveList(_site, aliases) { return { id: aliases[0], status: 'resolved' }; },
    async getColumns(_site, list) { return columnsFor(list); },
    async getItem(_site, list, id) { reads.push({ list, id }); return { id, fields: encode('NOTASPENDENTES', orderFields) }; },
    async getItemsPage(_site, list, query, options) {
      reads.push({ list, query, options });
      if (list === 'ARQUIVOLANCAMENTOS') return { items: archived, hasMore: false };
      return options.cursor ? { items: [active[0], ...active.slice(1)], hasMore: false } : { items: [active[0]], hasMore: true, nextLink: 'active-page-2' };
    },
    ...overrides,
  };
  const data = createOrdersGalleryData({ repository });
  return { data, repository, reads, active, archived, orderFields };
}

async function report(ctx, id = '319', options) {
  assert.equal(typeof ctx.data.loadLinkedReport, 'function', 'mascot requires the exact-order linked report service');
  return ctx.data.loadLinkedReport(id, options);
}

test('linked report reads the selected order and all exactly grouped active and archived pages using metadata', async () => {
  const ctx = harness();
  const result = await report(ctx);
  assert.equal(result.orderId, '319');
  assert.equal(result.order.fields.FORNECEDOR, 'COFER');
  assert.deepEqual(result.active.map(row => row.id), ['12', '15']);
  assert.deepEqual(result.deleted.map(row => row.id), ['90']);
  assert.equal(result.deleted[0].fields['ID 2'], 7);
  assert.equal(result.deleted[0].fields['Criado por'], 'Bernardo');
  assert.equal(result.summary.activeCount, 2);
  assert.equal(result.summary.deletedCount, 1);
  assert.equal(result.summary.activeTotal, 125.015, 'multiply quantity and unit then add freight once; exclude deleted rows');
  assert.equal(result.summary.totalDiffers, false, 'PowerApps compares rounded two-decimal values');
  assert.equal(result.summary.difference, 0);
  assert.deepEqual(result.divergences.branch, ['15']);
  assert.deepEqual(result.divergences.supplier, ['15']);
  assert.deepEqual(result.divergences.paymentForm, ['15']);
  assert.deepEqual(ctx.reads.find(read => read.id), { list: 'NOTASPENDENTES', id: '319' });
  for (const read of ctx.reads.filter(read => read.query)) {
    assert.match(read.query, /fields\/physical_0 eq '319'/);
    assert.match(read.query, /fields\(\$select=physical_/);
  }
  assert.equal(ctx.reads.filter(read => read.list === 'LANCAMENTOS').length, 2);
});

test('failed related reads never become a zero count report', async () => {
  const ctx = harness({ async getItemsPage(_site, list) { if (list === 'ARQUIVOLANCAMENTOS') throw new Error('Sem acesso ao arquivo'); return { items: [], hasMore: false }; } });
  await assert.rejects(report(ctx), /Sem acesso ao arquivo/);
});

test('linked report rejects incomplete or cyclic pagination rather than displaying partial sums', async () => {
  for (const invalid of [{ items: [], hasMore: true }, { items: [], hasMore: true, nextLink: 'repeated' }, { hasMore: false }]) {
    const ctx = harness({ async getItemsPage() { return invalid; } });
    await assert.rejects(report(ctx), /pagina|cursor|resposta/i);
  }
});

test('linked report fails clearly for an unavailable order or ambiguous relation column', async () => {
  const ctx = harness({ async getItem() { return null; } });
  await assert.rejects(report(ctx), /pedido.*(encontrado|disponível)/i);
  const ambiguous = harness({ async getColumns(_site, list) { return list === 'LANCAMENTOS' ? [...columnsFor(list), { name: 'another', displayName: 'AGRUPAR' }] : columnsFor(list); } });
  await assert.rejects(report(ambiguous), /AGRUPAR.*(amb|comprov)|coluna.*AGRUPAR/i);
});

test('aborted reads are discarded even if the repository resolves after cancellation', async () => {
  const releases = [];
  const ctx = harness({ getItemsPage() { return new Promise(resolve => { releases.push(resolve); }); } });
  const controller = new AbortController();
  const pending = report(ctx, '319', { signal: controller.signal });
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  await tick(); await tick();
  controller.abort();
  for (const release of releases) release({ items: [], hasMore: false });
  await rejected;
  await assert.rejects(report(ctx, '319', { signal: controller.signal }), error => error.name === 'AbortError');
});

const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function galleryHarness(t, loadLinkedReport) {
  const dom = new JSDOM('<button id="source">Abrir pedidos</button>', { url: 'https://example.test' });
  const rows = ['319', '320'].map(id => ({ id, hasAttachments: false, fields: { ID: id, FORNECEDOR: `CARTÃO ${id}` } }));
  const calls = [];
  const gallery = createOrdersGallery({ document: dom.window.document, data: {
    async loadSnapshot() { return { rows }; },
    async loadLinkedReport(id, options) { calls.push([id, options]); return loadLinkedReport(id, options); },
  } });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  return { gallery, calls, dom, root: dom.window.document.querySelector('.og-overlay'), panel: dom.window.document.querySelector('.og-detail'), mascot(id) { return dom.window.document.querySelector(`.og-card[data-item-id="${id}"] [data-action="mascot-details"]`); } };
}

test('mascot keeps the linked-order report while the separate Details action is absent', async t => {
  const data = harness();
  const ctx = await galleryHarness(t, id => report(data, id));
  ctx.mascot('319').click();
  await tick(); await tick();
  assert.equal(ctx.calls[0]?.[0], '319', 'mascot must query the selected ID');
  assert.ok(ctx.panel.querySelector('.olr-report'));
  for (const label of ['CABEÇALHO DO PEDIDO', 'Lançamentos vinculados ao pedido 319', 'ITENS DELETADOS', 'SOMA LANÇAMENTOS', 'DIFERENÇA']) assert.ok(ctx.panel.textContent.includes(label), label);
  assert.equal(ctx.panel.querySelectorAll('.olr-launch-row--active').length, 2);
  assert.equal(ctx.panel.querySelectorAll('.olr-launch-row--deleted').length, 1);
  assert.equal(ctx.panel.querySelector('thead tr').children.length, 11);
  assert.match(ctx.panel.textContent, /por Bernardo/);
  assert.match(ctx.panel.textContent, /01\/10\/2026 14:35/);
  assert.match(ctx.panel.textContent, /<script>bad\(\)<\/script>/);
  assert.equal(ctx.panel.querySelector('script, [onerror]'), null);
  assert.match(ctx.panel.querySelector('[data-report-field="FILIAL"]').textContent, /IDs com discrepância:.*15/);
  assert.match(ctx.panel.querySelector('[data-report-field="NOTA FISCAL"]').textContent, /Pendência para dar baixa/);
  assert.equal(ctx.panel.querySelector('[data-report-field="STATUS"] dd').textContent, 'APROVADO');
  assert.equal(ctx.root.querySelector('[data-action="details"]'), null);
  assert.ok(ctx.root.querySelector('.og-card[data-item-id="320"] [data-gallery-action="edit"]'));
  assert.ok(ctx.panel.querySelector('.olr-report'));
});

test('switching selected orders aborts the previous report and ignores out-of-order responses', async t => {
  const first = deferred(); const second = deferred();
  const ctx = await galleryHarness(t, id => id === '319' ? first.promise : second.promise);
  ctx.mascot('319').click();
  ctx.mascot('320').click();
  assert.deepEqual(ctx.calls.map(call => call[0]), ['319', '320']);
  assert.equal(ctx.calls[0][1].signal.aborted, true);
  second.resolve(await report(harness({ async getItemsPage() { return { items: [], hasMore: false }; } }), '320'));
  await tick();
  assert.match(ctx.panel.textContent, /Lançamentos vinculados ao pedido 320/);
  first.resolve(await report(harness()));
  await tick();
  assert.match(ctx.panel.textContent, /Lançamentos vinculados ao pedido 320/);
  assert.doesNotMatch(ctx.panel.textContent, /Lançamentos vinculados ao pedido 319/);
});

test('report errors offer an exact-order retry and closing prevents late rendering', async t => {
  let attempts = 0;
  const pending = deferred();
  const ctx = await galleryHarness(t, () => { if (!attempts++) throw new Error('Leitura do arquivo recusada'); return pending.promise; });
  ctx.mascot('319').click(); await tick();
  assert.match(ctx.panel.textContent, /Leitura do arquivo recusada/);
  assert.equal(ctx.panel.querySelector('.olr-summary'), null, 'no misleading zero statistics on error');
  [...ctx.panel.querySelectorAll('button')].find(button => button.textContent === 'Tentar novamente').click();
  assert.deepEqual(ctx.calls.map(call => call[0]), ['319', '319']);
  [...ctx.panel.querySelectorAll('button')].find(button => button.textContent === 'Fechar detalhes').click();
  assert.equal(ctx.calls[1][1].signal.aborted, true);
  pending.resolve(await report(harness())); await tick();
  assert.equal(ctx.panel.hidden, true);
  assert.equal(ctx.panel.children.length, 0);
});

test('Escape closes the linked popup, aborts loading and restores focus to the selected mascot', async t => {
  const pending = deferred();
  const ctx = await galleryHarness(t, () => pending.promise);
  const mascot = ctx.mascot('319'); mascot.focus(); mascot.click();
  ctx.panel.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(ctx.panel.hidden, true);
  assert.equal(ctx.calls[0][1].signal.aborted, true);
  assert.equal(ctx.dom.window.document.activeElement, mascot);
  pending.resolve(await report(harness())); await tick();
  assert.equal(ctx.panel.hidden, true);
});
