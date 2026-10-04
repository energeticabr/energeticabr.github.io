import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

// Load inside the harness so the first RED run reports the missing feature as
// an assertion, and still exercises the actual exported UI in every test.
async function setup(t, overrides = {}) {
  const module = await import('../src/ui/launch-gallery-view.js').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && error.message.includes('launch-gallery-view.js')) return {};
    throw error;
  });
  assert.equal(typeof module.createLaunchGallery, 'function', 'createLaunchGallery must be implemented');
  const dom = new JSDOM('<button id="origin">Galeria</button><main id="chat"></main>', { url: 'https://example.test' });
  const document = dom.window.document;
  const calls = [];
  const request = async (operation, payload, options) => {
    calls.push({ operation, payload });
    return overrides.request ? overrides.request(operation, payload, options) : operation === 'snapshot' ? snapshot() : detail();
  };
  const loadLaunchGroup = overrides.loadLaunchGroup || (async (groupId, { signal } = {}) => {
    const result = await request('snapshot', { filters: { grouping: groupId }, page: 1, pageSize: 20 }, { signal });
    return (result.rows || []).filter(item => String(item.fields?.AGRUPAR ?? '').trim() === String(groupId));
  });
  const gallery = module.createLaunchGallery({ document, request, ...overrides, loadLaunchGroup, request });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  return { dom, document, gallery, calls, root: () => document.querySelector('.lg-overlay') };
}

const sorts = ['MAIOR ID', 'MAIOR DATA', 'MAIOR DATA PGTO PREVISTO', 'MAIOR DATA PGTO EFETUADO',
  'CRIADO MAIS RECENTE', 'CRIADO MAIS ANTIGO', 'MODIFICADO MAIS RECENTE', 'MODIFICADO MAIS ANTIGO'];
const row = (id = 17) => ({ id, total: 85, hasAttachments: true, fields: {
  DATA: '2026-09-17', FORNECEDOR: 'Fornecedor A', PRODUTO: 'Cimento', FILIAL: 'Obra A',
  QUANTIDADE: 2.5, UN: 'SC', 'VALOR UNITÁRIO': 30, FRETE: 10, CONCLUÍDO: 'PEDIDO EMPENHADO',
  DESCRIÇÃO: '<p>Primeira &amp; segunda</p><p>Linha 2</p><script>unsafe()</script><img src=x onerror=unsafe()>',
  Modified: '2026-09-18T12:34:56Z', ASSINATURA: '',
} });
const snapshot = (overrides = {}) => ({ rows: [row()], count: 1, page: 1, pageSize: 20, pages: 1,
  totals: { committed: 85, liquidated: 25, pending: 15, paid: 10, total: 135 },
  filterOptions: { branch: ['Obra A', 'Obra B'], supplier: ['Fornecedor A'], status: ['PEDIDO EMPENHADO'],
    product: ['Cimento'], stage: ['Fundação'], contract: ['Contrato 1'] }, sortOptions: sorts, ...overrides });
const detail = (overrides = {}) => ({ item: row(), attachments: [{ fileName: 'um.pdf' }, { fileName: 'dois.png' }],
  editFields: [
    { name: 'QUANTIDADE', label: 'Quantidade', type: 'number', required: true },
    { name: 'DESCRIÇÃO', label: 'Descrição', type: 'textarea' },
    { name: 'CONCLUÍDO', label: 'Situação', type: 'select', options: [
      { value: 'PEDIDO EMPENHADO', label: 'Empenhado' }, { value: 'PEDIDO FINALIZADO', label: 'Finalizado' }] },
  ], measurementFields: [
    { name: 'DATA', label: 'Data da medição', type: 'date', required: true },
    { name: 'QUANTIDADE', label: 'Quantidade medida', type: 'number', required: true },
    { name: 'CONFERIDO', label: 'Conferido', type: 'boolean' },
  ], ...overrides });
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function button(root, text) {
  const found = [...root.querySelectorAll('button')].find(node => node.textContent.trim() === text && !node.closest('[hidden]'));
  assert.ok(found, `visible button: ${text}`);
  return found;
}
function input(ctx, name, value, parent = ctx.root()) {
  const field = parent.querySelector(`[name="${name}"]`);
  assert.ok(field, `field: ${name}`);
  if (field.type === 'checkbox') field.checked = value;
  else field.value = value;
  field.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  field.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  return field;
}
function selectAttachment(ctx, file) {
  const picker = ctx.root().querySelector('.lg-attachments input[type="file"]');
  assert.ok(picker, 'file picker below the current attachments');
  Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
  picker.dispatchEvent(new ctx.dom.window.Event('change', { bubbles: true }));
  return picker;
}
async function showDetail(ctx) {
  const card = ctx.root().querySelector('.lg-record');
  assert.ok(card?.querySelector('[data-gallery-action="edit"]'), 'launch pencil');
  card.querySelector('[data-gallery-action="edit"]').click(); await settle();
}
const mutations = ctx => ctx.calls.filter(({ operation }) => !['snapshot', 'detail', 'attachment'].includes(operation));

test('the launch pencil opens a searchable editing form without a separate details action', async t => {
  const ctx = await setup(t, { request: async operation => operation === 'snapshot' ? snapshot() : detail({
    editFields: [
      { name: 'FORNECEDOR', label: 'Fornecedor', type: 'select', options: [
        { value: 'Fornecedor A', label: 'Fornecedor A' },
        { value: 'Fornecedor B', label: 'Fornecedor B' },
      ] },
      { name: 'QUANTIDADE', label: 'Quantidade', type: 'number' },
    ],
  }) });
  await ctx.gallery.open();
  const card = ctx.root().querySelector('.lg-record');
  assert.ok(card.querySelector('[data-gallery-action="delete"]'), 'red X next to pencil');
  assert.equal([...card.querySelectorAll('button')].some(control => control.textContent.trim() === 'Detalhes'), false);
  card.querySelector('[data-gallery-action="edit"]').click(); await settle();
  const editor = ctx.root().querySelector('.lg-detail .lg-editor');
  assert.ok(editor, 'the pencil opens the edit form directly');
  assert.equal(ctx.root().querySelector('.lg-detail .lg-data-table'), null);
  assert.equal(editor.querySelector('[name="QUANTIDADE"]').type, 'number');
  const supplier = editor.querySelector('[name="FORNECEDOR"]');
  assert.equal(supplier.tagName, 'SELECT');
  editor.querySelector('.sfs-trigger').click();
  const search = editor.querySelector('.sfs-search');
  search.value = 'fornecedor b';
  search.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  assert.deepEqual([...editor.querySelectorAll('.sfs-option')].map(option => option.textContent), ['Fornecedor B']);
  editor.querySelector('.sfs-option').click();
  assert.equal(supplier.value, 'Fornecedor B');
});

test('editing a launch replaces a selected option and submits the replacement', async t => {
  const item = row(); item.fields.ETAPA = 'ALVENARIA E ESTRUTURAS';
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item] }) : detail({ item, editFields: [{ name: 'ETAPA', label: 'Etapa', type: 'select', options: [
      { value: 'ALVENARIA E ESTRUTURAS', label: 'Alvenaria e estruturas' },
      { value: 'CONTABILIDADE', label: 'Contabilidade' },
    ] }] }) });
  await ctx.gallery.open(); await showDetail(ctx);
  const editor = ctx.root().querySelector('.lg-editor');
  const stage = editor.querySelector('[name="ETAPA"]');
  editor.querySelector('.sfs-trigger').click();
  const search = editor.querySelector('.sfs-search');
  search.value = 'contabilidade';
  search.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  const replacement = editor.querySelector('.sfs-option');
  replacement.dispatchEvent(new ctx.dom.window.MouseEvent('pointerdown', { bubbles: true }));
  search.dispatchEvent(new ctx.dom.window.FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
  replacement.dispatchEvent(new ctx.dom.window.MouseEvent('pointerup', { bubbles: true }));
  assert.equal(stage.value, 'CONTABILIDADE');
  assert.match(editor.querySelector('.sfs-trigger').value, /Contabilidade/);
  button(ctx.root(), 'SUBMETER').click();
  assert.match(ctx.root().querySelector('.lg-review').textContent, /Contabilidade/);
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.deepEqual(mutations(ctx), [{ operation: 'update', payload: {
    id: 17, fields: { ETAPA: 'CONTABILIDADE' }, confirm: true,
    expectedModified: '2026-09-18T12:34:56Z',
  } }]);
});

test('SUBMETER opens a modal table with only changed fields and saves only after confirmation', async t => {
  const ctx = await setup(t);
  const stylesheet = ctx.document.createElement('style');
  stylesheet.textContent = readFileSync(new URL('../src/ui/launch-gallery.css', import.meta.url), 'utf8');
  ctx.document.head.append(stylesheet);
  await ctx.gallery.open(); await showDetail(ctx);
  input(ctx, 'QUANTIDADE', '3');
  const editor = ctx.root().querySelector('.lg-editor');
  const submit = button(editor, 'SUBMETER');
  assert.deepEqual([...editor.querySelectorAll('.lg-editor-actions button')].map(node => node.textContent),
    ['Cancelar edição', 'SUBMETER']);
  submit.click();
  const popup = ctx.root().querySelector('.lg-review');
  assert.equal(popup.hidden, false);
  assert.equal(popup.getAttribute('role'), 'dialog');
  assert.equal(popup.getAttribute('aria-modal'), 'true');
  assert.equal(ctx.dom.window.getComputedStyle(popup).position, 'fixed');
  assert.deepEqual([...popup.querySelectorAll('thead th')].map(node => node.textContent), ['Campo', 'Antes', 'Depois']);
  assert.deepEqual([...popup.querySelectorAll('tbody tr')].map(row => [...row.cells].map(cell => cell.textContent)),
    [['Quantidade', '2.5', '3']]);
  assert.equal(mutations(ctx).length, 0);
  button(popup, 'Confirmar alterações').click(); await settle();
  assert.deepEqual(mutations(ctx).map(({operation, payload}) => [operation, payload.fields]),
    [['update', {QUANTIDADE: 3}]]);
});

test('modal review compares choice labels and dates without exposing unchanged fields', async t => {
  const ctx = await setup(t, {request: async operation => operation === 'snapshot' ? snapshot() : detail({editFields: [
    {name: 'CONCLUÍDO', label: 'Situação', type: 'select', options: [
      {value: 'PEDIDO EMPENHADO', label: 'Empenhado'}, {value: 'PEDIDO FINALIZADO', label: 'Finalizado'},
    ]},
    {name: 'DATA', label: 'Data', type: 'date'},
    {name: 'QUANTIDADE', label: 'Quantidade', type: 'number'},
  ]})});
  await ctx.gallery.open(); await showDetail(ctx);
  const form = ctx.root().querySelector('.lg-editor');
  form.querySelector('.sfs-trigger').click();
  [...form.querySelectorAll('.sfs-option')].find(node => node.textContent === 'Finalizado').click();
  input(ctx, 'DATA', '18/09/2026');
  button(form, 'SUBMETER').click();
  assert.deepEqual([...ctx.root().querySelectorAll('.lg-review tbody tr')].map(row => [...row.cells].map(cell => cell.textContent)), [
    ['Situação', 'Empenhado', 'Finalizado'],
    ['Data', '17/09/2026', '18/09/2026'],
  ]);
  assert.equal(mutations(ctx).length, 0);
});

test('cancel and Escape close only the review popup and preserve the edited draft', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open(); await showDetail(ctx);
  const draft = input(ctx, 'QUANTIDADE', '4');
  const submit = button(ctx.root(), 'SUBMETER');
  submit.click();
  button(ctx.root().querySelector('.lg-review'), 'Cancelar confirmação').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  assert.equal(draft.value, '4');
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, false);
  assert.equal(ctx.document.activeElement, submit);
  submit.click();
  ctx.root().querySelector('.lg-review').dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, false);
  assert.equal(draft.value, '4');
  assert.equal(mutations(ctx).length, 0);
});

