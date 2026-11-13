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
  const view = openSwileView({ document, request: async (operation, body) => {
    calls.push([operation, body]);
    if (operation === 'directory') return [
      { id: 1, name: 'Pessoa A', hasActiveCard: true },
      { id: 2, name: 'Pessoa B', hasActiveCard: false },
    ];
    if (operation === 'preview') return {
      id: 'preview', items: [{ name: 'Pessoa A', amountCents: 1234 }],
      totalEmployees: 1, creditCents: 1234, paymentCents: 1300,
      paymentMethod: 'PIX', creditDate: body.creditDate,
    };
    if (operation === 'confirm') return {
      reference: 'preview', orderCode: 'SWO123', status: 'WAITING_PAYMENT',
      creditCents: 1234, creditDate: '2026-12-02',
    };
    throw new Error(operation);
  } });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const click = text => [...document.querySelectorAll('button')].find(button => button.textContent === text).click();
  const input = (element, value) => {
    element.value = value;
    element.dispatchEvent(new window.Event('input', { bubbles: true }));
  };
  try {
    await settle();
    assert.match(document.body.textContent, /Multibenefícios.*Cartão físico ativo/s);
    input(document.querySelector('[aria-label="Valor em reais para Pessoa A"]'), '12,34');
    input(document.querySelector('[type=search]'), 'Pessoa B');
    assert.equal(document.querySelector('[aria-label="Valor em reais para Pessoa A"]'), null);
    document.querySelector('[type=date]').value = '2026-12-02';
    document.querySelector('select').value = 'PIX';
    click('Conferir pedido');
    await settle();
    assert.deepEqual(calls, [
      ['directory', {}],
      ['preview', { items: [{ employeeId: 1, amountCents: 1234 }], creditDate: '2026-12-02', paymentMethod: 'PIX' }],
    ]);
    assert.match(document.body.textContent, /Total a pagar.*13,00/);
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
  } finally {
    view.close();
    window.close();
  }
});

test('Swile gallery is a separate screen and can open an older completed order', async t => {
  const { window } = new JSDOM('<!doctype html><body><main id="app"><button>Galeria Swile</button></main></body>');
  const { document } = window;
  const opener = document.querySelector('button');
  opener.focus();
  const order = { orderCode: 'SWO123', status: 'APPROVED_PARTIALLY', creditDate: '2026-11-17', creditCents: 22505 };
  const oldOrder = { orderCode: 'SWO90', status: 'APPROVED', requestDate: '2026-03-16', creditCents: 10000 };
  const calls = [];
  const view = openSwileView({ document, gallery: true, request: async (operation, payload) => {
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
  const findButton = text => [...screen.querySelectorAll('button')].find(button => button.textContent.includes(text));
  assert.match(screen.textContent, /Galeria Swile.*Em suspenso.*SWO123.*225,05/s);
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
  findButton('Voltar aos pedidos').click();
  await settle();
  assert.deepEqual(calls, [
    ['orders', { gallery: 'pending' }],
    ['orders', { gallery: 'pending', orderCode: 'SWO123' }],
    ['orders', { gallery: 'pending' }],
    ['orders', { gallery: 'history' }],
    ['orders', { gallery: 'history', orderCode: 'SWO90' }],
    ['orders', { gallery: 'history' }],
  ]);
  findButton('Voltar ao RH').click();
  assert.equal(screen.isConnected, false);
  assert.equal(document.querySelector('#app').hasAttribute('inert'), false);
  assert.equal(document.activeElement, opener);
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
  const demo = createChatClient({ ...options, apiPrefix: '/api/demo' });
  await assert.rejects(demo.swileRequest('confirm', { id: 'test' }), /ambiente da empresa/);
  assert.equal(calls.length, 1);
});
