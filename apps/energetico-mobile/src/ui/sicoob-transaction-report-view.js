import Decimal from 'decimal.js';
import { includesSearchText, normalizeSearchText } from '../../../../portal/core/search-text.js';
import {
  FINANCIAL_MOVEMENT_PENDING_RECIPIENT, financialMovementRecipient, financialMovementType, isImportedFinancialMovement,
} from '../chat/financial-gallery-models.js';
import { registrationDateKey, registrationNumber, registrationRawField, REGISTRATION_GALLERY_MODELS } from '../chat/registration-gallery-data.js';
import { confirmedFinancialTimestamp } from '../chat/financial-update-time.js';
import { rankSicoobOrderOptions, SICOOB_ORDER_FIELD, sicoobOrderId } from '../chat/sicoob-order-link.js';
import { createReportLinkComparison, createReportLinkPicker } from './dda-provision-picker.js';
import { addReportCloseControl } from './report-close-control.js';
import { bindReportLandscape } from './report-landscape.js';
import { PDF_ATTACHMENT_ICON } from './report-pdf-attachment-icon.js';
import { createFinancialReportLastUpdate } from './financial-report-last-update.js';

const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const TITLE = 'Relatório de transações Sicoob';
const ORDER_PICKER_COPY = {
  title: 'A QUAL PEDIDO DESEJA VINCULAR?',
  dialogLabel: 'Vincular pagamento Sicoob a pedido',
  sourceLabel: 'Pagamento Sicoob',
  targetLabel: 'Pedido',
  searchLabel: 'Buscar pedido por fornecedor, filial ou ID',
  listLabel: 'Pedidos disponíveis',
  loading: 'Carregando pedidos…',
  options: count => count ? `${count} pedido(s). Escolha um para vincular.` : 'Nenhum pedido corresponde à busca.',
  empty: 'Nenhum pedido disponível.',
  loadError: 'Não foi possível carregar os pedidos. Feche e tente novamente.',
  recommendation: '★ RECOMENDADO',
  reviewDetails: true,
};
const PENCIL_ICON = '<svg viewBox="0 0 24 24" width="21" height="21" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m14 6 4 4M4 20l4-1 12-12a2.8 2.8 0 0 0-4-4L4 15z"/></svg>';
const PAGE_SIZE = 50;
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const text = value => String(value ?? '').trim();
const dateLabel = value => value ? value.split('-').reverse().join('/') : '—';
const pendingRecipient = row => row.recipient === FINANCIAL_MOVEMENT_PENDING_RECIPIENT;
const displayedRecipient = row => {
  if (!row.orderSupplier) return row.recipient;
  if (pendingRecipient(row)) return row.orderSupplier;
  return row.type === 'Boleto' ? `${row.recipient} (${row.orderSupplier})` : row.recipient;
};

function projectTransactions(snapshot) {
  if (!Array.isArray(snapshot?.rows) || snapshot.hasMore === true || snapshot.complete === false) {
    throw new Error('Consulta de transações incompleta.');
  }
  return snapshot.rows.filter(({ fields }) => isImportedFinancialMovement(fields)).map(({ id, fields, hasAttachments }) => {
    const transaction = {
      id: String(id),
      date: registrationDateKey(fields.DATAPAGAMENTO),
      document: text(fields.DOCUMENTORECEBEDOR),
      operation: text(fields.OPERACAO),
      description: text(fields.DESCRICAO),
      type: financialMovementType(fields.DESCRICAO),
      payerAccount: text(fields.CONTAPAGADORA),
      recipientAccount: text(fields.CONTARECEBEDOR),
      reference: text(fields.REFERENCIABANCARIA),
      value: registrationNumber(fields.VALOR),
    };
    const isPix = transaction.type === 'Pix';
    const bankRecipient = text(fields.RAZAOSOCIALRECEBEDOR);
    const receiptName = isPix && /^\d+$/.test(transaction.id)
      ? `Comprovante-Sicoob-Pix-${transaction.id}.pdf`
      : /^\d{4,18}$/.test(transaction.reference) ? `Comprovante-Sicoob-${transaction.reference}.pdf` : '';
    return {
      ...transaction,
      recipient: financialMovementRecipient(fields),
      matchAmount: fields.VALOR,
      orderId: sicoobOrderId(fields[SICOOB_ORDER_FIELD]),
      receiptName,
      searchText: normalizeSearchText([...Object.values(transaction), dateLabel(transaction.date)].join(' ')),
      hasReceipt: receiptName && (hasAttachments === true || (hasAttachments == null
        && (isPix ? Boolean(bankRecipient && bankRecipient.toUpperCase() !== 'N/A')
          : /\b(?:BOLETO|TIT|TITULO)\b/i.test(transaction.description)))),
    };
  }).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id, 'pt-BR', { numeric: true }));
}

