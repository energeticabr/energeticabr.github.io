const text = value => typeof value === 'string' && value.trim();
const id = value => typeof value === 'string' && /^[1-9]\d*$/.test(value);
const cents = value => typeof value === 'string' && /^(0|[1-9]\d*)$/.test(value);

export function validProvisionSettlementReviewTable(table) {
  return Boolean(table?.kind === 'provision_settlement_review' && id(table.descriptionId)
    && text(table.totalDisplay) && Array.isArray(table.rows) && table.rows.length
    && typeof table.canSubmit === 'boolean' && typeof table.hasPaidRows === 'boolean'
    && (!table.hasPaidRows || text(table.pendingTotalDisplay))
    && (table.notice == null || typeof table.notice === 'string')
    && (table.selectionEnabled == null || typeof table.selectionEnabled === 'boolean')
    && (table.selectedValid == null || typeof table.selectedValid === 'boolean')
    && (table.selectedIds == null || (Array.isArray(table.selectedIds) && table.selectedIds.every(id)))
    && table.rows.every(row => row && id(row.id) && Number.isSafeInteger(row.index) && row.index > 0
      && ['product', 'quantityDisplay', 'unitPriceDisplay', 'totalDisplay'].every(key => text(row[key]))
      && typeof row.paid === 'boolean' && (row.selected == null || typeof row.selected === 'boolean')
      && (row.canSubmit == null || typeof row.canSubmit === 'boolean')
      && (row.freightDisplay == null || typeof row.freightDisplay === 'string'))
    && new Set(table.rows.map(row => row.id)).size === table.rows.length);
}

export function serverSelectedProvisionIds(table) {
  const pending = table.rows.filter(row => !row.paid);
  const explicit = Array.isArray(table.selectedIds) ? new Set(table.selectedIds) : null;
  const rowSelection = pending.some(row => typeof row.selected === 'boolean');
  return pending.filter(row => explicit ? explicit.has(row.id) : rowSelection ? row.selected === true : true).map(row => row.id);
}

export function provisionSelectionSummary(table, selectedIds) {
  const selected = new Set(selectedIds);
  const pending = table.rows.filter(row => !row.paid), rows = pending.filter(row => selected.has(row.id));
  let summary = `Selecionadas: ${rows.length} de ${pending.length}`;
  // These cents come from the server. Never infer amounts from display text,
  // quantity, unit price or freight, and never round with floating point.
  if (rows.length && rows.every(row => cents(row.totalCents))) {
    const cents = rows.reduce((sum, row) => sum + BigInt(row.totalCents), 0n);
    summary += ` · Subtotal selecionado: R$ ${(cents / 100n).toLocaleString('pt-BR')},${String(cents % 100n).padStart(2, '0')}`;
  }
  return summary;
}

function hasValidityProjection(table) {
  return table.rows.some(row => typeof row.canSubmit === 'boolean');
}

export function provisionSelectionCanSubmit(table, selectedIds) {
  if (table.parentEditPending === true) return false;
  if (!selectedIds.length) return false;
  const selected = new Set(selectedIds), rows = table.rows.filter(row => !row.paid && selected.has(row.id));
  if (rows.length !== selected.size) return false;
  if (table.rows.some(row => typeof row.canSubmit === 'boolean')) return rows.every(row => row.canSubmit === true);
  // selectedValid is a server snapshot; cents are only for the informational
  // subtotal. Neither can authorize a subset without explicit row validity.
  return table.canSubmit; // Legacy tables retain the global server gate.
}

