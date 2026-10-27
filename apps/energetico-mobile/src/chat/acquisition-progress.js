const LABEL = 'Etapas de aquisição de dados concluídas';

export function notifyAcquisitionProgress(onProgress, value) {
  if (typeof onProgress !== 'function') return;
  try {
    Promise.resolve(onProgress(value)).catch(() => {});
  } catch { /* Observers must never fail or retry a read or a business write. */ }
}

// Each invocation owns a finite stage plan. Unknown page totals only report
// completed pages/records; safety ceilings and elapsed time are never work units.
// 100 means acquisition finished, not that the UI accepted/presented the result.
export function createAcquisitionProgress({ onProgress, signal, isCurrent = () => true } = {}, stages, assertSession = () => {}) {
  const values = new Map(stages.map(stage => [stage, 0]));
  const check = () => {
    if (signal?.aborted) throw signal.reason || new DOMException('Consulta cancelada.', 'AbortError');
    assertSession();
  };
  const emit = (stage, details) => {
    check();
    if (!isCurrent()) return;
    const completed = [...values.values()].reduce((sum, value) => sum + value, 0);
    notifyAcquisitionProgress(onProgress, Object.freeze({ ...details, stage, phase: stage,
      completed, total: values.size, percent: Math.floor(completed * 100 / values.size),
      label: LABEL, progressLabel: LABEL }));
  };
  const progress = {
    check,
    report(stage, details = {}) { emit(stage, details); },
    step(stage, details = {}) {
      check();
      values.set(stage, 1);
      emit(stage, details);
    },
    units(stage, completed, total, unit = 'registros', details = {}) {
      check();
      if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0 || completed < 0 || completed > total) return;
      values.set(stage, Math.max(values.get(stage) || 0, completed / total));
      emit(stage, { ...details, units: Object.freeze({ completed, total, unit }) });
    },
    forward(stage) {
      return value => progress.units(stage, value?.completed, value?.total, 'etapas', { source: value });
    },
    // A caller can stop observing shared cached work without cancelling peers.
    wait(promise) {
      if (!signal) return promise;
      return new Promise((resolve, reject) => {
        const cancel = () => reject(signal.reason || new DOMException('Consulta cancelada.', 'AbortError'));
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
        Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', cancel));
      });
    },
  };
  check();
  return Object.freeze(progress);
}
