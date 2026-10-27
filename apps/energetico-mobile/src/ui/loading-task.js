import { updateLoadingIndicator } from './loading-indicator.js';

// A finite work plan: prepared request, acquired result, accepted presentation.
// This percentage describes completed stages, never elapsed time.
const owners = new WeakMap();
const STAGES = 3;
const LABEL = 'Progresso por etapas concluídas';

export function beginLoadingTask(target, { signal, isCurrent = () => true, progressLabel = LABEL } = {}) {
  const identity = {};
  if (target && (typeof target === 'object' || typeof target === 'function')) owners.set(target, identity);
  let stopped = false, previous = -1, acquired = false;
  const live = () => !stopped && !signal?.aborted && isCurrent()
    && owners.get(target) === identity;
  const emit = completed => {
    if (!live()) return;
    const percent = Math.floor(completed * 100 / STAGES);
    if (percent <= previous) return;
    previous = percent;
    const value = { percent, completed, total: STAGES, progressLabel };
    try {
      if (typeof target === 'function') Promise.resolve(target(value)).catch(() => {});
      else {
        const roots = target?.matches?.('.app-loading') ? [target] : target?.querySelectorAll?.('.app-loading') || [];
        for (const root of roots) updateLoadingIndicator(root, { progress: percent, progressLabel });
      }
    } catch { /* Optional presentation must never fail or repeat the operation. */ }
  };
  const stop = () => { stopped = true; signal?.removeEventListener('abort', stop); };
  signal?.addEventListener('abort', stop, { once: true });
  emit(0);
  const task = {
    prepared: () => emit(1),
    report(value) {
      const percent = value?.percent;
      if (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 100) return;
      emit(1 + percent / 100);
    },
    units(completed, total) {
      if (!Number.isFinite(completed) || !Number.isFinite(total) || total <= 0 || completed < 0 || completed > total) return;
      task.report({ percent: completed * 100 / total });
    },
    acquired() { acquired = true; emit(2); },
    complete() { if (acquired) emit(STAGES); stop(); },
    stop,
    async run(work, present = value => value) {
      task.prepared();
      try {
        const value = await work(task.report);
        task.acquired();
        const result = await present(value);
        task.complete();
        return result;
      } catch (error) { stop(); throw error; }
    },
  };
  return Object.freeze(task);
}
