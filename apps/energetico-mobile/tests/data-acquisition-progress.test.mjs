import test from 'node:test';
import assert from 'node:assert/strict';
import { createOrdersGalleryData, createLaunchClusterData, createHrPayrollGalleryData, createPaymentProgrammingGalleryData } from '../src/chat/orders-gallery-data.js';
import { createGalleryRecordData } from '../src/chat/gallery-record-data.js';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { createOrdersLinkedReportData } from '../src/chat/orders-linked-report-data.js';

const turn = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => Promise.withResolvers();
const list = id => ({ status: 'resolved', id });
const item = (id, fields = {}) => ({ id, eTag: '"version-1"', fields });
const page = (items = [], nextLink) => ({ items, hasMore: Boolean(nextLink), ...(nextLink ? { nextLink } : {}) });
function finished(events) {
  assert.ok(events.length > 0, 'the data method must report acquisition');
  assert.equal(events.at(-1).percent, 100);
  for (const [index, value] of events.entries()) {
    assert.match(value.progressLabel, /etapas/i);
    assert.equal(value.percent, Math.floor(value.completed * 100 / value.total));
    assert.ok(value.total > 0 && value.total < 100, 'safety limits are not work totals');
    if (index) assert.ok(value.percent >= events[index - 1].percent);
  }
}

test('snapshot reports completed discovery and real pages during a suspended next page', async () => {
  const second = deferred(), events = [];
  const data = createOrdersGalleryData({ repository: {
    resolveList: async () => list('orders'),
    getItemsPage: async (_site, _list, _query, options) => options.cursor ? second.promise : page([item('1')], 'next'),
  } });
  const pending = data.loadSnapshot({ onProgress: value => events.push(value) });
  await turn();
  const during = [...events];
  second.resolve(page([item('2')]));
  const result = await pending;
  assert.deepEqual(result.rows.map(row => row.id), ['2', '1']);
  assert.ok(during.some(value => value.stage === 'list' && value.percent > 0));
  assert.ok(during.some(value => value.pages === 1 && value.records === 1));
  assert.ok(during.every(value => value.percent < 100));
  finished(events);
});

test('late cancellation suppresses completion even when the repository ignores its signal', async () => {
  const gate = deferred(), events = [], controller = new AbortController();
  const data = createOrdersGalleryData({ repository: {
    resolveList: async () => list('orders'), getItemsPage: () => gate.promise,
  } });
  const pending = data.loadSnapshot({ signal: controller.signal, onProgress: value => events.push(value) });
  await turn();
  controller.abort();
  const before = events.length;
  gate.resolve(page());
  await assert.rejects(pending, { name: 'AbortError' });
  assert.ok(before > 0);
  assert.equal(events.length, before);
  assert.ok(events.every(value => value.percent < 100));
});

test('observer failures cannot trigger the orders read retry policy', async () => {
  let reads = 0, discovery = 0, notifications = 0;
  const data = createOrdersGalleryData({ repository: {
    resolveList: async () => { discovery++; return list('orders'); },
    getItemsPage: async () => { reads++; return page([item('1')]); },
  } });
  const result = await data.loadSnapshot({ onProgress() { notifications++; throw Object.assign(new Error('observer'), { status: 503 }); } });
  assert.equal(result.rows.length, 1);
  assert.equal(reads, 1);
  assert.equal(discovery, 1);
  assert.ok(notifications > 0);
  await data.loadSnapshot({ onProgress: async () => { throw new Error('async observer'); } });
  await turn();
});

test('overlapping calls to one source retain independent stage counters and callbacks', async () => {
  const gates = [deferred(), deferred()], events = [[], []]; let reads = 0;
  const data = createOrdersGalleryData({ repository: {
    resolveList: async () => list('orders'), getItemsPage: () => gates[reads++].promise,
  } });
  const first = data.loadSnapshot({ onProgress: value => events[0].push(value) });
  const second = data.loadSnapshot({ onProgress: value => events[1].push(value) });
  await turn();
  gates[1].resolve(page([item('2')])); await second;
  const firstDuring = [...events[0]], secondCount = events[1].length;
  gates[0].resolve(page([item('1')])); await first;
  assert.ok(firstDuring.some(value => value.percent > 0));
  assert.ok(firstDuring.every(value => value.percent < 100));
  assert.equal(events[1].length, secondCount);
  finished(events[0]); finished(events[1]);
});

