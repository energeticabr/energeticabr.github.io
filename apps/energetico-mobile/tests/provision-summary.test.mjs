import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createChatClient } from '../src/chat/chat-client.js';
import { createChatView, renderChatMarkup } from '../src/ui/chat-view.js';
import { provisionSnapshot, provisionFlow, provisionState } from './helpers/provision-summary-fixture.mjs';

test('collapsed read-only summary precedes sending controls and contains every escaped line detail', t => {
  const source = provisionSnapshot();
  source.id = 'batch"><img src=x>';
  source.lines[0].product = '<img src=x onerror=alert(1)>';
  source.lines[0].details.supplier = '<script>alert(1)</script>';
  source.lines[0].details.observation = '<svg onload=alert(1)>';
  source.lines[0].quantity = '12345678901234567890.123456789';
  const dom = new JSDOM(renderChatMarkup(provisionState(provisionFlow(source))));
  t.after(() => dom.window.close());
  const doc = dom.window.document, panel = doc.querySelector('.chat-provisions');
  assert.ok(panel, 'provision summary exists without attachments');
  assert.equal(panel.open, false);
  assert.equal(panel.dataset.batchId, source.id);
  assert.equal(panel.querySelector('summary').textContent.trim(), 'Total da provisão: R$ 44,50 · 2 linhas');
  assert.equal(doc.querySelector('[data-chat-form]').previousElementSibling.lastElementChild, panel);
  assert.equal(panel.querySelector('button, input, script, img, svg'), null);
  const entries = [...panel.querySelectorAll('.chat-provision-entry')];
  assert.equal(entries.length, 2);
  assert.equal(entries[0].querySelector('h3').textContent, '1. <img src=x onerror=alert(1)>');
  assert.deepEqual([...entries[0].querySelectorAll('dt')].map(n => n.textContent),
    ['Fornecedor', 'Quantidade', 'Valor unitário', 'Frete', 'Total da linha', 'Filial', 'Imóvel', 'Forma de pagamento', 'Vencimento', 'Observação']);
  assert.deepEqual([...entries[0].querySelectorAll('dd')].map(n => n.textContent),
    ['<script>alert(1)</script>', '12345678901234567890,123456789', 'R$ 10,50', 'R$ 1,25', 'R$ 22,25',
      'Filial A', 'Imóvel A', 'PIX', '08/10/2026', '<svg onload=alert(1)>']);
  assert.match(entries[1].textContent, /Fornecedor B/);
});

test('renderer ignores malformed, absent and unrelated snapshots even outside store', () => {
  for (const activeFlow of [null, provisionFlow(undefined), provisionFlow({}),
    provisionFlow(provisionSnapshot({ total: 'NaN' })), { ...provisionFlow(provisionSnapshot()), id: 'launch' }]) {
    assert.doesNotMatch(renderChatMarkup(provisionState(activeFlow)), /class="chat-provisions"/);
  }
});

