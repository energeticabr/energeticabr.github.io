import { registrationNumber, registrationDateKey } from '../chat/registration-gallery-data.js';
import { createLoadingIndicator } from './loading-indicator.js';
import { beginLoadingTask } from './loading-task.js';

function text(value) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(', ');
  if (typeof value === 'object') return text(value.LookupValue ?? value.Value ?? value.value ?? value.DisplayName ?? value.displayName ?? value.Title ?? value.title);
  return String(value);
}
function format(value, type) {
  if (value == null || text(value).trim() === '') return '—';
  if (type === 'boolean') return value === true || value === 1 ? 'Sim' : value === false || value === 0 ? 'Não' : text(value);
  if (['number', 'currency', 'percent', 'percentWhole'].includes(type)) {
    const number = registrationNumber(value); if (number == null) return text(value);
    if (type === 'percentWhole') return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 4 }).format(number)}%`;
    return new Intl.NumberFormat('pt-BR', type === 'currency' ? { style: 'currency', currency: 'BRL' }
      : type === 'percent' ? { style: 'percent', maximumFractionDigits: 4 } : { maximumFractionDigits: 6 }).format(number);
  }
  if (type === 'date') { const date = registrationDateKey(value); return date ? date.split('-').reverse().join('/') : text(value); }
  if (type === 'datetime') {
    const date = new Date(value); return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(date) : text(value);
  }
  return text(value);
}

export function createAssetReportView({ document: doc, host, background = [], loadReport, timeoutMs = 30_000,
  resolveTrigger = (_id, trigger) => trigger } = {}) {
  let current = null, destroyed = false;
  const el = (tag, className = '', label) => { const node = doc.createElement(tag); node.className = className; if (label !== undefined) node.textContent = label; return node; };
  const active = state => current === state && !destroyed && !host.hidden && host.isConnected;
  const controls = state => [...state.dialog.querySelectorAll('button:not([disabled])')];
  const focusInside = event => { if (current && !current.dialog.contains(event.target)) current.closeButton.focus({ preventScroll: true }); };
  function cancel(state) { clearTimeout(state.timer); state.timer = null; state.version++; state.controller?.abort(); state.controller = null; state.task?.stop(); }
  function close() {
    const state = current; current = null; if (!state) return;
    cancel(state); doc.removeEventListener('focusin', focusInside, true); state.overlay.remove();
    for (const [node, inert, hidden] of state.background) { node.inert = inert; if (hidden == null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', hidden); }
    state.trigger?.setAttribute('aria-expanded', 'false');
    const trigger = resolveTrigger(state.id, state.trigger) || state.trigger; trigger?.setAttribute('aria-expanded', 'false');
    if (!host.hidden) { host.scrollTop = state.scrollTop; (trigger?.isConnected ? trigger : host).focus({ preventScroll: true }); }
  }
  function content(result, id) {
    if (String(result?.assetId) !== id || String(result?.asset?.id) !== id || !Array.isArray(result.asset.details) || !Array.isArray(result.history)) throw new Error('Resposta de outro imobilizado.');
    const body = el('article', 'asset-report-content');
    body.append(el('h3', 'asset-report-name', text(result.asset.fields?.IMOBILIZADO) || `Imobilizado #${id}`));
    const registration = el('section', 'asset-report-registration'); registration.dataset.assetRegistration = '';
    registration.append(el('h3', '', 'Dados cadastrais'));
    const details = el('dl', 'asset-report-fields');
    for (const field of result.asset.details) {
      const pair = el('div', 'asset-report-field'); pair.dataset.assetField = field.name;
      pair.append(el('dt', '', field.label), el('dd', '', format(field.value, field.type))); details.append(pair);
    }
    registration.append(details); body.append(registration);
    const history = el('section', 'asset-report-history'); history.append(el('h3', '', 'Histórico de depreciação'));
    history.append(el('p', 'asset-report-summary', `${result.history.length} ${result.history.length === 1 ? 'depreciação' : 'depreciações'} • Total do histórico: ${format(result.historyTotal, 'currency')}`));
    if (!result.history.length) { const empty = el('p', 'asset-report-empty', 'Nenhuma depreciação registrada para este imobilizado.'); empty.dataset.assetReportEmpty = ''; history.append(empty); }
    const lines = el('div', 'asset-report-history-lines');
    for (const row of result.history) {
      if (String(registrationNumber(row?.fields?.['ID IMOBILIZADO'])) !== id) throw new Error('Histórico de outro imobilizado.');
      const card = el('article', 'asset-report-history-line'); card.dataset.assetHistoryRow = row.id;
      const heading = el('header', 'asset-report-history-heading');
      heading.append(el('h4', '', format(row.fields['DATA DE DEPRECIAÇÃO'], 'date')), el('span', 'asset-report-line-id', `Registro #${row.id}`)); card.append(heading);
      const values = el('dl', 'asset-report-fields');
      for (const [label, type] of [['FILIAL', 'text'], ['% DEPRECIAÇÃO', 'percent'], ['VALOR DEPRECIAÇÃO', 'currency'], ['VALOR RESIDUAL', 'currency'], ['ID LANÇAMENTO', 'text'], ['NÚMERO DO PEDIDO', 'text']]) {
        const pair = el('div', 'asset-report-field'), dd = el('dd', '', format(row.fields[label], type));
        if (label === 'ID LANÇAMENTO') dd.dataset.historyFinancialId = '';
        if (label === 'NÚMERO DO PEDIDO') dd.dataset.historyOrderId = '';
        if (label === 'FILIAL') pair.classList.add('asset-report-field--wide');
        pair.append(el('dt', '', label), dd); values.append(pair);
      }
      card.append(values); lines.append(card);
    }
    history.append(lines); body.append(history); return body;
  }
  function failure(state, message) {
    state.dialog.setAttribute('aria-busy', 'false');
    const error = el('p', 'asset-report-error', message); error.setAttribute('role', 'alert');
    const retry = el('button', 'rg-button', 'Tentar novamente'); retry.type = 'button'; retry.dataset.action = 'retry-asset-report';
    retry.addEventListener('click', () => { void load(state); }); state.body.replaceChildren(error, retry);
    state.closeButton.focus({ preventScroll: true });
  }
  async function load(state) {
    if (!active(state)) return;
    cancel(state); const version = state.version, controller = state.controller = new AbortController();
    const loader = createLoadingIndicator(doc, 'Carregando cadastro e depreciações…'); state.body.replaceChildren(loader); state.dialog.setAttribute('aria-busy', 'true');
    const task = state.task = beginLoadingTask(loader, { signal: controller.signal, isCurrent: () => active(state) && state.version === version }); task.prepared();
    state.timer = setTimeout(() => {
      if (!active(state) || state.version !== version) return;
      cancel(state); failure(state, 'A consulta demorou mais que o esperado. Verifique a conexão e tente novamente.');
    }, Math.max(1, Number(timeoutMs) || 30_000));
    try {
      if (typeof loadReport !== 'function') throw new Error('Consulta indisponível.');
      const result = await loadReport(state.id, { signal: controller.signal, onProgress: task.report });
      if (!active(state) || state.version !== version) return;
      const report = content(result, state.id); task.acquired(); state.body.replaceChildren(report); state.dialog.setAttribute('aria-busy', 'false'); task.complete();
    } catch {
      task.stop(); if (!active(state) || state.version !== version) return;
      controller.abort(); failure(state, 'Não foi possível carregar o cadastro e todo o histórico deste imobilizado. Verifique a conexão e tente novamente.');
    } finally { if (active(state) && state.version === version) { clearTimeout(state.timer); state.timer = null; state.controller = null; } }
  }
  function open(rawId, trigger) {
    const id = String(rawId ?? '');
    if (destroyed || host.hidden || !host.isConnected || !/^[1-9]\d{0,14}$/.test(id)) return;
    if (current?.id === id) { current.closeButton.focus({ preventScroll: true }); return; }
    close();
    const overlay = el('div', 'asset-report-overlay'), dialog = el('section', 'asset-report-dialog');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', `Relatório do imobilizado #${id}`); dialog.dataset.assetReport = id; dialog.tabIndex = -1;
    const heading = el('header', 'asset-report-heading'), title = el('h2', '', `Relatório do imobilizado #${id}`);
    const closeButton = el('button', 'rg-button', 'Fechar'); closeButton.type = 'button'; closeButton.dataset.action = 'close-asset-report'; closeButton.addEventListener('click', close);
    heading.append(title, closeButton); const body = el('div', 'asset-report-body'); dialog.append(heading, body); overlay.append(dialog);
    const state = current = { id, trigger, overlay, dialog, body, closeButton, version: 0, scrollTop: host.scrollTop, background: background.map(node => [node, Boolean(node.inert), node.getAttribute('aria-hidden')]) };
    host.append(overlay);
    for (const node of background) { node.inert = true; node.setAttribute('aria-hidden', 'true'); }
    trigger?.setAttribute('aria-expanded', 'true');
    overlay.addEventListener('click', event => { event.stopPropagation(); if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
      if (!['Escape', 'Tab'].includes(event.key)) return; event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      const buttons = controls(state), first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) { event.preventDefault(); first?.focus(); }
    });
    doc.addEventListener('focusin', focusInside, true); closeButton.focus({ preventScroll: true }); void load(state);
  }
  return Object.freeze({ open, close, destroy() { close(); destroyed = true; } });
}
