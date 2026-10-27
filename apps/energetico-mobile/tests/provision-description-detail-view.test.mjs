import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createPaymentProgrammingGalleryData } from '../src/chat/orders-gallery-data.js';
import { createPaymentProgrammingGallery } from '../src/ui/payment-programming-gallery-view.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const pending = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const row = (id, parent = '42', fields = {}) => ({ id, hasAttachments: false, fields: {
  ID: Number(id), DESCRITIVOPROVISAO: parent, FORNECEDOR: `FORNECEDOR FICTÍCIO ${id}`,
  DESCRICAOPGTO: `MATERIAL ${id}`, STATUS: 'PAGAMENTO PREVISTO', QTD: '3', VALORTOTAL: '2', FRETE: '1',
  'DATA PREVISTO PGTO': '2026-10-30', FILIAL: '004', IMOVEL: 'TODOS', 'Tem anexos': false, ...fields,
} });
const group = (id = '42', provisions = [row('350', id)]) => ({ description: {
  id, fields: { ID: Number(id), FORNECEDOR: 'GRUPO FICTÍCIO', OBS: 'Observação do descritivo' },
}, provisions });

async function setup(t, { rows, columns, loadGroup, timeoutMs = 30_000 } = {}) {
  const dom = new JSDOM('<button id="outside">Fora da galeria</button>', { url: 'https://example.test' });
  const doc = dom.window.document;
  const source = rows || [
    ...Array.from({ length: 12 }, (_, index) => row(String(100 + index), index === 1 ? '99' : '42')),
    row('500', '42', { STATUS: 'PAGO', QTD: '2', VALORTOTAL: '10', FRETE: '3' }),
  ];
  const writes = [];
  const write = (...args) => { writes.push(args); throw new Error('Não deve gravar'); };
  const repository = {
    async resolveList(_site, aliases) { return { status: 'resolved', id: aliases.includes('DESCRITIVOPROVISAO') ? 'parents' : 'children' }; },
    async getColumns() { return columns || [{ name: 'DESCRITIVOPROVISAO', text: {} }]; },
    async getItem(_site, _list, id) { return { id, fields: { ID: Number(id), FORNECEDOR: 'GRUPO FICTÍCIO', OBS: 'Observação do descritivo', VALORTOTAL: '999' } }; },
    async getItemsPage(_site, _list, _query, { pageNumber }) { return { items: structuredClone(source.slice((pageNumber - 1) * 7, pageNumber * 7)),
      hasMore: pageNumber * 7 < source.length, nextLink: pageNumber * 7 < source.length ? `page-${pageNumber + 1}` : '' }; },
    updateItem: write, createItem: write, deleteItem: write, uploadAttachment: write,
  };
  const realData = createPaymentProgrammingGalleryData({ repository });
  const data = loadGroup ? { ...realData, loadDescriptionGroup: loadGroup } : realData;
  const gallery = createPaymentProgrammingGallery({ document: doc, data, descriptionTimeoutMs: timeoutMs,
    now: () => new Date('2026-10-25T12:00:00Z') });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const root = doc.querySelector('.pg-overlay');
  return { dom, doc, gallery, root, source, writes,
    trigger: id => root.querySelector(`.pg-card[data-item-id="${id}"] [data-action="description-provisions"]`),
    dialog: () => root.querySelector('[role="dialog"][data-provision-description-detail]') };
}

async function open(ctx, id = '100') {
  const trigger = ctx.trigger(id);
  assert.ok(trigger, 'o cartão deve oferecer o bloco clicável do descritivo');
  trigger.focus(); trigger.click(); await settle();
  assert.ok(ctx.dialog(), 'o bloco deve abrir o detalhamento');
  return trigger;
}
const close = ctx => ctx.dialog().querySelector('[data-action="close-description"]').click();

