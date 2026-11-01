import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createTaskCompletionDialog } from '../src/ui/task-completion-dialog.js';
import { createChatView } from '../src/ui/chat-view.js';
import { buildRhidAttendanceTable } from '../src/chat/rhid-attendance-table.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const context = () => ({ item: { id: '7', eTag: '"1"', fields: { due: '2020-10-01', status: 'EM ATENDIMENTO' } },
  columns: [{ name: 'due', label: 'DATA CONCLUSÃO', control: 'date', editable: true },
    { name: 'status', label: 'CONCLUÍDO', control: 'text', editable: true }], contract: { hasForm: true } });
function domHarness(t) {
  const dom = new JSDOM('<main id="app" tabindex="-1"></main>', { url: 'https://example.test' });
  t.after(() => dom.window.close());
  return { dom, document: dom.window.document, root: dom.window.document.querySelector('main') };
}
async function taskHarness(t, overrides = {}) {
  const h = domHarness(t), writes = [];
  const data = { loadEditor: async () => context(), saveEditor: async (_, fields) => { writes.push(fields); return {}; }, ...overrides.data };
  const dialog = createTaskCompletionDialog({ document: h.document, host: h.root, data, today: () => '2020-10-02',
    onBlocked() {}, onChanged: overrides.onChanged || (async () => {}) });
  t.after(() => dialog.destroy());
  await dialog.open({ id: '7' });
  return { ...h, dialog, writes, submit: () => h.root.querySelector('[data-task-completion-submit]').click() };
}
function review(h) {
  const node = h.document.querySelector('[data-edit-review]');
  assert.ok(node, 'a separate review must precede writes');
  assert.deepEqual([...node.querySelectorAll('th')].map(x => x.textContent), ['Campo', 'Antes', 'Depois']);
  return node;
}
function set(h, selector, value) {
  const input = h.root.querySelector(selector); assert.ok(input, selector); input.value = value;
  input.dispatchEvent(new h.dom.window.Event('input', { bubbles: true }));
  return input;
}
test('task completion highlights persisted differences, removes reverted fill and confirms exactly once', async t => {
  const h = await taskHarness(t);
  const date = h.root.querySelector('[name="completionDate"]');
  assert.ok(date.closest('[data-edit-changed]'));
  set(h, '[name="completionDate"]', '2020-10-01'); await tick();
  assert.equal(date.closest('[data-edit-changed]'), null);
  h.submit(); h.submit(); await tick();
  assert.equal(h.writes.length, 0);
  const dialog = review(h);
  assert.match(dialog.textContent, /EM ATENDIMENTO/);
  assert.match(dialog.textContent, /CONCLUÍDA/);
  dialog.querySelector('[data-edit-review-submit]').click(); await tick();
  assert.equal(h.writes.length, 1);
});
test('task review cancel and Escape preserve draft; cleanup cancels pending review', async t => {
  const h = await taskHarness(t);
  set(h, '[name="completionDate"]', '2020-10-03');
  h.submit(); review(h).querySelector('[data-edit-review-cancel]').click(); await tick();
  assert.equal(h.root.querySelector('input').value, '2020-10-03');
  h.submit(); review(h).dispatchEvent(new h.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await tick();
  assert.equal(h.root.querySelector('input').value, '2020-10-03');
  h.submit(); const old = review(h).querySelector('[data-edit-review-confirm]');
  h.dialog.destroy(); old.click(); await tick();
  assert.equal(h.document.querySelector('[data-edit-review]'), null);
  assert.equal(h.writes.length, 0);
});
test('task ambiguous save reconciles without another review or a duplicate mutation', async t => {
  let reads = 0, writes = 0;
  const h = await taskHarness(t, { data: {
    loadEditor: async () => { if (++reads === 2) throw new Error('offline');
      return reads === 1 ? context() : { ...context(), item: { id: '7', eTag: '"2"', fields: { due: '2020-10-02', status: 'CONCLUÍDA' } } }; },
    saveEditor: async () => { writes++; throw new Error('ambiguous'); },
  } });
  h.submit(); review(h).querySelector('[data-edit-review-submit]').click(); await tick(); await tick();
  assert.equal(writes, 1); assert.equal(h.root.querySelector('input').disabled, true);
  h.submit(); await tick(); await tick();
  assert.equal(h.document.querySelector('[data-edit-review]'), null);
  assert.equal(writes, 1); assert.ok(h.root.querySelector('[data-task-completion-success]'));
});

function chatHarness(t, state) {
  const h = domHarness(t), view = createChatView(h.root);
  t.after(() => view.destroy());
  const base = { sessionStatus: 'authenticated', account: { name: 'Teste', username: 'test@example.test' },
    messages: [], pendingFiles: [], draft: '', ...state };
  view.render(base);
  return { ...h, view, state: base };
}
function dueHarness(t) {
  const h = chatHarness(t, { pendingProvisions: { due: true, sourceKind: 'provision-description',
    rows: [{ id: '42', sourceKind: 'provision-description', supplier: 'Teste', dueDate: '2020-10-01' }] },
    pendingProvisionDateEditPaymentId: '42', pendingProvisionDateEditValue: '01/10/2020' });
  const writes = []; h.view.on('save-pending-provision-due-date', e => writes.push(e));
  return { ...h, writes, submit: () => h.root.querySelector('[data-action="save-pending-provision-due-date"]').click() };
}
test('pending due date reviews row baseline, preserves cancel draft and source command, no write before confirm', async t => {
  const h = dueHarness(t);
  const field = set(h, '[data-role="pending-provision-due-date"]', '2020-10-09'); await tick();
  assert.ok(field.closest('[data-edit-changed]'));
  h.submit(); h.submit(); assert.equal(h.writes.length, 0);
  const dialog = review(h); assert.match(dialog.textContent, /01\/10\/2020/); assert.match(dialog.textContent, /09\/10\/2020/);
  dialog.querySelector('[data-edit-review-cancel]').click(); await tick();
  assert.equal(field.value, '2020-10-09'); assert.equal(h.writes.length, 0);
  h.submit(); review(h).querySelector('[data-edit-review-submit]').click(); await tick();
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].paymentId, '42'); assert.equal(h.writes[0].value, '09/10/2020');
});
test('pending due date revert has no review or mutation; destroy cancels review', async t => {
  const h = dueHarness(t);
  set(h, '[data-role="pending-provision-due-date"]', '2020-10-09');
  const field = set(h, '[data-role="pending-provision-due-date"]', '2020-10-01'); await tick();
  assert.equal(field.closest('[data-edit-changed]'), null);
  h.submit(); await tick(); assert.equal(h.document.querySelector('[data-edit-review]'), null); assert.equal(h.writes.length, 0);
  set(h, '[data-role="pending-provision-due-date"]', '2020-10-09'); h.submit();
  const confirm = review(h).querySelector('[data-edit-review-submit]'); h.view.destroy(); confirm.click(); await tick();
  assert.equal(h.writes.length, 0); assert.equal(h.document.querySelector('[data-edit-review]'), null);
});
test('pending due date draft never transfers between different source kinds with the same numeric ID', async t => {
  const h = dueHarness(t);
  set(h, '[data-role="pending-provision-due-date"]', '2020-10-09');
  h.view.render({ ...h.state, pendingProvisions: { due: true, sourceKind: '', rows: [
    { id: '42', sourceKind: '', dueDate: '2020-10-02' },
  ] }, pendingProvisionDateEditValue: '02/10/2020' });
  assert.equal(h.root.querySelector('[data-role="pending-provision-due-date"]').value, '2020-10-02');
  assert.equal(h.writes.length, 0);
});
function rhidHarness(t, previous = true) {
  const table = buildRhidAttendanceTable([{ Id: '10', ID_PESSOA_RHID: '23', NOME_COLABORADOR: 'Teste',
    BATIDAS_RHID: '07:00;13:00;17:00', ...(previous ? { ADMIN_AJUSTES: { exit1: { id: '47', time: '12:00', reason: 'Motivo original' } } } : {}) }]);
  const h = chatHarness(t, { messages: [{ id: 'hours', role: 'assistant', type: 'poll', options: [],
    detail_table: { ...table, reportDate: '2020-10-15' } }] });
  const writes = []; h.view.on('rhid-attendance-adjust-save', e => writes.push(e));
  h.root.querySelector('[data-action="rhid-attendance-adjust-open"][data-slot="exit1"]').click();
  return { ...h, writes, submit: () => h.root.querySelector('[data-action="rhid-attendance-adjust-save"]').click() };
}
test('RHID existing correction reviews persisted time/reason, cancel retains draft, confirm emits once', async t => {
  const h = rhidHarness(t);
  const field = set(h, '[data-role="rhid-adjustment-time"]', '12:15');
  set(h, '[data-role="rhid-adjustment-reason"]', 'Motivo corrigido'); await tick();
  assert.ok(field.closest('[data-edit-changed]'));
  h.submit(); h.submit(); assert.equal(h.writes.length, 0);
  const dialog = review(h); assert.match(dialog.textContent, /12:00/); assert.match(dialog.textContent, /12:15/);
  assert.match(dialog.textContent, /Motivo original/); assert.match(dialog.textContent, /Motivo corrigido/);
  dialog.querySelector('[data-edit-review-cancel]').click(); await tick(); assert.equal(field.value, '12:15');
  h.submit(); review(h).querySelector('[data-edit-review-submit]').click(); await tick();
  assert.equal(h.writes.length, 1); assert.equal(h.writes[0].time, '12:15');
});
test('RHID new missing-punch regularization keeps creation flow without edit review', async t => {
  const h = rhidHarness(t, false); h.submit(); await tick();
  assert.equal(h.document.querySelector('[data-edit-review]'), null); assert.equal(h.writes.length, 1);
});
test('RHID edit opens saved reason and reverting both fields produces zero writes', async t => {
  const h = rhidHarness(t);
  assert.equal(h.root.querySelector('[data-role="rhid-adjustment-reason"]').value, 'Motivo original');
  set(h, '[data-role="rhid-adjustment-time"]', '12:15');
  const field = set(h, '[data-role="rhid-adjustment-time"]', '12:00'); await tick();
  assert.equal(field.closest('[data-edit-changed]'), null);
  h.submit(); await tick(); assert.equal(h.document.querySelector('[data-edit-review]'), null); assert.equal(h.writes.length, 0);
});
for (const kind of ['rhid', 'due']) test(`${kind} re-render cancels review, keeps draft and persisted baseline for next review`, async t => {
  const h = kind === 'rhid' ? rhidHarness(t) : dueHarness(t);
  const selector = kind === 'rhid' ? '[data-role="rhid-adjustment-time"]' : '[data-role="pending-provision-due-date"]';
  const value = kind === 'rhid' ? '12:15' : '2020-10-09';
  set(h, selector, value);
  h.submit(); const stale = review(h).querySelector('[data-edit-review-submit]');
  h.view.render({ ...h.state, error: 'refresh' }); stale.click(); await tick();
  assert.equal(h.document.querySelector('[data-edit-review]'), null); assert.equal(h.writes.length, 0);
  assert.equal(h.root.querySelector(selector).value, value);
  h.submit(); assert.match(review(h).textContent, kind === 'rhid' ? /12:00/ : /01\/10\/2020/);
  h.view.destroy(); await tick(); assert.equal(h.document.querySelector('[data-edit-review]'), null); assert.equal(h.writes.length, 0);
});
test('attendance justification reviews existing presence field and cancellation preserves selection queue', async t => {
  const h = chatHarness(t, { messages: [{ id: 'attendance', role: 'assistant', type: 'poll', presentation: 'attendance_multi_select',
    question: 'VALIDAR PRESENÇAS', options: [{ id: 'pending_attendance_record:2249', label: '2249 - Teste',
      rhidBadge: { date: '2020-10-15', minutes: 100, status: 'present' } }] }] });
  const writes = []; h.view.on('attendance-irregularity-save', async e => writes.push(e));
  h.root.querySelector('[data-action="attendance-select-toggle"]').click();
  const field = set(h, '[data-role="attendance-irregularity-reason"]', 'Saída autorizada'); await tick();
  assert.ok(field.closest('[data-edit-changed]'));
  const submit = () => h.root.querySelector('[data-action="attendance-irregularity-submit"]').click();
  submit(); submit(); assert.equal(writes.length, 0);
  review(h).querySelector('[data-edit-review-cancel]').click(); await tick();
  assert.equal(field.value, 'Saída autorizada'); assert.equal(h.root.querySelector('[data-action="attendance-select-toggle"]').checked, false);
  submit(); review(h).querySelector('[data-edit-review-submit]').click(); await tick(); await tick();
  assert.equal(writes.length, 1); assert.equal(writes[0].explanation, 'Saída autorizada');
  assert.equal(h.root.querySelector('[data-action="attendance-select-toggle"]').checked, true);
});
