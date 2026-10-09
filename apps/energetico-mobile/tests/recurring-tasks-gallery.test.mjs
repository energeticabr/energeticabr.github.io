import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatMarkup } from '../src/ui/chat-view.js';
import { createRegistrationGalleryData } from '../src/chat/registration-gallery-data.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { createRegistrationGalleryFilterData } from '../src/chat/registration-gallery-filter-data.js';

const column = (name, displayName = name, extra = {}) => ({ name, displayName, ...extra });
const page = items => ({ items, hasMore: false });
const record = (id, fields) => ({ id: String(id), fields, hasAttachments: false });
const option = (id, label) => ({ id, reply: id, label });
const menuOptions = [option('action_task', '📝 ADICIONAR UMA NOVA TAREFA'), option('action_task_completion', '✅ FINALIZAR UMA TAREFA'),
  option('action_recurring_task_registration', '🔁 CADASTRAR TAREFA RECORRENTE')];

test('Demandas pairs recurring registration with its gallery and preserves the ordinary task gallery', () => {
  const state = { sessionStatus: 'authenticated', account: { name: 'Bernardo' }, pendingFiles: [], draft: '', messages: [{
    id: 'demandas', role: 'assistant', type: 'poll', question: '📋 DEMANDAS\nQUAL FLUXO VOCÊ DESEJA INICIAR?',
    options: [...menuOptions, option('action_recurring_tasks_gallery', 'OLD')],
  }] };
  const dom = new JSDOM(renderChatMarkup(state));
  const pairs = [...dom.window.document.querySelectorAll('.chat-menu-gallery-pair')];
  assert.deepEqual(pairs.map(pair => [...pair.querySelectorAll('[data-reply-id]')].map(button => button.dataset.replyId)), [
    ['action_task', 'action_tasks_gallery'], ['action_task_completion'], ['action_recurring_task_registration', 'action_recurring_tasks_gallery'],
  ]);
  assert.equal(dom.window.document.querySelectorAll('[data-reply-id="action_recurring_tasks_gallery"]').length, 1);
  dom.window.close();
  state.messages[0].question = 'INFORME A RECORRÊNCIA';
  state.messages[0].options = menuOptions;
  const form = new JSDOM(renderChatMarkup(state));
  assert.equal(form.window.document.querySelector('[data-gallery-button]'), null);
  form.window.close();
});

