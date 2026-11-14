import { parseBenefitAmount } from './hr-benefit-amount.js';
import { provisionDescriptionIcon } from './provision-description-card.js';
import { createHrBenefitGalleryHeader } from './hr-benefit-gallery-header.js';

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const reais = cents => Number.isSafeInteger(cents) ? money.format(cents / 100) : 'Não informado';
const paymentLabel = method => ({ BOLETO: 'Boleto', PIX: 'Pix' })[method] || 'Não informada';
const normalize = text => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

function formatDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/.exec(String(value ?? ''));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

function cardLabel(card) {
  return card.cardLast4 ? `Cartão final ${card.cardLast4}` : '';
}

export function openTrancidRechargeView({ document: doc, request, gallery = false, onClose, onHome }) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const opener = doc.activeElement;
  const app = doc.getElementById('app');
  let restoreApp = false;
  let isGallery = gallery;
  let galleryHeader;
  let busy = false;
  let confirming = false;
  let cards = [];
  const selected = new Set();
  const individualAmounts = new Map();

  function make(tag, text, className) {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function button(text, action, primary = false) {
    const node = make('button', text, primary ? 'swile-primary' : '');
    node.type = 'button';
    node.addEventListener('click', action);
    return node;
  }

  function field(text, input) {
    const label = make('label');
    label.append(make('span', text), input);
    return label;
  }

  const header = make('header', '', 'swile-header');
  const headline = make('div', '', 'swile-headline');
  const headerActions = make('div', '', 'swile-header-actions');
  const body = make('div', '', 'swile-body');
  const note = make('p', '', 'swile-note');
  note.setAttribute('role', 'status');
  note.hidden = true;
  const content = make('div');
  const refresh = button('', loadCards);
  refresh.className = 'swile-refresh';
  refresh.title = 'Atualizar cartões';
  refresh.setAttribute('aria-label', refresh.title);
  refresh.append(provisionDescriptionIcon(doc, 'refresh'));
  const closeButton = button('Fechar', close);
  headerActions.append(refresh, closeButton);
  header.append(headline, headerActions);
  body.append(note, content);
  let screen;

  function onGalleryKey(event) {
    if (event.key === 'Escape' && !event.defaultPrevented) {
      event.preventDefault();
      close();
    }
  }

  function removeScreen() {
    galleryHeader?.dispose();
    galleryHeader = null;
    if (screen?.open && typeof screen.close === 'function') screen.close();
    screen?.remove();
  }

  function close() {
    if (!confirming) dispose();
  }

  function dispose() {
    if (signal.aborted) return;
    lifetime.abort();
    doc.removeEventListener('keydown', onGalleryKey);
    removeScreen();
    if (restoreApp) app.removeAttribute('inert');
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    onClose?.();
  }

  function mount() {
    removeScreen();
    screen = isGallery
      ? make('main', '', 'swile-gallery-page trancid-gallery-page')
      : make('dialog', '', 'swile-dialog trancid-recharge-dialog');
    const title = make(isGallery ? 'h1' : 'h2', isGallery ? 'Galeria Trancid' : 'Trancid');
    title.id = 'trancid-recharge-heading';
    title.tabIndex = -1;
    screen.setAttribute('aria-labelledby', title.id);
    refresh.hidden = isGallery;
    if (isGallery) {
      galleryHeader = createHrBenefitGalleryHeader({
        root: screen, title, onBack: close,
        onHome: onHome && (() => { dispose(); onHome(); }),
        onRefresh: () => loadGallery(1, false, true),
      });
    } else {
      headline.replaceChildren(title, make('span', 'Vale-transporte'));
    }
    screen.append(galleryHeader?.header || header, body);
    doc.body.append(screen);
    if (isGallery) {
      restoreApp = Boolean(app && !app.hasAttribute('inert'));
      if (restoreApp) app.setAttribute('inert', '');
      doc.addEventListener('keydown', onGalleryKey);
      title.focus({ preventScroll: true });
    } else {
      screen.setAttribute('aria-modal', 'true');
      screen.addEventListener('cancel', event => { event.preventDefault(); close(); });
      if (typeof screen.showModal === 'function') screen.showModal();
      else screen.setAttribute('open', '');
    }
  }

  function message(text = '', error = false) {
    note.textContent = text;
    note.hidden = !text;
    note.classList.toggle('swile-error', error);
  }

  async function run(work) {
    if (busy || signal.aborted) return;
    busy = true;
    screen.setAttribute('aria-busy', 'true');
    const controls = [...content.querySelectorAll('button, input')].filter(control => !control.disabled);
    if (!refresh.hidden) controls.push(refresh);
    controls.forEach(control => { control.disabled = true; });
    message();
    try {
      await work();
    } catch (error) {
      if (!signal.aborted) message(error.message || 'Não foi possível consultar a Trancid.', true);
    } finally {
      busy = false;
      screen.removeAttribute('aria-busy');
      controls.forEach(control => { control.disabled = false; });
    }
  }

  const search = make('input', '', 'swile-search');
  search.type = 'search';
  search.placeholder = 'Buscar por nome ou final do cartão';
  search.setAttribute('aria-label', 'Buscar cartões');
  search.addEventListener('input', showCards);
  const rows = make('div', '', 'swile-rows');
  const selection = make('input');
  selection.type = 'checkbox';
  selection.addEventListener('change', () => {
    selected.clear();
    if (selection.checked) for (const card of cards) selected.add(card.id);
    showCards();
  });
  const selectAll = field('Selecionar todos os cartões', selection);
  selectAll.className = 'trancid-select-all';
  const amount = make('input');
  amount.type = 'text';
  amount.inputMode = 'decimal';
  amount.autocomplete = 'off';
  amount.placeholder = '0,00';
  amount.value = '55,00';
  amount.setAttribute('aria-label', 'Valor da recarga por cartão');
  amount.addEventListener('input', () => {
    individualAmounts.clear();
    showCards();
  });
  const fields = make('div', '', 'swile-dates');
  const payment = make('div', '', 'trancid-payment');
  payment.append(make('span', 'Forma de pagamento'), make('strong', 'Boleto'));
  fields.append(field('Valor da recarga por cartão', amount), payment);
  const footer = make('div', '', 'swile-actions swile-footer');
  const total = make('strong');
  total.setAttribute('aria-live', 'polite');
  footer.append(total, button('Conferir pedido', prepare, true));

  function selectedItems() {
    return cards.filter(card => selected.has(card.id)).map(card => ({
      id: card.id,
      amountCents: parseBenefitAmount(individualAmounts.get(card.id) ?? amount.value),
    }));
  }

  function updateTotal() {
    selection.checked = cards.length > 0 && selected.size === cards.length;
    selection.indeterminate = selected.size > 0 && !selection.checked;
    const credits = selectedItems().reduce((sum, item) => sum + (item.amountCents ?? 0), 0);
    total.textContent = `${selected.size} ${selected.size === 1 ? 'cartão' : 'cartões'} · ${reais(credits)}`;
  }

  function showCards() {
    rows.replaceChildren();
    const query = normalize(search.value.trim());
    const visible = cards.filter(card => normalize(`${card.name} ${card.cardLast4 ?? ''}`).includes(query));
    if (!visible.length) rows.append(make('p', query ? 'Nenhum cartão encontrado.' : 'Nenhum cartão disponível para recarga.'));
    for (const card of visible) {
      const row = make('div', '', 'swile-person trancid-card');
      const label = make('label', '', 'trancid-card-selection');
      const cardDescription = make('span');
      cardDescription.append(make('strong', card.name), make('small', cardLabel(card)));
      const checkbox = make('input');
      checkbox.type = 'checkbox';
      checkbox.checked = selected.has(card.id);
      checkbox.setAttribute('aria-label', `Selecionar ${card.name}${card.cardLast4 ? `, cartão final ${card.cardLast4}` : ''}`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(card.id);
        else selected.delete(card.id);
        updateTotal();
      });
      label.append(cardDescription, checkbox);
      const individual = make('input', '', 'trancid-card-amount');
      individual.type = 'text';
      individual.inputMode = 'decimal';
      individual.autocomplete = 'off';
      individual.placeholder = '0,00';
      individual.setAttribute('aria-label', `Valor para ${card.name}${card.cardLast4 ? `, cartão final ${card.cardLast4}` : ''}`);
      individual.value = individualAmounts.get(card.id) ?? amount.value;
      individual.addEventListener('input', () => {
        individualAmounts.set(card.id, individual.value);
        updateTotal();
      });
      row.append(label, individual);
      rows.append(row);
    }
    updateTotal();
  }

  function showForm() {
    message();
    refresh.hidden = false;
    content.replaceChildren(search, ...(cards.length ? [selectAll] : []), rows, ...(cards.length ? [fields, footer] : []));
    showCards();
  }

  function loadCards() {
    return run(async () => {
      message('Consultando cartões na Trancid…');
      const result = await request('directory', {}, { signal });
      if (signal.aborted) return;
      if (!Array.isArray(result)) throw new Error('A Trancid retornou uma lista de cartões inválida.');
      cards = result;
      const available = new Set(cards.map(card => card.id));
      for (const id of selected) if (!available.has(id)) selected.delete(id);
      for (const id of individualAmounts.keys()) if (!available.has(id)) individualAmounts.delete(id);
      showForm();
    });
  }

  function prepare() {
    return run(async () => {
      if (!selected.size) throw new Error('Selecione os cartões que receberão a recarga.');
      const items = selectedItems();
      const invalid = items.find(item => item.amountCents === null);
      if (invalid) {
        const card = cards.find(card => card.id === invalid.id);
        throw new Error(`Informe um valor maior que zero, com até duas casas decimais, para ${card.name}.`);
      }
      const credits = items.reduce((sum, item) => sum + item.amountCents, 0);
      const preview = await request('preview', { items, paymentMethod: 'BOLETO' }, { signal });
      if (signal.aborted) return;
      const matchingItems = Array.isArray(preview?.items) && preview.items.length === items.length
        && items.every(({ id, amountCents }) => preview.items.some(item => item.id === id && item.amountCents === amountCents));
      if (!preview?.id || !matchingItems || preview.creditCents !== credits || preview.paymentMethod !== 'BOLETO') {
        throw new Error('A Trancid retornou uma prévia de recarga inválida.');
      }
      showPreview(preview);
    });
  }

  function showPreview(preview) {
    refresh.hidden = true;
    const details = make('section', '', 'swile-summary');
    const heading = make('h3', 'Conferir pedido');
    heading.tabIndex = -1;
    details.append(heading, make('p', `Pagamento por ${paymentLabel(preview.paymentMethod)}`));
    const list = make('ul', '', 'swile-preview-list');
    for (const card of preview.items) {
      const row = make('li');
      row.append(make('span', [card.name, cardLabel(card)].filter(Boolean).join(' · ')), make('strong', reais(card.amountCents)));
      list.append(row);
    }
    details.append(list, make('p', `Total em créditos · ${reais(preview.creditCents)}`),
      make('p', `Taxa estimada · ${reais(preview.feeCents)}`), make('strong', `Total estimado · ${reais(preview.totalCents)}`));
    const actions = make('div', '', 'swile-actions');
    actions.append(button('Editar valores', showForm), button('Enviar pedido à Trancid', () => confirm(preview), true));
    content.replaceChildren(details, actions);
    heading.focus({ preventScroll: true });
  }

  function confirm(preview) {
    return run(async () => {
      confirming = true;
      closeButton.disabled = true;
      message('Enviando pedido à Trancid…');
      let receipt;
      try {
        receipt = await request('confirm', { id: preview.id });
      } catch (error) {
        if (error.code !== 'TRANCID_CONFIRMATION_UNCERTAIN') throw error;
      } finally {
        confirming = false;
        closeButton.disabled = false;
      }
      if (signal.aborted) return;
      message();
      showReceipt(receipt);
    });
  }

  function showReceipt(order) {
    const details = make('section', '', 'swile-summary');
    const submitted = order?.status === 'SUBMITTED' && order.orderCode;
    const heading = make('h3', submitted ? 'Pedido enviado' : 'Envio sem confirmação');
    heading.tabIndex = -1;
    details.append(heading);
    if (submitted) {
      details.append(make('p', `Pedido ${order.orderCode} · ${paymentLabel(order.paymentMethod)}`),
        make('p', `Créditos · ${reais(order.creditCents)}`));
      if (Number.isSafeInteger(order.totalCents)) details.append(make('p', `Total · ${reais(order.totalCents)}`));
    } else {
      details.append(make('p', order?.orderCode
        ? `Confira o pedido ${order.orderCode} na Galeria Trancid antes de iniciar outra recarga.`
        : 'Confira a Galeria Trancid antes de iniciar outra recarga.'));
    }
    const actions = make('div', '', 'swile-actions');
    actions.append(button('Consultar Galeria Trancid', () => {
      isGallery = true;
      mount();
      content.replaceChildren();
      void loadGallery();
    }, true));
    content.replaceChildren(details, actions);
    heading.focus({ preventScroll: true });
  }

  function loadGallery(page = 1, focusPage = false, refresh = false) {
    return run(async () => {
      message('Consultando pedidos na Trancid…');
      try {
        const result = await request('history', refresh ? { page, refresh } : { page }, { signal });
        if (signal.aborted) return;
        if (!Array.isArray(result?.orders) || !Number.isSafeInteger(result.page) || result.page < 1) {
          throw new Error('A Trancid retornou uma página de pedidos inválida.');
        }
        message(result.stale ? 'Atualização indisponível. Exibindo a última consulta à Trancid.' : undefined);
        showGallery(result, focusPage);
      } catch (error) {
        if (!signal.aborted && !content.childElementCount) showGallery({ page });
        throw error;
      }
    });
  }

  function showGallery({ orders, page, hasMore, checkedAt }, focusPage = false) {
    const list = make('div', '', 'swile-order-list');
    for (const order of orders ?? []) {
      const item = make('article', '', 'swile-summary swile-gallery-order');
      item.append(make('strong', `Pedido ${order.orderCode}`), make('strong', reais(order.creditCents)),
        make('span', order.paymentStatus || order.status), make('span', order.requestDate ? `Pedido em ${formatDate(order.requestDate)}` : ''),
        make('span', paymentLabel(order.paymentMethod)));
      if (Number.isSafeInteger(order.totalCents)) item.append(make('span', `Total · ${reais(order.totalCents)}`));
      list.append(item);
    }
    if (orders?.length === 0) list.append(make('p', 'Nenhum pedido encontrado.'));
    const navigation = make('nav', '', 'swile-actions');
    navigation.setAttribute('aria-label', 'Páginas de pedidos');
    const pageLabel = make('span', `Página ${page}`);
    pageLabel.setAttribute('role', 'status');
    if (page > 1) navigation.append(button('Página anterior', () => loadGallery(page - 1, true)));
    if (page > 1 || hasMore) navigation.append(pageLabel);
    if (hasMore) navigation.append(button('Próxima página', () => loadGallery(page + 1, true)));
    const checked = new Date(checkedAt);
    const timestamp = Number.isFinite(checked.getTime()) ? [make('p',
      `Situação informada pela Trancid em ${new Intl.DateTimeFormat('pt-BR', {
        dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
      }).format(checked)}`)] : [];
    content.replaceChildren(...timestamp, list, navigation);
    body.scrollTop = 0;
    if (focusPage) {
      pageLabel.tabIndex = -1;
      (pageLabel.isConnected ? pageLabel : galleryHeader.header.querySelector('h1')).focus({ preventScroll: true });
    }
  }

  mount();
  if (isGallery) void loadGallery();
  else void loadCards();
  return { close: dispose };
}