test('Escape cannot dismiss a confirmation while its save is pending', async t => {
  const pending = deferred();
  const ctx = await setup(t, { request: async operation => {
    if (operation === 'snapshot') return snapshot();
    if (operation === 'detail') return detail();
    if (operation === 'update') return pending.promise;
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  input(ctx, 'QUANTIDADE', '4');
  button(ctx.root(), 'SUBMETER').click();
  const popup = ctx.root().querySelector('.lg-review');
  button(popup, 'Confirmar alterações').click();
  popup.dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(popup.hidden, false);
  pending.reject(new Error('Falha temporária'));
  await settle();
  assert.match(popup.querySelector('.lg-review-error').textContent, /Falha temporária/);
});

test('editor highlights only fields changed from the loaded launch and clears restored values', async t => {
  const ctx = await setup(t, {request: async operation => operation === 'snapshot' ? snapshot() : detail({editFields: [
    {name: 'QUANTIDADE', label: 'Quantidade', type: 'number'},
    {name: 'DATA', label: 'Data', type: 'date'},
  ]})});
  await ctx.gallery.open(); await showDetail(ctx);
  const form = ctx.root().querySelector('.lg-editor');
  const quantity = form.querySelector('[name="QUANTIDADE"]').closest('.lg-field');
  const date = form.querySelector('[name="DATA"]').closest('.lg-field');
  assert.equal(quantity.classList.contains('lg-field-modified'), false);
  assert.equal(date.classList.contains('lg-field-modified'), false);

  input(ctx, 'QUANTIDADE', '3');
  assert.equal(quantity.classList.contains('lg-field-modified'), true);
  assert.equal(date.classList.contains('lg-field-modified'), false);
  input(ctx, 'DATA', '18/09/2026');
  assert.equal(date.classList.contains('lg-field-modified'), true);
  input(ctx, 'QUANTIDADE', '2.5');
  input(ctx, 'DATA', '17/09/2026');
  assert.equal(quantity.classList.contains('lg-field-modified'), false);
  assert.equal(date.classList.contains('lg-field-modified'), false);
});

test('editor highlights searchable choices and checkboxes only while their values differ', async t => {
  const ctx = await setup(t, {request: async operation => operation === 'snapshot' ? snapshot() : detail({editFields: [
    {name: 'CONCLUÍDO', label: 'Situação', type: 'select', options: [
      {value: 'PEDIDO EMPENHADO', label: 'Empenhado'}, {value: 'PEDIDO FINALIZADO', label: 'Finalizado'},
    ]},
    {name: 'CONFERIDO', label: 'Conferido', type: 'boolean'},
  ]})});
  await ctx.gallery.open(); await showDetail(ctx);
  const form = ctx.root().querySelector('.lg-editor');
  const status = form.querySelector('[name="CONCLUÍDO"]').closest('.lg-field');
  const checked = form.querySelector('[name="CONFERIDO"]').closest('.lg-field');
  assert.equal(status.classList.contains('lg-field-modified'), false);
  assert.equal(checked.classList.contains('lg-field-modified'), false);

  form.querySelector('.sfs-trigger').click();
  [...form.querySelectorAll('.sfs-option')].find(option => option.textContent === 'Finalizado').click();
  assert.equal(status.classList.contains('lg-field-modified'), true);
  input(ctx, 'CONFERIDO', true);
  assert.equal(checked.classList.contains('lg-field-modified'), true);
  form.querySelector('.sfs-trigger').click();
  [...form.querySelectorAll('.sfs-option')].find(option => option.textContent === 'Empenhado').click();
  input(ctx, 'CONFERIDO', false);
  assert.equal(status.classList.contains('lg-field-modified'), false);
  assert.equal(checked.classList.contains('lg-field-modified'), false);
});

test('modified editor inputs and searchable triggers have a visible orange fill', async t => {
  const ctx = await setup(t);
  const stylesheet = ctx.document.createElement('style');
  stylesheet.textContent = readFileSync(new URL('../src/ui/launch-gallery.css', import.meta.url), 'utf8');
  ctx.document.head.append(stylesheet);
  await ctx.gallery.open(); await showDetail(ctx);
  const form = ctx.root().querySelector('.lg-editor');
  const quantity = form.querySelector('[name="QUANTIDADE"]');
  const status = form.querySelector('[name="CONCLUÍDO"]');
  assert.equal(ctx.dom.window.getComputedStyle(quantity).backgroundColor, 'rgb(255, 255, 255)');
  input(ctx, 'QUANTIDADE', '3');
  assert.equal(ctx.dom.window.getComputedStyle(quantity).backgroundColor, 'rgb(255, 240, 214)');
  form.querySelector('.sfs-trigger').click();
  [...form.querySelectorAll('.sfs-option')].find(option => option.textContent === 'Finalizado').click();
  assert.equal(status.value, 'PEDIDO FINALIZADO');
  assert.equal(ctx.dom.window.getComputedStyle(form.querySelector('.sfs-trigger')).backgroundColor, 'rgb(255, 240, 214)');
});

test('dependent choice cleared by a branch change is highlighted until its original value is restored', async t => {
  const item = row(); item.fields.ETAPA = 'Etapa antiga';
  const ctx = await setup(t, {request: async (operation, payload) => {
    if (operation === 'snapshot') return snapshot({rows: [item]});
    if (operation === 'schema') return {fields: [{name: 'ETAPA', options: payload.fields.FILIAL === 'Obra B'
      ? [{value: 'Etapa nova', label: 'Etapa nova'}]
      : [{value: 'Etapa antiga', label: 'Etapa antiga'}]}]};
    return detail({item, editFields: [
      {name: 'FILIAL', label: 'Filial', type: 'select', options: ['Obra A', 'Obra B']},
      {name: 'ETAPA', label: 'Etapa', type: 'select', options: ['Etapa antiga']},
    ]});
  }});
  const stylesheet = ctx.document.createElement('style');
  stylesheet.textContent = readFileSync(new URL('../src/ui/launch-gallery.css', import.meta.url), 'utf8');
  ctx.document.head.append(stylesheet);
  await ctx.gallery.open(); await showDetail(ctx);
  const form = ctx.root().querySelector('.lg-editor');
  const stage = form.querySelector('[name="ETAPA"]');
  const stageField = stage.closest('.lg-field');

  input(ctx, 'FILIAL', 'Obra B'); await settle();
  assert.equal(stage.value, '');
  assert.equal(stageField.classList.contains('lg-field-modified'), true);
  assert.equal(ctx.dom.window.getComputedStyle(stageField.querySelector('.sfs-trigger')).backgroundColor, 'rgb(255, 240, 214)');
  input(ctx, 'FILIAL', 'Obra A'); await settle();
  stage.closest('.lg-field').querySelector('.sfs-trigger').click();
  [...stageField.querySelectorAll('.sfs-option')].find(option => option.textContent === 'Etapa antiga').click();
  assert.equal(stage.value, 'Etapa antiga');
  assert.equal(stageField.classList.contains('lg-field-modified'), false);
  assert.equal(ctx.dom.window.getComputedStyle(stageField.querySelector('.sfs-trigger')).backgroundColor, 'rgb(255, 255, 255)');
});

test('filters start collapsed, editor scrolls into view, and review opens as a focused popup', async t => {
  const ctx = await setup(t);
  const scrolled = [];
  ctx.dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this); };
  await ctx.gallery.open();
  const filters = ctx.root().querySelector('details.lg-filters');
  assert.ok(filters);
  assert.equal(filters.open, false);
  assert.equal(filters.querySelector('summary').textContent, 'Filtros e ordenação');
  await showDetail(ctx);
  assert.ok(scrolled.includes(ctx.root().querySelector('.lg-detail')));
  input(ctx, 'QUANTIDADE', '3');
  button(ctx.root(), 'SUBMETER').click();
  assert.equal(ctx.document.activeElement, ctx.root().querySelector('.lg-review'));
  assert.equal(scrolled.includes(ctx.root().querySelector('.lg-review')), false);
});

test('edit modal shows compact dates and an attachment picker below the current attachments', async t => {
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const item = {...row(), fields: {...row().fields, ASSINATURA: JSON.stringify(png), 'DATA PGTO PREVISTO': '2026-09-25T00:00:00Z'}};
  const ctx = await setup(t, {request: async op => op === 'snapshot' ? snapshot() : detail({item, editFields: [
    {name: 'DATA', label: 'Data', type: 'date'},
    {name: 'DATA PGTO PREVISTO', label: 'Data pgto previsto', type: 'date'},
    {name: 'UN', label: 'UN', type: 'text'},
    {name: 'QUANTIDADE', label: 'Quantidade', type: 'number'},
  ]})});
  await ctx.gallery.open(); await showDetail(ctx);
  const form = ctx.root().querySelector('.lg-editor');
  assert.equal(form.querySelector('[name="DATA"]').value, '17/09/2026');
  assert.equal(form.querySelector('[name="DATA PGTO PREVISTO"]').value, '25/09/2026');
  const unit = form.querySelector('[name="UN"]').closest('.lg-field');
  assert.equal(unit.nextElementSibling, form.querySelector('.lg-attachments'));
  assert.equal(form.querySelector('.lg-attachments'), ctx.root().querySelector('.lg-attachments'));
  const attachmentSection = form.querySelector('.lg-attachments');
  assert.ok(attachmentSection.querySelector('input[type="file"]'));
  assert.ok(attachmentSection.querySelector('.lg-attachment-add'));
  assert.ok(attachmentSection.querySelector('.lg-attachment-add').compareDocumentPosition(form.querySelector('.lg-editor-actions'))
    & ctx.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(button(attachmentSection, 'Adicionar anexo').disabled);
  assert.equal(ctx.root().querySelector('.lg-signature'), null);
  for (const text of ['Excluir lançamento', 'Provisionar pagamento', 'Aplicar medição', 'Desenhar assinatura',
    'Limpar arquivo selecionado', 'Remover anexo']) {
    assert.equal([...ctx.root().querySelectorAll('.lg-detail button')].some(node => node.textContent === text), false);
  }
  const buttons = [...form.querySelectorAll('.lg-editor-actions > button')];
  assert.deepEqual(buttons.map(node => node.textContent), ['Cancelar edição', 'SUBMETER']);
  input(ctx, 'DATA', '18/09/2026');
  button(ctx.root(), 'SUBMETER').click();
  assert.deepEqual(ctx.root().querySelector('.lg-review')?.hidden, false);
  assert.match(ctx.root().querySelector('.lg-review').textContent, /18\/09\/2026/);
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(mutations(ctx).at(-1).payload.fields.DATA, '2026-09-18');
});

test('invalid calendar dates cannot reach the update request', async t => {
  const ctx = await setup(t, {request: async op => op === 'snapshot' ? snapshot() : detail({editFields: [
    {name: 'DATA', label: 'Data', type: 'date', required: true},
  ]})});
  await ctx.gallery.open(); await showDetail(ctx);
  input(ctx, 'DATA', '31/02/2026');
  button(ctx.root(), 'SUBMETER').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /data válida/);
  assert.equal(mutations(ctx).length, 0);
});

test('numeric mobile date entry inserts separators before review', async t => {
  const ctx = await setup(t, {request: async op => op === 'snapshot' ? snapshot() : detail({editFields: [
    {name: 'DATA', label: 'Data', type: 'date', required: true},
  ]})});
  await ctx.gallery.open(); await showDetail(ctx);
  const date = input(ctx, 'DATA', '18102026');
  assert.equal(date.inputMode, 'numeric');
  assert.equal(date.value, '18/10/2026');
  button(ctx.root(), 'SUBMETER').click();
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(mutations(ctx).at(-1).payload.fields.DATA, '2026-10-18');
});

test('body overlay survives chat rerenders; close/home/destroy preserve lifecycle and focus', async t => {
  let closed = 0, home = 0;
  const ctx = await setup(t, { onClose: () => closed++, onHome: () => home++ });
  const origin = ctx.document.querySelector('#origin');
  origin.focus();
  await ctx.gallery.open();
  const root = ctx.root();
  assert.equal(root.parentElement, ctx.document.body);
  assert.equal(root.getAttribute('role'), 'dialog');
  assert.equal(root.hidden, false);
  ctx.document.querySelector('#chat').replaceChildren(ctx.document.createElement('p'));
  assert.equal(ctx.root(), root);
  assert.equal(ctx.calls[0].operation, 'snapshot');
  button(root, 'Voltar').click();
  assert.equal(root.hidden, true);
  assert.equal(closed, 1);
  assert.equal(ctx.document.activeElement, origin);
  await ctx.gallery.open();
  button(root, 'Início').click();
  assert.equal(home, 1);
  assert.equal(root.hidden, true);
  assert.equal(mutations(ctx).length, 0);
  ctx.gallery.destroy();
  await ctx.gallery.open();
  assert.equal(ctx.root(), null);
});

test('all filters, inclusive date endpoints, server sorts, totals and paging reach the service', async t => {
  const ctx = await setup(t, { request: async (op, payload) => snapshot({ page: payload.page, count: 23, pages: 2 }) });
  await ctx.gallery.open();
  assert.equal([...ctx.root().querySelectorAll('button')].some(node => node.textContent.trim() === 'Aplicar filtros'), false);
  for (const [name, value] of Object.entries({ branch: 'Obra A', supplier: 'Fornecedor A', status: 'PEDIDO EMPENHADO',
    id: '17', product: 'Cimento', stage: 'Fundação', contract: 'Contrato 1', pendingApproval: true,
    dateStart: '2026-09-01', dateEnd: '2026-09-19', sort: sorts[7] })) input(ctx, name, value);
  await settle();
  assert.deepEqual(ctx.calls.filter(call => call.operation === 'snapshot').at(-1), { operation: 'snapshot', payload: {
    filters: { branch: 'Obra A', supplier: 'Fornecedor A', status: 'PEDIDO EMPENHADO', id: '17', product: 'Cimento',
      stage: 'Fundação', contract: 'Contrato 1', pendingApproval: true, dateStart: '2026-09-01', dateEnd: '2026-09-19' },
    sort: sorts[7], page: 1, pageSize: 20,
  } });
  assert.equal(ctx.root().querySelector('[name="sort"]').options.length, 8);
  const totals = ctx.root().querySelector('.lg-totals');
  assert.deepEqual([...totals.querySelectorAll('dt')].map(node => node.textContent), ['Pago']);
  assert.equal(totals.querySelectorAll('.lg-total').length, 1);
  assert.match(totals.querySelector('.lg-total-money').textContent, /R\$\s*10,00/);
  button(ctx.root(), 'Próxima página').click(); await settle();
  assert.equal(ctx.calls.filter(call => call.operation === 'snapshot').at(-1).payload.page, 2);
  button(ctx.root(), 'Página anterior').click(); await settle();
  assert.equal(ctx.calls.filter(call => call.operation === 'snapshot').at(-1).payload.page, 1);
});

test('typing in launch filters automatically and coalesces rapid keystrokes into one snapshot', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  const id = ctx.root().querySelector('[name="id"]');
  id.value = '2';
  id.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  id.value = '22';
  id.dispatchEvent(new ctx.dom.window.Event('input', { bubbles: true }));
  await new Promise(resolve => setTimeout(resolve, 250));

  const snapshots = ctx.calls.filter(call => call.operation === 'snapshot');
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots.at(-1).payload.filters.id, '22');
});

test('summary reproduces the PowerApps launch row with tolerant aliases and keeps details on the selected id', async t => {
  const full = row(3424);
  full.total = 2.85;
  full.fields = {
    ID: 3424,
    PRODUTO: 'CORDA PARA PRUMO DE CENTRO',
    'ETAPA OBRA': 'ALVENARIA E ESTRUTURAS',
    FORNECEDOR: 'PIRATININGA FERRAMENTAS LTDA',
    CONCLUÍDO: 'PEDIDO FINALIZADO',
    'ADICIONADO POR': 'SHAREPOINT APP EM 20/09/2026 14:27',
    FILIAL: '004 - EDIFÍCIO XAVANTE',
    'DATA DE RMS': '20/09/2026',
    MODIFICAÇÕES: 'SEM MODIFICAÇÕES APÓS CRIAÇÃO',
    'DATA DE COMPRA': '20/09/2026',
    'VALOR UNITÁRIO': 'R$ 2,85',
    'TIPO DE OPERAÇÃO': 'CUSTO',
    APROVAÇÃO: 'PENDENTE DE APROVAÇÃO',
    'DATA DE LIQUIDAÇÃO': '19/09/2026',
    QUANTIDADE: 1,
    UNIDADE: 'UN',
    'DATA DE PAGAMENTO': '19/09/2026',
    FRETE: 'R$ 0,00',
    'VALOR TOTAL': 'R$ 2,85',
    'FORMA DE PAGAMENTO': 'AMAEL PF - CAIXA',
    'ID PEDIDO': 318,
    'QUANTIDADE DE ANEXOS': 2,
    AVALIAÇÃO: 'SEM AVALIAÇÃO',
  };
  const ctx = await setup(t, {request: async (operation, payload) => operation === 'snapshot'
    ? snapshot({rows: [full], totals: {committed: 85, committedCount: 3, liquidated: 25, liquidatedCount: 2,
      pending: 15, paid: 10, paidCount: 4, total: 135, totalCount: 9}})
    : detail({item: full})});
  await ctx.gallery.open();
  const record = ctx.root().querySelector('.lg-record');
  assert.ok(record, 'PowerApps-equivalent record');
  for (const value of ['3424', 'CORDA PARA PRUMO DE CENTRO', 'ALVENARIA E ESTRUTURAS',
    'PIRATININGA FERRAMENTAS LTDA', 'PEDIDO FINALIZADO', 'SHAREPOINT APP EM 20/09/2026 14:27',
    '004 - EDIFÍCIO XAVANTE', '20/09/2026', 'SEM MODIFICAÇÕES APÓS CRIAÇÃO',
    'CUSTO', 'PENDENTE DE APROVAÇÃO', '19/09/2026', '1 UN', 'AMAEL PF - CAIXA', '318',
    '2 anexos', 'SEM AVALIAÇÃO']) assert.ok(record.textContent.includes(value), value);
  assert.match(record.textContent, /R\$\s*2,85/);
  assert.equal([...ctx.root().querySelectorAll('.lg-filter-grid .lg-label')]
    .some(label => label.textContent === 'Medição'), true);
  assert.match(ctx.root().querySelector('.lg-totals').textContent, /4\s+R\$\s*10,00/);
  button(record, 'Ver mais informações').click();
  record.querySelector('[data-gallery-action="edit"]').click(); await settle();
  assert.deepEqual(ctx.calls.at(-1), {operation: 'detail', payload: {id: 3424}});
});

test('launch card presents AGRUPAR and supplier as cluster actions while preserving the left clip/count rail', async t => {
  const item = row(3451);
  item.fields = { ...item.fields, AGRUPAR: 334, 'QUANTIDADE DE ANEXOS': 2 };
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item] }) : detail({ item }) });
  await ctx.gallery.open(); await settle();

  const card = ctx.root().querySelector('.lg-record');
  const supplier = card.querySelector('[data-cluster-kind="supplier"]');
  const order = card.querySelector('[data-cluster-kind="order"]');
  assert.equal(supplier.textContent, 'Fornecedor A');
  assert.equal(order.textContent, '334');
  assert.ok(card.querySelector('.lg-record-media').compareDocumentPosition(card.querySelector('.lg-record-heading'))
    & ctx.dom.window.Node.DOCUMENT_POSITION_FOLLOWING, 'attachment control remains left/before the card content');
  assert.equal(card.querySelector('.lg-record-media .lg-record-attachment-icon').textContent, '📎');
  assert.equal(card.querySelector('.lg-record-media .lg-record-attachment-count').textContent, '2 anexos');
  assert.ok(card.querySelector('.lg-record-dates'));
  assert.ok(card.querySelector('.lg-record-values'));
  assert.equal(card.querySelector('.lg-record-dates .lg-record-label')?.textContent, 'DATA DE COMPRA');
});

