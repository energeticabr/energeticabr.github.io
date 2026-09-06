const PREFIX = 'energetico:flow-preview:v1:';
const MAX_RECORD = 300_000;

function previewFields(source = {}) {
  const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
  const draft = typeof source.draft === 'string' ? source.draft : '';
  // Never silently truncate an editable draft. The UI must warn if it cannot be saved.
  if (draft.length > 100_000) throw new Error('Rascunho muito grande para a prévia local.');
  let activeFlow = null;
  if (source.activeFlow != null) {
    const flow = source.activeFlow;
    if (!flow.id || !flow.title || (flow.rows != null && !Array.isArray(flow.rows))) throw new Error('Prévia inválida.');
    let remaining = 20_000;
    const rows = (flow.rows || []).slice(0, 50).filter(row => row && typeof row === 'object').map(row => {
      const label = text(row.label, Math.min(120, remaining)); remaining -= label.length;
      const value = text(row.value, Math.min(1000, remaining)); remaining -= value.length;
      return { label, value };
    }).filter(row => row.label || row.value);
    activeFlow = { id: text(flow.id, 200), title: text(flow.title, 300), contextId: text(flow.contextId, 128), paused: flow.paused === true, rows };
  }
  return {
    activeFlow, draft, question: text(source.question, 8000),
    pendingNames: Array.isArray(source.pendingNames) ? source.pendingNames.slice(0, 100).map(name => text(name, 250)).filter(Boolean) : [],
    uncertain: source.uncertain === true,
    savedAt: Number.isFinite(source.savedAt) ? source.savedAt : Date.now(),
  };
}

export function createRecoveryStorage({ storage, delayMs = 250 } = {}) {
  const listeners = new Set();
  let pending = null, timer = null, healthy = true;
  const getStorage = () => storage || globalThis.localStorage;
  const keyFor = accountId => {
    if (typeof accountId !== 'string' || !accountId.trim() || accountId.length > 512) throw new Error('Conta inválida.');
    return PREFIX + encodeURIComponent(accountId);
  };
  function report(ok) {
    if (healthy !== ok) { healthy = ok; listeners.forEach(listener => listener(ok)); }
    return ok;
  }
  function flush() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!pending) return healthy;
    const { accountId, source } = pending;
    pending = null;
    try {
      const record = { version: 1, ...previewFields(source),
        reference: source.reference ? previewFields(source.reference) : null,
        references: Array.isArray(source.references) ? source.references.map(previewFields) : [] };
      const serialized = JSON.stringify(record);
      if (serialized.length > MAX_RECORD) throw new Error('Prévia muito grande.');
      getStorage().setItem(keyFor(accountId), serialized);
      return report(true);
    } catch { return report(false); }
  }
  function schedule(accountId, source) {
    if (pending && pending.accountId !== accountId) flush();
    pending = { accountId, source };
    // Throttle rather than wait for typing to stop: long edits are also checkpointed.
    if (timer === null) timer = setTimeout(flush, delayMs);
  }
  function read(accountId) {
    try {
      const serialized = getStorage().getItem(keyFor(accountId));
      if (!serialized) return null;
      if (serialized.length > MAX_RECORD) return null;
      const record = JSON.parse(serialized);
      if (!record || record.version !== 1) return null;
      return { version: 1, ...previewFields(record), reference: record.reference ? previewFields(record.reference) : null,
        references: Array.isArray(record.references) ? record.references.map(previewFields) : [] };
    } catch { report(false); return null; }
  }
  function clear(accountId) {
    if (pending?.accountId === accountId) {
      pending = null;
      if (timer !== null) clearTimeout(timer);
      timer = null;
    }
    try { getStorage().removeItem(keyFor(accountId)); return report(true); }
    catch { return report(false); }
  }
  return Object.freeze({ read, schedule, flush, clear,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  });
}
