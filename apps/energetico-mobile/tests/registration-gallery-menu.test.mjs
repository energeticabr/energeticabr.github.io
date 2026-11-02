import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createChatView } from '../src/ui/chat-view.js';
import { createAppController } from '../src/app-controller.js';
import { createConversationStore } from '../src/chat/conversation-store.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const supplies = options => ({ sessionStatus: 'authenticated', pendingFiles: [], draft: '', messages: [{
  id: 'supplies', role: 'assistant', type: 'poll', question: 'SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?', options,
}] });
const registration = { id: 'registrations', reply: 'registrations', label: '🗂️ EFETUAR CADASTROS' };

test('atalho cinza acompanha Efetuar Cadastros e dispara acesso próprio uma só vez', t => {
  const dom = new JSDOM('<main></main>'); const doc = dom.window.document;
  const view = createChatView(doc.querySelector('main')); const replies = [];
  t.after(() => { view.destroy(); dom.window.close(); });
  view.on('select-reply', event => replies.push(event.replyId));
  view.render(supplies([registration, { id: 'action_registration_hub', label: 'GALERIA DE CADASTROS' }]));
  const primary = doc.querySelector('[data-reply-id="registrations"]');
  const row = primary.closest('.chat-supplies-extra-pair');
  const shortcut = row.querySelector('.chat-gallery-actions [data-reply-id="action_registration_hub"]');
  assert.ok(shortcut, 'a galeria deve ficar na mesma linha, à direita do cadastro');
  assert.equal(shortcut.textContent, 'GALERIA DE CADASTROS');
  assert.equal(doc.querySelectorAll('[data-reply-id="action_registration_hub"]').length, 1);
  shortcut.click(); primary.click(); assert.deepEqual(replies, ['action_registration_hub', 'registrations']);
  view.render({ ...supplies([registration]), activeText: { id: 'sending' } });
  assert.equal(doc.querySelector('[data-reply-id="action_registration_hub"]').disabled, true);
  view.render(supplies([{ id: 'action_supply_fixed_assets', label: 'IMOBILIZADOS' }]));
  assert.equal(doc.querySelector('[data-reply-id="action_registration_hub"]'), null);
});

function harness(t, { factory, response } = {}) {
  const dom = new JSDOM('<body><button id="origin">Cadastros</button></body>');
  const doc = dom.window.document, handlers = new Map(), requests = [], sources = [], panels = [];
  const view = { on(event, handler) { handlers.set(event, handler); return () => handlers.delete(event); },
    render() {}, focusComposer() {}, destroy() {}, emit(event, command) { return handlers.get(event)?.({ type: event, ...command }); } };
  const account = { homeAccountId: 'registration-menu-test', username: 'test@example.invalid' };
  const store = createConversationStore();
  const controller = createAppController({ view, store,
    auth: { initialize: async () => account, getToken: async () => 'synthetic-token' },
    native: { importSharedItems: async () => [] },
    client: { sendText: async payload => { requests.push(payload); return response ? response(payload) : { status: 'processed', messages: [] }; } },
    pendingProvisionAttachmentsDataFactory: async () => ({ loadUpcomingPayments: async () => [] }),
    registrationGalleryDataFactory: async ({ kind }) => { sources.push(kind); return { loadSnapshot: async () => ({ rows: [] }) }; },
    registrationGalleryFactory: async options => {
      panels.push(options);
      if (factory) return factory(options);
      if (options.kind === 'registrationMenu') {
        const { createRegistrationGalleryMenu } = await import('../src/ui/registration-gallery-menu.js');
        return createRegistrationGalleryMenu({ ...options, document: doc });
      }
      return createRegistrationGallery({ ...options, document: doc });
    },
  });
  t.after(() => { controller.stop(); dom.window.close(); });
  return { doc, controller, view, panels, requests, sources, store };
}

test('escolha local abre as quatro galerias reais e Voltar retorna à escolha sem enviar chat', async t => {
  const h = harness(t); await h.controller.start(); const initialRequests = h.requests.length;
  await Promise.all([h.view.emit('select-reply', { replyId: 'action_registration_hub' }), h.view.emit('select-reply', { replyId: 'action_registration_hub' })]);
  assert.equal(h.panels.length, 1); assert.deepEqual(h.sources, []);
  assert.deepEqual([...h.doc.querySelectorAll('[data-registration-gallery]')].map(button => button.textContent),
    ['GALERIA GRUPO', 'GALERIA FAMÍLIA', 'GALERIA SUBFAMÍLIA', 'GALERIA PRODUTO']);
  for (const kind of ['group', 'family', 'subfamily', 'product']) {
    h.doc.querySelector(`[data-registration-gallery="${kind}"]`).click();
    await tick(); await tick();
    const child = h.doc.querySelector(`[data-gallery-kind="${kind}"]`);
    assert.ok(child, `a escolha deve abrir a galeria ${kind}`); assert.equal(child.hidden, false);
    assert.equal(h.doc.querySelector('.registration-gallery-menu').hidden, true);
    child.querySelector('[data-action="registration-close"]').click(); await tick(); await tick();
    assert.equal(h.doc.querySelector('.registration-gallery-menu').hidden, false);
  }
  assert.deepEqual(h.sources, ['group', 'family', 'subfamily', 'product']);
  assert.equal(h.requests.length, initialRequests);
  await h.panels[0].onSelect('asset'); assert.equal(h.sources.length, 4, 'o menu não aceita destinos externos');
});

