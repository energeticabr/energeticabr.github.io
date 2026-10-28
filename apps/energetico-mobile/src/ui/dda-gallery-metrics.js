import { buildDdaGalleryMetrics } from '../chat/dda-gallery-metrics.js';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const timestamp = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
const shortDay = value => value.slice(8, 10) + '/' + value.slice(5, 7);

export function createDdaGalleryMetrics(doc) {
  const root = doc.createElement('section');
  root.className = 'rg-dda-metrics';
  root.setAttribute('aria-label', 'Resumo dos DDAs da empresa');
  const values = new Map(), details = new Map();
  for (const [key, label] of [['communication', 'Última comunicação Sicoob'], ['total', 'Total pendente DDA'], ['today', 'Pendente vencendo hoje'], ['week', 'Pendente nesta semana']]) {
    const tile = doc.createElement('div'); tile.className = 'rg-dda-summary-tile'; tile.dataset.ddaMetric = key;
    const title = doc.createElement('span'); title.className = 'rg-dda-summary-tile__label'; title.textContent = label;
    const value = doc.createElement('strong'); value.className = 'rg-dda-summary-tile__value'; value.textContent = '—';
    const detail = doc.createElement('small'); detail.className = 'rg-dda-summary-tile__detail';
    tile.append(title, value, detail); root.append(tile); values.set(key, value); details.set(key, detail);
  }
  const note = doc.createElement('p'); note.className = 'rg-dda-metrics__note'; root.append(note);
  function update(snapshot, { stale = false, now = new Date() } = {}) {
    let metrics;
    try { metrics = buildDdaGalleryMetrics(snapshot, now); } catch { /* No misleading zero for unavailable/incomplete data. */ }
    for (const key of ['total', 'today', 'week']) values.get(key).textContent = metrics ? metrics[key] == null ? 'Não apurado' : currency.format(metrics[key]) : 'Indisponível';
    values.get('communication').textContent = metrics?.lastCommunication ? timestamp.format(new Date(metrics.lastCommunication)) : 'Sem registro';
    details.get('communication').textContent = 'Última consulta registrada nos DDAs · Brasília';
    details.get('total').textContent = 'Em aberto e agendados';
    details.get('today').textContent = metrics ? shortDay(metrics.todayKey) : '';
    details.get('week').textContent = metrics ? `${shortDay(metrics.weekStart)} a ${shortDay(metrics.weekEnd)} · domingo a sexta` : 'Domingo a sexta';
    note.textContent = !metrics ? 'Não foi possível apurar o resumo da base completa.'
      : `${stale ? 'Falha ao atualizar: valores da última base disponível. ' : ''}Totais da base completa, sem os filtros. Valor para pagamento; na ausência, valor nominal.`
        + (metrics.unknownCount ? ` ${metrics.unknownCount} DDA(s) com situação não confirmada fora dos totais.` : '');
  }
  return { root, update };
}
