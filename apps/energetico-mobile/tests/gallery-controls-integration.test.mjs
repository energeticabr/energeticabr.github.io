import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createLaunchGallery } from '../src/ui/launch-gallery-view.js';
import { createOrdersGallery } from '../src/ui/orders-gallery-view.js';
import { createTasksGallery } from '../src/ui/tasks-gallery-view.js';
import { createPaymentProgrammingGallery } from '../src/ui/payment-programming-gallery-view.js';
import { createRecurringExpensesGallery } from '../src/ui/recurring-expenses-gallery-view.js';
import { createRegistrationGallery } from '../src/ui/registration-gallery-view.js';
import { createHrPayrollGallery } from '../src/ui/hr-payroll-gallery-view.js';

const settle = () => new Promise(resolve => setImmediate(resolve));
const cases = [
  ['launches', createLaunchGallery, '.lg-record'],
  ['orders', createOrdersGallery, '.og-card'],
  ['tasks', createTasksGallery, '.tg-card'],
  ['payments', createPaymentProgrammingGallery, '.pg-card'],
  ['recurring', createRecurringExpensesGallery, '.re-card'],
  ...['group', 'family', 'subfamily', 'product', 'documents'].map(kind => [kind, createRegistrationGallery, '[data-registration-row]', { kind }]),
  ...['IDFOLHA', 'FOLHAPGTO'].map(gallery => [gallery, createHrPayrollGallery, '.hr-gallery-card', { gallery }]),
];

async function setup(t, kind, create, options) {
  const dom = new JSDOM('<button id="origin">Abrir galeria</button>', { url: 'https://example.test' });
  const document = dom.window.document;
  const calls = [];
  let rows = [{ id: '3479', eTag: '"v1"', total: 526, hasAttachments: false, MESREFERENCIA: '09/2026', fields: {
    FILIAL: '001 - CENTRAL', FORNECEDOR: 'José Geraldo', PRODUTO: 'PEDREIRO',
    STATUS: kind === 'payments' ? 'PAGAMENTO PREVISTO' : kind === 'tasks' ? 'EM ATENDIMENTO' : 'ATIVO',
    TAREFA: 'Conferir materiais', DESCRICAO: 'Energia', GRUPO: 'MATERIAIS', FAMÍLIA: 'OBRA',
    'SUBFAMÍLIAS CADASTRADAS': 'ESTRUTURA', TIPODOCUMENTO: 'NOTA', CONCLUÍDO: 'PEDIDO FINALIZADO',
    RECORRENCIA: 'MENSAL', Modified: '2026-09-30T10:00:00Z', 'DATA PREVISTO PGTO': '2026-10-01',
  } }];
  const data = {
    async loadSnapshot() { return { rows }; },
    async listAttachments() { return []; },
    async loadEditor(id) {
      calls.push(['editor', String(id)]);
      return { entity: { id: 'cadastro-de-grupos', title: 'Grupo' },
        item: { id: String(id), eTag: '"v1"', fields: { Title: 'MATERIAIS' } },
        columns: [{ name: 'Title', label: 'Grupo', control: 'text', editable: true, required: true }], contract: { hasForm: true } };
    },
    async saveEditor(context, fields) { calls.push(['save', context.item.id, fields]); },
    async deleteItem(id) { calls.push(['delete', String(id)]); rows = []; },
  };
  const request = async operation => {
    if (kind === 'IDFOLHA' || kind === 'FOLHAPGTO') return { gallery: kind, rows, page: 1, hasMore: false };
    if (operation === 'snapshot') return { rows, page: 1, pages: 1, count: rows.length, totals: {}, filterOptions: { branch: ['001 - CENTRAL'], product: ['PEDREIRO'] } };
    if (operation === 'detail') return { item: rows[0], attachments: [], editFields: [{ name: 'PRODUTO', label: 'Produto', type: 'text' }] };
    if (operation === 'delete') { calls.push(['delete', rows[0].id]); rows = []; return {}; }
    throw new Error(`Unexpected operation ${operation}`);
  };
  const gallery = create({ document, data, request, loadEditor: data.loadEditor, saveEditor: data.saveEditor, deleteItem: data.deleteItem, ...options, now: () => new Date('2026-09-30T12:00:00-03:00') });
  t.after(() => { gallery.destroy(); dom.window.close(); });
  await gallery.open();
  return { dom, document, gallery, calls };
}