test('launch card keeps a compact summary and reveals secondary fields without hiding supplier or order actions', async t => {
  const item = row(3451);
  item.fields = { ...item.fields, AGRUPAR: 334, 'VALOR UNITÁRIO': 'R$ 30,00',
    'DATA PGTO EFETUADO': '2026-09-25', 'QUANTIDADE DE ANEXOS': 2 };
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item] }) : detail({ item }) });
  await ctx.gallery.open();

  const card = ctx.root().querySelector('.lg-record');
  const extra = card.querySelector('.lg-record-extra');
  const expand = button(card, 'Ver mais informações');
  assert.ok(extra, 'secondary launch fields are grouped in the disclosure');
  assert.equal(extra.hidden, true);
  assert.equal(expand.getAttribute('aria-expanded'), 'false');
  assert.equal(card.querySelector('[data-cluster-kind="supplier"]')?.textContent, 'Fornecedor A');
  assert.equal(card.querySelector('[data-cluster-kind="order"]')?.textContent, '334');
  assert.match(card.querySelector('.lg-record-summary')?.textContent ?? '', /R\$\s*30,00/);
  assert.match(card.querySelector('.lg-record-summary')?.textContent ?? '', /2\.5 SC/);
  assert.equal(card.querySelector('.lg-record-media .lg-record-attachment-count')?.textContent, '2 anexos');

  expand.click();
  assert.equal(extra.hidden, false);
  assert.equal(expand.getAttribute('aria-expanded'), 'true');
  assert.equal(expand.textContent, 'Ver menos informações');
  assert.match(extra.textContent, /Obra A/);
  assert.match(extra.textContent, /2026|17\/09\/2026/);
  assert.equal(card.querySelector('.lg-record-media').parentElement, card,
    'attachment rail remains a sibling in the same expanding grid card');

  expand.click();
  assert.equal(extra.hidden, true);
  assert.equal(expand.getAttribute('aria-expanded'), 'false');
});

