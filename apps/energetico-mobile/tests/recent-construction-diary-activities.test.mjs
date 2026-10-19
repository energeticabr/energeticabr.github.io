import test from 'node:test';
import assert from 'node:assert/strict';
import { recentDiaryActivities, appendRecentDiaryActivity } from '../src/chat/construction-diary-activity-suggestions.js';
import { createRecentConstructionDiaryActivitiesData } from '../src/chat/recent-construction-diary-activities.js';

test('analisa os cinco diários concluídos anteriores, não cinco dias corridos ou a data atual', () => {
  const rows = [
    { id: '13', fields: { DATA: '13/10/2026', STATUS: 'CONCLUÍDO', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: '1. Impermeabilização arrimo;\n2. Marcação tubulões;\n3. ' } },
    { id: '10', fields: { DATA: '10/10/2026', STATUS: 'CONCLUÍDO', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: '1. impermeabilização  ARRIMO.;\n2. Escoramento laje;' } },
    ...['08', '03', '01'].map(day => ({ id: day, fields: { DATA: `2026-10-${day}`, STATUS: 'CONCLUÍDO', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: `Atividade ${day}` } })),
    { id: '99', fields: { DATA: '30/09/2026', STATUS: 'CONCLUÍDO', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: 'Sexto diário' } },
    { id: '14', fields: { DATA: '14/10/2026', STATUS: 'CONCLUÍDO', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: 'Mesmo dia' } },
    { id: '15', fields: { DATA: '15/10/2026', STATUS: 'CONCLUÍDO', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: 'Futuro' } },
    { id: '16', fields: { DATA: '13/10/2026', STATUS: 'PENDENTE', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: 'Incompleto' } },
    { id: '17', fields: { DATA: '13/10/2026', STATUS: 'CONCLUÍDO', FILIAL: 'Obra B', ATIVIDADEEXECUTADA: 'Outra obra' } },
  ];
  assert.deepEqual(recentDiaryActivities(rows.reverse(), { diaryDate: '2026-10-14', branch: 'Obra A' }), [
    'Impermeabilização arrimo', 'Marcação tubulões', 'Escoramento laje', 'Atividade 08', 'Atividade 03', 'Atividade 01',
  ]);
});

test('seleção só acrescenta atividade única ao rascunho numerado, preservando o campo final vazio', () => {
  assert.equal(appendRecentDiaryActivity('1. ', 'Impermeabilização arrimo'), '1. Impermeabilização arrimo;\n2. ');
  assert.equal(appendRecentDiaryActivity('1. Impermeabilização arrimo;\n2. ', 'Escoramento laje'), '1. Impermeabilização arrimo;\n2. Escoramento laje;\n3. ');
  assert.equal(appendRecentDiaryActivity('1. Impermeabilização arrimo;\n2. ', 'impermeabilização  ARRIMO;'), '1. Impermeabilização arrimo;\n2. ');
});

test('data SharePoint à meia-noite não retrocede um dia e lista inline é separada por atividade', () => {
  assert.deepEqual(recentDiaryActivities([{ fields: {
    DATA: '2026-10-10T00:00:00Z', STATUS: 'CONCLUÍDO', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: '1. Concretagem; 2. ESCORAMENTO; 3. ',
  } }], { diaryDate: '2026-10-10', branch: 'Obra A' }), []);
  assert.deepEqual(recentDiaryActivities([{ fields: {
    DATA: '2026-10-10T00:00:00Z', STATUS: 'CONCLUÍDO', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: '1. Concretagem; 2. ESCORAMENTO; 3. ',
  } }], { diaryDate: '2026-10-14', branch: 'Obra A' }), ['Concretagem', 'ESCORAMENTO']);
});

test('consulta a lista DIÁRIO DE OBRAS e pagina sem truncar sugestões', async () => {
  const calls = [];
  const repository = {
    resolveList: async () => ({ status: 'resolved', id: 'diary-list' }),
    getColumns: async () => ['DATA', 'ATIVIDADEEXECUTADA', 'STATUS', 'FILIAL'].map(name => ({ name, displayName: name })),
    getItemsPage: async (_site, _list, query, options) => {
      calls.push({ query, options });
      return options.cursor
        ? { items: [{ id: '1', fields: { DATA: '13/10/2026', STATUS: 'CONCLUÍDO', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: '2. Escoramento laje;' } }], hasMore: false }
        : { items: [{ id: '2', fields: { DATA: '01/10/2026', STATUS: 'CONCLUÍDO', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: '1. Impermeabilização arrimo;' } }], hasMore: true, nextLink: 'next' };
    },
  };
  const data = createRecentConstructionDiaryActivitiesData({ repository });
  assert.deepEqual(await data.load({ diaryDate: '2026-10-14', branch: 'Obra A' }), ['Escoramento laje', 'Impermeabilização arrimo']);
  assert.equal(calls.length, 2);
  assert.match(calls[0].query, /DATA/);
  assert.match(calls[0].query, /STATUS.*CONCLU/);
  assert.doesNotMatch(calls[0].query, / ge /);
});

