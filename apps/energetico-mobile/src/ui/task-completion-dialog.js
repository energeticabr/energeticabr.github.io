import { createLoadingIndicator } from './loading-indicator.js';
import { beginLoadingTask } from './loading-task.js';
import { postingCompletionMarkup } from './posting-completion.js';

const key = value => String(value || '').replace(/_x([0-9a-f]{4})_/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Two-field task edit, using the same verified metadata and ETag as the full editor. */
export function createTaskCompletionDialog({ document: doc, host, data, today, onChanged, onBlocked }) {
  let state = null, disposed = false, pending = false;
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const active = current => !disposed && current === state;
  function close() {
    const previous = state; state = null;
    previous?.abort.abort();
    clearTimeout(previous?.receiptTimer);
    previous?.finishReceipt?.();
    previous?.overlay.remove(); onBlocked(false);
    if (previous?.trigger?.isConnected) previous.trigger.focus({ preventScroll: true });
    else if (previous && host.isConnected && !host.hidden) host.focus({ preventScroll: true });
  }
  function error(current, failure) {
    if (!active(current)) return;
    current.error.textContent = String(failure?.message || 'Não foi possível salvar a conclusão. Tente novamente.')
      .replace(/https?:\/\/[^\s)]+/gi, 'endereço SharePoint').replace(/Bearer\s+[^\s]+/gi, 'Bearer [oculto]');
    current.error.hidden = false;
  }
  function editableColumn(context, aliases, controls) {
    const accepted = new Set(aliases.map(key));
    return context.columns?.find(column => column.editable && !column.hidden && !column.readOnly
      && controls.includes(column.control) && (accepted.has(key(column.name)) || accepted.has(key(column.label))));
  }
  async function showSuccess(current, row) {
    if (!active(current)) return;
    const [year, month, day] = current.attemptedDate.split('-');
    current.dialog.classList.add('tg-completion-dialog--success');
    current.dialog.setAttribute('aria-label', `Atividade concluída ${row.id}`);
    current.dialog.setAttribute('aria-busy', 'false');
    current.dialog.innerHTML = postingCompletionMarkup({
      kind: 'task-completion', title: 'ATIVIDADE CONCLUÍDA', database: 'LANCAMENTOTAREFAS',
      records: [
        { label: 'ATIVIDADE', value: `ID ${row.id}`, icon: 'launch' },
        { label: 'DATA CONCLUSÃO', value: `${day}/${month}/${year}`, icon: 'clock' },
      ],
    });
    const receipt = current.dialog.querySelector('.launch-completion');
    receipt.setAttribute('data-task-completion-success', '');
    receipt.setAttribute('role', 'status');
    receipt.setAttribute('aria-live', 'polite');
    receipt.setAttribute('aria-atomic', 'true');
    current.dialog.focus({ preventScroll: true });
    await new Promise(resolve => {
      current.finishReceipt = resolve;
      current.receiptTimer = setTimeout(resolve, 2000);
    });
    if (active(current)) close();
  }
  async function open(row, trigger) {
    if (disposed || pending) return;
    close();
    const overlay = el('div', 'gallery-record-overlay tg-completion-overlay');
    const dialog = el('section', 'gallery-record-dialog tg-completion-dialog');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', `Concluir tarefa ${row.id}`); dialog.tabIndex = -1;
    const message = el('p', 'gallery-record-dialog-error'); message.setAttribute('role', 'alert'); message.hidden = true;
    const body = el('div', 'gallery-record-dialog-body');
    const buttons = el('div', 'gallery-record-dialog-buttons');
    const cancel = el('button', 'gallery-record-dialog-button tg-completion-cancel', 'Cancelar');
    cancel.type = 'button'; cancel.setAttribute('data-task-completion-cancel', '');
    const header = el('header', 'gallery-editor-header');
    const back = el('button', 'gallery-editor-back', '←');
    back.type = 'button'; back.setAttribute('data-gallery-editor-back', '');
    back.setAttribute('aria-label', 'Voltar à galeria sem salvar');
    header.append(back, el('h2', 'gallery-record-dialog-title', `Concluir tarefa #${row.id}`));
    buttons.append(cancel);
    dialog.append(header, message, body);
    overlay.append(dialog); host.append(overlay);
    const current = { overlay, dialog, trigger, error: message, busy: false, persisted: false, abort: new AbortController() };
    state = current; onBlocked(true); dialog.focus({ preventScroll: true });
    const cancelEdit = () => { if (active(current) && !current.busy) close(); };
    cancel.addEventListener('click', cancelEdit);
    back.addEventListener('click', cancelEdit);
    overlay.addEventListener('click', event => {
      event.stopPropagation();
      if (event.target === overlay && active(current) && !current.busy) close();
    });
    overlay.addEventListener('keydown', event => {
      if (!['Escape', 'Tab', 'Enter'].includes(event.key)) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (!current.busy) close(); }
      if (event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled])')];
        const first = focusable[0], last = focusable.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (doc.activeElement === dialog || doc.activeElement === first || !dialog.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (doc.activeElement === dialog || doc.activeElement === last || !dialog.contains(doc.activeElement))) { event.preventDefault(); first.focus(); }
      }
    });
    const loader = createLoadingIndicator(doc, 'Carregando conclusão…'); body.append(loader);
    const task = beginLoadingTask(loader, { signal: current.abort.signal, isCurrent: () => active(current) });
    task.prepared();
    try {
      const context = await data.loadEditor(row.id, { refresh: true, includeAttachments: false,
        signal: current.abort.signal, onProgress: task.report });
      if (!active(current)) return;
      const dateColumn = editableColumn(context, ['DATA CONCLUSÃO', 'field_8'], ['date', 'datetime-local']);
      const completedColumn = editableColumn(context, ['CONCLUÍDO', 'field_12'], ['text', 'textarea', 'select']);
      if (!context.contract?.hasForm || context.contract.readOnly || context.contract.requiresVariantSelection
        || String(context.item?.id) !== String(row.id) || !dateColumn || !completedColumn) {
        throw new Error('Os metadados dos campos Data conclusão e Concluído não estão disponíveis para edição.');
      }
      task.acquired();
      const form = el('form', 'tg-completion-form'); form.setAttribute('data-task-completion-form', '');
      const date = el('input', 'og-input'); date.type = 'date'; date.name = 'completionDate'; date.value = today(); date.required = true;
      const completed = el('input', 'og-input'); completed.type = 'text'; completed.name = 'completed'; completed.value = 'CONCLUÍDA'; completed.readOnly = true;
      for (const [label, input] of [['Data conclusão', date], ['CONCLUÍDO', completed]]) {
        const wrapper = el('label', 'og-field'); wrapper.append(el('span', 'og-label', label), input); form.append(wrapper);
      }
      const submit = el('button', 'gallery-record-dialog-button tg-completion-submit', 'Submeter');
      submit.type = 'submit'; submit.setAttribute('data-task-completion-submit', '');
      buttons.append(submit); form.append(buttons); body.replaceChildren(form); date.focus({ preventScroll: true });
      async function reconcile() {
        const latest = await data.loadEditor(row.id, { refresh: true, includeAttachments: false });
        if (!active(current)) return;
        if (String(latest.item?.id) !== String(row.id)) throw new Error('Não foi possível verificar a conclusão desta tarefa.');
        const fields = latest.item.fields || {};
        if (String(fields[dateColumn.name] || '').slice(0, 10) === current.attemptedDate
          && key(fields[completedColumn.name]) === 'CONCLUIDA') {
          current.savedItem = latest.item;
          current.persisted = true; current.needsReconcile = false;
        } else if (latest.item.eTag === context.item.eTag) current.needsReconcile = false;
        else throw new Error('O registro mudou. Cancele e reabra a tarefa para conferir os dados antes de submeter.');
      }
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!active(current) || current.busy || pending) return;
        if (!current.persisted && !date.checkValidity()) {
          error(current, new Error('Informe uma data de conclusão válida.')); date.focus(); return;
        }
        pending = true; current.busy = true; message.hidden = true; dialog.setAttribute('aria-busy', 'true');
        const inputs = [date, completed, cancel, back, submit]; inputs.forEach(input => { input.disabled = true; });
        try {
          if (current.needsReconcile) await reconcile();
          if (!active(current)) return;
          if (!current.persisted) {
            current.attemptedDate = date.value;
            current.needsReconcile = true;
            const fields = { [dateColumn.name]: date.value, [completedColumn.name]: 'CONCLUÍDA' };
            const saved = await data.saveEditor(context, fields);
            current.savedItem = { ...context.item, ...saved, fields: { ...context.item.fields, ...fields, ...saved?.fields } };
            current.persisted = true; current.needsReconcile = false;
          }
          if (!active(current)) return;
          await onChanged(current.savedItem);
          await showSuccess(current, row);
        } catch (failure) {
          if (!active(current)) return;
          if (current.needsReconcile) {
            try {
              await reconcile();
              if (!active(current)) return;
              if (current.persisted) { await onChanged(current.savedItem); await showSuccess(current, row); return; }
            } catch (readFailure) { failure = readFailure; }
          }
          error(current, current.persisted ? new Error(`Conclusão salva, mas não foi possível atualizar a galeria. ${failure.message || ''}`) : failure);
          submit.textContent = current.persisted ? 'Tentar atualizar galeria' : current.needsReconcile ? 'Verificar conclusão' : 'Submeter';
        } finally {
          pending = false;
          if (active(current)) {
            current.busy = false; dialog.setAttribute('aria-busy', 'false');
            date.disabled = completed.disabled = Boolean(current.persisted || current.needsReconcile);
            cancel.disabled = back.disabled = submit.disabled = false;
          }
        }
      });
      task.complete();
    } catch (failure) { task.stop(); if (active(current)) { body.replaceChildren(); dialog.append(buttons); error(current, failure); cancel.focus(); } }
  }
  return Object.freeze({ open, close, destroy() { disposed = true; close(); } });
}
