import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createAppController } from '../src/app-controller.js';
import { createChatClient } from '../src/chat/chat-client.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createChatView } from '../src/ui/chat-view.js';

const toolbar = { type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?', options: [
  { id: 'group_pending', label: 'PENDÊNCIAS' }, { id: 'group_supplies', label: 'SUPRIMENTOS' },
  { id: 'group_human_resources', label: 'RECURSOS HUMANOS' },
] };
const first = { id: '401', supplier: 'Fornecedor de origem', product: 'Serviço', paidAt: '2026-11-13',
  totalCents: 100001, remainingCents: 100001, allocations: [], revision: 'original' };
const ana = { id: '800', sheetId: '25', supplier: 'Ána Alves', amountCents: 23031, paymentType: 'SALÁRIO' };
const half = { ...first, remainingCents: 76970, allocations: [ana], revision: 'partial' };
const settled = { ...half, remainingCents: 0, allocations: [ana, {
  id: '801', sheetId: '48', supplier: 'Bruno Silva', amountCents: 76970, paymentType: 'PREMIAÇÃO',
}], revision: 'complete' };
const targets = { items: [
  { supplier: 'Ána Alves', sheets: [{ id: '25', reference: '11/2026' }, { id: '26', reference: '10/2026' }] },
  { supplier: 'Bruno Silva', sheets: [{ id: '48', reference: '11/2026' }] },
], paymentTypes: ['SALÁRIO', 'PREMIAÇÃO'] };

async function harness(t, respond) {
  const dom = new JSDOM('<main></main>');
  const doc = dom.window.document;
  const root = doc.querySelector('main');
  const store = createConversationStore();
  const calls = [];
  const portal = createChatClient({ apiBaseUrl: 'https://vm.example', tokenProvider: async () => 'fixture-token',
    fetchImpl: async (_url, options) => {
      const event = JSON.parse(options.body);
      assert.equal(event.action, 'launch_gallery');
      assert.equal(options.headers.Authorization, 'Bearer fixture-token');
      calls.push(event);
      const result = await respond(event);
      if (result instanceof Response) return result;
      return Response.json({ status: 'processed', messages: [], launchGallery: result });
    },
  });
  let nativeBack, removed = 0;
  const controller = createAppController({
    store, view: createChatView(root),
    auth: { initialize: async () => ({ name: 'Tester', homeAccountId: 'test' }) },
    native: {
      importSharedItems: async () => [],
      async onReportBack(handler) {
        nativeBack = handler;
        return () => { nativeBack = null; removed++; };
      },
    },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    client: { sendText: async () => ({ status: 'processed', messages: [] }), launchGalleryRequest: portal.launchGalleryRequest },
  });
  t.after(() => { controller.stop(); dom.window.close(); });
  await controller.start();
  store.ingestRemoteMessages([toolbar]);
  return { root, doc, calls, back: () => nativeBack(), removed: () => removed,
    query(selector) { const item = root.querySelector(selector); assert.ok(item, selector); return item; },
    tick: () => new Promise(resolve => setImmediate(resolve)),
    input(node, value, type = 'input') { node.value = value; node.dispatchEvent(new dom.window.Event(type, { bubbles: true })); },
    escape(node) { node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); },
  };
}

function page(items, { page = 1, pageSize = 25, total = items.length } = {}) {
  return { items, total, page, pageSize };
}

const action = name => `[data-payroll-action="${name}"]`;
const open = '[data-action="open-pending-payroll-links"]';
const dialog = '[data-pending-payroll-links]';

function choose(h, query, sheet, type) {
  const field = h.query('[role="combobox"][aria-label="Fornecedor"]');
  field.focus();
  h.input(field, query);
  const match = h.query('[role="listbox"][aria-label="Fornecedor"] [role="option"]');
  match.click();
  h.input(h.query('select[name="sheet"]'), sheet, 'change');
  h.input(h.query('select[name="paymentType"]'), type, 'change');
}

