import test from 'node:test';
import assert from 'node:assert/strict';

const dataModule = await import('../src/chat/supplier-payroll-report-data.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const create = options => {
  assert.equal(typeof dataModule.createSupplierPayrollReportData, 'function', 'report data must be implemented');
  return dataModule.createSupplierPayrollReportData(options);
};
const columns = {
  IDFOLHA: ['FORNECEDOR', 'MESREFERENCIA'],
  FOLHAPGTO: ['FORNECEDOR', 'TIPOPGTO', 'DATA', 'IDFOLHA', 'IDLANCAMENTO', 'VALORUNITARIO', 'QTD'],
  LANCAMENTOS: ['VALOR UNITÁRIO', 'QUANTIDADE'],
};
const sheet = (id = '2', supplier = 'Ana', month = '10/2026') =>
  ({ id, fields: { field_0: supplier, field_1: month } });
const payment = (id = '1', payroll = '2', launch = '71', supplier = 'Ana') => ({ id,
  fields: { field_0: supplier, field_1: 'SALÁRIO', field_2: '2026-11-05', field_3: payroll,
    field_4: launch, field_5: 9999, field_6: 9999 } });
const page = items => ({ items, hasMore: false, nextLink: '', batchCount: items.length });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function fixture(overrides = {}) {
  const scans = [], gets = [], writes = [];
  const repository = {
    async resolveList(site, names) {
      assert.equal(site, 'personal'); return { status: 'resolved', id: names[0] };
    },
    async getColumns(_site, list) {
      return columns[list].map((displayName, i) => ({ name: `field_${i}`, displayName }));
    },
    async getItemsPage(_site, list, query, options) {
      scans.push(list);
      assert.equal(new URLSearchParams(query).get('$top'), '100');
      assert.equal(new URLSearchParams(query).get('$filter'), null);
      assert.ok(options.signal);
      return page(list === 'IDFOLHA' ? [sheet()] : [payment()]);
    },
    async getItem(_site, list, id) {
      gets.push([list, id]);
      return { id, fields: { field_0: '10,01', field_1: '1,5' } };
    },
    async updateItem(...args) { writes.push(args); throw new Error('unexpected write'); },
    async createItem(...args) { writes.push(args); throw new Error('unexpected write'); },
    ...overrides,
  };
  return { repository, scans, gets, writes };
}

test('snapshot scans only two lists; expansion links by reference sheet and rereads current financial values', async () => {
  const f = fixture(), data = create({ repository: f.repository });
  const source = await data.loadSnapshot();
  assert.deepEqual(source, { complete: true, sheets: [
    { id: '2', supplier: 'Ana', month: '2026-10', referenceLabel: '10/2026' },
  ] });
  assert.ok(Object.isFrozen(source)); assert.ok(Object.isFrozen(source.sheets));
  assert.deepEqual(f.gets, []);
  assert.deepEqual(await data.loadPaymentsForPayrollIds(['2']), [
    { id: '1', payrollId: '2', supplier: 'Ana', type: 'SALÁRIO', date: '2026-11-05',
      launchId: '71', unitValue: 10.01, quantity: 1.5, totalCents: 1502 },
  ]);
  assert.deepEqual(f.scans.sort(), ['FOLHAPGTO', 'IDFOLHA']);
  assert.deepEqual(f.gets, [['LANCAMENTOS', '71']]); assert.deepEqual(f.writes, []);
});

test('all pages across the 100-page window contribute suppliers months and payments', async () => {
  const f = fixture({ async getItemsPage(_site, list, _query, options) {
    const n = Number(options.cursor || '1');
    assert.equal(options.pageNumber, (n - 1) % 100 + 1); assert.equal(options.maxPages, 100);
    return { items: [list === 'IDFOLHA' ? sheet(String(n), n === 101 ? 'Zélia' : 'Ana', n === 101 ? '09/2026' : '10/2026')
      : payment(String(n), String(n))], hasMore: n < 101, nextLink: n < 101 ? String(n + 1) : '' };
  } });
  const data = create({ repository: f.repository }), source = await data.loadSnapshot();
  assert.equal(source.sheets.length, 101);
  assert.deepEqual(source.sheets.at(-1), { id: '101', supplier: 'Zélia', month: '2026-09', referenceLabel: '09/2026' });
  // Payment labels must agree with the selected reference sheet.
  await assert.rejects(data.loadPaymentsForPayrollIds(['101']), /fornecedor/i);
  const rows = await data.loadPaymentsForPayrollIds(['100']);
  assert.deepEqual(rows.map(r => r.id), ['100']);
});