/** Local checkbox state only. The existing select-reply route submits IDs. */
export function createProvisionSettlementSelection(root, emit) {
  let table = null, card = null, revision = '', selected = new Set(), busy = true, options = [];
  const eligible = () => table ? table.rows.filter(row => !row.paid).map(row => row.id) : [];
  const selectedIds = () => eligible().filter(rowId => selected.has(rowId));
  function refresh() {
    if (!card || !table) return;
    const ids = eligible(), chosen = selectedIds();
    for (const checkbox of card.querySelectorAll('[data-provision-select-id]')) {
      const rowId = checkbox.dataset.provisionSelectId;
      checkbox.checked = chosen.includes(rowId);
      checkbox.disabled = busy || table.parentEditPending === true || !ids.includes(rowId);
    }
    const all = card.querySelector('[data-provision-select-all]');
    if (all) {
      all.checked = ids.length > 0 && chosen.length === ids.length;
      all.indeterminate = chosen.length > 0 && chosen.length < ids.length;
      all.disabled = busy || table.parentEditPending === true || !ids.length;
    }
    const summary = card.querySelector('[data-provision-selection-summary]');
    if (summary) summary.textContent = provisionSelectionSummary(table, chosen);
    for (const button of card.closest('.chat-choice-card')?.querySelectorAll('[data-action="select-reply"]') || []) {
      const command = button.dataset.replyId?.split(':')[0];
      if (command === 'description_review_edit_parent') {
        button.disabled = busy || !options.some(option => String(option.reply || option.id || '') === command && option.disabled !== true);
        continue;
      }
      if (!['description_review_submit', 'description_review_edit'].includes(command)) continue;
      const option = options.find(option => String(option.reply || option.id || '').split(':')[0] === command);
      const submit = command === 'description_review_submit';
      const optionDisabled = option?.disabled === true && !(submit && hasValidityProjection(table));
      button.disabled = busy || table.parentEditPending === true || !chosen.length || optionDisabled || (submit && !provisionSelectionCanSubmit(table, chosen));
    }
  }
  function sync(state, interactionBusy = true) {
    const poll = [...(state.messages || [])].reverse().find(message => message?.role !== 'user' && message?.type === 'poll');
    const candidate = poll?.detail_table || poll?.detailTable;
    table = state.sessionStatus === 'authenticated' && state.activeFlow?.id === 'payment_settlement'
      && validProvisionSettlementReviewTable(candidate) && candidate.selectionEnabled === true ? candidate : null;
    const account = state.account || {}, flow = state.activeFlow || {};
    const nextRevision = table ? JSON.stringify([
      state.sessionStatus, account.homeAccountId ?? account.localAccountId ?? account.username ?? account.id ?? account.name,
      account.tenantId, state.scopeKey, state.sessionRevision, flow.id, flow.contextId, flow.instanceId,
      poll.id, table,
    ]) : '';
    if (!table || nextRevision !== revision) selected = new Set(table ? serverSelectedProvisionIds(table) : []);
    revision = nextRevision;
    busy = interactionBusy !== false;
    options = Array.isArray(poll?.options) ? poll.options : [];
    card = table ? [...root.querySelectorAll('[data-provision-selection-active="true"]')]
      .find(node => node.dataset.descriptionId === table.descriptionId) : null;
    refresh();
  }
  function change(event) {
    const checkbox = event.target;
    if (!checkbox?.matches?.('[data-provision-select-id], [data-provision-select-all]')) return false;
    if (!card?.contains(checkbox) || checkbox.disabled || busy || table.parentEditPending === true) return true;
    const ids = eligible();
    if (checkbox.hasAttribute('data-provision-select-all')) selected = new Set(checkbox.checked ? ids : []);
    else if (ids.includes(checkbox.dataset.provisionSelectId)) {
      if (checkbox.checked) selected.add(checkbox.dataset.provisionSelectId);
      else selected.delete(checkbox.dataset.provisionSelectId);
    }
    refresh();
    return true;
  }
  function handleReply(command, target) {
    if (command.type === 'select-reply' && command.replyId === 'description_review_edit_parent') {
      const source = target?.closest('.chat-choice-card')?.querySelector('[data-provision-selection-active="true"]');
      if (table && source === card && !busy && !target.disabled
        && options.some(option => String(option.reply || option.id || '') === command.replyId && option.disabled !== true)) {
        emit({ ...command, replyId: `description_review_parent_begin:${table.descriptionId}:${selectedIds().join(',')}` });
      }
      return true;
    }
    if (command.type !== 'select-reply' || !/^description_review_(submit|edit)(?::.*)?$/.test(command.replyId || '')) return false;
    const source = target?.closest('.chat-choice-card')?.querySelector('[data-provision-selection-enabled="true"]');
    if (!source) return false; // Preserve plain legacy tables and commands.
    const base = command.replyId.split(':')[0], ids = selectedIds();
    if (source === card && !busy && table.parentEditPending !== true && !target.disabled && ids.length && (base !== 'description_review_submit' || provisionSelectionCanSubmit(table, ids))) {
      emit({ ...command, replyId: `${base}:${ids.join(',')}` });
    }
    return true;
  }
  return { sync, change, handleReply };
}
