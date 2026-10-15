import { mealVoucherLines, mealVoucherTotal, mealVoucherKey, validateMealVoucherDraft } from '../chat/meal-voucher.js';
import { createLoadingIndicator } from './loading-indicator.js';
import { applyScreenNavigation } from './screen-navigation.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';

const money = amount => Number(amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let sequence = 0;

export function createMealVoucherView({ data, root, documentRef = globalThis.document, assertSession = () => {}, onHome = () => {}, sessionKey = '', storage = globalThis.localStorage } = {}) {
  if (!data || !documentRef?.createElement) throw new TypeError('A tela exige dados e documento.');
  const doc = documentRef, id = ++sequence;
  const el = (tag, className = '', text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const page = el('section', 'meal-voucher-page'); page.hidden = true; page.tabIndex = -1; page.setAttribute('role', 'dialog'); page.setAttribute('aria-modal', 'true'); page.setAttribute('aria-labelledby', `meal-voucher-title-${id}`);
  const header = el('header', 'meal-voucher-header'), title = el('h1', '', 'EFETUAR LANÇAMENTO VALE ALIMENTAÇÃO'); title.id = `meal-voucher-title-${id}`;
  const back = el('button', 'meal-voucher-navigation', 'Voltar'), home = el('button', 'meal-voucher-navigation', 'Início'); back.type = home.type = 'button';
  applyScreenNavigation({ header, back, home, title });
  const body = el('div', 'meal-voucher-body'), error = el('p', 'meal-voucher-error'), content = el('div', 'meal-voucher-content'), footer = el('footer', 'meal-voucher-footer'); error.hidden = true; error.setAttribute('role', 'alert');
  body.append(error, content); page.append(header, body, footer); (root || doc.body).append(page);
  let opened = false, destroyed = false, busy = false, mutating = false, epoch = 0, step = 'lines', previousFocus = null;
  let detailPickers = null;
  let available = { suppliers: [], accounts: [], stages: [] }, orders = [], assignments = {}, result = null;
  let progress = {}, draft = {}, expectedFiles = [];
  const storageKey = sessionKey ? `energetico:meal-voucher:pending:${sessionKey}` : '';
  function savedFiles(files) { return files.map(file => ({ name: file.name, size: file.size, lastModified: file.lastModified })); }
  function clearPending() { if (storageKey) storage.removeItem(storageKey); }
  function savePending() {
    if (!storageKey) return;
    storage.setItem(storageKey, JSON.stringify({ draft: { ...draft, files: [] }, progress, files: savedFiles(draft.files) }));
  }
  function restorePending() {
    if (!storageKey) return false;
    const raw = storage.getItem(storageKey);
    if (!raw) return false;
    let saved;
    try { saved = JSON.parse(raw); } catch { clearPending(); return false; }
    if (!Array.isArray(saved?.draft?.lines) || !/^[A-Za-z0-9-]{1,80}$/.test(String(saved?.progress?.operationId || ''))) { clearPending(); return false; }
    draft = { ...saved.draft, files: [] }; progress = saved.progress;
    expectedFiles = Array.isArray(saved.files) ? saved.files : [];
    step = expectedFiles.length ? 'extras' : 'summary';
    return true;
  }
  function reset() {
    draft = { lines: [], orderMode: '', orderId: '', date: '', dueDate: '', referenceMonth: '', account: null, stage: null, obs: '', files: [] };
    progress = { operationId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    expectedFiles = []; result = null; step = 'lines';
  }
  reset();
  const button = (label, attribute, action) => { const node = el('button', 'meal-voucher-button', label); node.type = 'button'; if (attribute) node.setAttribute(attribute, ''); node.addEventListener('click', () => { if (!busy && !destroyed) void action(); }); return node; };
  const field = (label, input) => { const wrapper = el('label', 'meal-voucher-field'); wrapper.append(el('span', '', label), input); return wrapper; };
  function showError(cause) { error.textContent = cause?.message || 'Não foi possível concluir. Tente novamente.'; error.hidden = false; }
  function branch() { const lines = mealVoucherLines(draft.lines); const branch = lines[0].supplier.branch; if (lines.some(line => mealVoucherKey(line.supplier.branch) !== mealVoucherKey(branch))) throw new Error('Selecione fornecedores da mesma filial para um pedido.'); return branch; }
  async function work(action, message, mutation = false) {
    if (!opened || destroyed || busy) return false;
    const revision = epoch;
    busy = true; mutating = mutation; error.hidden = true; render(message);
    try { assertSession(); await action(); assertSession(); if (!opened || destroyed || epoch !== revision) return false; busy = false; mutating = false; render(); return true; }
    catch (cause) { if (opened && !destroyed && epoch === revision) { busy = false; mutating = false; render(); showError(cause); } return false; }
  }
  function formSelect(name, choices, selected, onChange) {
    const select = el('select'); select.name = name; const blank = el('option', '', 'Selecione'); blank.value = ''; select.append(blank);
    for (const choice of choices) { const item = el('option', '', choice.label); item.value = choice.id; select.append(item); }
    select.value = selected || ''; select.addEventListener('change', () => onChange(choices.find(item => item.id === select.value) || null)); return select;
  }
  function totals() {
    try { content.querySelector('[data-meal-total]').textContent = `Total: ${money(mealVoucherTotal(draft.lines))}`; }
    catch { content.querySelector('[data-meal-total]').textContent = 'Total: confira os valores informados'; }
  }
  function renderLines() {
    content.append(el('h2', '', 'Vale-alimentação dos fornecedores'));
    content.append(el('p', '', 'Informe quantidade e valor unitário somente para os fornecedores que receberão lançamentos. Todos os empreiteiros ativos estão listados.'));
    const search = el('input', 'meal-voucher-search'); search.type = 'search'; search.placeholder = 'Filtrar fornecedores'; search.setAttribute('aria-label', 'Filtrar fornecedores'); content.append(search);
    const table = el('table', 'meal-voucher-table'); table.setAttribute('aria-label', 'Fornecedores e valores de vale-alimentação');
    const head = el('thead'), hrow = el('tr'); for (const label of ['Fornecedor', 'Qtd', 'Valor unitário', 'Subtotal']) { const th = el('th', '', label); th.scope = 'col'; hrow.append(th); } head.append(hrow); table.append(head);
    const tbody = el('tbody');
    for (const supplier of available.suppliers) {
      let line = draft.lines.find(item => item.supplier.id === supplier.id);
      if (!line) { line = { supplier, quantity: '5', unitValue: '' }; draft.lines.push(line); }
      const row = el('tr'); row.dataset.mealSupplier = supplier.id;
      const identity = el('td'); identity.append(el('strong', '', supplier.label), el('small', '', `${supplier.branch || 'Sem filial'} · ${supplier.profession || 'Sem profissão'}`)); row.append(identity);
      const quantity = el('input'); quantity.type = 'text'; quantity.inputMode = 'decimal'; quantity.value = line.quantity; quantity.setAttribute('aria-label', `Quantidade de ${supplier.label}`); quantity.dataset.mealQuantity = supplier.id;
      const value = el('input'); value.type = 'text'; value.inputMode = 'decimal'; value.value = line.unitValue; value.setAttribute('aria-label', `Valor unitário de ${supplier.label}`); value.dataset.mealValue = supplier.id;
      const subtotal = el('td', 'meal-voucher-subtotal', '—');
      const recalc = () => { recalcSafe(); totals(); };
      quantity.addEventListener('input', () => { line.quantity = quantity.value; recalc(); });
      value.addEventListener('input', () => { line.unitValue = value.value; recalc(); });
      const qcell = el('td'), vcell = el('td'); qcell.append(quantity); vcell.append(value); row.append(qcell, vcell, subtotal); tbody.append(row); recalcSafe();
      function recalcSafe() {
        let selected = false;
        try { mealVoucherLines([line]); selected = true; } catch { /* Linha incompleta ou inválida não será lançada. */ }
        row.classList.toggle('meal-voucher-selected-row', selected);
        try { subtotal.textContent = line.unitValue ? money(mealVoucherTotal([line])) : '—'; } catch { subtotal.textContent = 'Confira o valor'; }
      }
    }
    table.append(tbody); content.append(table);
    search.addEventListener('input', () => { const term = mealVoucherKey(search.value); for (const row of tbody.children) row.hidden = !mealVoucherKey(row.querySelector('strong').textContent).includes(term); });
    const total = el('p', 'meal-voucher-total'); total.dataset.mealTotal = ''; content.append(total); totals();
    footer.append(button('Seguir', 'data-meal-next', async () => {
      try { branch(); } catch (cause) { showError(cause); return; }
      await work(async () => { orders = await data.loadOrders(branch()); step = 'order'; }, 'Carregando pedidos…');
    }));
  }
  function renderOrder() {
    content.append(el('h2', '', 'Deseja criar pedido novo ou usar um existente?'));
    content.append(el('p', '', `Filial: ${branch()} · Total do lote: ${money(mealVoucherTotal(draft.lines))}`));
    content.append(button('Criar pedido novo', 'data-meal-order-new', () => { draft.orderMode = 'new'; draft.orderId = ''; step = 'details'; render(); }));
    if (orders.length) {
      content.append(el('h3', '', 'Seguir com pedido existente'));
      const selected = mealVoucherLines(draft.lines);
      const allowed = orders.filter(order => mealVoucherKey(order.supplier) === 'DIVERSOS' || selected.length === 1 && mealVoucherKey(order.supplier) === mealVoucherKey(selected[0].supplier.label));
      for (const order of allowed) content.append(button(order.label, 'data-meal-order-existing', () => { draft.orderMode = 'existing'; draft.orderId = order.id; step = 'details'; render(); }));
      if (!allowed.length) content.append(el('p', '', 'Nenhum pedido existente é compatível com estes fornecedores.'));
    } else content.append(el('p', '', 'Nenhum pedido pendente nesta filial.'));
  }
  function renderDetails() {
    content.append(el('h2', '', 'Informe os dados dos lançamentos'));
    content.append(el('p', '', `Pedido: ${draft.orderMode === 'new' ? 'novo' : `ID ${draft.orderId}`} · Filial: ${branch()}. O produto será a profissão de cada fornecedor.`));
    for (const [name, label, property] of [['meal-date', 'Data do lançamento', 'date'], ['meal-due-date', 'Data prevista de pagamento', 'dueDate']]) {
      const input = el('input'); input.type = 'date'; input.name = name; input.value = draft[property]; input.addEventListener('input', () => { draft[property] = input.value; }); content.append(field(label, input));
    }
    const month = el('input'); month.type = 'month'; month.name = 'meal-reference-month'; month.value = draft.referenceMonth; month.addEventListener('input', () => { draft.referenceMonth = month.value; });
    content.append(field('Mês de referência da IDFOLHA (um mês para todos)', month));
    content.append(field('Conta / forma de pagamento', formSelect('meal-account', available.accounts, draft.account?.id, choice => { draft.account = choice; })));
    content.append(field('Etapa da obra', formSelect('meal-stage', available.stages.filter(item => mealVoucherKey(item.branch) === mealVoucherKey(branch())), draft.stage?.id, choice => { draft.stage = choice; })));
    detailPickers = bindSearchableFilterSelects(content);
    footer.append(button('Seguir', 'data-meal-next', async () => {
      let verified;
      try { verified = validateMealVoucherDraft(draft); } catch (cause) { showError(cause); return; }
      await work(async () => { assignments = await data.loadSheetAssignments(verified.referenceMonth, verified.lines.map(line => line.supplier)); step = 'extras'; }, 'Conferindo a IDFOLHA de cada fornecedor…');
    }));
  }
  function renderExtras() {
    content.append(el('h2', '', 'Há alguma OBS ou anexos adicionais?'));
    if (expectedFiles.length) content.append(el('p', 'meal-voucher-warning', `Para retomar o envio, selecione novamente estes anexos: ${expectedFiles.map(file => file.name).join(', ')}. Eles só serão enviados se ainda não estiverem no pedido.`));
    const obs = el('textarea'); obs.name = 'meal-obs'; obs.rows = 3; obs.value = draft.obs; obs.placeholder = 'Observação opcional'; obs.addEventListener('input', () => { draft.obs = obs.value; }); content.append(field('OBS (opcional)', obs));
    const files = el('input'); files.type = 'file'; files.multiple = true; files.name = 'meal-files'; files.addEventListener('change', () => { draft.files = [...files.files]; list.textContent = draft.files.length ? draft.files.map(file => file.name).join(', ') : 'Sem anexos'; });
    content.append(field('Anexos adicionais (opcional; serão anexados ao pedido)', files)); const list = el('p', '', draft.files.length ? draft.files.map(file => file.name).join(', ') : 'Sem anexos'); content.append(list);
    footer.append(button('Seguir', 'data-meal-next', () => { try {
      if (expectedFiles.length && JSON.stringify(savedFiles(draft.files)) !== JSON.stringify(expectedFiles)) throw new Error('Selecione novamente os mesmos anexos antes de retomar.');
      validateMealVoucherDraft(draft); expectedFiles = []; step = 'summary'; render();
    } catch (cause) { showError(cause); } }));
  }
  function renderSummary() {
    const verified = validateMealVoucherDraft(draft);
    content.append(el('h2', '', 'Confirme os lançamentos de vale-alimentação'));
    content.append(el('p', '', `Pedido ${verified.orderMode === 'new' ? 'novo' : `ID ${verified.orderId}`} · ${verified.branch} · Lançamento ${verified.date} · Vencimento ${verified.dueDate} · Mês de referência ${verified.referenceMonth} · ${verified.stage.label} · ${verified.account.label}`));
    const list = el('ul', 'meal-voucher-summary'); for (const line of verified.lines) list.append(el('li', '', `${line.supplier.label} — ${line.supplier.profession} — IDFOLHA ${assignments[line.supplier.id]?.id || 'não confirmada'} — ${line.quantity} × ${money(line.unitValue)} = ${money(line.total)}`)); content.append(list);
    content.append(el('p', 'meal-voucher-total', `Total: ${money(verified.total)}`));
    content.append(el('p', '', `OBS: ${verified.obs || 'nenhuma'} · Anexos: ${verified.files.length ? verified.files.map(file => file.name).join(', ') : 'nenhum'}`));
    if (progress.orderId || Object.keys(progress.lines || {}).length || Object.keys(progress.payroll || {}).length) {
      const saved = [`Pedido ${progress.orderId || 'a confirmar'}`, ...Object.values(progress.lines || {}).map(id => `Lançamento ${id}`), ...Object.values(progress.payroll || {}).map(id => `Vínculo ${id}`)];
      content.append(el('p', 'meal-voucher-warning', `Já gravados nesta tentativa: ${saved.join(' · ')}. Retomar não duplicará estes registros.`));
    }
    footer.append(button(progress.signature ? 'Retomar envio' : 'Confirmar e lançar', 'data-meal-confirm', () => work(async () => {
      savePending();
      result = await data.post(verified, progress, savePending);
      clearPending(); step = 'done';
    }, 'Gravando pedido e lançamentos…', true)));
  }
  function render(message) {
    detailPickers?.destroy(); detailPickers = null;
    content.replaceChildren(); footer.replaceChildren(); footer.hidden = true; back.disabled = home.disabled = mutating;
    if (busy) { content.append(createLoadingIndicator(doc, message || 'Carregando vale-alimentação…')); return; }
    if (step === 'lines') renderLines();
    if (step === 'order') renderOrder();
    if (step === 'details') renderDetails();
    if (step === 'extras') renderExtras();
    if (step === 'summary') renderSummary();
    if (step === 'done') {
      content.append(el('h2', '', 'Vale-alimentação lançado com sucesso'));
      content.append(el('p', '', `Pedido ${result.orderId} · ${result.lines.length} lançamento(s) vinculados às respectivas IDFOLHA · Total ${money(result.total)}`));
      const list = el('ul', 'meal-voucher-summary');
      for (const line of result.lines) list.append(el('li', '', `${line.supplier} · Lançamento ${line.id} · IDFOLHA ${line.sheetId} · Vínculo ${line.payrollId}`));
      content.append(list); footer.append(button('Concluir', 'data-meal-done', close));
    }
    footer.hidden = !footer.childElementCount;
  }
  function navigateBack() {
    if (!opened || destroyed || mutating) return;
    if (progress.signature || step === 'lines' || step === 'done') { close(); return; }
    if (busy) { epoch++; busy = false; }
    step = { order: 'lines', details: 'order', extras: 'details', summary: 'extras' }[step] || 'lines'; error.hidden = true; render();
  }
  back.addEventListener('click', navigateBack); home.addEventListener('click', () => { if (close()) onHome(); });
  page.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); navigateBack(); } });
  function close() { if (!opened || destroyed || mutating) return false; opened = false; epoch++; detailPickers?.close(); page.hidden = true; previousFocus?.focus?.(); return true; }
  return Object.freeze({
    async open() { if (destroyed) return false; assertSession(); if (opened) return true; if (step === 'done') reset(); previousFocus = doc.activeElement; opened = true; epoch++; page.hidden = false; if (progress.signature && !expectedFiles.length) { render(); return true; } await work(async () => {
      available = await data.loadOptions();
      if (!restorePending()) draft.lines = available.suppliers.map(supplier => ({ supplier, quantity: '5', unitValue: '' }));
      else assignments = await data.loadSheetAssignments(draft.referenceMonth, mealVoucherLines(draft.lines).map(line => line.supplier));
    }, 'Carregando fornecedores…'); return true; },
    close,
    destroy() { destroyed = true; opened = false; epoch++; detailPickers?.destroy(); detailPickers = null; page.remove(); },
  });
}
