import { linkedReportText } from '../chat/orders-linked-report-data.js';

const LOGO_URL = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const quantity = value => Number(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const blank = value => value == null || linkedReportText(value) === '';

function date(value, includeTime = false) {
  const raw = linkedReportText(value);
  if (!raw) return '-';
  if (!includeTime) {
    const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
    if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  }
  const instant = new Date(raw);
  if (!Number.isFinite(instant.getTime())) return raw;
  const parts = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : {}),
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.day}/${values.month}/${values.year}${includeTime ? ` ${values.hour}:${values.minute}` : ''}`;
}

export function renderOrdersLinkedReport(document, report) {
  const el = (tag, className, label) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (label !== undefined) element.textContent = label;
    return element;
  };
  const root = el('article', 'olr-report');
  const brand = el('div', 'olr-brand');
  const logo = el('img'); logo.src = LOGO_URL; logo.alt = 'Logo Energética'; brand.append(logo);
  const header = el('section', 'olr-header');
  header.setAttribute('aria-label', 'Cabeçalho do pedido');
  header.append(el('h3', '', 'CABEÇALHO DO PEDIDO'));
  const headerGrid = el('dl', 'olr-header-grid');
  const fields = report.order.fields;
  const addHeaderField = (name, value, { state = blank(value) ? 'error' : 'neutral', display = blank(value) ? 'EM BRANCO' : linkedReportText(value), notes = [], wide = false } = {}) => {
    const pair = el('div', `olr-header-field olr-state--${state}${wide ? ' olr-header-field--wide' : ''}`);
    pair.dataset.reportField = name;
    pair.append(el('dt', '', name), el('dd', '', display));
    for (const note of notes.filter(Boolean)) pair.append(el('p', 'olr-field-note', note));
    headerGrid.append(pair);
  };
  const compared = (name, value, ids) => addHeaderField(name, value, { state: blank(value) || ids.length ? 'error' : 'ok', notes: [
    ids.length ? `IDs com discrepância: ${ids.join(', ')}` : blank(value) ? 'Cabeçalho em branco' : '✓ Sem discrepância',
  ] });
  addHeaderField('ID', report.order.id);
  addHeaderField('DATA PGTO EFETUADO', fields.DATAPGTOEFETUADO, { display: blank(fields.DATAPGTOEFETUADO) ? 'EM BRANCO' : date(fields.DATAPGTOEFETUADO) });
  compared('FILIAL', fields.FILIAL, report.divergences.branch);
  compared('FORNECEDOR', fields.FORNECEDOR, report.divergences.supplier);
  compared('FORMA PGTO', fields.FORMAPGTO, report.divergences.paymentForm);
  addHeaderField('VALOR TOTAL', fields.VALORTOTAL, {
    state: blank(fields.VALORTOTAL) || report.summary.totalDiffers ? 'error' : 'ok', display: `Pedido: ${money(report.summary.orderTotal)}`,
    notes: [`Lançamentos: ${money(report.summary.activeTotal)}`, blank(fields.VALORTOTAL) ? 'Cabeçalho em branco'
      : report.summary.totalDiffers ? `Divergência: ${money(report.summary.difference)}` : '✓ Valores conferem'],
  });
  addHeaderField('OBS', fields.OBS, { state: blank(fields.OBS) ? 'warning' : 'neutral', display: blank(fields.OBS) ? 'SEM OBS' : linkedReportText(fields.OBS), wide: true });
  const invoicePending = linkedReportText(fields['NOTA FISCAL']).trim().toUpperCase() === 'PENDENTE';
  addHeaderField('NOTA FISCAL', fields['NOTA FISCAL'], { state: blank(fields['NOTA FISCAL']) || invoicePending ? 'error' : 'neutral', notes: [invoicePending ? 'Pendência para dar baixa no pedido' : ''] });
  addHeaderField('OBS FISCAL', fields['OBS FISCAL']);
  const auditPending = linkedReportText(fields.STATUS).toUpperCase() === 'PENDENTE AUDITORIA';
  addHeaderField('STATUS', fields.STATUS, { state: blank(fields.STATUS) || auditPending ? 'error' : 'ok',
    display: blank(fields.STATUS) ? 'EM BRANCO' : auditPending ? 'PENDENTE AUDITORIA' : 'APROVADO', wide: true });
  header.append(headerGrid);

  const launchTitle = el('h3', 'olr-launch-title', `Lançamentos vinculados ao pedido ${report.orderId}`);
  const scroll = el('div', 'olr-table-scroll'); scroll.tabIndex = 0; scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-label', 'Tabela de lançamentos vinculados; deslize para ver todas as colunas');
  const table = el('table', 'olr-launch-table');
  const thead = el('thead'); const labels = el('tr');
  for (const label of ['ID', 'Data', 'Fornecedor', 'Forma Pgto', 'Produto (Descrição)', 'Qtd', 'Valor Unitário', 'Frete', 'Valor Total', 'Valor Acumulado', 'Status']) {
    const cell = el('th', '', label); cell.scope = 'col'; labels.append(cell);
  }
  thead.append(labels);
  const body = el('tbody');
  const cell = (tr, value, className = '') => { const node = el('td', className, value); tr.append(node); return node; };
  const appendGroups = (groups, deleted) => {
    for (const group of groups) {
      group.rows.forEach((row, index) => {
        const fields = row.fields;
        const tr = el('tr', `olr-launch-row olr-launch-row--${deleted ? 'deleted' : 'active'}`);
        tr.dataset.launchId = row.id;
        cell(tr, deleted ? linkedReportText(fields['ID 2']) || '-' : row.id);
        cell(tr, date(fields.DATA), 'olr-date');
        if (index === 0) { const supplier = cell(tr, group.supplier, 'olr-supplier'); supplier.rowSpan = group.rows.length; }
        cell(tr, linkedReportText(fields.CONTA) || '-');
        const product = cell(tr, linkedReportText(fields.PRODUTO) || '-');
        if (!blank(fields['DESCRIÇÃO'])) product.append(el('span', 'olr-product-description', ` (${linkedReportText(fields['DESCRIÇÃO'])})`));
        cell(tr, quantity(row.quantity), 'olr-number');
        cell(tr, money(row.unitPrice), 'olr-number');
        cell(tr, row.freight === 0 ? '-' : money(row.freight), 'olr-number');
        cell(tr, money(row.amount), 'olr-number olr-row-total');
        if (index === 0) { const accumulated = cell(tr, deleted ? '-' : money(group.accumulated), 'olr-accumulated olr-number'); accumulated.rowSpan = group.rows.length; }
        if (deleted) {
          const status = cell(tr, '✕ Deletado', 'olr-deletion-status');
          status.append(el('span', '', `por ${linkedReportText(fields['Criado por']) || '-'}`), el('span', '', date(fields.DATAEXCLUSAO, true)));
        } else {
          const raw = linkedReportText(fields.APROVACAO).trim();
          const approval = raw.toUpperCase();
          const pending = approval.startsWith('PENDENTE'); const approved = approval.startsWith('APROVADO');
          cell(tr, pending ? 'PENDENTE' : approved ? 'APROVADO' : raw || '-', `olr-approval${pending ? ' olr-state--error' : approved ? ' olr-state--ok' : ''}`);
        }
        body.append(tr);
      });
    }
  };
  if (!report.active.length) {
    const empty = el('tr'); const message = cell(empty, 'Nenhum lançamento ativo vinculado a este pedido.', 'olr-empty'); message.colSpan = 11; body.append(empty);
  }
  appendGroups(report.activeGroups, false);
  if (report.deleted.length) {
    const separator = el('tr', 'olr-deleted-separator');
    cell(separator, 'ITENS DELETADOS — NÃO COMPÕEM O VALOR ACUMULADO').colSpan = 11;
    body.append(separator);
  }
  appendGroups(report.deletedGroups, true);
  table.append(thead, body); scroll.append(table);
  const summary = el('section', 'olr-summary'); summary.setAttribute('aria-label', 'Resumo do pedido');
  summary.append(el('h3', '', 'RESUMO DO PEDIDO'));
  const summaryGrid = el('dl', 'olr-summary-grid');
  for (const [label, value, state] of [
    ['ITENS ATIVOS', report.summary.activeCount, 'ok'], ['ITENS DELETADOS', report.summary.deletedCount, 'error'],
    ['VALOR DO PEDIDO', money(report.summary.orderTotal)], ['SOMA LANÇAMENTOS', money(report.summary.activeTotal)],
    ['DIFERENÇA', money(report.summary.difference), report.summary.totalDiffers ? 'error' : 'ok'],
  ]) {
    const pair = el('div', `olr-summary-field${state ? ` olr-state--${state}` : ''}`);
    pair.append(el('dt', '', label), el('dd', '', String(value))); summaryGrid.append(pair);
  }
  summary.append(summaryGrid);
  root.append(brand, header, launchTitle, scroll, summary);
  return root;
}
