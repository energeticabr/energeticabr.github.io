import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const flow = { id: 'attendance_validation', title: 'VALIDAR PRESENÇAS APONTADAS' };
const person = (id, name, punches = '', date = '2026-10-05', extra = {}) => ({
  Id: `item-${id}`, ID_PESSOA_RHID: id, NOME_COLABORADOR: name,
  DATA_REFERENCIA: date, BATIDAS_RHID: punches, STATUS_RHID: punches ? 'REGISTRADO' : 'SEM BATIDAS',
  MINUTOS_TRABALHADOS: null, COLETADO_EM: `${date}T20:30:00Z`, ...extra,
});
const option = (id, name, date = '2026-10-05') => ({
  id: `choice:registro_presenca_pendente:${id}`, reply: `choice:registro_presenca_pendente:${id}`,
  label: `${id} - ${name}`, source_values: { Id: id, FORNECEDOR: name, DATA: date },
});
const poll = (id, options, extra = {}) => ({
  id, type: 'poll', presentation: 'attendance_multi_select',
  question: 'QUAL PRESENÇA DESEJA VALIDAR?', options, ...extra,
});
const report = (date, rows, registration = null) => ({ date, rows, ...(registration ? { registration } : {}) });

function harness(t, getReport, { timeoutMs = 50, signInAccount = null } = {}) {
  let sequence = 0;
  const store = createConversationStore({ randomUUID: () => `badge-${++sequence}` });
  const handlers = new Map(), renders = [], reads = [], writes = [];
  const view = {
    render: state => renders.push(state),
    on(type, fn) { handlers.set(type, fn); return () => handlers.delete(type); },
    emit(type, value = {}) { return handlers.get(type)?.({ type, ...value }); },
    focusComposer() {}, destroy() {},
  };
  const account = { homeAccountId: 'badge-owner', name: 'Teste' };
  const client = {
    async sendText(payload) { writes.push(payload); return { status: 'processed', messages: [] }; },
    getRhidAttendanceReport(date) { reads.push(date); return getReport(date); },
  };
  const controller = createAppController({
    store, view, client, rhidReportTimeoutMs: timeoutMs,
    auth: { initialize: async () => account, signIn: async () => signInAccount || account, getToken: async () => 'test-token', signOut: async () => {} },
    native: { importSharedItems: async () => [] },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
  });
  t.after(() => controller.stop());
  return { store, view, renders, reads, writes, controller };
}

function currentOptions(h) { return h.renders.at(-1).messages.at(-1).options; }
async function open(h, message) {
  await h.controller.start();
  // The existing authenticated bootstrap may resume the conversation. Measure
  // writes only after opening the presence list, not that unrelated handshake.
  h.writes.length = 0;
  h.store.ingestRemoteMessages([message], { activeFlow: flow, resetConversation: true });
  await tick(); await tick();
}

test('daily RHID badges distinguish regular hours, no punches, short day and confirmed missing registration', async t => {
  const date = '2026-10-05';
  const rows = [person('1', 'REGULAR', '07:00;12:00;13:00;16:30'), person('2', 'SEM BATIDA'), person('3', 'CURTO', '07:00;12:00;13:00;16:29')];
  const registration = { complete: true, people: rows.map(row => ({ id: row.ID_PESSOA_RHID, name: row.NOME_COLABORADOR })) };
  const h = harness(t, async day => report(day, rows, registration));
  const options = [option('101', 'REGULAR'), option('102', 'SEM BATIDA'), option('103', 'CURTO'), option('104', 'SEM RELÓGIO'),
    { id: 'pending_attendance_other_date', label: 'AVALIAR OUTRA DATA' }];
  await open(h, poll('day', options));
  assert.deepEqual(currentOptions(h).slice(0, 4).map(item => [item.rhidBadge?.status, item.rhidBadge?.label]), [
    ['present', '08h30'], ['absent', 'AUSENTE'], ['inconsistent', 'INCONSISTENTE'], ['unregistered', 'S/ CADASTRO'],
  ]);
  assert.deepEqual(h.reads, [date], 'one daily read is shared by all suppliers');
  assert.equal(currentOptions(h)[4].rhidBadge, undefined);
  assert.deepEqual(h.store.getState().messages.at(-1).options, options, 'point indicators must not alter durable choices');
  assert.equal(h.writes.length, 0, 'badges only read RHID and never submit attendance');
});

