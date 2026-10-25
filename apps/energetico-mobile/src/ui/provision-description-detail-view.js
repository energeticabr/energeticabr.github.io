import Decimal from 'decimal.js';
import { createLoadingIndicator } from './loading-indicator.js';

/** Read-only modal owned by the payment gallery; no editor or mutation actions. */
export function createProvisionDescriptionDetail({ document: doc, host, background, loadGroup,
  field, format, lineTotal, timeoutMs = 30_000 }) {
  let current = null, destroyed = false;
  const el = (tag, className = '', label) => {
    const node = doc.createElement(tag); node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const focusable = () => [...(current?.dialog.querySelectorAll('button:not([disabled])') || [])];
  const active = state => current === state && !destroyed && !host.hidden && host.isConnected;
  function keepFocus(event) {
    if (current && !current.dialog.contains(event.target)) focusable()[0]?.focus({ preventScroll: true });
  }
  function cancelLoad(state) {
    clearTimeout(state.timer); state.timer = null; state.version++;
    state.controller?.abort(); state.controller = null;
  }
  function close() {
    const state = current; current = null;
    if (!state) return;
    cancelLoad(state); doc.removeEventListener('focusin', keepFocus, true); state.overlay.remove();
    for (const [node, inert, ariaHidden] of state.background) {
      node.inert = inert;
      if (ariaHidden == null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', ariaHidden);
    }
    state.trigger.setAttribute('aria-expanded', 'false');
    if (state.trigger.isConnected && !host.hidden) state.trigger.focus({ preventScroll: true });
  }
  function groupContent(result, id) {
    if (String(result?.description?.id) !== id || !Array.isArray(result.provisions)) throw new Error('Grupo inválido.');
    const content = el('div', 'pg-description-content'), parent = result.description.fields || {};
    content.append(el('p', 'pg-description-owner', format('FORNECEDOR', field(parent, ['FORNECEDOR']))));
    const notes = field(parent, ['OBS', 'OBSERVACAO', 'OBSERVAÇÃO']);
    if (notes) content.append(el('p', 'pg-description-notes', format('OBS', notes)));
    const count = result.provisions.length, totals = result.provisions.map(row => lineTotal(row.fields));
    const valid = totals.every(value => typeof value === 'number' && Number.isFinite(value));
    const amount = valid ? totals.reduce((sum, value) => sum.plus(value), new Decimal(0)).toNumber() : null;
    const summary = el('div', 'pg-description-summary');
    summary.append(el('strong', '', `${count} ${count === 1 ? 'provisão vinculada' : 'provisões vinculadas'}`));
    const total = el('p', 'pg-description-total', `Total das provisões: ${valid ? format('VALOR TOTAL', amount) : 'Não informado'}`);
    total.dataset.descriptionTotal = ''; summary.append(total); content.append(summary);
    if (!count) content.append(el('p', 'pg-description-empty', 'Nenhuma provisão vinculada a este descritivo.'));
    const listing = el('div', 'pg-description-lines'); listing.setAttribute('aria-label', 'Provisões vinculadas');
    result.provisions.forEach((row, index) => {
      if (!/^[1-9]\d{0,14}$/.test(String(row?.id)) || !row.fields) throw new Error('Provisão inválida.');
      const card = el('article', 'pg-description-line'); card.dataset.provisionId = row.id;
      card.append(el('h3', '', `Provisão #${row.id}`), el('strong', 'pg-description-line-supplier', format('FORNECEDOR', field(row.fields, ['FORNECEDOR']))));
      const fields = el('dl', 'pg-description-line-fields');
      const add = (label, value, { wide = false, money = false } = {}) => {
        const pair = el('div', `pg-description-line-field${wide ? ' pg-description-line-field--wide' : ''}`);
        pair.append(el('dt', '', label), el('dd', '', money ? format('VALOR TOTAL', value) : format(label, value))); fields.append(pair);
      };
      add('Descrição', field(row.fields, ['DESCRICAOPGTO', 'DESCRIÇÃO PGTO', 'PRODUTO']), { wide: true });
      add('Quantidade', field(row.fields, ['QTD', 'QUANTIDADE']));
      add('Valor unitário', field(row.fields, ['VALOR TOTAL', 'VALORTOTAL']), { money: true });
      add('Frete', field(row.fields, ['FRETE']) || 0, { money: true });
      add('Total da provisão', typeof totals[index] === 'number' ? format('VALOR TOTAL', totals[index]) : 'Não informado');
      add('Data prevista pgto', field(row.fields, ['DATA PREVISTO PGTO', 'DATAPGTOPREVISTO']));
      add('Status', field(row.fields, ['STATUS']));
      for (const [label, aliases] of [['Filial', ['FILIAL']], ['Imóvel', ['IMOVEL', 'IMÓVEL']], ['IDFOLHA', ['IDFOLHA']],
        ['Data pgto efetuado', ['DATA PGTO EFETUADO', 'DATAPGTOEFETUADO']], ['OBS', ['OBS', 'OBSERVACAO', 'OBSERVAÇÃO']]]) {
        const value = field(row.fields, aliases);
        if (value != null && String(value).trim()) add(label, value, { wide: label === 'OBS' });
      }
      card.append(fields); listing.append(card);
    });
    content.append(listing); return content;
  }
  function failure(state, message) {
    state.dialog.setAttribute('aria-busy', 'false');
    const error = el('p', 'gallery-record-dialog-error', message); error.setAttribute('role', 'alert');
    const retry = el('button', 'gallery-record-dialog-button', 'Tentar novamente');
    retry.type = 'button'; retry.dataset.action = 'retry-description';
    retry.addEventListener('click', () => { void load(state); });
    state.body.replaceChildren(error, retry); state.closeButton.focus({ preventScroll: true });
  }
  async function load(state) {
    if (!active(state)) return;
    cancelLoad(state);
    const version = state.version, controller = state.controller = new AbortController();
    state.dialog.setAttribute('aria-busy', 'true');
    state.body.replaceChildren(createLoadingIndicator(doc, 'Carregando provisões vinculadas…'));
    state.timer = setTimeout(() => {
      if (!active(state) || state.version !== version) return;
      cancelLoad(state); failure(state, 'A consulta demorou mais que o esperado. Verifique a conexão e tente novamente.');
    }, Math.max(1, Number(timeoutMs) || 30_000));
    try {
      if (typeof loadGroup !== 'function') throw new Error('Consulta indisponível.');
      const result = await loadGroup(state.id, { signal: controller.signal });
      if (!active(state) || state.version !== version) return;
      state.body.replaceChildren(groupContent(result, state.id)); state.dialog.setAttribute('aria-busy', 'false');
    } catch (error) {
      if (!active(state) || state.version !== version) return;
      failure(state, error?.code === 'provision_description_not_found'
        ? 'O descritivo da provisão não está mais disponível. Feche e atualize a galeria.'
        : 'Não foi possível carregar as provisões vinculadas. Verifique a conexão e tente novamente.');
    } finally {
      if (active(state) && state.version === version) { clearTimeout(state.timer); state.timer = null; state.controller = null; }
    }
  }
  function open(id, trigger) {
    if (destroyed || host.hidden || !host.isConnected || trigger.disabled || !/^[1-9]\d{0,14}$/.test(id)) return;
    if (current?.id === id) { current.closeButton.focus({ preventScroll: true }); return; }
    close();
    const overlay = el('div', 'gallery-record-overlay pg-description-detail-overlay');
    const dialog = el('section', 'gallery-record-dialog pg-description-detail');
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', `Descritivo da provisão #${id}`); dialog.dataset.provisionDescriptionDetail = id; dialog.tabIndex = -1;
    const heading = el('header', 'pg-description-detail-heading');
    const closeButton = el('button', 'gallery-record-dialog-button', 'Fechar');
    closeButton.type = 'button'; closeButton.dataset.action = 'close-description'; closeButton.addEventListener('click', close);
    heading.append(el('h2', '', `Descritivo da provisão #${id}`), closeButton);
    const body = el('div', 'pg-description-detail-body'); dialog.append(heading, body); overlay.append(dialog); host.append(overlay);
    const state = current = { id, trigger, overlay, dialog, body, closeButton, version: 0, controller: null, timer: null,
      background: background.map(node => [node, Boolean(node.inert), node.getAttribute('aria-hidden')]) };
    for (const node of background) { node.inert = true; node.setAttribute('aria-hidden', 'true'); }
    trigger.setAttribute('aria-expanded', 'true');
    overlay.addEventListener('click', event => { event.stopPropagation(); if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
      if (!['Escape', 'Tab'].includes(event.key)) return;
      event.stopPropagation();
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      const buttons = focusable(), first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && (doc.activeElement === first || !dialog.contains(doc.activeElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (doc.activeElement === last || !dialog.contains(doc.activeElement))) { event.preventDefault(); first?.focus(); }
    });
    doc.addEventListener('focusin', keepFocus, true); closeButton.focus({ preventScroll: true }); void load(state);
  }
  return Object.freeze({ open, close, destroy() { close(); destroyed = true; } });
}
