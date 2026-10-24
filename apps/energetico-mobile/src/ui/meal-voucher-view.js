import { mealVoucherLines, mealVoucherTotal, mealVoucherKey, validateMealVoucherDraft } from '../chat/meal-voucher.js';
import { createLoadingIndicator } from './loading-indicator.js';
import { applyScreenNavigation } from './screen-navigation.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';
import { sameMealVoucherTray } from '../chat/meal-voucher-tray.js';

const money = amount => Number(amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
let sequence = 0;

export function createMealVoucherView({ data, root, documentRef = globalThis.document, assertSession = () => {}, onHome = () => {}, attachmentTray, sessionKey = '', storage = globalThis.localStorage } = {}) {
  if (!data || !documentRef?.createElement) throw new TypeError('A tela exige dados e documento.');
  const doc = documentRef, id = ++sequence;
  const el = (tag, className = '', text) => { const node = doc.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const page = el('section', 'meal-voucher-page'); page.hidden = true; page.tabIndex = -1; page.setAttribute('role', 'dialog'); page.setAttribute('aria-modal', 'true'); page.setAttribute('aria-labelledby', `meal-voucher-title-${id}`);
  const header = el('header', 'meal-voucher-header'), title = el('h1', '', 'EFETUAR LANÇAMENTO VALE ALIMENTAÇÃO'); title.id = `meal-voucher-title-${id}`;
  const back = el('button', 'meal-voucher-navigation', 'Voltar'), home = el('button', 'meal-voucher-navigation', 'Início'); back.type = home.type = 'button';
  applyScreenNavigation({ header, back, home, title });
  const body = el('div', 'meal-voucher-body'), error = el('p', 'meal-voucher-error'), content = el('div', 'meal-voucher-content'), footer = el('footer', 'meal-voucher-footer'); error.hidden = true; error.setAttribute('role', 'alert');
  const tray = el('section','meal-voucher-tray'); tray.dataset.mealTray = ''; tray.setAttribute('aria-label','Barra de anexos');
  body.append(error, content); page.append(header, body, tray, footer); (root || doc.body).append(page);
  let opened = false, destroyed = false, busy = false, mutating = false, epoch = 0, step = 'lines', previousFocus = null;
  let detailPickers = null;
  let available = { suppliers: [], accounts: [], stages: [] }, orders = [], assignments = {}, result = null;
  let progress = {}, draft = {}, expectedFiles = [];
  const trayAccess = attachmentTray || {snapshot:()=>[],read:async()=>[]};
  let reviewedTray = null, trayActionBusy = false;
  const storageKey = sessionKey ? `energetico:meal-voucher:pending:${sessionKey}` : '';
  let pendingSnapshot = null;
  function savedFiles(files) { return files.map(file => ({ name: file.name, size: file.size, lastModified: file.lastModified })); }
  function clearPending() {
    if (storageKey && storage.getItem(storageKey) === pendingSnapshot) { storage.removeItem(storageKey); pendingSnapshot = null; }
  }
  function savePending() {
    if (!storageKey) return;
    if (storage.getItem(storageKey) !== pendingSnapshot) {
      const conflict = new Error('O lote mudou em outra tela. Revise os dados atualizados antes de confirmar.');
      conflict.code = 'MEAL_DRAFT_CHANGED'; throw conflict;
    }
    const files = expectedFiles.length && (locked() || !draft.files.length) ? expectedFiles : savedFiles(draft.files);
    const next = JSON.stringify({ draft: { ...draft, files: [] }, progress, files });
    storage.setItem(storageKey, next); pendingSnapshot = next;
  }
  function restorePending() {
    if (!storageKey) return false;
    const raw = storage.getItem(storageKey);
    pendingSnapshot = raw;
    if (!raw) return false;
    let saved;
    try { saved = JSON.parse(raw); } catch { clearPending(); return false; }
    if (!Array.isArray(saved?.draft?.lines) || !/^[A-Za-z0-9-]{1,80}$/.test(String(saved?.progress?.operationId || ''))) { clearPending(); return false; }
    draft = { ...saved.draft, files: [] }; progress = { ...saved.progress, editable:false };
    expectedFiles = Array.isArray(saved.files) ? saved.files : [];
    step = expectedFiles.length ? 'extras' : 'summary';
    return true;
  }
  function reset() {
    draft = { lines: [], orderMode: '', orderId: '', date: '', dueDate: '', paymentDate: '', referenceMonth: '', account: null, stage: null, obs: '', files: [] };
    progress = { operationId: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    expectedFiles = []; reviewedTray = null; result = null; step = 'lines';
  }
  reset();
  const locked = () => Boolean(progress.signature) && progress.editable !== true;
  function restoreOriginalDraft() {
    const original = validateMealVoucherDraft(JSON.parse(progress.signature));
    if (!Array.isArray(original.files)) throw new Error('Os anexos do lote anterior não foram confirmados.');
    const metadata = savedFiles(original.files), actualFiles = draft.files;
    const sameFiles = JSON.stringify(savedFiles(actualFiles)) === JSON.stringify(metadata);
    draft = { ...original, files:sameFiles ? actualFiles : [] };
    expectedFiles = sameFiles ? [] : metadata;
    if (expectedFiles.length && step === 'summary') step = 'extras';
  }
  async function refreshEditability() {
    if (!progress.signature) return true;
    progress.editable = false;
    if (typeof data.canEditPending !== 'function') return false;
    let editable;
    try { editable = await data.canEditPending(draft, progress) === true; }
    catch (cause) { assertSession(); restoreOriginalDraft(); savePending(); throw cause; }
    assertSession();
    if (editable) {
      progress.editable = true;
      for (const name of ['orderUpdated', 'lines', 'payroll', 'uploadedFiles']) delete progress[name];
    } else restoreOriginalDraft();
    savePending();
    return editable;
  }
  const button = (label, attribute, action) => { const node = el('button', 'meal-voucher-button', label); node.type = 'button'; if (attribute) node.setAttribute(attribute, ''); node.addEventListener('click', () => { if (!busy && !destroyed) void action(); }); return node; };
  const field = (label, input) => { const wrapper = el('label', 'meal-voucher-field'); wrapper.append(el('span', '', label), input); return wrapper; };
  function showError(cause) { error.textContent = cause?.message || 'Não foi possível concluir. Tente novamente.'; error.hidden = false; }
  async function trayAction(action) {
    if (busy || trayActionBusy || destroyed || !opened) return;
    trayActionBusy = true; error.hidden = true; renderTray();
    try { assertSession(); await action(); assertSession(); }
    catch (cause) { if (opened && !destroyed) showError(cause); }
    finally { trayActionBusy = false; if (opened && !destroyed) { trayChanged(); renderTray(); } }
  }
  function renderTray() {
    tray.replaceChildren(); tray.hidden = step === 'done';
    if (tray.hidden) return;
    const sources = trayAccess.snapshot(), top = el('div','meal-voucher-tray-heading');
    top.append(el('strong','',`📎 Anexos (${sources.length})`));
    const actions = el('div','meal-voucher-tray-actions');
    for (const [label,attribute,callback,title] of [
      ['📎','data-meal-tray-pick',trayAccess.pickFiles,'Selecionar arquivos'],
      ['📷','data-meal-tray-capture',trayAccess.capture,'Foto / Escanear'],
    ]) {
      const control = button(label,attribute,()=>trayAction(()=>callback())); control.title = title; control.setAttribute('aria-label',title);
      control.disabled = busy || trayActionBusy || !callback; actions.append(control);
    }
    top.append(actions); tray.append(top);
    if (!sources.length) { tray.append(el('p','meal-voucher-tray-empty','Os arquivos da bandeja serão enviados ao pedido e ao último lançamento.')); return; }
    const list = el('ul','meal-voucher-tray-list');
    for (const source of sources) {
      const row = el('li','meal-voucher-tray-file'), details = el('div');
      details.append(el('strong','',source.fileName),el('small','',source.status === 'failed' ? 'Falha no envio — remova ou tente novamente' : source.status !== 'ready' ? 'Enviando… Aguarde para confirmar.' : 'Será enviado ao pedido e ao último lançamento'));
      row.append(details);
      for (const [label,attribute,callback] of [['Visualizar','data-meal-tray-open',trayAccess.open],['Remover','data-meal-tray-remove',trayAccess.remove]]) {
        const control = button(label,attribute,()=>trayAction(()=>callback(source.id)));
        control.disabled = busy || trayActionBusy || source.status === 'sending' || !callback; row.append(control);
      }
      list.append(row);
    }
    tray.append(list);
  }
  function trayChanged() {
    if (!opened || destroyed) return;
    if (step === 'summary' && !busy && !trayActionBusy && !sameMealVoucherTray(reviewedTray || [],trayAccess.snapshot())) {
      if (locked()) expectedFiles = savedFiles(draft.files);
      reviewedTray = null; draft.files = []; step = 'extras'; render();
      showError(new Error('A bandeja de anexos mudou. Confira os arquivos e avance novamente para revisar.'));
    } else renderTray();
  }
  const unsubscribeTray = trayAccess.subscribe?.(trayChanged);
  function branch() { const lines = mealVoucherLines(draft.lines); const branch = lines[0].supplier.branch; if (lines.some(line => mealVoucherKey(line.supplier.branch) !== mealVoucherKey(branch))) throw new Error('Selecione fornecedores da mesma filial para um pedido.'); return branch; }
  async function work(action, message, mutation = false) {
    if (!opened || destroyed || busy) return false;
    const revision = epoch;
    busy = true; mutating = mutation; error.hidden = true; render(message);
    try { assertSession(); await action(); assertSession(); if (!opened || destroyed || epoch !== revision) return false; busy = false; mutating = false; render(); return true; }
    catch (cause) {
      if (opened && !destroyed && epoch === revision) {
        if (cause?.code === 'MEAL_DRAFT_CHANGED') {
          try {
            if (restorePending()) {
              const editable = await refreshEditability();
              if (editable) { step = 'details'; orders = await data.loadOrders(branch()); }
              else assignments = await data.loadSheetAssignments(draft.referenceMonth, mealVoucherLines(draft.lines).map(line => line.supplier));
            } else {
              reset(); draft.lines = available.suppliers.map(supplier => ({ supplier, quantity:'5', unitValue:'' }));
            }
          } catch (recoveryError) { cause = recoveryError; }
        } else if (mutation && progress.signature) {
          try { await refreshEditability(); } catch { progress.editable = false; }
        }
        if (opened && !destroyed && epoch === revision) { busy = false; mutating = false; render(); showError(cause); }
      }
      return false;
    }
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
    if (locked()) {
      content.append(el('p', '', `Pedido escolhido: ${draft.orderMode === 'new' ? 'novo' : `ID ${draft.orderId}`}`));
      return;
    }
    if (progress.orderId && draft.orderMode === 'new') {
      content.append(el('p', '', `O pedido ${progress.orderId} já foi criado e será reutilizado, sem duplicidade.`));
      content.append(button('Editar os dados deste pedido', 'data-meal-order-new', () => { step = 'details'; render(); }));
      return;
    }
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
    for (const [name, label, property] of [['meal-date', 'Data do lançamento', 'date'], ['meal-due-date', 'Data prevista de pagamento', 'dueDate'], ['meal-payment-date', 'Data do pagamento efetuado (deixe em branco se ainda não foi pago)', 'paymentDate']]) {
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
    content.append(el('h2', '', 'Há alguma OBS?'));
    if (expectedFiles.length) content.append(el('p', 'meal-voucher-warning', locked()
      ? `Para retomar, mantenha estes arquivos na barra de anexos: ${expectedFiles.map(file => file.name).join(', ')}. Arquivos já confirmados não serão duplicados.`
      : `Confira a barra de anexos. Arquivos da tentativa anterior: ${expectedFiles.map(file => file.name).join(', ')}.`));
    const obs = el('textarea'); obs.name = 'meal-obs'; obs.rows = 3; obs.value = draft.obs; obs.placeholder = 'Observação opcional'; obs.addEventListener('input', () => { draft.obs = obs.value; }); content.append(field('OBS (opcional)', obs));
    content.append(el('p','','Os arquivos serão incluídos automaticamente pela barra de anexos abaixo.'));
    footer.append(button('Seguir', 'data-meal-next', () => {
      const sources = trayAccess.snapshot(), expected = locked() ? expectedFiles.length ? expectedFiles : savedFiles(draft.files) : [];
      const accept = files => {
        if (locked()) {
          const ordered = expected.map(meta=>files.find(file=>file.name===meta.name && file.size===meta.size && file.lastModified===meta.lastModified));
          if (ordered.some(file=>!file) || files.length !== expected.length) throw new Error('Mantenha os mesmos anexos na barra antes de retomar o envio.');
          files = ordered;
        }
        draft.files = files; validateMealVoucherDraft(draft); expectedFiles = []; reviewedTray = sources; step = 'summary';
      };
      if (!sources.length && !expected.length) { try { accept([]); render(); } catch (cause) { showError(cause); } return; }
      return work(async()=>{const files = await trayAccess.read(sources,expected); assertSession(); accept(files);},'Conferindo arquivos da bandeja…');
    }));
  }
  function renderSummary() {
    const verified = validateMealVoucherDraft(draft);
    const review = el('div', 'meal-voucher-review'); review.dataset.mealReview = '';
    review.append(el('h2', '', 'Confirme os lançamentos de vale-alimentação'));
    review.append(el('p', 'meal-voucher-review-intro', 'Revise os dados abaixo antes de confirmar o lançamento.'));

    const order = el('section', 'meal-voucher-order-card'); order.dataset.mealOrderCard = '';
    const orderIcon = el('span', 'meal-voucher-order-icon', '▥'); orderIcon.setAttribute('aria-hidden', 'true');
    const orderInfo = el('div', 'meal-voucher-order-info');
    orderInfo.append(el('strong', '', `Pedido ${verified.orderMode === 'new' ? 'novo' : `ID ${verified.orderId}`} · ${verified.branch}`));
    const orderMeta = el('div', 'meal-voucher-order-meta');
    for (const line of [
      `Lançamento ${verified.date}  |  Vencimento ${verified.dueDate}`,
      `Pagamento efetuado ${verified.paymentDate || 'não informado'}  |  Mês de referência ${verified.referenceMonth}`,
      `${verified.stage.label}  ·  ${verified.account.label}`,
    ]) orderMeta.append(el('span', '', line));
    orderInfo.append(orderMeta); order.append(orderIcon, orderInfo); review.append(order);

    const peopleTitle = el('div', 'meal-voucher-people-title');
    peopleTitle.append(el('h3', '', `Colaboradores (${verified.lines.length})`));
    if (verified.lines.every(line => line.unitValue === verified.lines[0].unitValue)) peopleTitle.append(el('span', 'meal-voucher-daily-rate', `${money(verified.lines[0].unitValue)} por dia`));
    review.append(peopleTitle);
    const people = el('div', 'meal-voucher-people');
    for (const [index, line] of verified.lines.entries()) {
      const card = el('article', 'meal-voucher-person-card'); card.dataset.mealPersonCard = line.supplier.id;
      const avatar = el('span', `meal-voucher-avatar meal-voucher-avatar-${index % 5}`, line.supplier.label.trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()); avatar.setAttribute('aria-hidden', 'true');
      const details = el('div', 'meal-voucher-person-details');
      const identity = el('div', 'meal-voucher-person-identity'); identity.append(el('strong', '', line.supplier.label), el('small', '', line.supplier.profession)); details.append(identity);
      const metrics = el('div', 'meal-voucher-person-metrics');
      for (const [kind, label, value] of [
        ['sheet', 'IDFOLHA ', assignments[line.supplier.id]?.id || 'não confirmada'],
        ['quantity', 'Qtd. dias', line.quantity],
        ['unit', 'Valor unitário', money(line.unitValue)],
        ['total', 'Total', money(line.total)],
      ]) {
        const metric = el('div', `meal-voucher-metric meal-voucher-metric-${kind}`);
        metric.append(el('small', '', label), el('strong', '', value)); metrics.append(metric);
      }
      details.append(metrics); card.append(avatar, details); people.append(card);
    }
    review.append(people);

    const total = el('section', 'meal-voucher-review-total'); total.dataset.mealReviewTotal = '';
    const totalLabel = el('div'); totalLabel.append(el('strong', '', 'Total do lançamento'), el('small', '', `${verified.lines.length} colaborador(es) · ${verified.lines.reduce((sum, line) => sum + line.quantity, 0)} dias`));
    total.append(totalLabel, el('strong', 'meal-voucher-review-total-value', money(verified.total))); review.append(total);

    const extra = el('div', 'meal-voucher-review-extras');
    for (const [label, value, marker] of [
      ['Observações', verified.obs || 'Nenhuma observação', 'mealReviewNotes'],
      [`Anexos (${verified.files.length})`, verified.files.length ? verified.files.map(file => file.name).join(', ') : 'Nenhum anexo', 'mealReviewFiles'],
    ]) {
      const item = el('section', 'meal-voucher-review-extra'); item.dataset[marker] = '';
      item.append(el('strong', '', label), el('p', '', value)); extra.append(item);
    }
    review.append(extra); content.append(review);
    if (progress.orderId || Object.keys(progress.lines || {}).length || Object.keys(progress.payroll || {}).length) {
      const saved = [`Pedido ${progress.orderId || 'a confirmar'}`, ...Object.values(progress.lines || {}).map(id => `Lançamento ${id}`), ...Object.values(progress.payroll || {}).map(id => `Vínculo ${id}`)];
      content.append(el('p', 'meal-voucher-warning', `Já gravados nesta tentativa: ${saved.join(' · ')}. Retomar não duplicará estes registros.`));
    }
    footer.append(button('Voltar', 'data-meal-review-back', navigateBack));
    footer.append(button(locked() ? 'Retomar envio' : 'Confirmar e lançar', 'data-meal-confirm', () => work(async () => {
      if (!sameMealVoucherTray(reviewedTray || [],trayAccess.snapshot())) { step = 'extras'; throw new Error('A bandeja mudou. Revise os anexos antes de confirmar.'); }
      savePending();
      result = await data.post(verified, progress, savePending);
      clearPending(); step = 'done';
      try { await trayAccess.consume?.(reviewedTray || []); }
      catch (cause) { assertSession(); showError(cause); }
    }, 'Gravando pedido e lançamentos…', true)));
  }
  function render(message) {
    detailPickers?.destroy(); detailPickers = null;
    content.replaceChildren(); footer.replaceChildren(); footer.hidden = true; back.disabled = home.disabled = mutating;
    renderTray();
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
    if (progress.signature && !locked() && step !== 'done') content.prepend(el('p', 'meal-voucher-warning', 'Você pode corrigir os dados e confirmar novamente. Se o pedido já foi criado, ele será reutilizado, sem duplicidade.'));
    if (locked() && step !== 'done') content.prepend(el('p', 'meal-voucher-warning', 'Esta tentativa possui registros gravados ou ainda não foi possível conferi-los. Para evitar duplicidade, a edição está protegida. Retomar envia somente os registros pendentes.'));
    if (locked() && step !== 'summary' && step !== 'done') {
      for (const control of content.querySelectorAll('input, select, textarea, button')) {
        control.disabled = true;
      }
      detailPickers?.sync();
      if (step !== 'extras') {
        footer.replaceChildren(button('Seguir', 'data-meal-next', () => {
          step = { lines: 'order', order: 'details', details: 'extras', extras: 'summary' }[step];
          render();
        }));
      }
    }
    footer.hidden = !footer.childElementCount;
  }
  function navigateBack() {
    if (!opened || destroyed || mutating) return;
    if (step === 'lines' || step === 'done') { close(); return; }
    if (busy) { epoch++; busy = false; }
    step = { order: 'lines', details: 'order', extras: 'details', summary: 'extras' }[step] || 'lines'; error.hidden = true; render();
  }
  back.addEventListener('click', navigateBack); home.addEventListener('click', () => { if (close()) onHome(); });
  page.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); navigateBack(); } });
  function close() { if (!opened || destroyed || mutating) return false; if (progress.signature && step !== 'done' && (!storageKey || storage.getItem(storageKey) === pendingSnapshot)) savePending(); opened = false; epoch++; detailPickers?.close(); page.hidden = true; previousFocus?.focus?.(); return true; }
  return Object.freeze({
    async open() { if (destroyed) return false; assertSession(); if (opened) return true; if (step === 'done') reset(); previousFocus = doc.activeElement; opened = true; epoch++; page.hidden = false; const inMemory = Boolean(progress.signature); await work(async () => {
      available = await data.loadOptions();
      const changedElsewhere = storageKey && storage.getItem(storageKey) !== pendingSnapshot;
      const restored = (!inMemory || changedElsewhere) && restorePending();
      if (inMemory && changedElsewhere && !restored) reset();
      if ((!inMemory || changedElsewhere) && !restored) draft.lines = available.suppliers.map(supplier => ({ supplier, quantity: '5', unitValue: '' }));
      else {
        const editable = await refreshEditability();
        if (editable) {
          try { branch(); } catch { step = 'lines'; return; }
          if (restored) step = 'details';
          orders = await data.loadOrders(branch());
        } else assignments = await data.loadSheetAssignments(draft.referenceMonth, mealVoucherLines(draft.lines).map(line => line.supplier));
      }
    }, 'Carregando fornecedores…'); return true; },
    close,
    destroy() { destroyed = true; opened = false; epoch++; unsubscribeTray?.(); detailPickers?.destroy(); detailPickers = null; page.remove(); },
  });
}