test('real portal choices with only allowlisted date/name metadata query the correct day and show all four states', async t => {
  const date = '2026-10-05';
  const rows = [person('1', 'REGULAR', '07:00;12:00;13:00;16:30'), person('2', 'SEM BATIDA'), person('3', 'CURTO', '07:00')];
  const registration = { complete: true, people: rows.map(row => ({ id: row.ID_PESSOA_RHID, name: row.NOME_COLABORADOR })) };
  const h = harness(t, async day => report(day, rows, registration));
  const options = ['REGULAR', 'SEM BATIDA', 'CURTO', 'SEM RELÓGIO'].map((name, index) => ({
    id: `choice:registro_presenca_pendente:${101 + index}`, reply: `choice:registro_presenca_pendente:${101 + index}`,
    label: `${101 + index} - ${name}`, date, name,
  }));
  await open(h, poll('actual-transport', options));
  assert.deepEqual(h.reads, ['2026-10-05']);
  assert.deepEqual(currentOptions(h).map(item => [item.rhidBadge?.status, item.rhidBadge?.label]), [
    ['present', '08h30'], ['absent', 'AUSENTE'], ['inconsistent', 'INCONSISTENTE'], ['unregistered', 'S/ CADASTRO'],
  ]);
  assert.equal(h.writes.length, 0);
});

test('restored pending choice reads its own detail-table date without a prior date selection', async t => {
  const h = harness(t, async day => report(day, [person('1', 'ANA', '07:00;12:00;13:00;16:30', day)]));
  await open(h, poll('legacy-wire', [{ reply: 'pending_attendance_record:101', id: 'choice:pending_attendance_record:pending_attendance_record:101',
    label: '101 - ANA', detail_table: [[{ label: 'DATA', value: '05/10/2026' }, { label: 'FILIAL', value: '004' }]] }]));
  assert.deepEqual(h.reads, ['2026-10-05']);
  assert.equal(currentOptions(h)[0].rhidBadge?.label, '08h30');
  assert.equal(h.writes.length, 0);
});

test('restored undated and empty-date choices never reuse a historical presence confirmation', async t => {
  const h = harness(t, async day => report(day, [person('1', 'ANA', '07:00;12:00;13:00;16:30', day)]));
  await h.controller.start();
  h.writes.length = 0;
  h.store.ingestRemoteMessages([
    { id: 'old-confirmation', type: 'text', text: 'Presença confirmada', presence_confirmation: { date: '2026-10-05' } },
    poll('restored-on-13-oct', [
      { id: 'pending_attendance_record:101', label: '101 - ANA', detail_table: [[{ label: 'DATA', value: '' }]] },
      { id: 'pending_attendance_record:102', label: '102 - ANA' },
    ]),
  ], { activeFlow: flow, resetConversation: true });
  await tick(); await tick();
  assert.deepEqual(h.reads, [], 'missing current-record dates cannot authorize a read of 05/10');
  assert.deepEqual(currentOptions(h).map(item => item.rhidBadge?.status), ['unavailable', 'unavailable']);
  assert.equal(h.writes.length, 0);
});

test('expanded multi-day choices never assign the formerly filtered poll day to an undated option', async t => {
  const h = harness(t, async day => report(day, [person('1', 'ANA', '07:00;12:00;13:00;16:30', day)]));
  await open(h, poll('expanded-dates', [
    option('101', 'ANA', '2026-10-05'), option('102', 'ANA', '2026-10-13'),
    { id: 'pending_attendance_record:103', label: '103 - ANA' },
  ], { presenceDateKey: '2026-10-05' }));
  assert.deepEqual(currentOptions(h).map(item => [item.rhidBadge?.date, item.rhidBadge?.status]), [
    ['2026-10-05', 'present'], ['2026-10-13', 'present'], ['', 'unavailable'],
  ]);
  assert.deepEqual(h.reads.sort(), ['2026-10-05', '2026-10-13']);
  assert.equal(h.writes.length, 0);
});

for (const [date, punches, expectedStatus, expectedLabel] of [
  ['2026-10-05', '07:00;12:00;13:00;16:29', 'inconsistent', 'INCONSISTENTE'],
  ['2026-10-06', '07:00;12:00;13:00;16:30', 'present', '08h30'],
  ['2026-10-07', '07:00;12:00;13:00;16:31', 'present', '08h31'],
  ['2026-10-08', '07:00;12:00;13:00', 'inconsistent', 'INCONSISTENTE'],
  ['2026-10-09', '07:00;11:00', 'present', '04h00'],
  ['2026-10-10', '07:00', 'inconsistent', 'INCONSISTENTE'],
  ['2026-10-11', '', 'absent', 'AUSENTE'],
  ['2026-10-05', '07:00;15:30', 'present', '08h30'],
  ['2026-10-05', '07:00;12:00;13:00;16:30;18:00;19:00', 'present', '09h30'],
  ['2026-10-05', '07:00;12:00;13:00;24:99', 'inconsistent', 'INCONSISTENTE'],
]) {
  test(`RHID daily rule ${date} [${punches}] is ${expectedStatus}`, async t => {
    const h = harness(t, async day => report(day, [person('1', 'ANA', punches, day)]));
    await open(h, poll('rule', [option('1', 'ANA', date)]));
    assert.equal(currentOptions(h)[0].rhidBadge?.status, expectedStatus);
    assert.equal(currentOptions(h)[0].rhidBadge?.label, expectedLabel);
  });
}

