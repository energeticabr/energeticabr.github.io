function check(signal) {
  if (signal?.aborted) throw new DOMException('Acompanhamento encerrado.', 'AbortError');
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
  const deadline = now() + timeoutMs;
  const request = async callback => {
    check(signal); assertSession();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 35_000);
    try {
      const result = await callback(controller.signal);
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
    if (state.status === 'succeeded') return state;
    if (!['queued', 'running'].includes(state.status)) throw new Error('A consulta ao Sicoob ou a gravação no SharePoint não foi concluída. Tente novamente.');
    onStatus(state.status === 'queued' ? 'Aguardando o início da consulta ao Sicoob…' : 'Consultando o Sicoob e atualizando o SharePoint. Isso pode levar alguns minutos…');
    await delay(3000, signal);
    check(signal);
    if (now() >= deadline) throw new Error('A consulta ao Sicoob demorou além do esperado. Clique em sincronizar para verificar novamente.');
    state = await request(signal => client.getDdaRefreshStatus(id, { signal }));
  }
}
