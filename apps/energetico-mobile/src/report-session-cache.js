const SNAPSHOT_READS = new Set([
  'loadSnapshot', 'loadPaymentsSnapshot', 'loadProvisionReportSnapshot', 'loadOrderValidationSnapshot',
  'loadPaymentsForPayrollIds', 'loadOverview', 'loadDetails', 'loadReport',
]);

function keyValue(value) {
  if (Array.isArray(value)) return value.map(keyValue);
  if (value && typeof value === 'object') {
    if (value instanceof Date) return value.toISOString();
    return Object.fromEntries(Object.keys(value).filter(key => key !== 'signal').sort()
      .map(key => [key, keyValue(value[key])]));
  }
  return value;
}
const cancelled = () => new DOMException('Consulta cancelada.', 'AbortError');

function copySnapshot(value) {
  if (typeof globalThis.structuredClone === 'function') return globalThis.structuredClone(value);
  // Older WebViews: report snapshots consist of plain data, arrays and dates.
  if (Array.isArray(value)) return value.map(copySnapshot);
  if (value instanceof Date) return new Date(value);
  if (value && typeof value === 'object') {
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Snapshot não copiável.');
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copySnapshot(item)]));
  }
  if (typeof value === 'function' || typeof value === 'symbol') throw new TypeError('Snapshot não copiável.');
  return value;
}

// Only fulfilled, complete snapshots live here. No promises, timers or storage:
// a recreated data source can reuse data without borrowing an old token provider.
export function createReportSessionCache() {
  const snapshots = new Map(), versions = new Map(), queries = new Map();
  let revision = 0;
  function invalidate(namespace) {
    if (namespace === undefined) {
      revision++;
      snapshots.clear(); versions.clear(); queries.clear();
    } else {
      versions.set(namespace, (versions.get(namespace) || 0) + 1);
      snapshots.delete(namespace); queries.delete(namespace);
    }
  }
  function wrap(namespace, source, assertCurrent = () => {}) {
    const wrapped = { ...source };
    for (const [method, value] of Object.entries(wrapped)) {
      if (typeof value === 'function') wrapped[method] = value.bind(source);
    }
    for (const method of SNAPSHOT_READS) {
      if (typeof source?.[method] !== 'function') continue;
      wrapped[method] = async (...args) => {
        const signal = args.at(-1)?.signal;
        const assertValid = () => { assertCurrent(); if (signal?.aborted) throw cancelled(); };
        assertValid();
        const keyArgs = args.map(keyValue);
        const optionsIndex = method === 'loadDetails' || method === 'loadPaymentsForPayrollIds' ? 1 : 0;
        keyArgs[optionsIndex] ??= {};
        const key = JSON.stringify([method, ...keyArgs]);
        const entries = snapshots.get(namespace);
        if (entries?.has(key)) {
          const snapshot = copySnapshot(entries.get(key));
          assertValid();
          return snapshot;
        }
        const targetRevision = revision, targetVersion = versions.get(namespace) || 0;
        const request = {};
        if (!queries.has(namespace)) queries.set(namespace, new Map());
        queries.get(namespace).set(key, request);
        const assertQuery = () => {
          assertValid();
          if (revision !== targetRevision || (versions.get(namespace) || 0) !== targetVersion
            || queries.get(namespace)?.get(key) !== request) throw cancelled();
        };
        try {
          const snapshot = await source[method](...args);
          assertQuery();
          if (snapshot && typeof snapshot === 'object' && snapshot.complete !== false
            && !snapshot.hasMore && !snapshot.partial && !snapshot.incomplete
            && !snapshot.aborted && !snapshot.truncated && !snapshot.error) {
            // Keep a private copy and return fresh copies on hits. Providers or
            // consumers may mutate injected snapshots after fulfillment.
            try {
              const stored = copySnapshot(snapshot);
              if (!snapshots.has(namespace)) snapshots.set(namespace, new Map());
              snapshots.get(namespace).set(key, stored);
            } catch { /* Uncopyable injected data is usable, but never cached. */ }
          }
          return snapshot;
        } catch (error) { assertQuery(); throw error; }
        finally {
          if (queries.get(namespace)?.get(key) === request) queries.get(namespace).delete(key);
        }
      };
    }
    return wrapped;
  }
  return Object.freeze({ wrap, invalidate, reset: () => invalidate() });
}
