import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAppController } from '../src/app-controller.js';
import { createChatClient } from '../src/chat/chat-client.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { provisionDateKey } from '../src/chat/pending-provision-dates.js';
import { rhidMascotAmbiguousNames, rhidMascotDay } from '../src/chat/rhid-mascot-report.js';
import { createChatView } from '../src/ui/chat-view.js';

test('RHID mascot opens today, filters a period, and saves the empty slot on its own date', async t => {
  const dom = new JSDOM('<main></main>');
  const root = dom.window.document.querySelector('main');
  const view = createChatView(root);
  const store = createConversationStore();
  const account = { name: 'Tester', homeAccountId: 'rhid-mascot' };
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-01T13:00:00Z') });
  const today = provisionDateKey();
  const row = (day, id, name, punches, adjustments) => ({
    DATA_REFERENCIA: day, ID_PESSOA_RHID: id, NOME_COLABORADOR: name,
    BATIDAS_RHID: punches, ADMIN_AJUSTES: adjustments,
  });
  const history = [
    row('2026-10-31', '10', 'Ana Teste', '08:21'),
    row('2025-01-31', '10', 'Ana Teste', '07:15'),
    row('2025-02-01', '10', 'Ana Teste', '07:18'),
    row('2025-02-01', '11', 'Bruno Teste', '07:20'),
    ...Array.from({ length: 15 }, (_, index) => row(`2025-02-${String(index + 2).padStart(2, '0')}`, '11', 'Bruno Teste', '07:20')),
  ];
  const writes = [], reads = [], comparisons = [], authorizations = [];
  let descriptiveError;
  const controller = createAppController({
    view, store, auth: {
      initialize: async () => account, getToken: async () => 'fixture-token',
      authorize: async (...args) => { authorizations.push(args); descriptiveError = undefined; },
    },
    native: { importSharedItems: async () => [] },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    attendanceSummaryDataFactory: async () => ({
      loadSupplierDirectory: async () => [{ name: 'Ana Teste', profession: 'Mecânica' }, { name: 'Bruno Teste', profession: 'Pedreiro' }],
      loadRhidPresences: async ({ start, end }) => {
        comparisons.push([start, end]);
        if (descriptiveError) throw descriptiveError;
        if (start === today) return [
          { date: today, supplier: 'Ana Teste', presence: 'PENDENTE' },
          { date: today, supplier: 'Bruno Teste', presence: 'PRESENTE' },
          { date: today, supplier: 'Carla Teste', presence: 'AUSENTE' },
          { date: today, supplier: 'Fornecedor de fora do RHID', presence: 'PRESENTE' },
        ];
        return [{ date: '2025-01-31', supplier: 'Ana Teste', presence: 'AUSENTE' }];
      },
    }),
    client: {
      sendText: async () => ({ status: 'processed', messages: [] }),
      getRhidAttendanceReport: async date => {
        reads.push(date);
        return { date, rows: date === today ? [
          row(date, '10', 'Ana Teste', '07:17;12:49;17:00'), row(date, '11', 'Bruno Teste', ''), row(date, '12', 'Carla Teste', ''),
        ] : history.filter(item => item.DATA_REFERENCIA === date) };
      },
      getRhidAttendanceMonth: async month => ({ month, rows: history.filter(item => item.DATA_REFERENCIA.startsWith(month)) }),
      saveRhidAttendanceAdjustment: async payload => { writes.push(payload); return { time: payload.time, id: '123' }; },
    },
  });
  t.after(() => { controller.stop(); dom.window.close(); });
  await controller.start();
  store.ingestRemoteMessages([{ type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [
    { id: 'group_pending', label: 'PENDÊNCIAS' }, { id: 'group_supplies', label: 'SUPRIMENTOS' },
    { id: 'group_human_resources', label: 'RECURSOS HUMANOS' },
  ] }]);
  const click = selector => {
    const button = root.querySelector(selector);
    assert.ok(button, selector);
    button.click();
  };
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const action = type => `[data-action="${type}"]`;
  const cards = () => [...root.querySelectorAll('[data-rhid-mascot-report] .chat-rhid-attendance-card')];
  const shortcut = root.querySelector(action('open-rhid-mascot-report'));
  assert.equal(shortcut?.textContent.trim(), 'RHID');
  const shell = root.querySelector('.chat-shell');
  const composer = root.querySelector('.chat-composer');
  const location = dom.window.location.href;
  shell.querySelector('.chat-transcript').scrollTop = 35;
  click(action('open-rhid-mascot-report'));
  await settle();
  const report = shell.querySelector('[data-rhid-mascot-report][role="dialog"]');
  assert.ok(report, 'RHID opens as a report panel in the home shell');
  assert.equal(report.closest('.chat-transcript'), null);
  assert.ok(shell.querySelector('.chat-transcript ' + action('open-rhid-mascot-report')));
  assert.equal(shell.querySelector('.chat-transcript').scrollTop, 35);
  assert.equal(shell.querySelector('.chat-composer'), composer);
  assert.equal(dom.window.location.href, location);
  assert.deepEqual(reads, [today]);
  assert.deepEqual(comparisons, [[today, today]]);
  assert.equal(cards().length, 3);
  assert.match(cards()[0].textContent, /07:17/);
  assert.ok(cards()[0].classList.contains('chat-rhid-attendance-card--presence-pending'));
  assert.ok(cards()[1].classList.contains('chat-rhid-attendance-card--presence-mismatch'));
  assert.match(cards()[1].textContent, /Presente no Descritivo, sem batida no relógio/i);
  assert.ok(!cards()[2].classList.contains('chat-rhid-attendance-card--presence-mismatch'));
  assert.ok(cards()[0].querySelector('button[data-slot="exit1"]'));
  assert.equal(cards()[0].querySelector('button[data-slot="entry1"]'), null);
  cards()[0].querySelector('button[data-slot="exit1"]').click();
  assert.equal(root.querySelector('[data-role="rhid-adjustment-time"]').value, '11:49');
  assert.deepEqual(writes, []);
  const timeField = root.querySelector('[data-role="rhid-adjustment-time"]');
  assert.equal(dom.window.document.activeElement, timeField);
  timeField.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(root.querySelector('[data-rhid-adjustment-dialog]'), null);
  assert.equal(dom.window.document.activeElement, cards()[0].querySelector('button[data-slot="exit1"]'));
  click(action('rhid-mascot-period'));
  await settle();
  root.querySelector('[name="rhid-start"]').value = '2025-02-02';
  root.querySelector('[name="rhid-end"]').value = '2025-02-16';
  click(action('rhid-mascot-apply'));
  await settle();
  assert.equal(cards().length, 14);
  click(action('rhid-mascot-page') + '[data-value="1"]');
  assert.equal(cards().length, 1);
  assert.match(root.querySelector('.chat-rhid-mascot__date').textContent, /02\/02\/2025/);
  root.querySelector('[name="rhid-start"]').value = '2025-01-31';
  root.querySelector('[name="rhid-end"]').value = '2025-02-01';
  click(action('rhid-mascot-apply'));
  await settle();
  assert.equal(cards().length, 3);
  const profession = root.querySelector('[name="rhid-profession"]');
  profession.value = 'MECANICA';
  profession.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(cards().length, 2);
  const empty = cards()[1].querySelector('button[data-slot="exit1"]');
  assert.ok(cards()[1].classList.contains('chat-rhid-attendance-card--presence-mismatch'));
  assert.match(cards()[1].textContent, /Ausente no Descritivo, com batida no relógio/i);
  assert.equal(empty.dataset.messageId, 'rhid-mascot:2025-01-31');
  root.querySelector('[name="rhid-start"]').value = '2025-01-30';
  empty.click();
  assert.equal(root.querySelector('[data-role="rhid-adjustment-time"]').value, '11:00');
  root.querySelector('[data-role="rhid-adjustment-time"]').value = '11:58';
  click(action('rhid-attendance-adjust-save'));
  await settle();
  assert.deepEqual(writes, [{ date: '2025-01-31', personKey: 'rhid:10', slot: 'exit1', time: '11:58', reason: 'NÃO APONTADO', fillMissing: true }]);
  assert.match(cards()[1].querySelector('.chat-rhid-attendance-card__cluster--added')?.textContent, /11:58/);
  assert.ok(cards()[1].classList.contains('chat-rhid-attendance-card--presence-mismatch'));
  assert.equal(cards()[0].querySelector('.chat-rhid-attendance-card__cluster--added'), null);
  assert.equal(root.querySelector(action('close-rhid-mascot-report')).disabled, false);
  assert.equal(root.querySelector('[name="rhid-start"]').value, '2025-01-30');
  descriptiveError = new Error('SharePoint indisponível');
  click(action('rhid-mascot-today'));
  await settle();
  assert.equal(cards().length, 1);
  assert.match(root.querySelector('[data-rhid-mascot-report]').textContent, /Descritivo Presença indisponível/);
  assert.equal(cards()[0].querySelector('.chat-rhid-mascot__comparison'), null);
  descriptiveError.code = 'AUTH_REQUIRED';
  click(action('rhid-mascot-reload'));
  await settle();
  click(action('rhid-mascot-authorize'));
  await settle();
  assert.deepEqual(authorizations, [[['Sites.Read.All'], { resumeAction: 'open-rhid-mascot-report' }]]);
  assert.ok(cards()[0].classList.contains('chat-rhid-attendance-card--presence-pending'));
  const clearProfession = root.querySelector('[name="rhid-profession"]');
  clearProfession.value = '';
  clearProfession.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.equal(cards().length, 3);
  const dayNav = '[aria-label="Navegação por data do relatório RHID"]';
  const selectedDate = () => root.querySelector(dayNav + ' time')?.textContent;
  const previousDay = dayNav + ' [aria-label="Dia anterior"]';
  const nextDay = dayNav + ' [aria-label="Próximo dia"]';
  assert.equal(selectedDate(), '01/11/2026');
  root.querySelector(previousDay).focus();
  click(previousDay);
  assert.equal(selectedDate(), '31/10/2026');
  await settle();
  assert.equal(reads.at(-1), '2026-10-31');
  assert.deepEqual(comparisons.at(-1), ['2026-10-31', '2026-10-31']);
  assert.equal(cards().length, 1);
  assert.match(cards()[0].textContent, /08:21/);
  assert.equal(dom.window.document.activeElement, root.querySelector(previousDay));
  click(action('rhid-mascot-reload'));
  await settle();
  assert.equal(reads.at(-1), '2026-10-31');
  assert.equal(selectedDate(), '31/10/2026');
  click(nextDay);
  click(nextDay);
  await settle();
  assert.deepEqual(reads.slice(-2), ['2026-11-01', '2026-11-02']);
  assert.equal(selectedDate(), '02/11/2026');
  assert.equal(cards().length, 0);
  assert.match(root.querySelector('.chat-rhid-mascot__body').textContent, /Nenhuma presença encontrada/);
  click(action('rhid-mascot-today'));
  await settle();
  assert.equal(selectedDate(), '01/11/2026');
  assert.equal(cards().length, 3);
  cards()[0].querySelector('button[data-slot="exit1"]').click();
  root.querySelector('[data-role="rhid-adjustment-time"]').value = '11:50';
  click(action('rhid-attendance-adjust-save'));
  await settle();
  assert.match(cards()[0].querySelector('.chat-rhid-attendance-card__cluster--added')?.textContent, /11:50/);
  assert.equal(root.querySelector(previousDay).disabled, false);
  assert.equal(root.querySelector(nextDay).disabled, false);
  click(action('close-rhid-mascot-report'));
  assert.equal(shell.querySelector('[data-rhid-mascot-report]'), null);
  assert.equal(shell.querySelector('.chat-transcript').scrollTop, 35);
  assert.equal(dom.window.document.activeElement, shell.querySelector(action('open-rhid-mascot-report')));
  assert.ok(root.querySelector(action('open-cargos-table')));
});

