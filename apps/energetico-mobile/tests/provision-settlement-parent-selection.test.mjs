import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';
import { provisionSelectionCanSubmit } from '../src/ui/provision-settlement-selection.js';
import { reviewTable, reviewMessage, reviewState } from './helpers/provision-settlement-review-fixture.mjs';

function harness(t, extra = {}, stateExtra = {}) {
  const dom = new JSDOM('<main id="app"></main>'), root = dom.window.document.querySelector('main');
  const view = createChatView(root), events = [];
  view.on('select-reply', event => events.push(event));
  const table = reviewTable({ selectionEnabled: true, ...extra }), poll = reviewMessage(table);
  poll.options.push({ id: 'description_review_edit_parent', value: 'edit_parent', label: 'EDITAR O DESCRITIVO PROVISÃO' });
  const state = reviewState(poll, stateExtra); view.render(state);
  t.after(() => { view.destroy(); dom.window.close(); });
  return { root, view, state, events, parent: () => root.querySelector('[data-reply-id="description_review_edit_parent"]') };
}
test('parent begin carries current parent and local checkbox IDs, including empty selection', t => {
  const h = harness(t);
  h.root.querySelector('[data-provision-select-id="12"]').click(); h.parent().click();
  assert.deepEqual(h.events.map(e => e.replyId), ['description_review_parent_begin:7:11,13']);
  h.root.querySelector('[data-provision-select-all]').click();
  h.root.querySelector('[data-provision-select-all]').click();
  h.parent().click(); assert.equal(h.events.at(-1).replyId, 'description_review_parent_begin:7:');
});
test('pending parent barrier overrides row validity and locks selection/line actions while allowing resume', t => {
  const table = { parentEditPending: true, parentEditorToken: 'a'.repeat(32), canSubmit: true,
    rows: reviewTable().rows.map(row => ({ ...row, canSubmit: true })) };
  assert.equal(provisionSelectionCanSubmit(reviewTable(table), ['11']), false);
  const h = harness(t, table);
  assert.ok([...h.root.querySelectorAll('[data-provision-select-id], [data-provision-select-all]')].every(n => n.disabled));
  for (const id of ['description_review_submit', 'description_review_edit']) {
    const button = h.root.querySelector(`[data-reply-id="${id}"]`); assert.equal(button.disabled, true);
    button.disabled = false; button.click();
  }
  assert.deepEqual(h.events, []);
  assert.equal(h.parent().disabled, false); h.parent().click();
  assert.equal(h.events[0].replyId, 'description_review_parent_begin:7:11,12,13');
});
for (const extra of [{ activeText: { id: 'busy' } }, { recoveryBlocked: true }, { recoveryUncertain: true },
  { attachmentUploadProgress: { percent: 5 } }, { pendingFiles: [{ status: 'sending' }] },
  { sessionStatus: 'signed-out' }, { activeFlow: { id: 'other' } }]) {
  test(`parent begin rejects busy/foreign session ${JSON.stringify(extra)}`, t => {
    const h = harness(t, {}, extra); const button = h.parent();
    if (button) { button.disabled = false; button.click(); }
    assert.deepEqual(h.events, []);
  });
}
