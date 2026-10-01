import test from 'node:test';
import assert from 'node:assert/strict';
import { createPendingConstructionDiaryData } from '../src/chat/pending-construction-diary-data.js';

const columns = [
  { name: 'field_9', displayName: 'STATUS' }, { name: 'field_1', displayName: 'DATA' },
  { name: 'field_5', displayName: 'FILIAL' }, { name: 'field_7', displayName: 'RESPONSAVELTECNICO' },
];
function repository(pages, metadata = columns) {
  const queries = [];
  return {
    queries,
    async resolveList(site, aliases) { assert.equal(site, 'personal'); assert.ok(aliases.includes('DIÁRIO DE OBRAS')); return { status: 'resolved', id: 'diaries' }; },
    async getColumns() { return metadata; },
    async getItemsPage(site, list, query, options) { queries.push({ query, options }); return pages[options.pageNumber - 1]; },
    updateItem() { throw new Error('O lembrete não pode editar registros.'); },
  };
}
const pending = (id, fields = {}) => ({ id, fields: { field_9: 'PENDENTE', field_1: '2026-09-30', field_5: 'Obra A', field_7: 'Bernardo', ...fields } });

test('consulta diários pendentes pelos nomes internos reais e inclui todas as páginas', async () => {
  const repo = repository([
    { items: [pending('17'), pending('18', { field_9: 'POSTADO' })], hasMore: true, nextLink: 'next-page' },
    { items: [pending('19', { field_1: '2026-09-29', field_5: { LookupValue: 'Obra B' }, field_7: { DisplayName: 'Responsável B' } }), pending('17')], hasMore: false },
  ]);
  const data = createPendingConstructionDiaryData({ repository: repo });
  const snapshot = await data.loadSnapshot();
  assert.deepEqual(snapshot.rows.map(row => row.id), ['19', '17']);
  assert.deepEqual(snapshot.rows[0], { id: '19', status: 'PENDENTE', date: '2026-09-29', branch: 'Obra B', responsible: 'Responsável B' });
  assert.equal(snapshot.count, 2);
  assert.match(repo.queries[0].query, /fields\/field_9 eq 'PENDENTE'/);
  assert.equal(repo.queries[1].options.cursor, 'next-page');
});

test('não inclui diários postados, sem status ou sem ID válido', async () => {
  const repo = repository([{ items: [pending('17', { field_9: null }), pending('18', { field_9: 'CONCLUÍDO' }), pending('x'), pending('0')], hasMore: false }]);
  assert.deepEqual((await createPendingConstructionDiaryData({ repository: repo }).loadSnapshot()).rows, []);
});

test('identifica STATUS mesmo com nome codificado e aceita valores de escolha SharePoint', async () => {
  const repo = repository([{ items: [{ id: '2', fields: { STATUS: { Value: 'PENDENTE' } } }], hasMore: false }], [{ name: 'STATUS', displayName: 'Status' }]);
  const snapshot = await createPendingConstructionDiaryData({ repository: repo }).loadSnapshot();
  assert.deepEqual(snapshot.rows, [{ id: '2', status: 'PENDENTE', date: '', branch: '', responsible: '' }]);
});

test('não trata metadados ambíguos como ausência de diários', async () => {
  const repo = repository([], [{ name: 'field_1', displayName: 'STATUS' }, { name: 'field_2', displayName: 'STATUS' }]);
  await assert.rejects(createPendingConstructionDiaryData({ repository: repo }).loadSnapshot(), /STATUS/);
});

test('não retorna lista parcial se a paginação estiver incompleta', async () => {
  const repo = repository([{ items: [pending('17')], hasMore: true }]);
  await assert.rejects(createPendingConstructionDiaryData({ repository: repo }).loadSnapshot(), /paginação/i);
});

test('respeita cancelamento da consulta autenticada', async () => {
  const controller = new AbortController();
  controller.abort();
  const repo = repository([]);
  await assert.rejects(createPendingConstructionDiaryData({ repository: repo }).loadSnapshot({ signal: controller.signal }), { name: 'AbortError' });
});