test('recurring tasks preserve source order across pages and display metadata aliases', async t => {
  const data = createRegistrationGalleryData({ kind: 'recurringTasks', repository: {
    async resolveList(site, aliases) { assert.equal(site, 'personal'); assert.equal(aliases[0], 'TAREFASRECORRENTES'); return { status: 'resolved', id: 'recurring' }; },
    async getColumns() { return [column('ASSOCIA_x00c7__x00c3_O', 'ASSOCIAÇÃO')]; },
    async getItemsPage(site, list, query, options) { return options.cursor ? page([record(3, { TAREFA: 'OUTRA', STATUS: 'INATIVO' })]) : {
      items: [record(1, { TAREFA: 'PAGAR TAXAS', STATUS: 'ATIVO', ASSOCIA_x00c7__x00c3_O: 'SEDE', FORNECEDOR: 'BERNARDO', FILIAL: 'CENTRAL', RECORRENCIA: { Value: 'MENSAL' }, COBRAR: 'SIM', PRIORITARIA: 'ATIVIDADE PRIORITÁRIA', DATA: '2026-10-01', DATACRIARNOVAMENTE: '2026-11-01', DATAVENCIMENTO: '2026-11-02' }),
        record(9, { TAREFA: 'INSPECIONAR', STATUS: 'ATIVO', ASSOCIA_x00c7__x00c3_O: 'OBRA', RECORRENCIA: 'SEMANAL', COBRAR: 'NÃO' })], hasMore: true, nextLink: 'next',
    }; },
  } });
  const snapshot = await data.loadSnapshot();
  assert.deepEqual(snapshot.rows.map(row => row.id), ['1', '9', '3']);
  assert.equal(snapshot.rows[0].fields['ASSOCIAÇÃO'], 'SEDE');
  const dom = new JSDOM('<!doctype html><body></body>');
  const doc = dom.window.document;
  const gallery = createRegistrationGallery({ document: doc, kind: 'recurringTasks', data: { async loadSnapshot() { return snapshot; } } });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  const ids = () => [...doc.querySelectorAll('[data-registration-row]')].map(node => node.dataset.registrationRow);
  assert.deepEqual(ids(), ['1', '9']);
  assert.equal(doc.querySelector('h1').textContent, 'GALERIA DE TAREFAS RECORRENTES');
  assert.equal(doc.querySelector('[data-filter-field="STATUS"]').value, 'ATIVO');
  assert.deepEqual([...doc.querySelectorAll('[data-filter-field]')].map(control => control.dataset.filterField), ['FORNECEDOR', 'FILIAL', 'RECORRENCIA', 'COBRAR', 'PRIORITARIA', 'STATUS', 'ASSOCIAÇÃO']);
  assert.equal(doc.querySelector('[data-field="DATACRIARNOVAMENTE"] dd').textContent, '01/11/2026');
  assert.equal(doc.querySelector('[data-field="DATAVENCIMENTO"] dd').textContent, '02/11/2026');
  assert.ok(doc.querySelector('[data-gallery-action="edit"]'));
  doc.querySelector('[data-gallery-action="delete"]').click();
  assert.match(doc.querySelector('[data-gallery-record-dialog]').textContent, /Tem certeza que deseja deletar o item de ID 1\?/);
  doc.querySelector('[data-gallery-confirm="no"]').click();
  assert.equal(doc.querySelector('[data-gallery-record-dialog]'), null);
  const recurrence = doc.querySelector('[data-filter-field="RECORRENCIA"]');
  recurrence.value = 'MENSAL'; recurrence.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  assert.deepEqual(ids(), ['1']);
  recurrence.value = ''; recurrence.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  const search = doc.querySelector('input[type="search"]');
  search.value = 'SEDE'; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual(ids(), ['1'], 'quick search also covers the branch');
  search.value = '  pagar  '; search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.deepEqual(ids(), ['1']);
});

test('recurring editing uses Form14_1 closed fields and original ETags for changes and deletion', async () => {
  const writes = [];
  const fields = { TAREFA: 'PAGAR TAXAS', ASSOCIA_x00c7__x00c3_O: 'SEDE', FORNECEDOR: 'BERNARDO', FILIAL: 'CENTRAL',
    RECORRENCIA: 'MENSAL', COBRAR: 'SIM', PRIORITARIA: 'ATIVIDADE PRIORITÁRIA', STATUS: 'ATIVO', DATA: '2026-10-01', DATACRIARNOVAMENTE: '2026-11-01', DATAVENCIMENTO: '2026-11-02' };
  const data = createRegistrationGalleryData({ kind: 'recurringTasks', repository: {
    async resolveList() { return { status: 'resolved', id: 'recurring' }; },
    async getColumns() { return Object.keys(fields).map(name => name === 'RECORRENCIA' ? column(name, name, { choice: { choices: ['MENSAL', 'SEMANAL'] } })
      : name.startsWith('DATA') ? column(name, name, { dateTime: { format: 'dateOnly' } }) : column(name, name, { text: {} })); },
    async getItem(site, list, id) { return { id, eTag: '"recurring-v1"', fields }; },
    async updateItem(site, list, id, values, options) { writes.push({ id, values, options }); },
    async deleteItem(site, list, id, options) { writes.push({ id, options }); },
  } });
  const context = await data.loadEditor('1');
  assert.equal(context.contract.formVariant.formName, 'Form14_1');
  assert.equal(context.columns.some(column => column.name === 'DATA'), false, 'creation date is absent from the edit form');
  for (const field of ['FORNECEDOR', 'FILIAL', 'RECORRENCIA', 'COBRAR', 'PRIORITARIA', 'STATUS', 'ASSOCIA_x00c7__x00c3_O']) {
    const descriptor = context.columns.find(column => column.name === field);
    assert.equal(descriptor.control, 'select', field);
    assert.equal(descriptor.powerApps.closed, true, field);
  }
  await assert.rejects(data.loadEditor('1', { formVariantId: 'Screen11.pa.yaml#Form14' }), /formulário/);
  await data.saveEditor(context, { TAREFA: 'PAGAR TAXAS ATUALIZADAS' });
  await data.deleteItem('1', { eTag: '"recurring-v1"' });
  assert.deepEqual(writes, [{ id: '1', values: { TAREFA: 'PAGAR TAXAS ATUALIZADAS' }, options: { eTag: '"recurring-v1"' } }, { id: '1', options: { eTag: '"recurring-v1"' } }]);
});

