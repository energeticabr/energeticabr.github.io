import Decimal from 'decimal.js';
import { createLoadingIndicator } from './loading-indicator.js';
import { beginLoadingTask } from './loading-task.js';
import { launchGalleryIcon } from './launch-gallery-icons.js';
import { key } from './provision-payment-format.js';

/** Read-only modal owned by the payment gallery; no editor or mutation actions. */
export function createProvisionDescriptionDetail({ document: doc, host, background, loadGroup,
  field, format, lineTotal, timeoutMs = 30_000, resolveTrigger = (_id, trigger) => trigger }) {
  let current = null, destroyed = false;
  const el = (tag, className = '', label) => {
    const node = doc.createElement(tag); node.className = className;
    if (label !== undefined) node.textContent = label;
    return node;
  };
  const focusable = () => [...(current?.dialog.querySelectorAll('button:not([disabled])') || [])];
  const active = state => current === state && !destroyed && !host.hidden && host.isConnected;
  function statusBadge(status) {
    const value = key(status);
    const tone = /^(PAGO|PAGA|QUITADO|PAGAMENTOEFETUADO)$/.test(value) ? 'paid'
      : value.includes('SUSPENS') ? 'suspended' : value.includes('CANCEL') ? 'cancelled'
        : value === 'PENDENTE' ? 'pending' : /PREVIST|AGENDAD/.test(value) ? 'planned' : 'neutral';
    return el('span', `pg-description-status pg-description-status--${tone}`, status);
  }
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
    const trigger = resolveTrigger(state.id, state.trigger) || state.trigger;
    trigger.setAttribute('aria-expanded', 'false');
    if (!host.hidden) (trigger.isConnected ? trigger : host).focus({ preventScroll: true });
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
    const entries = [];
    const toggle = selected => {
      const expand = entries[selected].button.getAttribute('aria-expanded') !== 'true';
      entries.forEach(({ card, button, panel }, index) => {
        const open = expand && index === selected;
        button.setAttribute('aria-expanded', String(open)); panel.hidden = !open;
        card.classList.toggle('is-expanded', open);
      });
    };
    result.provisions.forEach((row, index) => {
      if (!/^[1-9]\d{0,14}$/.test(String(row?.id)) || !row.fields) throw new Error('Provisão inválida.');
      const card = el('article', 'pg-description-line'); card.dataset.provisionId = row.id;
      const supplier = format('FORNECEDOR', field(row.fields, ['FORNECEDOR']));
      const product = format('Descrição', field(row.fields, ['DESCRICAOPGTO', 'DESCRIÇÃO PGTO', 'PRODUTO']));
      const dateValue = field(row.fields, ['DATA PREVISTO PGTO', 'DATAPGTOPREVISTO']);
      const date = format('Data prevista pgto', dateValue);
      const amount = typeof totals[index] === 'number' && Number.isFinite(totals[index]) ? format('VALOR TOTAL', totals[index]) : 'Não informado';
      const status = format('Status', field(row.fields, ['STATUS']));
      const heading = el('h3', 'pg-description-line-heading');
      const button = el('button', 'pg-description-line-toggle'); button.type = 'button'; button.dataset.action = 'toggle-provision-detail';
      const panel = el('div', 'pg-description-line-panel'); panel.dataset.provisionPanel = '';
      panel.id = `pg-description-${id}-${row.id}-${index}-panel`; button.id = `${panel.id}-toggle`;
      button.setAttribute('aria-controls', panel.id); button.setAttribute('aria-expanded', String(index === 0));
      button.setAttribute('aria-label', `Provisão #${row.id}: ${supplier}. ${product}. Data pgto: ${date}. Total: ${amount}. ${status}.`);
      panel.setAttribute('role', 'region'); panel.setAttribute('aria-labelledby', button.id); panel.hidden = index !== 0;
      card.classList.toggle('is-expanded', index === 0);
      const names = String(supplier).match(/[\p{L}\p{N}]+/gu) || [];
      const initials = names.length > 1 ? `${names[0][0]}${names.at(-1)[0]}` : (names[0] || '?').slice(0, 2);
      const avatar = el('span', 'pg-description-line-avatar', initials.toLocaleUpperCase('pt-BR')); avatar.setAttribute('aria-hidden', 'true');
      const identity = el('span', 'pg-description-line-identity');
      const name = el('strong', 'pg-description-line-supplier', supplier); name.title = supplier;
      const description = el('span', 'pg-description-line-product', product); description.title = `Descrição: ${product}`;
      identity.append(name, description);
      const finance = el('span', 'pg-description-line-finance');
      const compactDate = el('span', 'pg-description-line-date'); compactDate.title = date;
      compactDate.append(launchGalleryIcon(doc, 'calendar'), el('span', '', String(date).replace(/^(\d{2}\/\d{2})\/\d{4}$/, '$1')));
      finance.append(compactDate, el('strong', 'pg-description-line-amount', amount));
      const compactStatus = statusBadge(status); compactStatus.classList.add('pg-description-line-compact-status');
      const badge = el('span', 'pg-description-line-id', `#${row.id}`);
      const arrow = el('span', 'pg-description-line-chevron'); arrow.setAttribute('aria-hidden', 'true');
      button.append(avatar, identity, finance, compactStatus, badge, arrow); heading.append(button);
      const add = (fields, label, value, { wide = false, money = false, icon, badge = false } = {}) => {
        const pair = el('div', `pg-description-line-field${wide ? ' pg-description-line-field--wide' : ''}`);
        const term = el('dt'), definition = el('dd');
        if (icon) term.append(launchGalleryIcon(doc, icon));
        term.append(el('span', '', label));
        const display = money ? format('VALOR TOTAL', value) : format(label, value);
        if (badge) definition.append(statusBadge(display)); else definition.textContent = display;
        pair.append(term, definition); fields.append(pair);
      };
      const primary = el('dl', 'pg-description-line-fields pg-description-line-fields--primary');
      add(primary, 'Data pgto', dateValue, { icon: 'calendar' });
      add(primary, 'Valor total', amount, { icon: 'money' });
      add(primary, 'Status', field(row.fields, ['STATUS']), { badge: true });
      primary.children[1].classList.add('pg-description-line-field--total');
      primary.children[2].classList.add('pg-description-line-field--status');
      const quantities = el('dl', 'pg-description-line-fields pg-description-line-fields--quantities');
      add(quantities, 'Qtd.', field(row.fields, ['QTD', 'QUANTIDADE']), { icon: 'quantity' });
      add(quantities, 'Valor unitário', field(row.fields, ['VALOR TOTAL', 'VALORTOTAL']), { money: true, icon: 'money' });
      add(quantities, 'Frete', field(row.fields, ['FRETE']) || 0, { money: true, icon: 'freight' });
      const location = el('dl', 'pg-description-line-fields pg-description-line-fields--location');
      add(location, 'Filial', field(row.fields, ['FILIAL']), { icon: 'branch' });
      add(location, 'Imóvel', field(row.fields, ['IMOVEL', 'IMÓVEL']), { icon: 'property' });
      const extra = el('dl', 'pg-description-line-fields pg-description-line-fields--location');
      for (const [label, aliases] of [['IDFOLHA', ['IDFOLHA']], ['Data pgto efetuado', ['DATA PGTO EFETUADO', 'DATAPGTOEFETUADO']]]) {
        const value = field(row.fields, aliases);
        if (value != null && String(value).trim()) add(extra, label, value);
      }
      panel.append(primary, quantities, location); if (extra.children.length) panel.append(extra);
      const observation = field(row.fields, ['OBS', 'OBSERVACAO', 'OBSERVAÇÃO']);
      if (observation != null && String(observation).trim()) {
        const notes = el('dl', 'pg-description-line-fields pg-description-line-fields--notes');
        add(notes, 'Obs', observation, { wide: true, icon: 'order' }); panel.append(notes);
      }
      entries.push({ card, button, panel });
      button.addEventListener('click', () => toggle(index));
      card.append(heading, panel); listing.append(card);
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
    const loader = createLoadingIndicator(doc, 'Carregando provisões vinculadas…'); state.body.replaceChildren(loader);
    const task = beginLoadingTask(loader, { signal: controller.signal,
      isCurrent: () => active(state) && state.version === version });
    task.prepared();
    state.timer = setTimeout(() => {
      if (!active(state) || state.version !== version) return;
      cancelLoad(state); failure(state, 'A consulta demorou mais que o esperado. Verifique a conexão e tente novamente.');
    }, Math.max(1, Number(timeoutMs) || 30_000));
    try {
      if (typeof loadGroup !== 'function') throw new Error('Consulta indisponível.');
      const result = await loadGroup(state.id, { signal: controller.signal, onProgress: task.report });
      if (!active(state) || state.version !== version) return;
      const content = groupContent(result, state.id); task.acquired();
      state.body.replaceChildren(content); state.dialog.setAttribute('aria-busy', 'false'); task.complete();
    } catch (error) {
      task.stop();
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
