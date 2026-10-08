/** A read-only action: the current gallery owns loading, filters and error feedback. */
export function attachGalleryRefreshButton({ document, root, container, onRefresh, isAvailable = () => true,
  button: existingButton }) {
  const button = existingButton || document.createElement('button');
  button.type = 'button';
  button.textContent = 'Atualizar base de dados';
  button.classList.add('gallery-refresh-button');
  button.dataset.galleryRefresh = '';
  button.setAttribute('aria-label', 'Atualizar base de dados');
  container.classList.add('gallery-refresh-toolbar');
  container.append(button);
  let destroyed = false, busy = false, errorNotice = null, visibilityEpoch = 0;

  function available() {
    if (destroyed || busy || typeof onRefresh !== 'function' || !root.isConnected
      || root.hidden || root.getAttribute('aria-busy') === 'true' || !isAvailable()) return false;
    for (let node = button; node; node = node.parentElement) {
      if (node.hidden || node.inert || node.hasAttribute('inert')) return false;
    }
    return ![...root.querySelectorAll('.gallery-record-dialog, [role="dialog"], [data-dynamic-form], .lg-editor, [aria-busy="true"]')]
      .some(node => node !== button && !node.closest('[hidden]'));
  }
  function sync() {
    if (destroyed || !root.isConnected) return;
    const disabled = !available();
    if (button.disabled !== disabled) button.disabled = disabled;
  }
  function clearError() { errorNotice?.remove(); errorNotice = null; }
  async function activate(event) {
    event.preventDefault(); event.stopPropagation();
    if (!available()) { sync(); return; }
    busy = true;
    const epoch = visibilityEpoch;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    clearError();
    try { await onRefresh(); }
    catch {
      // Gallery loaders normally report errors themselves. Handle a throwing callback safely too.
      if (!destroyed && root.isConnected && !root.hidden && epoch === visibilityEpoch) {
        errorNotice = document.createElement('p');
        errorNotice.className = 'gallery-refresh-error';
        errorNotice.dataset.galleryRefreshError = '';
        errorNotice.setAttribute('role', 'alert');
        errorNotice.textContent = 'Não foi possível atualizar a base de dados. Tente novamente.';
        container.after(errorNotice);
      }
    } finally {
      busy = false;
      if (!destroyed && root.isConnected) { button.removeAttribute('aria-busy'); sync(); }
    }
  }
  button.addEventListener('click', activate);
  const Observer = document.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(records => {
    if (records.some(record => record.target === root && record.attributeName === 'hidden')) {
      visibilityEpoch++;
      clearError();
    }
    sync();
  }) : null;
  observer?.observe(root, { subtree: true, childList: true, attributes: true,
    attributeFilter: ['hidden', 'inert', 'aria-busy'] });
  button.disabled = true;
  sync();
  return { button, sync,
    destroy() {
      destroyed = true;
      observer?.disconnect(); button.removeEventListener('click', activate);
      clearError(); button.disabled = true;
    },
  };
}
