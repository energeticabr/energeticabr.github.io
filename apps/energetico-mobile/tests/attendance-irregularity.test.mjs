import test from 'node:test';
import assert from 'node:assert/strict';
import { attendanceIrregularity } from '../src/chat/attendance-irregularity.js';
import { readAttendanceIrregularity, saveAttendanceIrregularity } from '../src/chat/attendance-irregularity-data.js';
import { buildAttendanceRhidBadge } from '../src/chat/attendance-rhid-badges.js';

for (const date of ['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']) {
  test(`${date}: jornada de 9h só exige justificativa acima de 30 minutos de variação`, () => {
    for (const minutes of [510, 511, 524, 525, 540, 569, 570]) {
      assert.equal(attendanceIrregularity({ date, minutes }), null, `${minutes} minutos dentro da tolerância`);
    }
    assert.deepEqual(attendanceIrregularity({ date, minutes: 509 }),
      { date, minutes: 509, limit: '8h30 a 9h30', duration: '8h29' });
    assert.deepEqual(attendanceIrregularity({ date, minutes: 571 }),
      { date, minutes: 571, limit: '8h30 a 9h30', duration: '9h31' });
  });
}

test('sexta aceita inclusive 7h30 e 8h30 e o exemplo de 8h22 sem justificativa', () => {
  const date = '2026-10-16';
  for (const minutes of [450, 451, 459, 460, 480, 500, 501, 502, 509, 510]) {
    assert.equal(attendanceIrregularity({ date, minutes }), null, `${minutes} minutos dentro da tolerância`);
  }
  assert.deepEqual(attendanceIrregularity({ date, minutes: 449 }),
    { date, minutes: 449, limit: '7h30 a 8h30', duration: '7h29' });
  assert.deepEqual(attendanceIrregularity({ date, minutes: 511 }),
    { date, minutes: 511, limit: '7h30 a 8h30', duration: '8h31' });
});

test('fim de semana e jornadas desconhecidas não disparam', () => {
  assert.equal(attendanceIrregularity({ date: '2026-10-17', minutes: 100 }), null);
  assert.equal(attendanceIrregularity({ date: '2026-10-18', minutes: 700 }), null);
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

test('consulta justificativa gravada somente no ID e dia corretos', async () => {
  const repository = {
    resolveList: async () => ({ status: 'resolved', id: 'list-id' }),
    getItem: async () => ({ id: '2249', fields: { DATA: '2026-10-12', IRREGULARIDADES: '  Compensação já registrada.  ' } }),
  };
  assert.equal(await readAttendanceIrregularity({ repository, id: '2249', date: '2026-10-12' }), 'Compensação já registrada.');
  repository.getItem = async () => ({ id: '2249', fields: { DATA: '2026-10-12', IRREGULARIDADES: '   ' } });
  assert.equal(await readAttendanceIrregularity({ repository, id: '2249', date: '2026-10-12' }), '');
  repository.getItem = async () => ({ id: '2249', fields: { DATA: '2026-10-13', IRREGULARIDADES: 'Motivo antigo' } });
  await assert.rejects(readAttendanceIrregularity({ repository, id: '2249', date: '2026-10-12' }), /data/i);
});
