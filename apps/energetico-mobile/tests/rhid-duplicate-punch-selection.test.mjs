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
const allPairs = '06:56;07:02;11:56;12:03;12:58;13:05;16:58;17:04';
const badge = rows => buildAttendanceRhidBadge({ presenceId: '21', name: 'ANA', date }, { date, rows });

for (const [slot, punches, chosen, total, candidates] of [
  ['entry1', '06:56;07:02;12:00;13:00;17:00', '07:02', '08:58', ['06:56', '07:02']],
  ['exit1', '07:00;11:56;12:03;13:00;17:00', '11:56', '08:56', ['11:56', '12:03']],
  ['entry2', '07:00;12:00;12:58;13:05;17:00', '13:05', '08:55', ['12:58', '13:05']],
  ['exit2', '07:00;12:00;13:00;16:58;17:04', '16:58', '08:58', ['16:58', '17:04']],
]) {
  test(`two punches in ${slot} select ${chosen} without a five-minute cutoff`, () => {
    const table = buildRhidAttendanceTable([row(punches)]);
    const field = table.people[0].slots[slot];
    assert.equal(field.rhid, chosen);
    assert.equal(field.effective, chosen);
    assert.equal(field.source, 'rhid');
    assert.deepEqual(field.rhidCandidates, candidates);
    assert.deepEqual(table.people[0].issues, []);
    assert.equal(table.rows[0].at(-1), total);
    const actual = badge([row(punches)]);
    assert.equal(actual.punches[slot], chosen);
    assert.equal(actual.status, 'present');
    assert.equal(actual.label, total.replace(':', 'h'));
  });
}

test('short exit pairs use the earliest punch, not the previous later-punch heuristic', () => {
  const table = buildRhidAttendanceTable([row('07:00;11:58;12:00;13:00;16:58;17:00')]);
  assert.deepEqual(table.rows[0], ['ANA', '07:00', '11:58', '13:00', '16:58', '08:56']);
});

test('all four pairs share selected punches and totals across daily, monthly and validation views', () => {
  const source = Object.freeze(row(allPairs));
  const table = buildRhidAttendanceTable([source]);
  assert.deepEqual(table.rows[0], ['ANA', '07:02', '11:56', '13:05', '16:58', '08:47']);
  assert.deepEqual(table.people[0].rawPunches, ['06:56', '07:02', '11:56', '12:03', '12:58', '13:05', '16:58', '17:04']);
  assert.equal(source.BATIDAS_RHID, allPairs);
  const actual = badge([source]);
  assert.equal(actual.status, 'present');
  assert.equal(actual.minutes, 527);
  assert.deepEqual(actual.punches, { entry1: '07:02', exit1: '11:56', entry2: '13:05', exit2: '16:58' });
  assert.deepEqual(rhidIrregularCountsByDate([source], '2026-10'), {});
  const monthly = buildRhidMonthlyReport({ month: '2026-10', supplier: { id: '4', name: 'ANA' },
    startDate: date, endDate: date, snapshot: { month: '2026-10', rows: [source], presentDates: [date] } });
  assert.deepEqual(monthly.days[0].slots, ['07:02', '11:56', '13:05', '16:58']);
  assert.equal(monthly.total, '08:17'); // 8h47 gross minus the existing 30-minute Monday breaks.
  assert.equal(monthly.incompleteDays, 0);
});

test('selection is chronological across fragments and JSON timestamps without mutating raw records', () => {
  const rows = [row('[{"dataHora":"2026-10-19T12:03:00-03:00"},{"dataHora":"2026-10-19T07:00:00-03:00"}]'),
    row(['17:00', '13:00', '11:56'], { Id: '2' })];
  const before = structuredClone(rows);
  const table = buildRhidAttendanceTable(rows);
  assert.deepEqual(table.rows[0], ['ANA', '07:00', '11:56', '13:00', '17:00', '08:56']);
  assert.equal(badge(rows).minutes, 536);
  assert.deepEqual(rows, before);
});

test('approved adjustments still override chosen duplicates and retain their audit metadata', () => {
  const adjustment = Object.freeze({ time: '12:00', reason: 'Conferido', actorName: 'Administrador', adjustedAt: `${date}T21:00:00Z` });
  const source = Object.freeze(row(allPairs, { ADMIN_AJUSTES: Object.freeze({ exit1: adjustment }) }));
  const table = buildRhidAttendanceTable([source]);
  assert.equal(table.people[0].slots.exit1.rhid, '11:56');
  assert.equal(table.people[0].slots.exit1.effective, '12:00');
  assert.deepEqual(table.people[0].slots.exit1.adjustment, adjustment);
  assert.equal(table.rows[0].at(-1), '08:51');
  assert.equal(badge([source]).minutes, 531);
});

test('a resolved morning duplicate never fills a missing afternoon slot', () => {
  const table = buildRhidAttendanceTable([row('06:56;07:02;12:00')]);
  assert.deepEqual(table.rows[0], ['ANA', '07:02', '12:00', '—', '—', '04:58 (parcial)']);
  const actual = badge([row('06:56;07:02;12:00')]);
  assert.equal(actual.minutes, 298);
  assert.equal(actual.status, 'inconsistent');
});

test('three candidates and competing out-of-range punches still require review', () => {
  const table = buildRhidAttendanceTable([row('07:00;07:02;07:04;12:00;13:00;17:00')]);
  assert.equal(table.people[0].slots.entry1.effective, null);
  assert.match(table.people[0].issues.join(' '), /Batidas duplicadas em Entrada 1/);
  const outside = buildRhidAttendanceTable([row('07:00;10:10;10:30;13:00;17:00')]);
  assert.equal(outside.people[0].slots.exit1.effective, null);
  assert.match(outside.people[0].issues.join(' '), /fora das faixas/);
});

test('the correction popup preserves both original punches and defaults to the selected lunch exit', () => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  try {
    // A shorter day remains editable under the existing correction UI policy.
    const table = { ...buildRhidAttendanceTable([row('07:00;11:56;12:03;13:00;16:00')]), reportDate: '2026-10-01' };
    view.render({ sessionStatus: 'authenticated', account: { name: 'Tester' }, draft: '', pendingFiles: [],
      messages: [{ id: 'duplicate', role: 'assistant', type: 'poll', question: 'RHID', options: [], detail_table: table }] });
    root.querySelector('[data-action="rhid-attendance-adjust-open"][data-slot="exit1"]').click();
    assert.equal(root.querySelector('[data-role="rhid-adjustment-time"]').value, '11:56');
    assert.match(root.textContent, /RHID:\s*11:56, 12:03/);
  } finally {
    view.destroy(); dom.window.close();
  }
});
