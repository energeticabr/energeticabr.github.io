const ICONS = {
  document: ['M5 2h9l5 5v15H5z', 'M14 2v6h5M8 12h8M8 16h8'],
  series: ['M3 4v16M6 4v16M10 4v16M13 4v16M17 4v16M21 4v16'],
  calendar: ['M4 5h16v16H4z', 'M8 2v6M16 2v6M4 10h16M8 14h.1M12 14h.1M16 14h.1'],
  person: ['M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M4 22v-2a8 8 0 0 1 16 0v2'],
  location: ['M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 0 1 16 0Z', 'M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z'],
  money: ['m8 3 2 5h4l2-5H8Z', 'M9 8C1 17 4 22 12 22s11-5 3-14', 'M14 12h-3a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4h-3M12 11v10'],
  coins: ['M4 5c0-4 16-4 16 0s-16 4-16 0Z', 'M4 5v13c0 4 16 4 16 0V5M4 10c0 4 16 4 16 0M4 14c0 4 16 4 16 0'],
  tag: ['M3 3h8l10 10-8 8L3 11V3Z', 'M7 7h.1'],
  notes: ['M3 3h18v14H8l-5 4V3Z', 'M7 7h10M7 12h8'],
  truck: ['M2 5h12v13H2zM14 10h5l3 4v4h-8', 'M8 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0M21 19a2 2 0 1 1-4 0 2 2 0 0 1 4 0'],
  taxes: ['M4 20V12M10 20V7M16 20V3M22 20V9'],
  copy: ['M9 3h12v14H9z', 'M5 7H3v14h12v-2'],
};

function icon(doc, name) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.7', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true', focusable: 'false'})) svg.setAttribute(key, value);
  svg.classList.add('rg-sefaz-icon');
  for (const d of ICONS[name]) { const path = doc.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', d); svg.append(path); }
  return svg;
}

import { SEFAZ_RETENTION_FIELDS } from '../chat/sefaz-withholding.js';

