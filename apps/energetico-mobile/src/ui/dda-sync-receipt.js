/** Only confirmed creation IDs identify new records; a snapshot difference is not proof. */
export function createDdaSyncReceipt({ document: doc, host, format, onClose = () => {} }) {
  let current = null;
  const el = (tag, cls, text) => {
    const node = doc.createElement(tag); node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };
  function keepFocus(event) {
    if (current && !current.dialog.contains(event.target)) current.button.focus({ preventScroll: true });
  }
  function close() {
    const previous = current; current = null;
    if (!previous) return;
    doc.removeEventListener('focusin', keepFocus, true);
    previous.overlay.remove();
    for (const [node, inert] of previous.background) node.inert = inert;
    onClose();
    if (previous.trigger?.isConnected && !host.hidden) previous.trigger.focus({ preventScroll: true });
  }
  function show(result, rows, trigger) {
    if (!Number.isSafeInteger(result?.created) || result.created <= 0 || host.hidden || !host.isConnected) return;
    close();
    const ids = result.createdItemIds;
    const validIds = Array.isArray(ids) && ids.length === result.created && ids.length <= 10000
      && ids.every(id => Number.isSafeInteger(id) && id > 0 && id <= 2147483647) && new Set(ids).size === ids.length;
    const overlay = el('div', 'gallery-record-overlay dda-sync-overlay');
    const dialog = el('section', 'gallery-record-dialog dda-sync-dialog');
    dialog.dataset.ddaNewItems = '';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Novos DDAs adicionados');
    dialog.append(el('h2', 'gallery-record-dialog-title', 'Novos DDAs adicionados'));
    dialog.append(el('p', 'dda-sync-summary', `${result.created} ${result.created === 1 ? 'boleto criado' : 'boletos criados'} nesta sincronização.`));
    const list = el('ul', 'dda-sync-items');
    const byId = new Map(rows.map(row => [String(row.id), row]));
    if (validIds) for (const id of ids) {
      const row = byId.get(String(id));
      const item = el('li', 'dda-sync-item');
      item.append(el('span', 'rg-dda-id', `ID ${id}`));
      item.append(el('strong', 'dda-sync-supplier', row ? format(row, 'Title') : 'DDA adicionado'));
      if (row) {
        const details = el('dl', 'dda-sync-fields');
        for (const [field, label] of [['VENCIMENTO', 'Vencimento'], ['VALOR', 'Valor nominal'], ['DOCUMENTO', 'Documento']]) {
          const pair = el('div', ''); pair.append(el('dt', '', label), el('dd', '', format(row, field))); details.append(pair);
        }
        item.append(details);
      } else item.append(el('p', '', 'Criação confirmada. Os detalhes deste item não estão disponíveis nesta leitura da galeria.'));
      list.append(item);
    }
    else list.append(el('li', 'dda-sync-item', 'A sincronização confirmou a criação, mas não informou os IDs dos novos itens.'));
    dialog.append(list);
    const button = el('button', 'gallery-record-dialog-button', 'Entendi'); button.type = 'button';
    button.addEventListener('click', close);
    const actions = el('div', 'gallery-record-dialog-buttons'); actions.append(button); dialog.append(actions);
    const background = [...host.children].map(node => [node, node.inert === true]);
    for (const [node] of background) node.inert = true;
    overlay.append(dialog); host.append(overlay); current = { overlay, dialog, button, trigger, background };
    overlay.addEventListener('click', event => { event.stopPropagation(); if (event.target === overlay) close(); });
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); button.focus(); }
    });
    doc.addEventListener('focusin', keepFocus, true); button.focus({ preventScroll: true });
  }
  return { show, close, destroy: close };
}
