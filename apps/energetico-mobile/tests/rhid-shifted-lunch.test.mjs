import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { buildRhidAttendanceTable, rhidIrregularCountsByDate } from '../src/chat/rhid-attendance-table.js';
import { buildAttendanceRhidBadge } from '../src/chat/attendance-rhid-badges.js';
import { buildRhidMonthlyReport } from '../src/chat/rhid-monthly-model.js';
import { createChatView } from '../src/ui/chat-view.js';

const date = '2026-10-19';
const row = (punches, extra = {}) => ({ Id: '1', ID_PESSOA_RHID: '10', NOME_COLABORADOR: 'ANA',
  DATA_REFERENCIA: date, BATIDAS_RHID: punches, ...extra });
const badge = rows => buildAttendanceRhidBadge({ presenceId: '21', name: 'ANA', date }, { date, rows });

test('a unique 12:31 to 13:49 lunch between morning and evening punches is classified by its interval', () => {
  const source = Object.freeze(row('06:55;12:31;13:49;17:06'));
  const table = buildRhidAttendanceTable([source]);
  assert.deepEqual(table.rows[0], ['ANA', '06:55', '12:31', '13:49', '17:06', '08:53']);
  assert.deepEqual(table.people[0].slots.exit1.rhidCandidates, ['12:31']);
  assert.deepEqual(table.people[0].slots.entry2.rhidCandidates, ['13:49']);
  assert.equal(table.people[0].slots.exit1.outOfRange, false);
  assert.equal(table.people[0].slots.entry2.outOfRange, false);
  assert.deepEqual(table.people[0].issues, []);
  assert.deepEqual(table.people[0].rawPunches, ['06:55', '12:31', '13:49', '17:06']);
  assert.equal(source.BATIDAS_RHID, '06:55;12:31;13:49;17:06');
  const actual = badge([source]);
  assert.equal(actual.label, '08h53');
  assert.equal(actual.minutes, 533);
  assert.deepEqual(actual.punches, { entry1: '06:55', exit1: '12:31', entry2: '13:49', exit2: '17:06' });
  assert.deepEqual(rhidIrregularCountsByDate([source], '2026-10'), {});
});

for (const [start, end, total] of [
  ['11:00', '11:45', '09:15'],
  ['11:05', '12:05', '09:00'],
  ['12:30', '13:30', '09:00'],
  ['12:31', '13:16', '09:15'],
  ['12:31', '14:01', '08:30'],
  ['13:00', '14:30', '08:30'],
  ['13:30', '14:30', '09:00'],
]) {
  test(`a supported unique lunch ${start} to ${end} remains an ordinary recorded period`, () => {
    const table = buildRhidAttendanceTable([row(`07:00;${start};${end};17:00`)]);
    assert.deepEqual(table.rows[0], ['ANA', '07:00', start, end, '17:00', total]);
    assert.deepEqual(table.people[0].issues, []);
  });
}

test('a previously approved lunch correction still wins while its reclassified RHID original remains visible', () => {
  const adjustment = Object.freeze({ time: '12:00', reason: 'Conferido', actorName: 'Administrador', adjustedAt: `${date}T20:00:00Z` });
  const source = Object.freeze(row('06:55;12:31;13:49;17:06', { ADMIN_AJUSTES: Object.freeze({ exit1: adjustment }) }));
  const table = buildRhidAttendanceTable([source]);
  assert.deepEqual(table.rows[0], ['ANA', '06:55', '12:00', '13:49', '17:06', '08:22']);
  assert.equal(table.people[0].slots.exit1.rhid, '12:31');
  assert.equal(table.people[0].slots.exit1.source, 'corrected');
  assert.deepEqual(table.people[0].slots.exit1.adjustment, adjustment);
  assert.deepEqual(table.people[0].issues, []);
  assert.equal(badge([source]).minutes, 502);
});

test('monthly hours use the shifted lunch without losing its original punches', () => {
  const source = row('06:55;12:31;13:49;17:06');
  const monthly = buildRhidMonthlyReport({ month: '2026-10', supplier: { id: '4', name: 'ANA' }, startDate: date, endDate: date,
    snapshot: { month: '2026-10', presentDates: [date], rows: [source] } });
  assert.deepEqual(monthly.days[0].slots, ['06:55', '12:31', '13:49', '17:06']);
  assert.equal(monthly.total, '08:23'); // Existing Monday break deductions remain unchanged.
  assert.equal(monthly.incompleteDays, 0);
  assert.deepEqual(monthly.days[0].unclassifiedPunches, []);
});