export function createSicoobTransactionReportView({ document: doc = globalThis.document, data, onClose, openMediaCollection, syncMonitor } = {}) {
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
  refresh.title = 'Sincronizar transações, DDAs e notas fiscais';
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
  controls.search.placeholder = 'Recebedor, Pix, TED, boleto, referência, pedido…';
  toolbar.append(header, filters);
  const content = make('div', 'pl-table-scroll ddr-content');
  content.tabIndex = 0;
  content.setAttribute('role', 'region');
  content.setAttribute('aria-label', 'Transações importadas do Sicoob');
  const notice = make('p', 'ddr-notice');
  notice.setAttribute('role', 'status');
  notice.hidden = true;
  notice.dataset.reportScreenOnly = '';
  report.append(toolbar, notice, content);
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
  let receiptRequest;
  let loading = false, starting = false, syncRunning = Boolean(syncMonitor?.running);
  let sourceRunning = Boolean(syncMonitor?.sourceRunning ?? syncMonitor?.running), reloadPending = false;
  const lastUpdate = createFinancialReportLastUpdate(doc);
  let loadNotice = '';
  const app = doc.getElementById('app');
  const orderLink = data.orderLink;
  const picker = orderLink && createReportLinkPicker({
    document: doc,
    host: root,
    copy: ORDER_PICKER_COPY,
    loadOptions: async (row, signal) => rankSicoobOrderOptions(
      await orderLink.loadOptions({ signal }), { supplier: row.supplier, amount: row.matchAmount, date: row.date }),
    renderOptionLabel(node, order, amount) {
      node.className = 'report-link-option-text';
      node.append(`#${order.id} · `,
        createReportLinkComparison(doc, order.date ? dateLabel(order.date) : 'Sem data do pedido', order.dateMatch, 'Data do pedido', 'a transação'),
        ` · ${order.details ?? order.supplier} · `,
        createReportLinkComparison(doc, amount, order.amountMatch, 'Valor do pedido', 'a transação'));
    },
    async saveLink(row, orderId, signal) {
      const receipt = await orderLink.save({ movementId: row.id, orderId, expectedOrderId: row.orderId, signal });
      if (sicoobOrderId(receipt?.movementId) !== row.id || sicoobOrderId(receipt?.orderId) !== orderId) {
        throw new Error('O vínculo salvo não corresponde à seleção.');
      }
      return { movementId: row.id, orderId, supplier: receipt.supplier };
    },
    currentLink: row => row.orderId,
    selectCurrent: true,
    onClose: resumeRefresh,
    rowAmount: row => row.value,
    resolveReturnFocus: trigger => content.querySelector(
      `[data-sicoob-movement-link="${trigger?.dataset.sicoobMovementLink}"] .sicoob-transaction-link-pencil`) || panel,
    onLinked({ movementId, orderId, supplier }) {
      const transaction = rows?.find(row => row.id === movementId);
      if (!transaction) return;
      transaction.orderId = orderId;
      transaction.orderSupplier = supplier;
      if (!matchesSearch(transaction, normalizeSearchText(controls.search.value))) {
        render();
        return;
      }
      const cell = content.querySelector(`[data-sicoob-movement-link="${movementId}"]`);
      if (!cell) return;
      const row = cell.parentElement;
      row.querySelector('.ddr-supplier-name').textContent = displayedRecipient(transaction);
      renderOrderLink(cell, transaction);
    },
  });

  function showNotice(message = '') {
    notice.textContent = message || loadNotice;
    notice.hidden = !notice.textContent;
  }

  function syncRefreshButton() { refresh.disabled = loading || starting || syncRunning; }
  function syncRowActions() {
    for (const node of content.querySelectorAll('.sicoob-transaction-receipt, .sicoob-transaction-link-pencil')) node.disabled = loading;
  }
  function resumeRefresh() {
    if (reloadPending && !root.hidden && !receiptRequest && !picker?.isOpen) void load();
  }
  async function manualRefresh() {
    if (refresh.disabled || root.hidden || receiptRequest || picker?.isOpen) return;
    if (!syncMonitor) return load();
    starting = true; syncRefreshButton();
    try {
      const result = await syncMonitor.start();
      if (result?.startWarning && !root.hidden) showNotice(result.startWarning);
    }
    catch (error) { if (!root.hidden) showNotice(error?.message || 'Não foi possível iniciar a sincronização.'); }
    finally { starting = false; syncRefreshButton(); }
  }

  async function openReceipt(transaction, trigger) {
    if (loading || receiptRequest || picker?.isOpen || !request || root.hidden) return;
    const signal = request.signal;
    const active = receiptRequest = {};
    const current = () => receiptRequest === active && !signal.aborted && trigger.isConnected;
    trigger.disabled = true;
    showNotice();
    try {
      const attachments = await data.listAttachments(transaction.id, { refresh: true, signal });
      if (!current()) return;
      const receiptName = transaction.receiptName;
      const receipt = attachments.find(item => item.fileName === receiptName);
      if (!receipt) {
        showNotice('Ainda não há comprovante Sicoob anexado a esta transação.');
        return;
      }
      trigger.disabled = false;
      await openMediaCollection([{
        fileName: receiptName,
        source: options => data.downloadAttachment(transaction.id, receiptName, { ...options, signal: options?.signal ?? signal }),
      }], { layout: 'report-pdf', signal, resolveReturnFocus: () => trigger.isConnected ? trigger : panel });
    } catch {
      if (current()) showNotice('Não foi possível abrir o comprovante. Tente novamente.');
    } finally {
      if (receiptRequest === active) receiptRequest = null;
      trigger.disabled = false;
      resumeRefresh();
    }
  }

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

  function matchesSearch(row, query) {
    return !query || includesSearchText(normalizeSearchText([
      row.searchText, displayedRecipient(row), row.orderId && `pedido id ${row.orderId}`,
    ].join(' ')), query);
  }

  function filteredTransactions() {
    const from = controls.from.value;
    const to = controls.to.value;
    const account = controls.account.value;
    const query = normalizeSearchText(controls.search.value);
    return rows.filter(row => (!from || row.date >= from) && (!to || (row.date && row.date <= to))
      && (!account || row.payerAccount === account) && matchesSearch(row, query));
  }

  function renderOrderLink(cell, transaction, interactive = true) {
    const linked = transaction.orderId;
    cell.parentElement.classList.toggle('sicoob-transaction-linked', Boolean(linked));
    const value = make('span', linked ? 'sicoob-transaction-link-id' : '', linked ? `ID ${linked}` : '—');
    cell.replaceChildren(value);
    if (!interactive || !picker || sicoobOrderId(transaction.id) !== transaction.id) return;
    const pencil = button(linked ? `Editar pedido vinculado ao pagamento ${transaction.id}`
      : `Vincular pagamento ${transaction.id} a um pedido`, '');
    pencil.className = 'sicoob-transaction-link-pencil';
    pencil.dataset.sicoobMovementLink = transaction.id;
    pencil.dataset.reportScreenOnly = '';
    pencil.innerHTML = PENCIL_ICON;
    pencil.disabled = loading;
    pencil.addEventListener('click', () => {
      if (!loading && !receiptRequest) void picker.show({ ...transaction, supplier: transaction.recipient }, pencil);
    });
    cell.append(pencil);
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
    summary.append(lastUpdate.element);
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
    for (const name of ['Data', 'Recebedor', 'Tipo', 'Contas e referência', 'Valor', 'VINCULAÇÃO']) {
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
      recipient.append(make('strong', 'ddr-supplier-name', displayedRecipient(transaction)));
      if (transaction.document) recipient.append(make('small', '', transaction.document));
      const description = row.insertCell();
      description.textContent = transaction.type;
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
      if (!printAll && transaction.hasReceipt && typeof openMediaCollection === 'function') {
        const receipt = button(`Abrir comprovante da transação ${transaction.id}`, '');
        receipt.className = 'sicoob-transaction-receipt';
        receipt.innerHTML = PDF_ATTACHMENT_ICON;
        receipt.disabled = loading;
        receipt.addEventListener('click', () => void openReceipt(transaction, receipt));
        value.append(receipt);
      }
      const link = row.insertCell();
      link.className = 'sicoob-transaction-link';
      if (sicoobOrderId(transaction.id) === transaction.id) link.dataset.sicoobMovementLink = transaction.id;
      renderOrderLink(link, transaction, !printAll);
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
    reloadPending = false;
    picker?.close();
    request?.abort();
    receiptRequest = null;
    showNotice();
    const active = request = new AbortController();
    reloadPending = false;
    loading = true;
    root.setAttribute('aria-busy', 'true');
    syncRefreshButton();
    syncRowActions();
    const loadingNotice = make('p', 'ddr-notice', 'Carregando transações do Sicoob…');
    loadingNotice.setAttribute('role', 'status');
    if (!rows) content.replaceChildren(loadingNotice);
    try {
      const snapshot = await data.loadSnapshot({ refresh: true, signal: active.signal });
      if (active !== request) return;
      const transactions = projectTransactions(snapshot);
      let supplierNotice = '';
      const linked = transactions.filter(row => row.orderId && (pendingRecipient(row) || row.type === 'Boleto'));
      if (linked.length && orderLink) {
        let incomplete = false;
        try {
          const result = await orderLink.loadSuppliers(linked.map(row => row.orderId), { signal: active.signal });
          incomplete = result.incomplete;
          for (const row of linked) row.orderSupplier = result.suppliers.get(row.orderId);
        } catch {
          incomplete = true;
        }
        if (incomplete) supplierNotice = 'Alguns fornecedores vinculados estão indisponíveis. Tente atualizar.';
      }
      if (active !== request) return;
      rows = transactions;
      for (const { fields } of snapshot.rows) {
        if (isImportedFinancialMovement(fields)) {
          lastUpdate.update(confirmedFinancialTimestamp(registrationRawField(fields, 'Criado', REGISTRATION_GALLERY_MODELS.financial_movement)));
        }
      }
      loadNotice = supplierNotice;
      showNotice();
      populateAccounts();
      const position = [content.scrollTop, content.scrollLeft];
      render();
      [content.scrollTop, content.scrollLeft] = position;
    } catch {
      if (active !== request) return;
      if (rows) {
        loadNotice = 'Não foi possível recarregar as transações. Os dados da última leitura foram preservados. Tente atualizar.';
        showNotice();
      }
      else {
        const error = make('p', 'ddr-notice', 'Não foi possível carregar as transações. Tente atualizar.');
        error.setAttribute('role', 'alert');
        content.replaceChildren(error);
      }
    } finally {
      if (active === request) {
        root.setAttribute('aria-busy', 'false');
        loading = false;
        syncRefreshButton();
        syncRowActions();
      }
    }
  }

  function close() {
    if (root.hidden) return;
    reloadPending = false;
    picker?.close();
    request?.abort();
    request = null;
    receiptRequest = null;
    rows = null;
    loadNotice = '';
    loading = false;
    reloadPending = false;
    showNotice();
    content.replaceChildren();
    root.hidden = true;
    doc.body.style.overflow = oldOverflow;
    if (app) app.inert = oldInert;
    const fallback = doc.querySelector('[data-action="open-sicoob-transaction-report"]');
    (returnFocus?.isConnected ? returnFocus : fallback)?.focus();
    returnFocus = null;
    onClose?.();
  }

  const unsubscribeSync = syncMonitor?.subscribe(state => {
    const active = Boolean(state.sourceRunning ?? state.running);
    if (sourceRunning && !active) reloadPending = true;
    sourceRunning = active;
    syncRunning = Boolean(state.running);
    lastUpdate.update(state.lastSuccessfulAt);
    syncRefreshButton(); resumeRefresh();
  });
  refresh.addEventListener('click', () => void manualRefresh());
  root.addEventListener('click', event => { if (event.target === root) close(); });
  root.addEventListener('keydown', event => {
    if (event.defaultPrevented || picker?.isOpen) return;
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
      if (!rows || picker?.isOpen || root.getAttribute('aria-busy') === 'true') {
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
      unsubscribeSync?.();
      landscape.destroy();
      root.remove();
    },
  });
}