/** Presentation only: move the existing formatted fields and authenticated links. */
export function decorateSefazInvoiceCard({document: doc, container, pdfRail, withholding, fiscalType}) {
  const el = (tag, className, text) => { const node = doc.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const heading = container.querySelector('.rg-document-heading');
  heading.classList.add('rg-sefaz-heading');
  heading.prepend(pdfRail);
  const identity = el('div', 'rg-sefaz-identity');
  const title = heading.querySelector('.rg-row-title');
  title.before(identity); identity.append(el('span', 'rg-sefaz-type', fiscalType || 'Tipo pendente'), title);
  const remaining = container.querySelector(':scope > .rg-details');
  const take = field => container.querySelector(`[data-field="${field}"]`);
  const decorate = (field, symbol, tone = '') => {
    const pair = take(field);
    if (!pair) return null;
    pair.classList.add('rg-sefaz-field');
    if (tone) pair.classList.add(`rg-sefaz-field--${tone}`);
    if (symbol) pair.prepend(icon(doc, symbol));
    return pair;
  };
  const cluster = (name, fields) => {
    const group = el('dl', `rg-details rg-sefaz-${name}`);
    for (const [field, symbol, tone] of fields) { const pair = decorate(field, symbol, tone); if (pair) group.append(pair); }
    return group;
  };
  const core = el('div', 'rg-sefaz-clusters');
  core.append(
    cluster('identification', [['NUMERO_NOTA', 'document'], ['SERIE', 'series'], ['DATA_EMISSAO', 'calendar']]),
    cluster('supplier', [['CNPJ_FORNECEDOR', 'person'], ['UF_FORNECEDOR', 'location']]),
    cluster('amounts', [['VALOR_TOTAL_NOTA', 'money', 'total'], ['VALOR_LIQUIDO', 'coins', 'net'], ['DESCONTOS', 'tag', 'discount']]),
  );
  container.insertBefore(core, remaining);
  if (withholding) {
    const money = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
    const warning = el('div', 'rg-sefaz-withholding');
    warning.setAttribute('role', 'note');
    warning.append(el('strong', '', `Retenção pelo comprador • ${money.format(withholding.total)}`),
      el('span', '', withholding.amounts.map(item => `${item.label}: ${money.format(item.cents / 100)}`).join(' • ')));
    container.insertBefore(warning, core);
  }
  const other = el('details', 'rg-fiscal-section'); other.dataset.fiscalSection = 'other';
  other.append(el('summary', 'rg-fiscal-section__summary', 'Outras informações'));
  remaining.classList.add('rg-fiscal-section__content', 'rg-sefaz-other');
  other.append(remaining); container.append(other);
  for (const section of container.querySelectorAll('[data-fiscal-section]')) {
    section.classList.add('rg-sefaz-section');
    const summary = section.querySelector('summary'), label = summary.textContent;
    const name = {notes: 'notes', operation: 'truck', taxes: 'taxes', other: 'document'}[section.dataset.fiscalSection];
    summary.replaceChildren(icon(doc, name), el('span', '', label));
  }
  for (const [field, tone] of [['OBSERVACOES_NOTA', 'notes'], ['INFORMACOES_FISCO', 'fisco'], ['ICMS', 'tax-blue'], ['ISS', 'tax-purple'], ['IPI', 'tax-purple'], ['FRETE', 'tax-yellow'], ['SEGURO', 'tax-rose'], ['OUTRAS_DESPESAS', 'expenses']]) decorate(field, field === 'OBSERVACOES_NOTA' ? 'notes' : field === 'INFORMACOES_FISCO' ? 'document' : null, tone);
  for (const field of ['NATUREZA_OPERACAO', 'DESTINATARIO', 'CNPJ_DESTINATARIO', 'VALOR_PRODUTOS', 'TOMADOR', 'CNPJ_TOMADOR', 'PAPEL_EMPRESA', 'DESCRICAO_SERVICO', 'MUNICIPIO_PRESTACAO', 'CODIGO_SERVICO', 'VALOR_SERVICOS']) decorate(field);
  const taxFields = container.querySelector('[data-fiscal-section="taxes"] > dl');
  for (const field of ['ICMS', 'IPI', 'ISS', 'FRETE', 'SEGURO', 'OUTRAS_DESPESAS']) { const pair = take(field); if (pair) taxFields.append(pair); }
  for (const field of ['STATUS_RETENCOES', ...Object.keys(SEFAZ_RETENTION_FIELDS)]) {
    const pair = decorate(field, null, field === 'STATUS_RETENCOES' ? 'expenses' : 'tax-rose');
    if (pair) taxFields.append(pair);
  }
  const retentionStatus = take('STATUS_RETENCOES')?.querySelector('dd');
  if (retentionStatus?.textContent === 'RETENCAO_INFORMADA_XML') retentionStatus.textContent = 'Retenção informada no XML';
  if (retentionStatus?.textContent === 'NAO_INFORMADA_XML') retentionStatus.textContent = 'Não informada no XML';
  for (const field of ['TIPO_FISCAL', 'ORIGEM_FISCAL', 'SITUACAO', 'STATUS_IMPORTACAO', 'DIRECAO', 'ORIGEM_LIQUIDO', 'CHAVE_ACESSO', 'PROTOCOLO', 'MODELO', 'STATUS_DANFE', 'XML_URL', 'ULTIMO_DOCUMENTO_URL']) { const pair = take(field); if (pair) remaining.append(pair); }
  const status = take('SITUACAO')?.querySelector('dd');
  if (status) status.dataset.sefazStatus = /cancel/i.test(status.textContent) ? 'cancelled' : /autorizad/i.test(status.textContent) ? 'authorized' : 'pending';
  const key = take('CHAVE_ACESSO')?.querySelector('dd'), text = key?.textContent;
  if (key && /^(?:[0-9]{6}[A-Z0-9]{12}[0-9]{26}|[0-9]{50})$/.test(text)) {
    const button = el('button', 'rg-sefaz-copy'); button.type = 'button'; button.setAttribute('aria-label', 'Copiar chave de acesso'); button.append(icon(doc, 'copy'));
    button.addEventListener('click', async () => {
      try { const clipboard = doc.defaultView?.navigator?.clipboard; if (!clipboard?.writeText) throw new Error('Unavailable'); await clipboard.writeText(text); button.setAttribute('aria-label', 'Chave de acesso copiada'); button.dataset.copied = 'true'; }
      catch { button.setAttribute('aria-label', 'Selecione a chave de acesso para copiar'); }
    });
    key.classList.add('rg-sefaz-key-value'); key.replaceChildren(el('span', '', text), button);
  }
}