test('launch groups report discovery and pages without treating the page ceiling as a total', async () => {
  const gate = deferred(), events = [];
  const data = createLaunchClusterData({ repository: {
    resolveList: async () => list('launches'),
    getItemsPage: async (_site, _list, _query, options) => options.cursor ? gate.promise : page([item('2', { AGRUPAR: '8' })], 'next'),
  } });
  const pending = data.loadGroup('8', { onProgress: value => events.push(value) });
  await turn(); const during = [...events]; gate.resolve(page());
  assert.equal((await pending).length, 1);
  assert.ok(during.some(value => value.pages === 1));
  finished(events);
});

test('editor reports the resolved schema while its item and later attachments remain pending', async () => {
  const record = deferred(), files = deferred(), events = [];
  const repository = { getItem: () => record.promise, getColumns: async () => [{ name: 'OBS', text: {} }], listAttachments: () => files.promise };
  const data = createGalleryRecordData({ repository, listName: 'NOTASPENDENTES', resolveList: async () => list('orders') });
  const pending = data.loadEditor('2', { onProgress: value => events.push(value) });
  await turn(); const duringItem = [...events];
  record.resolve(item('2', { OBS: 'TESTE' }));
  await turn(); const duringFiles = [...events];
  files.resolve([]); const context = await pending;
  assert.equal(context.item.id, '2');
  assert.ok(duringItem.some(value => value.stage === 'schema' && value.percent > 0));
  assert.ok(duringFiles.at(-1).percent > duringItem.at(-1).percent);
  assert.ok(duringFiles.every(value => value.percent < 100));
  finished(events);
});

test('editor observers cannot turn a successful attachment inventory into an attachment error', async () => {
  let notifications = 0;
  const data = createGalleryRecordData({ listName: 'NOTASPENDENTES', resolveList: async () => list('orders'), repository: {
    getItem: async () => item('2'), getColumns: async () => [{ name: 'OBS', text: {} }], listAttachments: async () => [{ name: 'TESTE.pdf' }],
  } });
  const context = await data.loadEditor('2', { onProgress() { notifications++; throw new Error('observer'); } });
  assert.equal(context.attachments.canView, true);
  assert.equal(context.attachments.existingFiles[0].name, 'TESTE.pdf');
  assert.ok(notifications > 0);
});

test('registration snapshots report actual metadata completion before a pending page', async () => {
  const gate = deferred(), events = []; let columns = 0;
  const data = createRegistrationGalleryData({ kind: 'assetFunction', repository: {
    resolveList: async () => list('functions'),
    getColumns: async () => { columns++; return [{ name: 'physical', displayName: 'FUNCAO', text: {} }]; },
    getItemsPage: () => gate.promise,
  } });
  const pending = data.loadSnapshot({ onProgress: value => events.push(value) });
  await turn(); const during = [...events]; gate.resolve(page([item('2', { physical: 'TESTE' })]));
  const result = await pending;
  assert.equal(result.rows[0].fields.FUNCAO, 'TESTE');
  assert.equal(columns, 1, 'progress must reuse metadata already needed by the gallery');
  assert.ok(during.some(value => value.stage === 'schema' && value.percent > 0));
  finished(events);
});

const reportSchemas = {
  NOTASPENDENTES: ['DATAPGTOEFETUADO', 'FILIAL', 'FORNECEDOR', 'FORMAPGTO', 'VALORTOTAL', 'OBS', 'NOTA FISCAL', 'OBS FISCAL', 'STATUS'],
  LANCAMENTOS: ['AGRUPAR', 'DATA', 'FILIAL', 'FORNECEDOR', 'CONTA', 'PRODUTO', 'DESCRIÇÃO', 'QUANTIDADE', 'VALOR UNITÁRIO', 'FRETE', 'APROVACAO'],
  ARQUIVOLANCAMENTOS: ['AGRUPAR', 'DATA', 'FORNECEDOR', 'CONTA', 'PRODUTO', 'DESCRIÇÃO', 'QUANTIDADE', 'VALOR UNITÁRIO', 'FRETE', 'ID 2', 'DATAEXCLUSAO'],
};
test('linked report tracks active and archived branches independently while a branch awaits data', async () => {
  const archive = deferred(), events = [];
  const data = createOrdersLinkedReportData({ repository: {
    resolveList: async (_site, aliases) => list(aliases[0]),
    getColumns: async (_site, name) => reportSchemas[name].map((displayName, index) => ({ name: `f${index}`, displayName })),
    getItem: async () => item('8', { f4: 0 }),
    getItemsPage: async (_site, name) => name === 'ARQUIVOLANCAMENTOS' ? archive.promise : page(),
  } });
  const pending = data.loadLinkedReport('8', { onProgress: value => events.push(value) });
  await turn(); const during = [...events]; archive.resolve(page());
  assert.equal((await pending).orderId, '8');
  assert.ok(during.some(value => value.stage === 'LANCAMENTOS:items'));
  assert.ok(during.some(value => value.stage === 'ARQUIVOLANCAMENTOS:schema'));
  assert.ok(during.every(value => value.percent < 100));
  finished(events);
});

