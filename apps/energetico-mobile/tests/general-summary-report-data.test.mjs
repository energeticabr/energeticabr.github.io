import test from 'node:test';
import assert from 'node:assert/strict';

const data = await import('../src/chat/general-summary-report-data.js').catch(() => ({}));
const schemas = {
  'PROVISÃO PGTOS': ['DATA PREVISTO PGTO', 'DATA PGTO EFETUADO'], NOTASPENDENTES: ['STATUS'],
  NOVACOTACAO: ['STATUS'], DOCUMENTOS_1: ['STATUS'], LANCAMENTOTAREFAS: ['CONCLUÍDO', 'DATA IDENTIFICAÇÃO'],
  TAREFASDELEGADAS: ['CONCLUÍDO'], EMPREITEIRO: ['STATUS'], DESCRITIVOPRESENCA: ['PRESENCA', 'STATUS', 'VLORDIARIO'],
  'DIÁRIO DE OBRAS': ['STATUS'], 'IMOVEL CADASTRADO': ['FILIAL', 'IMOVEL', 'SEGURO', 'IDPROPOSTA',
    'IDCONTRATOCAIXA', 'IDESCRITURA', 'IDDOCUMENTOCORRETAGEM', 'IDDOCFISCAL'], SACPATOLOGIAS: ['STATUS'],
};
const zero = { dueToday: 0, overdue: 0, auditOrders: 0, quotes: 0, documents: 0,
  pendingTasks: 0, delegatedTasks: 0, activeContracts: 0, pendingPayments: 0,
  pendingDiaries: 0, commercialDocuments: 0, activePathologies: 0 };
const now = () => new Date('2026-10-08T02:59:59Z');
function repository(overrides = {}) {
  return {
    async resolveList(site, aliases) {
      assert.equal(site, 'personal');
      assert.ok(schemas[aliases[0]], `unexpected source ${aliases[0]}`);
      return { status: 'resolved', id: aliases[0] };
    },
    async getColumns(_site, list) { return schemas[list].map((displayName, i) => ({ name: `field_${i}`, displayName })); },
    async getItemsPage() { return { items: [], hasMore: false, nextLink: '', batchCount: 0 }; },
    ...overrides,
  };
}
function load(repo, options = {}) {
  assert.equal(typeof data.createGeneralSummaryData, 'function', 'summary loader must exist');
  return data.createGeneralSummaryData({ repository: repo, now }).loadReport(options);
}
const page = (items, nextLink = '') => ({ items, hasMore: !!nextLink, nextLink, batchCount: items.length });

test('real Graph discovery rejects ambiguous quotation aliases in both discovery orders', async () => {
  for (const reversed of [false, true]) {
    let ambiguousReads = 0;
    const result = await data.createGeneralSummaryData({
      now, tokenProvider: async () => 'fixture-token',
      siteConfig: { personal: { host: 'fixture.sharepoint.com', path: '/sites/summary', readTransport: 'graph' } },
      fetchImpl: async url => {
        const path = new URL(url).pathname;
        const response = value => new Response(JSON.stringify(value), { status: 200 });
        if (path === '/v1.0/sites/fixture.sharepoint.com:/sites/summary') return response({ id: 'configured-site' });
        const all = Object.keys(schemas).map((displayName, i) => ({ id: `list-${i}`, displayName, list: { template: 'genericList' } }));
        all.push({ id: 'alternative-quotes', displayName: 'NOVA COTAÇÃO', list: { template: 'genericList' } });
        if (path.endsWith('/lists')) return response({ value: reversed ? all.reverse() : all });
        const columns = path.match(/\/lists\/([^/]+)\/columns$/), items = path.match(/\/lists\/([^/]+)\/items$/);
        const id = (columns || items)?.[1];
        if (!id) assert.fail(`unexpected path ${path}`);
        const canonical = id === 'alternative-quotes' ? 'NOVACOTACAO' : Object.keys(schemas)[Number(id.slice(5))];
        if (columns) return response({ value: schemas[canonical].map((displayName, i) => ({ name: `field_${i}`, displayName })) });
        if (canonical === 'NOVACOTACAO') {
          ambiguousReads++;
          return response({ value: Array.from({ length: id === 'alternative-quotes' ? 2 : 1 }, (_, i) => ({ id: String(i + 1), fields: { field_0: 'ATIVA' } })) });
        }
        return response({ value: [] });
      },
    }).loadReport();
    assert.deepEqual(result.metrics, { ...zero, quotes: null });
    assert.match(result.warnings.join(' '), /NOVACOTACAO.*amb[ií]gua/i);
    assert.equal(ambiguousReads, 0, 'no item request may use an ambiguous source');
  }
});