test('Arthur supplier stays fixed during catalog outages and recovery instead of broadening the gallery', async t => {
  let unavailable = true;
  let supplierGate;
  const data = createRegistrationGalleryData({ kind: 'recurringTasks', userEmail: 'arthurmarcos@energeticabr.com', repository: {
    async resolveList(site, aliases) { if (aliases[0] === 'FORNECEDORES') { if (supplierGate) await supplierGate; if (unavailable) throw new Error('catalog unavailable'); } return { status: 'resolved', id: aliases[0] }; },
    async getColumns(site, list) { return list === 'FORNECEDORES' ? [column('Title', 'CADASTRO'), column('FILIAL'), column('TIPO'), column('STATUS')]
      : list === 'FILIAIS' ? [column('Title', 'FILIAL')] : list === 'CADASTROTAREFAS' ? [column('field_1', 'ASSOCIAÇÃO')] : [column('RECORRENCIA', 'RECORRENCIA', { choice: { choices: ['MENSAL'] } })]; },
    async getItemsPage(site, list) { return page(list === 'FORNECEDORES' ? [record(1, { Title: 'ARTHUR MARCOS SILVA ROCHA', FILIAL: '000 - ESCRITÓRIO CENTRAL', TIPO: 'MÃO DE OBRA', STATUS: 'ATIVO' })] : list === 'TAREFASRECORRENTES' ? [record(1, { TAREFA: 'A', STATUS: 'ATIVO', FORNECEDOR: 'ARTHUR MARCOS SILVA ROCHA' }), record(2, { TAREFA: 'B', STATUS: 'ATIVO', FORNECEDOR: 'OUTRO' })] : []); },
  } });
  const dom = new JSDOM('<!doctype html><body></body>');
  const doc = dom.window.document;
  const gallery = createRegistrationGallery({ document: doc, kind: 'recurringTasks', data });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  for (const outage of [true, false, true, false]) {
    unavailable = outage;
    await gallery.open();
    const supplier = doc.querySelector('[data-filter-field="FORNECEDOR"]');
    assert.equal(supplier.value, 'ARTHUR MARCOS SILVA ROCHA', `outage=${outage}`);
    assert.equal(supplier.disabled, true);
    assert.deepEqual([...doc.querySelectorAll('[data-registration-row]')].map(node => node.dataset.registrationRow), ['1']);
    if (outage) assert.match(doc.querySelector('.rg-feedback').textContent, /indisponível/);
  }
  let finish;
  supplierGate = new Promise(resolve => { finish = resolve; });
  const pending = gallery.open();
  try {
    await new Promise(resolve => setImmediate(resolve));
    const search = doc.querySelector('input[type="search"]');
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(doc.querySelector('[data-filter-field="FORNECEDOR"]').value, 'ARTHUR MARCOS SILVA ROCHA');
    assert.deepEqual([...doc.querySelectorAll('[data-registration-row]')].map(node => node.dataset.registrationRow), ['1']);
  } finally { finish(); await pending; }
});