test('resumos expansíveis abrem somente o primeiro e alternam sem consultar ou gravar novamente', async t => {
  let reads = 0;
  const ctx = await setup(t, { loadGroup: async id => {
    reads++;
    return group(id, [
      row('350', id, { FORNECEDOR: 'EDGAR NELSON DA SILVA', OBS: 'Observação preservada', IDFOLHA: '81', 'DATA PGTO EFETUADO': '2026-10-29' }),
      row('371', id, { FORNECEDOR: 'MAURICIO HONORATO DE SOUZA', QTD: '2', VALORTOTAL: '10', FRETE: '3', STATUS: 'PENDENTE' }),
      row('372', id, { STATUS: 'SUSPENSO' }),
    ]);
  } });
  await open(ctx);
  const buttons = [...ctx.dialog().querySelectorAll('[data-action="toggle-provision-detail"]')];
  assert.equal(buttons.length, 3, 'cada provisão oferece um controle expansível');
  const panel = button => ctx.doc.getElementById(button.getAttribute('aria-controls'));
  assert.deepEqual(buttons.map(button => button.getAttribute('aria-expanded')), ['true', 'false', 'false']);
  assert.deepEqual(buttons.map(button => panel(button).hidden), [false, true, true]);
  assert.match(buttons[0].textContent, /EDGAR NELSON DA SILVA/);
  assert.match(buttons[1].textContent.replace(/\s/g, ''), /30\/10.*R\$23,00.*PENDENTE/s);
  assert.match(panel(buttons[0]).textContent, /81/);
  assert.match(panel(buttons[0]).textContent, /29\/10\/2026/);
  assert.match(panel(buttons[0]).textContent, /Observação preservada/);
  buttons[1].focus(); buttons[1].click();
  assert.deepEqual(buttons.map(button => button.getAttribute('aria-expanded')), ['false', 'true', 'false']);
  assert.deepEqual(buttons.map(button => panel(button).hidden), [true, false, true]);
  assert.equal(ctx.doc.activeElement, buttons[1], 'alternar preserva o foco no controle acionado');
  buttons[1].click();
  assert.ok(buttons.every(button => panel(button).hidden), 'o item aberto pode ser recolhido');
  buttons[2].click();
  assert.equal(panel(buttons[2]).hidden, false);
  assert.equal(reads, 1, 'expandir usa os dados já carregados');
  assert.deepEqual(ctx.writes, []);
  close(ctx); await open(ctx);
  assert.deepEqual([...ctx.dialog().querySelectorAll('[data-action="toggle-provision-detail"]')].map(button => button.getAttribute('aria-expanded')), ['true', 'false', 'false']);
});

test('cluster real abre todas as provisões do vínculo apesar da pesquisa, página e status da galeria', async t => {
  const ctx = await setup(t);
  assert.equal(ctx.root.querySelectorAll('.pg-card').length, 10);
  const search = ctx.root.querySelector('[name="search"]');
  search.value = '111'; search.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  assert.equal(ctx.root.querySelectorAll('.pg-card').length, 1);
  const trigger = await open(ctx, '111');
  const dialog = ctx.dialog();
  assert.match(trigger.closest('.pg-description-cluster').textContent, /Descritivo da provisão.*42/s);
  assert.match(dialog.getAttribute('aria-label'), /42/);
  assert.equal(dialog.querySelectorAll('[data-provision-id]').length, 12);
  assert.ok(dialog.querySelector('[data-provision-id="100"]'), 'linha fora da página/filtro também aparece');
  assert.match(dialog.querySelector('[data-provision-id="500"]').textContent, /PAGO/);
  assert.equal(dialog.querySelector('[data-provision-id="101"]'), null, 'outro descritivo não se mistura');
  assert.match(dialog.querySelector('[data-description-total]').textContent.replace(/\s/g, ''), /R\$100,00/);
  assert.match(dialog.querySelector('[data-provision-id="500"]').textContent.replace(/\s/g, ''), /R\$23,00/);
  assert.equal(dialog.querySelectorAll('input,select,textarea,.gallery-record-action').length, 0);
  assert.deepEqual(ctx.writes, []);
  close(ctx);
  assert.equal(ctx.dialog(), null);
  assert.equal(search.value, '111');
  assert.equal(ctx.doc.activeElement, trigger);
});

