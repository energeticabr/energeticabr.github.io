import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const day = '2020-10-15';
const reason = 'NÃO BATEU PONTO, APESAR DE ESTAR PRESENTE';
const row = (extra = {}) => ({ Id: '10', ID_PESSOA_RHID: '23', NOME_COLABORADOR: 'HELISON ROSA LUIS',
  DATA_REFERENCIA: day, BATIDAS_RHID: '06:52', ...extra });
const poll = (extra = {}) => ({ id: 'pending-day', role: 'assistant', type: 'poll', presentation: 'attendance_multi_select',
  question: 'QUAL PRESENÇA DESEJA VALIDAR?', options: [{ id: 'pending_attendance_record:2266',
    label: '2266 - HELISON ROSA LUIS', source_values: { DATA: day, FORNECEDOR: 'HELISON ROSA LUIS' } }], ...extra });

async function harness(t, { rows = [row()], message = poll(), save } = {}) {
  const dom = new JSDOM('<main id="app"></main>', { url: 'https://app.example.test/energetico/' });
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root);
  let sequence = 0;
  const store = createConversationStore({ randomUUID: () => `correction-${++sequence}` });
  const saves = [], writes = [];
  const client = {
    sendText: async value => { writes.push(value); return { status: 'processed', messages: [] }; },
    getRhidAttendanceReport: async date => ({ date, rows }),
    saveRhidAttendanceAdjustment: async payload => {
      saves.push(payload);
      return save ? save(payload) : { time: payload.time, reason: payload.reason, actorName: 'Teste' };
    },
  };
  const account = { homeAccountId: 'correction-owner', name: 'Teste' };
  const controller = createAppController({ store, view, client,
    auth: { initialize: async () => account, getToken: async () => 'test-token', signOut: async () => {} },
    native: { importSharedItems: async () => [] },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
  });
  t.after(() => { controller.stop(); view.destroy(); dom.window.close(); });
  await controller.start();
  store.ingestRemoteMessages([message], { activeFlow: { id: 'attendance_validation', title: 'VALIDAR PRESENÇAS' }, resetConversation: true });
  await tick(); await tick();
  writes.length = 0;
  return { dom, root, view, store, client, saves, writes };
}

function correctionButton(h, slot) {
  return h.root.querySelector(`[data-action="attendance-rhid-adjust-open"][data-slot="${slot}"]`);
}

for (const [slot, label, suggested] of [['entry1', 'Entrada 1', '07:00'], ['exit1', 'Saída 1', '12:00'], ['entry2', 'Entrada 2', '13:00'], ['exit2', 'Saída 2', '17:00']]) {
  const rows = [row({ BATIDAS_RHID: slot === 'entry1' ? '12:00;13:00;17:00' : '06:52' })];
  test(`missing ${slot} opens the existing RHID dialog without selecting or submitting attendance`, async t => {
    const h = await harness(t, { rows });
    const button = correctionButton(h, slot);
    assert.ok(button, 'the missing punch must be a real button');
    assert.equal(button.tagName, 'BUTTON');
    assert.equal(button.parentElement.closest('button'), null, 'controls must not be nested buttons');
    button.click();
    const dialog = h.root.querySelector('[data-rhid-adjustment-dialog]');
    assert.ok(dialog);
    assert.match(dialog.querySelector('h2').textContent, new RegExp(`Corrigir ${label} — HELISON ROSA LUIS`));
    assert.equal(dialog.querySelector('input[type="time"]').value, suggested);
    assert.equal(dialog.querySelector('textarea').value, reason);
    assert.equal(h.root.querySelector('[data-action="attendance-select-toggle"]').checked, false);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.saves, []);
    h.root.querySelector('[data-action="rhid-attendance-adjust-cancel"]').click();
    assert.equal(h.root.querySelector('[data-rhid-adjustment-dialog]'), null);
    assert.ok(correctionButton(h, slot));
  });

  test(`saving missing ${slot} updates the same presence immediately and persists its audited correction`, async t => {
    const h = await harness(t, { rows });
    assert.ok(correctionButton(h, slot));
    correctionButton(h, slot).click();
    const input = h.root.querySelector('[data-role="rhid-adjustment-time"]');
    input.value = suggested;
    h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
    await tick(); await tick();
    assert.deepEqual(h.saves, [{ date: day, personKey: 'rhid:23', slot, time: suggested, reason }]);
    assert.equal(h.root.querySelector('[data-rhid-adjustment-dialog]'), null);
    assert.equal(correctionButton(h, slot), null, 'an already corrected slot is no longer a missing-punch action');
    assert.match(h.root.querySelector(`[data-rhid-slot="${slot}"]`).textContent, new RegExp(suggested));
    assert.equal(h.store.getState().messages.at(-1).id, 'pending-day');
    assert.deepEqual(h.writes, [], 'a correction must never send an attendance reply');
    assert.deepEqual(h.store.getState().messages.at(-1).options, poll().options, 'durable choices are unchanged');
  });
}

