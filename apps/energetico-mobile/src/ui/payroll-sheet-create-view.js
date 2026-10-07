import { createLoadingIndicator } from './loading-indicator.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';

/** Standalone IDFOLHA composer using the native payroll form and shared dialog styles. */
export function createPayrollSheetCreateView({ document: doc = globalThis.document, loadOptions, save, onSaved, onClose } = {}) {
  let current = null, disposed = false, mutationPending = false;
  const element = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const active = state => !disposed && current === state && !state.abort.signal.aborted;
  function close(force = false, notify = true) {
    if (!current || current.busy && !force) return;
    const state = current; current = null;
    doc.removeEventListener('keydown', state.outsideKeydown, true);
    state.abort.abort(); state.picker?.destroy(); state.overlay.remove();
    if (state.trigger?.isConnected) state.trigger.focus();
    if (notify) onClose?.();
  }
  function fail(state, error) {
    if (!active(state)) return;
    state.error.textContent = error?.message || 'Não foi possível cadastrar a folha. Tente novamente.';
    state.error.hidden = false;
  }
  function focusable(state) {
    return [...state.dialog.querySelectorAll('button,input,select,[tabindex="0"]')]
      .filter(node => !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden]'));
  }
  function trapTab(state, event) {
    if (event.key !== 'Tab' || event.defaultPrevented) return;
    const controls = focusable(state), first = controls[0], last = controls.at(-1);
    if (!controls.length) { event.preventDefault(); state.dialog.focus(); return; }
    if (!controls.includes(doc.activeElement) || event.shiftKey && doc.activeElement === first
      || !event.shiftKey && doc.activeElement === last) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
  }
  async function populate(state) {
    if (!active(state) || state.loading) return;
    state.loading = true; state.error.hidden = true; state.submit.disabled = true;
    state.dialog.setAttribute('aria-busy', 'true');
    state.body.replaceChildren(createLoadingIndicator(doc, 'Carregando fornecedores…'));
    try {
      const options = await loadOptions({ signal: state.abort.signal });
      if (!active(state)) return;
      if (!Array.isArray(options?.suppliers) || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(options?.defaultMonth || '')) {
        throw new Error('As opções de cadastro da folha não estão disponíveis.');
      }
      const form = element('form', 'dynamic-form'); form.noValidate = true;
      const grid = element('div', 'dynamic-form-grid');
      const supplierField = element('label', 'dynamic-field', 'Fornecedor');
      const supplier = element('select'); supplier.name = 'supplierId'; supplier.required = true;
      supplier.setAttribute('aria-label', 'Fornecedor');
      supplier.append(new doc.defaultView.Option('Selecione o fornecedor', ''));
      for (const option of options.suppliers) supplier.append(new doc.defaultView.Option(option.label, option.id));
      supplierField.append(supplier);
      const monthField = element('label', 'dynamic-field', 'Mês de referência');
      const month = element('input'); month.type = 'month'; month.name = 'month'; month.required = true;
      month.setAttribute('aria-label', 'Mês de referência'); month.value = options.defaultMonth;
      monthField.append(month); grid.append(supplierField, monthField);
      form.id = `payroll-sheet-create-${state.operationId}`;
      state.submit.setAttribute('form', form.id);
      form.append(grid); state.body.replaceChildren(form);
      state.picker = bindSearchableFilterSelects(form);
      state.submit.disabled = options.suppliers.length === 0;
      if (!options.suppliers.length) fail(state, new Error('Nenhum fornecedor cadastrado foi encontrado.'));
      form.addEventListener('submit', async event => {
        event.preventDefault(); event.stopPropagation();
        if (!active(state) || state.busy || mutationPending) return;
        if (!state.saved && !state.uncertain) {
          if (!options.suppliers.some(option => String(option.id) === supplier.value) || !supplier.value
            || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(month.value) || Number(month.value.slice(0, 4)) === 0) {
            fail(state, new Error('Selecione um fornecedor cadastrado e um mês de referência válido.')); return;
          }
          state.draft = { supplierId: supplier.value, month: month.value };
        }
        state.busy = true; mutationPending = true; state.error.hidden = true;
        state.dialog.setAttribute('aria-busy', 'true'); state.picker.close();
        const controls = [...state.dialog.querySelectorAll('button,input,select')];
        const disabled = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        try {
          state.saved ||= await save(state.draft, { operationId: state.operationId });
          if (!active(state)) return;
          await onSaved?.(state.saved);
          if (active(state)) close(true);
        } catch (error) {
          if (error?.payrollSheetCreateUncertain === true || error?.code === 'payroll_sheet_create_uncertain') state.uncertain = true;
          fail(state, error);
          if (state.saved) state.submit.textContent = 'Atualizar galeria';
        } finally {
          mutationPending = false;
          if (active(state)) {
            state.busy = false; state.dialog.setAttribute('aria-busy', 'false');
            controls.forEach((control, index) => { control.disabled = disabled[index]; });
            if (state.saved || state.uncertain) { supplier.disabled = true; month.disabled = true; }
            state.picker.sync();
          }
        }
      });
    } catch (error) {
      if (!active(state)) return;
      state.body.replaceChildren(); fail(state, error);
      const retry = element('button', 'gallery-record-dialog-button', 'Tentar novamente');
      retry.type = 'button'; retry.dataset.sheetCreateRetry = '';
      retry.addEventListener('click', () => { void populate(state); }); state.body.append(retry);
    } finally {
      state.loading = false;
      if (active(state)) state.dialog.setAttribute('aria-busy', 'false');
    }
  }
  async function open() {
    if (disposed || current || mutationPending) return;
    const trigger = doc.activeElement;
    const operationId = doc.defaultView.crypto.randomUUID();
    const overlay = element('div', 'gallery-record-overlay');
    const dialog = element('section', 'gallery-record-dialog');
    dialog.dataset.payrollSheetCreate = ''; dialog.tabIndex = -1;
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    const heading = element('h2', 'gallery-record-dialog-title', 'Nova folha (IDFOLHA)');
    heading.id = `payroll-sheet-create-title-${operationId}`; dialog.setAttribute('aria-labelledby', heading.id);
    const error = element('p', 'gallery-record-dialog-error'); error.hidden = true; error.setAttribute('role', 'alert');
    const body = element('div', 'gallery-record-dialog-body');
    const actions = element('div', 'dynamic-form-actions');
    const cancel = element('button', 'gallery-record-dialog-button', 'CANCELAR'); cancel.type = 'button'; cancel.dataset.sheetCreateCancel = '';
    const submit = element('button', 'gallery-record-dialog-button', 'SUBMETER'); submit.type = 'submit'; submit.disabled = true;
    actions.append(cancel, submit); dialog.append(heading, error, body, actions); overlay.append(dialog);
    const state = { overlay, dialog, body, error, submit, trigger, operationId, abort: new AbortController(),
      loading: false, busy: false, saved: null, uncertain: false };
    current = state;
    state.outsideKeydown = event => {
      if (!active(state) || state.dialog.contains(doc.activeElement) || event.key !== 'Tab') return;
      event.stopPropagation(); trapTab(state, event);
    };
    doc.addEventListener('keydown', state.outsideKeydown, true);
    cancel.addEventListener('click', () => close());
    overlay.addEventListener('click', event => event.stopPropagation());
    overlay.addEventListener('keydown', event => {
      event.stopPropagation(); if (event.defaultPrevented) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); }
      trapTab(state, event);
    });
    doc.body.append(overlay); dialog.focus();
    await populate(state);
  }
  return Object.freeze({ open, close: () => close(true), isOpen: () => Boolean(current),
    destroy() { if (disposed) return; disposed = true; close(true, false); } });
}
