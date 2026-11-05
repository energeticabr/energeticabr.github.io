import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';

function setup(t, partialPunch = false) {
  const dom = new JSDOM('<main></main>'), root = dom.window.document.querySelector('main');
  const view = createChatView(root), replies = [];
  t.after(() => { view.destroy(); dom.window.close(); });
  view.on('select-reply', event => replies.push(event.replyId));
  view.render({ sessionStatus: 'authenticated', account: { homeAccountId: 'test-user', name: 'Teste' },
    draft: '', pendingFiles: [], messages: [{ id: 'holiday-pending', role: 'assistant', type: 'poll',
      presentation: 'attendance_multi_select', question: 'VALIDAR PRESENÇAS', options: ['1','2'].map(id => ({
        id: `pending_attendance_record:${id}`, label: `${id} - PESSOA ${id}`, date: '2026-11-02',
        rhidBadge: partialPunch
          ? { date: '2026-11-02', status: 'inconsistent', label: 'INCONSISTENTE', punches: { entry1: '07:00' } }
          : { date: '2026-11-02', status: 'absent', label: 'AUSENTE' },
      })) }],
  });
  return { root, view, replies };
}

async function submit(root) {
  root.querySelector('[data-role="attendance-irregularity-reason"]').value = 'FERIADO';
  root.querySelector('[data-action="attendance-irregularity-submit"]').click();
  const review = root.ownerDocument.querySelector('[data-edit-review]');
  assert.ok(review);
  assert.match(review.textContent, /Presença.*PENDENTE.*AUSENTE/s);
  review.querySelector('[data-edit-review-submit]').click();
  await new Promise(resolve => setImmediate(resolve));
}

for (const mode of ['checkbox', 'individual', 'todos']) {
  test(`holiday ${mode} submit does not select or reopen the already validated presence`, async t => {
    // Bulk selection now skips zero-punch absences; partial punches still enter
    // justification and must retain the holiday save/queue behavior.
    const { root, view, replies } = setup(t, mode === 'todos'), saves = [];
    view.on('attendance-irregularity-save', async command => { saves.push(command.id); return { ...command, presence: 'AUSENTE' }; });
    root.querySelector(mode === 'todos' ? '[data-action="attendance-select-all"]'
      : mode === 'individual' ? 'button[data-reply-id="pending_attendance_record:1"]' : 'input[data-reply-id="1"]').click();
    await submit(root);
    assert.deepEqual(saves, ['1']);
    assert.deepEqual(replies, [], 'a saved absence must not restart pending validation');
    assert.equal(root.querySelector('input[data-reply-id="1"]').checked, false);
    if (mode === 'todos') assert.match(root.querySelector('[data-attendance-irregularity-dialog]').textContent, /2 - PESSOA 2/);
    else assert.equal(root.querySelector('[data-attendance-irregularity-dialog]'), null);
  });
}

test('failed holiday submit retains the typed reason and does not select or continue the record', async t => {
  const { root, view, replies } = setup(t);
  view.on('attendance-irregularity-save', async () => { throw new Error('Versão alterada'); });
  root.querySelector('input[data-reply-id="1"]').click();
  await submit(root);
  assert.match(root.querySelector('[data-attendance-irregularity-dialog]').textContent, /Versão alterada/);
  assert.equal(root.querySelector('[data-role="attendance-irregularity-reason"]').value, 'FERIADO');
  assert.equal(root.querySelector('input[data-reply-id="1"]').checked, false);
  assert.deepEqual(replies, []);
});
