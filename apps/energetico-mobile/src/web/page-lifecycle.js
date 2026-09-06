// Safari may freeze this document in its back/forward cache. Do not destroy a
// still-live chat when opening another app and returning to this same document.
export function bindPageLifecycle({ windowRef = globalThis, onClose, onRestore }) {
  const restore = event => { if (event.persisted) void onRestore?.(); };
  const close = event => {
    if (event.persisted) return;
    windowRef.removeEventListener('pagehide', close);
    windowRef.removeEventListener('pageshow', restore);
    onClose();
  };
  windowRef.addEventListener('pagehide', close);
  windowRef.addEventListener('pageshow', restore);
}
