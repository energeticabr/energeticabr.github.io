import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvisionSettlementParentSession } from '../src/ui/provision-settlement-parent-session.js';
import { reviewTable, reviewMessage, reviewState } from './helpers/provision-settlement-review-fixture.mjs';

const token = 'a'.repeat(32);
function harness(overrides = {}) {
  const poll = reviewMessage(reviewTable({ selectionEnabled: true }));
  poll.options.push({ id: 'description_review_edit_parent', value: 'edit_parent' });
  let state = reviewState(poll, { account: { homeAccountId: 'account-a' }, sessionRevision: 1 }), busy = false;
  let editorOptions, destroys = 0, loads = 0, failRefresh = false; const replies = [];
  const session = createProvisionSettlementParentSession({ getState: () => state, canInteract: () => !busy,
    sendText: async (_text, replyId, behavior) => {
      replies.push(replyId);
      const pending = replyId.includes('_begin:');
      state = { ...state, messages: [{ ...poll, detail_table: { ...poll.detail_table,
        selectedIds: ['11', '13'], parentEditPending: pending || failRefresh, parentEditorToken: token } }] };
      behavior?.onConfirmedResult?.({ status: 'description_parent_refreshed', messages: state.messages }); return true;
    },
    createData: async () => { loads++; return {}; },
    createEditor: async options => { editorOptions = options; return { open: async () => true, destroy: () => { destroys++; } }; }, ...overrides });
  return { session, replies, get state() { return state; }, set state(value) { state = value; },
    get editor() { return editorOptions; }, get destroys() { return destroys; }, get loads() { return loads; }, setBusy(value) { busy = value; }, failRefresh(value) { failRefresh = value; } };
}
test('begin awaits VM barrier before loading catalogs and refresh uses bound parent/token', async () => {
  const h = harness(); assert.equal(await h.session.begin('description_review_parent_begin:7:11,13'), true);
  assert.equal(h.loads, 1); assert.equal(h.editor.token, token);
  assert.equal(await h.editor.onRefresh(), true);
  assert.deepEqual(h.replies, ['description_review_parent_begin:7:11,13', `description_review_parent_refresh:7:${token}`]);
});
test('HTTP-success pending refresh is not confirmation; retry does not load or save editor again', async () => {
  const h = harness(); await h.session.begin('description_review_parent_begin:7:11,13');
  // This transport succeeds but the VM explicitly retains its barrier.
  h.failRefresh(true); assert.equal(await h.editor.onRefresh(), false);
  h.failRefresh(false); assert.equal(await h.editor.onRefresh(), true);
  assert.equal(h.loads, 1); assert.equal(h.replies.length, 3);
});
for (const change of ['account', 'session', 'flow', 'parent', 'token', 'scope', 'signout']) test(`stale ${change} disposes and cannot refresh a foreign context`, async () => {
  const h = harness(); await h.session.begin('description_review_parent_begin:7:11,13'); const editor = h.editor;
  const next = structuredClone(h.state);
  if (change === 'account') next.account.homeAccountId = 'account-b';
  if (change === 'session') next.sessionRevision++;
  if (change === 'flow') next.activeFlow.id = 'other';
  if (change === 'scope') next.scopeKey = 'other';
  if (change === 'signout') next.sessionStatus = 'signed-out';
  if (change === 'parent') next.messages[0].detail_table.descriptionId = '8';
  if (change === 'token') next.messages[0].detail_table.parentEditorToken = 'b'.repeat(32);
  h.state = next; h.session.sync(); assert.equal(h.destroys, 1);
  await assert.rejects(editor.onRefresh(), /sessão|contexto/i); assert.equal(h.replies.length, 1);
});
test('forged IDs, missing option, legacy/invalid table and busy state cannot begin', async () => {
  for (const reply of ['description_review_parent_begin:8:11', 'description_review_parent_begin:7:14', 'description_review_parent_begin:7:999',
    'description_review_parent_begin:7:11,11', 'description_review_parent_begin:7:01']) {
    const h = harness(); assert.equal(await h.session.begin(reply), false); assert.equal(h.loads, 0); assert.deepEqual(h.replies, []);
  }
  const h = harness(); h.setBusy(true); assert.equal(await h.session.begin('description_review_parent_begin:7:'), false);
  h.setBusy(false); h.state.messages[0].options.pop(); assert.equal(await h.session.begin('description_review_parent_begin:7:'), false);
});
test('pending replay cannot change server selection; concurrent begin opens once', async () => {
  const h = harness(); await Promise.all([h.session.begin('description_review_parent_begin:7:11,13'), h.session.begin('description_review_parent_begin:7:11,13')]);
  assert.equal(h.replies.length, 1); assert.equal(h.loads, 1);
  assert.equal(await h.session.begin('description_review_parent_begin:7:11'), false);
});
test('begin refuses unconfirmed barriers, malformed tokens and mismatched returned selection', async () => {
  for (const patch of [{ parentEditPending: false }, { parentEditorToken: 'invalid' }, { descriptionId: '8' }, { selectedIds: ['12'] }]) {
    const h = harness({ sendText: async () => {
      const next = structuredClone(h.state);
      Object.assign(next.messages[0].detail_table, { parentEditPending: true, parentEditorToken: token, selectedIds: ['11', '13'] }, patch);
      h.state = next; return true;
    } });
    assert.equal(await h.session.begin('description_review_parent_begin:7:11,13'), false, JSON.stringify(patch));
    assert.equal(h.loads, 0);
  }
});
test('busy while editing blocks any data callback before saving and keeps local barrier', async () => {
  const h = harness(); await h.session.begin('description_review_parent_begin:7:11,13'); h.setBusy(true);
  assert.throws(h.editor.assertSession, /aguarde|operação/i); assert.equal(await h.editor.onRefresh(), false);
  assert.equal(h.replies.length, 1);
});
function noPendingHarness(record, { step = 'provisao_para_baixa', poll = true, detailTable } = {}) {
  const h = harness({ sendText: async (_text, reply, behavior) => {
    const next = structuredClone(h.state);
    if (reply.includes('_begin:')) Object.assign(next.messages[0].detail_table, { parentEditPending: true, parentEditorToken: token, selectedIds: ['11', '13'] });
    else {
      next.activeFlow.stepKey = step;
      next.messages = poll ? [{ id: 'selection', role: 'assistant', type: 'poll', options: [],
        databaseFilterKey: step, question: 'Escolha outro pagamento', ...(detailTable ? { detail_table: detailTable } : {}) }] : [];
      behavior.onConfirmedResult({ status: 'processed', results: [record], messages: next.messages, activeFlow: next.activeFlow });
    }
    h.state = next; return true;
  } }); return h;
}
test('real ChannelBridge processed envelope confirms no-pending only for the bound parent and initial poll', async () => {
  const h = noPendingHarness({ status: 'description_parent_refreshed', descriptionNoPending: true, descriptionParentId: '7' });
  await h.session.begin('description_review_parent_begin:7:11,13'); assert.equal(await h.editor.onRefresh(), true);
});
for (const [record, context] of [
  [{ status: 'description_parent_refreshed', descriptionNoPending: true, descriptionParentId: '8' }, {}],
  [{ status: 'unrelated', descriptionNoPending: true, descriptionParentId: '7' }, {}],
  [{ status: 'description_parent_refreshed', descriptionNoPending: false, descriptionParentId: '7' }, {}],
  [{ status: 'description_parent_refreshed', descriptionNoPending: true }, {}],
  [{ status: 'description_parent_refreshed', descriptionNoPending: true, descriptionParentId: '7' }, { step: 'other' }],
  [{ status: 'description_parent_refreshed', descriptionNoPending: true, descriptionParentId: '7' }, { poll: false }],
  [{ status: 'description_parent_refreshed', descriptionNoPending: true, descriptionParentId: '7' }, { detailTable: { kind: 'foreign' } }],
]) test(`no-pending rejects unrelated result or poll ${JSON.stringify([record, context])}`, async () => {
  const h = noPendingHarness(record, context); await h.session.begin('description_review_parent_begin:7:11,13');
  assert.equal(await h.editor.onRefresh(), false);
});
test('mutable saved-input context fingerprint does not dispose the matching parent/token editor', async () => {
  const h = harness(); await h.session.begin('description_review_parent_begin:7:11,13');
  h.state = { ...h.state, activeFlow: { ...h.state.activeFlow, contextId: 'after-parent-edit' } };
  h.session.sync(); assert.equal(h.destroys, 0); assert.doesNotThrow(h.editor.assertSession);
});
test('a foreign parent or new token during in-flight refresh disposes immediately despite mutable-context allowance', async () => {
  for (const patch of [{ parentEditorToken: 'b'.repeat(32) }, { descriptionId: '8' }]) {
    let finish;
    const h = harness({ sendText: async (_text, reply) => {
      if (reply.includes('_begin:')) {
        Object.assign(h.state.messages[0].detail_table, { parentEditPending: true, parentEditorToken: token, selectedIds: ['11', '13'] }); return true;
      }
      return new Promise(resolve => { finish = resolve; });
    } });
    await h.session.begin('description_review_parent_begin:7:11,13');
    const refreshing = h.editor.onRefresh(); Object.assign(h.state.messages[0].detail_table, patch); h.session.sync();
    assert.equal(h.destroys, 1, JSON.stringify(patch)); finish(true); assert.equal(await refreshing, false);
  }
});
