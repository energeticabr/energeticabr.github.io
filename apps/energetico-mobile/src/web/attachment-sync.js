export function bindAttachmentSync({
  documentRef = globalThis.document,
  windowRef = globalThis,
  refresh,
  now = Date.now,
}) {
  let lastUpdate = -Infinity;
  const update = () => {
    if (documentRef?.visibilityState === "hidden" || now() - lastUpdate < 5000) return;
    lastUpdate = now();
    void refresh({ silent: true });
  };
  documentRef?.addEventListener("visibilitychange", update);
  windowRef?.addEventListener("focus", update);
  return () => {
    documentRef?.removeEventListener("visibilitychange", update);
    windowRef?.removeEventListener("focus", update);
  };
}