test('launch cards keep a compact summary and reveal remaining fields only when expanded', async t => {
  const item = row(3458);
  const second = row(3459);
  second.fields = { ...second.fields, 'DATA PGTO PREVISTO': '30/09/2026' };
  item.fields = {
    ...item.fields,
    PRODUTO: 'PEDREIRO', FORNECEDOR: 'FELICIANO ROGÉRIO DA SILVA', AGRUPAR: 338,
    'DATA PGTO EFETUADO': '25/09/2026', 'VALOR UNITÁRIO': 109, QUANTIDADE: 1, UN: 'DIÁRIA', UNIDADE: 'DIÁRIA',
    FRETE: '0,00', 'VALOR TOTAL': 'R$ 109,00', FILIAL: '004 - EDIFÍCIO XAVANTE',
    'ETAPA OBRA': 'ALVENARIA E ESTRUTURAS', 'DATA DE COMPRA': '28/09/2026',
    'DATA PGTO PREVISTO': '29/09/2026', 'DATA DE RMS': '28/09/2026',
    'FORMA DE PAGAMENTO': 'PIX', 'TIPO DE OPERAÇÃO': 'CUSTO', APROVAÇÃO: 'PENDENTE DE APROVAÇÃO',
  };
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item, second] }) : detail({ item }) });
  await ctx.gallery.open();

  const [card, secondCard] = ctx.root().querySelectorAll('.lg-record');
  const summary = card.querySelector('.lg-record-summary');
  const extra = card.querySelector('.lg-record-extra');
  const secondExtra = secondCard.querySelector('.lg-record-extra');
  const secondSummary = secondCard.querySelector('.lg-record-summary');
  const toggle = button(card, 'Ver mais informações');
  assert.ok(summary);
  assert.ok(extra);
  assert.equal(extra.hidden, true);
  assert.match(secondSummary.textContent, /PREVISTO.*30\/09\/2026/);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(toggle.getAttribute('aria-controls'), extra.id);
  assert.notEqual(extra.id, secondExtra.id);
  for (const value of ['3458', 'PEDREIRO', 'FELICIANO ROGÉRIO DA SILVA', '338', '25/09/2026', '1 DIÁRIA']) {
    assert.ok(summary.textContent.includes(value), value);
  }
  assert.match(summary.textContent, /R\$\s*109,00/);
  assert.match(summary.textContent, /R\$\s*0,00/);
  for (const value of ['004 - EDIFÍCIO XAVANTE', 'ALVENARIA E ESTRUTURAS', '28/09/2026', 'PIX']) {
    assert.doesNotMatch(summary.textContent, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(card.querySelector('.lg-record-media').parentElement, card.querySelector('.lg-record-content').parentElement);

  toggle.click();
  assert.equal(extra.hidden, false);
  assert.equal(secondExtra.hidden, true, 'expanding one launch must not expand another');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.textContent, 'Ver menos informações');
  for (const value of ['004 - EDIFÍCIO XAVANTE', 'ALVENARIA E ESTRUTURAS', '28/09/2026', 'PIX']) {
    assert.ok(extra.textContent.includes(value), value);
  }
  card.querySelector('[data-gallery-action="edit"]').click(); await settle();
  assert.deepEqual(ctx.calls.at(-1), { operation: 'detail', payload: { id: 3458 } });

  toggle.click();
  assert.equal(extra.hidden, true);
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('launch total is highlighted beside status while the lower finance area shows freight instead', async t => {
  const cases = [
    { id: 3489, total: '13.040,00', freight: 40, wantTotal: 'R$ 13.040,00', wantFreight: 'R$ 40,00' },
    { id: 3488, total: 0, freight: 0, wantTotal: 'R$ 0,00', wantFreight: 'R$ 0,00' },
    { id: 3487, total: undefined, freight: undefined, wantTotal: 'R$ 85,00', wantFreight: '—' },
  ];
  const rows = cases.map(sample => ({ ...row(sample.id), fields: { ...row(sample.id).fields,
    'VALOR TOTAL': sample.total, FRETE: sample.freight } }));
  const ctx = await setup(t, { request: async operation => operation === 'snapshot' ? snapshot({ rows }) : detail() });
  await ctx.gallery.open();
  for (const sample of cases) {
    const card = ctx.root().querySelector(`[data-item-id="${sample.id}"]`);
    const headingSummary = card.querySelector('.lg-record-heading-summary');
    assert.ok(headingSummary, 'status and highlighted total share the bottom of the heading');
    assert.equal(headingSummary.querySelector('.lg-record-status').nextElementSibling,
      headingSummary.querySelector('.lg-record-total'));
    assert.equal(headingSummary.querySelector('.lg-record-total .lg-record-label').textContent, 'VALOR TOTAL');
    assert.equal(headingSummary.querySelector('.lg-record-total .lg-record-value').textContent.replace(/\u00a0/g, ' '), sample.wantTotal);
    const finance = card.querySelector('.lg-record-finance');
    assert.deepEqual([...finance.querySelectorAll('.lg-record-label')].map(label => label.textContent),
      ['VALOR UNITÁRIO', 'QUANTIDADE', 'FRETE']);
    assert.equal(finance.querySelector('.lg-record-field:last-child .lg-record-value').textContent.replace(/\u00a0/g, ' '), sample.wantFreight);
  }
});

test('a launch without status still shows its total in the heading', async t => {
  const item = row(); delete item.fields.CONCLUÍDO;
  const ctx = await setup(t, { request: async operation => operation === 'snapshot' ? snapshot({ rows: [item] }) : detail() });
  await ctx.gallery.open();
  assert.match(ctx.root().querySelector('.lg-record-heading .lg-record-total')?.textContent || '', /VALOR TOTAL.*85,00/);
});

test('supplier and AGRUPAR actions remain usable in the compact launch summary', async t => {
  const item = row(3458);
  item.fields = { ...item.fields, FORNECEDOR: 'Fornecedor A', AGRUPAR: 338 };
  const ctx = await setup(t, {
    loadLaunchGroup: async () => [item],
    loadOrderSnapshot: async () => ({ rows: [{ id: 338, fields: { ID: 338, FORNECEDOR: 'Fornecedor A' } }] }),
    request: async operation => operation === 'snapshot' ? snapshot({ rows: [item] }) : detail({ item }),
  });
  await ctx.gallery.open();
  const card = ctx.root().querySelector('.lg-record');
  const extra = card.querySelector('.lg-record-extra');

  card.querySelector('[data-cluster-kind="supplier"]').click(); await settle(); await settle();
  assert.equal(ctx.root().querySelector('.lg-cluster-modal').hidden, false);
  assert.equal(extra.hidden, true);
  button(ctx.root().querySelector('.lg-cluster-modal'), 'Fechar').click();
  card.querySelector('[data-cluster-kind="order"]').click(); await settle(); await settle();
  assert.equal(ctx.root().querySelector('.lg-cluster-modal').hidden, false);
  assert.equal(extra.hidden, true);
});

test('supplier cluster loads every matching launch page and summarizes the supplier', async t => {
  const first = row(3451); first.fields = { ...first.fields, FORNECEDOR: 'Fornecedor A', 'VALOR TOTAL': 'R$ 905,00' };
  const second = row(3450); second.fields = { ...second.fields, FORNECEDOR: 'Fornecedor A', 'VALOR TOTAL': 'R$ 181,00' };
  const supplierPages = [];
  let activeSupplierRequests = 0, maxActiveSupplierRequests = 0;
  const ctx = await setup(t, { request: async (operation, payload) => {
    if (operation !== 'snapshot') return detail();
    if (payload.filters?.supplier === 'Fornecedor A') {
      supplierPages.push(payload.page);
      activeSupplierRequests += 1;
      maxActiveSupplierRequests = Math.max(maxActiveSupplierRequests, activeSupplierRequests);
      try {
        await new Promise(resolve => setTimeout(resolve, 5));
        return snapshot({ rows: [payload.page === 1 ? first : second], page: payload.page, pages: 6, count: 6 });
      } finally { activeSupplierRequests -= 1; }
    }
    return snapshot({ rows: [first] });
  } });
  await ctx.gallery.open();
  const supplierTrigger = ctx.root().querySelector('[data-cluster-kind="supplier"]');
  supplierTrigger.focus(); supplierTrigger.click();
  await settle(); await settle();
  const modal = ctx.root().querySelector('.lg-cluster-modal');
  for (let attempt = 0; (supplierPages.length < 6 || modal.getAttribute('aria-busy') !== 'false') && attempt < 100; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  assert.equal(modal.hidden, false);
  assert.match(modal.textContent, /Fornecedor A/);
  assert.deepEqual(supplierPages, [1, 2, 3, 4, 5, 6]);
  assert.equal(maxActiveSupplierRequests, 1);
  assert.deepEqual([...modal.querySelectorAll('[data-launch-id]')].map(node => node.dataset.launchId), ['3451', '3450']);
  assert.match(modal.textContent, /R\$\s*1\.086,00/);
  button(modal, 'Fechar').click();
  assert.equal(modal.hidden, true);
  assert.equal(ctx.document.activeElement, supplierTrigger);
});

for (const kind of ['supplier', 'order']) {
  test(`${kind} cluster leaves the endless loading state when its data request exceeds the deadline`, async t => {
    const pending = deferred();
    const item = row(3451);
    item.fields = { ...item.fields, AGRUPAR: '334' };
    const ctx = await setup(t, {
      clusterTimeoutMs: 15,
      loadOrderSnapshot: async () => ({ rows: [{ id: '334', fields: {} }] }),
      ...(kind === 'order' ? { loadLaunchGroup: () => pending.promise } : {}),
      request: async (operation, payload) => {
        if (operation === 'snapshot' && payload.filters?.supplier) return pending.promise;
        return operation === 'snapshot' ? snapshot({ rows: [item] }) : detail({ item });
      },
    });
    await ctx.gallery.open();
    ctx.root().querySelector(`[data-cluster-kind="${kind}"]`).click();
    await new Promise(resolve => setTimeout(resolve, 30));

    const modal = ctx.root().querySelector('.lg-cluster-modal');
    assert.equal(modal.getAttribute('aria-busy'), 'false');
    assert.doesNotMatch(modal.textContent, /Carregando informações/);
    assert.match(modal.textContent, /demorou mais|tempo limite/i);
    button(modal, 'Tentar novamente');
  });
}

test('closing a cluster aborts its pending launch request', async t => {
  const pending = deferred();
  let requestSignal;
  const ctx = await setup(t, {
    request: async (operation, payload, options) => {
      if (operation === 'snapshot' && payload.filters?.supplier) {
        requestSignal = options?.signal;
        return pending.promise;
      }
      return operation === 'snapshot' ? snapshot() : detail();
    },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="supplier"]').click();
  assert.ok(requestSignal, 'the network request receives an abort signal');
  button(ctx.root().querySelector('.lg-cluster-modal'), 'Fechar').click();
  assert.equal(requestSignal.aborted, true);
});

test('order cluster timeout cancels a pending SharePoint snapshot too', async t => {
  const pending = deferred();
  const item = row(3451);
  item.fields = { ...item.fields, AGRUPAR: '334' };
  let sharePointSignal;
  const ctx = await setup(t, {
    clusterTimeoutMs: 15,
    loadOrderSnapshot: ({ signal }) => { sharePointSignal = signal; return pending.promise; },
    request: async (operation, payload) => operation === 'snapshot'
      ? snapshot({ rows: [item] }) : detail({ item }),
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.equal(sharePointSignal?.aborted, true);
  assert.match(ctx.root().querySelector('.lg-cluster-modal').textContent, /demorou mais/i);
});

test('order cluster aborts its sibling request when either data source fails', async t => {
  const pendingLaunches = deferred();
  const item = row(3451);
  item.fields = { ...item.fields, AGRUPAR: '334' };
  let launchSignal;
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => { throw new Error('SharePoint indisponível'); },
    loadLaunchGroup: (_id, { signal }) => {
      launchSignal = signal;
      return pendingLaunches.promise;
    },
    request: async operation => operation === 'snapshot' ? snapshot({ rows: [item] }) : detail({ item }),
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle();

  const modal = ctx.root().querySelector('.lg-cluster-modal');
  assert.match(modal.textContent, /SharePoint indisponível/);
  assert.equal(launchSignal?.aborted, true);
});

test('order cluster joins AGRUPAR to the SharePoint order and renders the order plus all linked launches', async t => {
  const orderLaunch = row(3451);
  orderLaunch.fields = { ...orderLaunch.fields, AGRUPAR: '334', 'ID PEDIDO': 334, 'DATA DE COMPRA': '2026-09-27',
    'VALOR TOTAL': 'R$ 905,00', QUANTIDADE: 5, UNIDADE: 'DIÁRIA', FRETE: 'R$ 0,00' };
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => ({ rows: [{ id: '334', fields: {
      FILIAL: '004 - EDIFÍCIO XAVANTE', FORNECEDOR: 'MAURO ANTONIO PEREIRA', FORMAPGTO: 'DINHEIRO',
      VALORTOTAL: 905, STATUS: 'PENDENTE AUDITORIA', OBS: 'Sem observação',
    } }] }),
    loadLaunchGroup: async groupId => {
      assert.equal(groupId, '334');
      return [orderLaunch];
    },
    request: async (operation, payload) => {
      if (operation !== 'snapshot') return detail({ item: orderLaunch });
      return snapshot({ rows: [orderLaunch] });
    },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();

  const modal = ctx.root().querySelector('.lg-cluster-modal');
  assert.equal(modal.hidden, false);
  assert.match(modal.textContent, /CABEÇALHO DO PEDIDO/);
  assert.match(modal.textContent, /MAURO ANTONIO PEREIRA/);
  assert.match(modal.textContent, /LANÇAMENTOS VINCULADOS AO PEDIDO 334/i);
  assert.deepEqual([...modal.querySelectorAll('[data-launch-id]')].map(node => node.dataset.launchId), ['3451']);
  assert.match(modal.textContent, /R\$\s*905,00/);
  assert.match(modal.textContent, /Valores conferem/i);
  assert.match(modal.textContent, /Soma dos lançamentos:[\s\S]*905,00/i);
});

test('order cluster requests one order by ID and only the LANCAMENTOS group, never the whole launch gallery', async t => {
  const item = row(3451);
  item.fields = { ...item.fields, AGRUPAR: '334', 'ID PEDIDO': 334, 'DATA DE COMPRA': '2026-09-27',
    'VALOR TOTAL': 'R$ 905,00', QUANTIDADE: 5, UNIDADE: 'DIÁRIA', FRETE: 'R$ 0,00' };
  const orderIds = [], groupIds = [];
  let fullGalleryReads = 0;
  const ctx = await setup(t, {
    loadOrderSnapshot: async ({ id }) => {
      orderIds.push(id);
      return { rows: [{ id, fields: { FORNECEDOR: 'MAURO ANTONIO PEREIRA', VALORTOTAL: 905 } }] };
    },
    loadLaunchGroup: async id => { groupIds.push(id); return [item]; },
    request: async (operation, payload) => {
      if (operation === 'snapshot' && payload.pageSize === 100) fullGalleryReads += 1;
      return operation === 'snapshot' ? snapshot({ rows: [item] }) : detail({ item });
    },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();

  const modal = ctx.root().querySelector('.lg-cluster-modal');
  assert.deepEqual(orderIds, ['334']);
  assert.deepEqual(groupIds, ['334']);
  assert.equal(fullGalleryReads, 0);
  assert.match(modal.textContent, /CABEÇALHO DO PEDIDO/);
  assert.deepEqual([...modal.querySelectorAll('[data-launch-id]')].map(node => node.dataset.launchId), ['3451']);
});

test('pedido agrupado completa os dados de cada lançamento quando a busca por AGRUPAR devolve apenas IDs', async t => {
  const first = row(3479);
  first.fields = { ...first.fields, AGRUPAR: '348', DATA: '2026-09-30',
    FORNECEDOR: 'JOSÉ GERALDO DOS SANTOS', CONTA: 'DINHEIRO',
    PRODUTO: 'PEDREIRO', QUANTIDADE: 2, UN: 'DIÁRIA', 'VALOR UNITÁRIO': 250,
    FRETE: 0, 'VALOR TOTAL': 500 };
  first.total = 500;
  first.hasAttachments = false;
  const second = row(3478);
  second.fields = { ...second.fields, AGRUPAR: '348', DATA: '2026-09-29',
    FORNECEDOR: 'JOSÉ GERALDO DOS SANTOS', CONTA: 'DINHEIRO',
    PRODUTO: 'PEDREIRO', QUANTIDADE: 2, UN: 'DIÁRIA', 'VALOR UNITÁRIO': 293,
    FRETE: 0, 'VALOR TOTAL': 586 };
  second.total = 586;
  second.hasAttachments = false;
  const details = new Map([['3479', first], ['3478', second]]);
  const detailIds = [];
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => ({ rows: [{ id: '348', fields: { VALORTOTAL: 1086 } }] }),
    loadLaunchGroup: async () => [
      { id: '3479', fields: { AGRUPAR: '348' } },
      { id: '3478', fields: { AGRUPAR: '348' } },
    ],
    request: async (operation, payload) => {
      if (operation === 'detail') {
        detailIds.push(String(payload.id));
        return detail({ item: details.get(String(payload.id)) });
      }
      return snapshot({ rows: [first] });
    },
  });
  await ctx.gallery.open();
  const trigger = ctx.root().querySelector('[data-cluster-kind="order"]');
  assert.ok(trigger, 'pedido agrupado deve estar acessível na galeria');
  trigger.click();
  await settle(); await settle();

  const modal = ctx.root().querySelector('.lg-cluster-modal');
  const rows = [...modal.querySelectorAll('[data-launch-id]')];
  assert.deepEqual(rows.map(node => node.dataset.launchId), ['3479', '3478']);
  assert.deepEqual(detailIds.sort(), ['3478', '3479']);
  assert.match(rows[0].textContent, /JOSÉ GERALDO DOS SANTOS/);
  assert.match(rows[0].textContent, /DINHEIRO/);
  assert.match(rows[0].textContent, /PEDREIRO/);
  assert.match(rows[0].textContent, /R\$\s*500,00/);
  assert.match(modal.textContent, /Valores conferem/);
});

test('pedido usa campos completos do SharePoint sem abrir detalhes individuais e calcula o total', async t => {
  const card = row(3479);
  card.fields.AGRUPAR = '348';
  card.hasAttachments = false;
  const linked = [
    { id: '3479', fields: { AGRUPAR: '348', DATA: '2026-09-30', FORNECEDOR: 'JOSÉ GERALDO',
      CONTA: 'DINHEIRO', PRODUTO: 'PEDREIRO', QUANTIDADE: 2, 'VALOR UNITÁRIO': 250,
      FRETE: 0, UN: 'DIÁRIA', 'CONCLUÍDO': 'PEDIDO EMPENHADO' } },
    { id: '3478', fields: { AGRUPAR: '348', DATA: '2026-09-29', FORNECEDOR: 'JOSÉ GERALDO',
      CONTA: 'DINHEIRO', PRODUTO: 'PEDREIRO', QUANTIDADE: 2, 'VALOR UNITÁRIO': 293,
      FRETE: 0, UN: 'DIÁRIA', 'CONCLUÍDO': 'PEDIDO EMPENHADO' } },
  ];
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => ({ rows: [{ id: '348', fields: { VALORTOTAL: 1086 } }] }),
    loadLaunchGroup: async () => linked,
    request: async operation => {
      if (operation === 'detail') throw new Error('Não deve consultar detalhes individuais');
      return snapshot({ rows: [card] });
    },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();

  const modal = ctx.root().querySelector('.lg-cluster-modal');
  const rows = [...modal.querySelectorAll('[data-launch-id]')];
  assert.deepEqual(rows.map(node => node.dataset.launchId), ['3479', '3478']);
  assert.match(rows[0].textContent, /JOSÉ GERALDO/);
  assert.match(rows[0].textContent, /R\$\s*500,00/);
  assert.match(modal.textContent, /Valores conferem/);
  assert.match(modal.textContent, /R\$\s*1\.086,00/);
});

test('pedido considera frete vazio como zero e arredonda cada lançamento antes de somar', async t => {
  const card = row(3479); card.fields.AGRUPAR = '348'; card.hasAttachments = false;
  const linked = ['3479', '3478'].map(id => ({ id, fields: {
    AGRUPAR: '348', DATA: '2026-09-30', PRODUTO: 'SERVIÇO', QUANTIDADE: 0.5,
    'VALOR UNITÁRIO': 0.01, FRETE: null,
  } }));
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => ({ rows: [{ id: '348', fields: { VALORTOTAL: 0.02 } }] }),
    loadLaunchGroup: async () => linked,
    request: async operation => {
      if (operation === 'detail') throw new Error('Não deve consultar detalhes individuais');
      return snapshot({ rows: [card] });
    },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();
  const modal = ctx.root().querySelector('.lg-cluster-modal');
  assert.match(modal.textContent, /Valores conferem/);
  assert.match(modal.textContent, /R\$\s*0,02/);
});

test('pedido usa arredondamento decimal half-up idêntico ao servidor', async t => {
  const card = row(3479); card.fields.AGRUPAR = '348'; card.hasAttachments = false;
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => ({ rows: [{ id: '348', fields: { VALORTOTAL: 10.08 } }] }),
    loadLaunchGroup: async () => [{ id: '3479', fields: {
      AGRUPAR: '348', DATA: '2026-09-30', PRODUTO: 'SERVIÇO', QUANTIDADE: 0.5,
      'VALOR UNITÁRIO': 20.15, FRETE: null,
    } }],
    request: async operation => {
      if (operation === 'detail') throw new Error('Não deve consultar detalhes individuais');
      return snapshot({ rows: [card] });
    },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();
  const modal = ctx.root().querySelector('.lg-cluster-modal');
  assert.match(modal.textContent, /Valores conferem/);
  assert.match(modal.textContent, /R\$\s*10,08/);
});

test('contingência limita detalhes individuais de grupos grandes e marca restantes incompletos', async t => {
  const card = row(3479); card.fields.AGRUPAR = '348'; card.hasAttachments = false;
  const ids = Array.from({ length: 10 }, (_, index) => String(3479 - index));
  const requested = [];
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => ({ rows: [{ id: '348', fields: { VALORTOTAL: 10 } }] }),
    loadLaunchGroup: async () => ids.map(id => ({ id, fields: { AGRUPAR: '348' } })),
    request: async (operation, payload) => {
      if (operation === 'detail') {
        requested.push(String(payload.id));
        return detail({ item: { id: String(payload.id), fields: {
          AGRUPAR: '348', DATA: '2026-09-30', PRODUTO: 'SERVIÇO', 'VALOR TOTAL': 1,
        } } });
      }
      return snapshot({ rows: [card] });
    },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();
  const modal = ctx.root().querySelector('.lg-cluster-modal');
  assert.deepEqual(requested, ids.slice(0, 8));
  assert.equal(modal.querySelectorAll('[data-launch-id]').length, 10);
  assert.match(modal.textContent, /lançamentos 3471, 3470 ainda não foram carregados/i);
  assert.match(modal.textContent, /Total incompleto/i);
  assert.doesNotMatch(modal.textContent, /Valores conferem/i);
  button(modal, 'Carregar próximos lançamentos').click();
  await settle(); await settle();
  assert.deepEqual(requested, ids);
  assert.match(modal.textContent, /Valores conferem/);
});

test('lote adicional que não responde libera o popup e pode ser repetido sem aceitar resposta tardia', async t => {
  const card = row(3479); card.fields.AGRUPAR = '348'; card.hasAttachments = false;
  const ids = Array.from({ length: 9 }, (_, index) => String(3479 - index));
  const delayed = deferred(); let attempts = 0;
  const ctx = await setup(t, {
    clusterTimeoutMs: 20,
    loadOrderSnapshot: async () => ({ rows: [{ id: '348', fields: { VALORTOTAL: 9 } }] }),
    loadLaunchGroup: async () => ids.map(id => ({ id, fields: { AGRUPAR: '348' } })),
    request: async (operation, payload) => {
      if (operation === 'detail') {
        if (String(payload.id) === '3471' && attempts++ === 0) return delayed.promise;
        return detail({ item: { id: String(payload.id), fields: {
          AGRUPAR: '348', DATA: '2026-09-30', PRODUTO: 'SERVIÇO', 'VALOR TOTAL': 1,
        } } });
      }
      return snapshot({ rows: [card] });
    },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();
  const modal = ctx.root().querySelector('.lg-cluster-modal');
  button(modal, 'Carregar próximos lançamentos').click();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(modal.getAttribute('aria-busy'), 'false');
  assert.match(modal.textContent, /demorou mais|tempo limite/i);
  button(modal, 'Carregar próximos lançamentos').click();
  await settle(); await settle();
  assert.match(modal.textContent, /Valores conferem/);
  delayed.resolve(detail({ item: { id: '3471', fields: { AGRUPAR: '999', 'VALOR TOTAL': 999 } } }));
  await settle();
  assert.match(modal.textContent, /Valores conferem/);
});

test('falha de um detalhe preserva os outros lançamentos e mantém a conciliação incompleta', async t => {
  const first = row(3479);
  first.fields.AGRUPAR = '348';
  first.fields['VALOR TOTAL'] = 500;
  first.total = 500;
  first.hasAttachments = false;
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => ({ rows: [{ id: '348', fields: { VALORTOTAL: 1086 } }] }),
    loadLaunchGroup: async () => [
      { id: '3479', fields: { AGRUPAR: '348' } },
      { id: '3478', fields: { AGRUPAR: '348' } },
    ],
    request: async (operation, payload) => {
      if (operation === 'detail' && String(payload.id) === '3479') return detail({ item: first });
      if (operation === 'detail') throw new Error('Falha na consulta do lançamento 3478');
      return snapshot({ rows: [first] });
    },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();

  const modal = ctx.root().querySelector('.lg-cluster-modal');
  assert.deepEqual([...modal.querySelectorAll('[data-launch-id]')].map(node => node.dataset.launchId), ['3479', '3478']);
  assert.match(modal.textContent, /lançamento 3478 não pôde ser carregado/i);
  assert.match(modal.textContent, /R\$\s*500,00/);
  assert.match(modal.textContent, /1 lançamento\(s\) sem valor total/i);
  assert.doesNotMatch(modal.textContent, /Valores conferem/i);
});

test('order reconciliation stays indeterminate when linked launch amounts are missing', async t => {
  const item = row(3451);
  item.total = undefined;
  item.fields = { ...item.fields, AGRUPAR: '334' };
  delete item.fields['VALOR UNITÁRIO'];
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => ({ rows: [{ id: '334', fields: { VALORTOTAL: 0 } }] }),
    request: async (operation, payload) => operation !== 'snapshot' ? detail({ item })
      : payload.pageSize === 100 ? snapshot({ rows: [item] }) : snapshot({ rows: [item] }),
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();

  const modal = ctx.root().querySelector('.lg-cluster-modal');
  assert.doesNotMatch(modal.textContent, /Valores conferem/i);
  assert.match(modal.textContent, /não foi possível comparar|valor.*incompleto|total incompleto/i);
  assert.match(modal.textContent, /Total incompleto/i);
});

test('stale launch-page request cannot overwrite a newer cluster cache after gallery refresh', async t => {
  const stale = row(3451); stale.fields = { ...stale.fields, AGRUPAR: '334' };
  const fresh = row(3452); fresh.fields = { ...fresh.fields, AGRUPAR: '334' };
  const staleGroup = deferred(); let groupRequests = 0;
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => ({ rows: [{ id: '334', fields: { VALORTOTAL: 85 } }] }),
    loadLaunchGroup: async () => {
      groupRequests += 1;
      return groupRequests === 1 ? staleGroup.promise : [fresh];
    },
    request: async (operation, payload) => {
      if (operation !== 'snapshot') return detail({ item: fresh });
      return snapshot({ rows: [fresh] });
    },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle();
  const modal = ctx.root().querySelector('.lg-cluster-modal');
  button(modal, 'Fechar').click();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();
  assert.deepEqual([...modal.querySelectorAll('[data-launch-id]')].map(node => node.dataset.launchId), ['3452']);

  staleGroup.resolve([stale]);
  await settle(); await settle();
  assert.deepEqual([...modal.querySelectorAll('[data-launch-id]')].map(node => node.dataset.launchId), ['3452']);
});

test('cluster modal keeps keyboard focus inside the active dialog', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="supplier"]').click();
  await settle(); await settle();
  const modal = ctx.root().querySelector('.lg-cluster-modal');
  const close = button(modal, 'Fechar');
  close.focus();
  const tab = new ctx.dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  close.dispatchEvent(tab);

  assert.equal(tab.defaultPrevented, true);
  assert.equal(ctx.document.activeElement, close);
});

test('order cluster renders expanded SharePoint lookup values as readable text', async t => {
  const item = row(3451); item.fields = { ...item.fields, AGRUPAR: '334' };
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => ({ rows: [{ id: '334', fields: {
      FORNECEDOR: { LookupId: 21, LookupValue: 'Fornecedor da lista' },
      FILIAL: { LookupId: 4, LookupValue: '004 - EDIFÍCIO XAVANTE' },
      VALORTOTAL: 85,
    } }] }),
    request: async (operation, payload) => operation !== 'snapshot' ? detail({ item })
      : payload.pageSize === 100 ? snapshot({ rows: [item] }) : snapshot({ rows: [item] }),
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();
  const modal = ctx.root().querySelector('.lg-cluster-modal');

  assert.match(modal.textContent, /Fornecedor da lista/);
  assert.match(modal.textContent, /004 - EDIFÍCIO XAVANTE/);
  assert.doesNotMatch(modal.textContent, /LookupId|LookupValue/);
});

test('closing the order-cluster modal invalidates its pending result', async t => {
  const loadOrder = deferred();
  const item = row(); item.fields = { ...item.fields, AGRUPAR: '334' };
  const ctx = await setup(t, { loadOrderSnapshot: () => loadOrder.promise,
    request: async operation => operation === 'snapshot' ? snapshot({ rows: [item] }) : detail({ item }) });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  const modal = ctx.root().querySelector('.lg-cluster-modal');
  button(modal, 'Fechar').click();
  loadOrder.resolve({ rows: [{ id: '334', fields: { FORNECEDOR: 'Fornecedor obsoleto' } }] });
  await settle();

  assert.equal(modal.hidden, true);
  assert.doesNotMatch(modal.textContent, /Fornecedor obsoleto/);
});

test('missing order and unlinked AGRUPAR show a safe empty state; Escape closes only the modal', async t => {
  const item = row(3451); item.fields = { ...item.fields, AGRUPAR: '334' };
  const unrelated = row(3450); unrelated.fields = { ...unrelated.fields, AGRUPAR: '335' };
  const ctx = await setup(t, {
    loadOrderSnapshot: async () => ({ rows: [] }),
    loadLaunchGroup: async () => [],
    request: async (operation, payload) => {
      if (operation !== 'snapshot') return detail({ item });
      return payload.pageSize === 100 ? snapshot({ rows: [unrelated] }) : snapshot({ rows: [item] });
    },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-cluster-kind="order"]').click();
  await settle(); await settle();
  const modal = ctx.root().querySelector('.lg-cluster-modal');
  assert.match(modal.textContent, /Pedido #334 não encontrado/);
  assert.match(modal.textContent, /Nenhum lançamento encontrado com AGRUPAR = 334/);
  assert.equal(modal.querySelectorAll('[data-launch-id]').length, 0);

  ctx.root().dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(modal.hidden, true);
  assert.equal(ctx.root().hidden, false);
});

test('launch summary formats SharePoint dates as dd/mm/yyyy and resolves the creator name instead of its numeric lookup id', async t => {
  const item = row(3450);
  item.createdBy = { user: { displayName: 'Bernardo Notini' } };
  item.fields = {
    ...item.fields,
    'DATA DE COMPRA': '2026-09-24T03:00:00Z',
    'DATA DE RMS': '2026-09-24T03:00:00Z',
    MODIFICAÇÕES: '2026-09-25T00:43:17Z',
    'ADICIONADO POR': 1073741822,
  };
  delete item.fields.DATA;
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item] }) : detail({ item }) });

  await ctx.gallery.open();

  const record = ctx.root().querySelector('.lg-record');
  const values = new Map([...record.querySelectorAll('.lg-record-field')].map(pair => [
    pair.querySelector('.lg-record-label').textContent,
    pair.querySelector('.lg-record-value').textContent,
  ]));
  assert.equal(values.get('DATA DE COMPRA'), '24/09/2026');
  assert.equal(values.get('DATA DE RMS'), '24/09/2026');
  assert.equal(values.get('MODIFICAÇÕES'), '24/09/2026');
  assert.equal(values.get('ADICIONADO POR'), 'Bernardo Notini');
  assert.doesNotMatch(record.textContent, /2026-09-24T03:00:00Z|2026-09-25T00:43:17Z|1073741822/);

  button(record, 'Ver mais informações').click();
  record.querySelector('[data-gallery-action="edit"]').click(); await settle();
  assert.ok(ctx.root().querySelector('.lg-editor'), 'the edit form replaces the read-only detail table');
  assert.equal(ctx.root().querySelector('.lg-data-table'), null);
});

test('launch creator lookup ids are never presented as person names when SharePoint omits the expanded identity', async t => {
  const item = row(3451);
  item.fields = { ...item.fields, 'ADICIONADO POR': 1073741822 };
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item] }) : detail({ item }) });

  await ctx.gallery.open();

  const record = ctx.root().querySelector('.lg-record');
  assert.match(record.textContent, /ADICIONADO PORUsuário não identificado/);
  assert.doesNotMatch(record.textContent, /1073741822/);
});

