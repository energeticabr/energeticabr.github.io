import { buildPaymentLedger } from '../chat/payment-ledger-model.js';
import { formatReportDate, formatReportMoney } from '../chat/contractor-report-model.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';

const COLUMNS = ['DATA PGTO', 'PEDIDO', 'ID', 'FORNECEDOR', 'FILIAL', 'CONTA', 'PRODUTO', 'VU', 'QTD', 'FRETE', 'TOTAL', 'TOTAL FORN. DIA'];
const FILTERS = [['branch', 'FILIAL'], ['order', 'ID PEDIDO'], ['product', 'PRODUTO'], ['supplier', 'FORNECEDOR'], ['disbursement', 'DESEMBOLSO']];
const LOGO = new URL('../../../../assets/logo-energetica-oficial.png', import.meta.url).href;
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
  const logo = make('img', 'pl-logo'); logo.src = LOGO; logo.alt = 'Logo Energética';
  const notice = make('p', 'pl-notice'); notice.hidden = true; notice.setAttribute('role', 'status');
  const scroll = make('div', 'pl-table-scroll'); scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region'); scroll.setAttribute('aria-label', 'Tabela de pagamentos');
  const table = make('table', 'pl-table'); const head = make('thead'); const headRow = make('tr');
  const colgroup=make('colgroup');
  for(const width of [82,62,55,95,82,82,250,72,55,65,80,90]) { const col=make('col'); col.style.width=`${width/1170*100}%`; colgroup.append(col); }
  for (const label of COLUMNS) { const th = make('th', '', label); th.scope = 'col'; headRow.append(th); }
  const body = make('tbody'); head.append(headRow); table.append(colgroup, head, body); scroll.append(table);
  const pager = make('nav', 'pl-pager'); pager.setAttribute('aria-label', 'Paginação do relatório');
  const previous = button('pl-page-button', '❮'); previous.setAttribute('aria-label', 'Página anterior');
  const next = button('pl-page-button', '❯'); next.setAttribute('aria-label', 'Próxima página');
  const pageLabel = make('span'); pager.append(previous, pageLabel, next);
  report.append(filters, logo, notice, scroll, pager);
  panel.append(warning, report); root.append(panel); doc.body.append(root);
  let destroyed = false, snapshot = null, controller = null, revision = 0, page = 1, pickers = null;
  let returnFocus = null, oldOverflow = '', app = null, oldInert = false;
  const portrait = () => win?.matchMedia ? win.matchMedia('(orientation: portrait)').matches : win?.innerHeight > win?.innerWidth;
  const showNotice = text => { notice.textContent = text; notice.hidden = !text; };
  const empty = () => { body.replaceChildren(); previous.disabled = next.disabled = true; pageLabel.textContent = ''; };
  function cell(tr, column, value, span = 1) {
    const td = make('td', '', String(value ?? '').trim() || '—'); td.dataset.column = column; td.rowSpan = span; tr.append(td); return td;
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
    // Paginate whole supplier/day groups so a supplier subtotal never splits over pages.
    const pages = Math.max(1, Math.ceil(result.groups.length / 15)); page = Math.min(page, pages);
    const groups = result.groups.slice((page - 1) * 15, page * 15);
    pageLabel.textContent = `Página ${page} de ${pages}`; previous.disabled = page <= 1; next.disabled = page >= pages;
    let currentDay = '', dayIndex = -1;
    for (const group of groups) {
      const firstDay = group.date !== currentDay;
      if (firstDay) { currentDay = group.date; dayIndex++; }
      const dateSpan = groups.filter(g => g.date === group.date).reduce((n, g) => n + g.rows.length, 0);
      function mergedCell(tr,column,row,index,keys) {
        const equal = candidate => keys.every(key => candidate[key] === row[key]);
        if(index>0 && equal(group.rows[index-1])) return;
        let end=index+1; while(end<group.rows.length && equal(group.rows[end])) end++;
        cell(tr,column,row[column],end-index);
      }
      group.rows.forEach((row, index) => {
        const tr = make('tr', dayIndex % 2 === 0 ? 'pl-day-blue' : '');
        if (firstDay && index === 0) cell(tr, 'paymentDate', formatReportDate(group.date), dateSpan);
        mergedCell(tr, 'order', row,index,['branch','account','order']); cell(tr, 'id', row.id);
        if (index === 0) cell(tr, 'supplier', group.supplier, group.rows.length);
        mergedCell(tr, 'branch', row,index,['branch']); mergedCell(tr, 'account', row,index,['branch','account']);
        const product=cell(tr, 'product',''); product.replaceChildren(make('strong','',row.product || '—'));
        if(row.description) product.append(doc.createTextNode(` (${row.description})`));
        cell(tr, 'unit', money(row.unit)); cell(tr, 'quantity', quantity(row.quantity)); cell(tr, 'freight', money(row.freight)); cell(tr, 'total', money(row.total));
        if (index === 0) cell(tr, 'supplierTotal', money(group.total), group.rows.length);
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
    pickers = bindSearchableFilterSelects(filters, {placement:'below'});
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
    page = 1;
    if (name === 'startDate' || name === 'endDate') { dateDisplays.get(name).value=control.value ? formatReportDate(control.value) : ''; dateDisplays.get(name).setCustomValidity(''); void load(); }
    else render();
  });
  refresh.addEventListener('click', () => { void load(); });
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
      for (const name of ['startDate','endDate']) { controls.get(name).value=''; dateDisplays.get(name).value=''; dateDisplays.get(name).setCustomValidity(''); }
      const vertical = portrait(); warning.hidden = !vertical; report.hidden = vertical; panel.classList.toggle('pl-dialog--portrait', vertical); panel.focus();
      if (!vertical) await load();
    }, close,
    destroy() { if (destroyed) return; close(); destroyed = true; pickers?.destroy(); win?.removeEventListener('resize', orientationChanged); win?.removeEventListener('orientationchange', orientationChanged); root.remove(); },
  });
}