for (const [kind, create, selector, options = {}] of cases) {
  test(`${kind}: editing and deletion act on the selected record with explicit confirmation`, async t => {
    const ctx = await setup(t, kind, create, options);
    const card = ctx.document.querySelector(selector);
    assert.ok(card, `${kind} record is visible`);
    const pencil = card.querySelector('[data-gallery-action="edit"]');
    const remove = card.querySelector('[data-gallery-action="delete"]');
    assert.ok(pencil, 'record has pencil edit action');
    assert.match(pencil.getAttribute('aria-label'), /3479/);
    assert.equal(pencil.textContent, '✏️', `${kind} uses the shared yellow edit pencil`);
    assert.equal(card.querySelector('[data-action="details"]'), null, `${kind} has no separate details action`);
    assert.ok(remove, 'record has red X delete action');
    assert.match(remove.getAttribute('aria-label'), /3479/);

    remove.click();
    await settle();
    const popup = ctx.document.querySelector('.gallery-record-dialog:not([hidden])');
    assert.ok(popup, 'delete popup opens');
    assert.match(popup.textContent, /Tem certeza que deseja deletar o item de ID 3479\?/);
    assert.equal(ctx.calls.some(([operation]) => operation === 'delete'), false);
    [...popup.querySelectorAll('button')].find(button => button.textContent === 'Não').click();
    assert.equal(ctx.calls.some(([operation]) => operation === 'delete'), false);
    assert.ok(ctx.document.querySelector(selector), 'cancel retains record');

    remove.click();
    await settle();
    const accepted = ctx.document.querySelector('.gallery-record-dialog:not([hidden])');
    [...accepted.querySelectorAll('button')].find(button => button.textContent === 'Sim').click();
    await settle(); await settle();
    assert.deepEqual(ctx.calls.filter(([operation]) => operation === 'delete'), [['delete', '3479']]);
    assert.equal(ctx.document.querySelector(selector), null, 'successful delete refreshes gallery');
  });
}

test('registration option search narrows choices and applies only after choosing', async t => {
  const ctx = await setup(t, 'documents', createRegistrationGallery, { kind: 'documents' });
  const native = ctx.document.querySelector('[data-filter-field="FORNECEDOR"]')
    || ctx.document.querySelector('[data-filter-field="PESSOARELACIONADA"]');
  assert.ok(native);
  const picker = native.nextElementSibling?.matches('.sfs') ? native.nextElementSibling : null;
  assert.ok(picker, 'registration filters have the shared searchable picker');
  picker.querySelector('button').click();
  assert.ok(picker.querySelector('input[type="search"]'), 'search field is inside option dropdown');
});

for (const [kind, create, selector, options = {}] of cases) {
  test(`${kind}: pencil opens the appropriate editor and gallery close dismisses it`, async t => {
    const ctx = await setup(t, kind, create, options);
    ctx.document.querySelector(`${selector} [data-gallery-action="edit"]`).click();
    const formSelector = kind === 'launches' ? '.lg-editor' : '[data-dynamic-form]';
    for (let attempt = 0; attempt < 40 && !ctx.document.querySelector(formSelector); attempt++) await settle();
    assert.ok(ctx.document.querySelector(formSelector), `${kind} opens editable form`);
    if (kind !== 'launches') assert.deepEqual(ctx.calls.filter(([operation]) => operation === 'editor'), [['editor', '3479']]);
    ctx.gallery.close();
    await settle();
    assert.equal(ctx.document.querySelector('.gallery-record-dialog'), null, 'gallery close dismisses action popup');
  });
}
