import { renderDynamicForm } from '../../../../portal/ui/dynamic-form.js';

let sequence = 0;
const editable = column => column?.editable === true && !column.readOnly && !column.hidden && !column.disabled;

/** Owns only the local editor. All persistence and child fanout stay in the data factory. */
export function createProvisionSettlementParentEditor({ document = globalThis.document, host = document?.body,
  data, parentId, token, assertSession = () => {}, onRefresh } = {}) {
  let disposed = false, busy = false, context, form, overlay, dialog, body, error, back, intent;
  const lifetime = new AbortController(), focus = document?.activeElement;
  const active = () => { if (disposed || lifetime.signal.aborted) throw new DOMException('Edição encerrada.', 'AbortError'); assertSession(); };
  const node = (tag, text, attr) => {
    const element = document.createElement(tag); if (text !== undefined) element.textContent = text;
    if (attr) element.setAttribute(attr, ''); return element;
  };
  function button(text, attribute, handler) {
    const result = node('button', text, attribute); result.type = 'button';
    result.addEventListener('click', () => { if (!busy && !disposed) void handler(); }); return result;
  }
  function clear() { form?.cleanup(); form = null; body.replaceChildren(); }
  function showError(reason) { error.textContent = reason?.message || 'Não foi possível concluir. Tente novamente.'; error.hidden = false; }
  function destroy() {
    if (disposed) return; disposed = true; lifetime.abort(); form?.cleanup(); overlay?.remove();
    if (focus?.isConnected && !focus.disabled) focus.focus({ preventScroll: true });
  }
  function lock(value) {
    busy = value; dialog.setAttribute('aria-busy', String(value));
    dialog.querySelectorAll('button, input, select, textarea').forEach(control => { control.disabled = value; });
  }
  async function refresh() {
    if (busy || disposed) return false;
    try {
      active(); lock(true); clear(); error.hidden = true;
      body.append(node('p', 'Atualizando as provisões…'));
      const confirmed = await onRefresh?.({ parentId, token, signal: lifetime.signal });
      // The coordinator has checked the owner and the authoritative result.
      // A confirmed refresh intentionally removes the pending-edit barrier.
      if (disposed || lifetime.signal.aborted) return false;
      if (confirmed !== true) throw new Error('A atualização ainda não foi confirmada. Atualize antes de voltar.');
      destroy(); return true;
    } catch (reason) {
      if (!disposed) {
        clear(); showError(reason);
        body.append(node('p', 'A edição permanece bloqueada até confirmar a atualização das provisões.'),
          button('Tentar atualizar provisões', 'data-provision-parent-refresh-retry', refresh));
        if (intent) body.append(button('Tentar concluir a edição', 'data-provision-parent-save-retry', save));
      }
      return false;
    } finally { if (!disposed) lock(false); }
  }
  async function save() {
    if (busy || disposed || !intent) return;
    try {
      active(); lock(true); clear(); error.hidden = true; body.append(node('p', 'Salvando e conferindo as provisões vinculadas…'));
      await data.saveEditor(context, intent.fields, { editedFields: [intent.name], signal: lifetime.signal });
      // Once persisted, there is never a route back to save, even if refresh fails.
      intent = null;
      if (disposed || lifetime.signal.aborted) return;
      lock(false); await refresh();
    } catch (reason) {
      if (!disposed) {
        clear(); showError(reason);
        body.append(node('p', 'Os dados podem ter sido gravados parcialmente. Mantenha a mesma edição para concluir a sincronização.'),
          button('Tentar concluir a edição', 'data-provision-parent-save-retry', save),
          button('Atualizar provisões e voltar', 'data-provision-parent-cancel', refresh));
      }
    } finally { if (!disposed) lock(false); }
  }
  function choose(column) {
    try {
      active(); if (busy || intent) return; clear(); error.hidden = true;
      const values = { ...context.item.fields };
      if (values[column.name] != null && ['date', 'datetime-local'].includes(column.control)) {
        values[column.name] = String(values[column.name]).slice(0, column.control === 'date' ? 10 : 16);
      }
      form = renderDynamicForm(body, {
        entity: context.entity, columns: [column], mode: 'edit', values,
        defaultContext: { record: context.item.fields }, relationshipSearch: context.relationshipSearch,
        powerAppsOptionSearch: context.powerAppsOptionSearch, attachments: { enabled: false },
        onCancel: refresh,
        onSubmit: async fields => {
          try {
            active(); if (busy || intent) return;
            const name = ['lookup', 'person'].includes(column.control) ? `${column.name}LookupId` : column.name;
            if (!Object.hasOwn(fields, name)) throw new Error('Informe o campo escolhido.');
            intent = { name, fields: { [name]: fields[name] } }; await save();
          } catch (reason) { if (!disposed) showError(reason); }
        },
      });
      [...body.querySelectorAll('input,select,textarea,button')]
        .find(control => !control.disabled && !control.closest('[hidden]'))?.focus();
    } catch (reason) { if (!disposed) showError(reason); }
  }
  async function open() {
    if (disposed || overlay) return false;
    active();
    overlay = node('div', undefined, 'data-provision-parent-overlay'); overlay.className = 'provision-parent-overlay';
    dialog = node('section', undefined, 'data-provision-parent-dialog'); dialog.className = 'gallery-record-dialog provision-parent-dialog';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.tabIndex = -1;
    const heading = node('h2', 'EDITAR O DESCRITIVO PROVISÃO'); heading.id = `provision-parent-heading-${++sequence}`;
    dialog.setAttribute('aria-labelledby', heading.id);
    back = button('Voltar às provisões', 'data-provision-parent-back', refresh);
    error = node('p', '', 'data-provision-parent-error'); error.setAttribute('role', 'alert'); error.hidden = true;
    body = node('div', undefined, 'data-provision-parent-body');
    dialog.append(heading, node('p', `Descritivo #${parentId} — escolha a coluna que deseja editar.`), error, body, back);
    overlay.append(dialog); host.append(overlay); dialog.focus();
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!busy) void refresh(); }
      if (event.key === 'Tab') {
        const controls = [...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')]
          .filter(control => !control.closest('[hidden]'));
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    });
    try {
      lock(true); body.append(node('p', 'Carregando colunas e opções…'));
      context = await data.loadEditor(parentId, { signal: lifetime.signal, includeAttachments: false }); active();
      if (String(context?.item?.id) !== parentId || !context?.contract?.hasForm || context.contract.readOnly
        || !context.columns?.some(editable)) throw new Error('Os metadados de edição deste descritivo não foram comprovados.');
      clear(); const choices = node('div'); choices.className = 'provision-parent-columns';
      for (const column of context.columns.filter(editable)) {
        const control = button(column.label || column.name, 'data-provision-parent-column', () => choose(column));
        control.dataset.provisionParentColumn = column.name; choices.append(control);
      }
      body.append(choices); return true;
    } catch (reason) {
      if (!disposed) { clear(); showError(reason); body.append(button('Tentar atualizar provisões', 'data-provision-parent-refresh-retry', refresh)); }
      return false;
    } finally { if (!disposed) lock(false); }
  }
  return { open, destroy, dismiss: refresh };
}
