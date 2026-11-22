import { createGalleryAttachmentCounts } from './gallery-attachment-counts.js';
import { PDF_ATTACHMENT_ICON } from './report-pdf-attachment-icon.js';

export function createReportPdfAttachments({ root, scroll, retryButton, loadPdfs, openMediaCollection, getSignal, showNotice }) {
  if (typeof loadPdfs !== 'function' || typeof openMediaCollection !== 'function') return null;
  const doc = root.ownerDocument;
  const cells = new Map(), targets = new WeakMap(), failures = new Map();
  let interactiveTarget;
  const lookups = createGalleryAttachmentCounts({
    async loadAttachments(target, { signal }) {
      const interactive = interactiveTarget === target.id;
      if (interactive) interactiveTarget = undefined;
      try {
        return await loadPdfs(target.kind, target.itemId, { signal, interactive });
      } catch (error) {
        if (!signal.aborted) failures.set(target.id, { target, needsConsent: error?.code === 'AUTH_REQUIRED' });
        throw error;
      }
    },
    onChange(target) {
      if (!lookups.hasError(target)) failures.delete(target.id);
      retryButton.hidden = !failures.size;
      const files = lookups.attachmentsFor(target);
      if (files?.length) for (const cell of cells.get(target.id) || []) showButton(cell, target, files);
    },
  });
  const Observer = doc.defaultView?.IntersectionObserver;
  const observer = Observer && new Observer((entries, activeObserver) => {
    for (const entry of entries) {
      if (!entry.isIntersecting || !entry.target.isConnected) continue;
      activeObserver.unobserve(entry.target);
      const target = targets.get(entry.target);
      if (target) void lookups.load(target).catch(() => {});
    }
  }, { root: scroll, rootMargin: '100px' });

  function showButton(cell, { kind, itemId }, files) {
    const label = kind === 'order' ? `pedido ${itemId}` : `lançamento ${itemId}`;
    const control = doc.createElement('button');
    control.type = 'button';
    control.className = 'pl-pdf-attachment';
    control.innerHTML = PDF_ATTACHMENT_ICON;
    control.title = `Abrir PDFs do ${label}`;
    control.setAttribute('aria-label', control.title);
    let opening = false;
    control.addEventListener('click', async () => {
      const signal = getSignal();
      if (opening || !control.isConnected || !signal || signal.aborted) return;
      opening = true;
      try {
        await openMediaCollection(files, {
          signal, returnLabel: 'Voltar ao relatório',
          resolveReturnFocus: () => root.hidden ? null : control.isConnected ? control : scroll,
        });
      } catch {
        if (!signal.aborted) showNotice(`Não foi possível abrir os PDFs do ${label}.`);
      } finally { opening = false; }
    });
    const content = doc.createElement('span');
    content.className = 'pl-number-with-pdf';
    const number = doc.createElement('span');
    number.textContent = itemId;
    content.append(number, control);
    cell.replaceChildren(content);
  }

  function watchCell(cell, kind, itemId) {
    if (!/^[1-9]\d*$/.test(itemId)) return;
    const target = { id: `${kind}:${itemId}`, kind, itemId };
    if (!cells.has(target.id)) cells.set(target.id, new Set());
    cells.get(target.id).add(cell);
    const files = lookups.attachmentsFor(target);
    if (files) {
      if (files.length) showButton(cell, target, files);
    } else if (!lookups.hasError(target)) {
      if (observer) { targets.set(cell, target); observer.observe(cell); }
      else void lookups.load(target).catch(() => {});
    }
  }

  async function retry() {
    const pending = [...failures.values()];
    const first = pending.find(item => item.needsConsent) || pending[0];
    const signal = getSignal();
    if (!first || !signal || signal.aborted) return;
    retryButton.disabled = true;
    interactiveTarget = first.target.id;
    try {
      await lookups.load(first.target, { force: true, priority: true }).catch(() => {});
      if (!signal.aborted) {
        await Promise.allSettled(pending.filter(item => item !== first)
          .map(({ target }) => lookups.load(target, { force: true })));
      }
    } finally {
      if (!signal.aborted) {
        retryButton.disabled = false;
        if (retryButton.hidden && doc.activeElement === retryButton) scroll.focus();
      }
    }
  }

  function clearCells() {
    observer?.disconnect();
    cells.clear();
  }

  retryButton.addEventListener('click', retry);
  return {
    watchCell, clearCells,
    reset() {
      clearCells();
      lookups.reset();
      failures.clear();
      interactiveTarget = undefined;
      retryButton.hidden = true;
      retryButton.disabled = false;
    },
    destroy() {
      clearCells();
      lookups.destroy();
      retryButton.removeEventListener('click', retry);
    },
  };
}