test('home shortcut allocates a payment across two suppliers and removes it only after the balance is covered', async t => {
  let current = first;
  const h = await harness(t, event => {
    if (event.operation === 'payroll_pending') return page(current.remainingCents ? [current] : []);
    if (event.operation === 'payroll_targets') return targets;
    assert.equal(event.operation, 'payroll_apply');
    assert.equal(event.payload.id, '401');
    assert.equal(event.payload.confirm, true);
    if (current === first) {
      assert.equal(event.payload.sheetId, '25');
      assert.equal(event.payload.supplier, 'Ána Alves');
      assert.equal(event.payload.reference, '11/2026');
      assert.equal(event.payload.paymentType, 'SALÁRIO');
      assert.equal(event.payload.mode, 'partial');
      assert.equal(event.payload.amountCents, 23031);
      assert.equal(event.payload.revision, 'original');
      current = half;
    } else {
      assert.equal(event.payload.sheetId, '48');
      assert.equal(event.payload.supplier, 'Bruno Silva');
      assert.equal(event.payload.reference, '11/2026');
      assert.equal(event.payload.paymentType, 'PREMIAÇÃO');
      assert.equal(event.payload.mode, 'total');
      assert.equal(event.payload.revision, 'partial');
      assert.equal(Object.hasOwn(event.payload, 'amountCents'), false);
      current = settled;
    }
    return { item: current };
  });
  const rhid = h.query('[data-action="open-rhid-mascot-report"]');
  assert.equal(rhid.nextElementSibling, h.query(open));
  const originalComposer = h.query('.chat-composer');
  h.query(open).click();
  await h.tick();
  assert.equal(h.query('.chat-composer'), originalComposer);
  assert.ok(h.query('.chat-shell').hasAttribute('inert'));
  assert.match(h.query(dialog).textContent, /ID 401|#401/);
  h.query(action('edit')).click();
  await h.tick();
  choose(h, 'ana', '25', 'SALÁRIO');
  h.query(action('partial')).click();
  const amount = h.query('input[name="amount"]');
  h.input(amount, '1.000,02');
  assert.equal(h.query(action('confirm')).disabled, true);
  h.input(amount, '230,31');
  assert.equal(h.calls.filter(call => call.operation === 'payroll_apply').length, 0);
  h.query(action('confirm')).click();
  await h.tick();
  assert.match(h.query(dialog).textContent, /769,70/);
  assert.match(h.query(dialog).textContent, /Ána Alves/);
  assert.match(h.query(dialog).textContent, /IDFOLHA 25/);
  h.query(action('edit')).click();
  await h.tick();
  choose(h, 'bruno', '48', 'PREMIAÇÃO');
  h.query(action('total')).click();
  assert.match(h.query(action('confirm')).textContent, /769,70/);
  h.query(action('confirm')).click();
  await h.tick();
  assert.equal(h.root.querySelector(action('edit')), null);
  assert.match(h.query(dialog).textContent, /401.+totalmente aplicado/i);
  const writes = h.calls.filter(call => call.operation === 'payroll_apply');
  assert.equal(writes.length, 2);
  assert.notEqual(writes[0].payload.requestId, writes[1].payload.requestId);
  h.back();
  assert.equal(h.root.querySelector(dialog), null);
  assert.equal(h.query('.chat-shell').hasAttribute('inert'), false);
  assert.equal(h.doc.activeElement, h.query(open));
  assert.equal(h.removed(), 1);
});

test('an uncertain application stays on its origin while a different payment can be linked', async t => {
  const attempts = [];
  const second = { ...first, id: '402' };
  let secondCleared = false;
  let visibleFromAnotherPage = false;
  const h = await harness(t, event => {
    if (event.operation === 'payroll_pending') {
      return page(secondCleared ? visibleFromAnotherPage ? [half] : [] : [first, second]);
    }
    if (event.operation === 'payroll_targets') return targets;
    assert.equal(event.operation, 'payroll_apply');
    attempts.push(event.payload);
    if (attempts.length === 1) return Response.json({ error: 'Ainda sem confirmação.', code: 'payroll_apply_uncertain' }, { status: 503 });
    if (event.payload.id === second.id) {
      secondCleared = true;
      return { item: { ...settled, id: second.id } };
    }
    visibleFromAnotherPage = true;
    return { item: half };
  });
  h.query(open).click();
  await h.tick();
  h.query(action('edit')).click();
  await h.tick();
  choose(h, 'ana', '25', 'SALÁRIO');
  h.query(action('partial')).click();
  h.input(h.query('input[name="amount"]'), '230,31');
  h.query(action('confirm')).click();
  await h.tick();
  assert.equal(attempts.length, 1);
  assert.equal(h.root.querySelector(action('edit') + '[data-id="401"]'), null);
  assert.match(h.query(action('retry') + '[data-id="401"]').textContent, /Retomar confirmação/);
  h.query(action('edit') + '[data-id="402"]').click();
  await h.tick();
  choose(h, 'bruno', '48', 'PREMIAÇÃO');
  h.query(action('total')).click();
  h.query(action('confirm')).click();
  await h.tick();
  assert.equal(attempts[1].id, '402');
  assert.equal(h.root.querySelector(action('edit') + '[data-id="402"]'), null);
  h.query(action('close')).click();
  h.query(open).click();
  await h.tick();
  assert.match(h.query(dialog).textContent, /Aplicações a confirmar/);
  h.query(action('retry')).click();
  await h.tick();
  assert.equal(attempts.length, 3);
  assert.deepEqual(attempts[2], attempts[0]);
  assert.equal(h.root.querySelector(action('retry') + '[data-id="401"]'), null);
  assert.match(h.query(dialog).textContent, /769,70/);
});

test('the report loads successive pages, and a stale balance requires a fresh explicit confirmation', async t => {
  let stale = false;
  const h = await harness(t, event => {
    if (event.operation === 'payroll_pending') {
      const number = event.payload.page;
      const item = number === 2 ? (stale ? { ...half, id: '399' } : { ...first, id: '399' }) : first;
      return page([item], { page: number, pageSize: 1, total: 2 });
    }
    if (event.operation === 'payroll_targets') return targets;
    assert.equal(event.operation, 'payroll_apply');
    stale = true;
    return Response.json({ error: 'Outro usuário alterou este saldo.', code: 'conflict' }, { status: 409 });
  });
  h.query(open).click();
  await h.tick();
  h.query(action('next')).click();
  await h.tick();
  h.query(action('edit')).click();
  await h.tick();
  choose(h, 'ana', '25', 'SALÁRIO');
  h.query(action('total')).click();
  h.query(action('confirm')).click();
  await h.tick();
  assert.match(h.query(dialog).textContent, /Outro usuário alterou este saldo/);
  assert.match(h.query(dialog).textContent, /769,70/);
  assert.equal(h.root.querySelector(action('retry')), null);
  assert.equal(h.calls.filter(call => call.operation === 'payroll_apply').length, 1);
  h.escape(h.query(dialog));
  assert.equal(h.root.querySelector(dialog), null);
});

test('a payment with a confirmation from another session offers refresh without allowing a second application', async t => {
  let pending = true;
  const h = await harness(t, ({ operation }) => {
    assert.equal(operation, 'payroll_pending');
    const item = { ...first, applicationPending: pending };
    pending = false;
    return page([item]);
  });
  h.query(open).click();
  await h.tick();
  assert.match(h.query(dialog).textContent, /Aguardando confirmação da aplicação/);
  assert.equal(h.root.querySelector(action('edit')), null);
  h.query(action('refresh')).click();
  await h.tick();
  assert.ok(h.query(action('edit')));
});
