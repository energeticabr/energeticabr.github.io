import { createLoadingIndicator } from './loading-indicator.js';

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
    previous?.overlay.remove(); onBlocked(false);
    if (previous?.trigger?.isConnected) previous.trigger.focus();
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
    buttons.append(cancel);
    dialog.append(el('h2', 'gallery-record-dialog-title', `Concluir tarefa #${row.id}`), message, body, buttons);
    overlay.append(dialog); host.append(overlay);
    const current = { overlay, dialog, trigger, error: message, busy: false, persisted: false };
    state = current; onBlocked(true); dialog.focus();
    cancel.addEventListener('click', () => { if (active(current) && !current.busy) close(); });
    overlay.addEventListener('click', event => event.stopPropagation());
    overlay.addEventListener('keydown', event => {
      if (!['Escape', 'Tab', 'Enter'].includes(event.key)) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); if (!current.busy) close(); }
      if (event.key === 'Tab') {
        const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled])')];
        const first = focusable[0], last = focusable.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) { event.preventDefault(); first.focus(); }
      }
    });
    body.append(createLoadingIndicator(doc, 'Carregando conclusão…'));
    try {
      const context = await data.loadEditor(row.id, { refresh: true });
      if (!active(current)) return;
      const dateColumn = editableColumn(context, ['DATA CONCLUSÃO', 'field_8'], ['date', 'datetime-local']);
      const completedColumn = editableColumn(context, ['CONCLUÍDO', 'field_12'], ['text', 'textarea', 'select']);
      if (!context.contract?.hasForm || context.contract.readOnly || context.contract.requiresVariantSelection
        || String(context.item?.id) !== String(row.id) || !dateColumn || !completedColumn) {
        throw new Error('Os metadados dos campos Data conclusão e Concluído não estão disponíveis para edição.');
      }
      const form = el('form', 'tg-completion-form'); form.setAttribute('data-task-completion-form', '');
      const date = el('input', 'og-input'); date.type = 'date'; date.name = 'completionDate'; date.value = today(); date.required = true;
      const completed = el('input', 'og-input'); completed.type = 'text'; completed.name = 'completed'; completed.value = 'CONCLUÍDA'; completed.readOnly = true;
      for (const [label, input] of [['Data conclusão', date], ['CONCLUÍDO', completed]]) {
        const wrapper = el('label', 'og-field'); wrapper.append(el('span', 'og-label', label), input); form.append(wrapper);
      }
      const submit = el('button', 'gallery-record-dialog-button tg-completion-submit', 'Submeter');
      submit.type = 'submit'; submit.setAttribute('data-task-completion-submit', '');
      buttons.append(submit); form.append(buttons); body.replaceChildren(form); date.focus();
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!active(current) || current.busy || pending) return;
        if (!current.persisted && !date.checkValidity()) {
          error(current, new Error('Informe uma data de conclusão válida.')); date.focus(); return;
        }
        pending = true; current.busy = true; message.hidden = true; dialog.setAttribute('aria-busy', 'true');
        const inputs = [date, completed, cancel, submit]; inputs.forEach(input => { input.disabled = true; });
        try {
          if (!current.persisted) {
            await data.saveEditor(context, { [dateColumn.name]: date.value, [completedColumn.name]: 'CONCLUÍDA' });
            current.persisted = true;
          }
          if (!active(current)) return;
          await onChanged();
          if (active(current)) close();
        } catch (failure) {
          error(current, current.persisted ? new Error(`Conclusão salva, mas não foi possível atualizar a galeria. ${failure.message || ''}`) : failure);
          if (current.persisted) submit.textContent = 'Tentar atualizar galeria';
        } finally {
          pending = false;
          if (active(current)) {
            current.busy = false; dialog.setAttribute('aria-busy', 'false');
            date.disabled = completed.disabled = current.persisted;
            cancel.disabled = submit.disabled = false;
          }
        }
      });
    } catch (failure) { if (active(current)) { body.replaceChildren(); error(current, failure); cancel.focus(); } }
  }
  return Object.freeze({ open, close, destroy() { disposed = true; close(); } });
}
