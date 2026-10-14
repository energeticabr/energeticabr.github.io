import test from 'node:test';
import assert from 'node:assert/strict';
import { recentDiaryActivities, appendRecentDiaryActivity } from '../src/chat/construction-diary-activity-suggestions.js';
import { createRecentConstructionDiaryActivitiesData } from '../src/chat/recent-construction-diary-activities.js';

test('lista itens individuais dos últimos cinco dias sem repetições, mesmo com numeração e grafia diferentes', () => {
  const rows = [
    { fields: { DATA: '14/10/2026', ATIVIDADEEXECUTADA: '1. Impermeabilização arrimo;\n2. Marcação tubulões;\n3. ' } },
    { fields: { DATA: '10/10/2026', ATIVIDADEEXECUTADA: '1. impermeabilização  ARRIMO.;\n2. Escoramento laje;' } },
    { fields: { DATA: '09/10/2026', ATIVIDADEEXECUTADA: 'Atividade antiga' } },
    { fields: { DATA: '15/10/2026', ATIVIDADEEXECUTADA: 'Atividade futura' } },
  ];
  assert.deepEqual(recentDiaryActivities(rows, { today: '2026-10-14' }), [
    'Impermeabilização arrimo', 'Marcação tubulões', 'Escoramento laje',
  ]);
});

test('seleção só acrescenta atividade única ao rascunho numerado, preservando o campo final vazio', () => {
  assert.equal(appendRecentDiaryActivity('1. ', 'Impermeabilização arrimo'), '1. Impermeabilização arrimo;\n2. ');
  assert.equal(appendRecentDiaryActivity('1. Impermeabilização arrimo;\n2. ', 'Escoramento laje'), '1. Impermeabilização arrimo;\n2. Escoramento laje;\n3. ');
  assert.equal(appendRecentDiaryActivity('1. Impermeabilização arrimo;\n2. ', 'impermeabilização  ARRIMO;'), '1. Impermeabilização arrimo;\n2. ');
});

test('data SharePoint à meia-noite não retrocede um dia e lista inline é separada por atividade', () => {
  assert.deepEqual(recentDiaryActivities([{ fields: {
    DATA: '2026-10-10T00:00:00Z', ATIVIDADEEXECUTADA: '1. Concretagem; 2. ESCORAMENTO; 3. ',
  } }], { today: '2026-10-14' }), ['Concretagem', 'ESCORAMENTO']);
});

test('consulta a lista DIÁRIO DE OBRAS e pagina sem truncar sugestões', async () => {
  const calls = [];
  const repository = {
    resolveList: async () => ({ status: 'resolved', id: 'diary-list' }),
    getColumns: async () => [{ name: 'DATA', displayName: 'DATA' }, { name: 'ATIVIDADEEXECUTADA', displayName: 'ATIVIDADES EXECUTADAS' }],
    getItemsPage: async (_site, _list, query, options) => {
      calls.push({ query, options });
      return options.cursor
        ? { items: [{ fields: { DATA: '13/10/2026', ATIVIDADEEXECUTADA: '2. Escoramento laje;' } }], hasMore: false }
        : { items: [{ fields: { DATA: '14/10/2026', ATIVIDADEEXECUTADA: '1. Impermeabilização arrimo;' } }], hasMore: true, nextLink: 'next' };
    },
  };
  const data = createRecentConstructionDiaryActivitiesData({ repository });
  assert.deepEqual(await data.load({ today: '2026-10-14' }), ['Impermeabilização arrimo', 'Escoramento laje']);
  assert.equal(calls.length, 2);
  assert.match(calls[0].query, /DATA/);
  assert.match(calls[0].query, /2026-10-10/);
});
