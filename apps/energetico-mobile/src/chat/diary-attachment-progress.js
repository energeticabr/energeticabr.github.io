import { attachmentFinishOption } from './attachment-finish.js';

export function isDiaryAttachmentFinalization(flow, poll, text, replyId) {
  if (!/^construction_diary_(?:create|fill|photo_append)$/.test(String(flow?.id || ''))) return false;
  if (replyId === 'diary_finish') return true;
  const finish = attachmentFinishOption(poll);
  if (!finish) return false;
  const id = String(finish.reply || finish.replyId || finish.id || '');
  return replyId ? replyId === id : /^finalizar(?:\s+anexos)?$/i.test(String(text || '').trim());
}

export function startDiaryProgress({ read, onProgress, signal }) {
  let stopped = false, polling = true, percent = 0, timer, pending;
  const publish = value => {
    if (stopped || signal?.aborted) return;
    try { onProgress(value); } catch { /* Optional presentation never blocks the mutation. */ }
  };
  publish({ percent: 0, stage: 'starting', status: 'running' });
  const stopPolling = () => {
    polling = false;
    clearTimeout(timer);
    pending?.abort();
  };
  const stop = () => {
    stopped = true;
    stopPolling();
    signal?.removeEventListener('abort', stop);
  };
  const poll = async () => {
    if (stopped || !polling || signal?.aborted) return;
    pending = new AbortController();
    const timeout = setTimeout(() => pending?.abort(), 8000);
    try {
      const value = await read(pending.signal);
      if (stopped || signal?.aborted) return;
      if (typeof value.percent === 'number' && Number.isFinite(value.percent) && value.percent >= 0 && value.percent <= 100) {
        percent = Math.max(percent, Math.min(99, Math.floor(value.percent)));
        publish({ ...value, percent });
      }
      if (value.status === 'failed') { stopPolling(); return; }
    } catch {
      // Old servers and optional telemetry failures do not fail/retry the main request.
      stopPolling();
    } finally { clearTimeout(timeout); pending = null; }
    if (!stopped && polling) timer = setTimeout(poll, 1000);
  };
  signal?.addEventListener('abort', stop, { once: true });
  if (!signal?.aborted) timer = setTimeout(poll, 1000);
  return {
    stop,
    complete(value) {
      if (value?.status === 'complete' && value.percent === 100) publish(value);
    },
  };
}

export async function paintDiaryCompletion() {
  if (typeof globalThis.requestAnimationFrame !== 'function') return;
  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 150);
    globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(() => {
      clearTimeout(timeout); resolve();
    }));
  });
}
