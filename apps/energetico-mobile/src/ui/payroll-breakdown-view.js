import { PAYROLL_RUBRICS, payrollProvisionDates, validatePayrollBreakdown } from '../chat/payroll-breakdown.js';
import { payrollDecimal, payrollKey } from '../chat/supplier-payroll.js';
import { applyScreenNavigation } from './screen-navigation.js';
import { createLoadingIndicator } from './loading-indicator.js';

const money = value => Number(value).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dateText = date => date.split('-').reverse().join('/');
let sequence = 0;

export function createPayrollBreakdownView({ data, root, documentRef = globalThis.document, assertSession = () => {},
  onHome = () => {}, sessionKey = '', storage = globalThis.localStorage, now = () => new Date() } = {}) {
  if (!data || !documentRef?.createElement) throw new TypeError('A tela requer dados e documento.');
  const doc = documentRef, id = ++sequence;
  const el = (tag, className = '', text) => { const node = doc.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const page = el('section', 'payroll-breakdown-page'); page.hidden = true; page.tabIndex = -1;
  page.setAttribute('role', 'dialog'); page.setAttribute('aria-modal', 'true'); page.setAttribute('aria-labelledby', `breakdown-title-${id}`);
  const header = el('header', 'payroll-breakdown-header'), title = el('h1', '', 'DESDOBRAR FOLHA DE PGTO'); title.id = `breakdown-title-${id}`;
  const back = el('button', '', 'Voltar'), home = el('button', '', 'Início'); back.type = home.type = 'button';
  applyScreenNavigation({ header, back, home, title });
  const body = el('div', 'payroll-breakdown-body'), error = el('p', 'payroll-breakdown-error'), content = el('div', 'payroll-breakdown-content'), footer = el('footer', 'payroll-breakdown-footer');
  error.hidden = true; error.setAttribute('role', 'alert'); body.append(error, content); page.append(header, body, footer); (root || doc.body).append(page);
  let opened = false, destroyed = false, busy = false, mutating = false, epoch = 0, step = 'supplier', suppliers = [], result = null, previousFocus;
  const storageKey = sessionKey ? `energetico:payroll-breakdown:pending:${sessionKey}` : '';
  const currentMonth = () => {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).formatToParts(now());
    return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
  };
  let draft, progress;
  function reset() { draft = { supplier: null, month: currentMonth(), lines: [] }; progress = { operationId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` }; result = null; step = 'supplier'; }
  reset();
  function savePending() {
    if (storageKey && progress.signature && step !== 'done') storage.setItem(storageKey, JSON.stringify({ draft, progress }));
  }
  function restorePending() {
    if (!storageKey) return false;
    const raw = storage.getItem(storageKey);
    if (!raw) return false;
    try {
      const saved = JSON.parse(raw);
      validatePayrollBreakdown(saved.draft);
      if (!/^[A-Za-z0-9-]{1,80}$/.test(String(saved.progress?.operationId || '')) || !saved.progress.signature) throw new Error();
      draft = saved.draft; progress = saved.progress; step = 'review'; return true;
    } catch { storage.removeItem(storageKey); return false; }
  }
  function showError(cause) { error.textContent = cause?.message || 'Não foi possível concluir. Tente novamente.'; error.hidden = false; }
  function button(label, attribute, action) {
    const node = el('button', 'payroll-breakdown-button', label); node.type = 'button'; if (attribute) node.setAttribute(attribute, '');
    node.addEventListener('click', () => { if (!busy && !destroyed) void action(); }); return node;
  }
  function field(label, control) { const wrapper = el('label', 'payroll-breakdown-field'); wrapper.append(el('span', '', label), control); return wrapper; }
  async function work(action, message, mutation = false) {
    if (!opened || destroyed || busy) return false;
    const attempt = epoch; busy = true; mutating = mutation; error.hidden = true; render(message);
    const active = () => { assertSession(); if (!opened || destroyed || attempt !== epoch) throw new Error('Esta operação foi encerrada.'); };
    try { active(); await action(active); active(); busy = mutating = false; render(); return true; }
    catch (cause) { if (opened && !destroyed && epoch === attempt) { busy = mutating = false; render(); showError(cause); } return false; }
  }
  function identity() { content.append(el('p', 'payroll-breakdown-identity', `${draft.supplier.label} · ${draft.supplier.branch} · ${draft.supplier.profession}`)); }
  function initializeLines() {
    draft.lines = payrollProvisionDates(draft.month).flatMap(day => PAYROLL_RUBRICS.map(rubric =>
      draft.lines.find(line => line.date === day.date && line.rubric === rubric.id) || { date: day.date, rubric: rubric.id, quantity: '1', unitValue: '' }));
  }
  function supplierStep() {
    content.append(el('h2', '', 'Deseja desdobrar a folha de qual fornecedor?'));
    const filter = el('input'); filter.type = 'search'; filter.placeholder = 'Digite para filtrar os fornecedores'; filter.setAttribute('aria-label', 'Filtrar fornecedores');
    const list = el('div', 'payroll-breakdown-suppliers'); content.append(filter, list);
    for (const supplier of suppliers) {
      const option = button(supplier.label, '', () => { draft.supplier = supplier; step = 'month'; error.hidden = true; render(); }); option.dataset.breakdownSupplier = supplier.id; list.append(option);
    }
    if (!suppliers.length) content.append(el('p', '', 'Nenhum fornecedor ativo e empreiteiro foi encontrado.'));
    filter.addEventListener('input', () => { for (const child of list.children) child.hidden = !payrollKey(child.textContent).includes(payrollKey(filter.value)); });
  }
  function monthStep() {
    content.append(el('h2', '', 'Qual é o mês de referência?')); identity();
    const month = el('input'); month.type = 'month'; month.value = draft.month; month.min = '1900-01'; month.dataset.breakdownMonth = '';
    month.addEventListener('input', () => { draft.month = month.value; });
    content.append(field('Mês e ano', month), el('p', '', 'Serão exibidas todas as sextas-feiras e o último dia do mês.'));
    footer.append(button('Seguir', 'data-breakdown-next', () => { try { initializeLines(); step = 'schedule'; error.hidden = true; render(); } catch (cause) { showError(cause); } }));
  }
  function lineTotal(line) {
    if (!String(line.unitValue).trim()) return 0;
    return payrollDecimal(line.quantity).times(payrollDecimal(line.unitValue)).toDecimalPlaces(2).toNumber();
  }
  function scheduleStep() {
    content.append(el('h2', '', 'Preencha as provisões de pagamento')); identity();
    content.append(el('p', '', 'Informe a quantidade e o valor unitário nas rubricas que deseja programar.'));
    const total = totalsPanel();
    const updateTotal = () => {
      try {
        const rubrics = PAYROLL_RUBRICS.map(rubric => ({ label: rubric.label,
          total: draft.lines.filter(line => line.rubric === rubric.id).reduce((sum, line) => sum.plus(lineTotal(line)), payrollDecimal(0)).toNumber() }));
        total.update({ rubrics, total: rubrics.reduce((sum, rubric) => sum.plus(rubric.total), payrollDecimal(0)).toNumber() });
      } catch { total.update(null); }
    };
    for (const [index, day] of payrollProvisionDates(draft.month).entries()) {
      const cluster = el('details', 'payroll-breakdown-date'); cluster.open = index === 0; cluster.dataset.breakdownDate = day.date;
      const summary = el('summary'), dateTotal = el('span', 'payroll-breakdown-date-total');
      summary.append(el('strong', '', `📅 ${dateText(day.date)} · ${day.friday ? 'Sexta-feira' : 'Último dia do mês'}${day.friday && day.monthEnd ? ' · Último dia do mês' : ''}`), dateTotal); cluster.append(summary);
      const updateDay = () => { try { dateTotal.textContent = money(draft.lines.filter(line => line.date === day.date).reduce((sum, line) => sum + lineTotal(line), 0)); } catch { dateTotal.textContent = 'Confira os valores'; } };
      for (const rubric of PAYROLL_RUBRICS) {
        const line = draft.lines.find(item => item.date === day.date && item.rubric === rubric.id);
        const card = el('div', 'payroll-breakdown-rubric'); card.append(el('h3', '', rubric.label));
        const fields = el('div', 'payroll-breakdown-inputs'), quantity = el('input'), value = el('input'), subtotal = el('p', 'payroll-breakdown-subtotal');
        for (const input of [quantity, value]) { input.type = 'text'; input.inputMode = 'decimal'; }
        quantity.value = line.quantity; value.value = line.unitValue; value.placeholder = 'Digite o valor';
        quantity.setAttribute('aria-label', `Quantidade de ${rubric.label} em ${dateText(day.date)}`); value.setAttribute('aria-label', `Valor unitário de ${rubric.label} em ${dateText(day.date)}`);
        quantity.dataset.breakdownQuantity = `${day.date}:${rubric.id}`; value.dataset.breakdownValue = `${day.date}:${rubric.id}`;
        const recalculate = () => { let amount = 0; try { amount = lineTotal(line); subtotal.textContent = amount ? money(amount) : '—'; } catch { subtotal.textContent = 'Confira quantidade e valor'; } card.classList.toggle('payroll-breakdown-rubric--selected', amount > 0); updateDay(); updateTotal(); };
        quantity.addEventListener('input', () => { line.quantity = quantity.value; recalculate(); }); value.addEventListener('input', () => { line.unitValue = value.value; recalculate(); });
        fields.append(field('Quantidade', quantity), field('Valor unitário (R$)', value)); card.append(fields, subtotal); cluster.append(card); recalculate();
      }
      updateDay(); content.append(cluster);
    }
    content.append(total.element); updateTotal();
    footer.append(button('Seguir', 'data-breakdown-next', () => { try { validatePayrollBreakdown(draft); step = 'review'; error.hidden = true; render(); } catch (cause) { showError(cause); } }));
  }
  function rubricTable(summary) {
    const table = el('table', 'payroll-breakdown-table'); table.setAttribute('aria-label', 'Totais por rubrica');
    const head = el('thead'), hr = el('tr'); for (const label of ['Rubrica', 'Total previsto']) { const th = el('th', '', label); th.scope = 'col'; hr.append(th); } head.append(hr); table.append(head);
    const tbody = el('tbody'); for (const row of summary.rubrics) { const tr = el('tr'); tr.append(el('th', '', row.label), el('td', '', money(row.total))); tbody.append(tr); }
    const total = el('tr', 'payroll-breakdown-total-row'); total.append(el('th', '', 'Total geral'), el('td', '', money(summary.total))); tbody.append(total); table.append(tbody); return table;
  }
  function totalsPanel(initial) {
    const element = el('details', 'payroll-breakdown-totals');
    const trigger = el('summary', 'payroll-breakdown-total'), amount = el('span'), rows = el('div', 'payroll-breakdown-total-details');
    amount.setAttribute('aria-live', 'polite');
    trigger.append(amount, el('small', '', 'Totais por rubrica')); element.append(trigger, rows);
    const update = summary => {
      amount.textContent = summary ? `Total geral: ${money(summary.total)}` : 'Total geral: confira os valores';
      rows.replaceChildren(summary ? rubricTable(summary) : el('p', '', 'Confira os valores preenchidos para visualizar os totais por rubrica.'));
    };
    if (initial) update(initial);
    return { element, update };
  }
  function reviewStep() {
    const summary = validatePayrollBreakdown(draft); content.append(el('h2', '', 'Confira o desdobramento da folha')); identity();
    content.append(el('p', '', `${summary.lines.length} provisão(ões) · Referência ${draft.month.split('-').reverse().join('/')} · Pagamento ainda não efetuado`));
    const list = el('div', 'payroll-breakdown-review');
    for (const line of summary.lines) { const row = el('article'); row.append(el('h3', '', `📅 ${dateText(line.date)} · ${line.label}`), el('p', '', `${line.quantity.toLocaleString('pt-BR')} × ${money(line.unitValue)} = ${money(line.total)}`), el('small', '', line.observation)); list.append(row); }
    content.append(list, totalsPanel(summary).element);
    if (progress.signature) content.append(el('p', '', 'O envio já foi iniciado. Retome para concluir as provisões pendentes.'));
    else footer.append(button('Voltar', 'data-breakdown-edit', navigateBack));
    footer.append(button(progress.signature ? 'Retomar envio' : 'Confirmar e criar provisões', 'data-breakdown-submit', () => work(async active => {
      result = await data.post(draft, progress, () => { active(); savePending(); }); active();
      if (storageKey) storage.removeItem(storageKey); step = 'done';
    }, 'Criando provisões e descritivos…', true)));
  }
  function render(message) {
    content.replaceChildren(); footer.replaceChildren(); body.scrollTop = 0; back.disabled = home.disabled = mutating; footer.hidden = busy;
    if (busy) { content.append(createLoadingIndicator(doc, message || 'Carregando…')); return; }
    if (step === 'supplier') supplierStep();
    if (step === 'month') monthStep();
    if (step === 'schedule') scheduleStep();
    if (step === 'review') reviewStep();
    if (step === 'done') {
      content.append(el('h2', '', '✅ Provisões criadas com sucesso'), el('p', '', `${result.lines.length} provisão(ões), cada uma com seu próprio descritivo.`), totalsPanel(result).element);
      const list = el('ul'); for (const line of result.lines) list.append(el('li', '', `${dateText(line.date)} · ${line.label} · Provisão ID ${line.id} · Descritivo ID ${line.parentId}`)); content.append(list);
      footer.append(button('Concluir', 'data-breakdown-done', close));
    }
    if (progress.signature && step !== 'done') back.disabled = true;
  }
  function navigateBack() {
    if (!opened || destroyed || mutating || progress.signature && step !== 'done') return;
    if (busy) { epoch++; busy = false; }
    if (step === 'supplier' || step === 'done') { close(); return; }
    step = { month: 'supplier', schedule: 'month', review: 'schedule' }[step]; error.hidden = true; render();
  }
  function close() { if (!opened || destroyed || mutating) return false; savePending(); opened = false; epoch++; busy = false; page.hidden = true; previousFocus?.focus?.(); return true; }
  back.addEventListener('click', navigateBack); home.addEventListener('click', () => { if (close()) onHome(); });
  page.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); navigateBack(); } });
  return Object.freeze({ element: page,
    async open() {
      if (destroyed) return false; assertSession(); if (opened) return true; if (step === 'done') reset();
      previousFocus = doc.activeElement; opened = true; page.hidden = false; epoch++;
      if (progress.signature || restorePending()) { render(); return true; }
      return work(async active => { const loaded = await data.loadSuppliers(); active(); suppliers = loaded; }, 'Carregando fornecedores ativos…');
    }, close,
    destroy() { destroyed = true; opened = false; epoch++; page.remove(); },
  });
}