test('populated slots never become missing-punch controls', async t => {
  const h = await harness(t, { rows: [row({ BATIDAS_RHID: '07:00;12:00;13:00;17:00' })] });
  assert.equal(h.root.querySelectorAll('[data-action="attendance-rhid-adjust-open"]').length, 0);
});

test('E1 is editable when all punches were initially empty', async t => {
  const h = await harness(t, { rows: [row({ BATIDAS_RHID: '' })] });
  const button = correctionButton(h, 'entry1');
  assert.ok(button, 'an initially empty E1 must offer the correction action');
  button.click();
  assert.equal(h.root.querySelector('[data-role="rhid-adjustment-time"]').value, '07:00');
  assert.deepEqual(h.saves, []);
  assert.deepEqual(h.writes, []);
});

for (const extra of [
  { BATIDAS_RHID: '06:50;07:10;12:00;13:00;17:00' },
  { BATIDAS_RHID: '12:00;13:00;17:00', ADMIN_AJUSTES: { entry1: { time: '07:15', reason: 'Conferido' } } },
]) {
  test(`E1 with existing RHID candidates or an approved adjustment stays protected: ${JSON.stringify(extra)}`, async t => {
    const h = await harness(t, { rows: [row(extra)] });
    assert.equal(correctionButton(h, 'entry1'), null);
    assert.deepEqual(h.saves, []);
  });
}

test('a disabled presence does not offer an empty E1 correction', async t => {
  const message = poll();
  message.options[0].disabled = true;
  const h = await harness(t, { message, rows: [row({ BATIDAS_RHID: '' })] });
  assert.equal(correctionButton(h, 'entry1'), null);
  assert.deepEqual(h.saves, []);
});

test('Friday keeps the RHID standard exit of 16:00', async t => {
  const date = '2020-10-16';
  const message = poll();
  message.options[0].source_values.DATA = date;
  const h = await harness(t, { message, rows: [row({ DATA_REFERENCIA: date })] });
  assert.ok(correctionButton(h, 'exit2'));
  correctionButton(h, 'exit2').click();
  assert.equal(h.root.querySelector('[data-role="rhid-adjustment-time"]').value, '16:00');
});

