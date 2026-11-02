import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(t, { factory, dataFactory } = {}) {
  const handlers = new Map(), panels = [], sources = [], requests = [];
  const view = { on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event); },
    render() {}, focusComposer() {}, destroy() {}, emit(event, command = {}) { return handlers.get(event)?.({ type: event, ...command }); } };
  const account = { homeAccountId: 'asset-test-user', username: 'test@example.invalid' };
  const store = createConversationStore();
  const controller = createAppController({ store, view,
    auth: { initialize: async () => account, signIn: async () => account, signOut: async () => {}, getToken: async () => 'test-token' },
    client: { async sendText(payload) { requests.push(payload); return { status: 'processed', messages: [] }; } },
    native: { importSharedItems: async () => [] },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    registrationGalleryDataFactory: dataFactory || (async ({ kind }) => { sources.push(kind); return { loadSnapshot: async () => ({ rows: [] }) }; }),
    registrationGalleryFactory: factory || (async options => {
      const panel = { ...options, opens: [], closes: 0, destroyed: false,
        open(options) { this.opens.push(options); }, close() { this.closes++; }, destroy() { this.destroyed = true; } };
      panels.push(panel); return panel;
    }),
  });
  t.after(() => controller.stop());
  return { controller, view, panels, sources, requests };
}

test('botão cinza de Suprimentos abre a escolha local mantendo a ação azul', () => {
  const dom = new JSDOM('<!doctype html><body><main></main></body>');
  const view = createChatView(dom.window.document.querySelector('main'));
  const selected = []; view.on('select-reply', command => selected.push(command.replyId));
  view.render({ sessionStatus: 'authenticated', messages: [{ id: 'assets', role: 'assistant', type: 'poll',
    question: 'SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?', options: [
      { id: 'action_supply_fixed_assets', reply: 'action_supply_fixed_assets', label: 'IMOBILIZADOS' },
    ] }], pendingFiles: [], draft: '' });
  const gray = dom.window.document.querySelector('[data-reply-id="action_asset_hub"]');
  assert.ok(gray); gray.click();
  dom.window.document.querySelector('[data-reply-id="action_supply_fixed_assets"]').click();
  assert.deepEqual(selected, ['action_asset_hub', 'action_supply_fixed_assets']);
  view.destroy(); dom.window.close();
});

test('menu abre uma vez sem ler dados e leva às duas galerias, com retorno ao menu', async t => {
  const h = harness(t); await h.controller.start(); const before = h.requests.length;
  assert.deepEqual(await Promise.all([h.view.emit('select-reply', { replyId: 'action_asset_hub' }), h.view.emit('select-reply', { replyId: 'action_asset_hub' })]), [true, true]);
  const menu = h.panels[0]; assert.equal(menu.kind, 'assetMenu'); assert.deepEqual(h.sources, []);
  assert.equal(h.panels.length, 1);
  await menu.onSelect('asset'); assert.deepEqual(h.sources, ['asset']);
  assert.equal(h.panels[1].kind, 'asset'); assert.ok(menu.closes);
  await h.panels[1].opens.at(-1).onBack();
  assert.equal(menu.opens.length, 2);
  await menu.onSelect('assetLaunches');
  assert.equal(h.panels[2].kind, 'assetLaunches');
  assert.equal(h.panels[2].onCreate, undefined);
  await h.panels[2].opens.at(-1).onBack();
  assert.equal(menu.opens.length, 3);
  assert.equal(h.requests.length, before);
  h.controller.stop(); await assert.rejects(async () => menu.onSelect('assetLaunches'), /sessão/);
});

test('fábrica atrasada do menu não abre depois do encerramento da sessão', async t => {
  let finish; let opens = 0, destroys = 0;
  const h = harness(t, { factory: () => new Promise(resolve => { finish = resolve; }) });
  await h.controller.start(); const pending = h.view.emit('select-reply', { replyId: 'action_asset_hub' }); await tick();
  h.controller.stop(); finish({ open() { opens++; }, destroy() { destroys++; } });
  assert.equal(await pending, false); assert.equal(opens, 0); assert.equal(destroys, 1);
});

