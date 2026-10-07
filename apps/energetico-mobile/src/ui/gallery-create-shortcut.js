let filterSequence = 0;

/** UI only: the controller owns the workflow started by onCreate. */
export function attachGalleryCreateShortcut({ document, root, toolbar, filterToggle, onCreate, close,
  isAvailable, label = 'Adicionar registro', action = 'create-record', className = '', button: existingButton }) {
  const button = existingButton || document.createElement('button');
  button.className = `gallery-create-button ${className}`.trim();
  button.type = 'button';
  button.textContent = '+';
  button.dataset.galleryCreate = '';
  button.dataset.action = action;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.disabled = true;
  let destroyed = false, activating = false, pendingMutations = 0;
  let errorNotice = null;
  toolbar.classList.add('gallery-create-toolbar');
  filterToggle.classList.add('gallery-filter-button');
  filterToggle.after(button);

  function available() {
    if (destroyed || activating || pendingMutations || typeof onCreate !== 'function' || !root.isConnected || root.hidden
      || root.getAttribute('aria-busy') === 'true' || !isAvailable()) return false;
    for (let node = button; node; node = node.parentElement) {
      if (node.hidden || node.inert) return false;
    }
    // Editors and dialogs own interaction until they close, including mutations.
    return ![...root.querySelectorAll('.gallery-record-dialog, [role="dialog"], [aria-busy="true"]')]
      .some(node => !node.closest('[hidden]'));
  }
  function sync() {
    const disabled = !available();
    if (button.disabled !== disabled) button.disabled = disabled;
  }
  function clearError() {
    errorNotice?.remove();
    errorNotice = null;
  }
  function showError() {
    // Feedback stays visible after close, but never revives destroyed UI.
    if (destroyed || !root.isConnected) return;
    clearError();
    errorNotice = document.createElement('div');
    errorNotice.className = 'gallery-create-error';
    errorNotice.dataset.galleryCreateError = '';
    errorNotice.setAttribute('role', 'alert');
    const message = document.createElement('span');
    message.textContent = 'Não foi possível iniciar o cadastro. Tente novamente.';
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.textContent = '×';
    dismiss.setAttribute('aria-label', 'Fechar aviso de erro');
    dismiss.addEventListener('click', clearError, { once: true });
    errorNotice.append(message, dismiss);
    document.body.append(errorNotice);
  }
  async function activate(event) {
    event.preventDefault(); event.stopPropagation();
    if (!available()) { sync(); return; }
    activating = true;
    button.disabled = true;
    clearError();
    try {
      close();
      await onCreate();
    } catch { showError(); }
    finally { activating = false; sync(); }
  }
  button.addEventListener('click', activate);
  const Observer = document.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(sync) : null;
  observer?.observe(root, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['hidden', 'inert', 'aria-busy'] });
  return {
    button, sync,
    async runMutation(operation) {
      pendingMutations++; sync();
      try { return await operation(); }
      finally { pendingMutations--; sync(); }
    },
    destroy() {
      destroyed = true;
      clearError();
      observer?.disconnect(); button.removeEventListener('click', activate); button.disabled = true;
    },
  };
}

/** Keep Filters and + visible above a native disclosure in either state. */
export function createGalleryCreationToolbar({ document, disclosure, ...options }) {
  const toolbar = document.createElement('div');
  toolbar.className = 'gallery-create-toolbar--filters';
  const filterToggle = document.createElement('button');
  filterToggle.type = 'button';
  filterToggle.textContent = '⚲ Filtros';
  disclosure.id ||= `gallery-create-filters-${++filterSequence}`;
  disclosure.classList.add('gallery-create-filter-panel');
  const summary = disclosure.querySelector('summary');
  summary?.setAttribute('aria-hidden', 'true');
  if (summary) summary.tabIndex = -1;
  filterToggle.setAttribute('aria-controls', disclosure.id);
  const syncExpanded = () => filterToggle.setAttribute('aria-expanded', String(disclosure.open));
  const toggle = () => { disclosure.open = !disclosure.open; syncExpanded(); };
  filterToggle.addEventListener('click', toggle);
  disclosure.addEventListener('toggle', syncExpanded);
  syncExpanded();
  toolbar.append(filterToggle);
  const shortcut = attachGalleryCreateShortcut({ document, toolbar, filterToggle, ...options });
  return { ...shortcut, toolbar,
    destroy() { shortcut.destroy(); filterToggle.removeEventListener('click', toggle); disclosure.removeEventListener('toggle', syncExpanded); },
  };
}
