import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceIrregularity } from '../src/chat/attendance-irregularity.js';
import { saveAttendanceIrregularity } from '../src/chat/attendance-irregularity-data.js';
import { buildAttendanceRhidBadge } from '../src/chat/attendance-rhid-badges.js';

test('jornada de segunda a quinta exige justificativa fora de 8h45 a 9h30', () => {
  assert.equal(attendanceIrregularity({ date: '2026-10-12', minutes: 524 })?.limit, '8h45 a 9h30');
  assert.equal(attendanceIrregularity({ date: '2026-10-12', minutes: 525 }), null);
  assert.equal(attendanceIrregularity({ date: '2026-10-15', minutes: 570 }), null);
  assert.equal(attendanceIrregularity({ date: '2026-10-15', minutes: 571 })?.limit, '8h45 a 9h30');
});

test('sexta usa 7h40 a 8h20; fim de semana e jornadas desconhecidas não disparam', () => {
  assert.ok(attendanceIrregularity({ date: '2026-10-16', minutes: 459 }));
  assert.equal(attendanceIrregularity({ date: '2026-10-16', minutes: 460 }), null);
  assert.equal(attendanceIrregularity({ date: '2026-10-16', minutes: 500 }), null);
  assert.ok(attendanceIrregularity({ date: '2026-10-16', minutes: 501 }));
  assert.equal(attendanceIrregularity({ date: '2026-10-17', minutes: 100 }), null);
  assert.equal(attendanceIrregularity({ date: '2026-10-12' }), null);
});

test('uma batida isolada exige justificativa pelos três horários faltantes', () => {
  const date = '2026-10-16';
  const badge = buildAttendanceRhidBadge({ presenceId: '2266', name: 'HELISON ROSA LUIS', date }, {
    date, rows: [{ Id: 'rhid-17', ID_PESSOA_RHID: '17', NOME_COLABORADOR: 'HELISON ROSA LUIS',
      DATA_REFERENCIA: date, BATIDAS_RHID: '06:52' }],
  });
  assert.equal(badge.status, 'inconsistent');
  assert.deepEqual(attendanceIrregularity(badge)?.missingPunches, ['S1', 'E2', 'S2']);
});

test('horários em branco exigem justificativa mesmo com minutos dentro da faixa', () => {
  assert.deepEqual(attendanceIrregularity({ date: '2026-10-16', minutes: 460, status: 'present',
    punches: { entry1: '07:00', exit1: '14:40', entry2: null, exit2: null } })?.missingPunches, ['E2', 'S2']);
  assert.deepEqual(attendanceIrregularity({ date: '2026-10-16', status: 'absent' })?.missingPunches,
    ['E1', 'S1', 'E2', 'S2']);
  assert.equal(attendanceIrregularity({ date: '2026-10-16', status: 'unavailable' }), null);
});

test('salva apenas IRREGULARIDADES no registro e data esperados, com ETag', async () => {
  const calls = [];
  const repository = {
    resolveList: async (...args) => { calls.push(['resolve', ...args]); return { status: 'resolved', id: 'list-id' }; },
    getColumns: async () => [{ name: 'IRREGULARIDADES', text: { allowMultipleLines: true } }],
    getItem: async () => ({ id: '2249', '@odata.etag': '"2"', fields: { DATA: '2026-10-12', PRESENCA: 'PENDENTE' } }),
    updateItem: async (...args) => { calls.push(['update', ...args]); return { id: '2249' }; },
  };
  await saveAttendanceIrregularity({ repository, id: '2249', date: '2026-10-12', explanation: 'Saída autorizada.' });
  assert.deepEqual(calls[0].slice(1, 3), ['personal', ['DESCRITIVOPRESENCA']]);
  assert.deepEqual(calls[1].slice(1), ['personal', 'list-id', '2249', { IRREGULARIDADES: 'Saída autorizada.' }, { eTag: '"2"' }]);
});

test('bloqueia texto vazio, coluna ausente e registro de outra data', async () => {
  const repository = {
    resolveList: async () => ({ status: 'resolved', id: 'list-id' }),
    getColumns: async () => [],
    getItem: async () => ({ id: '2249', '@odata.etag': '"2"', fields: { DATA: '2026-10-13', PRESENCA: 'PENDENTE' } }),
    updateItem: async () => { throw new Error('não deve escrever'); },
  };
  await assert.rejects(saveAttendanceIrregularity({ repository, id: '2249', date: '2026-10-12', explanation: ' ' }), /justificativa/i);
  await assert.rejects(saveAttendanceIrregularity({ repository, id: '2249', date: '2026-10-12', explanation: 'Teste' }), /IRREGULARIDADES/);
  repository.getColumns = async () => [{ name: 'IRREGULARIDADES', text: { allowMultipleLines: true } }];
  await assert.rejects(saveAttendanceIrregularity({ repository, id: '2249', date: '2026-10-12', explanation: 'Teste' }), /data/i);
});