test('a failed save keeps the dialog and the missing punch, allowing retry without advancing', async t => {
  const h = await harness(t, { save: async () => { throw new Error('Falha de teste'); } });
  assert.ok(correctionButton(h, 'exit1'));
  correctionButton(h, 'exit1').click();
  h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  await tick(); await tick();
  assert.match(h.root.querySelector('[data-rhid-adjustment-dialog] [role="alert"]').textContent, /Falha de teste/);
  assert.match(h.root.querySelector('[data-rhid-slot="exit1"]').textContent, /—/);
  assert.equal(h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').disabled, false);
  assert.deepEqual(h.writes, []);
});

test('changing the pending poll dismisses its unsaved correction', async t => {
  const h = await harness(t);
  assert.ok(correctionButton(h, 'exit1'));
  correctionButton(h, 'exit1').click();
  h.store.ingestRemoteMessages([{ id: 'next-question', type: 'poll', role: 'assistant', question: 'OUTRA PERGUNTA', options: [] }]);
  assert.equal(h.root.querySelector('[data-rhid-adjustment-dialog]'), null);
  assert.deepEqual(h.saves, []);
});

test('three consecutive corrections recalculate the total without replacing the pending list', async t => {
  const h = await harness(t);
  for (const [slot, time] of [['exit1', '12:00'], ['entry2', '13:00'], ['exit2', '17:00']]) {
    correctionButton(h, slot).click();
    h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
    await tick(); await tick();
    assert.match(h.root.querySelector(`[data-rhid-slot="${slot}"]`).textContent, new RegExp(time));
  }
  assert.equal(h.root.querySelector('.chat-attendance-rhid-badge').textContent, '09h08');
  assert.equal(h.saves.length, 3);
  assert.deepEqual(h.writes, []);
});

test('saving a missing punch retains another checked presence and does not change its times', async t => {
  const message = poll();
  message.options.push({ id: 'pending_attendance_record:2267', label: '2267 - ANA', source_values: { DATA: day, FORNECEDOR: 'ANA' } });
  const h = await harness(t, { message, rows: [row(), row({ Id: '11', ID_PESSOA_RHID: '24', NOME_COLABORADOR: 'ANA', BATIDAS_RHID: '07:00;12:00;13:00;17:00' })] });
  h.root.querySelector('input[data-reply-id="2267"]').click();
  correctionButton(h, 'exit1').click();
  h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  await tick(); await tick();
  assert.equal(h.root.querySelector('input[data-reply-id="2267"]').checked, true);
  assert.equal(h.root.querySelector('input[data-reply-id="2266"]').checked, false);
  assert.match(h.root.querySelector('input[data-reply-id="2267"]').closest('.chat-attendance-select__row').textContent, /S1- 12:00/);
  assert.deepEqual(h.writes, []);
});

test('the save button blocks repeat clicks while a correction is in flight', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = await harness(t, { save: payload => pending.then(() => ({ time: payload.time })) });
  correctionButton(h, 'exit1').click();
  h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  assert.equal(h.saves.length, 1);
  assert.equal(h.root.querySelector('[data-action="rhid-attendance-adjust-cancel"]').disabled, true);
  release();
  await tick(); await tick();
  assert.match(h.root.querySelector('[data-rhid-slot="exit1"]').textContent, /12:00/);
});

test('ambiguous collaborators do not offer a correction on a guessed identity', async t => {
  const h = await harness(t, { rows: [row(), row({ Id: '11', ID_PESSOA_RHID: '24' })] });
  assert.equal(h.root.querySelectorAll('[data-action="attendance-rhid-adjust-open"]').length, 0);
  assert.deepEqual(h.saves, []);
});

test('supplier replication does not gain the validation-only correction action', async t => {
  const message = poll({ presentation: 'attendance_supplier_sync' });
  message.options[0].id = 'supplier_sync_target:2266';
  const h = await harness(t, { message });
  assert.equal(h.root.querySelectorAll('[data-action="attendance-rhid-adjust-open"]').length, 0);
});

test('refreshing the presence card preserves the time and reason being typed', async t => {
  const h = await harness(t);
  correctionButton(h, 'exit2').click();
  for (const [role, value] of [['rhid-adjustment-time', '17:45'], ['rhid-adjustment-reason', 'Estava em campo']]) {
    const input = h.root.querySelector(`[data-role="${role}"]`);
    input.value = value;
    input.dispatchEvent(new h.dom.window.Event('input', { bubbles: true }));
  }
  h.store.setDraft('HELISON');
  assert.equal(h.root.querySelector('[data-role="rhid-adjustment-time"]').value, '17:45');
  assert.equal(h.root.querySelector('[data-role="rhid-adjustment-reason"]').value, 'Estava em campo');
});

