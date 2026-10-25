import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const parent = id => ({ id, hasAttachments: false, fields: { ID: Number(id), FORNECEDOR: `GRUPO FICTÍCIO ${id}`,
  STATUS: 'PAGAMENTO PREVISTO', VALORTOTAL: '999', DATAPREVISTOPGTO: '2026-11-01' } });
const child = (id, group, fields = {}) => ({ id, fields: { ID: Number(id), field_23: group, FORNECEDOR: `FORNECEDOR FICTÍCIO ${id}`,
  QTD: '2', VALORTOTAL: '1.000,50', FRETE: '10', STATUS: 'PAGAMENTO PREVISTO',
  DESCRICAOPGTO: 'Material fictício', 'DATA PREVISTO PGTO': '2026-10-21T00:00:00Z', ...fields } });
const result = id => ({ description: { id, fields: {} }, provisions: [child('350', id)] });

async function setup(t, { parents = Array.from({ length: 21 }, (_, index) => parent(String(index + 1))),
  childPages, loadGroup, attachments, assertSession, timeoutMs } = {}) {
  const dom = new JSDOM('<!doctype html><button id="outside">Fora</button>', { url: 'https://example.test' });
  const doc = dom.window.document, writes = [], reads = [];
  const pages = childPages || [
    { items: [child('350', '21'), child('999', '20')], hasMore: true, nextLink: 'children-next' },
    { items: [child('371', '21', { QTD: '1', VALORTOTAL: '20', FRETE: '0', STATUS: 'PAGO' })], hasMore: false },
  ];
  const write = (...args) => { writes.push(args); throw new Error('Esta consulta não deve gravar.'); };
  const repository = {
    async resolveList(_site, aliases) {
      if (aliases.includes('DESCRITIVOPROVISAO')) return { status: 'resolved', id: 'parents' };
      if (aliases.includes('PROVISÃO PGTOS')) return { status: 'resolved', id: 'children' };
      return { status: 'missing' };
    },
    async getColumns(_site, list) { return list === 'children'
      ? [{ name: 'field_23', displayName: 'Descritivo Provisão', text: {} }]
      : [{ name: 'FORNECEDOR', text: {} }, { name: 'DATAPREVISTOPGTO', displayName: 'DATA PREVISTO PGTO', dateTime: {} }]; },
    async getItem(_site, list, id) { reads.push(['item', list, id]); return structuredClone(parents.find(row => row.id === id)); },
    async getItemsPage(_site, list, _query, options) {
      reads.push(['page', list, options]);
      return structuredClone(list === 'parents' ? { items: parents, hasMore: false } : pages[options.pageNumber - 1]);
    },
    async listAttachments() { return attachments ? attachments.promise : []; },
    updateItem: write, createItem: write, deleteItem: write, uploadAttachment: write,
  };
  const actualData = createRegistrationGalleryData({ kind: 'provisionDescription', repository, assertSession });
  const data = { ...actualData, getFilterSource: () => null, ...(loadGroup ? { loadDescriptionGroup: loadGroup } : {}) };
  const gallery = createRegistrationGallery({ document: doc, kind: 'provisionDescription', data,
    descriptionTimeoutMs: timeoutMs });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const root = doc.querySelector('[data-gallery-kind="provisionDescription"]');
  return { dom, doc, root, gallery, actualData, writes, reads,
    trigger: (id = '21') => root.querySelector(`[data-registration-row="${id}"] [data-action="description-provisions"]`),
    dialog: () => root.querySelector('[data-provision-description-detail]') };
}
async function open(ctx, id = '21') {
  if (!ctx.trigger(id)) { ctx.root.querySelector('.rg-pagination > button:last-child').click(); }
  const trigger = ctx.trigger(id); assert.ok(trigger, 'o cartão deve oferecer o cluster de provisões vinculadas');
  trigger.focus(); trigger.click(); await settle(); assert.ok(ctx.dialog(), 'o cluster abre o detalhamento'); return trigger;
}