test('payroll page reports completed records out of the known hydration total', async () => {
  const sources = [deferred(), deferred()], events = [];
  const data = createHrPayrollGalleryData({ repository: {
    resolveList: async (_site, aliases) => list(aliases[0]),
    getColumns: async () => [{ name: 'VALORUNITARIO' }, { name: 'QUANTIDADE' }],
    getItemsPage: async () => page([item('1', { IDLANCAMENTO: '11' }), item('2', { IDLANCAMENTO: '12' })]),
    getItem: (_site, _list, id) => sources[Number(id) - 11].promise,
  } });
  const pending = data.loadPage('FOLHAPGTO', { onProgress: value => events.push(value) });
  await turn(); sources[0].resolve(item('11', { VALORUNITARIO: 3, QUANTIDADE: 2 }));
  await turn(); const during = [...events]; sources[1].resolve(item('12', { VALORUNITARIO: 4, QUANTIDADE: 1 }));
  assert.equal((await pending).rows[0].VALORUNITARIO, 3);
  assert.ok(during.some(value => value.units?.completed === 1 && value.units.total === 2 && value.units.unit === 'registros'));
  assert.ok(during.every(value => value.percent < 100));
  finished(events);
});

test('filtered payroll shares pending acquisition and replays actual stages to independent observers', async () => {
  const gate = deferred(), events = [[], []]; let reads = 0;
  const data = createHrPayrollGalleryData({ repository: {
    resolveList: async (_site, aliases) => list(aliases[0]),
    getItemsPage: () => { reads++; return gate.promise; },
  } });
  const first = data.loadFilteredPage('IDFOLHA', { onProgress: value => events[0].push(value) });
  await turn();
  const second = data.loadFilteredPage('IDFOLHA', { onProgress: value => events[1].push(value) });
  await turn(); const during = events.map(values => [...values]);
  gate.resolve(page([item('1', { FORNECEDOR: 'TESTE' })]));
  await Promise.all([first, second]);
  assert.equal(reads, 1);
  assert.ok(during.every(values => values.some(value => value.percent > 0)));
  finished(events[0]); finished(events[1]);
});

test('cancelling one filtered payroll observer leaves the shared read available to the other', async () => {
  const gate = deferred(), controller = new AbortController(), cancelledEvents = [], activeEvents = [];
  const data = createHrPayrollGalleryData({ repository: {
    resolveList: async (_site, aliases) => list(aliases[0]), getItemsPage: () => gate.promise,
  } });
  const first = data.loadFilteredPage('IDFOLHA', { signal: controller.signal, onProgress: value => cancelledEvents.push(value) });
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const second = data.loadFilteredPage('IDFOLHA', { onProgress: value => activeEvents.push(value) });
  await turn(); controller.abort(); const before = cancelledEvents.length;
  gate.resolve(page()); await rejected; await second;
  assert.equal(cancelledEvents.length, before);
  assert.ok(cancelledEvents.every(value => value.percent < 100));
  finished(activeEvents);
});

