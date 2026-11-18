import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRhidAttendanceTable } from '../src/chat/rhid-attendance-table.js';
import { buildAttendanceRhidBadge } from '../src/chat/attendance-rhid-badges.js';

const row = punches => ({ ID_PESSOA_RHID: '10', NOME_COLABORADOR: 'EDGAR NELSON DA SILVA', BATIDAS_RHID: punches });

for (const date of ['2026-11-18', '2026-11-20', '2026-11-21']) {
  test(`lunch-only punches are never counted as worked time in presence validation on ${date}`, () => {
    const actual = buildAttendanceRhidBadge({ name: 'EDGAR NELSON DA SILVA', date },
      { date, rows: [{ ...row('12:54;13:36'), DATA_REFERENCIA: date }] });
    assert.deepEqual(actual.punches, { entry1: null, exit1: '12:54', entry2: '13:36', exit2: null });
    assert.equal(actual.status, 'inconsistent');
    assert.equal(actual.minutes, undefined);
  });
}

test('Edgar lunch is recognized before the final departure without counting lunch as work', () => {
  const source = Object.freeze(row('06:39;12:54;13:36'));
  const table = buildRhidAttendanceTable([source]);
  assert.deepEqual(table.rows[0], ['EDGAR NELSON DA SILVA', '06:39', '12:54', '13:36', '—', '06:15 (parcial)']);
  assert.deepEqual(table.people[0].issues, []);
  assert.deepEqual(table.people[0].rawPunches, ['06:39', '12:54', '13:36']);
  assert.equal(table.people[0].slots.entry2.outOfRange, false);
  assert.equal(table.people[0].slots.exit2.effective, null);
  assert.equal(source.BATIDAS_RHID, '06:39;12:54;13:36');
});

for (const [start, end] of [['11:05', '11:35'], ['12:30', '13:00'], ['12:54', '13:36'], ['13:00', '14:30']]) {
  for (const [prefix, suffix] of [['', ''], ['07:00;', ''], ['', ';17:00'], ['07:00;', ';17:00']]) {
    test(`unique lunch ${start}-${end} works independently of morning/final punches (${prefix}|${suffix})`, () => {
      const table = buildRhidAttendanceTable([row(`${prefix}${start};${end}${suffix}`)]);
      assert.equal(table.people[0].slots.exit1.effective, start);
      assert.equal(table.people[0].slots.entry2.effective, end);
      assert.equal(table.people[0].slots.exit2.effective, suffix ? '17:00' : null);
      assert.deepEqual(table.people[0].issues, []);
    });
  }
}

for (const punches of ['07:00;12:31;13:00;17:00', '07:00;12:31;14:02;17:00',
  '07:00;12:31;13:10;13:49;17:00']) {
  test(`invalid interval or competing midday punch stays available for review: ${punches}`, () => {
    const table = buildRhidAttendanceTable([row(punches)]);
    assert.equal(table.people[0].slots.exit1.rhid, null);
    assert.deepEqual(table.people[0].rawPunches, punches.split(';'));
  });
}

test('an existing complete lunch is preserved when extra midday punches arrive', () => {
  const table = buildRhidAttendanceTable([row('07:00;12:00;12:54;13:36')]);
  assert.equal(table.people[0].slots.exit1.effective, '12:00');
  assert.equal(table.people[0].slots.entry2.effective, '12:54');
  assert.ok(table.people[0].issues.includes('Batida fora das faixas: 13:36'));
});

test('approved correction still overrides the inferred raw lunch on an unfinished day', () => {
  const source = { ...row('06:39;12:54;13:36'), ADMIN_AJUSTES: { exit1: { time: '12:45', reason: 'Conferido' } } };
  const table = buildRhidAttendanceTable([source]);
  assert.deepEqual(table.rows[0].slice(1), ['06:39', '12:45', '13:36', '—', '06:06 (parcial)']);
  assert.equal(table.people[0].slots.exit1.rhid, '12:54');
  assert.equal(table.people[0].slots.exit1.source, 'corrected');
});
