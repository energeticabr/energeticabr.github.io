import { escapeHtml } from './escape-html.js';
import { bindSearchableFilterSelects } from './searchable-filter-selects.js';
import { addReportCloseControl } from './report-close-control.js';

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const money = cents => currency.format(cents / 100);
const dateLabel = value => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Data não informada';
};
const definitiveErrors = new Set([
  'conflict', 'not_found', 'payroll_not_pending', 'payroll_sheet_unavailable', 'payroll_existing_link_conflict',
  'invalid_amount', 'invalid_payload', 'confirmation_required', 'request_id_conflict', 'payroll_write_rejected',
]);
const reportTimeoutMs = 45_000;

function partialCents(value) {
  const text = value.trim();
  const parts = /^(\d+|\d{1,3}(?:\.\d{3})+)(?:,(\d{1,2}))?$/.exec(text)
    || /^(\d+)\.(\d{1,2})$/.exec(text);
  if (!parts) return null;
  const cents = Number(parts[1].replaceAll('.', '') + (parts[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

function validItem(item) {
  return /^\d+$/.test(item?.id) && typeof item.revision === 'string'
    && Number.isSafeInteger(item.totalCents) && item.totalCents > 0
    && Number.isSafeInteger(item.remainingCents) && item.remainingCents >= 0 && item.remainingCents <= item.totalCents
    && Array.isArray(item.allocations) && item.allocations.every(allocation =>
      /^\d+$/.test(allocation?.sheetId) && Number.isSafeInteger(allocation.amountCents) && allocation.amountCents > 0);
}

function pageResult(result) {
  if (!Array.isArray(result?.items) || !result.items.every(item => validItem(item) && item.remainingCents > 0)
    || !Number.isSafeInteger(result.total) || result.total < result.items.length
    || !Number.isSafeInteger(result.page) || result.page < 1
    || !Number.isSafeInteger(result.pageSize) || result.pageSize < 1) {
    throw new Error('A VM não confirmou a lista de pagamentos pendentes.');
  }
  return result;
}

function targetResult(result) {
  if (!Array.isArray(result?.items) || !result.items.every(group =>
    typeof group?.supplier === 'string' && group.supplier.trim() && Array.isArray(group.sheets) && group.sheets.length
    && group.sheets.every(sheet => /^\d+$/.test(sheet?.id) && /^(0[1-9]|1[0-2])\/\d{4}$/.test(sheet.reference)))
    || !Array.isArray(result.paymentTypes) || !result.paymentTypes.length
    || !result.paymentTypes.every(type => typeof type === 'string' && type.trim())) {
    throw new Error('Não foi possível verificar os fornecedores, as folhas e os tipos de pagamento.');
  }
  return result;
}

function launchCard(item, includeAction, attempt) {
  const id = escapeHtml(item.id);
  const applied = item.totalCents - item.remainingCents;
  const history = item.allocations.length ? `<ul class="payroll-links-history" aria-label="Aplicações em folha">${item.allocations.map(allocation =>
    `<li><div><strong>${escapeHtml(allocation.supplier || '')}</strong><span>IDFOLHA ${escapeHtml(allocation.sheetId)} · ID origem ${id}</span>
    ${allocation.paymentType ? `<small>${escapeHtml(allocation.paymentType)}</small>` : ''}</div><strong>${money(allocation.amountCents)}</strong></li>`).join('')}</ul>` : '';
  return `<article class="payroll-links-card">
    <div class="payroll-links-card__heading"><div><strong>ID ${id} · ${escapeHtml(item.supplier || 'Fornecedor não informado')}</strong>
    <small>${item.product ? `${escapeHtml(item.product)} · ` : ''}Pago em ${dateLabel(item.paidAt)}</small></div>
    ${attempt
      ? `<button type="button" data-payroll-action="retry" data-id="${id}" aria-label="Retomar confirmação do lançamento ${id}">Retomar confirmação</button>`
      : item.applicationPending === true
      ? '<small class="payroll-links-awaiting">Aguardando confirmação da aplicação. Atualize para verificar o saldo.</small>'
      : includeAction ? `<button type="button" data-payroll-action="edit" data-id="${id}" aria-label="Vincular lançamento ${id} ao IDFOLHA">Vincular IDFOLHA</button>` : ''}</div>
    <dl><div><dt>Valor total</dt><dd>${money(item.totalCents)}</dd></div>
      <div><dt>Aplicado</dt><dd>${money(applied)}</dd></div>
      <div><dt>Saldo a aplicar</dt><dd>${money(item.remainingCents)}</dd></div></dl>
    ${history}</article>`;
}

export function createPendingPayrollLinksView({ root, request, onClose, recovery, makeRequestId }) {
  const doc = root.ownerDocument;
  const shell = root.querySelector('.chat-shell');
  if (!shell) return null;
  const backdrop = doc.createElement('div');
  backdrop.className = 'chat-confirmation-backdrop payroll-links-overlay';
  backdrop.innerHTML = `<section class="payroll-links-panel" role="dialog" aria-modal="true" aria-labelledby="payroll-links-title" data-pending-payroll-links tabindex="-1">
    <div class="payroll-links-bar">
      <button type="button" data-payroll-action="refresh" aria-label="Atualizar pagamentos sem vínculo em folha" title="Atualizar">↻</button>
      <h2 id="payroll-links-title">Pagamentos sem vínculo em folha</h2>
    </div>
    <div class="payroll-links-content">
      <p class="payroll-links-notice" role="status" hidden></p>
      <p class="payroll-links-error" role="alert" hidden></p>
      <div class="payroll-links-main"></div>
    </div>
  </section>`;
  const panel = backdrop.querySelector('[data-pending-payroll-links]');
  const bar = panel.querySelector('.payroll-links-bar');
  const refresh = bar.querySelector('button');
  const close = addReportCloseControl({ root: backdrop, toolbar: bar, onClose, inline: true });
  close.dataset.payrollAction = 'close';
  const content = panel.querySelector('.payroll-links-content');
  const notice = content.querySelector('[role="status"]');
  const alert = content.querySelector('[role="alert"]');
  const main = content.querySelector('.payroll-links-main');

  const wasInert = shell.hasAttribute('inert');
  shell.setAttribute('inert', '');
  root.append(backdrop);
  panel.focus();

  let snapshot = null;
  let item = null;
  let busy = false;
  let disposed = false;
  let controller = null;
  let picker = null;
  let mode = null;
  let targets = null;
  let form = null;

  function announce(message, error = '') {
    notice.textContent = message;
    notice.hidden = !message;
    alert.textContent = error;
    alert.hidden = !error;
  }

  function renderMarkup(markup, focus) {
    picker?.destroy();
    picker = null;
    form = null;
    main.innerHTML = markup;
    content.scrollTop = 0;
    if (focus) (main.querySelector(focus) || panel).focus({ preventScroll: true });
  }

  function setBusy(value) {
    busy = value;
    panel.toggleAttribute('data-loading', value);
    refresh.disabled = value || Boolean(item);
  }

  function startRequest() {
    controller?.abort();
    const active = new AbortController();
    controller = active;
    setBusy(true);
    return active;
  }

  function current(active) {
    return !disposed && controller === active && !active.signal.aborted;
  }

  async function query(operation, payload, active) {
    const requestController = new AbortController();
    const cancel = () => requestController.abort();
    active.signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(cancel, reportTimeoutMs);
    try {
      return await request(operation, payload, { signal: requestController.signal });
    } catch (error) {
      if (requestController.signal.aborted && !active.signal.aborted) {
        throw new Error('A VM não respondeu a tempo. Tente novamente.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      active.signal.removeEventListener('abort', cancel);
    }
  }

  function showPage({ message = '', error = '', unavailable = false } = {}) {
    const { total, items, page, pageSize } = snapshot;
    const pageCount = Math.max(1, Math.ceil(total / pageSize));
    announce(message, error);
    const pendingElsewhere = [...recovery.values()].filter(attempt => !items.some(row => String(row.id) === attempt.payload.id));
    const pending = pendingElsewhere.length ? `<section class="payroll-links-recovery" aria-label="Aplicações a confirmar">
      <h3>Aplicações a confirmar</h3>
      ${pendingElsewhere.map(({ payload, amountCents }) => `<article class="payroll-links-card">
        <p>ID origem ${escapeHtml(payload.id)} · ${escapeHtml(payload.supplier)} · IDFOLHA ${escapeHtml(payload.sheetId)} · ${money(amountCents)}</p>
        <button type="button" data-payroll-action="retry" data-id="${escapeHtml(payload.id)}">Retomar confirmação</button>
      </article>`).join('')}</section>` : '';
    renderMarkup(pending + (items.length ? `<p class="payroll-links-count">${total} ${total === 1 ? 'pagamento pendente' : 'pagamentos pendentes'}</p>
      <div class="payroll-links-list">${items.map(row => launchCard(row, true, recovery.get(String(row.id)))).join('')}</div>
      ${pageCount > 1 ? `<nav class="payroll-links-pages" aria-label="Paginação dos pagamentos">
        <button type="button" data-payroll-action="previous"${page === 1 ? ' disabled' : ''}>Anterior</button>
        <span>Página ${page} de ${pageCount}</span>
        <button type="button" data-payroll-action="next"${page >= pageCount ? ' disabled' : ''}>Próxima</button></nav>` : ''}`
      : unavailable ? '' : '<p>Nenhum pagamento pendente de vinculação em IDFOLHA.</p>'), '[data-payroll-action="edit"], [data-payroll-action="retry"]');
  }

  async function renderPage(number, { message = '', error = '' } = {}) {
    item = null;
    const active = startRequest();
    announce('Carregando pagamentos…');
    renderMarkup('', '[data-payroll-action="refresh"]');
    try {
      const result = pageResult(await query('payroll_pending', { page: number }, active));
      if (!current(active)) return;
      snapshot = result;
      showPage({ message, error });
    } catch (cause) {
      if (current(active)) {
        const failure = error || cause?.message || 'Não foi possível consultar os pagamentos.';
        if (snapshot) showPage({ message, error: failure });
        else if (recovery.size) {
          snapshot = { items: [], total: 0, page: 1, pageSize: 1 };
          showPage({ message, error: failure, unavailable: true });
        } else announce(message, failure);
      }
    } finally {
      if (current(active)) setBusy(false);
    }
  }

  function leaveForm() {
    if (!item || busy && recovery.has(String(item.id))) return false;
    controller?.abort();
    item = null;
    setBusy(false);
    showPage();
    return true;
  }

  function setOptions(select, placeholder, options) {
    const option = (label, value) => {
      const element = doc.createElement('option');
      element.textContent = label;
      element.value = value;
      return element;
    };
    const empty = option(placeholder, '');
    empty.hidden = true;
    select.replaceChildren(empty, ...options.map(([label, value]) => option(label, value)));
    select.value = '';
  }

  function showForm() {
    mode = null;
    const editor = `<div class="payroll-links-form">
      <div class="payroll-links-targets">
        <label>Fornecedor<select name="supplier" aria-label="Fornecedor"></select></label>
        <label data-payroll-role="sheet" hidden>IDFOLHA<select name="sheet"></select></label>
        <label data-payroll-role="payment-type" hidden>Tipo de pagamento<select name="paymentType"></select></label>
      </div>
      <div class="payroll-links-modes" hidden>
        <button type="button" data-payroll-action="total" aria-pressed="false">Apontar valor total</button>
        <button type="button" data-payroll-action="partial" aria-pressed="false">Apontar valor parcial</button>
      </div>
      <label class="payroll-links-amount" hidden>Valor parcial (R$)<input name="amount" type="text" inputmode="decimal" autocomplete="off" maxlength="24" placeholder="0,00" aria-describedby="payroll-links-amount-hint"></label>
      <p class="payroll-links-form-hint" id="payroll-links-amount-hint" hidden></p>
      <button type="button" class="payroll-links-confirm" data-payroll-action="confirm" hidden disabled>Confirmar aplicação</button>
    </div>`;
    renderMarkup(`<button type="button" class="payroll-links-back" data-payroll-action="back">← Voltar às pendências</button>
      ${launchCard(item, false)}${targets.items.length ? editor : '<p>Nenhum fornecedor tem IDFOLHA disponível.</p>'}`,
      '[data-payroll-action="back"]');
    form = main.querySelector('.payroll-links-form');
    if (!form) return;
    const supplier = form.querySelector('select[name="supplier"]');
    setOptions(supplier, 'Digite para pesquisar', targets.items.map((group, index) => [group.supplier, String(index)]));
    const type = form.querySelector('select[name="paymentType"]');
    setOptions(type, 'Selecione o tipo', targets.paymentTypes.map(value => [value, value]));
    picker = bindSearchableFilterSelects(supplier.parentElement);
  }

  async function openForm(row) {
    if (busy || !row || recovery.has(String(row.id)) || row.applicationPending === true) return;
    item = row;
    const active = startRequest();
    announce('Consultando folhas disponíveis…');
    renderMarkup(`<button type="button" class="payroll-links-back" data-payroll-action="back">← Voltar às pendências</button>${launchCard(row, false)}`,
      '[data-payroll-action="back"]');
    try {
      const result = targetResult(await query('payroll_targets', {}, active));
      if (!current(active)) return;
      targets = result;
      announce('');
      showForm();
    } catch (error) {
      if (current(active)) announce('', error?.message || 'Não foi possível consultar as folhas. Volte e tente novamente.');
    } finally {
      if (current(active)) setBusy(false);
    }
  }

  function selectedSupplier() {
    const value = form.querySelector('select[name="supplier"]').value;
    return value === '' ? null : targets.items[Number(value)];
  }

  function updateSupplier() {
    const group = selectedSupplier();
    form.querySelector('[data-payroll-role="sheet"]').hidden = !group;
    const sheet = form.querySelector('select[name="sheet"]');
    setOptions(sheet, 'Selecione o IDFOLHA', (group?.sheets || []).map(option => [
      `IDFOLHA ${option.id}${option.reference ? ` · ${option.reference}` : ''}`, String(option.id),
    ]));
    form.querySelector('select[name="paymentType"]').value = '';
  }

  function selectedDestination() {
    const supplier = selectedSupplier();
    const sheetId = form.querySelector('select[name="sheet"]').value;
    const paymentType = form.querySelector('select[name="paymentType"]').value;
    const sheet = supplier?.sheets.find(option => String(option.id) === sheetId);
    if (!sheet || !targets.paymentTypes.includes(paymentType)) return null;
    return { supplier: supplier.supplier, sheetId, reference: sheet.reference, paymentType };
  }

  function updateForm() {
    const sheetId = form.querySelector('select[name="sheet"]').value;
    const destination = selectedDestination();
    const modes = form.querySelector('.payroll-links-modes');
    const input = form.querySelector('input[name="amount"]');
    const hint = form.querySelector('.payroll-links-form-hint');
    const confirm = form.querySelector('[data-payroll-action="confirm"]');
    const cents = mode === 'total' ? item.remainingCents : partialCents(input.value);
    const valid = cents > 0 && (mode === 'total' || cents < item.remainingCents);
    form.querySelector('[data-payroll-role="payment-type"]').hidden = !sheetId;
    modes.hidden = !destination;
    for (const button of modes.querySelectorAll('button')) button.setAttribute('aria-pressed', String(button.dataset.payrollAction === mode));
    input.parentElement.hidden = !destination || mode !== 'partial';
    hint.hidden = !destination || mode !== 'partial' || !input.value.trim() || valid;
    hint.textContent = `Digite um valor maior que zero e menor que ${money(item.remainingCents)}. Para usar todo o saldo, escolha valor total.`;
    confirm.hidden = !destination || !mode;
    confirm.disabled = !destination || !mode || !valid;
    confirm.textContent = valid ? `Confirmar aplicação de ${money(cents)}` : 'Confirmar aplicação';
    return valid && destination ? { ...destination, amountCents: cents } : null;
  }

  async function submit(attempt) {
    if (busy || recovery.get(attempt.payload.id) !== attempt) return;
    const active = startRequest();
    const { payload } = attempt;
    const sourcePage = snapshot?.page || 1;
    announce('Confirmando aplicação…');
    renderMarkup(`<p>ID origem ${escapeHtml(payload.id)} · IDFOLHA ${escapeHtml(payload.sheetId)} · ${money(attempt.amountCents)}</p>`);
    try {
      const { item: updated } = await query('payroll_apply', payload, active);
      if (!current(active)) return;
      if (!validItem(updated) || String(updated.id) !== payload.id) {
        throw new Error('A VM não confirmou o saldo do lançamento.');
      }
      recovery.delete(payload.id);
      const id = updated.id;
      if (updated.remainingCents === 0) {
        await renderPage(sourcePage, { message: `Lançamento ${id} totalmente aplicado em folha.` });
      } else {
        const message = `Aplicação registrada. Saldo a aplicar: ${money(updated.remainingCents)}.`;
        if (!snapshot?.items.some(row => String(row.id) === payload.id)) {
          await renderPage(sourcePage, { message });
          return;
        }
        snapshot = { ...snapshot, items: snapshot.items.map(row => String(row.id) === payload.id ? updated : row) };
        item = null;
        showPage({ message });
      }
    } catch (error) {
      if (!current(active)) return;
      if (definitiveErrors.has(error?.code)) {
        recovery.delete(payload.id);
        await renderPage(sourcePage, { error: error.message });
      } else {
        item = null;
        showPage({ error: `A VM ainda não confirmou a aplicação do lançamento ${payload.id}. Retome a confirmação na própria linha.` });
      }
    } finally {
      if (current(active)) setBusy(false);
    }
  }

  function confirm() {
    if (busy || !item || !form || recovery.has(String(item.id))) return;
    const destination = updateForm();
    if (!destination) return;
    const { amountCents, supplier, sheetId, reference, paymentType } = destination;
    const payload = Object.freeze({
      id: String(item.id), supplier, sheetId, reference, paymentType, mode, confirm: true, revision: item.revision,
      requestId: makeRequestId(), ...(mode === 'partial' ? { amountCents } : {}),
    });
    const attempt = { payload, amountCents };
    recovery.set(payload.id, attempt);
    void submit(attempt);
  }

  function click(event) {
    const button = event.target.closest?.('button[data-payroll-action]');
    if (!button || button.disabled) return;
    switch (button.dataset.payrollAction) {
      case 'refresh': void renderPage(snapshot?.page || 1); break;
      case 'previous': if (!busy) void renderPage(snapshot.page - 1); break;
      case 'next': if (!busy) void renderPage(snapshot.page + 1); break;
      case 'back': leaveForm(); break;
      case 'edit': void openForm(snapshot?.items.find(row => String(row.id) === button.dataset.id)); break;
      case 'total':
      case 'partial': {
        mode = button.dataset.payrollAction;
        updateForm();
        if (mode === 'partial') form.querySelector('input[name="amount"]').focus();
        break;
      }
      case 'confirm': confirm(); break;
      case 'retry': {
        const attempt = recovery.get(button.dataset.id);
        if (attempt) void submit(attempt);
        break;
      }
    }
  }

  function change(event) {
    if (!form || !event.target.matches('select')) return;
    if (event.target.name === 'supplier') updateSupplier();
    mode = null;
    form.querySelector('input[name="amount"]').value = '';
    updateForm();
  }

  function back() {
    if (form?.querySelector('[role="combobox"][aria-expanded="true"]')) picker.close();
    else if (!leaveForm()) onClose();
  }

  function keydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      back();
    }
    if (event.key !== 'Tab') return;
    const controls = [...panel.querySelectorAll('button:enabled, input:enabled, select:enabled')]
      .filter(node => !node.closest('[hidden]') && node.tabIndex >= 0);
    if (!controls.length || (event.shiftKey ? [panel, controls[0]].includes(doc.activeElement) : doc.activeElement === controls.at(-1))) {
      event.preventDefault();
      (event.shiftKey ? controls.at(-1) : controls[0])?.focus();
    }
  }

  backdrop.addEventListener('click', click);
  backdrop.addEventListener('change', change);
  backdrop.addEventListener('input', event => { if (form && event.target.name === 'amount') updateForm(); });
  backdrop.addEventListener('keydown', keydown);

  return {
    open() { return renderPage(1); },
    back,
    destroy() {
      disposed = true;
      controller?.abort();
      picker?.destroy();
      backdrop.remove();
      if (!wasInert) shell.removeAttribute('inert');
      root.querySelector('[data-action="open-pending-payroll-links"]')?.focus({ preventScroll: true });
    },
  };
}
