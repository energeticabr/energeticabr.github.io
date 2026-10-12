import { buildPaymentLedger } from '../chat/payment-ledger-model.js';
import { formatReportDate, formatReportMoney } from '../chat/contractor-report-model.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';

const COLUMNS = ['DATA PGTO', 'PEDIDO', 'ID', 'FORNECEDOR', 'FILIAL', 'CONTA', 'PRODUTO', 'VU', 'QTD', 'FRETE', 'TOTAL', 'TOTAL FORN. DIA'];
const FILTERS = [['branch', 'FILIAL'], ['order', 'ID PEDIDO'], ['product', 'PRODUTO'], ['supplier', 'FORNECEDOR'], ['disbursement', 'DESEMBOLSO']];
const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
const BATCH_SIZE = 200;
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
  const warning = make('p', 'pl-orientation', 'PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL.');
  warning.setAttribute('role', 'status');
  const report = make('div', 'pl-report'); report.hidden = true;
  const filters = make('div', 'pl-filters');
  const refresh = button('pl-refresh', '⟳'); refresh.setAttribute('aria-label', 'Atualizar relatório');
  const controls = new Map(), dateDisplays = new Map();
  const dates = make('div', 'pl-dates'); dates.append(make('span', 'pl-filter-label', 'DATA'));
  const dateFields = make('div', 'pl-date-fields');
  for (const [name, label] of [['startDate', 'Data inicial'], ['endDate', 'Data final']]) {
    const holder = make('div', 'pl-date');
    const input = make('input', 'pl-date-native'); input.type = 'date'; input.name = name; input.tabIndex=-1; input.setAttribute('aria-label', `Calendário: ${label}`);
    const display = make('input', 'pl-date-display'); display.type = 'text'; display.inputMode = 'numeric'; display.maxLength = 10;
    display.dataset.dateDisplay = name; display.setAttribute('aria-label', label); display.placeholder = name === 'startDate' ? 'Desde o início' : 'Até o fim';
    const calendar = button('pl-date-calendar', '▦'); calendar.setAttribute('aria-label', `Abrir calendário: ${label}`);
    calendar.addEventListener('click', () => { try { if(input.showPicker) input.showPicker(); else input.focus(); } catch { input.focus(); } });
    display.addEventListener('change', () => {
      const text = display.value.trim(), match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
      const iso = match ? `${match[3]}-${match[2]}-${match[1]}` : '';
      const parsed = new Date(`${iso}T12:00:00Z`);
      const valid = !text || (match && Number(match[3]) >= 1000 && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0,10) === iso);
      display.setCustomValidity(valid ? '' : 'Data inválida. Use dd/mm/yyyy.');
      if (!valid) { controller?.abort(); revision++; snapshot=null; empty(); report.setAttribute('aria-busy','false'); refresh.disabled=false; showNotice('Data inválida. Use dd/mm/yyyy.'); return; }
      input.value = iso; input.dispatchEvent(new win.Event('change'));
    });
    holder.append(display, calendar, input); dateFields.append(holder); controls.set(name, input); dateDisplays.set(name, display);
  }
  dates.append(dateFields); filters.append(refresh, dates);
  for (const [name, label] of FILTERS) {
    const field = make('label', 'pl-filter'); field.append(make('span', 'pl-filter-label', label));
    const select = make('select'); select.name = name;
    select.append(Object.assign(make('option', '', 'Todos'), { value: '' }));
    field.append(select); filters.append(field); controls.set(name, select);
  }
  const logoFrame = make('div', 'pl-ledger-logo-frame');
  const logo = make('img', 'pl-logo'); logo.src = LOGO; logo.alt = 'Logo Energética'; logoFrame.append(logo);
  const notice = make('p', 'pl-notice'); notice.hidden = true; notice.setAttribute('role', 'status');
  const scroll = make('div', 'pl-table-scroll'); scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Tabela de pagamentos');
  const table = make('table', 'pl-table'); const head = make('thead'); const headRow = make('tr');
  const colgroup=make('colgroup');
  for(const width of [82,62,55,95,82,82,250,72,55,65,80,90]) { const col=make('col'); col.style.width=`${width/1170*100}%`; colgroup.append(col); }
  for (const label of COLUMNS) { const th = make('th', '', label); th.scope = 'col'; headRow.append(th); }
  const body = make('tbody'); head.append(headRow); table.append(colgroup, head, body);
  const loadStatus = make('p', 'pl-load-status'); loadStatus.setAttribute('role', 'status');
  loadStatus.setAttribute('data-report-screen-only', '');
  scroll.append(table, loadStatus);
  report.append(filters, logoFrame, notice, scroll);
  panel.append(warning, report); root.append(panel); doc.body.append(root);
  let destroyed = false, snapshot = null, controller = null, revision = 0, pickers = null;
  let entries = [], rendered = 0, lastGroup = null, lastRow = null, currentDay = '', dayIndex = -1;
  let dateCell = null, supplierCell = null, totalCell = null, merged = new Map(), lastScrollTop = 0, printing = false;
  let returnFocus = null, oldOverflow = '', app = null, oldInert = false;
  const portrait = () => win?.matchMedia ? win.matchMedia('(orientation: portrait)').matches : win?.innerHeight > win?.innerWidth;
  const showNotice = text => { notice.textContent = text; notice.hidden = !text; };
  function clearRows() {
    body.replaceChildren(); rendered = 0; lastGroup = lastRow = null; currentDay = ''; dayIndex = -1;
    dateCell = supplierCell = totalCell = null; merged.clear(); loadStatus.textContent = '';
  }
  const empty = () => { entries = []; clearRows(); scroll.scrollTop = 0; lastScrollTop = 0; };
  function cell(tr, column, value, span = 1) {
    const td = make('td', '', String(value ?? '').trim() || '—'); td.dataset.column = column; td.rowSpan = span; tr.append(td); return td;
  }
  function appendRows(limit = BATCH_SIZE) {
    const end = Math.min(entries.length, rendered + limit), fragment = doc.createDocumentFragment();
    for (; rendered < end; rendered++) {
      const { group, row } = entries[rendered], sameGroup = group === lastGroup;
      const firstDay = group.date !== currentDay;
      if (firstDay) { currentDay = group.date; dayIndex++; }
      const tr = make('tr', dayIndex % 2 === 0 ? 'pl-day-blue' : '');
      if (firstDay) dateCell = cell(tr, 'paymentDate', formatReportDate(group.date));
      else dateCell.rowSpan++;
      function mergedCell(column, keys) {
        if (sameGroup && keys.every(key => lastRow[key] === row[key])) merged.get(column).rowSpan++;
        else merged.set(column, cell(tr, column, row[column]));
      }
      mergedCell('order', ['branch', 'account', 'order']); cell(tr, 'id', row.id);
      if (!sameGroup) supplierCell = cell(tr, 'supplier', group.supplier); else supplierCell.rowSpan++;
      mergedCell('branch', ['branch']); mergedCell('account', ['branch', 'account']);
      const product = cell(tr, 'product', ''); product.replaceChildren(make('strong', '', row.product || '—'));
      if (row.description) product.append(doc.createTextNode(` (${row.description})`));
      cell(tr, 'unit', money(row.unit)); cell(tr, 'quantity', quantity(row.quantity));
      cell(tr, 'freight', money(row.freight)); cell(tr, 'total', money(row.total));
      // The full filtered supplier/day total comes from the complete snapshot, never the visible batch.
      if (!sameGroup) totalCell = cell(tr, 'supplierTotal', money(group.total)); else totalCell.rowSpan++;
      fragment.append(tr); lastGroup = group; lastRow = row;
    }
    body.append(fragment);
    loadStatus.textContent = entries.length ? `${rendered} de ${entries.length} lançamento(s)${rendered < entries.length ? ' · Role para baixo para carregar mais.' : ' · Fim da lista.'}` : '';
  }
  function render() {
    empty(); showNotice('');
    if (!snapshot) return;
    const selected = Object.fromEntries([...controls].map(([name, input]) => [name, input.value]));
    if (selected.startDate && selected.endDate && selected.startDate > selected.endDate) {
      showNotice('A data inicial não pode ser posterior à data final.'); return;
    }
    const result = buildPaymentLedger(snapshot.launches, selected);
    if (!result.count) showNotice('Nenhum pagamento corresponde aos filtros.');
    entries = result.groups.flatMap(group => group.rows.map(row => ({ group, row })));
    appendRows();
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
    pickers = bindSearchableFilterSelects(filters, {placement:'below',report:true});
  }
  async function load() {
    if (root.hidden || portrait() || destroyed) return;
    pickers?.close(); controller?.abort(); const current = ++revision;
    const active = new AbortController(); controller = active; snapshot = null; empty();
    showNotice('Carregando pagamentos do SharePoint…'); report.setAttribute('aria-busy', 'true'); refresh.disabled = true;
    try {
      if ([...dateDisplays.values()].some(input=>!input.checkValidity())) throw new Error('Data inválida. Use dd/mm/yyyy.');
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
    if (vertical) { pickers?.close(); if (report.contains(doc.activeElement)) panel.focus(); controller?.abort(); revision++; snapshot = null; empty(); report.hidden = true; }
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
    if (name === 'startDate' || name === 'endDate') { dateDisplays.get(name).value=control.value ? formatReportDate(control.value) : ''; dateDisplays.get(name).setCustomValidity(''); void load(); }
    else render();
  });
  refresh.addEventListener('click', () => { void load(); });
  root.addEventListener('click', event => { if (event.target === root) close(); }); root.addEventListener('keydown', keydown);
  function onScroll() {
    const top = scroll.scrollTop, movingDown = top > lastScrollTop; lastScrollTop = top;
    if (!movingDown || printing || root.hidden || report.hidden || destroyed || !snapshot || report.getAttribute('aria-busy') === 'true') return;
    if (scroll.clientHeight > 0 && top + scroll.clientHeight >= scroll.scrollHeight - 48) appendRows();
  }
  scroll.addEventListener('scroll', onScroll, { passive: true });
  win?.addEventListener('resize', orientationChanged); win?.addEventListener('orientationchange', orientationChanged);
  return Object.freeze({ element: root,
    async open() {
      if (destroyed) throw new Error('O relatório foi encerrado.');
      if (!root.hidden) return;
      returnFocus = doc.activeElement; oldOverflow = doc.body.style.overflow; app = doc.getElementById('app'); oldInert = app?.inert || false;
      doc.body.style.overflow = 'hidden'; if (app) app.inert = true;
      root.hidden = false;
      for (const name of ['startDate','endDate']) { controls.get(name).value=''; dateDisplays.get(name).value=''; dateDisplays.get(name).setCustomValidity(''); }
      const vertical = portrait(); warning.hidden = !vertical; report.hidden = vertical; panel.classList.toggle('pl-dialog--portrait', vertical); panel.focus();
      if (!vertical) await load();
    }, close,
    preparePrint() {
      const count = rendered, top = scroll.scrollTop, current = revision;
      printing = true; appendRows(entries.length);
      return () => {
        if (current === revision && !root.hidden && !destroyed) { clearRows(); appendRows(count); scroll.scrollTop = top; lastScrollTop = scroll.scrollTop; }
        printing = false;
      };
    },
    destroy() { if (destroyed) return; close(); destroyed = true; pickers?.destroy(); scroll.removeEventListener('scroll', onScroll); win?.removeEventListener('resize', orientationChanged); win?.removeEventListener('orientationchange', orientationChanged); root.remove(); },
  });
}
