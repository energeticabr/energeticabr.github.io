import { registrationFieldKey } from '../chat/registration-gallery-data.js';

const ICONS = {
  calendar: ['M4 5h16v16H4z', 'M8 2v6M16 2v6M4 10h16', 'M8 14h.01M12 14h.01M16 14h.01'],
  person: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 22v-2a8 8 0 0 1 16 0v2'],
  branch: ['M4 21V3h12v18', 'M16 9h4v12M2 21h20M8 7h4M8 11h4M8 15h4'],
  supplier: ['M3 10h18l-2-7H5l-2 7Z', 'M5 10v11h14V10M10 21v-7h4v7'],
  tag: ['m3 12 9-9h9v9l-9 9-9-9Z', 'M16 7h.01'],
  box: ['m3 7 9-5 9 5-9 5-9-5Z', 'M3 7v10l9 5 9-5V7M12 12v10'],
  depreciation: ['M4 5c0-4 16-4 16 0s-16 4-16 0Z', 'M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0'],
  status: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'm7 12 3 3 7-7'],
};

/** Presentation only: formatted financial/date/audit values come from the gallery. */
export function renderAssetGalleryCard({ document: doc, container, rowId, title, value }) {
  const el = (tag, className, text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const icon = name => {
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, val] of Object.entries({ viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(key, val);
    svg.classList.add('rg-asset-icon');
    for (const d of ICONS[name]) { const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); svg.append(path); }
    return svg;
  };
  const pair = (parent, field, label, symbol, text = value(field)) => {
    const row = el('div', 'rg-detail rg-asset-detail'); row.dataset.field = field;
    if (symbol) row.append(icon(symbol));
    row.append(el('dt', '', label), el('dd', '', String(text ?? '').trim() || '—'));
    parent.append(row); return row;
  };
  const heading = el('div', 'rg-asset-heading');
  heading.append(el('strong', 'rg-row-title', title), el('span', 'rg-document-id', `ID ${rowId}`));
  container.append(heading);

  const amounts = el('dl', 'rg-asset-values'); amounts.setAttribute('aria-label', 'Valores do imobilizado');
  for (const [field, label, tone] of [['VALOR ESTIMADO', 'Valor compra', 'purchase'], ['VALOR DEPRECIADO', 'Valor depreciado', 'depreciated'], ['VALOR RESIDUAL', 'Valor residual', 'residual']]) {
    pair(amounts, field, label).classList.add(`rg-asset-value--${tone}`);
  }
  container.append(amounts);

  const flags = el('dl', 'rg-asset-flags');
  const depreciate = registrationFieldKey(value('DEPRECIAR'));
  const yes = ['sim', 'true', '1'].includes(depreciate), no = ['nao', 'no', 'false', '0'].includes(depreciate);
  pair(flags, 'DEPRECIAR', 'Depreciar', 'depreciation', yes ? 'SIM' : no ? 'NÃO' : value('DEPRECIAR')).dataset.tone = yes ? 'success' : no ? 'danger' : 'neutral';
  const status = registrationFieldKey(value('STATUS'));
  pair(flags, 'STATUS', 'Status', 'status').dataset.tone = status === 'ativo' ? 'success' : status === 'inativo' ? 'danger' : 'neutral';
  container.append(flags);

  const dates = el('dl', 'rg-asset-dates');
  for (const [field, label] of [['DATA DEPRECIAÇÃO', 'Próxima depreciação'], ['DATA CADASTRO', 'Data cadastro'], ['DATA COMPRA', 'Data compra'], ['Criado', 'Criado'], ['Modificado', 'Modificado']]) {
    if (value(field)) pair(dates, field, label, 'calendar');
  }
  if (dates.children.length) container.append(dates);
  const details = el('dl', 'rg-asset-details');
  for (const [field, label, symbol] of [['NÚMEROIMOBILIZADO', 'Número patrimônio', 'tag'], ['FORNECEDOR', 'Fornecedor', 'supplier'], ['FILIAL', 'Filial', 'branch'], ['QTD', 'Quantidade', 'box'], ['Criado por', 'Criado por', 'person'], ['Modificado por', 'Modificado por', 'person']]) {
    if (value(field)) pair(details, field, label, symbol);
  }
  if (details.children.length) container.append(details);
}
