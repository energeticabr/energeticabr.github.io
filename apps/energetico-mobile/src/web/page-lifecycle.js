// Safari may freeze this document in its back/forward cache. Do not destroy a
// still-live chat when opening another app and returning to this same document.
export function bindPageLifecycle({ windowRef = globalThis, documentRef = globalThis.document, onClose, onRestore, onSave }) {
  const restore = event => { if (event.persisted) void onRestore?.(); };
  const hidden = () => { if (documentRef.visibilityState === 'hidden') onSave?.(); };
  const close = event => {
    onSave?.();
    if (event.persisted) return;
    windowRef.removeEventListener('pagehide', close);
    windowRef.removeEventListener('pageshow', restore);
    documentRef?.removeEventListener('visibilitychange', hidden);
    onClose();
  };
  windowRef.addEventListener('pagehide', close);
  windowRef.addEventListener('pageshow', restore);
  documentRef?.addEventListener('visibilitychange', hidden);
}