test('source list ambiguity invalidates only that source while repeated metadata for the same ID is accepted', async () => {
  for (const conflict of [false, true]) {
    const repo = repository({ async listLists() {
      return [...Object.keys(schemas).map(displayName => ({ id: displayName, displayName })),
        { id: conflict ? 'other' : 'NOVACOTACAO', displayName: 'NOVA COTAÇÃO' }];
    } });
    const result = await load(repo);
    assert.deepEqual(result.metrics, { ...zero, quotes: conflict ? null : 0 });
    assert.equal(result.warnings.length, conflict ? 1 : 0);
  }
});

test('personal-site renamed schemas feed the literal twelve-metric snapshot', async () => {
  const rows = {
    'PROVISÃO PGTOS': [{ field_0: '2026-10-07', field_1: '' }, { field_0: '2026-10-06', field_1: '' }],
    NOTASPENDENTES: [{ field_0: 'pendente auditoria' }], NOVACOTACAO: [{ field_0: 'ATIVA' }, { field_0: 'ATIVO' }],
    DOCUMENTOS_1: [{ field_0: 'PENDENTE' }], LANCAMENTOTAREFAS: [{ field_0: 'atividade criada', field_1: '2026-10-07' }],
    TAREFASDELEGADAS: [{ field_0: 'EM ATENDIMENTO' }], EMPREITEIRO: [{ field_0: 'ATIVO' }, { field_0: 'ATIVO' }],
    DESCRITIVOPRESENCA: [{ field_0: 'PRESENTE', field_1: '', field_2: '120,50', hours: 1 }],
    'DIÁRIO DE OBRAS': [{ field_0: 'PENDENTE' }], 'IMOVEL CADASTRADO': [{ field_0: 'A', field_1: '1' }],
    SACPATOLOGIAS: [{ field_0: 'ATIVO' }],
  };
  const result = await load(repository({ async getItemsPage(_site, list) {
    return page(rows[list].map((fields, i) => ({ id: String(i + 1), fields })));
  } }));
  assert.deepEqual(result.metrics, { dueToday: 1, overdue: 1, auditOrders: 1, quotes: 2, documents: 1,
    pendingTasks: 1, delegatedTasks: 1, activeContracts: 2, pendingPayments: 120.5,
    pendingDiaries: 1, commercialDocuments: 6, activePathologies: 1 });
  assert.equal(result.today, '2026-10-07');
  assert.deepEqual(result.warnings, []);
});

test('computed LinkTitle auxiliaries are ignored even when they share a renamed label', async () => {
  const repo = repository(); const original = repo.getColumns;
  repo.getColumns = async (...args) => [...await original(...args),
    ...['LinkTitle', 'LinkTitleNoMenu', 'LinkTitle37', 'LinkTitleCustom'].map(name => ({ name, displayName: 'STATUS' })),
    { name: 'Computed', displayName: 'STATUS', computed: {} }];
  assert.deepEqual((await load(repo)).metrics, zero);
});

for (const broken of ['missing', 'ambiguous', 'unsafe', 'reuse']) {
  test(`${broken} schema invalidates only its source`, async () => {
    const repo = repository(); const original = repo.getColumns;
    repo.getColumns = async (site, list) => {
      const columns = await original(site, list);
      if (list !== 'PROVISÃO PGTOS') return columns;
      if (broken === 'missing') return columns.slice(1);
      if (broken === 'ambiguous') return [...columns, { name: 'second', displayName: 'DATA PREVISTO PGTO' }];
      if (broken === 'unsafe') return [{ name: 'bad/path', displayName: 'DATA PREVISTO PGTO' }, columns[1]];
      return [{ name: 'DATA_x0020_PREVISTO_x0020_PGTO', displayName: 'DATA PGTO EFETUADO' }];
    };
    const result = await load(repo);
    assert.deepEqual(result.metrics, { ...zero, dueToday: null, overdue: null });
    assert.match(result.warnings.join(' '), /PROVIS/);
    assert.match(result.warnings.join(' '), /coluna/i);
  });
}

