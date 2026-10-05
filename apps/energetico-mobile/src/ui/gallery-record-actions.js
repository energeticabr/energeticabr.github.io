import { createLoadingIndicator } from "./loading-indicator.js";
import { bindForm43FieldLocks } from './orders-form43-locks-view.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';
import { bindPayrollEditorSource } from './payroll-editor-source.js';
let dialogSequence = 0;

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** Shared actions for gallery records; persistence remains owned by the gallery data layer. */
export function createGalleryRecordActions({ document, host, loadEditor, saveEditor, deleteItem, onChanged, onError, onEdit, renderEditorExtra,
  actions = ["edit", "delete"] } = {}) {
  if (!document?.createElement) throw new TypeError("As ações do registro requerem um documento.");
  let disposed = false;
  let epoch = 0;
  let session = null;
  let mutationPending = false;
  const recordButtons = new Set();
  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const active = state => !disposed && state === session && state.epoch === epoch;
  const focusable = state => [...state.dialog.querySelectorAll(FOCUSABLE)].filter(node => !node.closest('[hidden]'));

  async function report(error) {
    try { await onError?.(error); } catch { /* A notification failure must not reject a DOM event handler. */ }
  }

  function syncRecordButtons() {
    for (const button of recordButtons) {
      if (!button.isConnected) recordButtons.delete(button);
      else button.disabled = disposed || mutationPending;
    }
  }

  function close() {
    epoch++;
    const previous = session;
    session = null;
    previous?.controller?.cleanup?.();
    previous?.fieldLocks?.cleanup?.();
    previous?.sourceBinding?.cleanup?.();
    previous?.variantPicker?.destroy();
    previous?.overlay.remove();
    if (previous?.focus?.isConnected) previous.focus.focus();
  }

  function showError(state, error) {
    if (!active(state)) return;
    state.error.textContent = error?.message || "Não foi possível concluir a operação. Tente novamente.";
    state.error.hidden = false;
    void report(error);
  }

  function button(text, attribute, value, handler) {
    const node = element("button", "gallery-record-dialog-button", text);
    node.type = "button";
    node.setAttribute(attribute, value);
    node.addEventListener("click", event => { event.stopPropagation(); handler(); });
    return node;
  }

  function openDialog(row, operation, trigger) {
    close();
    const overlay = element("div", "gallery-record-overlay");
    const dialog = element("section", `gallery-record-dialog gallery-record-dialog--${operation}`);
    const heading = element("h2", "gallery-record-dialog-title", operation === "delete"
      ? `Tem certeza que deseja deletar o item de ID ${row.id}?`
      : `Editar item de ID ${row.id}`);
    heading.id = `gallery-record-dialog-title-${++dialogSequence}`;
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-labelledby", heading.id);
    dialog.setAttribute("data-gallery-record-dialog", "");
    if (operation === 'edit') {
      overlay.classList.add('gallery-record-overlay--screen');
      dialog.classList.add('gallery-record-screen');
      dialog.setAttribute('data-gallery-record-screen', '');
      dialog.setAttribute('role', 'region');
      dialog.removeAttribute('aria-modal');
    }
    dialog.tabIndex = -1;
    const error = element("p", "gallery-record-dialog-error");
    error.setAttribute("role", "alert");
    error.hidden = true;
    const body = element("div", "gallery-record-dialog-body");
    dialog.append(heading, error, body);
    if (operation === 'edit') {
      const extra = renderEditorExtra?.(row);
      if (extra) dialog.append(extra);
    }
    overlay.append(dialog);
    (host || document.body).append(overlay);
    const state = { epoch, row, operation, overlay, dialog, error, body, focus: trigger || document.activeElement, busy: false, controller: null, loadEpoch: 0 };
    session = state;
    overlay.addEventListener("click", event => event.stopPropagation());
    overlay.addEventListener("keydown", event => {
      if (!["Escape", "Tab", "Enter"].includes(event.key)) return;
      event.stopPropagation();
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!state.busy) close();
      } else if (event.key === "Tab") {
        const controls = focusable(state);
        const first = controls[0], last = controls.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); }
        else if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    });
    dialog.focus();
    return state;
  }

  async function mutate(state, persist) {
    if (!active(state) || state.busy || mutationPending) return;
    mutationPending = true;
    state.busy = true;
    state.error.hidden = true;
    state.dialog.setAttribute("aria-busy", "true");
    const controls = [...state.dialog.querySelectorAll("button, input, select, textarea")];
    const disabled = controls.map(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    syncRecordButtons();
    try {
      if (!state.persisted) {
        state.persistedItem = await persist();
        state.persisted = true;
      }
      if (!active(state)) return;
      await onChanged?.({ operation: state.operation, id: state.row.id, item: state.persistedItem });
      if (active(state)) close();
    } catch (error) {
      if (active(state) && state.persisted) {
        showError(state, new Error(`A operação foi concluída, mas não foi possível atualizar a galeria. ${error?.message || "Tente novamente."}`));
        if (!state.refreshRetry) {
          state.refreshRetry = button("Tentar atualizar galeria", "data-gallery-refresh-retry", "", () => { void mutate(state, persist); });
          state.body.append(state.refreshRetry);
        }
      } else showError(state, error);
    } finally {
      mutationPending = false;
      syncRecordButtons();
      if (!disposed && !session && epoch === state.epoch + 1 && state.focus?.isConnected) state.focus.focus();
      if (active(state)) {
        state.busy = false;
        state.dialog.setAttribute("aria-busy", "false");
        controls.forEach((control, index) => {
          control.disabled = state.persisted
            ? !control.matches('[data-form-cancel], [data-gallery-confirm="no"], [data-gallery-refresh-retry]')
            : disabled[index];
        });
        if (state.refreshRetry) state.refreshRetry.disabled = false;
      }
    }
  }

  function openDelete(row, trigger) {
    if (disposed || mutationPending) return;
    const state = openDialog(row, "delete", trigger);
    const actions = element("div", "gallery-record-dialog-buttons");
    const yes = button("Sim", "data-gallery-confirm", "yes", () => {
      void mutate(state, () => {
        if (typeof deleteItem !== "function") throw new Error("A exclusão deste registro não está disponível. Tente novamente.");
        return deleteItem(row.id, { refresh: true });
      });
    });
    yes.classList.add("gallery-record-dialog-button--danger");
    const no = button("Não", "data-gallery-confirm", "no", () => { if (active(state) && !state.busy) close(); });
    actions.append(yes, no);
    state.body.append(actions);
    no.focus();
  }

  function editorRetry(state, options) {
    const retry = button("Tentar novamente", "data-gallery-editor-retry", "", () => { void populateEditor(state, options); });
    const cancel = button("Cancelar", "data-gallery-editor-cancel", "", () => { if (active(state) && !state.busy) close(); });
    state.body.replaceChildren(retry, cancel);
    retry.focus();
  }

  async function populateEditor(state, options = {}) {
    if (!active(state)) return;
    const loadEpoch = ++state.loadEpoch;
    const current = () => active(state) && state.loadEpoch === loadEpoch;
    state.controller?.cleanup?.();
    state.fieldLocks?.cleanup?.();
    state.sourceBinding?.cleanup?.();
    state.variantPicker?.destroy(); state.variantPicker = null;
    state.fieldLocks = null;
    state.controller = null;
    state.error.hidden = true;
    const cancel = button("Cancelar", "data-gallery-editor-cancel", "", () => { if (active(state) && !state.busy) close(); });
    state.body.replaceChildren(createLoadingIndicator(document, "Carregando formulário…"), cancel);
    try {
      if (typeof loadEditor !== "function") throw new Error("Os metadados deste formulário não estão disponíveis. Tente novamente.");
      const context = await loadEditor(state.row.id, { refresh: true, ...options });
      if (!current()) return;
      if (context?.contract?.requiresVariantSelection) {
        const variants = context.contract.formVariants || [];
        if (!variants.length) throw new Error("Não há uma variante Power Apps comprovada disponível para este formulário.");
        const label = element("label", "gallery-record-form-variant", "Selecione o formulário");
        const select = element("select");
        select.setAttribute("data-gallery-form-variant", "");
        const placeholder = element("option", "", "Selecione…");
        placeholder.value = "";
        select.append(placeholder);
        for (const variant of variants) {
          const option = element("option", "", variant.label || variant.name || variant.id);
          option.value = variant.id;
          select.append(option);
        }
        select.addEventListener("change", () => {
          if (variants.some(variant => variant.id === select.value)) void populateEditor(state, { formVariantId: select.value });
        });
        label.append(select);
        state.body.replaceChildren(label, button("Cancelar", "data-gallery-editor-cancel", "", close));
        state.variantPicker = bindSearchableFilterSelects(state.body, {selectionOnly:true});
        state.body.querySelector('[role=combobox]').focus();
        return;
      }
      if (!context?.entity || !context?.item?.fields || !context?.contract?.hasForm || context.contract.readOnly === true
        || !Array.isArray(context.columns) || !context.columns.length) {
        throw new Error("Não foi possível localizar os metadados de edição deste registro. Tente novamente.");
      }
      const { renderDynamicForm } = await import("../../../../portal/ui/dynamic-form.js");
      if (!current()) return;
      state.body.replaceChildren();
      // Native date controls require their local input representation. Keep the
      // fetched record intact so defaults and persistence retain the baseline.
      const values = { ...context.item.fields };
      for (const column of context.columns) {
        if (values[column.name] == null) continue;
        if (column.control === "date") values[column.name] = String(values[column.name]).slice(0, 10);
        if (column.control === "datetime-local") values[column.name] = String(values[column.name]).slice(0, 16);
      }
      state.controller = renderDynamicForm(state.body, {
        entity: context.entity,
        columns: context.columns,
        mode: "edit",
        values,
        defaultContext: { record: context.item.fields },
        relationshipSearch: context.relationshipSearch,
        powerAppsOptionSearch: context.powerAppsOptionSearch,
        onCancel: () => { if (active(state) && !state.busy) close(); },
        onSubmit: async fields => {
          await mutate(state, () => {
            if (typeof saveEditor !== "function") throw new Error("Não foi possível salvar este registro. Tente novamente.");
            const readOnly = new Set(context.columns.filter(c => c.readOnly).flatMap(c => [c.name,...(['lookup','person'].includes(c.control)?[`${c.name}LookupId`]:[])]));
            return saveEditor(context, Object.fromEntries(Object.entries(fields).filter(([name]) => !readOnly.has(name))));
          });
          // Re-evaluate conditional locks after a rejected save, once the
          // renderer has restored its own disabled-state snapshot.
          if (active(state) && !state.persisted) queueMicrotask(() => queueMicrotask(() => {
            if (active(state)) void state.fieldLocks?.refresh?.();
          }));
          // The renderer restores its control snapshot after this callback;
          // postpone committed-state locking until that restoration completes.
          if (active(state) && state.persisted) queueMicrotask(() => queueMicrotask(() => {
            if (!active(state)) return;
            state.body.querySelectorAll('input, select, textarea, [data-form-save]').forEach(control => { control.disabled = true; });
          }));
        },
      });
      state.fieldLocks = bindForm43FieldLocks(state.body, context, { isBusy: () => state.busy || state.persisted });
      state.sourceBinding = bindPayrollEditorSource(state.body.querySelector('form'), context, {
        isBusy: () => state.busy || state.persisted,
        onError: error => showError(state, error),
        onRecovered: () => { if (active(state)) state.error.hidden = true; },
      });
      (state.body.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])') || focusable(state)[0] || state.dialog).focus();
    } catch (error) {
      if (!current()) return;
      showError(state, error);
      editorRetry(state, options);
    }
  }

  async function edit(row, trigger) {
    if (disposed || mutationPending) return;
    if (typeof onEdit === "function") {
      trigger.disabled = true;
      try { await onEdit(row); } catch (error) { await report(error); }
      finally { if (!disposed) trigger.disabled = mutationPending; }
      return;
    }
    const state = openDialog(row, "edit", trigger);
    await populateEditor(state);
  }

  function icon(action) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", action === "edit" ? "M4 16.5V20h3.5L19 8.5 15.5 5 4 16.5ZM14 6.5l3.5 3.5M17 3.5l3.5 3.5" : "m6 6 12 12M18 6 6 18");
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "2.5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
    return svg;
  }

  return Object.freeze({
    isEditing: () => session?.operation === 'edit',
    render(row) {
      const wrapper = element("div", "gallery-record-actions");
      for (const action of actions) {
        const control = button(undefined, "data-gallery-action", action, () => {
          if (action === "edit") void edit(row, control);
          else openDelete(row, control);
        });
        control.className = `gallery-record-action gallery-record-action--${action}`;
        control.setAttribute("aria-label", `${action === "edit" ? "Editar" : "Deletar"} item de ID ${row.id}`);
        control.disabled = disposed || mutationPending;
        if (action === "edit") control.textContent = "✏️";
        else control.append(icon(action));
        recordButtons.add(control);
        wrapper.append(control);
      }
      return wrapper;
    },
    close,
    destroy() {
      disposed = true;
      close();
      syncRecordButtons();
      recordButtons.clear();
    },
  });
}
