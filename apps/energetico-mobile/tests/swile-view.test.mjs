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
    click('Enviar pedido à Swile');
    await settle();
    assert.deepEqual(calls.at(-1), ['confirm', { id: 'preview' }]);
    assert.match(document.body.textContent, /Aguardando pagamento.*SWO123/s);
  } finally {
    view.close();
    window.close();
  }
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
