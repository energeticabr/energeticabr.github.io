import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createOrdersGallery } from '../src/ui/orders-gallery-view.js';

async function gallery(t) {
  const dom = new JSDOM('<button>Pedidos</button>', { url: 'https://example.test' });
  const rows = [
    { id: '353', hasAttachments: true, fields: {
      ID: '353', FORNECEDOR: 'ISRAEL ESCORAMENTO E ARMAÇÕES', STATUS: 'PENDENTE AUDITORIA',
      FILIAL: '004 - EDIFÍCIO XAVANTE', FORMAPGTO: 'ENERGÉTICA - CAIXA', VALORTOTAL: 13000,
      'NOTA FISCAL': 'PENDENTE', Criado: '2026-10-03T10:00:00Z', Modificado: '2026-10-03T11:00:00Z',
      'Criado por': 'Usuário não identificado', 'Modificado por': 'Bernardo notini', OBS: 'Observação adicional',
    } },
    { id: '351', hasAttachments: false, fields: { ID: '351', FORNECEDOR: 'CEMIG', STATUS: 'APROVADO', FILIAL: '004 - EDIFÍCIO XAVANTE' } },
  ];
  const data = {
    async loadSnapshot() { return { rows }; },
    async listAttachments(id) { return id === '353' ? [{ fileName: 'pedido.pdf' }, { fileName: 'foto.jpg' }] : []; },
    async loadEditor(id) { return { entity: { id: 'pedidos', title: 'Pedido' }, item: { id, fields: { FORNECEDOR: 'CEMIG' } }, columns: [{ name: 'FORNECEDOR', label: 'Fornecedor', control: 'text', editable: true }], contract: { hasForm: true } }; },
    async loadLinkedReport(id) { return { orderId: id, order: { fields: {} }, active: [], deleted: [], summary: { activeCount: 0, deletedCount: 0 } }; },
  };
  const view = createOrdersGallery({ document: dom.window.document, data });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open();
  await new Promise(resolve => setImmediate(resolve));
  return { root: dom.window.document.querySelector('.og-overlay'), dom };
}

test('orders summary presents only Pendentes and Editados above the count and sort toolbar', async t => {
  const { root } = await gallery(t);
  assert.deepEqual([...root.querySelectorAll('.og-metric dt')].map(node => node.textContent), ['Pendentes', 'Editados']);
  const toolbar = root.querySelector('.og-list-toolbar');
  assert.ok(toolbar, 'the count and sorting control share one toolbar');
  assert.match(toolbar.textContent, /2 pedido\(s\)/);
  assert.equal(toolbar.querySelector('[name="sort"]')?.value, 'id-desc');
  assert.match(toolbar.querySelector('[name="sort"] option:checked')?.textContent || '', /mais recentes/i);
  assert.ok(toolbar.compareDocumentPosition(root.querySelector('.og-filters')) & root.ownerDocument.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(root.querySelector('.og-filters')?.open, false);
});

test('orders use compact paired fields, a status chip, and no card details shortcut', async t => {
  const { root } = await gallery(t);
  const card = root.querySelector('.og-card[data-item-id="353"]');
  assert.ok(card.classList.contains('og-order-card'));
  assert.deepEqual([...card.querySelectorAll('.og-card-field dt')].map(node => node.textContent), [
    'FILIAL', 'FORMA DE PAGAMENTO', 'NOTA FISCAL', 'VALOR TOTAL',
    'CRIADO', 'MODIFICADO', 'CRIADO POR', 'MODIFICADO POR',
  ]);
  assert.match(card.querySelector('.og-status').textContent, /PENDENTE AUDITORIA/);
  assert.equal(card.querySelector('[data-action="details"], [data-action="mascot-details"]'), null);
  assert.ok(card.querySelector('[data-gallery-action="edit"]'));
  assert.ok(card.querySelector('[data-gallery-action="delete"]'));
  assert.doesNotMatch(card.querySelector('.og-card-fields').textContent, /Observação adicional/);
  assert.match(card.querySelector('.og-card-fields').textContent, /R\$\s?13\.000,00/);
});

test('every order keeps the left attachment rail including a known zero count', async t => {
  const { root } = await gallery(t);
  for (const [id, count] of [['353', '2 anexos'], ['351', '0 anexos']]) {
    const card = root.querySelector(`.og-card[data-item-id="${id}"]`);
    const rail = card.querySelector('.og-card-attachment-rail');
    assert.ok(rail);
    assert.equal(rail.querySelector('.og-card-attachment-count').textContent, count);
    assert.ok(rail.compareDocumentPosition(card.querySelector('.og-card-main')) & root.ownerDocument.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);
  }
});

test('the linked order report remains reachable from the pencil editor instead of a card shortcut', async t => {
  const { root } = await gallery(t);
  root.querySelector('.og-card[data-item-id="351"] [data-gallery-action="edit"]').click();
  for (let attempt = 0; attempt < 20 && !root.querySelector('[data-dynamic-form]'); attempt++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(root.querySelector('[data-dynamic-form]'));
  const report = root.querySelector('[data-order-linked-report]');
  assert.ok(report, 'the editor exposes the related report without a card details button');
  report.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(root.querySelector('.gallery-record-dialog'), null);
  assert.equal(root.querySelector('.og-detail').hidden, false);
  assert.match(root.querySelector('.og-detail').textContent, /Pedido #351/);
});