test('diários sem atividade contam no limite e desempate usa o ID, não a ordem da página', () => {
  const rows = [1, 2, 3, 4, 5, 6].map(id => ({ id: String(id), fields: {
    DATA: '2026-09-01', STATUS: 'CONCLUÍDO', FILIAL: 'Obra A', ATIVIDADEEXECUTADA: id === 1 ? 'Não deve entrar' : '',
  } }));
  assert.deepEqual(recentDiaryActivities(rows, { diaryDate: '2026-10-14', branch: 'Obra A' }), []);
});

test('sem referência válida nunca busca sugestões de hoje ou de outra filial', async () => {
  const data = createRecentConstructionDiaryActivitiesData({ repository: {
    resolveList() { assert.fail('Unexpected repository access'); },
  } });
  await assert.rejects(data.load(), /data|referência/i);
  await assert.rejects(data.load({ branch: 'Obra A' }), /data|referência/i);
  await assert.rejects(data.load({ diaryDate: '2026-10-14', branch: '' }), /filial|referência/i);
  assert.deepEqual(recentDiaryActivities([{ fields: { DATA: '2020-01-01', STATUS: 'CONCLUÍDO',
    FILIAL: 'Obra A', ATIVIDADEEXECUTADA: 'Nunca usar hoje' } }], { branch: 'Obra A' }), []);
});

test('mesmo dia com hora UTC é excluído em coluna dateOnly; dateTime respeita São Paulo', () => {
  const rows = [{ id: '1', fields: { DATA: '2026-10-14T01:00:00Z', STATUS: 'CONCLUÍDO',
    FILIAL: 'Obra A', ATIVIDADEEXECUTADA: 'Concretagem' } }];
  assert.deepEqual(recentDiaryActivities(rows, { diaryDate: '2026-10-14', branch: 'Obra A',
    dateColumn: { dateTime: { format: 'dateOnly' } } }), []);
  assert.deepEqual(recentDiaryActivities(rows, { diaryDate: '2026-10-14', branch: 'Obra A',
    dateColumn: { dateTime: { format: 'dateTime' } } }), ['Concretagem']);
});

function repositoryForPages(pages) {
  return {
    resolveList: async () => ({ status: 'resolved', id: 'diaries' }),
    getColumns: async () => ['DATA', 'ATIVIDADEEXECUTADA', 'STATUS', 'FILIAL'].map(name => ({ name, displayName: name })),
    getItemsPage: async (_site, _list, _query, options) => pages[options.pageNumber - 1],
  };
}

test('página parcial ou cursor repetido não apresenta sugestões incompletas', async () => {
  for (const pages of [
    [{ items: [], hasMore: false, partial: true }],
    [{ items: [], hasMore: true }],
    [{ items: [], hasMore: false, nextLink: 'unexpected' }],
    [{ items: [], hasMore: true, nextLink: 'repeat' }, { items: [], hasMore: true, nextLink: 'repeat' }],
  ]) {
    const data = createRecentConstructionDiaryActivitiesData({ repository: repositoryForPages(pages) });
    await assert.rejects(data.load({ diaryDate: '2026-10-14', branch: 'Obra A' }), /inválida|incompleta|repetido/i);
  }
});

test('mesmo diário em duas páginas não ocupa duas posições entre os cinco', async () => {
  const row = id => ({ id: String(id), fields: { DATA: '2026-09-01', STATUS: 'CONCLUÍDO',
    FILIAL: 'Obra A', ATIVIDADEEXECUTADA: `Atividade ${id}` } });
  const data = createRecentConstructionDiaryActivitiesData({ repository: repositoryForPages([
    { items: [row(6), row(5), row(4)], hasMore: true, nextLink: 'next' },
    { items: [row(6), row(3), row(2), row(1)], hasMore: false },
  ]) });
  assert.deepEqual(await data.load({ diaryDate: '2026-10-14', branch: 'Obra A' }),
    ['Atividade 6', 'Atividade 5', 'Atividade 4', 'Atividade 3', 'Atividade 2']);
});

test('consulta cancelada não devolve sugestões atrasadas', async () => {
  const abort = new AbortController();
  const repository = repositoryForPages([]);
  repository.getItemsPage = async () => { abort.abort(); return { items: [], hasMore: false }; };
  const data = createRecentConstructionDiaryActivitiesData({ repository });
  await assert.rejects(data.load({ diaryDate: '2026-10-14', branch: 'Obra A', signal: abort.signal }),
    error => error.name === 'AbortError');
});
