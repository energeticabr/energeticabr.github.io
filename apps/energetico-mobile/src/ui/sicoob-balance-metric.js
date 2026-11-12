const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const consultationTime = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
});

export function createSicoobBalanceMetric(doc, loadBalance, label = 'Saldo em conta corrente') {
  const element = doc.createElement('div');
  element.className = 'ddr-metric';
  element.dataset.sicoobBalance = '';
  element.dataset.reportScreenOnly = '';
  const heading = doc.createElement('span');
  heading.textContent = label;
  const value = doc.createElement('strong');
  value.setAttribute('role', 'status');
  const time = doc.createElement('time');
  time.title = 'Horário da consulta em Brasília';
  element.append(heading, value, time);

  let request;
  function show(balance, pending = false) {
    value.textContent = balance ? currency.format(balance.balanceCents / 100) : pending ? 'Consultando…' : 'Indisponível';
    time.hidden = !balance;
    time.dateTime = balance?.asOf ?? '';
    time.textContent = balance ? consultationTime.format(new Date(balance.asOf)) : '';
  }

  return {
    element,
    async refresh() {
      request?.abort();
      if (!loadBalance) {
        show(null);
        return;
      }
      const active = request = new AbortController();
      show(null, true);
      try {
        const balance = await loadBalance({ signal: active.signal });
        if (!active.signal.aborted) show(balance);
      } catch {
        if (!active.signal.aborted) show(null);
      }
    },
    clear() {
      request?.abort();
      request = null;
      show(null);
    },
  };
}
