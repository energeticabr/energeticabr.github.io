import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { openSwileView, parseSwileAmount } from '../src/ui/swile-view.js';
import { createChatClient } from '../src/chat/chat-client.js';

test('Swile accepts positive BRL amounts with at most two decimal places', () => {
  for (const [input, expected] of [['225,05', 22505], ['0.1', 10], [' 25 ', 2500],
    ['', null], ['0,00', null], ['1,234', null], ['1e2', null], ['-1', null]]) {
    assert.equal(parseSwileAmount(input), expected, input);
  }
});

test('Swile keeps amounts across search and submits only after review', async () => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const { document } = window;
  const calls = [];
  let directoryLoads = 0;
  const view = openSwileView({ document, now: () => new Date('2026-11-16T14:00:00Z'), request: async (operation, body) => {
    calls.push([operation, body]);
    if (operation === 'directory') {
      directoryLoads++;
      return [
        { id: 1, name: 'Pessoa A', hasActiveCard: true },
        ...(directoryLoads !== 2 ? [{ id: 2, name: 'Pessoa B', hasActiveCard: false }] : []),
        { id: 3, name: 'BERNARDO NOTINI MOREIRA BAHIA' },
        { id: 4, name: ' Rafael da Silva' },
        ...(directoryLoads > 1 ? [{ id: 5, name: 'Pessoa C' }] : []),
      ];
    }
    if (operation === 'preview') return {
      id: 'preview', items: [{ name: 'Pessoa A', amountCents: 1234 }, { name: 'Pessoa C', amountCents: 22500 }],
      totalEmployees: 2, creditCents: 23734, paymentCents: 23800,
      paymentMethod: 'PIX', creditDate: body.creditDate,
    };
    if (operation === 'confirm') return {
      reference: 'preview', orderCode: 'SWO123', status: 'WAITING_PAYMENT',
      creditCents: 23734, creditDate: '2026-12-02',
    };
    throw new Error(operation);
  } });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const click = text => [...document.querySelectorAll('button')].find(button => button.textContent === text).click();
  const input = (element, value) => {
    element.value = value;
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  const amount = name => document.querySelector(`[aria-label="Valor em reais para ${name}"]`);
  try {
    await settle();
    assert.match(document.body.textContent, /Multibenefícios.*Cartão físico ativo/s);
    assert.equal(amount('Pessoa A').value, '225,00');
    assert.equal(amount('Pessoa B').value, '225,00');
    assert.equal(amount('BERNARDO NOTINI MOREIRA BAHIA').value, '');
    assert.equal(amount(' Rafael da Silva').value, '');
    assert.match(document.querySelector('.swile-footer [aria-live=polite]').textContent, /2 colaboradores · R\$\s*450,00/);
    assert.equal([...document.querySelectorAll('button')].some(button => button.textContent === 'Pedidos enviados'), false);
    const sync = document.querySelector('header button[aria-label="Atualizar colaboradores"]');
    assert.ok(sync.querySelector('svg'));
    assert.equal(sync.nextElementSibling.textContent, 'Fechar');
    input(amount('Pessoa A'), '12,34');
    input(amount('Pessoa B'), '');
    input(document.querySelector('[type=search]'), 'Pessoa B');
    assert.equal(amount('Pessoa A'), null);
    sync.click();
    await settle();
    assert.equal(amount('Pessoa B'), null);
    sync.click();
    await settle();
    assert.equal(amount('Pessoa B').value, '');
    input(document.querySelector('[type=search]'), '');
    assert.equal(amount('Pessoa A').value, '12,34');
    assert.equal(amount('Pessoa C').value, '225,00');
    document.querySelector('.swile-credit-trigger').click();
    document.querySelector('[aria-label="Próximo mês"]').click();
    document.querySelector('[data-date="2026-12-02"]').click();
    document.querySelector('select').value = 'PIX';
    click('Conferir pedido');
    await settle();
    assert.deepEqual(calls, [
      ['directory', {}],
      ['directory', {}],
      ['directory', {}],
      ['preview', { items: [{ employeeId: 1, amountCents: 1234 }, { employeeId: 5, amountCents: 22500 }], creditDate: '2026-12-02', paymentMethod: 'PIX' }],
    ]);
    assert.match(document.body.textContent, /Total a pagar.*238,00/);
    const description = document.querySelector('label:has(textarea)');
    assert.match(description.textContent, /Descrição na nota fiscal/);
    const note = description.querySelector('textarea');
    assert.equal(note.value, 'CNO :90.025.44060/72 RUA ANTÔNIO TORRES DOS SANTOS NÚMERO 134');
    assert.equal(note.maxLength, 255);
    input(note, 'CNO da obra revisado');
    click('Editar valores');
    click('Conferir pedido');
    await settle();
    assert.equal(document.querySelector('textarea').value, 'CNO da obra revisado');
    assert.equal(calls.some(([operation]) => operation === 'confirm'), false);
    click('Enviar pedido à Swile');
    await settle();
    assert.deepEqual(calls.at(-1), ['confirm', { id: 'preview', invoiceText: 'CNO da obra revisado' }]);
    assert.match(document.body.textContent, /Aguardando pagamento.*SWO123/s);
    click('Voltar para recargas');
    assert.equal(amount('Pessoa B').value, '225,00');
    assert.equal(amount('BERNARDO NOTINI MOREIRA BAHIA').value, '');
  } finally {
    view.close();
    window.close();
  }
});

