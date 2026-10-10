import { createLoadingIndicator } from './loading-indicator.js';

// Keep list loading outside toolbars and scrolling content. A refresh preserves
// the old DOM underneath, but never exposes partial data or interactive controls.
export function createGalleryLoadingScreen({ root, header, label }) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const element = doc.createElement('div');
  element.className = 'gallery-loading-screen';
  element.hidden = true;
  element.append(createLoadingIndicator(doc, label));
  root.append(element);
  let loading = false, destroyed = false;
  const saved = new Map();
  const position = () => {
    if (loading && !destroyed) element.style.top = `${Math.max(0, header.getBoundingClientRect().bottom)}px`;
  };
  const observer = win?.ResizeObserver ? new win.ResizeObserver(position) : null;
  observer?.observe(header);
  win?.addEventListener('resize', position);

  function sync(value) {
    if (destroyed) return;
    loading = Boolean(value);
    root.dataset.galleryLoading = String(loading);
    element.hidden = !loading;
    if (loading) {
      for (const node of root.children) {
        if (node === header || node === element || saved.has(node)) continue;
        saved.set(node, { inert: Boolean(node.inert), ariaHidden: node.getAttribute('aria-hidden') });
        node.inert = true;
        node.setAttribute('aria-hidden', 'true');
      }
      position();
    } else {
      for (const [node, previous] of saved) {
        node.inert = previous.inert;
        if (previous.ariaHidden == null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', previous.ariaHidden);
      }
      saved.clear();
    }
  }
  function destroy() {
    if (destroyed) return;
    sync(false);
    destroyed = true;
    observer?.disconnect();
    win?.removeEventListener('resize', position);
    element.remove();
  }
  return Object.freeze({ element, sync, destroy });
}
