import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { reviewTable, reviewMessage, reviewState } from './helpers/provision-settlement-review-fixture.mjs';
import { JSDOM } from 'jsdom';
import { createProvisionSettlementParentEditor } from '../src/ui/provision-settlement-parent-editor.js';
import { parentEditorFixture } from './helpers/provision-parent-editor-fixture.mjs';

async function harness(t, factories = {}) {
  let sequence = 0, editor, destroyed = 0, failRefresh = false, noPending = false, loads = 0;
  const replies = [], handlers = new Map(), store = createConversationStore({ randomUUID: () => `fake-${++sequence}` });
  const poll = pending => { const message = reviewMessage(reviewTable({ selectionEnabled: true, selectedIds: ['11', '13'],
    parentEditPending: pending, ...(pending ? { parentEditorToken: 'a'.repeat(32) } : {}) }));
    message.options.push({ id: 'description_review_edit_parent', reply: 'description_review_edit_parent', label: 'EDITAR O DESCRITIVO PROVISÃO' }); return message; };
  const flow = reviewState().activeFlow;
  const client = { async sendText(request) {
    replies.push(request.replyId); const begin = request.replyId.includes('_begin:');
    if (!begin && noPending) return { status: 'processed',
      results: [{ status: 'description_parent_refreshed', descriptionNoPending: true, descriptionParentId: '7' }],
      activeFlow: { id: flow.id, title: flow.title, contextId: 'refreshed-input-fingerprint' },
      messages: [{ id: 'select-again', role: 'assistant', type: 'poll', databaseFilterKey: 'provisao_para_baixa', question: 'Selecione outro descritivo', options: [] }] };
    return { status: begin ? 'description_parent_edit_pending' : failRefresh ? 'description_parent_refresh_failed' : 'description_parent_refreshed',
      activeFlow: begin || failRefresh ? flow : { ...flow, contextId: 'refreshed-input-fingerprint' }, messages: [poll(begin || failRefresh)] };
  } };
  let rendered;
  const view = { render(value) { rendered = value; }, on(type, handler) { handlers.set(type, handler); return () => handlers.delete(type); },
    emit(type, value) { return handlers.get(type)?.({ type, ...value }); }, focusComposer() {}, destroy() {} };
  const controller = createAppController({ store, view, client,
    auth: { initialize: async () => ({ homeAccountId: 'fake-account', username: 'fake@example.invalid' }), getToken: async () => 'fake', signOut: async () => {} },
    native: { importSharedItems: async () => [] }, diaryFieldVisitDataFactory: async () => ({ load: async () => [] }),
    registrationGalleryDataFactory: async options => { assert.equal(options.kind, 'provisionDescription'); options.assertSession(); loads++; return {}; },
    provisionSettlementParentEditorFactory: async options => { editor = options; return { open: async () => true, destroy() { destroyed++; } }; },
    ...factories,
  });
  t.after(() => controller.stop()); await controller.start(); replies.length = 0; store.restoreSnapshot({ messages: [poll(false)], activeFlow: flow });
  return { store, view, controller, replies, get rendered() { return rendered; }, get editor() { return editor; }, get loads() { return loads; }, get destroyed() { return destroyed; },
    failRefresh(value) { failRefresh = value; }, noPending(value) { noPending = value; } };
}
test('real controller intercepts begin, waits for VM pending token, uses existing data factory and confirms refresh table', async t => {
  const h = await harness(t); assert.equal(await h.view.emit('select-reply', { replyId: 'description_review_parent_begin:7:11,13' }), true, JSON.stringify({ replies: h.replies, state: h.rendered }));
  assert.ok(h.editor, 'controller opened parent editor'); assert.equal(h.loads, 1); assert.equal(h.editor.token, 'a'.repeat(32));
  h.failRefresh(true); assert.equal(await h.editor.onRefresh(), false, 'HTTP normal failure must retain guard');
  h.failRefresh(false); assert.equal(await h.editor.onRefresh(), true);
  assert.deepEqual(h.replies, ['description_review_parent_begin:7:11,13', `description_review_parent_refresh:7:${'a'.repeat(32)}`, `description_review_parent_refresh:7:${'a'.repeat(32)}`]);
  assert.equal(h.loads, 1);
});
test('real controller plus actual editor closes only after authoritative barrier clears, never saves twice', async t => {
  const dom = new JSDOM('<main></main>'), f = parentEditorFixture(); t.after(() => dom.window.close());
  const h = await harness(t, { registrationGalleryDataFactory: async () => f.data,
    provisionSettlementParentEditorFactory: options => createProvisionSettlementParentEditor({ ...options, document: dom.window.document }) });
  await h.view.emit('select-reply', { replyId: 'description_review_parent_begin:7:11,13' });
  const document = dom.window.document; document.querySelector('[data-provision-parent-column="OBS"]').click();
  document.querySelector('[name="OBS"]').value = 'nova';
  document.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
  for (let i = 0; i < 80 && document.querySelector('[data-provision-parent-dialog]'); i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.querySelector('[data-provision-parent-dialog]'), null, document.body.textContent);
  assert.equal(h.store.getState().messages.at(-1).detail_table.parentEditPending, false);
  assert.equal(f.writes.length, 3);
});
test('explicit authoritative no-pending result permits leaving without guessing from transport success', async t => {
  const h = await harness(t); await h.view.emit('select-reply', { replyId: 'description_review_parent_begin:7:11,13' });
  assert.ok(h.editor); h.noPending(true); assert.equal(await h.editor.onRefresh(), true, JSON.stringify(h.rendered));
});
test('controller stops/disposes parent editor when active flow changes and never refreshes another flow', async t => {
  const h = await harness(t); await h.view.emit('select-reply', { replyId: 'description_review_parent_begin:7:11,13' });
  assert.ok(h.editor); const editor = h.editor;
  h.store.restoreSnapshot({ messages: [], activeFlow: { id: 'other' } }); assert.equal(h.destroyed, 1);
  await assert.rejects(editor.onRefresh(), /sessão|contexto/i); assert.equal(h.replies.length, 1);
});
