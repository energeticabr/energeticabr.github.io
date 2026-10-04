import { registrationFieldKey } from '../chat/registration-gallery-data.js';

const ICONS = Object.freeze({
  branch: ['M4 21V3h12v18', 'M16 9h4v12', 'M2 21h20', 'M8 7h4', 'M8 11h4', 'M8 15h4'],
  status: ['M9 3h6v4H9z', 'M9 5H5v16h14V5h-4', 'm8 14 3 3 5-6'],
  weather: ['M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8', 'M12 2v2m0 16v2M2 12h2m16 0h2M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2'],
  type: ['m3 8 9-5 9 5-9 5-9-5Z', 'm3 13 9 5 9-5', 'm3 18 9 5 9-5'],
  stage: ['M3 3v18h18L3 3Z', 'M7 12v5h5'],
  activity: ['M4 14a8 8 0 0 1 16 0', 'M12 4v7M7 7v5m10-5v5', 'M2 14h20v3H2z', 'M5 18v3h14v-3'],
  notes: ['M21 11a9 8 0 0 1-9 8H7l-4 3v-6a8 8 0 0 1-1-5 9 8 0 0 1 19 0Z', 'M8 11h.01M12 11h.01M16 11h.01'],
  person: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 22v-2a8 8 0 0 1 16 0v2'],
  calendar: ['M4 5h16v16H4z', 'M8 2v6M16 2v6M4 10h16'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 6v6l4 2'],
});

// Text is always inserted as textContent, including rich-looking source notes.
export function renderWorkDiaryCardDetails({ document: doc, container, rowId, title, value }) {
  const el = (tag, className, text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const icon = name => {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, val] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, val);
    svg.classList.add('rg-diary-icon');
    for (const d of ICONS[name]) {
      const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path);
    }
    return svg;
  };
  const heading = el('div', 'rg-diary-heading');
  heading.append(el('strong', 'rg-row-title', title), el('span', 'rg-document-id', `ID ${rowId}`));
  container.append(heading);
  const table = el('dl', 'rg-diary-table');
  const pair = (parent, field, label, symbol, fallback = '—') => {
    const row = el('div', 'rg-diary-detail'); row.dataset.field = field;
    row.append(icon(symbol), el('dt', '', label), el('dd', '', String(value(field) || fallback).trim() || fallback));
    parent.append(row); return row.querySelector('dd');
  };
  pair(table, 'FILIAL', 'Filial', 'branch');
  const status = pair(table, 'STATUS', 'Status', 'status');
  status.classList.add('rg-diary-status');
  if (['concluido', 'concluida'].includes(registrationFieldKey(status.textContent))) status.classList.add('rg-diary-status--complete');
  const weather = pair(table, 'INFORMAÇÕES CLIMÁTICAS', 'Informações climáticas', 'weather');
  const label = weather.textContent, key = registrationFieldKey(label);
  const tone = key === 'ensolarado' ? 'sun' : ['chuvoso', 'poucochuvoso', 'muitochuvoso'].includes(key) ? 'rain' : 'neutral';
  const emoji = tone === 'sun' ? '☀️' : tone === 'rain' ? '🌧️' : key === 'nublado' ? '☁️' : '';
  weather.className = 'rg-diary-weather'; weather.dataset.weather = tone; weather.replaceChildren();
  if (emoji) { const symbol = el('span', 'rg-diary-weather__icon', emoji); symbol.setAttribute('aria-hidden', 'true'); weather.append(symbol); }
  weather.append(el('span', 'rg-diary-weather__label', label));
  pair(table, 'TIPO', 'Tipo', 'type');
  pair(table, 'ETAPA', 'Etapa', 'stage');
  pair(table, 'ATIVIDADES EXECUTADAS', 'Atividade executada', 'activity');
  pair(table, 'OBSERVAÇÕES', 'Observações', 'notes');
  const audit = el('dl', 'rg-diary-audit');
  pair(audit, 'Criado por', 'Criado por', 'person', 'Usuário não identificado');
  pair(audit, 'Criado', 'Criado em', 'calendar');
  pair(audit, 'Modificado', 'Modificado em', 'clock');
  pair(audit, 'Modificado por', 'Modificado por', 'person', 'Usuário não identificado');
  container.append(table, audit);
}
