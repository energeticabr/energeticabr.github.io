import test from 'node:test';
import assert from 'node:assert/strict';
const module = await import('../src/chat/diary-field-visits.js').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {};
});
const createData = options => {
  assert.equal(typeof module.createDiaryFieldVisitData, 'function', 'consulta de visitas deve existir');
  return module.createDiaryFieldVisitData(options);
};
const diary = (id, date, branch = '004 - EDIFÍCIO XAVANTE') => ({ id, fields: { status: 'PENDENTE', day: date, branch } });
const launch = (id, date, branch = '004 - EDIFÍCIO XAVANTE', product = 'VISITA EM CAMPO') => ({ id, fields: { field_2: date, field_7: product, FILIAL: branch } });
function fixture({ diaries = [diary('219', '2026-10-16'), diary('218', '2026-10-15'), diary('217', '2026-10-14')], pages = [{ items: [], hasMore: false }], launchColumns, diaryDateFormat = 'dateOnly' } = {}) {
  const queries = [];
  const repository = {
    async resolveList(site, aliases) { assert.equal(site, 'personal'); return { status: 'resolved', id: aliases.includes('LANCAMENTOS') ? 'launches' : 'diaries' }; },
    async getColumns(site, list) { return list === 'diaries' ? [
      { name: 'status', displayName: 'STATUS' }, { name: 'day', displayName: 'DATA', dateTime: { format: diaryDateFormat } }, { name: 'branch', displayName: 'FILIAL' },
    ] : launchColumns || [{ name: 'field_2', displayName: 'DATA', dateTime: { format: 'dateOnly' } },
      { name: 'field_7', displayName: 'PRODUTO' }, { name: 'FILIAL', displayName: 'FILIAL' }]; },
    async getItemsPage(site, list, query, options) {
      queries.push({ list, query, options });
      return list === 'diaries' ? { items: diaries, hasMore: false } : pages[options.pageNumber - 1];
    },
    updateItem() { assert.fail('indicador não pode gravar'); },
    createItem() { assert.fail('indicador não pode criar'); },
  };
  return { repository, queries };
}

test('casinha exige PRODUTO exato, mesma filial e data; nenhuma consulta por botão', async () => {
  const f = fixture({ pages: [{ items: [launch('1', '2026-10-16T00:00:00Z'), launch('2', '2026-10-15', '005 - OUTRA OBRA'),
    launch('3', '2026-10-14', undefined, 'MATERIAL'), launch('4', '2026-10-13'), launch('5', '2026-10-16')], hasMore: false }] });
  const result = await createData(f).load({ diaryIds: ['219', '218', '217'] });
  assert.deepEqual(result, ['219']);
  const reads = f.queries.filter(row => row.list === 'launches');
  assert.equal(reads.length, 1);
  assert.match(reads[0].query, /fields\/field_7 eq 'VISITA EM CAMPO'/);
  assert.match(reads[0].query, /fields\(\$select=field_2,field_7,FILIAL\)/);
});

test('visita em segunda página e valores SharePoint expandidos marcam cada diário correspondente', async () => {
  const f = fixture({ pages: [
    { items: [launch('1', '2026-10-16')], hasMore: true, nextLink: 'page-two' },
    { items: [launch('2', '2026-10-15', { LookupValue: '004 - EDIFÍCIO XAVANTE' }, { Value: 'VISITA EM CAMPO' })], hasMore: false },
  ] });
  assert.deepEqual(await createData(f).load({ diaryIds: ['219', '218'] }), ['219', '218']);
  assert.equal(f.queries.at(-1).options.cursor, 'page-two');
});

test('data com horário usa o calendário de São Paulo e não aceita data impossível', async () => {
  const f = fixture({ pages: [{ items: [launch('1', '2026-10-17T01:30:00Z'), launch('2', '2026-02-30T12:00:00Z')], hasMore: false }],
    launchColumns: [{ name: 'field_2', displayName: 'DATA', dateTime: { format: 'dateTime' } }, { name: 'field_7', displayName: 'PRODUTO' }, { name: 'FILIAL', displayName: 'FILIAL' }] });
  assert.deepEqual(await createData(f).load({ diaryIds: ['219', '218'] }), ['219']);
});

test('meia-noite UTC em lançamento dateTime pertence ao dia anterior em São Paulo, não ao dia de dateOnly', async () => {
  const f = fixture({ diaries: [diary('219', '2026-10-16'), diary('220', '2026-10-17')],
    pages: [{ items: [launch('1', '2026-10-17T00:00:00Z')], hasMore: false }],
    launchColumns: [{ name: 'field_2', displayName: 'DATA', dateTime: { format: 'dateTime' } }, { name: 'field_7', displayName: 'PRODUTO' }, { name: 'FILIAL', displayName: 'FILIAL' }] });
  assert.deepEqual(await createData(f).load({ diaryIds: ['219', '220'] }), ['219']);
  const calendar = fixture({ diaries: [diary('219', '2026-10-16'), diary('220', '2026-10-17')], pages: [{ items: [launch('1', '2026-10-17T00:00:00Z')], hasMore: false }] });
  assert.deepEqual(await createData(calendar).load({ diaryIds: ['219', '220'] }), ['220']);
});

test('metadado dateTime do próprio diário também determina o dia local da visita', async () => {
  const f = fixture({ diaries: [diary('219', '2026-10-17T00:00:00Z')], diaryDateFormat: 'dateTime',
    pages: [{ items: [launch('1', '2026-10-16')], hasMore: false }] });
  assert.deepEqual(await createData(f).load({ diaryIds: ['219'] }), ['219']);
});

test('metadados ambíguos, página parcial e cursor circular não se tornam ausência de visita', async () => {
  for (const input of [
    { launchColumns: [{ name: 'a', displayName: 'DATA' }, { name: 'b', displayName: 'DATA' }, { name: 'p', displayName: 'PRODUTO' }, { name: 'f', displayName: 'FILIAL' }] },
    { pages: [{ items: [launch('1', '2026-10-16')], hasMore: false, partial: true }] },
    { pages: [{ items: [launch('1', '2026-10-16')], hasMore: true, nextLink: 'same' }, { items: [], hasMore: true, nextLink: 'same' }] },
  ]) {
    await assert.rejects(createData(fixture(input)).load({ diaryIds: ['219'] }));
  }
});

test('IDs não selecionáveis e cancelamento não consultam lançamentos nem retornam dados tardios', async () => {
  const f = fixture(); const data = createData(f);
  assert.deepEqual(await data.load({ diaryIds: [] }), []);
  assert.equal(f.queries.length, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(data.load({ diaryIds: ['219'], signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.queries.length, 0);
});

test('colunas auxiliares LinkTitle não tornam PRODUTO renomeado ambíguo', async () => {
  const f = fixture({ launchColumns: [{ name: 'field_2', displayName: 'DATA' }, { name: 'Title', displayName: 'PRODUTO' },
    { name: 'LinkTitle', displayName: 'PRODUTO' }, { name: 'FILIAL', displayName: 'FILIAL' }],
    pages: [{ items: [{ id: '1', fields: { field_2: '2026-10-16', Title: 'VISITA EM CAMPO', FILIAL: '004 - EDIFÍCIO XAVANTE' } }], hasMore: false }] });
  assert.deepEqual(await createData(f).load({ diaryIds: ['219'] }), ['219']);
});
