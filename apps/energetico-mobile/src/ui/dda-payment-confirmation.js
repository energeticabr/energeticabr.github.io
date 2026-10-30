import { validateDdaPaymentReceipt } from '../chat/dda-payment-confirmation.js';

/** Acknowledges an existing payment; never sends a payment instruction to a bank. */
export function createDdaPaymentConfirmation({ document: doc, host, confirmPayment, onConfirmed, onStartLaunch, onLaunchStarted = () => {}, onClose = () => {}, timeoutMs = 35_000, launchTimeoutMs = 120_000 }) {
  let current = null;
  const el = (tag, cls, text) => { const n = doc.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n; };
  function focusables() { return current ? [...current.dialog.querySelectorAll('button:not(:disabled)')] : []; }
  function keepFocus(event) { if (current && !current.dialog.contains(event.target)) (focusables()[0] || current.dialog).focus(); }
  function close(force = false) {
    if (!current || (current.busy && !force)) return;
    const old = current; current = null; old.controller?.abort(); clearTimeout(old.timer);
    doc.removeEventListener('focusin', keepFocus, true); old.overlay.remove();
    for (const [node, inert] of old.background) node.inert = inert;
    if (old.trigger?.isConnected && !host.hidden) old.trigger.focus({ preventScroll: true });
    else if (host.isConnected && !host.hidden) host.focus({ preventScroll: true });
    onClose();
  }
  function show({ itemId, key, supplier, amount, due }, trigger) {
    if (current || host.hidden || !host.isConnected) return;
    const overlay = el('div', 'gallery-record-overlay dda-payment-overlay');
    const dialog = el('section', 'gallery-record-dialog dda-payment-dialog'); dialog.dataset.ddaPaymentDialog = '';
    dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); dialog.setAttribute('aria-label', 'Confirmar pagamento DDA'); dialog.tabIndex = -1;
    const title = el('h2', '', 'Confirma o pagamento deste DDA?');
    const header = el('header', 'gallery-editor-header');
    const back = el('button', 'gallery-editor-back', '←');
    back.type = 'button'; back.setAttribute('data-gallery-editor-back', '');
    back.setAttribute('aria-label', 'Voltar à galeria sem salvar');
    back.addEventListener('click', () => close());
    header.append(back, title);
    const summary = el('p', 'dda-payment-summary', supplier + ' · ID ' + itemId + '\n' + amount + ' · Vencimento ' + due);
    const note = el('p', '', 'Confirme somente se o boleto já foi pago. Esta ação registra a sua confirmação e retira o valor das pendências; não realiza um pagamento no banco.');
    const status = el('p', 'dda-payment-feedback'); status.setAttribute('role', 'status');
    const buttons = el('div', 'gallery-record-dialog-buttons');
    const cancel = el('button', 'gallery-record-dialog-button', 'Cancelar'); cancel.type = 'button'; cancel.dataset.ddaPaymentCancel = '';
    const yes = el('button', 'gallery-record-dialog-button dda-payment-yes', 'Sim, confirmar pagamento'); yes.type = 'button'; yes.dataset.ddaPaymentYes = '';
    cancel.addEventListener('click', () => close());
    const background = [...host.children].map(node => [node, node.inert === true]);
    for (const [node] of background) node.inert = true;
    const entry = { overlay, dialog, trigger, background, busy: false, confirmed: false, controller: null, timer: null };
    current = entry;
    yes.addEventListener('click', async () => {
      if (entry.busy || current !== entry) return;
      entry.busy = true; yes.disabled = true; cancel.disabled = back.disabled = true;
      status.setAttribute('role', 'status');
      status.textContent = entry.confirmed ? 'Preparando os anexos e iniciando o lançamento…' : 'Registrando confirmação…';
      entry.controller = new AbortController();
      try {
        if (entry.confirmed) {
          const expiry = new Promise((_, reject) => { entry.timer = setTimeout(() => { entry.controller.abort(); reject(new Error('Tempo de preparação excedido.')); }, launchTimeoutMs); });
          const started = await Promise.race([
            onStartLaunch({ itemId: Number(itemId), key, signal: entry.controller.signal }), expiry,
          ]);
          if (current !== entry || host.hidden || !host.isConnected) return;
          if (!started) throw new Error('O lançamento não foi iniciado.');
          close(true);
          onLaunchStarted();
          return;
        }
        if (typeof confirmPayment !== 'function') throw new Error('Confirmação indisponível.');
        const expiry = new Promise((_, reject) => { entry.timer = setTimeout(() => { entry.controller.abort(); reject(new Error('Tempo de confirmação excedido.')); }, timeoutMs); });
        const result = validateDdaPaymentReceipt(await Promise.race([
          confirmPayment({ itemId: Number(itemId), key, signal: entry.controller.signal }), expiry,
        ]), { itemId, key });
        if (current !== entry || host.hidden || !host.isConnected) return;
        entry.confirmed = true;
        onConfirmed(result);
        title.textContent = 'Pagamento confirmado';
        note.textContent = 'Registrado como pago por confirmação do usuário. Este DDA não compõe mais os valores pendentes.';
        status.textContent = ''; dialog.dataset.state = 'success';
        if (typeof onStartLaunch === 'function') {
          dialog.dataset.ddaLaunchOffer = '';
          note.textContent += '\nDeseja iniciar um lançamento usando os anexos deste DDA?';
          delete yes.dataset.ddaPaymentYes; yes.dataset.ddaLaunchYes = '';
          yes.textContent = 'Sim, iniciar lançamento';
          cancel.textContent = 'Não, voltar à galeria';
          back.setAttribute('aria-label', 'Voltar à galeria');
        } else { yes.remove(); cancel.textContent = 'Entendi'; }
      } catch {
        if (current === entry && !host.hidden) {
          status.textContent = entry.confirmed
            ? 'O pagamento já está confirmado. Não foi possível iniciar o lançamento com os anexos. Tente novamente; a confirmação do pagamento não será repetida.'
            : 'Não foi possível confirmar a gravação. Tente novamente para verificar e concluir, sem duplicar a confirmação.';
          status.setAttribute('role', 'alert'); dialog.dataset.state = 'failed';
        }
      } finally {
        clearTimeout(entry.timer); entry.busy = false; yes.disabled = false; cancel.disabled = back.disabled = false;
        if (current === entry) cancel.focus();
      }
    });
    buttons.append(cancel, yes); dialog.append(header, summary, note, status, buttons); overlay.append(dialog); host.append(overlay);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        event.preventDefault(); event.stopPropagation(); const items = focusables();
        if (!items.length) dialog.focus();
        else { const index = items.indexOf(doc.activeElement); items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length].focus(); }
      }
    });
    doc.addEventListener('focusin', keepFocus, true); cancel.focus();
  }
  return { get isOpen() { return current !== null; }, show, close: () => close(true), destroy: () => close(true) };
}
