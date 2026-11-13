import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createChatClient } from '../src/chat/chat-client.js';

const cards = [
  { id: 'card-a', name: 'Pessoa Ávila', cardLast4: '0101' },
  { id: 'card-b', name: 'Pessoa Barbosa', cardLast4: '0202' },
];
const preview = {
  id: 'preview-1', items: [{ name: 'Pessoa Ávila', cardLast4: '0101', amountCents: 5500 }],
  creditCents: 5500, feeCents: 55, totalCents: 5555, paymentMethod: 'BOLETO',
};
const settle = () => new Promise(resolve => setImmediate(resolve));

async function fixture(t, request, gallery = false) {
  const { window } = new JSDOM('<main id="app"><button>Abrir Trancid</button></main>');
  const { document } = window;
  const opener = document.querySelector('button');
  opener.focus();
  t.after(() => window.close());
  const { openTrancidRechargeView } = await import('../src/ui/trancid-recharge-view.js');
  const view = openTrancidRechargeView({ document, request, gallery });
  t.after(() => view.close());
  await settle();
  return {
    document, window, opener,
    click(text) {
      const button = [...document.querySelectorAll('button')].find(button => button.textContent === text);
      assert.ok(button, `missing button: ${text}`);
      button.click();
    },
    input(selector, value) {
      const input = document.querySelector(selector);
      assert.ok(input, `missing field: ${selector}`);
      input.value = value;
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    },
  };
}

test('Trancid only sends the reviewed recharge after confirmation', async t => {
  const calls = [];
  const { document, click, input } = await fixture(t, async (operation, body) => {
    calls.push([operation, body]);
    if (operation === 'directory') return cards;
    if (operation === 'preview') return preview;
    if (operation === 'confirm') return {
      id: preview.id, orderCode: '790001', status: 'SUBMITTED', creditCents: 5500, totalCents: 5555, paymentMethod: 'BOLETO',
    };
    throw new Error(operation);
  });
  assert.match(document.querySelector('dialog').textContent, /Vale-transporte.*Pessoa Ávila.*0101/s);
  click('Conferir pedido');
  await settle();
  assert.deepEqual(calls, [['directory', {}]]);
  const firstCard = '[aria-label="Selecionar Pessoa Ávila, cartão final 0101"]';
  document.querySelector(firstCard).click();
  input('[aria-label="Valor da recarga por cartão"]', '55,00');
  input('[type=search]', '0202');
  assert.equal(document.querySelector(firstCard), null);
  input('[type=search]', 'avila');
  assert.equal(document.querySelector(firstCard).checked, true);
  click('Conferir pedido');
  await settle();
  assert.deepEqual(calls, [
    ['directory', {}],
    ['preview', { items: [{ id: 'card-a', amountCents: 5500 }], paymentMethod: 'BOLETO' }],
  ]);
  assert.match(document.body.textContent, /Boleto.*Pessoa Ávila.*0101.*55,00.*Taxa estimada.*0,55.*Total estimado.*55,55/s);
  click('Enviar pedido à Trancid');
  click('Enviar pedido à Trancid');
  await settle();
  assert.deepEqual(calls.at(-1), ['confirm', { id: 'preview-1' }]);
  assert.equal(calls.filter(([operation]) => operation === 'confirm').length, 1);
  assert.match(document.body.textContent, /Pedido enviado.*790001/s);
});

test('Trancid requires the gallery check after an uncertain submission', async t => {
  const operations = [];
  const { document, click, input } = await fixture(t, async operation => {
    operations.push(operation);
    if (operation === 'directory') return cards;
    if (operation === 'preview') return preview;
    if (operation === 'history') return { orders: [], hasMore: false, page: 1 };
    return { id: preview.id, orderCode: '790001', status: 'UNCONFIRMED', creditCents: 5500, totalCents: null, paymentMethod: 'BOLETO' };
  });
  document.querySelector('[aria-label="Selecionar Pessoa Ávila, cartão final 0101"]').click();
  input('[aria-label="Valor da recarga por cartão"]', '55,00');
  click('Conferir pedido');
  await settle();
  click('Enviar pedido à Trancid');
  await settle();
  assert.match(document.body.textContent, /Envio sem confirmação.*Confira o pedido 790001.*Galeria Trancid/s);
  assert.doesNotMatch(document.body.textContent, /Enviar pedido à Trancid/);
  click('Consultar Galeria Trancid');
  await settle();
  assert.equal(operations.at(-1), 'history');
  assert.ok(document.querySelector('main.trancid-gallery-page'));
});