test('ID fica antes do fornecedor e o cluster abre todos os filhos, inclusive pagos e outra página, sem gravar', async t => {
  const ctx = await setup(t);
  const sort = ctx.root.querySelector('[data-gallery-sort]'); sort.value = 'ID:asc'; sort.dispatchEvent(new ctx.dom.window.Event('change'));
  ctx.root.querySelector('.rg-pagination > button:last-child').click();
  const card = ctx.root.querySelector('[data-registration-row="21"]');
  const heading = card.querySelector('.rg-provision-heading');
  const badge = heading.querySelector('.rg-provision-id-cluster');
  assert.ok(badge, 'a identificação deve ser um cluster próprio');
  assert.equal(badge.querySelector('strong').textContent, '21');
  assert.equal(heading.firstElementChild, badge, 'ID deve vir à esquerda do fornecedor');
  const trigger = await open(ctx);
  assert.match(trigger.textContent, /Provisões vinculadas.*Ver detalhamento/s);
  assert.deepEqual([...ctx.dialog().querySelectorAll('[data-provision-id]')].map(node => node.dataset.provisionId), ['350', '371']);
  assert.match(ctx.dialog().textContent, /PAGO/);
  assert.match(ctx.dialog().textContent, /20\/10\/2026/);
  assert.match(ctx.dialog().querySelector('[data-description-total]').textContent.replace(/\s/g, ''), /R\$2\.031,00/);
  assert.equal(ctx.dialog().querySelectorAll('input,select,textarea,[data-gallery-action]').length, 0);
  assert.deepEqual(ctx.writes, []);
  ctx.dialog().querySelector('[data-action="close-description"]').click();
  assert.equal(ctx.root.querySelector('.rg-pagination span').textContent, 'Página 2 de 2');
  assert.equal(ctx.doc.activeElement, trigger);
});

test('fechar preserva pesquisa, filtros e ordenação do pai', async t => {
  const ctx = await setup(t);
  const search = ctx.root.querySelector('.gallery-quick-search');
  search.value = 'GRUPO FICTÍCIO 21'; search.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  const sort = ctx.root.querySelector('[data-gallery-sort]'); sort.value = 'ID:desc'; sort.dispatchEvent(new ctx.dom.window.Event('change'));
  const trigger = await open(ctx);
  ctx.dialog().querySelector('[data-action="close-description"]').click();
  assert.equal(search.value, 'GRUPO FICTÍCIO 21'); assert.equal(sort.value, 'ID:desc');
  assert.equal(ctx.root.querySelectorAll('[data-registration-row]').length, 1);
  assert.equal(ctx.doc.activeElement, trigger);
});

test('metadados não transformam página inválida em grupo vazio confirmado', async t => {
  const ctx = await setup(t, { childPages: [{ items: null, hasMore: false }] });
  await open(ctx);
  assert.ok(ctx.dialog().querySelector('[role="alert"]'));
  assert.equal(ctx.dialog().querySelector('[data-description-total]'), null);
});

for (const [shape, item] of [
  ['ausentes', { id: '350' }],
  ['nulos', { id: '350', fields: null }],
  ['lista', { id: '350', fields: [] }],
  ['texto', { id: '350', fields: 'inválido' }],
  ['número', { id: '350', fields: 42 }],
]) {
  test(`campos ${shape} não são convertidos em grupo vazio pelo adaptador de metadados`, async t => {
    const ctx = await setup(t, { childPages: [{ items: [item], hasMore: false }] });
    await open(ctx);
    assert.ok(ctx.dialog().querySelector('[role="alert"]'));
    assert.equal(ctx.dialog().querySelector('[data-description-total]'), null);
    assert.doesNotMatch(ctx.dialog().textContent, /Nenhuma provisão vinculada/);
  });
}

test('grupo realmente vazio exibe zero e não inventa provisões', async t => {
  const ctx = await setup(t, { childPages: [{ items: [], hasMore: false }] }); await open(ctx);
  assert.match(ctx.dialog().textContent, /Nenhuma provisão vinculada/);
  assert.match(ctx.dialog().querySelector('[data-description-total]').textContent.replace(/\s/g, ''), /R\$0,00/);
});

