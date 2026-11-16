import { buildRentalsReport, rentalsFilterOptions } from '../chat/rentals-report-data.js';
import { formatOperationsDate } from '../chat/operations-reports-model.js';
import { provisionDateKey } from '../chat/pending-provision-dates.js';
import { addReportCloseControl } from './report-close-control.js';
import { bindReportLandscape } from './report-landscape.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';

const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const FILTERS = [['year', 'ANO'], ['property', 'IMÓVEL'], ['tenant', 'INQUILINO'], ['paymentMethod', 'FORMA PGTO'], ['status', 'STATUS']];
const MONTHS = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = cents => cents == null ? '—' : currency.format(cents / 100);
const dayCount = days => Math.abs(days) === 1 ? '1 dia' : `${Math.abs(days)} dias`;

export function createRentalsReportView({ document: doc = globalThis.document, loadSnapshot, onClose = () => {}, now = () => new Date() }) {
  const make = (tag, className = '', label) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const root = make('div', 'pl-overlay rentals-overlay');
  root.hidden = true;
  const panel = make('section', 'pl-dialog rentals-dialog');
  panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Relatório de aluguéis');

  const filters = make('div', 'pl-filters rentals-filters');
  const refresh = make('button', 'pl-refresh', '⟳');
  refresh.type = 'button';
  refresh.setAttribute('aria-label', 'Atualizar aluguéis');
  refresh.title = 'Atualizar aluguéis';
  filters.append(refresh);
  const controls = new Map(FILTERS.map(([key, label]) => {
    const wrapper = make('label', 'pl-filter');
    const select = make('select');
    select.name = key;
    select.dataset.reportEmptyValue = 'Todos';
    select.disabled = true;
    select.setAttribute('aria-label', label);
    wrapper.append(make('span', 'pl-filter-label', label), select);
    filters.append(wrapper);
    return [key, select];
  }));

  const notice = make('p', 'pl-notice');
  notice.hidden = true;
  const content = make('div', 'pl-table-scroll rentals-content');
  content.tabIndex = 0;
  content.setAttribute('aria-label', 'Tabelas de aluguéis');
  content.setAttribute('role', 'region');
  const brand = make('div', 'rentals-brand');
  const logo = make('img');
  logo.src = LOGO;
  logo.alt = 'Energética Construtora';
  brand.append(logo);
  const tables = make('div');
  content.append(brand, tables);
  panel.append(filters, notice, content);
  root.append(panel);
  doc.body.append(root);

  const landscape = bindReportLandscape(root);
  const dismiss = addReportCloseControl({ root, toolbar: filters, onClose: close });
  const pickers = bindSearchableFilterSelects(filters, { placement: 'below', report: true });
  const app = doc.getElementById('app');
  let snapshot, request, destroyed = false;
  let returnFocus, oldOverflow, oldInert;

  function tableSection(title, columns, className, widths = []) {
    const section = make('section', `rentals-section ${className}`);
    const heading = make('h2', '', title);
    const table = make('table');
    table.setAttribute('aria-label', title);
    if (widths.length) {
      const colgroup = make('colgroup');
      for (const width of widths) {
        const col = make('col');
        col.style.width = `${width}%`;
        colgroup.append(col);
      }
      table.append(colgroup);
    }
    const header = table.createTHead().insertRow();
    for (const column of columns) {
      const th = make('th', '', column);
      th.scope = 'col';
      header.append(th);
    }
    const body = table.createTBody();
    section.append(heading, table);
    tables.append(section);
    return { table, body };
  }

  function appendRow(body, cells) {
    body.insertRow().append(...cells.map(value => typeof value === 'string' ? make('td', '', value) : value));
  }

  function appendEmpty(body, count, message) {
    const cell = make('td', 'rentals-empty', message);
    cell.colSpan = count;
    appendRow(body, [cell]);
  }

  function dueCell(days, expiredLabel) {
    const cell = make('td', 'rentals-due');
    if (days == null) {
      cell.textContent = 'Sem data';
      return cell;
    }
    const state = days < 0 ? 'overdue' : days > 0 ? 'upcoming' : 'today';
    const dot = make('span', 'rentals-dot');
    dot.setAttribute('aria-hidden', 'true');
    const label = expiredLabel
      ? (days < 0 ? expiredLabel : 'EM DIA')
      : (days < 0 ? 'VENCIDO há' : days > 0 ? 'A VENCER em' : 'VENCE HOJE');
    cell.dataset.state = state;
    const hasDayCount = expiredLabel || days !== 0;
    cell.append(dot, doc.createTextNode(hasDayCount ? label + ' ' : label));
    if (hasDayCount) {
      cell.append(make('strong', '', dayCount(days)));
      if (expiredLabel) cell.append(doc.createTextNode(days < 0 ? ' em atraso' : ' para vencer'));
    }
    return cell;
  }

  function renderOpen(rows) {
    const { body } = tableSection('⚠️ ALUGUÉIS EM ABERTO',
      ['IMÓVEL', 'INQUILINO', 'VENC.', 'PGTO', 'VALOR', 'ATRASO'], 'rentals-open', [25, 18.5, 7.5, 29, 8, 12]);
    if (!rows.length) appendEmpty(body, 6, 'Nenhum aluguel em aberto para os filtros selecionados.');
    for (const row of rows) appendRow(body, [
      row.property, row.tenant, make('td', 'rentals-date', formatOperationsDate(row.dueDate)), row.paymentMethod,
      make('td', 'rentals-value', money(row.amountCents)), dueCell(row.days),
    ]);
  }

  function annualMonth(month) {
    const cell = make('td', 'rentals-month');
    if (month.records.length) cell.append(make('strong', 'rentals-month-value', money(month.amountCents)));
    const multiplePayments = month.records.filter(row => row.paidDate).length > 1;
    for (const row of month.records) {
      if (multiplePayments && row.paidDate) cell.append(make('span', 'rentals-month-value', money(row.grossCents)));
      const caption = row.paidDate
        ? `PG ${formatOperationsDate(row.paidDate)}`
        : `VEN ${formatOperationsDate(row.dueDate)}`;
      cell.append(make('span', 'rentals-month-date', caption));
      if (!row.paidDate && row.days != null) {
        const status = row.days < 0 ? `ATR. ${-row.days}d` : row.days > 0 ? `EM ${row.days}d` : 'VENCE HOJE';
        cell.append(make('span', row.days < 0 ? 'rentals-date' : 'rentals-month-pending', status));
      }
    }
    for (const row of month.shifted) {
      const label = row.paidDate < row.dueDate ? 'ADIANT.' : 'ATRAS.';
      const dates = `VEN ${formatOperationsDate(row.dueDate)} · PG ${formatOperationsDate(row.paidDate)}`;
      cell.append(make('span', 'rentals-month-shifted', `${label} · ${dates}`));
    }
    if (!cell.childElementCount) cell.textContent = 'N/A';
    return cell;
  }

  function renderAnnual(result) {
    const { table, body } = tableSection('📊 RELATÓRIO ANUAL DE ALUGUÉIS',
      ['IMÓVEL', ...MONTHS, 'TOTAL'], 'rentals-annual', [15, ...Array(12).fill(6.4), 8.2]);
    if (!result.annual.length) appendEmpty(body, 14, 'Nenhum lançamento para o período e os filtros selecionados.');
    for (const group of result.annual) appendRow(body, [
      group.property, ...group.months.map(annualMonth), make('td', 'rentals-total', money(group.totalCents)),
    ]);
    appendRow(table.createTFoot(), [make('th', 'rentals-total', 'TOTAL GERAL'),
      ...result.monthlyTotals.map(amount => make('td', 'rentals-total', money(amount))),
      make('td', 'rentals-total', money(result.totalCents)),
    ]);
  }

  function renderCalendar(rows, adjustment) {
    const columns = ['IMÓVEL', 'INQUILINO', 'DATA', ...(adjustment ? ['ÍNDICE'] : []), 'STATUS'];
    const title = adjustment ? '📈 TABELA DE REAJUSTE' : '💰 TABELA DE VENCIMENTO';
    const widths = adjustment ? [27, 25, 12, 12, 24] : [31, 29, 14, 26];
    const { body } = tableSection(title, columns, 'rentals-calendar', widths);
    if (!rows.length) appendEmpty(body, columns.length, 'Nenhum contrato para os filtros selecionados.');
    for (const row of rows) appendRow(body, [
      row.property, row.tenant, make('td', 'rentals-date', formatOperationsDate(row.date)),
      ...(adjustment ? [row.index] : []), dueCell(row.days, adjustment ? 'SEM REAJUSTE' : 'CONTRATO VENCIDO'),
    ]);
  }

  function render() {
    tables.replaceChildren();
    if (!snapshot) return;
    const selected = Object.fromEntries([...controls].map(([key, node]) => [key, node.value]));
    const result = buildRentalsReport(snapshot, selected, provisionDateKey(now()));
    renderOpen(result.open);
    renderAnnual(result);
    renderCalendar(result.adjustments, true);
    renderCalendar(result.expirations, false);
  }

  function populate(today, firstLoad) {
    const options = rentalsFilterOptions(snapshot, today);
    const latestPaid = snapshot.launches.reduce((latest, row) => row.paidDate > latest ? row.paidDate : latest, '');
    for (const [key, select] of controls) {
      const fallback = key === 'year' ? (latestPaid || today).slice(0, 4) : key === 'status' ? 'ATIVO' : '';
      const value = firstLoad ? fallback : select.value;
      const all = { property: 'Localizar itens', tenant: 'Localizar itens', paymentMethod: ' ' }[key] ?? 'Todos';
      const blank = new doc.defaultView.Option(all, '');
      if (key === 'paymentMethod') blank.setAttribute('label', 'Todas');
      select.replaceChildren(blank, ...Array.from(new Set([...options[key], value].filter(Boolean)), label => new doc.defaultView.Option(label, label)));
      select.value = value;
    }
  }

  function showNotice(label, error = false) {
    notice.textContent = label;
    notice.hidden = !label;
    notice.setAttribute('role', error ? 'alert' : 'status');
  }

  async function load(firstLoad = false) {
    request?.abort();
    const controller = new AbortController();
    request = controller;
    const current = () => request === controller && !root.hidden && !controller.signal.aborted;
    pickers.close();
    root.setAttribute('aria-busy', 'true');
    refresh.disabled = true;
    for (const select of controls.values()) select.disabled = true;
    pickers.sync();
    tables.replaceChildren();
    showNotice('Consultando aluguéis no SharePoint…');
    try {
      const loaded = await loadSnapshot({ signal: controller.signal });
      if (!current()) return false;
      snapshot = loaded;
      populate(provisionDateKey(now()), firstLoad);
      render();
      showNotice('');
      return true;
    } catch {
      if (!current()) return false;
      snapshot = null;
      showNotice('Não foi possível carregar os aluguéis. Use Atualizar para tentar novamente.', true);
      return false;
    } finally {
      if (current()) {
        request = null;
        root.setAttribute('aria-busy', 'false');
        refresh.disabled = false;
        for (const select of controls.values()) select.disabled = !snapshot;
        pickers.sync();
      }
    }
  }

  function close() {
    if (root.hidden) return;
    request?.abort();
    request = null;
    snapshot = null;
    pickers.close();
    root.hidden = true;
    tables.replaceChildren();
    doc.body.style.overflow = oldOverflow;
    if (app) app.inert = oldInert;
    returnFocus?.focus();
    onClose();
  }

  root.addEventListener('click', event => { if (event.target === root) close(); });
  root.addEventListener('keydown', event => {
    if (event.defaultPrevented) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
    if (event.key !== 'Tab') return;
    const nodes = [...panel.querySelectorAll('input,select,button,[tabindex="0"]')]
      .filter(node => !node.disabled && node.tabIndex >= 0 && !node.closest('[hidden]'));
    const target = event.shiftKey && doc.activeElement === nodes[0] ? nodes.at(-1)
      : !event.shiftKey && doc.activeElement === nodes.at(-1) ? nodes[0] : null;
    if (target) {
      event.preventDefault();
      target.focus();
    }
  });
  filters.addEventListener('change', event => {
    if (event.target.matches('select')) {
      render();
      content.scrollTop = 0;
    }
  });
  refresh.addEventListener('click', () => { void load(!controls.get('year').options.length); });

  return {
    element: root,
    async open() {
      if (destroyed || !root.hidden) return false;
      returnFocus = doc.activeElement;
      oldOverflow = doc.body.style.overflow;
      oldInert = app?.inert ?? false;
      doc.body.style.overflow = 'hidden';
      if (app) app.inert = true;
      root.hidden = false;
      landscape.update();
      dismiss.focus({ preventScroll: true });
      await load(true);
      return !root.hidden;
    },
    close,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      close();
      pickers.destroy();
      landscape.destroy();
      root.remove();
    },
  };
}