test('Trancid opens its paginated history in a full-screen gallery and returns to RH', async t => {
  const pages = [];
  const { document, window, opener, click } = await fixture(t, async (operation, { page }) => {
    assert.equal(operation, 'history');
    pages.push(page);
    const order = page === 1 ?
      { orderCode: '790001', status: 'Enviado', requestDate: '2026-11-13', creditCents: 22000, totalCents: 22220, paymentMethod: 'BOLETO' } :
      { orderCode: '788001', status: 'Em andamento', requestDate: '2026-09-17', creditCents: 5500, totalCents: null, paymentMethod: 'PIX' };
    return { orders: [order], hasMore: page === 1, page };
  }, true);
  const screen = document.querySelector('main.trancid-gallery-page');
  assert.ok(screen);
  assert.equal(document.querySelector('dialog'), null);
  assert.equal(document.querySelector('#app').hasAttribute('inert'), true);
  assert.match(screen.textContent, /Galeria Trancid.*790001.*220,00.*Enviado.*13\/11\/2026.*Boleto.*222,20/s);
  click('Próxima página');
  await settle();
  assert.match(screen.textContent, /788001.*55,00.*Em andamento.*17\/09\/2026.*Pix/s);
  assert.doesNotMatch(screen.textContent, /Total|Não informado/);
  click('Página anterior');
  await settle();
  assert.deepEqual(pages, [1, 2, 1]);
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(screen.isConnected, false);
  assert.equal(document.querySelector('#app').hasAttribute('inert'), false);
  assert.equal(document.activeElement, opener);
});

test('Trancid client uses authenticated portal actions without retrying uncertain confirmation', async () => {
  const calls = [];
  const options = {
    apiBaseUrl: 'https://energetico.example',
    tokenProvider: async () => 'fake-token',
    fetchImpl: async (url, { body, headers }) => {
      const payload = JSON.parse(body);
      calls.push([url, headers.Authorization, payload]);
      if (payload.action === 'trancid_recharge_confirm') throw new TypeError('Network lost');
      return Response.json({ status: 'processed', messages: [], trancid: cards });
    },
  };
  const client = createChatClient(options);
  assert.deepEqual(await client.trancidRechargeRequest('directory'), cards);
  await assert.rejects(client.trancidRechargeRequest('confirm', { id: 'preview-1' }), /Galeria Trancid/);
  assert.deepEqual(calls, [
    ['https://energetico.example/api/portal-chat', 'Bearer fake-token', { action: 'trancid_recharge_directory' }],
    ['https://energetico.example/api/portal-chat', 'Bearer fake-token', { action: 'trancid_recharge_confirm', id: 'preview-1' }],
  ]);
  const demo = createChatClient({ ...options, apiPrefix: '/api/demo' });
  await assert.rejects(demo.trancidRechargeRequest('confirm', { id: 'preview-1' }), /ambiente da empresa/);
  assert.equal(calls.length, 2);
});

test('Trancid client preserves a response that confirms no order was submitted', async () => {
  const client = createChatClient({
    apiBaseUrl: 'https://energetico.example',
    tokenProvider: async () => 'fake-token',
    fetchImpl: async () => Response.json({
      code: 'TRANCID_NOT_SUBMITTED', error: 'O portal recusou o valor da recarga.',
    }, { status: 409 }),
  });
  await assert.rejects(client.trancidRechargeRequest('confirm', { id: 'preview-1' }), {
    status: 409, message: 'O portal recusou o valor da recarga.',
  });
});