test('launch rows keep the stable pre-parity layout while keeping attachments openable', async t => {
  const item = {
    ...row(3429),
    fields: {
      ...row(3429).fields,
      ID: 3429,
      PRODUTO: 'PREGO 17 X 21',
      FORNECEDOR: 'COFER',
      FILIAL: '004 - EDIFÍCIO XAVANTE',
      'VALOR UNITÁRIO': '11,56',
      QUANTIDADE: 20,
      UNIDADE: 'KG',
      FRETE: '0,00',
      'VALOR TOTAL': '231,20',
      'ID PEDIDO': 245,
      'ADICIONADO POR': 'SHAREPOINT APP EM 21/09/2026 12:12',
      MODIFICAÇÕES: 'SEM MODIFICAÇÕES APÓS CRIAÇÃO',
      'TIPO DE OPERAÇÃO': 'CUSTO',
      AVALIAÇÃO: 'SEM AVALIAÇÃO',
      'FORMA DE PAGAMENTO': 'ENERGÉTICA - CAIXA',
      CONCLUÍDO: 'PEDIDO FINALIZADO',
      APROVAÇÃO: 'PENDENTE DE APROVAÇÃO',
      'ETAPA OBRA': 'ALVENARIA E ESTRUTURAS',
      'DATA DE RMS': '21/09/2026',
      'DATA DE COMPRA': '21/09/2026',
      'DATA DE LIQUIDAÇÃO': '20/09/2026',
      'DATA DE PAGAMENTO': '20/09/2026',
      'QUANTIDADE DE ANEXOS': 3,
    },
    attachments: [{ DisplayName: 'comprovante.pdf', Value: '/sharepoint/comprovante.pdf' }],
  };
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item] }) : detail({ item }) });
  await ctx.gallery.open();
  const record = ctx.root().querySelector('.lg-record');
  assert.equal(record.classList.contains('lg-record--powerapps'), false);
  assert.equal(record.querySelector('.lg-record-select'), null);
  for (const selector of ['.lg-record-media', '.lg-record-heading',
    '.lg-record-commercial', '.lg-record-meta', '.lg-record-execution', '.lg-record-badges']) {
    assert.ok(record.querySelector(selector), selector);
  }
  assert.match(record.querySelector('.lg-record-media').textContent, /PDF|3\s*ANEXOS/i);
  assert.match(record.querySelector('.lg-record-status').textContent, /PEDIDO FINALIZADO/i);
  assert.match(record.querySelector('.lg-record-badges').textContent, /PENDENTE DE APROVAÇÃO/i);
  assert.equal(record.querySelector('[data-lg-action="attachments"]'), null);
  assert.ok(record.querySelector('.lg-record-expand'), 'the row exposes its expand action');
  assert.ok(record.querySelector('[data-gallery-action="edit"]'), 'the pencil opens the edit form');
});

test('launch cards show a PDF marker on the left when any PDF attachment exists', async t => {
  const pdf = { id: 'pdf-17', fileName: 'comprovante.pdf', mimeType: 'application/pdf', mediaUrl: '/api/portal-media/pdf-17' };
  const image = { id: 'image-17', fileName: 'foto.jpg', mimeType: 'image/jpeg', mediaUrl: '/api/portal-media/image-17' };
  const item = { ...row(), attachments: [image, pdf] };
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [item] }) : detail({ item }) });
  await ctx.gallery.open();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media);
  assert.equal(media.dataset.mediaKind, 'pdf');
  assert.match(media.textContent, /PDF/i);
  assert.equal(media.querySelector('img'), null);
});

test('launch cards read PowerApps attachment rows and make the PDF marker openable', async t => {
  const attachments = [
    { DisplayName: 'foto.jpg', Value: '/sharepoint/foto.jpg' },
    { DisplayName: 'comprovante.pdf', Value: '/sharepoint/comprovante.pdf' },
  ];
  const item = { ...row(3429), fields: { ...row(3429).fields, Anexos: attachments, 'Tem anexos': true } };
  let opened;
  const attachmentPayloads = [];
  const ctx = await setup(t, {
    request: async (operation, payload) => {
      if (operation === 'snapshot') return snapshot({ rows: [item] });
      if (operation === 'attachment') {
        attachmentPayloads.push(payload);
        if (!payload.source) throw new Error("[Erro 13] Permission denied: '/var/lib/energetica-whatsapp/launch-gallery'");
        return {
        fileName: payload.fileName,
        mimeType: payload.fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
        mediaUrl: `/api/portal-media/${payload.fileName.replace(/\W+/g, '-').toLowerCase()}`,
        };
      }
      return detail({ item, attachments: [{ fileName: 'comprovante.pdf', mediaUrl: '/api/portal-media/pdf-3429' }] });
    },
    openMediaCollection: async descriptors => { opened = descriptors; },
  });
  await ctx.gallery.open();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media instanceof ctx.dom.window.HTMLButtonElement);
  assert.equal(media.dataset.mediaKind, 'pdf');
  assert.match(media.textContent, /PDF/i);
  media.click(); await settle();
  assert.deepEqual(attachmentPayloads, [
    { id: 3429, fileName: 'foto.jpg', source: '/sharepoint/foto.jpg' },
    { id: 3429, fileName: 'comprovante.pdf', source: '/sharepoint/comprovante.pdf' },
  ]);
  assert.deepEqual(opened, [
    { id: 3429, fileName: 'foto.jpg', mediaUrl: '/api/portal-media/foto-jpg', mimeType: 'image/jpeg' },
    { id: 3429, fileName: 'comprovante.pdf', mediaUrl: '/api/portal-media/comprovante-pdf', mimeType: 'application/pdf' },
  ]);
});

test('launch cards show the actual attachment quantity below the left marker', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open();
  await settle();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media);
  assert.equal(media.querySelector('.lg-record-attachment-count').textContent, '2 anexos');
});

test('launch attachment counting and opening send only the supported item id', async t => {
  const item = { ...row(3451), hasAttachments: true };
  const attachments = [
    { fileName: 'comprovante.pdf', mediaUrl: '/api/portal-media/comprovante' },
    { fileName: 'foto.jpg', mediaUrl: '/api/portal-media/foto' },
  ];
  const detailPayloads = [];
  let opened;
  const ctx = await setup(t, {
    request: async (operation, payload) => {
      if (operation === 'snapshot') return snapshot({ rows: [item] });
      if (operation === 'detail') {
        detailPayloads.push(payload);
        if (Object.keys(payload).some(key => key !== 'id')) {
          throw new Error('O payload contém parâmetros não permitidos.');
        }
        return detail({ item, attachments });
      }
      throw new Error(`unexpected ${operation} ${JSON.stringify(payload)}`);
    },
    openMediaCollection: async descriptors => { opened = descriptors; },
  });

  await ctx.gallery.open();
  await settle();

  const media = ctx.root().querySelector('.lg-record-media');
  assert.deepEqual(detailPayloads, [{ id: item.id }]);
  assert.equal(media.querySelector('.lg-record-attachment-count').textContent, '2 anexos');

  media.click();
  await settle();
  assert.deepEqual(opened, [
    { id: item.id, fileName: 'comprovante.pdf', mediaUrl: '/api/portal-media/comprovante' },
    { id: item.id, fileName: 'foto.jpg', mediaUrl: '/api/portal-media/foto' },
  ]);
  assert.deepEqual(detailPayloads, [{ id: item.id }]);
});

test('clicking a PowerApps attachment marker opens the attachment navigator instead of launch details', async t => {
  const attachments = [
    { DisplayName: 'foto.jpg', Value: '/sharepoint/foto.jpg' },
    { DisplayName: 'comprovante.pdf', Value: '/sharepoint/comprovante.pdf' },
  ];
  const item = { ...row(3432), fields: { ...row(3432).fields, Anexos: attachments, 'Tem anexos': true } };
  let opened;
  const ctx = await setup(t, {
    request: async (operation, payload) => {
      if (operation === 'snapshot') return snapshot({ rows: [item] });
      if (operation === 'attachment') return {
        fileName: payload.fileName,
        mimeType: payload.fileName.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg',
        mediaUrl: `/api/portal-media/${payload.fileName.replace(/\W+/g, '-').toLowerCase()}`,
      };
      throw new Error(`unexpected ${operation} ${JSON.stringify(payload)}`);
    },
    openMediaCollection: async descriptors => { opened = descriptors; },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('.lg-record-media').click(); await settle();
  assert.deepEqual(opened, [
    { id: 3432, fileName: 'foto.jpg', mediaUrl: '/api/portal-media/foto-jpg', mimeType: 'image/jpeg' },
    { id: 3432, fileName: 'comprovante.pdf', mediaUrl: '/api/portal-media/comprovante-pdf', mimeType: 'application/pdf' },
  ]);
  assert.equal(ctx.calls.some(call => call.operation === 'detail'), false);
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
});

test('attachment marker fetches attachments without rendering launch details when the list is not in the snapshot', async t => {
  const item = { ...row(3433), hasAttachments: true, fields: { ...row(3433).fields, 'QUANTIDADE DE ANEXOS': 2 } };
  let opened;
  const ctx = await setup(t, {
    request: async (operation, payload) => {
      if (operation === 'snapshot') return snapshot({ rows: [item] });
      if (operation === 'detail') return detail({ item, attachments: [
        { fileName: 'um.pdf', mediaUrl: '/media/um.pdf' },
        { fileName: 'dois.jpg', mediaUrl: '/media/dois.jpg' },
      ] });
      throw new Error(`unexpected ${operation} ${JSON.stringify(payload)}`);
    },
    openMediaCollection: async descriptors => { opened = descriptors; },
  });
  await ctx.gallery.open();
  ctx.root().querySelector('.lg-record-media').click(); await settle();
  assert.deepEqual(opened, [
    { id: 3433, fileName: 'um.pdf', mediaUrl: '/media/um.pdf' },
    { id: 3433, fileName: 'dois.jpg', mediaUrl: '/media/dois.jpg' },
  ]);
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
});

test('launch cards keep the first PowerApps image as a clickable preview when no PDF exists', async t => {
  const image = { DisplayName: 'foto.jpg', Value: '/sharepoint/foto.jpg' };
  const item = { ...row(3430), fields: { ...row(3430).fields, Anexos: [image], 'Tem anexos': true } };
  let requested;
  const ctx = await setup(t, {
    request: async (operation, payload) => {
      if (operation === 'snapshot') return snapshot({ rows: [item] });
      if (operation === 'attachment') return { fileName: payload.fileName, mimeType: 'image/jpeg', mediaUrl: '/api/portal-media/image-3430' };
      return detail({ item, attachments: [{ fileName: 'foto.jpg', mediaUrl: '/api/portal-media/image-3430' }] });
    },
    loadMediaPreview: async descriptor => { requested = descriptor; return 'blob:https://example.test/preview-image'; },
  });
  await ctx.gallery.open(); await settle();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media instanceof ctx.dom.window.HTMLButtonElement);
  assert.equal(media.dataset.mediaKind, 'image');
  assert.equal(media.querySelector('img')?.src, 'blob:https://example.test/preview-image');
  assert.deepEqual(requested, { fileName: 'foto.jpg', mimeType: 'image/jpeg', mediaUrl: '/api/portal-media/image-3430' });
});

test('a row that only reports attachments still renders an actionable attachment button', async t => {
  const item = { ...row(3431), hasAttachments: true, fields: { ...row(3431).fields, 'QUANTIDADE DE ANEXOS': 3 } };
  const ctx = await setup(t, { request: async operation => operation === 'snapshot' ? snapshot({ rows: [item] }) : detail({ item }) });
  await ctx.gallery.open();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media instanceof ctx.dom.window.HTMLButtonElement);
  assert.equal(media.dataset.mediaKind, 'attachments');
  assert.match(media.textContent, /anexos/i);
});

