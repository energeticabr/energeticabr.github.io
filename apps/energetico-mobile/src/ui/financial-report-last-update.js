const formatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short',
});

export function createFinancialReportLastUpdate(doc, { fiscal = false } = {}) {
  const element = doc.createElement('div');
  element.className = fiscal ? 'nfe-pair' : 'ddr-metric';
  element.dataset.reportLastUpdate = '';
  element.title = 'Horário de Brasília';
  const label = doc.createElement(fiscal ? 'dt' : 'span');
  label.textContent = 'Última atualização';
  const value = doc.createElement(fiscal ? 'dd' : 'strong');
  const time = doc.createElement('time');
  time.textContent = '—';
  value.append(time);
  element.append(label, value);
  let latest = -Infinity;
  return { element, update(at) {
    if (!Number.isFinite(at) || at <= latest) return;
    latest = at;
    const date = new Date(at);
    time.dateTime = date.toISOString();
    time.textContent = formatter.format(date);
  } };
}