test('renamed Title wins over computed mirrors while real duplicate supplier columns fail closed', async () => {
  const f = fixture({ async getColumns(_site, list) {
    if (list !== 'IDFOLHA') return columns[list].map((displayName, i) => ({ name: `field_${i}`, displayName }));
    return [{ name: 'Title', displayName: 'FORNECEDOR' },
      ...['LinkTitle', 'LinkTitleNoMenu', 'LinkTitle2'].map(name => ({ name, displayName: 'FORNECEDOR' })),
      { name: 'field_1', displayName: 'MÊS REFERÊNCIA' }];
  }, async getItemsPage(_site, list) {
    return page(list === 'IDFOLHA' ? [{ id: '2', fields: { Title: 'Ana', field_1: '10/2026' } }] : []);
  } });
  assert.equal((await create({ repository: f.repository }).loadSnapshot()).sheets[0].supplier, 'Ana');
  const original = f.repository.getColumns;
  f.repository.getColumns = async (...args) => [...await original(...args), { name: 'extra', displayName: 'FORNECEDOR' }];
  await assert.rejects(create({ repository: f.repository }).loadSnapshot(), /ambígua/i);
});

test('wrong sheet links are excluded and invalid requested IDs cannot query a snapshot', async () => {
  const f = fixture({ async getItemsPage(_site, list) {
    return page(list === 'IDFOLHA' ? [sheet(), sheet('3')] : [payment(), payment('2', '3'), payment('3', '999')]);
  } });
  const data = create({ repository: f.repository });
  await assert.rejects(data.loadPaymentsForPayrollIds(['2']), /snapshot|consulta|carreg/i);
  await data.loadSnapshot();
  for (const ids of [null, '2', ['2', '2'], ['999'], ['-1'], ['2 - Ana']]) {
    await assert.rejects(data.loadPaymentsForPayrollIds(ids), /ID|folha|array|lista/i);
  }
  assert.deepEqual((await data.loadPaymentsForPayrollIds(['2'])).map(r => r.id), ['1']);
  assert.deepEqual(await data.loadPaymentsForPayrollIds([]), []);
});

test('invalid populated payroll or launch links reject the complete snapshot', async () => {
  for (const [payroll, launch] of [['2junk', '71'], ['2', '-71'], ['2', '71 - Ana'], ['0', '71']]) {
    const f = fixture({ async getItemsPage(_site, list) {
      return page(list === 'IDFOLHA' ? [sheet()] : [payment('1', payroll, launch)]);
    } });
    await assert.rejects(create({ repository: f.repository }).loadSnapshot(), /ID|vínculo/i);
  }
});

test('supplier mismatch rejects details instead of exposing another supplier values', async () => {
  const f = fixture({ async getItemsPage(_site, list) {
    return page(list === 'IDFOLHA' ? [sheet()] : [payment('1', '2', '71', 'Ána')]);
  } });
  const data = create({ repository: f.repository }); await data.loadSnapshot();
  await assert.rejects(data.loadPaymentsForPayrollIds(['2']), /fornecedor/i);
  assert.deepEqual(f.gets, []);
});

test('blank supplier labels and missing source link stay explicit without copied amounts', async () => {
  const f = fixture({ async getItemsPage(_site, list) {
    return page(list === 'IDFOLHA' ? [sheet('2', '', '')] : [payment('1', '2', '', '')]);
  } });
  const data = create({ repository: f.repository }), source = await data.loadSnapshot();
  assert.equal(source.sheets[0].supplier, 'Fornecedor não informado');
  assert.equal(source.sheets[0].referenceLabel, 'Sem referência');
  const [row] = await data.loadPaymentsForPayrollIds(['2']);
  assert.equal(row.supplier, 'Fornecedor não informado'); assert.equal(row.totalCents, null);
  assert.equal(row.unitValue, null); assert.equal(row.quantity, null); assert.deepEqual(f.gets, []);
});