test('cursor traversal crosses the repository 100-page window and deduplicates identical IDs', async () => {
  const result = await load(repository({ async getItemsPage(_site, list, query, options) {
    if (list !== 'NOVACOTACAO') return page([]);
    const n = options.cursor ? Number(options.cursor.slice(1)) : 1;
    assert.equal(options.pageNumber, (n - 1) % 100 + 1);
    assert.equal(options.maxPages, 100);
    assert.equal(new URLSearchParams(query).get('$expand'), 'fields');
    assert.equal(new URLSearchParams(query).get('$top'), '100');
    return page([{ id: String(n), fields: { field_0: 'ATIVA' } },
      { id: '900', fields: { field_0: 'ATIVO', extra: { a: 1, b: 2 } } }], n < 101 ? `p${n + 1}` : '');
  } }));
  assert.equal(result.metrics.quotes, 102);
  assert.deepEqual(result.warnings, []);
});

for (const failure of ['conflict', 'cycle', 'missing cursor', 'empty continuation', 'partial', 'truncated', 'count', 'bad id', 'page error']) {
  test(`${failure} page makes quotes unknown, never a partial total`, async () => {
    const result = await load(repository({ async getItemsPage(_site, list, _query, options) {
      if (list !== 'NOVACOTACAO') return page([]);
      if (failure === 'conflict') return page([{ id: '1', fields: { field_0: options.cursor ? 'INATIVO' : 'ATIVA' } }], options.cursor ? '' : 'next');
      if (failure === 'cycle') return page([{ id: '1', fields: { field_0: 'ATIVA' } }], 'next');
      if (failure === 'missing cursor') return { ...page([]), hasMore: true };
      if (failure === 'empty continuation') return page([], 'next');
      if (failure === 'count') return { ...page([]), batchCount: 1 };
      if (failure === 'bad id') return page([{ id: '', fields: { field_0: 'ATIVO' } }]);
      return { ...page([{ id: '1', fields: { field_0: 'ATIVA' } }]), [failure === 'page error' ? 'error' : failure]: true };
    } }));
    assert.deepEqual(result.metrics, { ...zero, quotes: null });
    assert.match(result.warnings.join(' '), /NOVACOTACAO/);
  });
}

test('each failed list affects only its own metrics and names the reason', async () => {
  const affected = { 'PROVISÃO PGTOS': ['dueToday', 'overdue'], NOTASPENDENTES: ['auditOrders'],
    NOVACOTACAO: ['quotes'], DOCUMENTOS_1: ['documents'], LANCAMENTOTAREFAS: ['pendingTasks'],
    TAREFASDELEGADAS: ['delegatedTasks'], EMPREITEIRO: ['activeContracts'], DESCRITIVOPRESENCA: ['pendingPayments'],
    'DIÁRIO DE OBRAS': ['pendingDiaries'], 'IMOVEL CADASTRADO': ['commercialDocuments'], SACPATOLOGIAS: ['activePathologies'] };
  for (const [list, metrics] of Object.entries(affected)) {
    const result = await load(repository({ async getItemsPage(_site, name) {
      if (name === list) throw new Error('source offline');
      return page([]);
    } }));
    assert.deepEqual(result.metrics, { ...zero, ...Object.fromEntries(metrics.map(key => [key, null])) });
    assert.match(result.warnings.join(' '), /source offline/);
    assert.ok(result.warnings.some(w => w.includes(list)));
  }
});

test('missing lists yield unknown while malformed eligible money does not affect other sources', async () => {
  const result = await load(repository({
    async resolveList(_site, aliases) { return { status: aliases[0] === 'DOCUMENTOS_1' ? 'missing' : 'resolved', id: aliases[0] }; },
    async getItemsPage(_site, list) { return page(list === 'DESCRITIVOPRESENCA'
      ? [{ id: '1', fields: { field_0: 'PRESENTE', field_1: '', field_2: 'R$ broken' } }] : []); },
  }));
  assert.deepEqual(result.metrics, { ...zero, documents: null, pendingPayments: null });
  assert.equal(result.warnings.length, 2);
});

