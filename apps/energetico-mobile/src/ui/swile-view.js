const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = cents => money.format(cents / 100);
const dateLabel = value => String(value || '').split('-').reverse().join('/');
const statuses = {
  DRAFT: 'Rascunho',
  CREATED: 'Pedido criado',
  FINANCIALLY_INTEGRATED: 'Faturado',
  WAITING_PAYMENT: 'Aguardando pagamento',
  PAID: 'Pagamento confirmado',
  ON_QUEUE: 'Na fila para creditar',
  PROCESSING: 'Creditando colaboradores',
  APPROVED: 'Crédito concluído',
  APPROVED_PARTIALLY: 'Crédito parcial',
  CANCELED: 'Cancelado',
  PROCESSING_CANCEL: 'Cancelamento em andamento',
  SENT_TO_ACCOUNTING: 'Enviado ao financeiro',
  BILLED_FROM_ACCOUNTING: 'Faturado pelo financeiro',
  PROCESSED_ERROR: 'Falha no crédito',
  CREATION_ERROR: 'Falha na criação',
  UNCONFIRMED: 'Envio sem confirmação',
};

export function parseSwileAmount(value) {
  const input = String(value).trim();
  const match = /^(\d+)(?:[,.](\d{1,2}))?$/.exec(input);
  if (!match) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 999999999 ? cents : null;
}