for (const [label, badPage] of [
  ['missing completion', { items: [sheet()] }], ['missing next cursor', { items: [sheet()], hasMore: true }],
  ['unexpected cursor', { items: [sheet()], hasMore: false, nextLink: 'next' }],
  ['empty intermediate', { items: [], hasMore: true, nextLink: 'next' }],
  ['partial', { ...page([sheet()]), partial: true }], ['wrong count', { ...page([sheet()]), batchCount: 2 }],
  ['sparse', { items: new Array(1), hasMore: false }], ['invalid item', page([{ id: '2' }])],
  ['invalid ID', page([sheet('0')])], ['too many items', page(Array.from({ length: 101 }, (_, i) => sheet(String(i + 1))))],
]) test(`snapshot rejects ${label} without making partial details available`, async () => {
  const f = fixture({ async getItemsPage(_site, list) { return list === 'IDFOLHA' ? badPage : page([]); } });
  const data = create({ repository: f.repository });
  await assert.rejects(data.loadSnapshot());
  await assert.rejects(data.loadPaymentsForPayrollIds(['2']));
});

test('repeated cursors and duplicate page IDs cannot masquerade as complete data', async () => {
  for (const kind of ['cursor', 'duplicate']) {
    let n = 0;
    const f = fixture({ async getItemsPage(_site, list) {
      if (list !== 'IDFOLHA') return page([]);
      n++;
      return { items: [sheet(kind === 'duplicate' ? '2' : String(n))], hasMore: true,
        nextLink: kind === 'cursor' ? 'next' : String(n) };
    } });
    await assert.rejects(create({ repository: f.repository }).loadSnapshot(), /cursor|ciclo|duplicado/i);
    assert.equal(n, 2);
  }
});

test('source failures reject the whole detail result and hydration never exceeds four reads', async () => {
  let active = 0, max = 0;
  const f = fixture({ async getItemsPage(_site, list) {
    return page(list === 'IDFOLHA' ? [sheet()] : Array.from({ length: 9 }, (_, i) => payment(String(i + 1), '2', String(71 + i))));
  }, async getItem(_site, _list, id) {
    active++; max = Math.max(max, active);
    await new Promise(resolve => setTimeout(resolve, 2)); active--;
    if (id === '79') throw new Error('source offline');
    return { id, fields: { field_0: 20, field_1: 2 } };
  } });
  const data = create({ repository: f.repository }); await data.loadSnapshot();
  await assert.rejects(data.loadPaymentsForPayrollIds(['2']), /source offline/);
  assert.equal(max, 4);
});

test('snapshot and detail abort promptly when upstream ignores the signal', async () => {
  for (const stage of ['resolve', 'columns', 'page', 'source']) {
    const entered = deferred(), never = new Promise(() => {}), f = fixture();
    const key = { resolve: 'resolveList', columns: 'getColumns', page: 'getItemsPage', source: 'getItem' }[stage];
    const data = create({ repository: f.repository });
    if (stage === 'source') await data.loadSnapshot();
    f.repository[key] = async () => { entered.resolve(); return never; };
    const controller = new AbortController();
    const operation = stage === 'source' ? data.loadPaymentsForPayrollIds(['2'], { signal: controller.signal })
      : data.loadSnapshot({ signal: controller.signal });
    await entered.promise; controller.abort();
    await assert.rejects(operation, { name: 'AbortError' });
  }
});

test('an older racing snapshot cannot replace the latest cache or return stale completion', async () => {
  const oldEntered = deferred(), release = deferred(); let round = 0;
  const f = fixture({ async getItemsPage(_site, list) {
    if (list === 'IDFOLHA') {
      round++;
      if (round === 1) { oldEntered.resolve(); await release.promise; return page([sheet('2')]); }
      return page([sheet('3')]);
    }
    return page([payment('1', round === 1 ? '2' : '3')]);
  } });
  const data = create({ repository: f.repository });
  const old = data.loadSnapshot(); const rejected = assert.rejects(old, { name: 'AbortError' });
  await oldEntered.promise;
  const latest = await data.loadSnapshot(); release.resolve(); await rejected;
  assert.deepEqual(latest.sheets.map(s => s.id), ['3']);
  assert.deepEqual((await data.loadPaymentsForPayrollIds(['3'])).map(r => r.payrollId), ['3']);
  await assert.rejects(data.loadPaymentsForPayrollIds(['2']));
});

