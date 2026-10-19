/** Local ordering only: no reads or writes to the task service. */
export function createTaskSortDialog({ document: doc, host, background, onSelect }) {
  let current = null, destroyed = false;
  const el = (tag, className, text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const focusable = () => [...(current?.dialog.querySelectorAll('button:not([disabled])') || [])];
  function keepFocus(event) {
    if (current && !current.dialog.contains(event.target)) focusable()[0]?.focus({ preventScroll: true });
  }
  function close() {
    const previous = current; current = null;
    if (!previous) return;
    doc.removeEventListener('focusin', keepFocus, true);
    previous.overlay.remove();
    for (const [node, inert] of previous.background) node.inert = inert;
    previous.trigger.setAttribute('aria-expanded', 'false');
    if (previous.trigger.isConnected && !host.hidden) previous.trigger.focus({ preventScroll: true });
  }
  function open(trigger, options, selected) {
    if (destroyed || current || host.hidden || !host.isConnected || trigger.disabled) return;
    const overlay = el('div', 'gallery-record-overlay tg-sort-overlay');
    const dialog = el('section', 'gallery-record-dialog tg-sort-dialog');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Ordenar tarefas'); dialog.tabIndex = -1;
    dialog.append(el('h2', 'gallery-record-dialog-title', 'Ordenar tarefas'));
    const choices = el('div', 'tg-sort-choices');
    for (const option of options) {
      const button = el('button', 'og-button tg-sort-choice', option.label);
      button.type = 'button'; button.dataset.sortValue = option.value;
      button.setAttribute('aria-pressed', String(option.value === selected));
      button.addEventListener('click', () => {
        if (current?.dialog !== dialog) return;
        close(); onSelect(option.value);
      });
      choices.append(button);
    }
    const cancel = el('button', 'gallery-record-dialog-button', 'Cancelar');
    cancel.type = 'button'; cancel.dataset.taskSortCancel = '';
    cancel.addEventListener('click', close);
    const buttons = el('div', 'gallery-record-dialog-buttons'); buttons.append(cancel);
    dialog.append(choices, buttons); overlay.append(dialog); host.append(overlay);
    current = { overlay, dialog, trigger, background: background.map(node => [node, node.inert === true]) };
    for (const node of background) node.inert = true;
    trigger.setAttribute('aria-expanded', 'true');
    overlay.addEventListener('click', event => {
      event.stopPropagation();
      if (event.target === overlay) close();
    });
    overlay.addEventListener('keydown', event => {
      if (!['Escape', 'Tab'].includes(event.key)) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      const buttons = focusable(), first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) {
        event.preventDefault(); first?.focus();
      }
    });
    doc.addEventListener('focusin', keepFocus, true);
    choices.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }
  return Object.freeze({ open, close, destroy() { close(); destroyed = true; } });
}
