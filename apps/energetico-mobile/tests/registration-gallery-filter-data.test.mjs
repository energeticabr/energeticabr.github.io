import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharePointRepository } from '../../../portal/data/sharepoint-repository.js';
const api = await import('../src/chat/registration-gallery-filter-data.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});

function service(kind, overrides = {}) {
  assert.equal(typeof api.createRegistrationGalleryFilterData, 'function', 'catalog filter service exists');
  const calls = [];
  const repository = {
    async resolveList(site, aliases, options) { calls.push(['resolve', site, aliases, options]); return { status: 'resolved', id: aliases[0] }; },
    async getColumns(site, list, options) { calls.push(['columns', site, list, options]); return [{ name: 'Title', displayName: 'FILIAL' }]; },
    async getItemsPage(site, list, query, options) { calls.push(['page', site, list, query, options]); return { items: [{ id: '1', fields: { Title: '001 - Centro' } }], hasMore: false }; },
    ...overrides,
  };
  return { data: api.createRegistrationGalleryFilterData({ repository, kind }), calls, repository };
}
const column = (name, displayName = name) => ({ name, displayName });
const page = items => ({ items, hasMore: false });
const row = (id, fields) => ({ id: String(id), fields });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('catalog descriptors reflect exact source lists and dependency rules across all twelve kinds', () => {
  const { data } = service('asset');
  assert.equal(data.getFilterSource('IMOBILIZADO').listName, 'CADASTROIMOBILIZADO');
  assert.equal(data.getFilterSource('FILIAL').sourceField, 'FILIAL');
  assert.equal(data.getFilterSource('STATUS'), null);
  assert.equal(api.getRegistrationGalleryFilterSource('assetProduct', 'FUNCAO').listName, 'FUNCAOIMOBILIZADO');
  assert.equal(api.getRegistrationGalleryFilterSource('assetGroup', 'GRUPOIMOBILIZADOS').sourceField, 'GRUPOIMOBILIZADO');
  assert.deepEqual(api.getRegistrationGalleryFilterSource('workDiary', 'ETAPA').dependsOn, ['FILIAL']);
  assert.deepEqual(api.getRegistrationGalleryFilterSource('quotes', 'ETAPA').disabledUntil, ['FILIAL']);
  assert.equal(api.getRegistrationGalleryFilterSource('assetFunction', 'FUNCAO'), null);
  assert.equal(api.getRegistrationGalleryFilterSource('contracts', 'FORNECEDOR').listName, 'FORNECEDORES');
  assert.deepEqual(api.getRegistrationGalleryFilterSource('contractLines', 'IDCONTRATO').dependsOn, ['FORNECEDOR']);
  assert.equal(api.getRegistrationGalleryFilterSource('measurements', 'FORNECEDOR'), null);
  assert.equal(api.getRegistrationGalleryFilterSource('measurementLines', 'NUMEROCONTRATO').sourceField, 'ID');
  assert.equal(api.getRegistrationGalleryFilterSource('stageDemonstratives', 'ATIVIDADEEXECUTADA').listName, 'ATIVIDADE EXECUTADA');
  assert.deepEqual(api.getRegistrationGalleryFilterSource('constructionStages', 'ETAPA').dependsOn, ['FILIAL']);
});

test('resolves live metadata aliases and reads every catalog page before returning choices', async () => {
  const { data, calls } = service('asset', { async getItemsPage(site, list, query, options) {
    calls.push(['page', site, list, query, options]);
    return options.cursor ? page([row(3, { Title: '002 - Norte' }), row(4, { Title: '001 - Centro' })])
      : { items: [row(1, { Title: '001 - Centro' }), row(2, { Title: '' })], hasMore: true, nextLink: 'next-catalog-page' };
  } });
  assert.deepEqual(await data.loadFilterOptions('FILIAL'), [{ value: '001 - Centro', label: '001 - Centro' }, { value: '002 - Norte', label: '002 - Norte' }]);
  const pages = calls.filter(call => call[0] === 'page');
  assert.equal(pages.length, 2);
  assert.match(pages[0][3], /fields\(\$select=Title\)/);
  assert.equal(pages[1][4].cursor, 'next-catalog-page');
});

test('foreign product and group catalogs retain choices absent from gallery records', async () => {
  const { data } = service('assetGroup', { async getColumns() { return [column('groupInternal', 'GRUPOIMOBILIZADO')]; }, async getItemsPage(site, list, query) {
    assert.equal(list, 'CADASTROIMOBILIZADO'); assert.match(query, /groupInternal/);
    return page([row(7, { groupInternal: 'GRUPO A' })]);
  } });
  assert.deepEqual(await data.loadFilterOptions('GRUPOIMOBILIZADOS'), [{ value: 'GRUPO A', label: 'GRUPO A' }]);
  assert.equal(await data.loadFilterOptions('STATUS'), null);
});

test('stages resolve field_3 and branch dependencies independently of unrelated active filters', async () => {
  const { data } = service('workDiary', {
    async getColumns() { return [column('field_3', 'ETAPA'), column('branchInternal', 'FILIAL')]; },
    async getItemsPage() { return page([row(1, { field_3: 'Fundação', branchInternal: 'A' }), row(2, { field_3: 'Cobertura', branchInternal: 'B' })]); },
  });
  assert.deepEqual(await data.loadFilterOptions('ETAPA', { filters: { FILIAL: 'A', STATUS: 'CONCLUÍDO' } }), [{ value: 'Fundação', label: 'Fundação' }]);
  assert.equal((await data.loadFilterOptions('ETAPA', { filters: {} })).length, 2);
});

test('quotation stages stay disabled without a branch and construction stages use strict branch equality', async () => {
  const { data, calls } = service('quotes');
  assert.deepEqual(await data.loadFilterOptions('ETAPA'), []);
  assert.equal(calls.length, 0);
  const { data: stages } = service('constructionStages', { async getColumns() { return [column('field_3', 'ETAPA'), column('FILIAL')]; }, async getItemsPage() { return page([row(1, { field_3: 'Sem filial', FILIAL: '' }), row(2, { field_3: 'Filial A', FILIAL: 'A' })]); } });
  assert.deepEqual(await stages.loadFilterOptions('ETAPA'), [{ value: 'Sem filial', label: 'Sem filial' }]);
});

test('contract supplier catalogs enforce source flags and contract IDs include supplier labels', async () => {
  const { data } = service('contractLines', { async getColumns(site, list) {
    return list === 'FORNECEDORES' ? [column('Title', 'CADASTRO'), column('EMPREITEIRO'), column('STATUS')]
      : [column('ID'), column('FORNECEDOR'), column('STATUS')];
  }, async getItemsPage(site, list) { return list === 'FORNECEDORES'
    ? page([row(1, { Title: 'Fornecedor A', EMPREITEIRO: 'SIM', STATUS: 'ATIVO' }), row(2, { Title: 'Fornecedor B', EMPREITEIRO: 'NÃO', STATUS: 'ATIVO' }), row(3, { Title: 'Inativo', EMPREITEIRO: 'SIM', STATUS: 'INATIVO' })])
    : page([row(25, { FORNECEDOR: 'Fornecedor A', STATUS: 'ATIVO' }), row(26, { FORNECEDOR: 'Fornecedor B', STATUS: 'ATIVO' }), row(27, { FORNECEDOR: 'Fornecedor A', STATUS: 'INATIVO' })]); } });
  assert.deepEqual(await data.loadFilterOptions('FORNECEDOR'), [{ value: 'Fornecedor A', label: 'Fornecedor A' }]);
  assert.deepEqual(await data.loadFilterOptions('IDCONTRATO', { filters: { FORNECEDOR: 'Fornecedor A' } }), [{ value: '25', label: '25 - Fornecedor A' }]);
});

test('missing and ambiguous metadata/list resolution fail closed rather than return no choices', async () => {
  for (const override of [
    { async resolveList() { return { status: 'missing' }; } },
    { async resolveList() { return { status: 'ambiguous', id: 'a' }; } },
    { async listLists() { return [{ id: 'a', displayName: 'FILIAIS' }, { id: 'b', displayName: 'FILIAIS' }]; } },
    { async getColumns() { return []; } },
    { async getColumns() { return [column('Title', 'FILIAL'), column('another', 'FILIAL')]; } },
    { async getItemsPage() { throw new Error('forbidden catalog'); } },
  ]) {
    const { data } = service('asset', override);
    await assert.rejects(data.loadFilterOptions('FILIAL'));
  }
});

test('Graph title mirrors do not make catalog labels ambiguous', async () => {
  const { data, calls } = service('asset', { async getColumns() { return [
    column('Title', 'FILIAL'),
    { ...column('LinkTitle', 'FILIAL'), readOnly: true },
    { ...column('LinkTitleNoMenu', 'FILIAL'), readOnly: true },
    { ...column('ComputedFilial', 'FILIAL'), computed: true },
    { ...column('ArchivedFilial', 'FILIAL'), hidden: true },
  ]; } });
  assert.deepEqual(await data.loadFilterOptions('FILIAL'), [{ value: '001 - Centro', label: '001 - Centro' }]);
  assert.match(calls.find(call => call[0] === 'page')[3], /fields\(\$select=Title\)/);
});

test('unique read-only catalog fields remain usable for contract IDs', async () => {
  const { data } = service('contractLines', { async getColumns() { return [
    { ...column('ID'), readOnly: true }, column('STATUS'), column('FORNECEDOR'),
  ]; }, async getItemsPage() { return page([row(25, { STATUS: 'ATIVO', FORNECEDOR: 'BERNARDO' })]); } });
  assert.deepEqual(await data.loadFilterOptions('IDCONTRATO'), [{ value: '25', label: '25 - BERNARDO' }]);
});

test('a missing or repeated paging cursor rejects instead of exposing partial choices', async () => {
  for (const nextLink of [undefined, 'repeating']) {
    const { data } = service('asset', { async getItemsPage() { return { items: [row(1, { Title: 'partial' })], hasMore: true, nextLink }; } });
    await assert.rejects(data.loadFilterOptions('FILIAL'), /cursor|paginação/i);
  }
});

test('aborting a caller promptly rejects a noncooperative repository read without caching it', async () => {
  const pending = deferred(); const abort = new AbortController();
  const { data, calls } = service('asset', { async getItemsPage(site, list, query, options) { calls.push(['signal', options.signal]); return pending.promise; } });
  const request = data.loadFilterOptions('FILIAL', { signal: abort.signal });
  await new Promise(resolve => setImmediate(resolve)); abort.abort();
  await assert.rejects(request, { name: 'AbortError' });
  assert.equal(calls.find(call => call[0] === 'signal')[1], abort.signal);
  pending.resolve(page([row(1, { Title: 'late' })]));
});

test('superseded callers cannot cache stale catalog results and refresh bypasses successful cache', async () => {
  const first = deferred(); let reads = 0;
  const { data } = service('asset', { async getItemsPage() { reads += 1; return reads === 1 ? first.promise : page([row(2, { Title: `current-${reads}` })]); } });
  const older = data.loadFilterOptions('FILIAL');
  await new Promise(resolve => setImmediate(resolve));
  const newer = await data.loadFilterOptions('FILIAL', { refresh: true });
  first.resolve(page([row(1, { Title: 'stale' })]));
  await assert.rejects(older, { name: 'AbortError' });
  assert.deepEqual(await data.loadFilterOptions('FILIAL'), newer);
  assert.equal(reads, 2);
  assert.deepEqual(await data.loadFilterOptions('FILIAL', { refresh: true }), [{ value: 'current-3', label: 'current-3' }]);
});

test('failed explicit refresh invalidates old choices until a successful catalog read', async () => {
  let forbidden = false; let reads = 0;
  const { data } = service('asset', { async getItemsPage() { reads += 1; if (forbidden) throw new Error('catalog forbidden'); return page([row(1, { Title: 'old choice' })]); } });
  await data.loadFilterOptions('FILIAL'); forbidden = true;
  await assert.rejects(data.loadFilterOptions('FILIAL', { refresh: true }), /forbidden/);
  await assert.rejects(data.loadFilterOptions('FILIAL'), /forbidden/);
  assert.equal(reads, 3);
});

test('proven source aliases work with internal-only schema names and pre-aborted callers read nothing', async () => {
  const { data, calls } = service('asset', { async getColumns() { return [column('Title')]; } });
  assert.deepEqual(await data.loadFilterOptions('FILIAL'), [{ value: '001 - Centro', label: '001 - Centro' }]);
  const abort = new AbortController(); abort.abort();
  const before = calls.length;
  await assert.rejects(data.loadFilterOptions('FILIAL', { refresh: true, signal: abort.signal }), { name: 'AbortError' });
  assert.equal(calls.length, before);
});

test('measurement supplier options depend only on branch and active contract options exclude inactive contracts', async () => {
  const { data } = service('measurementLines', { async getColumns(site, list) {
    return list === 'LINHASMEDICAO' ? [column('FILIAL'), column('FORNECEDOR')] : [column('ID'), column('FORNECEDOR'), column('STATUS')];
  }, async getItemsPage(site, list) {
    return list === 'LINHASMEDICAO' ? page([row(1, { FILIAL: 'A', FORNECEDOR: 'Ana' }), row(2, { FILIAL: 'B', FORNECEDOR: 'Bia' })])
      : page([row(10, { FORNECEDOR: 'Ana', STATUS: 'ATIVO' }), row(11, { FORNECEDOR: 'Bia', STATUS: 'INATIVO' })]);
  } });
  assert.deepEqual(await data.loadFilterOptions('FORNECEDOR', { filters: { FILIAL: 'B', STATUS: 'PAGO' } }), [{ value: 'Bia', label: 'Bia' }]);
  assert.deepEqual(await data.loadFilterOptions('NUMEROCONTRATO'), [{ value: '10', label: '10 - Ana' }]);
});

test('row-only snapshot repositories can inspect descriptors but sourced loads require metadata', async () => {
  const { repository } = service('asset');
  delete repository.getColumns;
  const data = api.createRegistrationGalleryFilterData({ repository, kind: 'asset' });
  assert.equal(data.getFilterSource('FILIAL').listName, 'FILIAIS');
  assert.equal(await data.loadFilterOptions('STATUS'), null);
  await assert.rejects(data.loadFilterOptions('FILIAL'), /metadados/i);
});


function productionRepository({ endless = false } = {}) {
  let itemReads = 0;
  const graph = { async request(path) {
    const url = new URL(path, 'https://graph.microsoft.com/v1.0');
    if (path === '/sites/catalog.test:/personal/catalog') return { id: 'catalog-site' };
    if (path.startsWith('/sites/catalog-site/lists?')) return { value: [{ id: 'catalog-list', displayName: 'FILIAIS', list: { template: 'genericList' } }] };
    if (path.endsWith('/columns')) return { value: [column('Title', 'FILIAL')] };
    if (!url.pathname.endsWith('/lists/catalog-list/items')) throw new Error(`Unexpected Graph request: ${path}`);
    itemReads += 1;
    const next = `https://graph.microsoft.com/v1.0/sites/catalog-site/lists/catalog-list/items?$skiptoken=page-${itemReads + 1}`;
    return { value: [row(itemReads, { Title: `Branch ${itemReads}` })], ...(endless || itemReads === 1 ? { '@odata.nextLink': next } : {}) };
  } };
  return { repository: createSharePointRepository(graph, { personal: { host: 'catalog.test', path: '/personal/catalog', readTransport: 'graph' } }), itemReads: () => itemReads };
}

test('catalog reads pass the real SharePoint paging and Graph batch guards across two pages', async () => {
  const real = productionRepository();
  const data = api.createRegistrationGalleryFilterData({ repository: real.repository, kind: 'asset' });
  assert.deepEqual(await data.loadFilterOptions('FILIAL'), [{ value: 'Branch 1', label: 'Branch 1' }, { value: 'Branch 2', label: 'Branch 2' }]);
  assert.equal(real.itemReads(), 2);
});

test('an exhausted production paging budget rejects without exposing the first hundred pages', async () => {
  const real = productionRepository({ endless: true });
  const data = api.createRegistrationGalleryFilterData({ repository: real.repository, kind: 'asset' });
  await assert.rejects(data.loadFilterOptions('FILIAL'), /excedeu o limite seguro/);
  assert.equal(real.itemReads(), 100);
});
