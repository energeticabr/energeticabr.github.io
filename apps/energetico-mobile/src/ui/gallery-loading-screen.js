import { createLoadingIndicator } from './loading-indicator.js';
import { beginLoadingTask } from './loading-task.js';

// Default loading covers the gallery body; an optional viewport confines it to
// a result region without masking the toolbar or rebuilding native controls.
export function createGalleryLoadingScreen({ root, header, label, viewport }) {
  const doc = root.ownerDocument, win = doc.defaultView;
  const element = doc.createElement('div');
  element.className = `gallery-loading-screen${viewport ? ' gallery-loading-screen--scoped' : ''}`;
  element.hidden = true;
  const indicator = createLoadingIndicator(doc, label);
  element.append(indicator);
  root.append(element);
  let loading = false, destroyed = false, task = null;
  const saved = new Map();
  const position = () => {
    if (!loading || destroyed) return;
    const headerBottom = Math.max(0, header.getBoundingClientRect().bottom);
    if (!viewport) { element.style.top = `${headerBottom}px`; return; }
    const region = root.getBoundingClientRect(), clip = viewport.getBoundingClientRect();
    const top = Math.max(headerBottom, region.top, clip.top);
    const left = Math.max(0, region.left, clip.left);
    Object.assign(element.style, { top: `${top}px`, left: `${left}px`,
      width: `${Math.max(0, Math.min(region.right, clip.right, win.innerWidth) - left)}px`,
      height: `${Math.max(0, Math.min(region.bottom, clip.bottom, win.innerHeight) - top)}px` });
  };
  const observer = win?.ResizeObserver ? new win.ResizeObserver(position) : null;
  observer?.observe(header);
  if (viewport) {
    observer?.observe(viewport);
    // Disclosure panels above the results change their position, not their size.
    for (const sibling of viewport.children) observer?.observe(sibling);
  }
  win?.addEventListener('resize', position);
  viewport?.addEventListener('scroll', position, { passive: true });

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
      task?.stop();
      for (const [node, previous] of saved) {
        node.inert = previous.inert;
        if (previous.ariaHidden == null) node.removeAttribute('aria-hidden');
        else node.setAttribute('aria-hidden', previous.ariaHidden);
      }
      saved.clear();
    }
  }
  function beginTask(options = {}) {
    task?.stop();
    task = beginLoadingTask(indicator, { ...options,
      isCurrent: () => loading && !destroyed && (!options.isCurrent || options.isCurrent()) });
    return task;
  }
  function destroy() {
    if (destroyed) return;
    sync(false);
    destroyed = true;
    observer?.disconnect();
    win?.removeEventListener('resize', position);
    viewport?.removeEventListener('scroll', position);
    element.remove();
  }
  return Object.freeze({ element, sync, beginTask, destroy });
}
