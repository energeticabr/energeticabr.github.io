import { addReportCloseControl } from './report-close-control.js';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const isMoney = value => Number.isSafeInteger(value);
const money = value => isMoney(value) ? (value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : 'Indisponível';
const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '');
const currentMonth = () => { const today = new Date(); return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`; };
const dateLabel = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') ? value.split('-').reverse().join('/') : 'Data indisponível';
const checkedLabel = value => {
  if (!value) return 'não informada';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(date) : 'não informada';
};
const variationLabel = value => !isMoney(value) ? 'Sem comparação' : value < 0 ? `-${money(-value)}` : value > 0 ? `+${money(value)}` : money(0);
const cancelled = () => new DOMException('Consulta cancelada.', 'AbortError');
function abortable(promise, signal) {
  if (signal.aborted) return Promise.reject(cancelled());
  let abort;
  const cancellation = new Promise((_, reject) => { abort = () => reject(cancelled()); signal.addEventListener('abort', abort, { once: true }); });
  return Promise.race([promise, cancellation]).finally(() => signal.removeEventListener('abort', abort));
}

export function createTrancidReportView({ document: doc = globalThis.document, loadReport, onClose = () => {} } = {}) {
  if (!doc?.body || typeof loadReport !== 'function' || typeof onClose !== 'function') throw new TypeError('O relatório Trancid requer documento e consulta autenticada.');
  const make = (tag, className = '', text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const button = (className, label, text) => {
    const node = make('button', className, text); node.type = 'button'; node.setAttribute('aria-label', label); return node;
  };
  const root = make('div', 'trancid-overlay'); root.hidden = true; root.setAttribute('aria-busy', 'false');
  const panel = make('section', 'trancid-dialog'); panel.tabIndex = -1;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true'); panel.setAttribute('aria-label', 'Trancid — saldos dos cartões');
  const header = make('header', 'trancid-heading'), titles = make('div', 'trancid-titles');
  titles.append(make('p', 'trancid-eyebrow', 'TRANSPORTE'), make('h2', '', 'Cartões Trancid'));
  header.append(titles);
  const dismiss = button('trancid-close', 'Fechar relatório Trancid', '×');
  addReportCloseControl({ root: panel, toolbar: header, onClose: close, button: dismiss, inline: true });
  const toolbar = make('div', 'trancid-toolbar'), dateFilter = make('fieldset', 'trancid-date-filter');
  dateFilter.append(make('legend', '', 'DATA'));
  const month = make('select'), year = make('select'); month.name = 'month'; year.name = 'year';
  month.setAttribute('aria-label', 'Mês do histórico'); year.setAttribute('aria-label', 'Ano do histórico');
  MONTHS.forEach((label, index) => { const option = make('option', '', label); option.value = String(index + 1).padStart(2, '0'); month.append(option); });
  dateFilter.append(month, year);
  const refresh = button('trancid-refresh', 'Atualizar saldos Trancid', '↻'); refresh.dataset.action = 'refresh-trancid-report'; refresh.title = 'Atualizar saldos';
  toolbar.append(dateFilter, refresh);
  const body = make('div', 'trancid-body'); body.tabIndex = 0; body.setAttribute('role', 'region'); body.setAttribute('aria-label', 'Saldos atuais e histórico diário dos cartões');
  const intro = make('p', 'trancid-filter-note', 'DATA filtra apenas o histórico diário. Os saldos atuais e o alerta consideram a última posição disponível.');
  const notice = make('p', 'trancid-notice'); notice.hidden = true; notice.setAttribute('role', 'status');
  const summary = make('section', 'trancid-position'); summary.setAttribute('aria-label', 'Posição atual dos cartões'); summary.hidden = true;
  const updated = make('p', 'trancid-updated'), total = make('strong', 'trancid-total');
  summary.append(make('span', 'trancid-position-label', 'SALDO ATUAL TOTAL'), total, updated);
  const alert = make('p', 'trancid-alert'); alert.hidden = true; alert.setAttribute('role', 'status');
  const cards = make('div', 'trancid-cards');
  body.append(intro, notice, summary, alert, cards); panel.append(header, toolbar, body); root.append(panel); doc.body.append(root);

  let snapshot = null, controller = null, revision = 0, destroyed = false, returnFocus = null;
  let oldOverflow = '', app = null, oldInert = false;
  const expanded = new Set();
  const selectedMonth = () => `${year.value}-${month.value}`;
  function showNotice(text = '', failure = false) { notice.textContent = text; notice.hidden = !text; notice.setAttribute('role', failure ? 'alert' : 'status'); }
  function setBusy(busy) { root.setAttribute('aria-busy', String(busy)); refresh.disabled = busy; }
  function cancel() { revision++; controller?.abort(); controller = null; }
  function rememberExpanded() {
    for (const item of cards.querySelectorAll('details[data-trancid-card]')) {
      if (item.open) expanded.add(item.dataset.trancidCard); else expanded.delete(item.dataset.trancidCard);
    }
  }
  function selectPeriod(value, available = []) {
    const safe = validMonth(value) ? value : currentMonth();
    const years = [...new Set([safe.slice(0, 4), currentMonth().slice(0, 4), ...available.filter(validMonth).map(value => value.slice(0, 4))])].sort().reverse();
    year.replaceChildren(...years.map(value => { const option = make('option', '', value); option.value = value; return option; }));
    year.value = safe.slice(0, 4); month.value = safe.slice(5, 7);
  }
  function cardElement(card) {
    const id = String(card.card ?? ''), low = isMoney(card.balanceCents) && card.balanceCents < 4000;
    const details = make('details', `trancid-card${low ? ' trancid-card--low' : ''}`); details.dataset.trancidCard = id; details.open = expanded.has(id);
    const heading = make('summary', 'trancid-card-summary'), identity = make('span', 'trancid-identity');
    identity.append(make('strong', 'trancid-supplier', card.supplier || 'Fornecedor não informado'), make('span', 'trancid-card-number', `CARTÃO ${id || 'NÃO INFORMADO'}`));
    const position = make('span', 'trancid-card-position');
    position.append(make('span', 'trancid-balance-label', 'SALDO ATUAL'), make('strong', `trancid-balance${low ? ' trancid-balance--low' : ''}`, money(card.balanceCents)));
    const hint = make('span', 'trancid-expand-label', 'Histórico diário');
    heading.append(identity, position, hint); details.append(heading);
    const history = make('div', 'trancid-history');
    history.append(make('p', 'trancid-observed', `Saldo observado em ${checkedLabel(card.observedAt)}.`));
    const rows = (card.history || []).filter(row => typeof row.date === 'string' && row.date.slice(0, 7) === selectedMonth());
    if (rows.length) {
      const table = make('table', 'trancid-history-table'), caption = make('caption', '', `Histórico diário — ${MONTHS[Number(month.value) - 1]} de ${year.value}`);
      const thead = make('thead'), titles = make('tr'), tbody = make('tbody');
      for (const label of ['DATA', 'SALDO', 'VARIAÇÃO']) { const th = make('th', '', label); th.scope = 'col'; titles.append(th); }
      thead.append(titles);
      for (const row of rows) {
        const tr = make('tr'); tr.dataset.historyDate = row.date;
        const date = make('th', '', dateLabel(row.date)); date.scope = 'row';
        const balance = make('td', 'trancid-history-balance', money(row.balanceCents)); balance.dataset.historyBalance = '';
        if (isMoney(row.balanceCents) && row.balanceCents < 4000) balance.classList.add('trancid-balance--low');
        const delta = make('td', 'trancid-history-variation', variationLabel(row.variationCents)); delta.dataset.historyVariation = '';
        if (isMoney(row.variationCents) && row.variationCents < 0) delta.classList.add('trancid-history-variation--negative');
        if (isMoney(row.variationCents) && row.variationCents > 0) delta.classList.add('trancid-history-variation--positive');
        tr.append(date, balance, delta); tbody.append(tr);
      }
      table.append(caption, thead, tbody); history.append(table);
    } else history.append(make('p', 'trancid-empty-history', root.getAttribute('aria-busy') === 'true' ? 'Carregando histórico deste período…' : 'Nenhuma observação registrada neste período.'));
    history.append(make('p', 'trancid-history-note', 'Variação em relação ao dia anterior do calendário. Sem observação nesse dia, não há comparação.'));
    details.append(history); return details;
  }
  function render() {
    rememberExpanded();
    if (cards.contains(doc.activeElement)) panel.focus({ preventScroll: true });
    cards.replaceChildren();
    if (!snapshot) { summary.hidden = true; alert.hidden = true; return; }
    summary.hidden = false; total.textContent = money(snapshot.totalCents);
    updated.textContent = `Última consulta em ${checkedLabel(snapshot.lastCheckedAt)}.`;
    const lowCount = snapshot.cards.filter(card => isMoney(card.balanceCents) && card.balanceCents < 4000).length;
    alert.textContent = lowCount ? `Atenção: ${lowCount} ${lowCount === 1 ? 'cartão com saldo abaixo' : 'cartões com saldo abaixo'} de R$ 40,00.` : '';
    alert.hidden = !lowCount;
    const ids = new Set(snapshot.cards.map(card => String(card.card ?? '')));
    for (const id of expanded) if (!ids.has(id)) expanded.delete(id);
    if (!snapshot.cards.length) cards.append(make('p', 'trancid-empty', 'Nenhum cartão disponível para esta consulta.'));
    else for (const card of snapshot.cards) cards.append(cardElement(card));
  }
  function acceptReport(result, requestedMonth) {
    if (!result || !validMonth(result.month) || !Array.isArray(result.cards) || (requestedMonth && result.month !== requestedMonth)) throw new Error('Resposta de outro período.');
    snapshot = result; selectPeriod(result.month, result.months || []); setBusy(false); render();
    showNotice(result.lastError ? 'A última consulta não foi concluída. Os saldos exibidos são as últimas posições disponíveis; confira a data de observação de cada cartão.' : '', Boolean(result.lastError));
  }
  async function load(refreshData = false) {
    if (root.hidden || destroyed) return;
    cancel(); const version = revision, active = new AbortController(); controller = active;
    const requestedMonth = selectedMonth();
    setBusy(true); render(); showNotice('Consultando saldos e histórico…');
    const stale = () => destroyed || root.hidden || active.signal.aborted || version !== revision;
    try {
      const result = await abortable(Promise.resolve().then(() => {
        if (active.signal.aborted) throw cancelled();
        return loadReport({ month: requestedMonth, signal: active.signal, refresh: refreshData });
      }), active.signal);
      if (stale()) return;
      acceptReport(result, requestedMonth);
    } catch {
      if (stale()) return;
      setBusy(false); render();
      showNotice('Não foi possível atualizar os saldos e o histórico. Use Atualizar para tentar novamente. As posições disponíveis mantêm suas datas de observação.', true);
    } finally {
      if (!stale()) { controller = null; setBusy(false); }
    }
  }
  function close() {
    if (root.hidden) return;
    cancel(); root.hidden = true; setBusy(false); snapshot = null; expanded.clear(); cards.replaceChildren(); summary.hidden = true; alert.hidden = true;
    total.textContent = ''; updated.textContent = ''; alert.textContent = ''; showNotice();
    doc.body.style.overflow = oldOverflow; if (app) app.inert = oldInert;
    const target = returnFocus?.isConnected ? returnFocus : doc.querySelector('[data-action="open-trancid-report"]:not(:disabled)') || app;
    returnFocus = null; target?.focus?.({ preventScroll: true }); onClose();
  }
  refresh.addEventListener('click', () => void load(true));
  for (const control of [month, year]) control.addEventListener('change', () => void load(false));
  root.addEventListener('click', event => { if (event.target === root) close(); });
  root.addEventListener('keydown', event => {
    if (root.hidden || event.defaultPrevented) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...panel.querySelectorAll('button,select,summary,[tabindex="0"]')].filter(node => !node.disabled && !node.closest('[hidden]') && node.tabIndex >= 0);
    const first = focusable[0], last = focusable.at(-1);
    if (event.shiftKey && (doc.activeElement === first || doc.activeElement === panel)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && (doc.activeElement === last || doc.activeElement === panel)) { event.preventDefault(); first?.focus(); }
  });
  return Object.freeze({ element: root, async open({ initialSnapshot, automatic = false } = {}) {
    if (destroyed) throw new Error('O relatório Trancid foi encerrado.');
    if (!root.hidden) return false;
    returnFocus = doc.activeElement; oldOverflow = doc.body.style.overflow; app = doc.getElementById('app'); oldInert = Boolean(app?.inert);
    doc.body.style.overflow = 'hidden'; if (app) app.inert = true;
    root.hidden = false; root.dataset.automatic = String(Boolean(automatic)); selectPeriod(currentMonth()); body.scrollTop = 0; panel.focus({ preventScroll: true });
    if (initialSnapshot) {
      try { acceptReport(initialSnapshot); } catch { await load(); }
    } else await load();
    return true;
  }, close, destroy() {
    if (destroyed) return;
    close(); destroyed = true; cancel(); root.remove();
  } });
}