test('RHID compares clock punches separately from manual times and leaves homonyms unlinked', () => {
  const clock = [
    { ID_PESSOA_RHID: '1', NOME_COLABORADOR: 'João Teste', BATIDAS_RHID: '07:15' },
    { ID_PESSOA_RHID: '2', NOME_COLABORADOR: 'Joao Teste', BATIDAS_RHID: '07:18' },
    { ID_PESSOA_RHID: '3', NOME_COLABORADOR: 'Dora Teste', BATIDAS_RHID: null, ADMIN_AJUSTES: { entry1: { time: '07:20' } } },
    { ID_PESSOA_RHID: '4', NOME_COLABORADOR: 'Eva Teste', BATIDAS_RHID: '24:99' },
    { ID_PESSOA_RHID: '5', NOME_COLABORADOR: 'Flávia Teste' },
  ];
  const day = rhidMascotDay(clock, '2026-11-09', [
    { supplier: 'João Teste', presence: 'AUSENTE' }, { supplier: 'Dora Teste', presence: 'PRESENTE' },
    { supplier: 'Eva Teste', presence: 'PRESENTE' }, { supplier: 'Flávia Teste', presence: 'PRESENTE' },
  ]);
  const dora = day.people.find(person => person.personKey === 'rhid:3');
  assert.equal(dora.presenceComparison.mismatch, true);
  assert.equal(dora.presenceComparison.matched, false);
  assert.equal(dora.slots.entry1.source, 'added');
  const homonyms = day.people.filter(person => ['rhid:1', 'rhid:2'].includes(person.personKey));
  assert.equal(homonyms.length, 2);
  assert.ok(homonyms.every(person => !person.presenceComparison.matched && !person.presenceComparison.mismatch
    && person.presenceComparison.label === 'Nome ambíguo no RHID'));
  const unknown = day.people.filter(person => ['rhid:4', 'rhid:5'].includes(person.personKey));
  assert.equal(unknown.length, 2);
  assert.ok(unknown.every(person => !person.presenceComparison.matched && !person.presenceComparison.mismatch && !person.emptyPunchSource));
  const names = rhidMascotAmbiguousNames(new Map([['2026-11-09', [clock[0]]], ['2026-11-10', [clock[1]]]]));
  const isolated = rhidMascotDay([clock[0]], '2026-11-09', [{ supplier: 'João Teste', presence: 'AUSENTE' }], names);
  assert.equal(isolated.people[0].presenceComparison.label, 'Nome ambíguo no RHID');
});