test('falha e nova tentativa mantêm o pai selecionado sem divulgar o erro técnico', async t => {
  let calls = 0; const ctx = await setup(t, { loadGroup: async id => {
    if (++calls === 1) throw new Error('private-token http://private.example'); return result(id);
  } }); await open(ctx);
  assert.ok(ctx.dialog().querySelector('[role="alert"]')); assert.doesNotMatch(ctx.dialog().textContent, /private/);
  ctx.dialog().querySelector('[data-action="retry-description"]').click(); await settle();
  assert.ok(ctx.dialog().querySelector('[data-provision-id="350"]')); assert.equal(calls, 2);
});

test('redesenho por contagem de anexos não fecha o detalhe e restaura foco no novo botão', async t => {
  const attachments = pending();
  const ctx = await setup(t, { parents: [{ ...parent('21'), hasAttachments: true }], attachments });
  const oldTrigger = await open(ctx);
  attachments.resolve([]); await settle(); await settle();
  assert.equal(oldTrigger.isConnected, false, 'a contagem de anexos redesenhou o cartão');
  assert.ok(ctx.dialog().querySelector('[data-provision-id="350"]'));
  ctx.dialog().querySelector('[data-action="close-description"]').click();
  assert.equal(ctx.doc.activeElement, ctx.trigger());
});

for (const action of ['close', 'reopen', 'destroy']) {
  test(`${action} encerra a consulta e não permite que resposta antiga reabra o detalhe`, async t => {
    const request = pending(); let signal;
    const ctx = await setup(t, { loadGroup: (_id, options) => { signal = options.signal; return request.promise; } });
    await open(ctx); assert.ok(ctx.dialog().querySelector('.app-loading__mascot'));
    if (action === 'reopen') await ctx.gallery.open();
    else ctx.gallery[action]();
    assert.equal(signal.aborted, true); request.resolve(result('21')); await settle(); assert.equal(ctx.dialog(), null);
  });
}

test('Atualizar permanece bloqueado durante o detalhe e volta a funcionar ao fechar', async t => {
  const ctx = await setup(t); await open(ctx); await settle();
  const refresh = ctx.root.querySelector('[data-action="registration-refresh"]');
  assert.equal(refresh.disabled, true);
  ctx.dialog().querySelector('[data-action="close-description"]').click(); await settle();
  assert.equal(refresh.disabled, false);
  const before = ctx.reads.filter(([type, list]) => type === 'page' && list === 'parents').length;
  refresh.click(); await settle();
  assert.equal(ctx.reads.filter(([type, list]) => type === 'page' && list === 'parents').length, before + 1);
});

test('teclado fecha só o detalhe, mantém a galeria aberta e devolve o foco', async t => {
  const ctx = await setup(t), trigger = await open(ctx);
  const close = ctx.dialog().querySelector('[data-action="close-description"]'); close.focus();
  close.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(ctx.doc.activeElement, close);
  close.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(ctx.dialog(), null); assert.equal(ctx.root.hidden, false); assert.equal(ctx.doc.activeElement, trigger);
});

test('prazo excedido permite fechar e ignora resposta tardia', async t => {
  const request = pending(); const ctx = await setup(t, { loadGroup: () => request.promise, timeoutMs: 10 });
  await open(ctx); await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(ctx.dialog().querySelector('[role="alert"]'));
  request.resolve(result('21')); await settle(); assert.equal(ctx.dialog().querySelector('[data-provision-id]'), null);
});

test('sessão expirada não revela o grupo nem inicia leitura do descritivo', async t => {
  let expired = false; const ctx = await setup(t, { assertSession: () => { if (expired) throw new Error('expired private'); } });
  expired = true; await open(ctx);
  assert.ok(ctx.dialog().querySelector('[role="alert"]')); assert.equal(ctx.reads.some(([type]) => type === 'item'), false);
});

test('ID não positivo não produz botão ativo ou consulta adivinhada', async t => {
  const ctx = await setup(t, { parents: [parent('0')] });
  const trigger = ctx.trigger('0'); assert.ok(trigger); assert.equal(trigger.disabled, true); trigger.click();
  assert.equal(ctx.dialog(), null); assert.equal(ctx.reads.some(([type]) => type === 'item'), false);
});