test('menu invalida uma galeria antiga ainda carregando e permite uma nova escolha sem esperar a antiga', async t => {
  let finish; let sourceCalls = 0;
  const data = { loadSnapshot: async () => ({ rows: [] }) };
  const h = harness(t, { dataFactory: async () => ++sourceCalls === 1 ? new Promise(resolve => { finish = resolve; }) : data });
  await h.controller.start();
  const previous = h.view.emit('select-reply', { replyId: 'action_asset_gallery' }); await tick();
  await h.view.emit('select-reply', { replyId: 'action_asset_hub' });
  const menu = h.panels[0];
  const fresh = menu.onSelect('asset'); await tick();
  assert.equal(sourceCalls, 2, 'a nova escolha não deve compartilhar a consulta obsoleta');
  assert.equal(await fresh, true);
  finish(data); assert.equal(await previous, false);
  assert.deepEqual(h.panels.map(panel => panel.kind), ['assetMenu', 'asset']);
});

test('Voltar durante uma consulta lenta permite reabrir lançamentos imediatamente', async t => {
  const dom = new JSDOM('<!doctype html><body></body>'); t.after(() => dom.window.close());
  let finish; let loads = 0;
  const snapshot = { rows: [{ id: '1', fields: { IMOBILIZADO: 'TESTE', 'ID IMOBILIZADO': 2 } }] };
  const h = harness(t, {
    dataFactory: async () => ({ loadSnapshot: () => ++loads === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(snapshot) }),
    factory: async options => {
      if (options.kind === 'assetMenu') return (await import('../src/ui/asset-gallery-menu.js')).createAssetGalleryMenu({ ...options, document: dom.window.document });
      return createRegistrationGallery({ ...options, document: dom.window.document });
    },
  });
  await h.controller.start(); await h.view.emit('select-reply', { replyId: 'action_asset_hub' });
  const choose = () => dom.window.document.querySelector('[data-asset-gallery="assetLaunches"]').click();
  choose(); await tick(); assert.equal(loads, 1);
  dom.window.document.querySelector('[data-action="registration-close"]').click(); await tick();
  choose(); await tick(); assert.equal(loads, 2);
  finish(snapshot); await tick(); await tick();
  assert.equal(dom.window.document.querySelector('[data-gallery-kind="assetLaunches"]').hidden, false);
  assert.equal(dom.window.document.querySelector('.asset-gallery-menu').hidden, true);
});

test('galeria só retorna ao menu ao usar Voltar, preservando o acesso direto e fechamento externo', async t => {
  const dom = new JSDOM('<!doctype html><body></body>'); t.after(() => dom.window.close());
  let backs = 0;
  const gallery = createRegistrationGallery({ document: dom.window.document, kind: 'asset', data: { loadSnapshot: async () => ({ rows: [] }) } });
  t.after(() => gallery.destroy()); await gallery.open({ onBack() { backs++; } });
  gallery.close(); assert.equal(backs, 0);
  await gallery.open({ onBack() { backs++; } });
  dom.window.document.querySelector('[data-action="registration-close"]').click(); assert.equal(backs, 1);
  await gallery.open(); dom.window.document.querySelector('[data-action="registration-close"]').click(); assert.equal(backs, 1);
});

test('tela intermediária mostra duas escolhas em ordem e impede escolhas duplicadas', async t => {
  const { createAssetGalleryMenu } = await import('../src/ui/asset-gallery-menu.js');
  const dom = new JSDOM('<!doctype html><body><button id="origin">Imobilizados</button></body>'); t.after(() => dom.window.close());
  const selected = []; let resolve;
  const menu = createAssetGalleryMenu({ document: dom.window.document, onSelect(kind) { selected.push(kind); return new Promise(done => { resolve = done; }); } });
  t.after(() => menu.destroy()); dom.window.document.querySelector('#origin').focus(); await menu.open();
  const buttons = [...dom.window.document.querySelectorAll('[data-asset-gallery]')];
  assert.deepEqual(buttons.map(button => button.textContent), ['CADASTROS IMOBILIZADOS', 'LANÇAMENTOS IMOBILIZADOS']);
  buttons[1].click(); buttons[1].click(); assert.deepEqual(selected, ['assetLaunches']);
  resolve(true); await tick(); menu.close(); assert.equal(dom.window.document.activeElement.id, 'origin');
});
