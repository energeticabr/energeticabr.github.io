export function bindAttachmentSync({
  documentRef = globalThis.document,
  windowRef = globalThis,
  refresh,
}) {
  const update = () => {
    if (documentRef?.visibilityState !== "hidden") void refresh({ silent: true });
  };
  documentRef?.addEventListener("visibilitychange", update);
  windowRef?.addEventListener("focus", update);
  return () => {
    documentRef?.removeEventListener("visibilitychange", update);
    windowRef?.removeEventListener("focus", update);
  };
}