test('source reads are bounded to four concurrent operations', async () => {
  let active = 0, peak = 0;
  const result = await load(repository({ async getItemsPage() {
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return page([]);
  } }));
  assert.deepEqual(result.metrics, zero);
  assert.ok(peak > 1 && peak <= 4, `concurrency ${peak}`);
});

for (const stage of ['resolveList', 'getColumns', 'getItemsPage']) {
  test(`AUTH_REQUIRED at ${stage} propagates promptly even while another source hangs`, async () => {
    const auth = Object.assign(new Error('login'), { code: 'AUTH_REQUIRED' });
    const repo = repository(); const original = repo[stage];
    repo[stage] = async (site, target, ...rest) => {
      const name = Array.isArray(target) ? target[0] : target;
      if (name === 'NOTASPENDENTES') throw auth;
      if (name === 'PROVISÃO PGTOS') return new Promise(() => {});
      return original(site, target, ...rest);
    };
    await assert.rejects(load(repo), error => error === auth);
  });

  test(`abort during ${stage} is fast when repository ignores signal`, async () => {
    const controller = new AbortController();
    let entered; const started = new Promise(resolve => { entered = resolve; });
    const repo = repository({ [stage]: async () => { entered(); return new Promise(() => {}); } });
    const pending = load(repo, { signal: controller.signal });
    await started;
    controller.abort();
    await assert.rejects(pending, { name: 'AbortError' });
  });
}

test('pre-aborted load never reaches repository', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(load(repository({ resolveList() { assert.fail('must not read'); } }), { signal: controller.signal }), { name: 'AbortError' });
});

