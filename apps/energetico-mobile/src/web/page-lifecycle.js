// Safari may freeze this document in its back/forward cache. Do not destroy a
// still-live chat when opening another app and returning to this same document.
export function bindPageLifecycle({ windowRef = globalThis, documentRef = globalThis.document, onClose, onForeground, onRestore, onSave }) {
  let foreground = documentRef?.visibilityState !== 'hidden';
  const activate = () => {
    if (foreground || documentRef?.visibilityState === 'hidden') return;
    foreground = true;
    void onForeground?.();
  };
  const deactivate = () => {
    foreground = false;
    onSave?.();
  };
  const restore = event => {
    if (!event.persisted) return;
    activate();
    void onRestore?.();
  };
  const visibilityChanged = () => {
    if (documentRef.visibilityState === 'hidden') deactivate();
    else activate();
  };
  const close = event => {
    deactivate();
    if (event.persisted) return;
    windowRef.removeEventListener('pagehide', close);
    windowRef.removeEventListener('pageshow', restore);
    documentRef?.removeEventListener('visibilitychange', visibilityChanged);
    onClose();
  };
  windowRef.addEventListener('pagehide', close);
  windowRef.addEventListener('pageshow', restore);
  documentRef?.addEventListener('visibilitychange', visibilityChanged);
}