test('RHID confirms presence only when the clock and unambiguous Descritivo status agree', () => {
  const date = '2026-11-09';
  const rows = [{ ID_PESSOA_RHID: '1', NOME_COLABORADOR: 'Ana Teste', BATIDAS_RHID: '07:15' }];
  const compare = (...statuses) => rhidMascotDay(rows, date, statuses.map(presence => ({
    supplier: 'Ana Teste', presence,
  }))).people[0].presenceComparison;
  assert.equal(compare('PRESENTE').matched, true);
  assert.equal(compare('PRESENTE', 'PRESENTE').matched, true);
  assert.equal(compare('PRESENTE', 'PENDENTE').matched, false);
  assert.equal(compare('PRESENTE', 'AUSENTE').matched, false);
  assert.equal(compare().matched, false);
});

test('filling a missing time uses an explicit action that an older VM cannot interpret as a correction', async () => {
  const payload = { date: '2025-01-31', personKey: 'rhid:10', slot: 'exit1', time: '11:58', reason: 'Teste' };
  const sent = [];
  const client = createChatClient({
    apiBaseUrl: 'https://example.test', tokenProvider: async () => 'token',
    fetchImpl: async (_url, options) => {
      sent.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ status: 'processed', messages: [], attendanceAdjustment: { time: payload.time } }));
    },
  });
  await client.saveRhidAttendanceAdjustment({ ...payload, fillMissing: true });
  await client.saveRhidAttendanceAdjustment(payload);
  assert.deepEqual(sent, [
    { action: 'rhid_attendance_fill_missing', ...payload },
    { action: 'rhid_attendance_adjust', ...payload },
  ]);
});
