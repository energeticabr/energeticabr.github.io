import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';
import { buildRhidAttendanceTable } from '../src/chat/rhid-attendance-table.js';

function setup(t, adjustment) {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app'), view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  const table = buildRhidAttendanceTable([{ Id: 10, ID_PESSOA_RHID: '23', NOME_COLABORADOR: 'EDGAR',
    BATIDAS_RHID: '06:55;13:00;17:06', ...(adjustment ? { ADMIN_AJUSTES: { exit1: adjustment } } : {}) }]);
  view.render({ sessionStatus: 'authenticated', account: { name: 'Bernardo', username: 'bernardo@example.test' },
    messages: [{ id: 'rhid-delete', type: 'poll', role: 'assistant', question: 'RELATÓRIO RHID', options: [],
      detail_table: { ...table, reportDate: '2020-10-15' } }] });
  root.querySelector('[data-action="rhid-attendance-adjust-open"][data-slot="exit1"]').click();
  return { root, view, table };
}
const own = { id: 47, time: '12:00', reason: 'NÃO APONTADO', actorName: 'Bernardo', actorEmail: 'BERNARDO@example.test' };

test('own existing manual punch exposes cancel, delete and save edition in that order', t => {
  const { root } = setup(t, own);
  assert.deepEqual([...root.querySelectorAll('[data-rhid-adjustment-dialog] .chat-confirmation__actions button')].map(b => b.textContent),
    ['Cancelar', 'Deletar registro', 'Salvar edição']);
});
test('deletion emits the saved revision, without saving typed changes or requiring a new reason', t => {
  const { root, view } = setup(t, own), events = [], saves = [];
  view.on('rhid-attendance-adjust-delete', event => events.push(event));
  view.on('rhid-attendance-adjust-save', event => saves.push(event));
  root.querySelector('[data-role="rhid-adjustment-time"]').value = '12:15';
  const button = root.querySelector('[data-action="rhid-attendance-adjust-delete"]');
  assert.ok(button); button.click(); button.click();
  assert.deepEqual(events, [{ type: 'rhid-attendance-adjust-delete', messageId: 'rhid-delete', personKey: 'rhid:23', slot: 'exit1', revisionId: '47' }]);
  assert.equal(saves.length, 0);
  assert.ok([...root.querySelectorAll('[data-rhid-adjustment-dialog] button')].every(b => b.disabled));
  view.setRhidAttendanceAdjustmentStatus({ busy: false, error: 'Falha temporária' });
  assert.equal(root.querySelector('[data-role="rhid-adjustment-time"]').value, '12:15');
  assert.equal(root.querySelector('[data-action="rhid-attendance-adjust-delete"]').disabled, false);
});
test('new missing-punch regularization retains exactly the original two actions', t => {
  const { root } = setup(t);
  assert.deepEqual([...root.querySelectorAll('[data-rhid-adjustment-dialog] .chat-confirmation__actions button')].map(b => b.textContent), ['Cancelar', 'Salvar horário']);
});
for (const actorEmail of ['other@example.test', '']) test(`another or unidentified author cannot expose deletion (${actorEmail || 'unknown'})`, t => {
  const { root } = setup(t, { ...own, actorEmail });
  assert.equal(root.querySelector('[data-action="rhid-attendance-adjust-delete"]'), null);
});
test('a withdrawn report awaiting refresh never presents or shares stale hours', t => {
  const { root, view, table } = setup(t, own);
  root.querySelector('[data-action="rhid-attendance-adjust-cancel"]').click();
  view.render({ sessionStatus: 'authenticated', account: { username: 'bernardo@example.test' }, messages: [{
    id: 'rhid-delete', role: 'assistant', type: 'poll', question: 'RELATÓRIO RHID', options: [],
    detail_table: { ...table, reportDate: '2020-10-15', adjustmentRefreshRequired: true, navigationBusy: false },
  }] });
  assert.equal(root.querySelector('[data-action="share-rhid-attendance-report"]'), null);
  assert.equal(root.querySelector('.chat-rhid-attendance-card'), null);
  assert.ok(root.querySelector('[data-action="rhid-attendance-report-navigate"][data-value="reload"]'));
});
