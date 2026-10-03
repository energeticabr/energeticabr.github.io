let ruleSequence = 0;

/** Keep native and searchable STATUS controls in the source DisplayMode. */
export function bindForm43FieldLocks(root, context, { isBusy = () => false } = {}) {
  if (typeof context.evaluateFieldLocks !== 'function') return Object.freeze({ refresh() {}, cleanup() {} });
  const form = root.querySelector('[data-dynamic-form]');
  const column = context.columns.find(column => String(column.name).toUpperCase() === 'STATUS' || String(column.label).toUpperCase() === 'STATUS');
  const native = column && form?.elements.namedItem(column.name);
  if (!native) return Object.freeze({ refresh() {}, cleanup() {} });
  const wrapper = native.closest('label') || native.parentElement;
  const message = root.ownerDocument.createElement('p');
  message.id = `form43-status-lock-${++ruleSequence}`;
  message.dataset.form43StatusLock = '';
  message.setAttribute('aria-live', 'polite');
  message.style.cssText = 'margin:6px 0 0;color:#8e1f25;font-size:.85rem;white-space:normal';
  wrapper.append(message);
  const original = new Map();
  let disposed = false; let sequence = 0;
  const controller = new AbortController();
  function controls() {
    const items = [...wrapper.querySelectorAll('input, select, textarea, button')];
    for (const item of items) if (!original.has(item)) original.set(item, item.disabled);
    return items;
  }
  function apply(lock) {
    for (const control of controls()) {
      control.disabled = isBusy() || lock || original.get(control);
      control.setAttribute('aria-disabled', String(control.disabled));
      const described = new Set(String(control.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
      described.add(message.id); control.setAttribute('aria-describedby', [...described].join(' '));
    }
    if (lock) {
      for (const list of wrapper.querySelectorAll('[role="listbox"]')) list.hidden = true;
      for (const input of wrapper.querySelectorAll('[role="combobox"]')) input.setAttribute('aria-expanded', 'false');
    }
  }
  function values() {
    const draft = { ...context.item.fields };
    for (const column of context.columns) {
      const control = form.elements.namedItem(column.name);
      if (control) draft[column.name] = column.control === 'checkbox' ? control.checked : control.value;
    }
    return draft;
  }
  async function refresh() {
    if (disposed) return;
    const current = ++sequence;
    apply(true);
    message.hidden = false; message.textContent = 'Conferindo os requisitos para alterar STATUS…';
    try {
      const locks = await context.evaluateFieldLocks(values(), { signal: controller.signal });
      if (disposed || sequence !== current) return;
      const rule = locks?.[column.name];
      if (!rule || typeof rule.editable !== 'boolean') throw new Error('Não foi possível conferir os requisitos de STATUS.');
      apply(!rule.editable);
      message.hidden = rule.editable;
      message.textContent = rule.editable ? '' : `STATUS bloqueado: ${rule.reasons.join(' ')}`;
    } catch (error) {
      if (disposed || sequence !== current) return;
      apply(true);
      message.textContent = `STATUS bloqueado: ${String(error?.message || 'Não foi possível conferir os requisitos.').replace(/https?:\/\/\S+/g, 'endereço SharePoint')}`;
    }
  }
  const changed = event => { if (!wrapper.contains(event.target)) void refresh(); };
  const reset = () => queueMicrotask(() => { void refresh(); });
  form.addEventListener('input', changed); form.addEventListener('change', changed); form.addEventListener('reset', reset);
  void refresh();
  return Object.freeze({ refresh,
    cleanup() {
      disposed = true; sequence++; controller.abort();
      form.removeEventListener('input', changed); form.removeEventListener('change', changed); form.removeEventListener('reset', reset);
      message.remove();
    },
  });
}