export function openSwileView({ document: doc, request, onClose }) {
  const controller = new AbortController();
  const { signal } = controller;
  const focus = doc.activeElement;
  const make = (tag, text, className) => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text, action, primary = false) => {
    const node = make('button', text, primary ? 'swile-primary' : '');
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  };
  const field = (text, input) => {
    const label = make('label');
    label.append(make('span', text), input);
    return label;
  };
  const dialog = make('dialog', '', 'swile-dialog');
  dialog.setAttribute('aria-labelledby', 'swile-heading');
  const title = make('h2', 'Swile');
  title.id = 'swile-heading';
  const headline = make('div', '', 'swile-headline');
  headline.append(title, make('span', 'Multibenefícios'));
  const header = make('header', '', 'swile-header');
  header.append(headline, button('Fechar', close));
  const body = make('div', '', 'swile-body');
  const note = make('p', '', 'swile-note');
  note.setAttribute('role', 'status');
  note.hidden = true;
  const content = make('div');
  body.append(note, content);
  dialog.append(header, body);

  let people = [];
  let loaded = false;
  let busy = false;
  const amounts = new Map();
  const search = make('input');
  search.type = 'search';
  search.placeholder = 'Buscar por nome, grupo ou filial';
  search.setAttribute('aria-label', 'Buscar colaboradores');
  const rows = make('div', '', 'swile-rows');
  const total = make('strong');
  total.setAttribute('aria-live', 'polite');
  const credit = make('input');
  credit.type = 'date';
  credit.required = true;
  const due = make('input');
  due.type = 'date';
  const payment = make('select');
  for (const [value, label] of [['', 'Selecione'], ['PIX', 'Pix'], ['BANK_SLIP', 'Boleto']]) {
    const option = make('option', label);
    option.value = value;
    payment.append(option);
  }
  const dueField = field('Vencimento do boleto', due);
  dueField.hidden = true;
  payment.addEventListener('change', () => {
    dueField.hidden = payment.value !== 'BANK_SLIP';
    due.required = !dueField.hidden;
  });
  search.addEventListener('input', showPeople);

  function close() {
    if (signal.aborted) return;
    controller.abort();
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    dialog.remove();
    if (focus?.isConnected) focus.focus({ preventScroll: true });
    onClose?.();
  }

  function message(text = '', error = false) {
    note.textContent = text;
    note.hidden = !text;
    note.classList.toggle('swile-error', error);
  }

  async function run(work) {
    if (busy || signal.aborted) return;
    busy = true;
    dialog.setAttribute('aria-busy', 'true');
    const controls = [...content.querySelectorAll('button, input, select')].filter(control => !control.disabled);
    controls.forEach(control => { control.disabled = true; });
    message();
    try { await work(); }
    catch (error) { if (!signal.aborted) message(error.message || 'Não foi possível consultar a Swile.', true); }
    finally {
      busy = false;
      dialog.removeAttribute('aria-busy');
      controls.forEach(control => { control.disabled = false; });
      review.disabled = !loaded || !people.length;
    }
  }

  function updateTotal() {
    const values = [...amounts.values()].map(parseSwileAmount).filter(value => value !== null);
    total.textContent = `${values.length} ${values.length === 1 ? 'colaborador' : 'colaboradores'} · ${reais(values.reduce((sum, value) => sum + value, 0))}`;
  }

  function showPeople() {
    rows.replaceChildren();
    const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const query = normalize(search.value.trim());
    const visible = people.filter(row => normalize([row.name, row.group, row.branch].filter(Boolean).join(' ')).includes(query));
    if (!visible.length) rows.append(make('p', query ? 'Nenhum colaborador encontrado.' : 'Nenhum colaborador elegível para Multibenefícios.'));
    for (const row of visible) {
      const item = make('label', '', 'swile-person');
      const label = make('div');
      const details = [row.branch, row.group].filter(Boolean);
      if (row.hasActiveCard === true) details.push('Cartão físico ativo');
      if (row.hasActiveCard === false) details.push('Sem cartão físico ativo');
      if (row.registrationPending) details.push('Cadastro em análise');
      label.append(make('strong', row.name), make('small', details.join(' · ')));
      const input = make('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.placeholder = '0,00';
      input.setAttribute('aria-label', `Valor em reais para ${row.name}`);
      input.value = amounts.get(row.id) || '';
      input.addEventListener('input', () => {
        if (input.value.trim()) amounts.set(row.id, input.value);
        else amounts.delete(row.id);
        input.removeAttribute('aria-invalid');
        updateTotal();
      });
      item.append(label, input);
      rows.append(item);
    }
    updateTotal();
  }

  const tools = make('div', '', 'swile-actions');
  tools.append(button('Atualizar colaboradores', load), button('Pedidos enviados', () => showOrders()));
  const dates = make('div', '', 'swile-dates');
  dates.append(field('Data de crédito', credit), field('Forma de pagamento', payment), dueField);
  const footer = make('div', '', 'swile-actions swile-footer');
  const review = button('Conferir pedido', prepare, true);
  footer.append(total, review);

  function showForm() {
    message();
    if (!loaded) {
      content.replaceChildren(tools);
      return;
    }
    content.replaceChildren(tools, search, rows, dates, footer);
    showPeople();
    review.disabled = !people.length;
  }

  function load() {
    return run(async () => {
      if (!loaded) message('Consultando colaboradores na Swile…');
      const result = await request('directory', {}, { signal });
      if (signal.aborted) return;
      if (!Array.isArray(result)) throw new Error('Lista de colaboradores inválida.');
      people = result;
      loaded = true;
      const ids = new Set(people.map(row => row.id));
      for (const id of amounts.keys()) if (!ids.has(id)) amounts.delete(id);
      showForm();
    });
  }

  function prepare() {
    return run(async () => {
      const items = [...amounts].map(([employeeId, value]) => ({ employeeId, amountCents: parseSwileAmount(value) }));
      const invalid = items.find(item => item.amountCents === null);
      if (invalid) throw new Error(`Confira o valor informado para ${people.find(row => row.id === invalid.employeeId)?.name || 'o colaborador'}.`);
      if (!items.length) throw new Error('Informe o valor de pelo menos um colaborador.');
      if (!credit.value || !payment.value || due.required && !due.value) {
        throw new Error('Informe a data de crédito, a forma de pagamento e o vencimento quando usar boleto.');
      }
      const result = await request('preview', { items, creditDate: credit.value, paymentMethod: payment.value,
        ...(due.required ? { dueDate: due.value } : {}) }, { signal });
      if (signal.aborted) return;
      if (result.receipt) showReceipt(result.receipt);
      else showPreview(result);
    });
  }

  function showPreview(preview) {
    const details = make('div', '', 'swile-summary');
    details.append(make('h3', 'Conferir pedido'),
      make('p', `${preview.totalEmployees} ${preview.totalEmployees === 1 ? 'colaborador' : 'colaboradores'} · crédito em ${dateLabel(preview.creditDate)}`),
      make('p', preview.paymentMethod === 'PIX' ? 'Pagamento por Pix' : `Boleto com vencimento em ${dateLabel(preview.dueDate)}`));
    if (preview.payer) details.append(make('p', `Faturamento para ${preview.payer}`));
    const list = make('ul', '', 'swile-preview-list');
    for (const item of preview.items) {
      const row = make('li');
      row.append(make('span', item.name), make('strong', reais(item.amountCents)));
      list.append(row);
    }
    details.append(list, make('p', `Total em créditos · ${reais(preview.creditCents)}`),
      make('strong', `Total a pagar · ${reais(preview.paymentCents)}`));
    const actions = make('div', '', 'swile-actions');
    actions.append(button('Editar valores', showForm), button('Enviar pedido à Swile', () => run(async () => {
      const result = await request('confirm', { id: preview.id });
      if (!signal.aborted) showReceipt(result);
    }), true));
    content.replaceChildren(details, actions);
  }

  function receiptDetails(order) {
    const block = make('section', '', 'swile-summary');
    block.append(make('strong', statuses[order.status] || order.status),
      make('p', `${order.orderCode || order.reference} · ${dateLabel(order.creditDate)} · ${reais(order.creditCents)} em créditos`));
    if (order.status === 'UNCONFIRMED') {
      block.append(make('p', 'Confira o pedido na Dash RH antes de reenviar. Use a referência acima para localizar o envio.'));
    }
    if (order.statusStale) block.append(make('p', 'Último status registrado. A Swile está indisponível para atualização.'));
    return block;
  }

  function showReceipt(order) {
    amounts.clear();
    const actions = make('div', '', 'swile-actions');
    actions.append(button('Voltar para recargas', showForm), button('Consultar pedidos', () => showOrders(order.reference)));
    content.replaceChildren(receiptDetails(order), actions);
  }

  function showOrders(reference) {
    return run(async () => {
      const result = await request('orders', reference ? { reference } : {}, { signal });
      if (signal.aborted) return;
      if (!Array.isArray(result)) throw new Error('Lista de pedidos inválida.');
      const list = make('div', '', 'swile-order-list');
      for (const order of result) {
        const block = receiptDetails(order);
        if (order.orderCode) block.append(button('Atualizar status', () => showOrders(order.reference)));
        list.append(block);
      }
      if (!result.length) list.append(make('p', 'Nenhum pedido enviado por você nesta integração.'));
      content.replaceChildren(button('Voltar para recargas', showForm), make('h3', 'Pedidos enviados'), list);
    });
  }

  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  doc.body.append(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  showForm();
  void load();
  return { close };
}