test('unsorted JSON punches and fragments of one identity give the same lunch classification', () => {
  const rows = [row([{ dataHora: `${date}T13:49:00-03:00` }, { dataHora: `${date}T06:55:00-03:00` }]),
    row(JSON.stringify(['17:06', '12:31']), { Id: '2' })];
  const before = structuredClone(rows);
  const table = buildRhidAttendanceTable(rows);
  assert.deepEqual(table.rows[0], ['ANA', '06:55', '12:31', '13:49', '17:06', '08:53']);
  assert.equal(badge(rows).minutes, 533);
  assert.deepEqual(rows, before);
});

for (const [punches, departure, arrival] of [
  ['07:00;12:31;13:15;17:00', '12:31', '13:15'], // 44 minutes is not enough evidence for the new inference.
  ['07:00;12:31;14:02;17:00', '12:31', '14:02'], // More than 90 minutes.
  ['07:00;13:31;14:30;17:00', '13:31', '14:30'], // Departure beyond the lunch window.
  ['07:00;13:01;14:31;17:00', '13:01', '14:31'], // Return beyond the lunch window.
  ['12:31;13:49;17:00', '12:31', '13:49'], // No raw morning anchor.
  ['07:00;12:31;13:49', '12:31', '13:49'], // No raw final departure.
  ['07:00;12:31;13:49;14:00;17:00', '12:31', '13:49'], // An additional midday candidate makes the interval ambiguous.
  ['07:00;12:00;13:00;13:49;17:00', '12:00', '13:49'], // An already complete lunch is not overwritten by an extra punch.
  ['07:00;07:01;07:02;12:31;13:49;17:00', '12:31', '13:49'], // Ambiguous morning anchor.
]) {
  test(`insufficient or competing lunch evidence does not reclassify ${punches}`, () => {
    const table = buildRhidAttendanceTable([row(punches)]);
    assert.ok(table.people[0].slots.exit1.rhid !== departure
      || table.people[0].slots.entry2.rhid !== arrival);
    for (const time of punches.split(';')) assert.ok(table.people[0].rawPunches.includes(time));
  });
}

test('same-period duplicate selection and unrelated out-of-range audit warnings are retained', () => {
  const table = buildRhidAttendanceTable([row('06:55;07:01;08:35;12:31;13:49;16:58;17:06')]);
  assert.deepEqual(table.rows[0], ['ANA', '07:01', '12:31', '13:49', '16:58', '08:39']);
  assert.deepEqual(table.people[0].issues, ['Batida fora das faixas: 08:35']);
  assert.deepEqual(table.people[0].slots.entry1.rhidCandidates, ['06:55', '07:01']);
  assert.deepEqual(table.people[0].slots.exit2.rhidCandidates, ['16:58', '17:06']);
});

test('separate identities cannot supply the missing anchors for one another', () => {
  const table = buildRhidAttendanceTable([
    row('06:55;12:31;13:49'), row('17:06', { Id: '2', ID_PESSOA_RHID: '11' }),
  ]);
  assert.equal(table.people.length, 2);
  assert.equal(table.people[0].slots.exit1.rhid, null);
  assert.equal(table.people[0].slots.entry2.rhid, '12:31');
});

test('the correction popup exposes 12:31 as original without silently erasing the approved 12:00 correction', () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  try {
    const table = { ...buildRhidAttendanceTable([row('06:55;12:31;13:49;17:06', {
      ADMIN_AJUSTES: { exit1: { time: '12:00', reason: 'Conferido' } },
    })]), reportDate: '2026-10-01' };
    view.render({ sessionStatus: 'authenticated', account: { name: 'Tester' }, draft: '', pendingFiles: [],
      messages: [{ id: 'lunch', role: 'assistant', type: 'poll', question: 'RHID', options: [], detail_table: table }] });
    assert.equal(root.querySelector('[data-action="rhid-attendance-adjust-open"][data-slot="entry2"] strong').textContent, '13:49');
    root.querySelector('[data-action="rhid-attendance-adjust-open"][data-slot="exit1"]').click();
    assert.equal(root.querySelector('[data-role="rhid-adjustment-time"]').value, '12:00');
    const dialog = root.querySelector('[data-rhid-adjustment-dialog]');
    assert.match(dialog.textContent, /RHID:\s*12:31/);
    assert.match(dialog.textContent, /Ajustado:\s*12:00/);
    assert.doesNotMatch(root.textContent, /Batida fora das faixas: 13:49/);
  } finally { view.destroy(); dom.window.close(); }
});