for (const fails of [false, true]) {
  test(`an old ${fails ? 'failed' : 'successful'} save does not close or alter a newer dialog`, async t => {
    let resolve, reject;
    const pending = new Promise((done, fail) => { resolve = done; reject = fail; });
    const h = await harness(t, { save: () => pending });
    correctionButton(h, 'exit1').click();
    h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
    h.store.ingestRemoteMessages([poll({ id: 'new-pending-day' })]);
    correctionButton(h, 'exit2').click();
    if (fails) reject(new Error('Erro da tela antiga')); else resolve({ time: '12:00' });
    await tick(); await tick();
    const dialog = h.root.querySelector('[data-rhid-adjustment-dialog]');
    assert.ok(dialog);
    assert.match(dialog.querySelector('h2').textContent, /Saída 2/);
    assert.equal(dialog.querySelector('[role="alert"]'), null);
    assert.equal(dialog.querySelector('[data-role="rhid-adjustment-time"]').value, '17:00');
  });
}

test('a lagging report after cache expiry does not erase a confirmed correction', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const h = await harness(t);
  correctionButton(h, 'exit1').click();
  h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  await tick(); await tick();
  clock += 61000;
  h.store.setDraft('HELISON');
  await tick(); await tick();
  assert.match(h.root.querySelector('[data-rhid-slot="exit1"]').textContent, /12:00/);
  assert.equal(correctionButton(h, 'exit1'), null);
});

test('an authoritative subsequent adjustment supersedes the temporary confirmed value', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const h = await harness(t);
  correctionButton(h, 'exit1').click();
  h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  await tick(); await tick();
  h.client.getRhidAttendanceReport = async date => ({ date, rows: [row({ ADMIN_AJUSTES: { exit1: { time: '12:10', reason: 'Nova conferência' } } })] });
  clock += 61000;
  h.store.setDraft('HELISON');
  await tick(); await tick();
  assert.match(h.root.querySelector('[data-rhid-slot="exit1"]').textContent, /12:10/);
});

test('consecutive confirmed corrections all survive a later lagging collection', async t => {
  let clock = Date.now();
  t.mock.method(Date, 'now', () => clock);
  const h = await harness(t);
  for (const slot of ['exit1', 'entry2', 'exit2']) {
    correctionButton(h, slot).click();
    h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
    await tick(); await tick();
  }
  clock += 61000;
  h.store.setDraft('HELISON');
  await tick(); await tick();
  assert.equal(h.root.querySelector('.chat-attendance-rhid-badge').textContent, '09h08');
});

for (const [slot, punches, filled] of [['entry1', '12:00;13:00;17:00', '07:10'], ['exit1', '06:52', '12:10']]) {
  test(`${slot} filled by a refreshed report between open and save cannot be overwritten here`, async t => {
    let clock = Date.now();
    t.mock.method(Date, 'now', () => clock);
    const h = await harness(t, { rows: [row({ BATIDAS_RHID: punches })] });
    const button = correctionButton(h, slot);
    assert.ok(button, 'the empty slot must be editable before the refresh');
    button.click();
    h.client.getRhidAttendanceReport = async date => ({ date, rows: [row({ BATIDAS_RHID: punches, ADMIN_AJUSTES: { [slot]: { time: filled } } })] });
    clock += 61000;
    h.store.setDraft('HELISON');
    await tick(); await tick();
    h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
    await tick();
    assert.deepEqual(h.saves, []);
    assert.match(h.root.querySelector(`[data-rhid-slot="${slot}"]`).textContent, new RegExp(filled));
    assert.match(h.root.querySelector('[data-rhid-adjustment-dialog] [role="alert"]').textContent, /validar o ajuste/);
  });
}

test('a save resolving after sign-out does not restore the old presence or dialog', async t => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const h = await harness(t, { save: () => pending });
  correctionButton(h, 'exit1').click();
  h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click();
  h.root.querySelector('[data-action="sign-out"]').click();
  h.root.querySelector('[data-action="confirm-sign-out"]').click();
  await tick(); await tick();
  resolve({ time: '12:00' });
  await tick(); await tick();
  assert.equal(h.root.querySelector('[data-rhid-adjustment-dialog]'), null);
  assert.equal(h.root.querySelector('[data-rhid-slot="exit1"]'), null);
  assert.ok(h.root.querySelector('[data-action="sign-in"]'));
});