test('launch cards load the first image preview on the left when no PDF exists', async t => {
  const image = { id: 'image-17', fileName: 'foto.jpg', mimeType: 'image/jpeg', mediaUrl: '/api/portal-media/image-17' };
  let requested;
  const ctx = await setup(t, {
    request: async operation => operation === 'snapshot'
      ? snapshot({ rows: [{ ...row(), attachments: [image] }] }) : detail(),
    loadMediaPreview: async descriptor => { requested = descriptor; return 'blob:https://example.test/preview-image'; },
  });
  await ctx.gallery.open(); await settle();
  const media = ctx.root().querySelector('.lg-record-media');
  assert.ok(media);
  assert.equal(media.dataset.mediaKind, 'image');
  assert.equal(media.querySelector('img')?.src, 'blob:https://example.test/preview-image');
  assert.deepEqual(requested, image);
});

test('summary omits unavailable PowerApps fields instead of rendering empty labels', async t => {
  const minimal = {id: 8, total: 0, hasAttachments: false, fields: {PRODUTO: 'AREIA'}};
  const ctx = await setup(t, {request: async operation => operation === 'snapshot'
    ? snapshot({rows: [minimal]}) : detail({item: minimal})});
  await ctx.gallery.open();
  const record = ctx.root().querySelector('.lg-record');
  assert.ok(record);
  assert.match(record.textContent, /AREIA/);
  assert.doesNotMatch(record.textContent, /undefined|null|DATA DE PAGAMENTO|AVALIAÇÃO/);
});

test('late snapshots cannot replace newer rows or user filter edits and close invalidates loads', async t => {
  const pending = [];
  const ctx = await setup(t, { request: () => { const d = deferred(); pending.push(d); return d.promise; } });
  const first = ctx.gallery.open();
  input(ctx, 'id', '22');
  input(ctx, 'id', 'unsubmitted');
  pending[1].resolve(snapshot({ rows: [row(22)] })); await settle();
  pending[0].resolve(snapshot({ rows: [row(17)] })); await first;
  assert.equal(ctx.root().querySelector('[name="id"]').value, 'unsubmitted');
  assert.doesNotMatch(ctx.root().querySelector('.lg-cards').textContent, /#22\b|#17\b/);
  pending[2].resolve(snapshot({ rows: [row(23)] })); await settle();
  assert.deepEqual([...ctx.root().querySelectorAll('.lg-record-id')].map(node => node.textContent), ['23']);
  input(ctx, 'id', '99');
  ctx.gallery.close(); pending[3].resolve(snapshot({ rows: [row(99)] })); await settle();
  assert.equal(ctx.root().hidden, true);
  assert.doesNotMatch(ctx.root().querySelector('.lg-cards').textContent, /#99\b/);
  assert.equal(ctx.root().getAttribute('aria-busy'), 'false');
});

test('snapshot failure is actionable, retry clears busy and empty results are explicit', async t => {
  let count = 0;
  const ctx = await setup(t, { request: async () => { if (!count++) throw new Error('Sem conexão'); return snapshot({ rows: [], count: 0, pages: 0 }); } });
  await ctx.gallery.open();
  assert.match(ctx.root().textContent, /Sem conexão/);
  assert.equal(ctx.root().getAttribute('aria-busy'), 'false');
  button(ctx.root(), 'Tentar novamente').click(); await settle();
  assert.match(ctx.root().textContent, /Nenhum lançamento/);
  assert.equal(button(ctx.root(), 'Próxima página').disabled, true);
});

test('the editor shows raw existing values without injecting description markup', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open(); await showDetail(ctx);
  const panel = ctx.root().querySelector('.lg-detail');
  assert.equal(panel.querySelector('[name="DESCRIÇÃO"]').value, row().fields.DESCRIÇÃO);
  assert.equal(panel.querySelector('script, iframe'), null);
  assert.ok(panel.querySelector('[name="QUANTIDADE"]'));
  assert.equal(panel.querySelector('table.lg-data-table'), null);
  assert.equal([...ctx.root().querySelectorAll('button')].some(b => /aprovar/i.test(b.textContent)), false);
});

test('the pencil opens the over-gallery editing form and closes back to the gallery', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open(); await showDetail(ctx);
  const panel = ctx.root().querySelector('.lg-detail');
  assert.equal(panel.getAttribute('role'), 'dialog');
  assert.equal(panel.getAttribute('aria-modal'), 'true');
  assert.ok(panel.classList.contains('lg-detail-modal'));
  assert.ok(panel.querySelector('form.lg-editor'));
  assert.equal(panel.querySelector('table.lg-data-table'), null);
  button(panel, 'Fechar edição').click();
  assert.equal(panel.hidden, true);
  assert.equal(ctx.root().hidden, false);
});

test('edit close button is on the left with an X before its accessible label', async t => {
  const ctx = await setup(t);
  const stylesheet = ctx.document.createElement('style');
  stylesheet.textContent = readFileSync(new URL('../src/ui/launch-gallery.css', import.meta.url), 'utf8');
  ctx.document.head.append(stylesheet);
  await ctx.gallery.open(); await showDetail(ctx);
  const close = button(ctx.root().querySelector('.lg-detail'), 'Fechar edição');
  assert.equal(close.parentElement.firstElementChild, close);
  assert.equal(close.getAttribute('aria-label'), 'Fechar edição');
  assert.equal(ctx.dom.window.getComputedStyle(close).order, '0');
  assert.equal(ctx.dom.window.getComputedStyle(close).display, 'inline-flex');
  const iconRule = [...stylesheet.sheet.cssRules].find(rule =>
    rule.selectorText === '.lg-detail-modal:not(.lg-cluster-modal) .lg-detail-close::before');
  assert.match(iconRule?.style.content ?? '', /[×✕]/u);
});

test('Escape closes the detail screen before closing the gallery', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open(); await showDetail(ctx);
  ctx.root().dispatchEvent(new ctx.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
  assert.equal(ctx.root().hidden, false);
});

test('edit is retained during list reload, explicitly reviewed, locked on save and retried without losing draft', async t => {
  const save = deferred(); let attempts = 0;
  const ctx = await setup(t, { request: async op => {
    if (op === 'snapshot') return snapshot();
    if (op === 'detail') return detail();
    if (op === 'update' && !attempts++) return save.promise;
    return { ok: true };
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  const field = input(ctx, 'QUANTIDADE', '3.75', ctx.root().querySelector('.lg-editor'));
  input(ctx, 'id', '17'); await settle();
  assert.equal(ctx.root().querySelector('.lg-editor [name="QUANTIDADE"]'), field);
  button(ctx.root(), 'SUBMETER').click();
  assert.equal(mutations(ctx).length, 0);
  assert.match(ctx.root().querySelector('.lg-review').textContent, /3[.,]75/);
  button(ctx.root(), 'Confirmar alterações').click();
  button(ctx.root(), 'Confirmar alterações').click();
  assert.deepEqual(mutations(ctx), [{ operation: 'update', payload: { id: 17,
    fields: { QUANTIDADE: 3.75 },
    confirm: true, expectedModified: '2026-09-18T12:34:56Z' } }]);
  assert.equal(field.disabled, true);
  save.reject(new Error('Conflito; confira o lançamento')); await settle();
  assert.equal(field.value, '3.75');
  assert.equal(field.disabled, false);
  assert.match(ctx.root().textContent, /Conflito/);
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(mutations(ctx).length, 2);
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true, 'confirmed edit returns to the gallery');
  assert.equal(ctx.root().querySelector('.lg-editor'), null);
  assert.ok(ctx.root().querySelector('.lg-record'), 'the gallery remains available');
  assert.equal(ctx.document.activeElement, ctx.root().querySelector('.lg-record [data-gallery-action="edit"]'),
    'keyboard focus returns to the gallery');
});

test('changing a reviewed input invalidates confirmation; closing and reopening never saves or loses the form', async t => {
  const ctx = await setup(t); await ctx.gallery.open(); await showDetail(ctx);
  input(ctx, 'QUANTIDADE', '4');
  button(ctx.root(), 'SUBMETER').click(); input(ctx, 'QUANTIDADE', '5');
  assert.equal(ctx.root().querySelector('.lg-review')?.hidden ?? true, true);
  ctx.gallery.close(); await ctx.gallery.open();
  assert.equal(ctx.root().querySelector('.lg-editor [name="QUANTIDADE"]').value, '5');
  assert.equal(mutations(ctx).length, 0);
});

test('delete requires explicit confirmation and carries raw Modificado fallback', async t => {
  const item = row(); delete item.fields.Modified; item.fields.Modificado = 'raw-version';
  const ctx = await setup(t, { request: async op => op === 'snapshot' ? snapshot({rows: [item]}) : op === 'detail' ? detail({ item }) : {} });
  await ctx.gallery.open();
  const remove = ctx.root().querySelector('.lg-record [data-gallery-action="delete"]');
  remove.click();
  assert.equal(mutations(ctx).length, 0);
  assert.match(ctx.root().querySelector('.gallery-record-dialog').textContent, /Tem certeza que deseja deletar o item de ID 17/);
  button(ctx.root(), 'Não').click();
  assert.equal(mutations(ctx).length, 0);
  remove.click(); button(ctx.root(), 'Sim').click(); await settle();
  assert.deepEqual(mutations(ctx), [{ operation: 'delete', payload: { id: 17, confirm: true, expectedModified: 'raw-version' } }]);
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
});

test('attachment tray opens the chosen file without leaving the editing form', async t => {
  const viewer = deferred(); const opened = [];
  const ctx = await setup(t, { request: async (op, payload) => op === 'snapshot' ? snapshot() : op === 'detail' ? detail() :
    { mediaUrl: 'https://example.test/two', fileName: payload.fileName, mimeType: 'image/png' },
  openMedia: descriptor => { opened.push(descriptor); return viewer.promise; } });
  await ctx.gallery.open(); await showDetail(ctx);
  assert.deepEqual([...ctx.root().querySelectorAll('.lg-attachment-item')].map(node => node.textContent), ['📎 um.pdf', '📎 dois.png']);
  button(ctx.root(), '📎 dois.png').click(); await settle();
  assert.deepEqual(ctx.calls.at(-1), { operation: 'attachment', payload: { id: 17, fileName: 'dois.png' } });
  assert.deepEqual(opened, [{ mediaUrl: 'https://example.test/two', fileName: 'dois.png', mimeType: 'image/png' }]);
  assert.equal(ctx.root().hidden, true);
  viewer.resolve(); await settle();
  assert.equal(ctx.root().hidden, false);
});

test('new attachment tray and controls use the available editor width', async t => {
  const ctx = await setup(t);
  const stylesheet = ctx.document.createElement('style');
  stylesheet.textContent = readFileSync(new URL('../src/ui/launch-gallery.css', import.meta.url), 'utf8');
  ctx.document.head.append(stylesheet);
  await ctx.gallery.open(); await showDetail(ctx);
  const tray = ctx.root().querySelector('.lg-attachment-add');
  const picker = tray.querySelector('input[type="file"]');
  const submit = button(tray, 'Adicionar anexo');
  assert.equal(ctx.dom.window.getComputedStyle(tray).display, 'grid');
  assert.equal(ctx.dom.window.getComputedStyle(picker).width, '100%');
  assert.equal(ctx.dom.window.getComputedStyle(submit).width, '100%');
});

test('new attachment is confirmed, uploaded to the selected launch and shown below the existing files', async t => {
  const uploads = [];
  let attachments = [{ fileName: 'um.pdf' }, { fileName: 'dois.png' }];
  let modified = '2026-09-18T12:34:56Z';
  const ctx = await setup(t, {
    request: async operation => operation === 'snapshot' ? snapshot()
      : detail({ attachments, item: { ...row(), expectedModified: modified } }),
    upload: async (id, file, options) => {
      uploads.push({ id, file, options });
      attachments = [...attachments, { fileName: file.name }];
      modified = `version-${uploads.length + 1}`;
      return { ok: true };
    },
  });
  await ctx.gallery.open(); await showDetail(ctx);
  const file = new ctx.dom.window.File(['novo'], 'novo.pdf', { type: 'application/pdf' });
  selectAttachment(ctx, file);
  assert.match(ctx.root().querySelector('.lg-attachment-add').textContent, /novo\.pdf/);
  button(ctx.root(), 'Adicionar anexo').click();
  assert.equal(uploads.length, 0, 'choosing a file never uploads it immediately');
  assert.match(ctx.root().querySelector('.lg-review').textContent, /novo\.pdf/);
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].id, 17);
  assert.equal(uploads[0].file, file);
  assert.equal(uploads[0].options.operation, 'attachment_add');
  assert.equal(uploads[0].options.confirm, true);
  assert.equal(uploads[0].options.expectedModified, '2026-09-18T12:34:56Z');
  assert.match(uploads[0].options.requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual([...ctx.root().querySelectorAll('.lg-attachment-item')].map(node => node.textContent),
    ['📎 um.pdf', '📎 dois.png', '📎 novo.pdf']);
  assert.equal(mutations(ctx).length, 0, 'upload is not a field update');
  selectAttachment(ctx, new ctx.dom.window.File(['outro'], 'outro.pdf', { type: 'application/pdf' }));
  button(ctx.root(), 'Adicionar anexo').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads.length, 2);
  assert.equal(uploads[1].options.expectedModified, 'version-2');
  assert.notEqual(uploads[0].options.requestId, uploads[1].options.requestId);
  assert.deepEqual([...ctx.root().querySelectorAll('.lg-attachment-item')].map(node => node.textContent),
    ['📎 um.pdf', '📎 dois.png', '📎 novo.pdf', '📎 outro.pdf']);
});

for (const alreadyUploaded of [false, true]) for (const legacyBlank of [false, true]) {
  test(`attachment-only SUBMETER confirms and finishes without changing fields (uploaded=${alreadyUploaded}, blank=${legacyBlank})`, async t => {
    const uploads = [];
    let attachments = [];
    const item = row();
    if (legacyBlank) item.fields.QUANTIDADE = '';
    const ctx = await setup(t, {
      request: async op => op === 'snapshot' ? snapshot({ rows: [{ ...item, hasAttachments: false }] })
        : detail({ item, attachments }),
      upload: async (id, file, options) => {
        uploads.push({ id, file, options });
        attachments = [{ fileName: file.name }];
        return { fileName: file.name };
      },
    });
    await ctx.gallery.open(); await showDetail(ctx);
    const file = new ctx.dom.window.File(['foto'], 'IMG_4722.jpeg', { type: 'image/jpeg' });
    selectAttachment(ctx, file);
    if (alreadyUploaded) {
      button(ctx.root(), 'Adicionar anexo').click();
      button(ctx.root(), 'Enviar anexo').click(); await settle();
    }
    button(ctx.root(), 'SUBMETER').click();
    const popup = ctx.root().querySelector('.lg-review');
    assert.equal(popup.hidden, false, 'attachments count as a change without unrelated field edits');
    assert.match(popup.textContent, /IMG_4722\.jpeg/);
    assert.equal(uploads.length, alreadyUploaded ? 1 : 0, 'SUBMETER waits for confirmation');
    button(popup, alreadyUploaded ? 'Confirmar alterações' : 'Enviar anexo').click(); await settle();
    assert.equal(uploads.length, 1, 'finishing never reuploads a saved file');
    assert.equal(uploads[0].id, 17);
    assert.equal(uploads[0].file, file);
    assert.equal(uploads[0].options.confirm, true);
    assert.equal(mutations(ctx).length, 0, 'no empty update or unrelated record mutation');
    assert.equal(ctx.root().querySelector('.lg-editor'), null);
    assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
    assert.equal(popup.hidden, true);
    assert.ok(ctx.root().querySelector('.lg-record'), 'returns to the gallery');
  });
}