test('ISO timezone offsets are not counted as additional punches', async t => {
  const h = harness(t, async day => report(day, [person('1', 'ANA', [
    { dataHora: `${day}T07:00:00-03:00` }, { dataHora: `${day}T12:00:00-03:00` },
    { dataHora: `${day}T13:00:00-03:00` }, { dataHora: `${day}T16:30:00-03:00` },
  ], day)]));
  await open(h, poll('iso', [option('1', 'ANA')]));
  assert.equal(currentOptions(h)[0].rhidBadge?.label, '08h30');
});

test('approved point adjustments are reflected without changing the original punches', async t => {
  const source = person('1', 'ANA', '07:00;12:00;13:00', '2026-10-05', {
    ADMIN_AJUSTES: { exit2: { time: '16:30', adjustedAt: '2026-10-05T21:00:00Z', reason: 'Conferido' } },
  });
  const h = harness(t, async day => report(day, [source]));
  await open(h, poll('adjusted', [option('1', 'ANA')]));
  assert.equal(currentOptions(h)[0].rhidBadge?.label, '08h30');
  assert.equal(source.BATIDAS_RHID, '07:00;12:00;13:00');
});

test('known clock registration with no day row is absent, not unregistered', async t => {
  const h = harness(t, async day => report(day, [], { complete: true, people: [{ id: '1', name: 'ANA' }] }));
  await open(h, poll('registered', [option('1', 'ANA')]));
  assert.equal(currentOptions(h)[0].rhidBadge?.status, 'absent');
});

for (const [kind, getReport] of [
  ['network error', () => Promise.reject(new Error('RHID unavailable'))],
  ['missing registration authority', day => report(day, [])],
  ['incomplete registration directory', day => report(day, [], { complete: false, people: [] })],
  ['wrong report date', () => report('2026-10-06', [person('1', 'ANA')])],
  ['wrong row date', day => report(day, [person('1', 'ANA', '', '2026-10-06')])],
  ['invalid rows', day => ({ date: day, rows: null })],
  ['ambiguous names', day => report(day, [person('1', 'ANA'), person('2', 'ANA', '07:00;12:00;13:00;16:30')])],
]) {
  test(`RHID ${kind} never invents absence or missing registration`, async t => {
    const h = harness(t, getReport);
    await open(h, poll('unknown', [option('1', 'ANA')]));
    assert.equal(currentOptions(h)[0].rhidBadge?.status, 'unavailable');
    assert.equal(currentOptions(h)[0].rhidBadge?.label, 'RHID INDISPONÍVEL');
  });
}

test('pending presence IDs distinguish namesakes without guessing the supplier identity', async t => {
  const h = harness(t, async day => report(day, [
    person('10', 'ANA', '', day, { pendingPresenceIds: ['101'] }),
    person('20', 'ANA', '07:00;12:00;13:00;16:30', day, { pendingPresenceIds: ['102'] }),
  ]));
  await open(h, poll('homonyms', [option('101', 'ANA'), option('102', 'ANA')]));
  assert.deepEqual(currentOptions(h).map(item => item.rhidBadge?.status), ['absent', 'present']);
});

test('badge loading stays neutral and deduplicates reads during checkbox/filter changes', async t => {
  let resolve;
  const h = harness(t, day => new Promise(done => { resolve = () => done(report(day, [person('1', 'ANA')])); }), { timeoutMs: 1000 });
  await open(h, poll('loading', [option('1', 'ANA')]));
  assert.equal(currentOptions(h)[0].rhidBadge?.status, 'loading');
  h.store.setDraft('ANA'); await tick();
  assert.deepEqual(h.reads, ['2026-10-05']);
  resolve(); await tick(); await tick();
  assert.equal(currentOptions(h)[0].rhidBadge?.status, 'absent');
  assert.equal(h.store.getState().draft, 'ANA');
});

