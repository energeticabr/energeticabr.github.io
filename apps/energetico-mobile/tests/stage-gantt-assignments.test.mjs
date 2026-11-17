import test from 'node:test';
import assert from 'node:assert/strict';
import { createStageProgressData } from '../src/chat/stage-progress-data.js';

const columns = [
  ['reference', 'IDDESCRITIVOETAPA'], ['date', 'DATA'], ['person', 'FORNECEDOR'],
  ['trade', 'PROFISSÃO'], ['presence', 'PRESENÇA'], ['branch', 'FILIAL'],
].map(([name, displayName]) => ({ name, displayName, text: {} }));
const row = (id, reference, date, presence = 'PRESENTE', branch = "Obra D'Ávila") => ({ id, fields: {
  reference, date, presence, branch, person: { Value: 'João' }, trade: 'PEDREIRO',
} });

test('consulta paginada usa ID do demonstrativo e filial e conta somente presentes', async () => {
  const calls = [];
  const data = createStageProgressData({ repository: {
    async resolveList(_site, aliases) { assert.equal(aliases[0], 'DESCRITIVOPRESENCA'); return { status: 'resolved', id: 'presences' }; },
    async getColumns() { return columns; },
    async getItemsPage(_site, _list, query, options) {
      calls.push(options);
      assert.equal(new URLSearchParams(query).get('$filter'), "fields/branch eq 'Obra D''Ávila'");
      return options.cursor ? { items: [row('6', '129', '2026-11-05')], hasMore: false }
        : { items: [row('1', '129', '2026-11-01'), row('2', '130', '2026-11-03'),
          row('3', '129', '2026-11-03', 'AUSENTE'), row('4', '129', 'bad', 'PRESENTE', 'Outra'),
          row('5', '', 'bad', 'PRESENTE')], hasMore: true, nextLink: 'page2' };
    },
  } });
  const result = await data.loadGanttAssignments({ branch: "Obra D'Ávila", activityIds: ['129'] });
  assert.deepEqual(result, { complete: true, rows: [
    { id: '1', activityId: '129', date: '2026-11-01', supplier: 'João', profession: 'PEDREIRO' },
    { id: '6', activityId: '129', date: '2026-11-05', supplier: 'João', profession: 'PEDREIRO' },
  ] });
  assert.equal(calls.length, 2);
});

test('lookup numérico, fallback de filtro e cancelamento preservam o vínculo exato', async () => {
  let calls = 0;
  const data = createStageProgressData({ repository: {
    async resolveList() { return { status: 'resolved', id: 'presences' }; },
    async getColumns() { return columns.map(col => col.name === 'reference' ? { ...col, lookup: {} } : col); },
    async getItemsPage(_site, _list, query) {
      calls++;
      if (new URLSearchParams(query).has('$filter')) throw Object.assign(new Error('unindexed'), { status: 400 });
      const entry = row('1', 'bad text', '2026-11-04'); entry.fields.referenceLookupId = 129;
      return { items: [entry], hasMore: false };
    },
  } });
  assert.equal((await data.loadGanttAssignments({ branch: "Obra D'Ávila", activityIds: ['129'] })).rows[0].activityId, '129');
  assert.equal(calls, 2);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(data.loadGanttAssignments({ branch: 'A', activityIds: ['129'] }, { signal: controller.signal }), /abort/i);
  await assert.rejects(data.loadGanttAssignments({ branch: 'A', activityIds: ['0'] }), /ID/i);
});