test('refresh discards pending old hydration and rereads current launch values', async () => {
  const entered = deferred(), release = deferred(); let first = true;
  const f = fixture({ async getItem(_site, _list, id) {
    if (first) { first = false; entered.resolve(); await release.promise; return { id, fields: { field_0: 1, field_1: 1 } }; }
    return { id, fields: { field_0: 30, field_1: 2 } };
  } });
  const data = create({ repository: f.repository }); await data.loadSnapshot();
  const old = data.loadPaymentsForPayrollIds(['2']); const rejected = assert.rejects(old, { name: 'AbortError' });
  await entered.promise; await data.loadSnapshot(); release.resolve(); await rejected;
  assert.equal((await data.loadPaymentsForPayrollIds(['2']))[0].totalCents, 6000);
});

test('empty fully read lists produce a complete empty snapshot', async () => {
  const f = fixture({ async getItemsPage() { return page([]); } });
  const data = create({ repository: f.repository });
  assert.deepEqual(await data.loadSnapshot(), { complete: true, sheets: [] });
  assert.deepEqual(await data.loadPaymentsForPayrollIds([]), []);
});

test('boolean financial source values cannot become a false zero total', async () => {
  const f = fixture({ async getItem(_site, _list, id) {
    return { id, fields: { field_0: false, field_1: 2 } };
  } });
  const data = create({ repository: f.repository }); await data.loadSnapshot();
  await assert.rejects(data.loadPaymentsForPayrollIds(['2']), /inválid/i);
});

test('financial source metadata rejects real ambiguity instead of taking the first column', async () => {
  const f = fixture(); const original = f.repository.getColumns;
  f.repository.getColumns = async (site, list) => [...await original(site, list),
    ...(list === 'LANCAMENTOS' ? [{ name: 'ambiguous', displayName: 'VALOR UNITÁRIO' }] : [])];
  const data = create({ repository: f.repository }); await data.loadSnapshot();
  await assert.rejects(data.loadPaymentsForPayrollIds(['2']), /ambígua/i);
});

test('financial source cancellation is prompt even during ignored launch metadata requests', async () => {
  for (const method of ['resolveList', 'getColumns']) {
    const f = fixture(), data = create({ repository: f.repository }); await data.loadSnapshot();
    const entered = deferred();
    f.repository[method] = async () => { entered.resolve(); return new Promise(() => {}); };
    const controller = new AbortController();
    const result = data.loadPaymentsForPayrollIds(['2'], { signal: controller.signal });
    await entered.promise; controller.abort(); await assert.rejects(result, { name: 'AbortError' });
  }
});

test('failed refresh invalidates old snapshot rather than exposing stale payments', async () => {
  const f = fixture(), data = create({ repository: f.repository }); await data.loadSnapshot();
  f.repository.getItemsPage = async () => { throw new Error('offline refresh'); };
  await assert.rejects(data.loadSnapshot(), /offline refresh/);
  await assert.rejects(data.loadPaymentsForPayrollIds(['2']), /snapshot/i);
});

test('overlapping expansions share a four-read concurrency ceiling', async () => {
  const gate = deferred(), entered = deferred(); let active = 0, maximum = 0;
  const f = fixture({ async getItemsPage(_site, list) {
    return page(list === 'IDFOLHA' ? [sheet()] : ['1', '2', '3', '4'].map(id => payment(id, '2', String(70 + Number(id)))));
  }, async getItem(_site, _list, id) {
    active++; maximum = Math.max(active, maximum);
    if (active === 4) entered.resolve();
    await gate.promise; active--;
    return { id, fields: { field_0: 10, field_1: 1 } };
  } });
  const data = create({ repository: f.repository }); await data.loadSnapshot();
  const first = data.loadPaymentsForPayrollIds(['2']); await entered.promise;
  const second = data.loadPaymentsForPayrollIds(['2']); gate.resolve();
  const results = await Promise.all([first, second]);
  assert.equal(maximum, 4); assert.deepEqual(results.map(rows => rows.length), [4, 4]);
});