test('recurring filter catalogs enforce central-office active labor and use all recurrence choices', async () => {
  const data = createRegistrationGalleryFilterData({ kind: 'recurringTasks', repository: {
    async resolveList(site, aliases) { return { status: 'resolved', id: aliases[0] }; },
    async getColumns(site, list) { return list === 'FORNECEDORES' ? [column('Title', 'CADASTRO'), column('FILIAL'), column('TIPO'), column('STATUS')]
      : list === 'CADASTROTAREFAS' ? [column('field_1', 'ASSOCIAÇÃO')] : [column('RECORRENCIA', 'RECORRENCIA', { choice: { choices: ['SEMANAL', 'MENSAL', 'ANUAL'] } })]; },
    async getItemsPage(site, list) { assert.notEqual(list, 'TAREFASRECORRENTES', 'choices come from metadata, even without matching rows');
      return page(list === 'FORNECEDORES' ? [
        record(1, { Title: 'CENTRAL', FILIAL: '000 - ESCRITÓRIO CENTRAL', TIPO: 'MÃO DE OBRA', STATUS: 'ATIVO' }),
        record(2, { Title: 'OUTRA FILIAL', FILIAL: 'OBRA', TIPO: 'MÃO DE OBRA', STATUS: 'ATIVO' }),
        record(3, { Title: 'INATIVO', FILIAL: '000 - ESCRITÓRIO CENTRAL', TIPO: 'MÃO DE OBRA', STATUS: 'INATIVO' }),
        record(4, { Title: 'MATERIAL', FILIAL: '000 - ESCRITÓRIO CENTRAL', TIPO: 'MATERIAL', STATUS: 'ATIVO' }),
      ] : [record(1, { field_1: 'ASSOCIAÇÃO SEM TAREFAS' })]); },
  } });
  assert.deepEqual(await data.loadFilterOptions('FORNECEDOR'), [{ value: 'CENTRAL', label: 'CENTRAL' }]);
  assert.deepEqual(await data.loadFilterOptions('ASSOCIAÇÃO'), [{ value: 'ASSOCIAÇÃO SEM TAREFAS', label: 'ASSOCIAÇÃO SEM TAREFAS' }]);
  assert.deepEqual((await data.loadFilterOptions('RECORRENCIA')).map(option => option.value), ['SEMANAL', 'MENSAL', 'ANUAL']);
});

test('supplier filter preserves the PowerApps account lock and Arthur default after refresh', async t => {
  for (const [userEmail, locked, defaultSupplier] of [['bernardonotini@energeticabr.com', false, ''], ['arthurmarcos@energeticabr.com', true, 'ARTHUR MARCOS SILVA ROCHA'], ['other@energeticabr.com', true, '']]) {
    const data = createRegistrationGalleryData({ kind: 'recurringTasks', userEmail, repository: {
      async resolveList(site, aliases) { return { status: 'resolved', id: aliases[0] }; },
      async getColumns(site, list) { return list === 'FORNECEDORES' ? [column('Title', 'CADASTRO'), column('FILIAL'), column('TIPO'), column('STATUS')]
        : list === 'FILIAIS' ? [column('Title', 'FILIAL')] : list === 'CADASTROTAREFAS' ? [column('field_1', 'ASSOCIAÇÃO')] : [column('RECORRENCIA', 'RECORRENCIA', { choice: { choices: ['MENSAL'] } })]; },
      async getItemsPage(site, list) { return page(list === 'FORNECEDORES' ? [record(1, { Title: 'ARTHUR MARCOS SILVA ROCHA', FILIAL: '000 - ESCRITÓRIO CENTRAL', TIPO: 'MÃO DE OBRA', STATUS: 'ATIVO' })] : list === 'TAREFASRECORRENTES' ? [record(1, { TAREFA: 'A', STATUS: 'ATIVO', FORNECEDOR: 'ARTHUR MARCOS SILVA ROCHA' }), record(2, { TAREFA: 'B', STATUS: 'ATIVO', FORNECEDOR: 'OUTRO' })] : []); },
    } });
    const dom = new JSDOM('<!doctype html><body></body>');
    const gallery = createRegistrationGallery({ document: dom.window.document, kind: 'recurringTasks', data });
    t.after(() => { gallery.destroy(); dom.window.close(); });
    await gallery.open();
    const supplier = dom.window.document.querySelector('[data-filter-field="FORNECEDOR"]');
    assert.equal(supplier.disabled, locked, userEmail);
    assert.equal(supplier.value, defaultSupplier, userEmail);
    assert.equal(dom.window.document.querySelectorAll('[data-registration-row]').length, defaultSupplier ? 1 : 2);
    await gallery.open();
    assert.equal(supplier.disabled, locked, `refresh ${userEmail}`);
    assert.equal(supplier.value, defaultSupplier, `refresh ${userEmail}`);
  }
});