test('Swile schedules the nearest eligible Friday and recalculates the latest boleto due date', async t => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const { document } = window;
  const calls = [];
  const view = openSwileView({
    document, now: () => new Date('2026-11-16T14:00:00Z'),
    request: async (operation, body) => {
      calls.push([operation, body]);
      if (operation === 'directory') return [{ id: 1, name: 'Pessoa A' }];
      return { ...body, items: [], totalEmployees: 1, creditCents: 22500, paymentCents: 22500 };
    },
  });
  t.after(() => { view.close(); window.close(); });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  const credit = document.querySelector('.swile-credit-trigger');
  const due = document.querySelector('output');
  const payment = document.querySelector('select');
  const setPayment = value => {
    payment.value = value;
    payment.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const click = text => [...document.querySelectorAll('button')].find(button => button.textContent === text).click();

  assert.equal(credit.textContent, '20/11/2026');
  setPayment('BANK_SLIP');
  assert.equal(due.textContent, '19/11/2026');
  credit.click();
  document.querySelector('[aria-label="Próximo mês"]').click();
  document.querySelector('[data-date="2026-12-01"]').click();
  assert.equal(due.textContent, '30/11/2026');
  setPayment('PIX');
  assert.equal(credit.textContent, '01/12/2026');
  assert.equal(due.closest('label').hidden, true);
  assert.equal(due.textContent, '');
  assert.match(document.querySelector('.swile-pix-deadline').textContent, /prazo.+Swile/i);
  setPayment('BANK_SLIP');
  assert.equal(due.textContent, '30/11/2026');
  credit.click();
  document.querySelector('[aria-label="Mês anterior"]').click();
  document.querySelector('[data-date="2026-11-20"]').click();
  click('Conferir pedido');
  await settle();
  assert.deepEqual(calls.at(-1), ['preview', {
    items: [{ employeeId: 1, amountCents: 22500 }],
    creditDate: '2026-11-20', paymentMethod: 'BANK_SLIP', dueDate: '2026-11-19',
  }]);
  assert.match(document.body.textContent, /Boleto com vencimento em 19\/11\/2026/);
});

test('Swile advances the automatic Friday when boleto needs more time, preserving an eligible manual date', async t => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const { document } = window;
  const view = openSwileView({
    document, now: () => new Date('2026-11-12T14:00:00Z'),
    request: async () => [{ id: 1, name: 'Pessoa A' }],
  });
  t.after(() => { view.close(); window.close(); });
  await new Promise(resolve => setImmediate(resolve));
  const credit = document.querySelector('.swile-credit-trigger');
  const due = document.querySelector('output');
  const payment = document.querySelector('select');
  const setPayment = value => {
    payment.value = value;
    payment.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  assert.equal(credit.textContent, '13/11/2026');
  setPayment('BANK_SLIP');
  assert.equal(credit.textContent, '20/11/2026');
  assert.equal(due.textContent, '19/11/2026');
  setPayment('PIX');
  assert.equal(credit.textContent, '13/11/2026');
  credit.click();
  document.querySelector('[data-date="2026-11-17"]').click();
  setPayment('BANK_SLIP');
  assert.equal(credit.textContent, '17/11/2026');
  assert.equal(due.textContent, '16/11/2026');
});