test('canceling attachment-only SUBMETER preserves the selected file and never uploads it', async t => {
  const uploads = [];
  const ctx = await setup(t, { upload: async (...args) => uploads.push(args) });
  await ctx.gallery.open(); await showDetail(ctx);
  const file = new ctx.dom.window.File(['foto'], 'nova.jpeg', { type: 'image/jpeg' });
  selectAttachment(ctx, file);
  button(ctx.root(), 'SUBMETER').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, false);
  button(ctx.root(), 'Cancelar confirmação').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  assert.equal(ctx.root().querySelector('.lg-attachment-picker').files[0], file);
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, false);
  assert.equal(uploads.length, 0);
});

test('attachment-only lost upload response keeps its reconciliation warning visible before finishing', async t => {
  let attachments = [], uploads = 0;
  const ctx = await setup(t, {
    request: async op => op === 'snapshot' ? snapshot({ rows: [{ ...row(), hasAttachments: false }] }) : detail({ attachments }),
    upload: async (id, file) => {
      uploads++; attachments = [{ fileName: file.name }]; throw new Error('Resposta perdida');
    },
  });
  await ctx.gallery.open(); await showDetail(ctx);
  selectAttachment(ctx, new ctx.dom.window.File(['foto'], 'nova.jpeg'));
  button(ctx.root(), 'SUBMETER').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, false, 'uncertain content remains available for inspection');
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /arquivo com esse nome.*verifique/i);
  assert.equal(uploads, 1);
  button(ctx.root(), 'SUBMETER').click();
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
  assert.equal(uploads, 1);
  assert.equal(mutations(ctx).length, 0);
});

test('attachment-only finish waits for detail refresh and confirmed presence of the stored file', async t => {
  let uploaded = false, visible = false, fail = true, uploads = 0;
  const ctx = await setup(t, {
    request: async op => {
      if (op === 'snapshot') return snapshot({ rows: [{ ...row(), hasAttachments: false }] });
      if (uploaded && fail) throw new Error('Consulta indisponível');
      return detail({ attachments: visible ? [{ fileName: 'nova.jpeg' }] : [] });
    },
    upload: async () => { uploaded = true; uploads++; return { fileName: 'nova.jpeg' }; },
  });
  await ctx.gallery.open(); await showDetail(ctx);
  selectAttachment(ctx, new ctx.dom.window.File(['foto'], 'nova.jpeg'));
  button(ctx.root(), 'SUBMETER').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, false);
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /anexo enviado.*atualiza/i);
  button(ctx.root(), 'SUBMETER').click(); await settle();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  fail = false;
  button(ctx.root(), 'SUBMETER').click(); await settle();
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /novo anexo ainda não aparece/i);
  visible = true;
  button(ctx.root(), 'SUBMETER').click(); await settle();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, false);
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
  assert.equal(uploads, 1);
  assert.equal(mutations(ctx).length, 0);
});

for (const [file, message] of [
  [{ name: 'vazio.pdf', size: 0 }, /não vazio/i],
  [{ name: 'grande.pdf', size: 20 * 1024 * 1024 + 1 }, /20 MB/i],
  [{ name: 'UM.PDF', size: 1 }, /já existe/i],
]) test(`attachment-only SUBMETER rejects invalid selection ${file.name}`, async t => {
  let uploads = 0;
  const ctx = await setup(t, { upload: async () => { uploads++; } });
  await ctx.gallery.open(); await showDetail(ctx);
  selectAttachment(ctx, file);
  button(ctx.root(), 'SUBMETER').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, message);
  assert.equal(uploads, 0);
  assert.equal(mutations(ctx).length, 0);
});

test('attachment-only summary lists each uploaded file and does not leak into a reopened editor', async t => {
  let attachments = [], uploads = 0;
  const ctx = await setup(t, {
    request: async op => op === 'snapshot' ? snapshot({ rows: [{ ...row(), hasAttachments: false }] }) : detail({ attachments }),
    upload: async (id, file) => { uploads++; attachments.push({ fileName: file.name }); return { fileName: file.name }; },
  });
  await ctx.gallery.open(); await showDetail(ctx);
  for (const name of ['um-novo.jpeg', 'outro.pdf']) {
    selectAttachment(ctx, new ctx.dom.window.File(['arquivo'], name));
    button(ctx.root(), 'Adicionar anexo').click();
    button(ctx.root(), 'Enviar anexo').click(); await settle();
  }
  button(ctx.root(), 'SUBMETER').click();
  assert.deepEqual([...ctx.root().querySelectorAll('.lg-review tbody tr')].map(tr => [...tr.cells].map(td => td.textContent)), [
    ['Anexo adicionado', '—', 'um-novo.jpeg'], ['Anexo adicionado', '—', 'outro.pdf'],
  ]);
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  await showDetail(ctx);
  button(ctx.root(), 'SUBMETER').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true, 'old uploads do not create changes in another edit');
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /nenhuma alteração/i);
  assert.equal(uploads, 2);
  assert.equal(mutations(ctx).length, 0);
});

test('adding an attachment preserves unsaved fields and refreshes the SharePoint version', async t => {
  const uploads = []; let attachments = []; let modified = '2026-09-18T12:34:56Z';
  let remoteDescription = row().fields.DESCRIÇÃO;
  let remoteStatus = 'PEDIDO EMPENHADO';
  const ctx = await setup(t, { request: async op => op === 'snapshot' ? snapshot()
    : detail({ attachments, item: { ...row(), expectedModified: modified,
      fields: { ...row().fields, DESCRIÇÃO: remoteDescription, CONCLUÍDO: remoteStatus } } }),
  upload: async (...args) => {
    uploads.push(args);
    attachments = [{ fileName: args[1].name }]; modified = '2026-09-18T12:40:00Z';
    remoteDescription = 'Alterado por colega';
    remoteStatus = 'PEDIDO FINALIZADO';
    return { ok: true, fileName: args[1].name };
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  assert.match(ctx.root().querySelector('.lg-attachments').textContent, /Nenhum anexo/);
  const file = new ctx.dom.window.File(['novo'], 'novo.pdf', { type: 'application/pdf' });
  selectAttachment(ctx, file);
  input(ctx, 'QUANTIDADE', '3');
  button(ctx.root(), 'Adicionar anexo').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, false);
  assert.equal(ctx.root().querySelector('[name="QUANTIDADE"]').value, '3');
  assert.equal(uploads.length, 0);
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads.length, 1);
  assert.equal(ctx.root().querySelector('[name="QUANTIDADE"]').value, '3');
  assert.equal(ctx.root().querySelector('[name="DESCRIÇÃO"]').value, 'Alterado por colega');
  assert.equal(ctx.root().querySelector('[name="CONCLUÍDO"]').value, 'PEDIDO FINALIZADO');
  assert.equal(ctx.root().querySelector('[name="CONCLUÍDO"]').nextElementSibling.querySelector('.sfs-value').value, 'Finalizado');
  assert.deepEqual([...ctx.root().querySelectorAll('.lg-attachment-item')].map(node => node.textContent), ['📎 novo.pdf']);
  button(ctx.root(), 'SUBMETER').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, false);
  assert.deepEqual(ctx.calls.at(-1), { operation: 'detail', payload: { id: 17 } });
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(ctx.calls.findLast(call => call.operation === 'update').payload.expectedModified, '2026-09-18T12:40:00Z');
  assert.equal(ctx.calls.findLast(call => call.operation === 'update').payload.fields.QUANTIDADE, 3);
  assert.equal(Object.hasOwn(ctx.calls.findLast(call => call.operation === 'update').payload.fields, 'DESCRIÇÃO'), false);
  assert.equal(Object.hasOwn(ctx.calls.findLast(call => call.operation === 'update').payload.fields, 'CONCLUÍDO'), false);
});

test('a concurrent change to an edited field keeps the draft but blocks a stale update', async t => {
  let attachments = []; let quantity = 2.5;
  const ctx = await setup(t, { request: async op => op === 'snapshot' ? snapshot()
    : detail({ attachments, item: { ...row(), fields: { ...row().fields, QUANTIDADE: quantity } } }),
  upload: async (id, file) => { attachments = [{ fileName: file.name }]; quantity = 5; return { fileName: file.name }; } });
  await ctx.gallery.open(); await showDetail(ctx);
  input(ctx, 'QUANTIDADE', '4');
  selectAttachment(ctx, new ctx.dom.window.File(['novo'], 'novo.pdf'));
  button(ctx.root(), 'Adicionar anexo').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(ctx.root().querySelector('[name="QUANTIDADE"]').value, '4');
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /campo editado mudou/i);
  button(ctx.root(), 'SUBMETER').click(); await settle();
  assert.equal(ctx.calls.some(call => call.operation === 'update'), false);
});

test('a failed detail refresh after upload keeps the draft and retries before reviewing fields', async t => {
  let attachments = []; let failRefresh = true; let uploaded = false;
  const ctx = await setup(t, { request: async op => {
    if (op === 'snapshot') return snapshot();
    if (uploaded && failRefresh) { failRefresh = false; throw new Error('Detalhe indisponível'); }
    return detail({ attachments, item: { ...row(), expectedModified: uploaded ? 'new-version' : 'old-version' } });
  }, upload: async (id, file) => {
    uploaded = true; attachments = [{ fileName: file.name }]; return { fileName: file.name };
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  input(ctx, 'QUANTIDADE', '4');
  selectAttachment(ctx, new ctx.dom.window.File(['novo'], 'novo.pdf'));
  button(ctx.root(), 'Adicionar anexo').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(ctx.root().querySelector('[name="QUANTIDADE"]').value, '4');
  assert.deepEqual([...ctx.root().querySelectorAll('.lg-attachment-item')].map(node => node.textContent), ['📎 novo.pdf']);
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /Anexo enviado.*atualiza/i);
  button(ctx.root(), 'SUBMETER').click(); await settle();
  assert.equal(ctx.root().querySelector('[name="QUANTIDADE"]').value, '4');
  assert.equal(ctx.root().querySelector('.lg-review').hidden, false);
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(ctx.calls.findLast(call => call.operation === 'update').payload.expectedModified, 'new-version');
});

test('failed attachment upload keeps the confirmation and retry identity', async t => {
  const uploads = [];
  const ctx = await setup(t, { upload: async (id, file, options) => {
    uploads.push({ id, file, options });
    if (uploads.length === 1) throw new Error('Falha no envio');
    return { ok: true };
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  selectAttachment(ctx, new ctx.dom.window.File(['novo'], 'novo.pdf', { type: 'application/pdf' }));
  button(ctx.root(), 'Adicionar anexo').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /Falha no envio/);
  assert.equal(ctx.root().querySelector('.lg-review').hidden, false);
  assert.match(ctx.root().querySelector('.lg-review [role="alert"]').textContent, /Falha no envio/);
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].options.requestId, uploads[1].options.requestId);
});

test('lost upload response reconciles the stored file before another write', async t => {
  let attachments = []; let modified = 'old-version'; const uploads = [];
  const ctx = await setup(t, { request: async op => op === 'snapshot' ? snapshot()
    : detail({ attachments, item: { ...row(), expectedModified: modified } }),
  upload: async (id, file, options) => {
    uploads.push(options);
    attachments = [{ fileName: file.name }]; modified = 'new-version';
    throw new Error('Resposta perdida');
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  input(ctx, 'QUANTIDADE', '4');
  selectAttachment(ctx, new ctx.dom.window.File(['novo'], 'novo.pdf'));
  button(ctx.root(), 'Adicionar anexo').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads.length, 1);
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /arquivo com esse nome.*verifique/i);
  assert.equal(ctx.root().querySelector('[name="QUANTIDADE"]').value, '4');
  assert.deepEqual([...ctx.root().querySelectorAll('.lg-attachment-item')].map(node => node.textContent), ['📎 novo.pdf']);
  button(ctx.root(), 'SUBMETER').click();
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(ctx.calls.findLast(call => call.operation === 'update').payload.expectedModified, 'new-version');
});

test('a rejected duplicate name is never reported as an uploaded attachment', async t => {
  let checked = false; let uploads = 0;
  const ctx = await setup(t, { request: async op => op === 'snapshot' ? snapshot()
    : detail({ attachments: checked ? [{ fileName: 'nota.pdf' }] : [] }),
  upload: async () => {
    uploads += 1; checked = true;
    throw Object.assign(new Error('Já existe um anexo com esse nome; nenhum arquivo foi sobrescrito.'), { status: 409 });
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  selectAttachment(ctx, new ctx.dom.window.File(['novo'], 'nota.pdf'));
  button(ctx.root(), 'Adicionar anexo').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads, 1);
  assert.equal(ctx.root().querySelector('.lg-review').hidden, false);
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /já existe um anexo/i);
  assert.doesNotMatch(ctx.root().querySelector('[role="alert"]').textContent, /anexo enviado/i);
});

test('the picker rejects an existing attachment name before sending', async t => {
  let uploads = 0;
  const ctx = await setup(t, { upload: async () => { uploads += 1; } });
  await ctx.gallery.open(); await showDetail(ctx);
  selectAttachment(ctx, new ctx.dom.window.File(['outro'], 'UM.PDF'));
  button(ctx.root(), 'Adicionar anexo').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /já existe um anexo/i);
  assert.equal(uploads, 0);
});

test('an uncertain upload waits for a successful detail check instead of uploading twice', async t => {
  let stored = false; let detailFailures = 2; let uploads = 0;
  const ctx = await setup(t, { request: async op => {
    if (op === 'snapshot') return snapshot();
    if (stored && detailFailures-- > 0) throw new Error('Consulta indisponível');
    return detail({ attachments: stored ? [{ fileName: 'novo.pdf' }] : [] });
  }, upload: async () => { uploads += 1; stored = true; throw new Error('Resposta perdida'); } });
  await ctx.gallery.open(); await showDetail(ctx);
  selectAttachment(ctx, new ctx.dom.window.File(['novo'], 'novo.pdf'));
  button(ctx.root(), 'Adicionar anexo').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads, 1);
  assert.equal(ctx.root().querySelector('.lg-review').hidden, false);
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads, 1, 'an unavailable detail response must not trigger a second write');
  assert.equal(ctx.root().querySelector('.lg-review').hidden, false);
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads, 1);
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  assert.deepEqual([...ctx.root().querySelectorAll('.lg-attachment-item')].map(node => node.textContent), ['📎 novo.pdf']);
});

test('cancelling an uncertain confirmation still checks the server before a new attempt', async t => {
  let stored = false; let failDetail = true; let uploads = 0;
  const ctx = await setup(t, { request: async op => {
    if (op === 'snapshot') return snapshot();
    if (stored && failDetail) { failDetail = false; throw new Error('Consulta indisponível'); }
    return detail({ attachments: stored ? [{ fileName: 'novo.pdf' }] : [] });
  }, upload: async () => { uploads += 1; stored = true; throw new Error('Resposta perdida'); } });
  await ctx.gallery.open(); await showDetail(ctx);
  selectAttachment(ctx, new ctx.dom.window.File(['novo'], 'novo.pdf'));
  button(ctx.root(), 'Adicionar anexo').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  button(ctx.root(), 'Cancelar confirmação').click();
  button(ctx.root(), 'Adicionar anexo').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads, 1);
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
});