test('same batch preserves disclosure, scroll and composer; changed batch collapses and clears stale summary', t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app');
  const view = createChatView(root), store = createConversationStore();
  const unsubscribe = store.subscribe(state => view.render({ ...provisionState(state.activeFlow), ...state }));
  t.after(() => { unsubscribe(); view.destroy(); dom.window.close(); });
  store.ingestRemoteMessages([], { activeFlow: provisionFlow(provisionSnapshot()) });
  const panel = root.querySelector('.chat-provisions');
  assert.ok(panel);
  const draft = root.querySelector('textarea');
  draft.focus();
  panel.querySelector('summary').click();
  assert.equal(panel.open, true);
  root.querySelector('.chat-file-tray').scrollTop = 80;
  store.ingestRemoteMessages([{ type: 'text', text: 'Próxima pergunta' }], {
    activeFlow: { ...provisionFlow(provisionSnapshot()), contextId: 'question-two' },
  });
  assert.equal(root.querySelector('.chat-provisions').open, true);
  assert.equal(root.querySelector('.chat-file-tray').scrollTop, 80);
  assert.equal(root.querySelector('textarea'), draft);
  assert.equal(dom.window.document.activeElement, draft);
  root.querySelector('.chat-provisions summary').click();
  store.setDraft('Resposta');
  assert.equal(root.querySelector('.chat-provisions').open, false);
  root.querySelector('.chat-provisions').open = true;
  store.ingestRemoteMessages([], { activeFlow: provisionFlow(provisionSnapshot({ id: 'new-batch' })) });
  assert.equal(root.querySelector('.chat-provisions').open, false);
  assert.equal(root.querySelector('.chat-file-tray').scrollTop, 0);
  store.ingestRemoteMessages([], { activeFlow: null });
  assert.equal(root.querySelector('.chat-provisions'), null);
  store.ingestRemoteMessages([], { activeFlow: provisionFlow(provisionSnapshot()) });
  assert.equal(root.querySelector('.chat-provisions').open, false);
  store.clearSession();
  assert.equal(root.querySelector('.chat-provisions'), null);
});

test('disclosure is local and zero-line summary is accessible', t => {
  const dom = new JSDOM('<main id="app"></main>');
  const root = dom.window.document.querySelector('#app'), view = createChatView(root);
  t.after(() => { view.destroy(); dom.window.close(); });
  let submitted = 0;
  view.on('send-text', () => submitted++);
  view.on('select-reply', () => submitted++);
  view.render(provisionState(provisionFlow(provisionSnapshot({ count: 0, lines: [], total: '0', totalDisplay: 'R$ 0,00' }))));
  const panel = root.querySelector('.chat-provisions');
  assert.ok(panel);
  assert.match(panel.querySelector('summary').textContent, /R\$ 0,00 · 0 linhas/);
  panel.querySelector('summary').click();
  assert.equal(panel.open, true);
  assert.match(panel.textContent, /Nenhuma linha de provisão adicionada/);
  panel.querySelector('summary').click();
  assert.equal(panel.open, false);
  assert.equal(submitted, 0);
  assert.equal(root.querySelector('textarea').value, 'Próxima linha');
});

const embeddedFlows = [
  { id: 'supply_product_registration', title: 'CADASTRO DE PRODUTO' },
  { id: 'supply_supplier_registration', title: 'CADASTRO DE FORNECEDOR' },
  { id: 'supply_subfamily_registration', title: 'CADASTRO DE SUBFAMÍLIA' },
  { id: 'supply_family_registration', title: 'CADASTRO DE FAMÍLIA' },
  { id: 'supply_group_registration', title: 'CADASTRO DE GRUPO' },
];

test('renderer requires payment provenance in supported registrations and rejects forged ownership elsewhere', t => {
  const dom = new JSDOM('<main id="app"></main>');
  t.after(() => dom.window.close());
  const root = dom.window.document.querySelector('#app');
  for (const flow of embeddedFlows) {
    root.innerHTML = renderChatMarkup(provisionState({
      ...flow, provisionLines: provisionSnapshot({ ownerFlow: 'payment' }),
    }));
    assert.equal(root.querySelector('.chat-provisions summary')?.textContent,
      'Total da provisão: R$ 44,50 · 2 linhas', flow.id);
    for (const provenance of [{}, { ownerFlow: 'launch' }, { ownerFlow: null }, { ownerFlow: 'Payment' }, { ownerFlow: ' payment ' }]) {
      root.innerHTML = renderChatMarkup(provisionState({ ...flow, provisionLines: provisionSnapshot(provenance) }));
      assert.equal(root.querySelector('.chat-provisions'), null, `${flow.id}: ${provenance.ownerFlow}`);
    }
  }
  for (const id of ['launch', 'measurement', 'document_signing', 'other_registration', 'payment_registration']) {
    root.innerHTML = renderChatMarkup(provisionState({
      id, title: 'OUTRO FLUXO', provisionLines: provisionSnapshot({ ownerFlow: 'payment' }),
    }));
    assert.equal(root.querySelector('.chat-provisions'), null, id);
  }
  root.innerHTML = renderChatMarkup(provisionState(provisionFlow(provisionSnapshot({ ownerFlow: 'launch' }))));
  assert.equal(root.querySelector('.chat-provisions'), null);
});

