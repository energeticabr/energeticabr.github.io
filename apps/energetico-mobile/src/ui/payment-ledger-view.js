import { buildPaymentLedger } from '../chat/payment-ledger-model.js';
import { formatReportDate, formatReportMoney } from '../chat/contractor-report-model.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';

const COLUMNS = ['DATA PGTO', 'PEDIDO', 'ID', 'FORNECEDOR', 'FILIAL', 'CONTA', 'PRODUTO', 'VU', 'QTD', 'FRETE', 'TOTAL', 'TOTAL FORN. DIA'];
const FILTERS = [['branch', 'FILIAL'], ['order', 'ID PEDIDO'], ['product', 'PRODUTO'], ['supplier', 'FORNECEDOR'], ['disbursement', 'DESEMBOLSO']];
const money = value => Number.isFinite(value) ? formatReportMoney(value) : 'INCOMPLETO';
const quantity = value => Number.isFinite(value) ? new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(value) : '—';

export function createPaymentLedgerView({ document: doc = globalThis.document, data } = {}) {
  if (!doc?.body || typeof data?.loadPaymentsSnapshot !== 'function') throw new TypeError('O relatório requer documento e sessão SharePoint.');
  const win = doc.defaultView;
  const make = (tag, className = '', text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (className, text) => Object.assign(make('button', className, text), { type: 'button' });
  const root = make('div', 'pl-overlay'); root.hidden = true;
  const panel = make('section', 'pl-dialog'); panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Relatório de pagamentos');
  const heading = make('header', 'pl-heading');
  const closeButton = button('pl-close', 'Fechar');
  heading.append(make('h2', '', 'Relatório de pagamentos'), closeButton);
  const warning = make('p', 'pl-orientation', 'PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');
  warning.setAttribute('role', 'status');
  const report = make('div', 'pl-report'); report.hidden = true;
  const filters = make('div', 'pl-filters');
  const refresh = button('pl-refresh', '⟳'); refresh.setAttribute('aria-label', 'Atualizar relatório');
  const controls = new Map();
  const dates = make('div', 'pl-dates'); dates.append(make('span', 'pl-filter-label', 'DATA'));
  const dateFields = make('div', 'pl-date-fields');
  for (const [name, label] of [['startDate', 'Data inicial'], ['endDate', 'Data final']]) {
    const input = make('input'); input.type = 'date'; input.name = name; input.setAttribute('aria-label', label);
    input.addEventListener('click', () => { try { input.showPicker?.(); } catch { /* Native WebView fallback. */ } });
    dateFields.append(input); controls.set(name, input);
  }
  dates.append(dateFields); filters.append(refresh, dates);
  for (const [name, label] of FILTERS) {
    const field = make('label', 'pl-filter'); field.append(make('span', 'pl-filter-label', label));
    const select = make('select'); select.name = name;
    select.append(Object.assign(make('option', '', 'Todos'), { value: '' }));
    field.append(select); filters.append(field); controls.set(name, select);
  }
  const summary = make('div', 'pl-summary'); summary.setAttribute('role', 'status');
  const notice = make('p', 'pl-notice'); notice.hidden = true; notice.setAttribute('role', 'status');
  const hint = make('p', 'pl-scroll-hint', 'Deslize a tabela para ver todas as colunas.');
  const scroll = make('div', 'pl-table-scroll'); scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Tabela de pagamentos, rolagem horizontal');
  const table = make('table', 'pl-table'); const head = make('thead'); const headRow = make('tr');
  for (const label of COLUMNS) { const th = make('th', '', label); th.scope = 'col'; headRow.append(th); }
  const body = make('tbody'); head.append(headRow); table.append(head, body); scroll.append(table);
  const pager = make('nav', 'pl-pager'); pager.setAttribute('aria-label', 'Paginação do relatório');
  const previous = button('pl-page-button', '❮'); previous.setAttribute('aria-label', 'Página anterior');
  const next = button('pl-page-button', '❯'); next.setAttribute('aria-label', 'Próxima página');
  const pageLabel = make('span'); pager.append(previous, pageLabel, next);
  report.append(filters, summary, notice, hint, scroll, pager);
  panel.append(heading, warning, report); root.append(panel); doc.body.append(root);
  let destroyed = false, snapshot = null, controller = null, revision = 0, page = 1, pickers = null;
  let returnFocus = null, oldOverflow = '', app = null, oldInert = false;
  const portrait = () => win?.matchMedia ? win.matchMedia('(orientation: portrait)').matches : win?.innerHeight > win?.innerWidth;
  const showNotice = text => { notice.textContent = text; notice.hidden = !text; };
  const empty = () => { body.replaceChildren(); summary.textContent = ''; previous.disabled = next.disabled = true; pageLabel.textContent = ''; };
  function cell(tr, column, value, span = 1) {
    const td = make('td', '', String(value ?? '').trim() || '—'); td.dataset.column = column; td.rowSpan = span; tr.append(td);
  }
  function render() {
    empty(); showNotice('');
    if (!snapshot) return;
    const selected = Object.fromEntries([...controls].map(([name, input]) => [name, input.value]));
    if (selected.startDate && selected.endDate && selected.startDate > selected.endDate) {
      showNotice('A data inicial não pode ser posterior à data final.'); return;
    }
    const result = buildPaymentLedger(snapshot.launches, selected);
    summary.textContent = `${result.count} lançamento(s) · Total: ${result.limited ? 'PARCIAL — aplique mais filtros' : money(result.total)}`;
    if (result.limited) showNotice('⚠️ LIMITE DE 2.000 REGISTROS ATINGIDO. REDUZA O PERÍODO OU APLIQUE MAIS FILTROS PARA GERAR O RELATÓRIO. Totais parciais não foram exibidos.');
    else if (!result.count) showNotice('Nenhum pagamento corresponde aos filtros.');
    // Paginate whole supplier/day groups so a supplier subtotal never splits over pages.
    const pages = Math.max(1, Math.ceil(result.groups.length / 15)); page = Math.min(page, pages);
    const groups = result.groups.slice((page - 1) * 15, page * 15);
    pageLabel.textContent = `Página ${page} de ${pages}`; previous.disabled = page <= 1; next.disabled = page >= pages;
    let currentDay = '', dayIndex = -1;
    for (const group of groups) {
      const firstDay = group.date !== currentDay;
      if (firstDay) { currentDay = group.date; dayIndex++; }
      const dateSpan = groups.filter(g => g.date === group.date).reduce((n, g) => n + g.rows.length, 0);
      group.rows.forEach((row, index) => {
        const tr = make('tr', dayIndex % 2 === 0 ? 'pl-day-blue' : '');
        if (firstDay && index === 0) cell(tr, 'paymentDate', formatReportDate(group.date), dateSpan);
        cell(tr, 'order', row.order); cell(tr, 'id', row.id);
        if (index === 0) cell(tr, 'supplier', group.supplier, group.rows.length);
        cell(tr, 'branch', row.branch); cell(tr, 'account', row.account);
        cell(tr, 'product', [row.product, row.description ? `(${row.description})` : ''].filter(Boolean).join(' '));
        cell(tr, 'unit', money(row.unit)); cell(tr, 'quantity', quantity(row.quantity)); cell(tr, 'freight', money(row.freight)); cell(tr, 'total', money(row.total));
        if (index === 0) cell(tr, 'supplierTotal', group.total == null && result.limited ? 'PARCIAL' : money(group.total), group.rows.length);
        body.append(tr);
      });
    }
  }
  function populate() {
    pickers?.destroy(); pickers = null;
    for (const [name] of FILTERS) {
      const select = controls.get(name), current = select.value;
      const values = [...new Set(snapshot.launches.filter(row => row.paymentDate).map(row => row[name]).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
      select.replaceChildren(Object.assign(make('option', '', 'Todos'), { value: '' }));
      for (const value of values) select.append(Object.assign(make('option', '', value), { value }));
      select.value = values.includes(current) ? current : '';
    }
    pickers = bindSearchableFilterSelects(filters);
  }
  async function load() {
    if (root.hidden || portrait() || destroyed) return;
    pickers?.close(); controller?.abort(); const current = ++revision;
    const active = new AbortController(); controller = active; snapshot = null; empty();
    showNotice('Carregando pagamentos do SharePoint…'); report.setAttribute('aria-busy', 'true'); refresh.disabled = true;
    try {
      const selected = Object.fromEntries([...controls].map(([name, input]) => [name, input.value]));
      if (selected.startDate && selected.endDate && selected.startDate > selected.endDate) throw new Error('A data inicial não pode ser posterior à data final.');
      const result = await data.loadPaymentsSnapshot({ signal: active.signal, filters: selected });
      if (active.signal.aborted || current !== revision || root.hidden || destroyed) return;
      if (!Array.isArray(result?.launches)) throw new Error('O SharePoint retornou lançamentos inválidos.');
      snapshot = result; populate(); render();
    } catch (error) {
      if (active.signal.aborted || current !== revision || root.hidden || destroyed) return;
      empty(); showNotice(`Não foi possível carregar o relatório. Use Atualizar para tentar novamente. ${String(error?.message || 'Falha na consulta.').replace(/https?:\/\/\S+/gi, 'endereço SharePoint').replace(/Bearer\s+\S+/gi, '[oculto]').slice(0, 240)}`);
    } finally { if (current === revision) { report.setAttribute('aria-busy', 'false'); refresh.disabled = false; } }
  }
  function orientationChanged() {
    if (root.hidden) return;
    const vertical = portrait(); warning.hidden = !vertical; panel.classList.toggle('pl-dialog--portrait', vertical);
    if (vertical) { pickers?.close(); if (report.contains(doc.activeElement)) closeButton.focus(); controller?.abort(); revision++; snapshot = null; empty(); report.hidden = true; }
    else if (report.hidden) { report.hidden = false; void load(); }
  }
  function close() {
    if (root.hidden) return;
    controller?.abort(); revision++; snapshot = null; pickers?.close(); empty(); root.hidden = true;
    doc.body.style.overflow = oldOverflow; if (app) app.inert = oldInert;
    returnFocus?.focus?.(); returnFocus = null;
  }
  function keydown(event) {
    if (root.hidden) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key !== 'Tab') return;
    const nodes = [...panel.querySelectorAll('button,input,select,[tabindex="0"]')].filter(n => !n.disabled && !n.closest('[hidden]') && n.tabIndex >= 0);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && (doc.activeElement === first || doc.activeElement === panel)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (doc.activeElement === last || doc.activeElement === panel)) { event.preventDefault(); first?.focus(); }
  }
  for (const [name, control] of controls) control.addEventListener('change', () => {
    page = 1;
    if (name === 'startDate' || name === 'endDate') void load();
    else render();
  });
  refresh.addEventListener('click', () => { void load(); }); closeButton.addEventListener('click', close);
  root.addEventListener('click', event => { if (event.target === root) close(); }); root.addEventListener('keydown', keydown);
  previous.addEventListener('click', () => { if (page > 1) { page--; render(); scroll.scrollTop = 0; } });
  next.addEventListener('click', () => { page++; render(); scroll.scrollTop = 0; });
  win?.addEventListener('resize', orientationChanged); win?.addEventListener('orientationchange', orientationChanged);
  return Object.freeze({ element: root,
    async open() {
      if (destroyed) throw new Error('O relatório foi encerrado.');
      if (!root.hidden) return;
      returnFocus = doc.activeElement; oldOverflow = doc.body.style.overflow; app = doc.getElementById('app'); oldInert = app?.inert || false;
      doc.body.style.overflow = 'hidden'; if (app) app.inert = true;
      page = 1; root.hidden = false;
      const today = new Date(); controls.get('startDate').value = '';
      controls.get('endDate').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      const vertical = portrait(); warning.hidden = !vertical; report.hidden = vertical; panel.classList.toggle('pl-dialog--portrait', vertical); panel.focus();
      if (!vertical) await load();
    }, close,
    destroy() { if (destroyed) return; close(); destroyed = true; pickers?.destroy(); win?.removeEventListener('resize', orientationChanged); win?.removeEventListener('orientationchange', orientationChanged); root.remove(); },
  });
}