test('vínculo vazio ou inválido fica identificado sem botão que adivinhe um descritivo', async t => {
  const ctx = await setup(t, { rows: ['', '0', '42abc'].map((parent, index) => row(String(200 + index), parent)) });
  for (const card of ctx.root.querySelectorAll('.pg-card')) {
    assert.match(card.textContent, /Descritivo da provisão/);
    assert.equal(card.querySelector('[data-action="description-provisions"]'), null);
    assert.match(card.textContent, /Não vinculado/);
  }
});

test('metadado de coluna opaca mantém o cluster clicável desde a leitura da galeria até o detalhe', async t => {
  const source = row('350', undefined, { field_23: '42' });
  delete source.fields.DESCRITIVOPROVISAO;
  const original = structuredClone(source);
  const ctx = await setup(t, { rows: [source], columns: [
    { name: 'field_23', displayName: 'Descritivo Provisão', text: {} },
  ] });
  await open(ctx, '350');
  assert.match(ctx.dialog().getAttribute('aria-label'), /#42$/);
  assert.ok(ctx.dialog().querySelector('[data-provision-id="350"]'));
  assert.deepEqual(source, original, 'normalizar não altera campos ou registros da origem');
  assert.deepEqual(ctx.writes, []);
});

test('carregamento tem mascote e fechamento disponível; cancelar aborta e descarta a resposta', async t => {
  const request = pending(); let signal;
  const ctx = await setup(t, { loadGroup: (_id, options) => { signal = options.signal; return request.promise; } });
  await open(ctx);
  assert.equal(ctx.dialog().getAttribute('aria-busy'), 'true');
  assert.ok(ctx.dialog().querySelector('.app-loading__mascot'));
  assert.equal(ctx.dialog().querySelector('[data-action="close-description"]').disabled, false);
  close(ctx); assert.equal(signal.aborted, true);
  request.resolve(group()); await settle();
  assert.equal(ctx.dialog(), null);
});

test('falha remove dados antigos e nova tentativa carrega o mesmo descritivo sem expor detalhes técnicos', async t => {
  let attempts = 0;
  const ctx = await setup(t, { loadGroup: async id => {
    if (++attempts === 1) throw new Error('Bearer private-value https://private.example/details');
    return group(id);
  } });
  await open(ctx);
  assert.ok(ctx.dialog().querySelector('[role="alert"]'));
  assert.equal(/private-value|private\.example/.test(ctx.dialog().textContent), false);
  assert.equal(ctx.dialog().querySelector('[data-provision-id]'), null);
  ctx.dialog().querySelector('[data-action="retry-description"]').click(); await settle();
  assert.equal(attempts, 2);
  assert.ok(ctx.dialog().querySelector('[data-provision-id="350"]'));
});

test('grupo realmente vazio apresenta zero e mensagem explícita', async t => {
  const ctx = await setup(t, { loadGroup: async id => group(id, []) });
  await open(ctx);
  assert.match(ctx.dialog().textContent, /Nenhuma provisão vinculada/);
  assert.match(ctx.dialog().querySelector('[data-description-total]').textContent.replace(/\s/g, ''), /R\$0,00/);
});

test('identidade de descritivo divergente vira erro e não lista de outro grupo', async t => {
  const ctx = await setup(t, { loadGroup: async () => group('99') });
  await open(ctx);
  assert.ok(ctx.dialog().querySelector('[role="alert"]'));
  assert.equal(ctx.dialog().querySelector('[data-provision-id]'), null);
});

test('nova consulta a outro grupo não é substituída pela primeira resposta atrasada', async t => {
  const first = pending(); let firstSignal;
  const ctx = await setup(t, { loadGroup: (id, options) => {
    if (id === '42') { firstSignal = options.signal; return first.promise; }
    return Promise.resolve(group(id, [row('999', id)]));
  } });
  await open(ctx);
  // Native inert prevents this user action; programmatic clicks exercise a replacement request.
  const other = [...ctx.root.querySelectorAll('[data-action="description-provisions"]')].find(button => /#99$/.test(button.getAttribute('aria-label')));
  assert.ok(other); other.click(); await settle();
  assert.equal(firstSignal.aborted, true);
  first.resolve(group('42')); await settle();
  assert.match(ctx.dialog().getAttribute('aria-label'), /99/);
  assert.ok(ctx.dialog().querySelector('[data-provision-id="999"]'));
  assert.equal(ctx.dialog().querySelector('[data-provision-id="350"]'), null);
});

test('fechar e reabrir o mesmo ID não permite que a primeira resposta pinte na nova abertura', async t => {
  const first = pending(); let calls = 0;
  const ctx = await setup(t, { loadGroup: id => ++calls === 1 ? first.promise : Promise.resolve(group(id, [row('777', id)])) });
  await open(ctx); close(ctx); await open(ctx);
  first.resolve(group('42', [row('888', '42')])); await settle();
  assert.ok(ctx.dialog().querySelector('[data-provision-id="777"]'));
  assert.equal(ctx.dialog().querySelector('[data-provision-id="888"]'), null);
});

for (const action of ['close', 'reload', 'destroy']) {
  test(`${action} da galeria encerra o detalhe e impede ressurreição por resposta atrasada`, async t => {
    const request = pending(); let signal;
    const ctx = await setup(t, { loadGroup: (_id, options) => { signal = options.signal; return request.promise; } });
    await open(ctx);
    await ctx.gallery[action]();
    assert.equal(signal.aborted, true);
    request.resolve(group()); await settle();
    assert.equal(ctx.dialog(), null);
  });
}

test('teclado fica no diálogo e Escape restaura foco e fundo sem fechar a galeria', async t => {
  const ctx = await setup(t);
  const trigger = await open(ctx);
  const dialog = ctx.dialog(), button = dialog.querySelector('[data-action="close-description"]');
  assert.equal(ctx.root.querySelector('.pg-body').inert, true);
  assert.equal(ctx.root.querySelector('.pg-body').getAttribute('aria-hidden'), 'true');
  ctx.doc.querySelector('#outside').focus();
  assert.equal(ctx.doc.activeElement, button);
  button.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  const toggles = [...dialog.querySelectorAll('[data-action="toggle-provision-detail"]')];
  assert.ok(toggles.length > 1);
  toggles.at(-1).focus();
  toggles.at(-1).dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal(ctx.doc.activeElement, button);
  button.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(ctx.doc.activeElement, toggles.at(-1));
  dialog.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  assert.equal(ctx.dialog(), null);
  assert.equal(ctx.root.hidden, false);
  assert.equal(ctx.doc.activeElement, trigger);
  assert.equal(ctx.root.querySelector('.pg-body').inert, false);
  assert.equal(ctx.root.querySelector('.pg-body').hasAttribute('aria-hidden'), false);
});

test('prazo excedido mantém fechar/repetir e ignora o resultado antigo mesmo se ele não respeitar abort', async t => {
  const first = pending(); let calls = 0;
  const ctx = await setup(t, { timeoutMs: 10, loadGroup: id => ++calls === 1 ? first.promise : Promise.resolve(group(id, [row('777', id)])) });
  await open(ctx);
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.match(ctx.dialog().querySelector('[role="alert"]').textContent, /demorou/i);
  assert.equal(ctx.dialog().getAttribute('aria-busy'), 'false');
  first.resolve(group('42', [row('888')])); await settle();
  assert.equal(ctx.dialog().querySelector('[data-provision-id]'), null);
  ctx.dialog().querySelector('[data-action="retry-description"]').click(); await settle();
  assert.ok(ctx.dialog().querySelector('[data-provision-id="777"]'));
});

test('texto de origem é literal, sem HTML executável no detalhamento', async t => {
  const text = '<img src=x onerror="alert(1)"><script>bad()</script>';
  const ctx = await setup(t, { loadGroup: async id => group(id, [row('350', id, { FORNECEDOR: text, OBS: text })]) });
  await open(ctx);
  assert.ok(ctx.dialog().textContent.includes(text));
  assert.equal(ctx.dialog().querySelector('img,script'), null);
});

test('valor inválido não é somado silenciosamente como zero', async t => {
  const ctx = await setup(t, { loadGroup: async id => group(id, [row('350', id, { VALORTOTAL: 'não informado' })]) });
  await open(ctx);
  assert.match(ctx.dialog().querySelector('[data-description-total]').textContent, /Não informado/);
  assert.equal(ctx.dialog().querySelector('[data-description-total]').textContent.includes('R$'), false);
});