test('Swile refreshes an automatic date when the UTC cutoff changes before review', async t => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const { document } = window;
  let instant = new Date('2026-11-11T23:58:00Z');
  let preview;
  const view = openSwileView({
    document, now: () => instant,
    request: async (operation, body) => {
      if (operation === 'directory') return [{ id: 1, name: 'Pessoa A' }];
      preview = body;
      return { ...body, items: [], totalEmployees: 1, creditCents: 22500, paymentCents: 22500 };
    },
  });
  t.after(() => { view.close(); window.close(); });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  const payment = document.querySelector('select');
  payment.value = 'BANK_SLIP';
  payment.dispatchEvent(new window.Event('change'));
  assert.equal(document.querySelector('.swile-credit-trigger').textContent, '13/11/2026');
  instant = new Date('2026-11-12T00:01:00Z');
  [...document.querySelectorAll('button')].find(button => button.textContent === 'Conferir pedido').click();
  await settle();
  assert.equal(preview?.creditDate, '2026-11-20');
  assert.equal(preview?.dueDate, '2026-11-19');
});

test('Swile disables unavailable dates in the calendar before they can be selected', async t => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const { document } = window;
  const view = openSwileView({
    document, now: () => new Date('2026-11-16T14:00:00Z'),
    request: async () => [{ id: 1, name: 'Pessoa A' }],
  });
  t.after(() => { view.close(); window.close(); });
  await new Promise(resolve => setImmediate(resolve));
  const credit = document.querySelector('button[aria-label^="Data de crédito"]');
  const day = value => document.querySelector(`button[data-date="${value}"]`);
  const payment = document.querySelector('select');
  const setPayment = value => {
    payment.value = value;
    payment.dispatchEvent(new window.Event('change'));
  };

  assert.equal(document.querySelector('input[type=date]'), null);
  assert.equal(credit.getAttribute('aria-expanded'), 'false');
  credit.click();
  assert.equal(day('2026-11-15').disabled, true);
  assert.equal(day('2026-11-16').disabled, true);
  assert.equal(day('2026-11-17').disabled, false);
  assert.equal(document.querySelector('[aria-label="Mês anterior"]').disabled, true);

  setPayment('BANK_SLIP');
  assert.equal(day('2026-11-17').disabled, true);
  day('2026-11-17').click();
  assert.equal(credit.getAttribute('aria-expanded'), 'true');
  assert.match(credit.textContent, /20\/11\/2026/);
  assert.equal(day('2026-11-18').disabled, false);
  day('2026-11-18').click();
  assert.equal(credit.getAttribute('aria-expanded'), 'false');
  assert.match(credit.textContent, /18\/11\/2026/);
  assert.equal(document.querySelector('output').textContent, '17/11/2026');

  setPayment('PIX');
  credit.click();
  assert.equal(day('2026-11-17').disabled, false);
  day('2026-11-17').click();
  setPayment('BANK_SLIP');
  assert.match(credit.textContent, /20\/11\/2026/);
  assert.equal(document.querySelector('output').textContent, '19/11/2026');
  credit.click();
  document.querySelector('[aria-label="Próximo mês"]').click();
  assert.equal(day('2026-12-01').disabled, false);
  day('2026-12-01').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(credit.getAttribute('aria-expanded'), 'false');
  assert.equal(document.activeElement, credit);
});

test('Swile gallery opens the PDF for the exact order and shows documents as they arrive', async t => {
  const { window } = new JSDOM('<!doctype html><body></body>');
  const { document } = window;
  const calls = [];
  const opened = [];
  let invoiceIssued = false;
  const view = openSwileView({ document, gallery: true,
    previewDocument: (blob, name, resolveReturnFocus) => opened.push([blob, name, resolveReturnFocus()]),
    request: async (operation, body) => {
      calls.push([operation, body]);
      if (body.document) return { fileName: 'Nota fiscal Swile A.pdf', base64: 'JVBERi0=' };
      if (!body.orderCode) return [{ orderCode: 'GROUP', status: 'WAITING_PAYMENT', creditCents: 10000 }];
      return { orderCode: 'GROUP', status: 'WAITING_PAYMENT', creditCents: 10000, items: [], documents: [
        { orderCode: 'A', kind: 'boleto' },
        ...(invoiceIssued ? [{ orderCode: 'A', kind: 'invoice' }] : []),
      ] };
    },
  });
  t.after(() => { view.close(); window.close(); });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const click = text => [...document.querySelectorAll('button')].find(b => b.textContent.includes(text)).click();
  await settle();
  click('GROUP');
  await settle();
  assert.match(document.body.textContent, /Aguardando nota fiscal/);
  assert.ok([...document.querySelectorAll('button')].find(b => b.textContent === 'Boleto · A'));
  invoiceIssued = true;
  click('Voltar aos pedidos');
  await settle();
  click('Histórico');
  await settle();
  click('GROUP');
  await settle();
  click('Nota fiscal');
  await settle();
  assert.deepEqual(calls.at(-1), ['orders', { orderCode: 'GROUP', document: { orderCode: 'A', kind: 'invoice' } }]);
  assert.equal(opened[0][1], 'Nota fiscal Swile A.pdf');
  assert.equal(opened[0][2].textContent, 'Nota fiscal · A');
  assert.equal(await opened[0][0].text(), '%PDF-');
});

