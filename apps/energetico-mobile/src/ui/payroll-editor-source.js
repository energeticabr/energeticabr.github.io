/** Refresh source-owned fields without replacing the user's form or ETag. */
export function bindPayrollEditorSource(form, context, { onError, onRecovered, isBusy = () => false } = {}) {
  if (!context.refreshDerivedValues) return { cleanup() {} };
  const doc = form.ownerDocument, win = doc.defaultView;
  const link = [...form.elements].find(c => c.name === 'IDLANCAMENTO');
  let disposed = false, pending = false, failed = false, controller;
  const save = form.querySelector('[data-form-save]');
  async function refresh() {
    if (disposed || pending || isBusy() || doc.visibilityState === 'hidden') return;
    pending = true;
    const id = link?.value;
    controller = new AbortController();
    try {
      const fields = await context.refreshDerivedValues(link ? { [link.name]: id } : {}, { signal: controller.signal });
      if (disposed || isBusy() || id !== link?.value) return;
      for (const [name, value] of Object.entries(fields)) {
        const input = form.elements.namedItem(name);
        if (input?.readOnly) input.value = input.defaultValue = String(value);
      }
      if (failed) { failed = false; save.disabled = false; onRecovered?.(); }
    } catch (error) {
      if (!disposed && error?.name !== 'AbortError') {
        failed = true; save.disabled = true; onError?.(error);
      }
    } finally {
      pending = false;
      if (!disposed && id !== link?.value) void refresh();
    }
  }
  const visible = () => { if (doc.visibilityState !== 'hidden') void refresh(); };
  const reset = () => queueMicrotask(() => { void refresh(); });
  form.addEventListener('reset', reset);
  link?.addEventListener('change', refresh);
  win?.addEventListener('focus', refresh);
  doc.addEventListener('visibilitychange', visible);
  const timer = win?.setInterval(refresh, 15000);
  return { cleanup() {
    disposed = true; controller?.abort(); win?.clearInterval(timer);
    form.removeEventListener('reset', reset);
    link?.removeEventListener('change', refresh); win?.removeEventListener('focus', refresh);
    doc.removeEventListener('visibilitychange', visible);
  } };
}