test('a late reply for a different day cannot overwrite the current date or choices', async t => {
  let resolveOld;
  const h = harness(t, day => day === '2026-10-05'
    ? new Promise(done => { resolveOld = () => done(report(day, [person('1', 'ANA')])); })
    : Promise.resolve(report(day, [person('1', 'ANA', '07:00;12:00;13:00;17:00', day)])), { timeoutMs: 1000 });
  await open(h, poll('old-day', [option('101', 'ANA')]));
  assert.equal(typeof resolveOld, 'function', 'opening a dated presence must start its daily RHID read');
  h.store.ingestRemoteMessages([poll('new-day', [option('102', 'ANA', '2026-10-06')])], { activeFlow: flow, resetConversation: true });
  await tick(); await tick();
  resolveOld(); await tick(); await tick();
  assert.equal(h.renders.at(-1).messages.at(-1).id, 'new-day');
  assert.equal(currentOptions(h)[0].id, 'choice:registro_presenca_pendente:102');
  assert.equal(currentOptions(h)[0].rhidBadge?.label, '09h00');
  assert.equal(currentOptions(h)[0].rhidBadge?.date, '2026-10-06');
});

test('missing or impossible presence dates do not consult RHID with an invented current date', async t => {
  const h = harness(t, async () => { assert.fail('invalid dates must never query'); });
  const undated = { id: 'pending_attendance_record:1', label: '1 - ANA' };
  await open(h, poll('invalid-date', [undated, option('2', 'BIA', '2026-02-30')]));
  assert.deepEqual(h.reads, []);
  assert.deepEqual(currentOptions(h).map(item => item.rhidBadge?.status), ['unavailable', 'unavailable']);
});

test('closing the app prevents a late badge response from rendering or persisting', async t => {
  let resolve;
  const h = harness(t, day => new Promise(done => { resolve = () => done(report(day, [person('1', 'ANA')])); }), { timeoutMs: 1000 });
  await open(h, poll('closing', [option('1', 'ANA')]));
  assert.equal(typeof resolve, 'function', 'opening a dated presence must start its daily RHID read');
  h.controller.stop(); const count = h.renders.length;
  resolve(); await tick(); await tick();
  assert.equal(h.renders.length, count);
  assert.equal(h.store.getState().messages.at(-1).options[0].rhidBadge, undefined);
});

test('RHID timeout resolves to an unavailable indicator without blocking the presence choices', async t => {
  const h = harness(t, () => new Promise(() => {}), { timeoutMs: 5 });
  await open(h, poll('timeout', [option('1', 'ANA')]));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(currentOptions(h)[0].rhidBadge?.status, 'unavailable');
  assert.equal(h.store.getState().activeText, null);
  assert.equal(h.store.getState().activeFlow.id, 'attendance_validation');
});

test('reauthentication cannot reuse a loading badge request from the previous account', async t => {
  let resolveOld, reads = 0;
  const h = harness(t, day => ++reads === 1
    ? new Promise(done => { resolveOld = () => done(report(day, [person('1', 'ANA')])); })
    : Promise.resolve(report(day, [person('1', 'ANA', '07:00;12:00;13:00;16:30')])),
    { timeoutMs: 1000, signInAccount: { homeAccountId: 'new-owner', name: 'Novo' } });
  await open(h, poll('reauth', [option('1', 'ANA')]));
  await h.view.emit('sign-in'); await tick(); await tick();
  assert.equal(h.renders.at(-1).account.homeAccountId, 'new-owner');
  assert.equal(currentOptions(h)[0].rhidBadge?.label, '08h30');
  resolveOld(); await tick(); await tick();
  assert.equal(currentOptions(h)[0].rhidBadge?.label, '08h30');
  assert.equal(h.store.getState().messages.at(-1).options[0].rhidBadge, undefined);
});

test('supplier sync choices receive daily badges even without presentation metadata', async t => {
  const h = harness(t, async day => report(day, [person('1', 'ANA', '07:00;12:00;13:00;16:30')]));
  const message = poll('inferred', [{ ...option('1', 'ANA'), id: 'choice:sincronizar_atividade_fornecedor_presenca:supplier_sync_target:1', reply: 'choice:sincronizar_atividade_fornecedor_presenca:supplier_sync_target:1' }]);
  delete message.presentation;
  await open(h, message);
  assert.deepEqual(h.reads, ['2026-10-05']);
  assert.equal(currentOptions(h)[0].rhidBadge?.label, '08h30');
  assert.equal(h.writes.length, 0);
});
