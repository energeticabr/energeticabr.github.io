import Decimal from 'decimal.js';
import { includesSearchText, normalizeSearchText } from '../../../../portal/core/search-text.js';
import { isImportedFinancialMovement } from '../chat/financial-gallery-models.js';
import { registrationDateKey, registrationNumber } from '../chat/registration-gallery-data.js';
import { addReportCloseControl } from './report-close-control.js';
import { bindReportLandscape } from './report-landscape.js';

const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const TITLE = 'Relatório de transações Sicoob';
const PAGE_SIZE = 50;
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const text = value => String(value ?? '').trim();
const dateLabel = value => value ? value.split('-').reverse().join('/') : '—';

function projectTransactions(snapshot) {
  if (!Array.isArray(snapshot?.rows) || snapshot.hasMore === true || snapshot.complete === false) {
    throw new Error('Consulta de transações incompleta.');
  }
  return snapshot.rows.filter(({ fields }) => isImportedFinancialMovement(fields)).map(({ id, fields }) => {
    const transaction = {
      id: String(id),
      date: registrationDateKey(fields.DATAPAGAMENTO),
      recipient: text(fields.RAZAOSOCIALRECEBEDOR) || 'N/A',
      document: text(fields.DOCUMENTORECEBEDOR),
      operation: text(fields.OPERACAO),
      description: text(fields.DESCRICAO),
      payerAccount: text(fields.CONTAPAGADORA),
      recipientAccount: text(fields.CONTARECEBEDOR),
      reference: text(fields.REFERENCIABANCARIA),
      value: registrationNumber(fields.VALOR),
    };
    return {
      ...transaction,
      searchText: normalizeSearchText([...Object.values(transaction), dateLabel(transaction.date)].join(' ')),
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id, 'pt-BR', { numeric: true }));
}

export function createSicoobTransactionReportView({ document: doc = globalThis.document, data } = {}) {
  const make = (tag, className = '', value = '') => {
    const node = doc.createElement(tag);
    node.className = className;
    node.textContent = value;
    return node;
  };
  const button = (label, value) => {
    const node = make('button', '', value);
    node.type = 'button';
    node.setAttribute('aria-label', label);
    return node;
  };
  const root = make('div', 'pl-overlay ddr-overlay sicoob-transaction-overlay');
  root.hidden = true;
  const panel = make('section', 'pl-dialog ddr-dialog');
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', TITLE);
  const report = make('div', 'pl-report ddr-report');
  const toolbar = make('div', 'pl-filters ddr-toolbar');
  const header = make('header', 'ddr-header-row');
  const logo = make('img', 'ddr-header-logo');
  logo.src = LOGO;
  logo.alt = 'Energética Construtora';
  const refresh = button('Atualizar transações Sicoob', '⟳');
  refresh.className = 'pl-refresh';
  header.append(logo, refresh, make('h2', 'ddr-header-title', TITLE.toLocaleUpperCase('pt-BR')));
  const filters = make('div', 'ddr-filter-row sicoob-transaction-filters');
  const controls = {};
  for (const [name, type, label] of [
    ['from', 'date', 'Data inicial'],
    ['to', 'date', 'Data final'],
    ['account', 'select', 'Conta pagadora'],
    ['search', 'search', 'Pesquisar transações'],
  ]) {
    const control = make(type === 'select' ? 'select' : 'input');
    control.name = name;
    if (type !== 'select') control.type = type;
    const holder = make('label', 'ddr-filter');
    holder.append(make('span', '', label), control);
    filters.append(holder);
    controls[name] = control;
    control.addEventListener(type === 'select' ? 'change' : 'input', () => {
      page = 1;
      render();
      content.scrollTop = 0;
    });
  }
  controls.search.placeholder = 'Recebedor, Pix, TED, boleto, referência…';
  toolbar.append(header, filters);
  const content = make('div', 'pl-table-scroll ddr-content');
  content.tabIndex = 0;
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', 'Transações importadas do Sicoob');
  report.append(toolbar, content);
  panel.append(report);
  root.append(panel);
  doc.body.append(root);
  const landscape = bindReportLandscape(root);
  addReportCloseControl({ root, toolbar, onClose: close });

  let rows = null;
  let request;
  let page = 1;
  let returnFocus;
  let oldOverflow;
  let oldInert;
  const app = doc.getElementById('app');

  function populateAccounts() {
    const current = controls.account.value;
    const accounts = [...new Set(rows.map(row => row.payerAccount).filter(Boolean))].sort();
    controls.account.replaceChildren(...['', ...accounts].map(account => {
      const option = make('option', '', account || 'Todas');
      option.value = account;
      return option;
    }));
    if (accounts.includes(current)) controls.account.value = current;
  }

  function filteredTransactions() {
    const from = controls.from.value;
    const to = controls.to.value;
    const account = controls.account.value;
    const query = normalizeSearchText(controls.search.value);
    return rows.filter(row => (!from || row.date >= from) && (!to || (row.date && row.date <= to))
      && (!account || row.payerAccount === account) && includesSearchText(row.searchText, query));
  }

  function render(printAll = false) {
    if (!rows) return;
    const filtered = filteredTransactions();
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.min(page, pages);
    const total = filtered.reduce((sum, row) => sum.plus(row.value ?? 0), new Decimal(0));
    const summary = make('div', 'ddr-summary sicoob-transaction-summary');
    const totalLabel = filtered.some(row => row.value === null) ? 'Total com valor informado' : 'Valor total';
    for (const [label, value] of [['Transações', String(filtered.length)], [totalLabel, currency.format(total.toFixed(2))]]) {
      const metric = make('div', 'ddr-metric', label);
      metric.append(make('strong', '', value));
      summary.append(metric);
    }
    const scope = make('p', 'ddr-source', 'Pagamentos importados do Sicoob · Galeria de Movimentação');
    content.replaceChildren(summary, scope);
    if (!filtered.length) {
      const invalidDates = controls.from.value && controls.to.value && controls.from.value > controls.to.value;
      const empty = make('p', 'ddr-empty', invalidDates
        ? 'A data inicial não pode ser posterior à data final.'
        : 'Nenhuma transação encontrada.');
      empty.setAttribute('role', invalidDates ? 'alert' : 'status');
      content.append(empty);
      return;
    }

    const table = make('table', 'ddr-table sicoob-transaction-table');
    const headings = table.createTHead().insertRow();
    for (const name of ['Data', 'Recebedor', 'Descrição e operação', 'Contas e referência', 'Valor']) {
      const heading = make('th', '', name);
      heading.scope = 'col';
      headings.append(heading);
    }
    const body = table.createTBody();
    const visible = printAll ? filtered : filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
    for (const transaction of visible) {
      const row = body.insertRow();
      row.insertCell().textContent = dateLabel(transaction.date);
      const recipient = row.insertCell();
      recipient.append(make('strong', 'ddr-supplier-name', transaction.recipient));
      if (transaction.document) recipient.append(make('small', '', transaction.document));
      const description = row.insertCell();
      description.textContent = transaction.description || '—';
      if (transaction.operation) description.append(make('small', '', transaction.operation));
      const details = row.insertCell();
      for (const [label, value] of [
        ['Pagadora', transaction.payerAccount],
        ['Recebedora', transaction.recipientAccount],
        ['Referência', transaction.reference],
      ]) {
        if (value) details.append(make('small', '', `${label} ${value}`));
      }
      if (!details.childNodes.length) details.textContent = '—';
      const value = row.insertCell();
      value.className = 'ddr-money';
      value.textContent = transaction.value === null ? '—' : currency.format(transaction.value);
    }
    content.append(table);
    if (printAll || pages === 1) return;
    const pager = make('div', 'ddr-pager');
    pager.dataset.reportScreenOnly = '';
    const previous = button('Página anterior', 'Anterior');
    const next = button('Próxima página', 'Próxima');
    previous.disabled = page === 1;
    next.disabled = page === pages;
    const changePage = offset => {
      page += offset;
      render();
      content.scrollTop = 0;
      content.focus();
    };
    previous.addEventListener('click', () => changePage(-1));
    next.addEventListener('click', () => changePage(1));
    pager.append(previous, make('span', '', `Página ${page} de ${pages}`), next);
    content.append(pager);
  }

  async function load() {
    const active = request = new AbortController();
    rows = null;
    root.setAttribute('aria-busy', 'true');
    refresh.disabled = true;
    const loading = make('p', 'ddr-notice', 'Carregando transações do Sicoob…');
    loading.setAttribute('role', 'status');
    content.replaceChildren(loading);
    try {
      const snapshot = await data.loadSnapshot({ refresh: true, signal: active.signal });
      if (active !== request) return;
      rows = projectTransactions(snapshot);
      populateAccounts();
      render();
    } catch {
      if (active !== request) return;
      rows = null;
      const error = make('p', 'ddr-notice', 'Não foi possível carregar as transações. Tente atualizar.');
      error.setAttribute('role', 'alert');
      content.replaceChildren(error);
    } finally {
      if (active === request) {
        root.setAttribute('aria-busy', 'false');
        refresh.disabled = false;
      }
    }
  }

  function close() {
    if (root.hidden) return;
    request?.abort();
    request = null;
    rows = null;
    content.replaceChildren();
    root.hidden = true;
    doc.body.style.overflow = oldOverflow;
    if (app) app.inert = oldInert;
    const fallback = doc.querySelector('[data-action="open-sicoob-transaction-report"]');
    (returnFocus?.isConnected ? returnFocus : fallback)?.focus();
    returnFocus = null;
  }

  refresh.addEventListener('click', load);
  root.addEventListener('click', event => { if (event.target === root) close(); });
  root.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key !== 'Tab') return;
    const nodes = [...panel.querySelectorAll('button, input, select, [tabindex="0"]')]
      .filter(node => !node.disabled && !node.closest('[hidden]'));
    const edge = event.shiftKey ? nodes[0] : nodes.at(-1);
    if (doc.activeElement === panel || doc.activeElement === edge) {
      event.preventDefault();
      (event.shiftKey ? nodes.at(-1) : nodes[0])?.focus();
    }
  });

  return Object.freeze({
    element: root,
    async open() {
      if (!root.hidden) return;
      returnFocus = doc.activeElement;
      oldOverflow = doc.body.style.overflow;
      oldInert = app?.inert;
      doc.body.style.overflow = 'hidden';
      if (app) app.inert = true;
      controls.account.replaceChildren();
      controls.from.value = controls.to.value = controls.search.value = '';
      page = 1;
      root.hidden = false;
      landscape.update();
      panel.focus();
      await load();
    },
    close,
    async preparePrint() {
      if (!rows || root.getAttribute('aria-busy') === 'true') {
        throw new Error('Aguarde a consulta completa das transações para imprimir.');
      }
      const loaded = rows;
      const position = [content.scrollLeft, content.scrollTop];
      render(true);
      return () => {
        if (rows !== loaded) return;
        render();
        [content.scrollLeft, content.scrollTop] = position;
      };
    },
    destroy() {
      close();
      landscape.destroy();
      root.remove();
    },
  });
}