test('somente uma linha de Efetuar Cadastros recebe o atalho; outros cadastros não recebem', t => {
  const dom = new JSDOM('<main></main>'); const doc = dom.window.document;
  const view = createChatView(doc.querySelector('main')); t.after(() => { view.destroy(); dom.window.close(); });
  view.render(supplies([registration, { ...registration }]));
  assert.equal(doc.querySelectorAll('[data-reply-id="action_registration_hub"]').length, 1);
  view.render(supplies([{ id: 'action_custom', label: 'CADASTRO DE OUTRO TIPO' }]));
  assert.equal(doc.querySelector('[data-reply-id="action_registration_hub"]'), null);
});

for (const [kind, replyId] of [['registrationMenu', 'action_registration_hub'], ['group', 'action_group_gallery']]) {
  test(`navegação pelo chat descarta a fábrica atrasada de ${kind}`, async t => {
    let finish, opened = 0, destroyed = 0;
    const h = harness(t, { factory: () => new Promise(resolve => { finish = resolve; }) });
    await h.controller.start(); const pending = h.view.emit('select-reply', { replyId }); await tick();
    await h.view.emit('select-reply', { replyId: 'action_supply_registrations', label: 'EFETUAR CADASTROS' });
    finish({ open() { opened++; }, destroy() { destroyed++; } });
    assert.equal(await pending, false); assert.equal(opened, 0); assert.equal(destroyed, 1);
  });
}

for (const fromMenu of [true, false]) {
  test(`retornar de um cadastro preserva a origem ${fromMenu ? 'no seletor' : 'direta'}`, async t => {
    const h = harness(t, { response: payload => ({ status: 'processed',
      activeFlow: payload.replyId === 'action_register_supply_group'
        ? { id: 'supply_group_registration', title: 'CADASTRAR GRUPO', contextId: 'synthetic-group' }
        : { id: 'menu:supplies', title: 'SUPRIMENTOS', contextId: 'synthetic-supplies' },
      messages: [{ role: 'assistant', type: 'poll', question: payload.replyId === 'action_register_supply_group' ? 'NOME DO GRUPO?' : 'SUPRIMENTOS\nQUAL FLUXO VOCÊ DESEJA INICIAR?', options: [] }],
    }) });
    await h.controller.start();
    if (fromMenu) {
      await h.view.emit('select-reply', { replyId: 'action_registration_hub' });
      await h.panels[0].onSelect('group');
    } else await h.view.emit('select-reply', { replyId: 'action_group_gallery' });
    const child = h.doc.querySelector('[data-gallery-kind="group"]');
    child.querySelector('[data-gallery-create]').click(); await tick(); await tick();
    assert.equal(h.requests.at(-1).replyId, 'action_register_supply_group');
    assert.equal(h.store.getState().activeFlow?.id, 'supply_group_registration');
    assert.equal(child.hidden, true);
    await h.view.emit('select-reply', { replyId: 'navigation_back', label: 'VOLTAR' });
    assert.equal(child.hidden, false);
    child.querySelector('[data-action="registration-close"]').click(); await tick(); await tick();
    assert.equal(h.doc.querySelector('.registration-gallery-menu')?.hidden === false, fromMenu);
  });
}

test('falha da fábrica filha restaura o seletor visível com nova tentativa', async t => {
  let attempts = 0;
  const h = harness(t, { factory: async options => {
    if (options.kind === 'registrationMenu') {
      const { createRegistrationGalleryMenu } = await import('../src/ui/registration-gallery-menu.js');
      return createRegistrationGalleryMenu({ ...options, document: h.doc });
    }
    if (++attempts === 1) throw new Error('synthetic factory error');
    return createRegistrationGallery({ ...options, document: h.doc });
  } });
  await h.controller.start(); await h.view.emit('select-reply', { replyId: 'action_registration_hub' });
  await h.panels[0].onSelect('group');
  assert.equal(h.doc.querySelector('.registration-gallery-menu').hidden, false);
  assert.match(h.doc.querySelector('[role="status"]').textContent, /Tente novamente/);
  await h.panels[0].onSelect('group');
  assert.equal(h.doc.querySelector('[data-gallery-kind="group"]').hidden, false);
});

test('menu de cadastros atrasado é descartado quando a sessão termina', async t => {
  let finish, opened = 0, destroyed = 0;
  const h = harness(t, { factory: () => new Promise(resolve => { finish = resolve; }) });
  await h.controller.start(); const pending = h.view.emit('select-reply', { replyId: 'action_registration_hub' }); await tick();
  assert.equal(typeof finish, 'function'); h.controller.stop();
  finish({ open() { opened++; }, destroy() { destroyed++; } });
  assert.equal(await pending, false); assert.equal(opened, 0); assert.equal(destroyed, 1);
});

test('falha ao abrir permite nova tentativa e Escape devolve o foco ao atalho', async t => {
  const { createRegistrationGalleryMenu } = await import('../src/ui/registration-gallery-menu.js');
  const dom = new JSDOM('<button id="origin">Galeria de Cadastros</button>'); const doc = dom.window.document;
  let attempts = 0, finish;
  const menu = createRegistrationGalleryMenu({ document: doc, onSelect: () => {
    attempts++; return attempts === 1 ? Promise.reject(new Error('synthetic failure')) : new Promise(resolve => { finish = resolve; });
  } });
  t.after(() => { menu.destroy(); dom.window.close(); });
  doc.querySelector('#origin').focus(); menu.open();
  const button = doc.querySelector('[data-registration-gallery="product"]');
  button.click(); await tick();
  assert.match(doc.querySelector('[role="status"]').textContent, /Tente novamente/); assert.equal(button.disabled, false);
  button.click(); button.click(); assert.equal(attempts, 2); finish(true); await tick();
  assert.equal(doc.activeElement.id, 'origin'); menu.open();
  doc.querySelector('.registration-gallery-menu').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(doc.activeElement.id, 'origin');
});
