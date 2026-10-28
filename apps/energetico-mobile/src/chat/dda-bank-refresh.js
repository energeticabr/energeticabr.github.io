function check(signal) {
  if (signal?.aborted) throw new DOMException('Acompanhamento encerrado.', 'AbortError');
}
export function formatDdaElapsed(ms) {
  const seconds = Math.floor(Math.max(0, Number(ms) || 0) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    check(signal);
    const abort = () => { clearTimeout(timer); reject(new DOMException('Acompanhamento encerrado.', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
export async function refreshDdaBank(client, { signal, onStatus = () => {}, assertSession = () => {},
  delay = pause, now = Date.now, timeoutMs = 45 * 60_000 } = {}) {
  const started = now();
  const deadline = started + timeoutMs;
  const request = async callback => {
    check(signal); assertSession();
    const controller = new AbortController();
    let rejectWait;
    const cancelled = new Promise((_, reject) => { rejectWait = reject; });
    const abort = () => { controller.abort(); rejectWait(new DOMException('Acompanhamento encerrado.', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => {
      rejectWait(new Error('A conexão não respondeu a tempo. Não foi possível confirmar o resultado da consulta.'));
      controller.abort();
    }, 35_000);
    try {
      const result = await Promise.race([callback(controller.signal), cancelled]);
      check(signal); assertSession(); return result;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  };
  if (typeof client?.refreshDda !== 'function' || typeof client?.getDdaRefreshStatus !== 'function') {
    throw new Error('A consulta ao Sicoob está indisponível.');
  }
  let state = await request(signal => client.refreshDda({ signal }));
  const id = state?.requestId;
  while (true) {
    check(signal); assertSession();
    if (state?.status === 'unavailable') throw new Error('O computador responsável pela consulta ao Sicoob está indisponível. Mantenha-o ligado e com a sessão iniciada.');
    if (state?.status === 'busy') throw new Error('Já existe uma consulta ao Sicoob em andamento. Tente novamente após a conclusão.');
    if (!/^[a-f0-9]{32}$/.test(String(id || '')) || state?.requestId !== id) throw new Error('O Sicoob não teve a atualização confirmada.');
    if (state.status === 'succeeded') return { ...state, elapsedMs: Math.max(0, now() - started) };
    if (!['queued', 'running'].includes(state.status)) throw new Error('A consulta ao Sicoob ou a gravação no SharePoint não foi concluída. Tente novamente.');
    const phase = state.status === 'queued' ? 'Aguardando o início da consulta ao Sicoob.' : 'Consultando o Sicoob e atualizando o SharePoint.';
    onStatus(`${phase} Tempo decorrido: ${formatDdaElapsed(now() - started)}. A consulta completa costuma levar de 10 a 15 minutos; pode demorar mais se houver outra consulta na fila. Você receberá uma confirmação ao terminar.`);
    await delay(3000, signal);
    check(signal);
    if (now() >= deadline) throw new Error('A consulta ao Sicoob demorou além do esperado. Clique em sincronizar para verificar novamente.');
    state = await request(signal => client.getDdaRefreshStatus(id, { signal }));
  }
}
