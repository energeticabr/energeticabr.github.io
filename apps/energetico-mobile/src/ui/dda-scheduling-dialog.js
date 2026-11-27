import { ddaTodayKey } from './dda-card.js';

const messages = {
  none: 'Nenhuma ordem foi localizada. Volte à galeria para consultar o boleto novamente.',
  not_sent: 'A ordem não foi enviada. Volte à galeria e confira o boleto novamente.',
  approval: 'O Sicoob recebeu a ordem e aguarda assinatura. Consulte novamente após a assinatura.',
  pending: 'O Sicoob ainda não confirmou o resultado. Consulte a situação desta ordem para acompanhar.',
  rejected: 'O Sicoob recusou a ordem. Consulte o boleto novamente antes de fazer outro agendamento.',
  scheduled: 'Agendamento confirmado pelo Sicoob.',
  effective: 'Pagamento confirmado pelo Sicoob.',
};
const formatAmount = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const formatDay = day => day.split('-').reverse().join('/');

export function createDdaSchedulingDialog({ document: doc, host, request, onResult }) {
  let current = null;
  const make = (tag, className, text) => {
    const element = doc.createElement(tag);
    element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const button = (label, marker) => {
    const element = make('button', 'gallery-record-dialog-button', label);
    element.type = 'button';
    if (marker) element.setAttribute(marker, '');
    return element;
  };

  function close(force = false) {
    if (!current || (current.busy && !force)) return;
    const entry = current;
    current = null;
    entry.abort.abort();
    clearTimeout(entry.timeout);
    entry.overlay.remove();
    for (const [node, inert] of entry.background) node.inert = inert;
    if (!host.hidden && host.isConnected) {
      const target = entry.trigger.isConnected ? entry.trigger
        : host.querySelector('[data-dda-schedule="' + entry.itemId + '"]');
      (target || host).focus({ preventScroll: true });
    }
  }

  function show({ itemId, key, existing }, trigger) {
    if (current || host.hidden || !host.isConnected) return;
    const overlay = make('div', 'gallery-record-overlay dda-payment-overlay');
    const dialog = make('section', 'gallery-record-dialog dda-payment-dialog dda-schedule-dialog');
    dialog.dataset.ddaScheduleDialog = '';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Agendar pagamento de boleto');
    dialog.tabIndex = -1;
    const title = make('h2', '', 'Agendar pagamento');
    const label = make('label', 'dda-schedule-date', 'Data do pagamento');
    const input = make('input', '');
    input.type = 'date';
    input.required = true;
    input.min = new Date(Date.parse(ddaTodayKey() + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);
    label.append(input);
    const summary = make('p', 'dda-payment-summary');
    summary.hidden = true;
    const feedback = make('p', 'dda-payment-feedback');
    feedback.setAttribute('role', 'status');
    const actions = make('div', 'gallery-record-dialog-buttons');
    const cancel = button('Voltar');
    cancel.addEventListener('click', () => close());
    const next = button('Conferir boleto', 'data-dda-schedule-next');
    const confirm = button('Confirmar agendamento', 'data-dda-schedule-confirm');
    confirm.classList.add('dda-payment-yes');
    const change = button('Alterar data');
    const check = button('Consultar situação');
    actions.append(cancel, next);
    dialog.append(title, label, summary, feedback, actions);
    overlay.append(dialog);
    const background = [...host.children].map(node => [node, node.inert === true]);
    for (const [node] of background) node.inert = true;
    host.append(overlay);
    const entry = current = { itemId, overlay, trigger, background, abort: new AbortController(), timeout: null, busy: false };
    let quoteId = null;

    function clearReview() {
      quoteId = null;
      feedback.textContent = '';
      feedback.setAttribute('role', 'status');
      summary.hidden = true;
      label.hidden = false;
      input.disabled = false;
      actions.replaceChildren(cancel, next);
      input.focus();
    }

    function showResult(result) {
      if (result.itemId !== itemId || result.key !== key || !messages[result.status]) {
        throw new Error('O Sicoob não confirmou a situação deste boleto.');
      }
      label.hidden = true;
      feedback.setAttribute('role', 'status');
      feedback.textContent = messages[result.status];
      title.textContent = result.status === 'scheduled' ? 'Pagamento agendado' : 'Situação do agendamento';
      const canCheck = ['pending', 'approval'].includes(result.status);
      actions.replaceChildren(cancel, ...(canCheck ? [check] : []));
      onResult(result);
    }

    async function run(action, payload, message, apply) {
      if (entry.busy || current !== entry) return;
      entry.busy = true;
      const locked = [input, cancel, next, change, confirm, check].filter(control => !control.disabled);
      for (const control of locked) control.disabled = true;
      feedback.setAttribute('role', 'status');
      feedback.textContent = message;
      const requestController = new AbortController();
      const stop = () => requestController.abort();
      entry.abort.signal.addEventListener('abort', stop, { once: true });
      try {
        const deadline = new Promise((_, reject) => {
          entry.timeout = setTimeout(() => { stop(); reject(new Error('Tempo de consulta excedido.')); }, 45_000);
        });
        const result = await Promise.race([request(action, payload, { signal: requestController.signal }), deadline]);
        if (current === entry && !host.hidden) apply(result);
      } catch (error) {
        if (current === entry && !host.hidden) {
          feedback.setAttribute('role', 'alert');
          const uncertain = action === 'confirm' && (!error?.status || error.status >= 500);
          feedback.textContent = uncertain
            ? 'A confirmação ficou pendente. Use Consultar situação para acompanhar a ordem.'
            : (error?.message || 'Não foi possível consultar o boleto. Tente novamente.');
          if (uncertain) {
            label.hidden = true;
            actions.replaceChildren(cancel, check);
            onResult({ itemId, key, date: input.value, status: 'pending' });
          }
        }
      } finally {
        clearTimeout(entry.timeout);
        entry.abort.signal.removeEventListener('abort', stop);
        entry.busy = false;
        for (const control of locked) control.disabled = false;
        if (current === entry && !dialog.contains(doc.activeElement)) {
          (dialog.querySelector('button:not(:disabled)') || dialog).focus();
        }
      }
    }

    next.addEventListener('click', () => {
      if (!input.reportValidity()) return;
      const day = input.value;
      void run('quote', { itemId, key, date: day }, 'Consultando boleto no Sicoob…', result => {
        if (result.status !== 'quoted' || result.date !== day || !Number.isSafeInteger(result.amountCents)
          || result.amountCents <= 0 || typeof result.beneficiary !== 'string' || !result.beneficiary.trim()) {
          throw new Error('O Sicoob retornou uma conferência incompleta.');
        }
        label.hidden = true;
        summary.textContent = result.beneficiary + '\n' + formatAmount.format(result.amountCents / 100) + ' · ' + formatDay(day);
        summary.hidden = false;
        quoteId = result.canConfirm && /^[a-f0-9]{32}$/.test(result.quoteId || '') ? result.quoteId : null;
        feedback.textContent = quoteId ? '' : 'O Sicoob ainda precisa liberar a inclusão de pagamentos para esta conta.';
        actions.replaceChildren(cancel, change, ...(quoteId ? [confirm] : []));
      });
    });
    confirm.addEventListener('click', () => {
      if (quoteId) void run('confirm', { quoteId }, 'Enviando agendamento ao Sicoob…', showResult);
    });
    check.addEventListener('click', () => {
      void run('status', { itemId, key }, 'Consultando situação no Sicoob…', showResult);
    });
    change.addEventListener('click', clearReview);
    overlay.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        event.stopPropagation();
        const controls = [...dialog.querySelectorAll('button:not(:disabled), label:not([hidden]) input:not(:disabled)')];
        const index = controls.indexOf(doc.activeElement);
        (controls[(index < 0 ? (event.shiftKey ? controls.length - 1 : 0)
          : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length)] || dialog).focus();
      }
    });
    if (existing) {
      showResult(existing);
      check.focus();
    } else input.focus();
  }

  return { get isOpen() { return current !== null; }, show, dismiss: close, close: () => close(true) };
}
