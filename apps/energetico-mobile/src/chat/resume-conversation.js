function cancellation(signal) {
  return signal?.reason instanceof Error ? signal.reason : new DOMException('Retomada cancelada.', 'AbortError');
}

function check(signal) {
  if (signal?.aborted) throw cancellation(signal);
}

async function cancelable(promise, signal) {
  if (!signal) return promise;
  let cancel;
  const aborted = new Promise((_, reject) => {
    cancel = () => reject(cancellation(signal));
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
  });
  try { return await Promise.race([promise, aborted]); }
  finally { signal.removeEventListener('abort', cancel); }
}

function retryable(error) {
  return error instanceof TypeError || ['NetworkError', 'AbortError'].includes(error?.name)
    || ['NETWORK_UNAVAILABLE', 'NETWORK_UNCERTAIN', 'RESUME_TIMEOUT'].includes(error?.code)
    || [408, 425, 500, 502, 503, 504].includes(Number(error?.status));
}

function timeoutError() {
  return Object.assign(new Error('A retomada demorou demais. Seu rascunho foi preservado; tente novamente.'), { code: 'RESUME_TIMEOUT' });
}

// Only the current-question control query is retried. User answers, uploads,
// confirmations and the controller's subsequent automatic actions stay outside.
export async function resumeConversation(client, { signal, timeoutMs = 15_000, maxWaitMs = 30_000, retryDelay,
  onEvidenceProgress, ...options } = {}) {
  const deadline = Math.max(1, Number(timeoutMs) || 15_000);
  const lifetime = new AbortController();
  const cancelLifetime = () => lifetime.abort(cancellation(signal));
  check(signal);
  signal?.addEventListener('abort', cancelLifetime, { once: true });
  const progressByStage = new Map();
  let totalTimer;
  const touchTotal = () => {
    clearTimeout(totalTimer);
    totalTimer = setTimeout(() => lifetime.abort(timeoutError()), Math.max(1, Number(maxWaitMs) || 30_000));
  };
  touchTotal();
  try {
  for (let attempt = 0; ; attempt++) {
    check(lifetime.signal);
    const request = new AbortController();
    const cancel = () => request.abort(cancellation(lifetime.signal));
    lifetime.signal.addEventListener('abort', cancel, { once: true });
    let timer;
    const touch = () => {
      clearTimeout(timer);
      timer = setTimeout(() => request.abort(timeoutError()), deadline);
    };
    touch();
    try {
      const work = (async () => {
        if (typeof client.waitForDiaryEvidence === 'function') {
          await client.waitForDiaryEvidence({ signal: request.signal, onProgress: value => {
            if (request.signal.aborted) return;
            const key = JSON.stringify([value?.requestId, value?.stage]);
            const percent = Number.isFinite(value?.percent) ? value.percent : -1;
            if (!progressByStage.has(key) || percent > progressByStage.get(key)) {
              progressByStage.set(key, percent); touch(); touchTotal();
            }
            onEvidenceProgress?.(value);
          } });
        }
        check(request.signal);
        const result = await client.sendText({ text: '', replyId: 'input_continue' }, {
          ...options, progressSignal: request.signal,
          ...(typeof options.onOperationProgress === 'function' ? { onOperationProgress: value => {
            if (!request.signal.aborted) options.onOperationProgress(value);
          } } : {}),
        });
        check(request.signal);
        return result;
      })();
      return await cancelable(work, request.signal);
    } catch (error) {
      check(lifetime.signal);
      if (!retryable(error)) throw error;
      if (attempt >= 2) throw Object.assign(new Error(
        'Não foi possível restabelecer a conexão com a VM. Seu rascunho foi preservado; toque em Retomar conversa para tentar novamente.',
        { cause: error }), { code: 'RESUME_CONNECTION_FAILED' });
    } finally {
      clearTimeout(timer);
      lifetime.signal.removeEventListener('abort', cancel);
      request.abort();
    }
    const ms = (attempt + 1) * 750;
    if (retryDelay) await cancelable(Promise.resolve().then(() => retryDelay(ms)), lifetime.signal);
    else {
      let timer;
      try { await cancelable(new Promise(resolve => { timer = setTimeout(resolve, ms); }), lifetime.signal); }
      finally { clearTimeout(timer); }
    }
  }
  } finally {
    clearTimeout(totalTimer);
    signal?.removeEventListener('abort', cancelLifetime);
    lifetime.abort();
  }
}