for (const open of [true, false]) {
  test(`transport → store/view preserves ${open ? 'expanded' : 'collapsed'} disclosure through direct/nested registration and payment return`, async t => {
    const dom = new JSDOM('<main id="app"></main>');
    const root = dom.window.document.querySelector('#app');
    const view = createChatView(root), store = createConversationStore();
    const unsubscribe = store.subscribe(state => view.render({ ...provisionState(state.activeFlow), ...state }));
    t.after(() => { unsubscribe(); view.destroy(); dom.window.close(); });
    let responseFlow;
    const client = createChatClient({
      apiBaseUrl: 'https://provision.test', tokenProvider: async () => 'test-token',
      fetchImpl: async () => new Response(JSON.stringify({
        status: 'processed', activeFlow: responseFlow,
        messages: [{ type: 'text', text: 'Próxima pergunta' }],
      }), { headers: { 'Content-Type': 'application/json' } }),
    });
    const receive = async flow => {
      responseFlow = flow;
      const operation = store.beginText('Próximo');
      store.confirmText(operation, await client.sendText({ text: 'Próximo' }));
    };
    await receive(provisionFlow(provisionSnapshot())); // Legacy direct payment has no ownerFlow.
    const panel = root.querySelector('.chat-provisions');
    assert.ok(panel);
    if (open) panel.querySelector('summary').click();
    const composer = root.querySelector('textarea');
    composer.focus();
    root.querySelector('.chat-file-tray').scrollTop = 80;
    const [product, supplier, subfamily, family, group] = embeddedFlows;
    const route = [product, subfamily, family, group, family, subfamily, product,
      { id: 'payment', title: 'PROVISÃO DE PAGAMENTO' }, supplier,
      { id: 'payment', title: 'PROVISÃO DE PAGAMENTO' }];
    for (const [index, flow] of route.entries()) {
      await receive({ ...flow, contextId: `step:${index}`,
        provisionLines: provisionSnapshot(flow.id === 'payment' ? {} : { ownerFlow: 'payment' }),
      });
      assert.equal(store.getState().activeFlow.id, flow.id);
      assert.equal(root.querySelector('.chat-provisions')?.dataset.batchId, 'provision-batch-one', flow.id);
      assert.equal(root.querySelector('.chat-provisions')?.open, open, flow.id);
      assert.equal(root.querySelector('.chat-file-tray')?.scrollTop, 80, flow.id);
      assert.equal(root.querySelector('textarea'), composer);
      assert.equal(dom.window.document.activeElement, composer);
    }
    await receive({ ...group, provisionLines: provisionSnapshot({ ownerFlow: 'payment', id: 'new-batch' }) });
    assert.equal(root.querySelector('.chat-provisions').open, false);
    assert.equal(root.querySelector('.chat-file-tray').scrollTop, 0);
    root.querySelector('.chat-provisions').open = true;
    await receive({ ...group, provisionLines: provisionSnapshot({ id: 'new-batch' }) });
    assert.equal(root.querySelector('.chat-provisions'), null);
    await receive(provisionFlow(provisionSnapshot({ id: 'new-batch' })));
    assert.equal(root.querySelector('.chat-provisions').open, false);
    await receive({ id: 'launch', title: 'LANÇAMENTO', provisionLines: provisionSnapshot({ id: 'new-batch', ownerFlow: 'payment' }) });
    assert.equal(root.querySelector('.chat-provisions'), null);
  });
}