test('default graph transport propagates token AUTH_REQUIRED and fast token cancellation', async () => {
  assert.equal(typeof data.createGeneralSummaryData, 'function');
  const auth = Object.assign(new Error('login'), { code: 'AUTH_REQUIRED' });
  await assert.rejects(data.createGeneralSummaryData({ tokenProvider: async () => { throw auth; }, now }).loadReport(), error => error === auth);
  const controller = new AbortController();
  let enter; const started = new Promise(resolve => { enter = resolve; });
  const pending = data.createGeneralSummaryData({ tokenProvider: async () => { enter(); return new Promise(() => {}); }, now }).loadReport({ signal: controller.signal });
  await started; controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('runaway pagination returns unknown rather than the first 10000 records', async () => {
  let pages = 0;
  const result = await load(repository({ async getItemsPage(_site, list) {
    if (list !== 'NOVACOTACAO') return page([]);
    pages++;
    return page([{ id: String(pages), fields: { field_0: 'ATIVO' } }], `p${pages}`);
  } }));
  assert.equal(result.metrics.quotes, null);
  assert.match(result.warnings.join(' '), /limite seguro/i);
  assert.equal(pages, 10000);
});

test('nested object property order is not a conflicting duplicate version', async () => {
  const result = await load(repository({ async getItemsPage(_site, list, _query, options) {
    if (list !== 'NOVACOTACAO') return page([]);
    return page([{ id: '1', fields: options.cursor
      ? { extra: { b: 2, a: 1 }, field_0: 'ATIVA' }
      : { field_0: 'ATIVA', extra: { a: 1, b: 2 } } }], options.cursor ? '' : 'next');
  } }));
  assert.equal(result.metrics.quotes, 1);
  assert.deepEqual(result.warnings, []);
});

test('latest 2000 task scope survives complete paginated reads and applies no delegated cap', async () => {
  const tasks = [{ id: '1', fields: { field_0: 'ATIVIDADE CRIADA', field_1: '2020-01-01' } },
    ...Array.from({ length: 1999 }, (_, i) => ({ id: String(i + 2), fields: { field_0: 'CONCLUÍDO', field_1: '2026-10-07' } })),
    { id: '2001', fields: { field_0: 'EM ATENDIMENTO', field_1: '2026-10-08' } }];
  const delegated = Array.from({ length: 2001 }, (_, i) => ({ id: String(i + 1), fields: { field_0: 'ATIVIDADE CRIADA' } }));
  const result = await load(repository({ async getItemsPage(_site, list, _query, options) {
    if (!['LANCAMENTOTAREFAS', 'TAREFASDELEGADAS'].includes(list)) return page([]);
    const rows = list === 'LANCAMENTOTAREFAS' ? tasks : delegated;
    const start = Number(options.cursor || 0);
    return page(rows.slice(start, start + 100), start + 100 < rows.length ? String(start + 100) : '');
  } }));
  assert.equal(result.metrics.pendingTasks, 1);
  assert.equal(result.metrics.delegatedTasks, 2001);
  assert.match(result.warnings.join(' '), /2000/);
});

test('fetchImpl and siteConfig are honored by the real Graph repository', async () => {
  const result = await data.createGeneralSummaryData({ now, tokenProvider: async () => 'test-token',
    siteConfig: { personal: { host: 'fixture.sharepoint.com', path: '/sites/summary', readTransport: 'graph' } },
    fetchImpl: async (url, options) => {
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.Authorization, 'Bearer test-token');
      const path = new URL(url).pathname;
      if (path === '/v1.0/sites/fixture.sharepoint.com:/sites/summary') {
        return new Response(JSON.stringify({ id: 'configured-site', webUrl: 'https://fixture.sharepoint.com/sites/summary' }), { status: 200 });
      }
      assert.match(path, /^\/v1\.0\/sites\/configured-site\//);
      const columnMatch = path.match(/\/lists\/([^/]+)\/columns$/);
      const itemMatch = path.match(/\/lists\/([^/]+)\/items$/);
      let value;
      if (path.endsWith('/lists')) value = Object.keys(schemas).map((displayName, i) => ({ id: `list-${i}`, displayName, name: displayName, list: { template: 'genericList' } }));
      else if (columnMatch) {
        const list = Object.keys(schemas)[Number(columnMatch[1].slice(5))];
        value = schemas[list].map((displayName, i) => ({ name: `field_${i}`, displayName }));
      } else if (itemMatch) value = [];
      else assert.fail(`unexpected graph path ${path}`);
      return new Response(JSON.stringify({ value }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  }).loadReport();
  assert.deepEqual(result.metrics, zero);
  assert.deepEqual(result.warnings, []);
});

test('AUTH_REQUIRED in a page error envelope also propagates instead of becoming a source warning', async () => {
  const auth = Object.assign(new Error('renew session'), { code: 'AUTH_REQUIRED' });
  await assert.rejects(load(repository({ async getItemsPage(_site, list) {
    return list === 'NOVACOTACAO' ? { ...page([]), error: auth } : page([]);
  } })), error => error === auth);
});

test('verified physical document/task/quotation/pathology aliases load their actual source', async () => {
  const physical = { DOCUMENTOS_1: 'DOCUMENTOS', LANCAMENTOTAREFAS: 'LANCAMENTO TAREFAS',
    NOVACOTACAO: 'NOVA COTAÇÃO', TAREFASDELEGADAS: 'TAREFAS DELEGADAS', SACPATOLOGIAS: 'SAC PATOLOGIAS' };
  const byPhysical = Object.fromEntries(Object.entries(physical).map(([canonical, actual]) => [actual, canonical]));
  const result = await load(repository({
    async resolveList(_site, aliases) {
      const actual = physical[aliases[0]];
      if (actual && !aliases.includes(actual)) return { status: 'missing' };
      return { status: 'resolved', id: actual || aliases[0] };
    },
    async getColumns(_site, list) {
      return schemas[byPhysical[list] || list].map((displayName, i) => ({ name: `field_${i}`, displayName }));
    },
    async getItemsPage(_site, list) {
      const fields = { DOCUMENTOS: { field_0: 'PENDENTE' }, 'LANCAMENTO TAREFAS': { field_0: 'ATIVIDADE CRIADA', field_1: '2026-10-07' },
        'NOVA COTAÇÃO': { field_0: 'ATIVA' }, 'TAREFAS DELEGADAS': { field_0: 'EM ATENDIMENTO' }, 'SAC PATOLOGIAS': { field_0: 'ATIVO' } };
      return page(fields[list] ? [{ id: '1', fields: fields[list] }] : []);
    },
  }));
  assert.deepEqual(result.metrics, { ...zero, documents: 1, pendingTasks: 1, quotes: 1, delegatedTasks: 1, activePathologies: 1 });
  assert.deepEqual(result.warnings, []);
});