test('Swile gallery is a separate screen and can open an older completed order', async t => {
  const { window } = new JSDOM('<!doctype html><body><main id="app"><button>Galeria Swile</button></main></body>');
  const { document } = window;
  const opener = document.querySelector('button');
  opener.focus();
  const order = { orderCode: 'SWO123', status: 'APPROVED_PARTIALLY', creditDate: '2026-11-17', creditCents: 22505 };
  const oldOrder = { orderCode: 'SWO90', status: 'APPROVED', requestDate: '2026-03-16', creditCents: 10000 };
  const calls = [];
  let wentHome = false;
  const onHome = () => {
    assert.equal(document.querySelector('main.swile-gallery-page'), null);
    assert.equal(document.querySelector('#app').hasAttribute('inert'), false);
    wentHome = true;
  };
  const view = openSwileView({ document, gallery: true, onHome, request: async (operation, payload) => {
    calls.push([operation, payload]);
    if (payload.gallery === 'history') return payload.orderCode ? { ...oldOrder, items: [] } : [order, oldOrder];
    if (!payload.orderCode) return [order];
    return { ...order, items: [
      { name: 'Pessoa A', amountCents: 12505, status: 'APPROVED', creditDate: '2026-11-17' },
      { name: 'Pessoa B', amountCents: 10000, status: null, orderStatus: 'APPROVED_PARTIALLY', creditDate: '2026-11-18' },
    ] };
  } });
  t.after(() => { view.close(); window.close(); });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  assert.equal(document.querySelector('dialog'), null);
  assert.ok(document.querySelector('#app').hasAttribute('inert'));
  const screen = document.querySelector('main.swile-gallery-page');
  const header = screen.querySelector('header');
  assert.equal(header.querySelector('h1.screen-navigation-title')?.textContent, 'Galeria Swile');
  const back = header.querySelector('nav button[aria-label="Voltar ao RH"]');
  assert.ok(back);
  const sync = header.querySelector(':scope > [data-gallery-refresh]');
  assert.ok(sync);
  const findButton = text => [...screen.querySelectorAll('button')].find(button => button.textContent.includes(text));
  assert.match(screen.textContent, /Galeria Swile.*Em aberto.*SWO123.*225,05/s);
  findButton('SWO123').click();
  await settle();
  assert.match(screen.textContent, /Pessoa A.*125,05.*Nº do cartão.*Não informado.*Crédito concluído.*17\/11\/2026.*Data efetuada.*Não informada/s);
  assert.match(screen.textContent, /Pessoa B.*100,00.*Status da cargaNão informado.*18\/11\/2026.*Status do pedidoCrédito parcial/s);
  findButton('Voltar aos pedidos').click();
  await settle();
  findButton('Histórico').click();
  await settle();
  assert.match(screen.textContent, /SWO90.*16\/03\/2026/s);
  findButton('SWO90').click();
  await settle();
  assert.match(screen.textContent, /Pedido SWO90.*Crédito concluído/s);
  sync.click();
  await settle();
  assert.match(screen.textContent, /Pedido SWO90.*Crédito concluído/s);
  findButton('Voltar aos pedidos').click();
  await settle();
  sync.click();
  await settle();
  assert.deepEqual(calls, [
    ['orders', { gallery: 'pending' }],
    ['orders', { gallery: 'pending', orderCode: 'SWO123' }],
    ['orders', { gallery: 'pending' }],
    ['orders', { gallery: 'history' }],
    ['orders', { gallery: 'history', orderCode: 'SWO90' }],
    ['orders', { gallery: 'history', orderCode: 'SWO90' }],
    ['orders', { gallery: 'history' }],
    ['orders', { gallery: 'history' }],
  ]);
  assert.equal(findButton('Atualizar pedidos'), undefined);
  back.click();
  assert.equal(screen.isConnected, false);
  assert.equal(document.querySelector('#app').hasAttribute('inert'), false);
  assert.equal(document.activeElement, opener);
  const reopened = openSwileView({ document, gallery: true, request: async () => [] });
  t.after(() => reopened.close());
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(document.querySelector('main.swile-gallery-page'), null);
  assert.equal(document.activeElement, opener);
  const homeView = openSwileView({ document, gallery: true, onHome, request: async () => [] });
  t.after(() => homeView.close());
  document.querySelector('.swile-gallery-page nav button[aria-label="Início"]').click();
  assert.equal(wentHome, true);
});