test('cancelling an uncertain attachment retry keeps its request identity', async t => {
  const uploads = [];
  const ctx = await setup(t, { upload: async (id, file, options) => {
    uploads.push(options.requestId); throw new Error('Conexão interrompida');
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  selectAttachment(ctx, new ctx.dom.window.File(['novo'], 'novo.pdf', { type: 'application/pdf' }));
  button(ctx.root(), 'Adicionar anexo').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  button(ctx.root(), 'Cancelar confirmação').click();
  button(ctx.root(), 'Adicionar anexo').click();
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0], uploads[1]);
});

test('changing the selected attachment invalidates its prior confirmation', async t => {
  const uploads = [];
  const ctx = await setup(t, { upload: async (...args) => uploads.push(args) });
  await ctx.gallery.open(); await showDetail(ctx);
  selectAttachment(ctx, new ctx.dom.window.File(['um'], 'primeiro.pdf', { type: 'application/pdf' }));
  button(ctx.root(), 'Adicionar anexo').click();
  assert.match(ctx.root().querySelector('.lg-review').textContent, /primeiro\.pdf/);
  selectAttachment(ctx, new ctx.dom.window.File(['dois'], 'segundo.pdf', { type: 'application/pdf' }));
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  button(ctx.root(), 'Adicionar anexo').click();
  assert.match(ctx.root().querySelector('.lg-review').textContent, /segundo\.pdf/);
  button(ctx.root(), 'Enviar anexo').click(); await settle();
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0][1].name, 'segundo.pdf');
});

test('an attachment above the gallery limit is rejected before confirmation', async t => {
  const ctx = await setup(t);
  await ctx.gallery.open(); await showDetail(ctx);
  selectAttachment(ctx, { name: 'grande.pdf', size: 20 * 1024 * 1024 + 1 });
  button(ctx.root(), 'Adicionar anexo').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  assert.match(ctx.root().querySelector('[role="alert"]').textContent, /20 MB/);
});

test('stale detail responses are discarded and failed detail can be retried', async t => {
  const one = deferred(), two = deferred(); let count = 0;
  const ctx = await setup(t, { request: async op => op === 'snapshot'
    ? snapshot({ rows: [{ ...row(17), hasAttachments: false }, { ...row(18), hasAttachments: false }] })
    : ++count === 1 ? one.promise : count === 2 ? two.promise : detail({ item: row(18) }) });
  await ctx.gallery.open();
  const buttons = [...ctx.root().querySelectorAll('[data-gallery-action="edit"]')];
  buttons[0].click(); buttons[1].click();
  two.reject(new Error('Falha ao abrir')); await settle();
  one.resolve(detail()); await settle();
  assert.match(ctx.root().querySelector('.lg-detail').textContent, /Falha ao abrir/);
  button(ctx.root().querySelector('.lg-detail'), 'Tentar novamente').click(); await settle();
  assert.match(ctx.root().querySelector('.lg-detail').textContent, /#18/);
});

test('invalid periods and required fields prevent review and calls; editing blocks replacement of its detail', async t => {
  const ctx = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [{ ...row(), hasAttachments: false }] }) : detail() });
  await ctx.gallery.open();
  input(ctx, 'dateStart', '2026-10-01'); input(ctx, 'dateEnd', '2026-09-01');
  await settle();
  assert.equal(ctx.calls.filter(call => call.operation === 'snapshot').length, 2);
  assert.match(ctx.root().querySelector('[role=alert]').textContent, /data final/);
  await showDetail(ctx);
  button(ctx.root(), 'SUBMETER').click();
  assert.equal(ctx.root().querySelector('.lg-review').hidden, true);
  const form = ctx.root().querySelector('.lg-editor');
  input(ctx, 'QUANTIDADE', '12', form);
  ctx.root().querySelector('[data-gallery-action="edit"]').click(); await settle();
  assert.equal(ctx.root().querySelector('.lg-editor'), form);
  assert.equal(form.querySelector('[name="QUANTIDADE"]').value, '12');
  assert.equal(ctx.calls.filter(c => c.operation === 'detail').length, 1);
  assert.equal(mutations(ctx).length, 0);
});

test('viewer returning after loading restores gallery while its top-layer dialog remains open', async t => {
  let modal;
  const ctx = await setup(t, { openMedia: async () => {
    modal = ctx.document.createElement('dialog'); modal.setAttribute('open', ''); ctx.document.body.append(modal);
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  button(ctx.root(), '📎 um.pdf').click(); await settle();
  assert.equal(ctx.root().hidden, false);
  assert.equal(modal.hasAttribute('open'), true);
  assert.equal(button(ctx.root(), '📎 um.pdf').disabled, false);
  assert.equal(ctx.root().getAttribute('aria-busy'), 'false');
});

test('attachment read and viewer failures leave actionable errors with a usable overlay', async t => {
  let fetches = 0;
  const ctx = await setup(t, { request: async op => {
    if (op === 'snapshot') return snapshot(); if (op === 'detail') return detail();
    if (!fetches++) throw new Error('Arquivo expirado');
    return { fileName: 'um.pdf', mediaUrl: '/one', mimeType: 'application/pdf' };
  }, openMedia: async () => { throw new Error('Viewer indisponível'); } });
  await ctx.gallery.open(); await showDetail(ctx);
  for (const message of ['Arquivo expirado', 'Viewer indisponível']) {
    button(ctx.root(), '📎 um.pdf').click(); await settle();
    assert.equal(ctx.root().hidden, false);
    assert.equal(ctx.root().getAttribute('aria-busy'), 'false');
    assert.ok(ctx.root().querySelector('[role=alert]').textContent.includes(message));
  }
});

test('a confirmed edit returns to the gallery without reloading details or resending the mutation', async t => {
  let details = 0;
  const ctx = await setup(t, { request: async (op, payload) => {
    if (op === 'snapshot') return snapshot({ rows: [{ ...row(), hasAttachments: false }] });
    if (op === 'detail') { if (++details === 2) throw new Error('Falha na atualização'); return detail(); }
    return { ok: true };
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  input(ctx, 'QUANTIDADE', '4');
  button(ctx.root(), 'SUBMETER').click(); button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(ctx.root().querySelector('.lg-editor'), null);
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
  assert.equal(details, 1);
  assert.equal(mutations(ctx).length, 1);
  await showDetail(ctx);
  assert.match(ctx.root().querySelector('.lg-detail').textContent, /Falha na atualização/);
  button(ctx.root().querySelector('.lg-detail'), 'Tentar novamente').click(); await settle();
  assert.equal(mutations(ctx).length, 1);
  assert.ok(ctx.root().querySelector('.lg-editor'));
});

test('confirmed edit restores gallery focus while its list refresh is pending', async t => {
  const refresh = deferred(); let snapshots = 0;
  const ctx = await setup(t, { request: async op => {
    if (op === 'snapshot') return ++snapshots === 2 ? refresh.promise : snapshot();
    if (op === 'detail') return detail();
    return { ok: true };
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  input(ctx, 'QUANTIDADE', '4');
  button(ctx.root(), 'SUBMETER').click();
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  assert.equal(ctx.root().querySelector('.lg-detail').hidden, true);
  assert.equal(ctx.document.activeElement, button(ctx.root(), 'Voltar'));
  refresh.resolve(snapshot()); await settle();
  assert.equal(ctx.document.activeElement, ctx.root().querySelector('.lg-record [data-gallery-action="edit"]'));
});

test('a stale edit refresh does not steal focus after closing and reopening the gallery', async t => {
  const refresh = deferred(); let snapshots = 0;
  const ctx = await setup(t, { request: async op => {
    if (op === 'snapshot') return ++snapshots === 2 ? refresh.promise : snapshot();
    if (op === 'detail') return detail();
    return { ok: true };
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  input(ctx, 'QUANTIDADE', '4');
  button(ctx.root(), 'SUBMETER').click();
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  ctx.gallery.close(); await ctx.gallery.open();
  const filter = ctx.root().querySelector('[name="id"]');
  filter.focus();
  refresh.resolve(snapshot()); await settle();
  assert.equal(ctx.document.activeElement, filter);
});

test('an edit refresh respects focus moved to a filter in the same gallery session', async t => {
  const refresh = deferred(); let snapshots = 0;
  const ctx = await setup(t, { request: async op => {
    if (op === 'snapshot') return ++snapshots === 2 ? refresh.promise : snapshot();
    if (op === 'detail') return detail();
    return { ok: true };
  } });
  await ctx.gallery.open(); await showDetail(ctx);
  input(ctx, 'QUANTIDADE', '4');
  button(ctx.root(), 'SUBMETER').click();
  button(ctx.root(), 'Confirmar alterações').click(); await settle();
  const filter = ctx.root().querySelector('[name="id"]');
  filter.focus();
  refresh.resolve(snapshot()); await settle();
  assert.equal(ctx.document.activeElement, filter);
});

test('gallery stylesheet keeps tools/signature above it and hidden overlays out of hit testing', async t => {
  const ctx = await setup(t); await ctx.gallery.open();
  const style = ctx.document.createElement('style');
  style.textContent = readFileSync(new URL('../src/ui/launch-gallery.css', import.meta.url), 'utf8');
  ctx.document.head.append(style);
  const computed = ctx.dom.window.getComputedStyle(ctx.root());
  assert.equal(computed.position, 'fixed');
  assert.ok(Number(computed.zIndex) > 2 && Number(computed.zIndex) < 20);
  assert.equal(ctx.dom.window.getComputedStyle(button(ctx.root(), 'Voltar')).minHeight, '44px');
  ctx.gallery.close();
  assert.equal(ctx.dom.window.getComputedStyle(ctx.root()).display, 'none');
});

test('gallery stylesheet keeps the stable row grid and reflows every record on mobile', () => {
  const css = readFileSync(new URL('../src/ui/launch-gallery.css', import.meta.url), 'utf8');
  assert.match(css, /--lg-navy:\s*#0b3764/i);
  assert.match(css, /--lg-red:\s*#b51f24/i);
  assert.match(css, /\.lg-record\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.lg-record--with-media\s*\{[^}]*grid-template-columns:\s*\d+px\s+minmax\(0,\s*1fr\)/s);
  assert.match(css, /\.lg-record--with-media\s*\{[^}]*align-items:\s*stretch/s);
  assert.match(css, /\.lg-record-media\s*\{[^}]*align-self:\s*stretch/s);
  assert.match(css, /\.lg-record-content\s*\{[^}]*display:\s*grid/s);
  assert.doesNotMatch(css, /\.lg-record--powerapps\s*\{/);
  assert.doesNotMatch(css, /\.lg-record-select\s*\{/);
  assert.match(css, /\.lg-record-media\s*\{[^}]*cursor:\s*pointer/s);
  assert.match(css, /\.lg-record-media\s*\{[^}]*background:\s*var\(--lg-sky\)/s);
  assert.match(css, /\.lg-record-media\s*\{[^}]*align-self:\s*stretch/s);
  assert.match(css, /\.lg-record-media\s*\{[^}]*grid-row:\s*1/s);
  assert.match(css, /\.lg-record-content\s*\{[^}]*grid-row:\s*1/s);
  assert.match(css, /\.lg-record--with-media\s+\.lg-record-content\s*\{[^}]*grid-column:\s*2/s);
  const baseContent = css.match(/\.lg-record-content\s*\{([^}]*)\}/)?.[1] ?? '';
  assert.doesNotMatch(baseContent, /grid-column:\s*2/);
  assert.match(css, /\.lg-cluster-table-wrap\s*\{[^}]*overflow:\s*auto/s);
  assert.match(css, /\.lg-record-badge[^}]*overflow-wrap:\s*anywhere/s);
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*\.lg-record-main\s*\{[^}]*grid-template-columns:\s*1fr/s);
  assert.match(css, /\.lg-record-extra\s*>\s*\.lg-button\s*\{[^}]*min-height:\s*44px/s);
});

test('mobile edit styles keep two form columns and pencil/X side by side', () => {
  const css = readFileSync(new URL('../src/ui/launch-gallery.css', import.meta.url), 'utf8');
  const actions = readFileSync(new URL('../src/ui/gallery-record-actions.css', import.meta.url), 'utf8');
  assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*?\.lg-editor-grid\s*\{\s*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
  assert.match(css, /\.lg-editor-actions\s*\{[^}]*grid-template-columns:\s*repeat\(2/);
  assert.match(css, /\.lg-editor-actions\s*>\s*\.lg-editor-cancel\s*\{[^}]*background:\s*#b91c24/);
  assert.match(css, /\.lg-editor-actions\s*>\s*\.lg-editor-review\s*\{[^}]*background:\s*#167044/);
  assert.match(actions, /\.gallery-record-card\.lg-record\s*>\s*\.gallery-record-actions\s*\{\s*flex-direction:\s*row/);
});

test('launch summary and its blue divider span the action column without covering the edit controls', async t => {
  const withMedia = await setup(t);
  await withMedia.gallery.open();
  const css = [
    '../src/ui/launch-gallery.css',
    '../src/ui/gallery-record-actions.css',
  ].map(path => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
  const style = withMedia.document.createElement('style');
  style.textContent = css;
  withMedia.document.head.append(style);
  const card = withMedia.root().querySelector('.lg-record--with-media');
  const content = card.querySelector('.lg-record-content');
  const heading = card.querySelector('.lg-record-heading');
  const actions = card.querySelector('.gallery-record-actions');
  assert.equal(withMedia.dom.window.getComputedStyle(content).gridColumn, '2 / -1');
  assert.ok(parseFloat(withMedia.dom.window.getComputedStyle(heading).paddingRight) >= 108);
  assert.equal(withMedia.dom.window.getComputedStyle(actions).gridColumn, '-2 / -1');

  const withoutMedia = await setup(t, { request: async operation => operation === 'snapshot'
    ? snapshot({ rows: [{ ...row(18), hasAttachments: false }] }) : detail() });
  await withoutMedia.gallery.open();
  const plainStyle = withoutMedia.document.createElement('style');
  plainStyle.textContent = css;
  withoutMedia.document.head.append(plainStyle);
  const plainContent = withoutMedia.root().querySelector('.lg-record-content');
  assert.equal(withoutMedia.dom.window.getComputedStyle(plainContent).gridColumn, '1 / -1');
});

test('mobile launch attachment rail has room for the clip and both labels', () => {
  const actions = readFileSync(new URL('../src/ui/gallery-record-actions.css', import.meta.url), 'utf8');
  const mobileRules = actions.match(/@media\s*\(max-width:\s*480px\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const railWidth = Number(mobileRules.match(/\.gallery-record-card\.lg-record--with-media\s*\{\s*grid-template-columns:\s*(\d+)px/)?.[1]);
  assert.ok(railWidth >= 68, `attachment rail is only ${railWidth}px wide on phones`);
});

test('Windows PWA entrypoint includes the launch gallery stylesheet', () => {
  const entry = readFileSync(new URL('../src/web/main.js', import.meta.url), 'utf8');
  assert.match(entry, /import\s+["']\.\.\/ui\/launch-gallery\.css["'];/);
  assert.match(entry, /import\s+["']\.\.\/ui\/gallery-record-actions\.css["'];/);
});

test('late pencil response cannot overwrite an editor reopened in a new gallery session', async t => {
  const pending = deferred();
  let detailCount = 0;
  const item = { ...row(), hasAttachments: false };
  const ctx = await setup(t, { request: async operation => {
    if (operation === 'snapshot') return snapshot({ rows: [item] });
    if (operation === 'detail' && ++detailCount === 1) return pending.promise;
    return detail({ item });
  } });
  await ctx.gallery.open();
  ctx.root().querySelector('[data-gallery-action="edit"]').click();
  await settle();
  ctx.gallery.close();
  await ctx.gallery.open();
  assert.ok(ctx.root().querySelector('.lg-editor'));
  pending.resolve(detail({ item: { ...row(99), hasAttachments: false } }));
  await settle();
  assert.match(ctx.root().querySelector('.lg-detail-header').textContent, /#17/);
});

test('pencil brings the launch editing form into view', async t => {
  const ctx = await setup(t);
  const scrolled = [];
  ctx.dom.window.HTMLElement.prototype.scrollIntoView = function () { scrolled.push(this); };
  await ctx.gallery.open();
  ctx.root().querySelector('[data-gallery-action="edit"]').click();
  await settle();
  const form = ctx.root().querySelector('.lg-editor');
  assert.ok(form);
  assert.ok(scrolled.includes(form), 'pencil exposes the form beyond the long details table');
});
