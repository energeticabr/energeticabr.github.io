import { validProvisionSettlementReviewTable, serverSelectedProvisionIds } from './provision-settlement-selection.js';

const latest = state => [...(state.messages || [])].reverse().find(message => message?.role !== 'user' && message?.type === 'poll');
const tableOf = state => { const poll = latest(state); return poll?.detail_table || poll?.detailTable; };
const identity = state => JSON.stringify([state.account?.homeAccountId ?? state.account?.localAccountId ?? state.account?.username,
  state.account?.tenantId, state.sessionRevision, state.scopeKey, state.activeFlow?.id,
  state.activeFlow?.instanceId, globalThis.location?.origin]);
const tokenValid = token => typeof token === 'string' && /^[a-f0-9]{32}$/i.test(token);
const initialPoll = poll => poll && [poll.databaseFilterKey, poll.stepKey, poll.step_key].includes('provisao_para_baixa');

/** Pins VM barrier, account and flow; no SharePoint write implementation belongs here. */
export function createProvisionSettlementParentSession({ getState, canInteract, sendText, createData, createEditor, onError = () => {} }) {
  let current = null, opening = false;
  function destroy() { const previous = current; current = null; previous?.editor?.destroy(); previous?.abort.abort(); }
  function sameOwner(session) {
    const state = getState();
    return current === session && !session.abort.signal.aborted && state.sessionStatus === 'authenticated'
      && state.account && identity(state) === session.identity && state.activeFlow?.id === 'payment_settlement';
  }
  function assertCurrent(session) {
    const table = tableOf(getState());
    if (!sameOwner(session) || !validProvisionSettlementReviewTable(table) || table.descriptionId !== session.parentId
      || table.parentEditPending !== true || table.parentEditorToken !== session.token) {
      throw new Error('A sessão ou o contexto de edição do descritivo foi encerrado.');
    }
  }
  function sync() {
    if (!current) return;
    if (!sameOwner(current)) { destroy(); return; }
    if (current.refreshing) {
      const table = tableOf(getState());
      if (table?.kind === 'provision_settlement_review' && (table.descriptionId !== current.parentId
        || (table.parentEditPending === true && table.parentEditorToken !== current.token))) destroy();
      return;
    }
    if (!current.token) return;
    try { assertCurrent(current); } catch { destroy(); }
  }
  async function refresh(session) {
    assertCurrent(session); if (!canInteract() || session.refreshing) return false;
    session.refreshing = true;
    let result;
    try {
      const sent = await sendText('', `description_review_parent_refresh:${session.parentId}:${session.token}`, {
        cancelSignal: session.abort.signal, isCurrent: () => sameOwner(session),
        onConfirmedResult: value => { result = value; },
      });
      if (!sent || !sameOwner(session)) return false;
      const state = getState(), table = tableOf(state), poll = latest(state), responsePoll = latest(result || {});
      // ChannelBridge wraps workflow receipts in results[]; transport success
      // alone, or a receipt for another parent, cannot release this barrier.
      const noPending = result?.status === 'processed' && Array.isArray(result.results)
        && result.results.some(record => record?.status === 'description_parent_refreshed'
          && record.descriptionNoPending === true && record.descriptionParentId === session.parentId)
        && initialPoll(poll) && initialPoll(responsePoll)
        && !table && !responsePoll.detail_table && !responsePoll.detailTable;
      const refreshed = validProvisionSettlementReviewTable(table) && table.descriptionId === session.parentId
        && table.parentEditPending === false;
      if (!refreshed && !noPending) return false;
      return true;
    } finally { session.refreshing = false; }
  }
  async function begin(replyId) {
    if (opening || !canInteract()) return false;
    const match = /^description_review_parent_begin:([1-9]\d*):((?:[1-9]\d*(?:,[1-9]\d*)*)?)$/.exec(replyId || '');
    const state = getState(), table = tableOf(state), poll = latest(state);
    if (!match || state.sessionStatus !== 'authenticated' || !state.account || state.activeFlow?.id !== 'payment_settlement'
      || !validProvisionSettlementReviewTable(table) || table.selectionEnabled !== true || table.descriptionId !== match[1]
      || !poll.options?.some(option => (option.reply || option.id) === 'description_review_edit_parent' && option.disabled !== true)) return false;
    const ids = match[2] ? match[2].split(',') : [], pending = new Set(table.rows.filter(row => !row.paid).map(row => row.id));
    if (new Set(ids).size !== ids.length || ids.some(id => !pending.has(id))) return false;
    if (table.parentEditPending === true && JSON.stringify(ids) !== JSON.stringify(serverSelectedProvisionIds(table))) return false;
    if (current) { try { assertCurrent(current); return true; } catch { destroy(); } }
    opening = true;
    const session = { parentId: match[1], identity: identity(state), abort: new AbortController() };
    current = session;
    try {
      const sent = await sendText('', replyId, { cancelSignal: session.abort.signal, isCurrent: () => sameOwner(session) });
      if (!sent || !sameOwner(session)) { if (current === session) destroy(); return false; }
      const barrier = tableOf(getState());
      session.token = barrier?.parentEditorToken;
      if (!tokenValid(session.token)) throw new Error('A VM não confirmou o token de edição do descritivo.');
      assertCurrent(session);
      if (JSON.stringify(serverSelectedProvisionIds(barrier)) !== JSON.stringify(ids)) throw new Error('A VM não confirmou a seleção desta edição.');
      const assertSession = () => {
        assertCurrent(session);
        if (!canInteract()) throw new Error('Aguarde a operação atual antes de editar o descritivo.');
      };
      const data = await createData({ assertSession }); assertSession();
      const editor = await createEditor({ data, parentId: session.parentId, token: session.token, assertSession,
        onRefresh: () => refresh(session) });
      try { assertSession(); } catch (error) { editor.destroy(); throw error; }
      session.editor = editor; return await editor.open();
    } catch (error) {
      if (sameOwner(session)) onError(error);
      if (current === session) destroy(); return false;
    } finally { opening = false; }
  }
  return { begin, sync, destroy, dismiss: () => current?.editor?.dismiss() };
}