test('Swile keeps open orders visible and spins the sync icon until the direct query settles', async t => {
  const { window } = new JSDOM('<main id="app"></main>');
  const { document } = window;
  const order = { orderCode: 'SWO123', status: 'WAITING_PAYMENT', creditCents: 10000 };
  const pendingQueries = [];
  const view = openSwileView({ document, gallery: true, request: (operation, payload, { signal }) => {
    assert.deepEqual([operation, payload], ['orders', { gallery: 'pending' }]);
    const response = Promise.withResolvers();
    pendingQueries.push({ ...response, signal });
    return response.promise;
  } });
  t.after(() => { view.close(); window.close(); });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const screen = document.querySelector('.swile-gallery-page');
  const sync = screen.querySelector('header > [data-gallery-refresh]');
  assert.equal(sync.getAttribute('aria-label'), 'Sincronizar pedidos da Swile');
  assert.equal(sync.getAttribute('aria-busy'), null);
  pendingQueries[0].resolve([order]);
  await settle();

  sync.click();
  sync.click();
  assert.equal(sync.getAttribute('aria-busy'), 'true');
  assert.equal(sync.disabled, true);
  assert.equal(pendingQueries.length, 2);
  assert.match(screen.querySelector('.swile-order-list').textContent, /SWO123.*Aguardando pagamento/s);
  pendingQueries[1].reject(new Error('A Swile está indisponível.'));
  await settle();
  assert.equal(sync.getAttribute('aria-busy'), null);
  assert.equal(sync.disabled, false);
  assert.match(screen.textContent, /A Swile está indisponível.*Aguardando pagamento/s);

  sync.click();
  assert.equal(sync.getAttribute('aria-busy'), 'true');
  assert.equal(pendingQueries.length, 3);
  pendingQueries[2].resolve([{ ...order, status: 'PAID' }]);
  await settle();
  assert.match(screen.textContent, /Pagamento confirmado/);
  assert.doesNotMatch(screen.textContent, /Aguardando pagamento|A Swile está indisponível/);
  assert.equal(sync.getAttribute('aria-busy'), null);
  assert.equal(sync.disabled, false);

  sync.click();
  screen.querySelector('[aria-label="Voltar ao RH"]').click();
  assert.equal(pendingQueries[3].signal.aborted, true);
  pendingQueries[3].resolve([]);
  await settle();
  assert.equal(screen.isConnected, false);
});

test('Swile uses the portal token and demo mode never sends a request', async () => {
  const calls = [];
  const options = { apiBaseUrl: 'https://example.com', tokenProvider: async () => 'test-token', fetchImpl: async (url, init) => {
    calls.push([url, init]);
    return Response.json({ status: 'processed', messages: [], swile: [] });
  } };
  const client = createChatClient(options);
  assert.deepEqual(await client.swileRequest('directory'), []);
  assert.match(calls[0][0], /\/api\/portal-chat$/);
  assert.equal(calls[0][1].headers.Authorization, 'Bearer test-token');
  assert.deepEqual(JSON.parse(calls[0][1].body), { action: 'swile_directory' });
  await client.swileRequest('orders', { gallery: 'pending' });
  await client.swileRequest('orders', { gallery: 'pending' });
  for (const [, init] of calls.slice(1)) {
    assert.equal(init.cache, 'no-store');
    assert.deepEqual(JSON.parse(init.body), { action: 'swile_orders', gallery: 'pending' });
  }
  const demo = createChatClient({ ...options, apiPrefix: '/api/demo' });
  await assert.rejects(demo.swileRequest('confirm', { id: 'test' }), /ambiente da empresa/);
  assert.equal(calls.length, 3);
});