test('the 10000-page runaway guard rejects rather than publishing a truncated snapshot', async () => {
  let pages = 0;
  const f = fixture({ async getItemsPage(_site, list) {
    if (list !== 'IDFOLHA') return page([]);
    pages++;
    return { items: [sheet(String(pages))], hasMore: true, nextLink: String(pages + 1) };
  } });
  const data = create({ repository: f.repository });
  await assert.rejects(data.loadSnapshot(), RangeError); assert.equal(pages, 10000);
  await assert.rejects(data.loadPaymentsForPayrollIds(['1']));
});

test('late financial metadata cannot start a repository call after cancellation', async () => {
  for (const boundary of ['resolveList', 'getColumns']) {
    const f = fixture(), data = create({ repository: f.repository }); await data.loadSnapshot();
    const entered = deferred(), release = deferred();
    const original = f.repository[boundary]; let laterCalls = 0;
    f.repository[boundary] = async (...args) => { entered.resolve(); await release.promise; return original(...args); };
    const next = boundary === 'resolveList' ? 'getColumns' : 'getItem';
    f.repository[next] = async () => { laterCalls++; throw new Error('must not invoke after abort'); };
    const controller = new AbortController();
    const result = data.loadPaymentsForPayrollIds(['2'], { signal: controller.signal });
    await entered.promise; controller.abort(); await assert.rejects(result, { name: 'AbortError' });
    release.resolve(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(laterCalls, 0);
  }
});

test('pre-aborted calls invoke no repository or source method', async () => {
  const f = fixture(), data = create({ repository: f.repository });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(data.loadSnapshot({ signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(f.scans, []);
  await data.loadSnapshot();
  await assert.rejects(data.loadPaymentsForPayrollIds(['2'], { signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(f.gets, []);
});

test('real Graph transport forwards cancellation to token acquisition and consumes its late token', async () => {
  const entered = deferred(), release = deferred(); let fetches = 0, forwarded;
  const data = create({
    tokenProvider: async (_scopes, options) => { forwarded = options.signal; entered.resolve(); return release.promise; },
    fetchImpl: async () => { fetches++; throw new Error('network must not start after cancellation'); },
    siteConfig: { personal: { host: 'example.sharepoint.com', path: '/sites/test', readTransport: 'graph' } },
  });
  const controller = new AbortController();
  const result = data.loadSnapshot({ signal: controller.signal });
  await entered.promise; assert.ok(forwarded); controller.abort();
  await assert.rejects(result, { name: 'AbortError' }); assert.equal(forwarded.aborted, true);
  release.resolve('late-token'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(fetches, 0);
});

test('one service uses real Graph transport for refresh and concurrent details', async () => {
  const requests = [], tokenSignals = [];
  const data = create({
    tokenProvider: async (_scopes, options) => { tokenSignals.push(options.signal); return 'test-token'; },
    siteConfig: { personal: { host: 'example.sharepoint.com', path: '/sites/test', readTransport: 'graph' } },
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET'); assert.ok(options.signal); requests.push(url);
      const path = new URL(url).pathname;
      let body;
      if (path.endsWith('/items/71')) body = { id: '71', fields: { field_0: 10.01, field_1: 1.5 } };
      else if (path.endsWith('/columns')) {
        const list = path.split('/').at(-2);
        body = { value: columns[list].map((displayName, i) => ({ name: `field_${i}`, displayName })) };
      } else if (path.endsWith('/items')) body = { value: path.includes('/IDFOLHA/') ? [sheet()] : [payment()] };
      else if (path.endsWith('/lists')) body = { value: ['IDFOLHA', 'FOLHAPGTO', 'LANCAMENTOS'].map(id =>
        ({ id, displayName: id, list: { template: 'genericList' } })) };
      else body = { id: 'site-1' };
      return { ok: true, status: 200, json: async () => body };
    },
  });
  await data.loadSnapshot();
  const a = new AbortController(), b = new AbortController();
  const rows = await Promise.all([data.loadPaymentsForPayrollIds(['2'], { signal: a.signal }),
    data.loadPaymentsForPayrollIds(['2'], { signal: b.signal })]);
  assert.deepEqual(rows.map(r => r[0].totalCents), [1502, 1502]);
  assert.ok(tokenSignals.every(Boolean));
  assert.equal(requests.filter(url => new URL(url).pathname.endsWith('/items')).length, 2);
  await data.loadSnapshot(); assert.equal((await data.loadPaymentsForPayrollIds(['2']))[0].totalCents, 1502);
});

test('canceling one supplier detail leaves a concurrent supplier detail authorized and current', async () => {
  const entered = deferred(), release = deferred();
  const f = fixture({ async getItemsPage(_site, list) {
    return page(list === 'IDFOLHA' ? [sheet(), sheet('3', 'Bia')] : [payment(), payment('2', '3', '72', 'Bia')]);
  }, async getItem(_site, _list, id, _query, options) {
    assert.equal(options.signal.aborted, false);
    if (id === '71') { entered.resolve(); await release.promise; }
    return { id, fields: { field_0: 25, field_1: 2 } };
  } });
  const data = create({ repository: f.repository }); await data.loadSnapshot();
  const a = new AbortController(), b = new AbortController();
  const first = data.loadPaymentsForPayrollIds(['2'], { signal: a.signal });
  const rejected = assert.rejects(first, { name: 'AbortError' }); await entered.promise;
  const second = data.loadPaymentsForPayrollIds(['3'], { signal: b.signal }); a.abort();
  await rejected;
  const rows = await second; release.resolve();
  assert.equal(b.signal.aborted, false);
  assert.deepEqual(rows.map(r => [r.supplier, r.payrollId, r.totalCents]), [['Bia', '3', 5000]]);
});

test('real supplier expansions isolate pending LANCAMENTOS columns when another supplier collapses', async () => {
  const entered = deferred(), release = deferred(); let metadataReads = 0;
  const launchIds = [];
  const data = create({
    tokenProvider: async () => 'test-token',
    siteConfig: { personal: { host: 'example.sharepoint.com', path: '/sites/test', readTransport: 'graph' } },
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      const path = new URL(url).pathname;
      let body;
      if (path.includes('/LANCAMENTOS/items/')) {
        const id = path.split('/').at(-1); launchIds.push(id);
        body = { id, fields: { field_0: 25, field_1: 2 } };
      } else if (path.endsWith('/columns')) {
        const list = path.split('/').at(-2);
        if (list === 'LANCAMENTOS' && ++metadataReads === 1) { entered.resolve(); await release.promise; }
        body = { value: columns[list].map((displayName, i) => ({ name: `field_${i}`, displayName })) };
      } else if (path.endsWith('/items')) body = { value: path.includes('/IDFOLHA/')
        ? [sheet(), sheet('3', 'Bia')] : [payment(), payment('2', '3', '72', 'Bia')] };
      else if (path.endsWith('/lists')) body = { value: ['IDFOLHA', 'FOLHAPGTO', 'LANCAMENTOS'].map(id =>
        ({ id, displayName: id, list: { template: 'genericList' } })) };
      else body = { id: 'site-1' };
      return { ok: true, status: 200, json: async () => body };
    },
  });
  await data.loadSnapshot();
  const a = new AbortController(), b = new AbortController();
  const first = data.loadPaymentsForPayrollIds(['2'], { signal: a.signal });
  const rejected = assert.rejects(first, { name: 'AbortError' }); await entered.promise;
  const second = data.loadPaymentsForPayrollIds(['3'], { signal: b.signal })
    .then(value => ({ value }), error => ({ error }));
  await new Promise(resolve => setImmediate(resolve)); a.abort(); release.resolve(); await rejected;
  const survivor = await second;
  assert.equal(survivor.error, undefined, 'Bia expansion must survive Ana collapse during metadata');
  assert.deepEqual(survivor.value.map(r => [r.supplier, r.payrollId, r.totalCents]), [['Bia', '3', 5000]]);
  assert.deepEqual(launchIds, ['72']); assert.equal(metadataReads, 2);
});
