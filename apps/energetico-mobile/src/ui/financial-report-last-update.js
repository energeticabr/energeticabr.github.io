const formatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
});

export function createFinancialReportLastUpdate(doc, { fiscal = false, labelText = 'Última atualização', loadLatestUpdate, onAdvance } = {}) {
  const element = doc.createElement('div');
  element.className = fiscal ? 'nfe-pair' : 'ddr-metric';
  element.dataset.reportLastUpdate = '';
  element.title = 'Horário de Brasília';
  const label = doc.createElement(fiscal ? 'dt' : 'span');
  label.textContent = labelText;
  const value = doc.createElement(fiscal ? 'dd' : 'strong');
  const time = doc.createElement('time');
  time.textContent = '—';
  value.append(time);
  element.append(label, value);
  let latest = -Infinity, latestFallback = -Infinity, timer, request;
  function display(at) {
    const date = new Date(at);
    time.dateTime = date.toISOString();
    time.textContent = formatter.format(date);
  }
  function update(at) {
    if (!Number.isFinite(at) || at <= latest || !Number.isFinite(new Date(at).getTime())) return false;
    latest = at;
    display(at);
    return true;
  }

  async function read() {
    if (doc.visibilityState === 'hidden' || request) return;
    const active = request = new AbortController();
    const timeout = doc.defaultView.setTimeout(() => active.abort(), 35000);
    try {
      const at = await loadLatestUpdate({ signal: active.signal });
      if (request === active && !active.signal.aborted && update(at)) onAdvance?.();
    } catch {
      // Keep the last confirmed time if the status read fails.
    } finally {
      doc.defaultView.clearTimeout(timeout);
      if (request === active) request = null;
    }
  }

  return {
    element,
    update,
    fallback(at) {
      if (latest === -Infinity && Number.isFinite(at) && at > latestFallback) {
        latestFallback = at;
        display(at);
      }
    },
    open() {
      if (!loadLatestUpdate || timer !== undefined) return;
      doc.addEventListener('visibilitychange', read);
      timer = doc.defaultView.setInterval(read, 60000);
      void read();
    },
    close() {
      if (timer === undefined) return;
      doc.removeEventListener('visibilitychange', read);
      doc.defaultView.clearInterval(timer);
      timer = undefined;
      request?.abort();
      request = null;
    },
  };
}