test('payroll detail reports a completed scan before linked-source hydration and keeps fallback reads safe', async () => {
  const source = deferred(), events = []; let scans = 0;
  const data = createHrPayrollGalleryData({ repository: {
    resolveList: async (_site, aliases) => list(aliases[0]),
    getColumns: async () => [{ name: 'VALORUNITARIO' }, { name: 'QUANTIDADE' }],
    getItemsPage: async () => { if (++scans === 1) throw Object.assign(new Error('unsupported filter'), { status: 400 }); return page([item('2', { IDFOLHA: 8, IDLANCAMENTO: 11 })]); },
    getItem: () => source.promise,
  } });
  const pending = data.loadPaymentsForPayrollId('8', { onProgress: value => events.push(value) });
  await turn(); const during = [...events]; source.resolve(item('11', { VALORUNITARIO: 4, QUANTIDADE: 1 }));
  assert.equal((await pending).length, 1);
  assert.equal(scans, 2);
  assert.ok(during.some(value => value.stage === 'items' && value.percent > 0));
  assert.ok(during.every(value => value.percent < 100));
  finished(events);
});

test('description detail exposes its real discovery, schema and page boundaries through the owned adapter', async () => {
  const gate = deferred(), events = [];
  const data = createPaymentProgrammingGalleryData({ repository: {
    resolveList: async (_site, aliases) => list(aliases[0]),
    getItem: async (_site, _list, id) => item(id),
    getColumns: async () => [{ name: 'DESCRITIVOPROVISAO', text: {} }],
    getItemsPage: () => gate.promise,
  } });
  const pending = data.loadDescriptionGroup('8', { onProgress: value => events.push(value) });
  await turn(); const during = [...events]; gate.resolve(page([item('2', { DESCRITIVOPROVISAO: '8' })]));
  assert.equal((await pending).provisions.length, 1);
  assert.ok(during.some(value => value.stage === 'schema' && value.percent > 0));
  finished(events);
});

test('registration editor reports raw schema acquisition while its institution catalog is still pending', async () => {
  const gate = deferred(), started = deferred(), events = [];
  const data = createRegistrationGalleryData({ kind: 'investment', repository: {
    resolveList: async (_site, aliases) => list(aliases[0]),
    getColumns: async (_site, name) => (name === 'CADASTRO INVESTIMENTO' ? ['INSTITUICAO', 'DESCRICAO'] : ['INSTITUICAOEMISSORA'])
      .map(name => ({ name, displayName: name, text: {} })),
    getItem: async (_site, _list, id) => item(id, { INSTITUICAO: 'TESTE' }),
    getItemsPage: () => { started.resolve(); return gate.promise; },
  } });
  const pending = data.loadEditor('2', { includeAttachments: false, onProgress: value => events.push(value) });
  await started.promise;
  const during = [...events]; gate.resolve(page([item('1', { INSTITUICAOEMISSORA: 'TESTE' })]));
  const context = await pending;
  assert.deepEqual(context.columns.find(column => column.name === 'INSTITUICAO').choices, ['TESTE']);
  assert.ok(during.some(value => value.source?.stage === 'columns' && value.percent > 0));
  assert.ok(during.every(value => value.percent < 100));
  finished(events);
});

test('a failed later page never reports complete acquisition or restarts a completed page', async () => {
  const events = [], pages = [];
  const data = createOrdersGalleryData({ repository: {
    resolveList: async () => list('orders'),
    getItemsPage: async (_site, _list, _query, options) => {
      pages.push(options.pageNumber);
      if (options.cursor) throw Object.assign(new Error('forbidden'), { status: 403 });
      return page([item('1')], 'next');
    },
  } });
  await assert.rejects(data.loadSnapshot({ onProgress: value => events.push(value) }), /forbidden/);
  assert.deepEqual(pages, [1, 2]);
  assert.ok(events.some(value => value.pages === 1));
  assert.ok(events.every(value => value.percent < 100));
});

test('session invalidation during editor acquisition prevents late success notifications', async () => {
  const gate = deferred(), events = []; let current = true;
  const data = createGalleryRecordData({ listName: 'NOTASPENDENTES', resolveList: async () => list('orders'),
    assertSession: () => { if (!current) throw new Error('expired session'); }, repository: {
      getItem: () => gate.promise, getColumns: async () => [{ name: 'OBS', text: {} }],
    },
  });
  const pending = data.loadEditor('2', { onProgress: value => events.push(value) });
  await turn(); current = false; const before = events.length; gate.resolve(item('2'));
  await assert.rejects(pending, /expired session/);
  assert.equal(events.length, before);
  assert.ok(events.every(value => value.percent < 100));
});

