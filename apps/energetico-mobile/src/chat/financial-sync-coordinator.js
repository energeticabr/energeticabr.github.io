const labels = { sicoob: 'Transações Sicoob', dda: 'DDAs', fiscal: 'Notas fiscais' };
const statusLabels = { starting: 'solicitando', queued: 'na fila', running: 'consultando', waiting: 'aguardando', succeeded: 'atualização concluída', partial: 'atualização parcial', failed: 'atualização não concluída' };

/** One manual action starts every source. Each original monitor retains durable recovery. */
export function createFinancialSyncCoordinator(sources) {
  const states = {}, errors = {}, listeners = new Map(), facets = new Map();
  let starting = null, destroyed = false;
  const running = () => Boolean(starting) || Object.values(states).some(state => state.running);
  function snapshot(source) {
    const state = states[source] || {};
    const notice = Object.entries(labels).map(([key, label]) => {
      const item = states[key];
      const detail = errors[key] || item?.notice || statusLabels[item?.latest?.status]
        || (item?.running ? 'consultando' : 'nenhuma consulta em andamento');
      return `${label}: ${detail}`;
    }).join('\n');
    return { ...state, running: Boolean(starting) || Boolean(state.running), anyRunning: running(), sourceRunning: Boolean(state.running), notice };
  }
  function notify() {
    if (destroyed) return;
    for (const [source, callbacks] of listeners) for (const callback of callbacks) callback(snapshot(source));
  }
  const unsubscribe = Object.keys(labels).map(key => sources[key]?.subscribe(state => { states[key] = state; notify(); }));
  function start() {
    if (destroyed) return Promise.reject(Error('Sessão encerrada.'));
    if (starting) return starting;
    for (const key of Object.keys(errors)) delete errors[key];
    starting = Promise.resolve().then(async () => {
      if (destroyed) throw Error('Sessão encerrada.');
      await Promise.all(Object.keys(labels).map(async key => {
        try {
          if (!sources[key]) throw Error('Consulta indisponível nesta sessão.');
          // Join each pending source; a fiscal cooldown never blocks a fresh bank query.
          if (states[key]?.running) return;
          await sources[key].start();
        } catch (error) { errors[key] = error?.message || 'Não foi possível iniciar a consulta.'; }
      }));
    }).finally(() => { starting = null; notify(); });
    notify();
    return starting;
  }
  return {
    forSource(source) {
      if (!Object.hasOwn(labels, source)) throw Error('Fonte inválida.');
      if (!facets.has(source)) facets.set(source, {
        start,
        get running() { return Boolean(starting) || Boolean(states[source]?.running); },
        get sourceRunning() { return Boolean(states[source]?.running); },
        subscribe(callback) {
          if (!listeners.has(source)) listeners.set(source, new Set());
          listeners.get(source).add(callback); callback(snapshot(source));
          return () => listeners.get(source)?.delete(callback);
        },
      });
      return facets.get(source);
    },
    destroy() { destroyed = true; for (const stop of unsubscribe) stop?.(); listeners.clear(); },
  };
}