test('single-item and upcoming-payment reads report their real foreground boundaries', async () => {
  const pointEvents = [], upcomingEvents = [], gate = deferred();
  const data = createPaymentProgrammingGalleryData({ repository: {
    resolveList: async () => list('payments'),
    getItem: async (_site, _list, id) => item(id),
    getColumns: async () => [{ name: 'DATAPREVISTOPGTO', dateTime: {} }],
    getItemsPage: () => gate.promise,
  } });
  assert.equal((await data.loadItem('2', { onProgress: value => pointEvents.push(value) })).id, '2');
  const pending = data.loadUpcomingPayments({ now: new Date('2026-10-01T12:00:00Z'), onProgress: value => upcomingEvents.push(value) });
  await turn(); const during = [...upcomingEvents]; gate.resolve(page()); await pending;
  assert.ok(during.some(value => value.stage === 'schema' && value.percent > 0));
  assert.ok(during.every(value => value.percent < 100));
  finished(pointEvents); finished(upcomingEvents);
});

test('attachment inventories share transport while retaining cancellation and cache-hit progress', async () => {
  const gate = deferred(), controller = new AbortController(), events = [[], [], []]; let reads = 0;
  const data = createOrdersGalleryData({ repository: {
    resolveList: async () => list('orders'), getItemsPage: async () => page(),
    listAttachments: () => { reads++; return gate.promise; },
  } });
  const first = data.listAttachments('2', { signal: controller.signal, onProgress: value => events[0].push(value) });
  const rejected = assert.rejects(first, { name: 'AbortError' });
  const second = data.listAttachments('2', { onProgress: value => events[1].push(value) });
  await turn(); const during = [...events[1]]; controller.abort();
  gate.resolve([{ name: 'TESTE.pdf' }]); await rejected;
  assert.equal((await second).length, 1);
  await data.listAttachments('2', { onProgress: value => events[2].push(value) });
  assert.equal(reads, 1);
  assert.ok(during.some(value => value.stage === 'list' && value.percent > 0));
  assert.ok(events[0].every(value => value.percent < 100));
  finished(events[1]); finished(events[2]);
});

test('download forwards real byte metadata and isolates failing observers without repeating transport', async () => {
  const events = [], bytes = { loaded: 3, total: 3, percent: 100 }; let reads = 0;
  const data = createOrdersGalleryData({ repository: {
    resolveList: async () => list('orders'), getItemsPage: async () => page(), listAttachments: async () => [],
    downloadAttachment: async (_site, _list, _id, _name, options) => { reads++; options.onProgress(bytes); return new Blob(['pdf']); },
  } });
  const result = await data.downloadAttachment('2', 'TESTE.pdf', { onProgress(value) { events.push(value); throw new Error('observer'); } });
  assert.equal(result.size, 3);
  assert.deepEqual(events, [bytes]);
  assert.equal(reads, 1);
});

test('already cancelled foreground reads never start transport or notify their observer', async () => {
  const controller = new AbortController(); controller.abort();
  const reads = [], events = [], options = { signal: controller.signal, onProgress: value => events.push(value) };
  const repository = {
    resolveList: async () => { reads.push('list'); return list('orders'); },
    getItemsPage: async () => { reads.push('page'); return page(); },
    getColumns: async () => [], getItem: async () => item('2'),
  };
  const orders = createOrdersGalleryData({ repository }), payroll = createHrPayrollGalleryData({ repository });
  const group = createLaunchClusterData({ repository });
  await Promise.all([
    assert.rejects(orders.loadSnapshot(options), { name: 'AbortError' }),
    assert.rejects(orders.loadItem('2', options), { name: 'AbortError' }),
    assert.rejects(orders.listAttachments('2', options), { name: 'AbortError' }),
    assert.rejects(group.loadGroup('2', options), { name: 'AbortError' }),
    assert.rejects(payroll.loadPage('IDFOLHA', options), { name: 'AbortError' }),
    assert.rejects(payroll.loadFilteredPage('IDFOLHA', options), { name: 'AbortError' }),
    assert.rejects(payroll.loadPaymentsForPayrollId('2', options), { name: 'AbortError' }),
  ]);
  assert.deepEqual(reads, []);
  assert.deepEqual(events, []);
});
