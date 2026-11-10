import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatMarkup, commandFromTarget } from '../src/ui/chat-view.js';
import { captureFilteredReport } from '../src/ui/report-print.js';

const row = { id: '306', supplier: 'FORNECEDOR FICTÍCIO', dueDate: '2026-10-26', totalDisplay: 'R$ 150,00',
  childCount: 2, product: 'PRODUTO DE TESTE', branch: '004 - OBRA A', property: 'TORRE B' };
function render(t, { values = {}, attachments, expanded = '', sourceKind = 'provision-description', ...overrides } = {}) {
  const dom = new JSDOM(renderChatMarkup({ sessionStatus: 'authenticated', account: { name: 'Teste' },
    messages: [], pendingFiles: [], draft: '', pendingProvisions: { due: true, sourceKind, rows: [{ ...row, ...values }] },
    pendingProvisionAttachments: { 306: attachments || { status: 'empty', items: [] } },
    pendingProvisionExpandedPaymentId: expanded, ...overrides }));
  t.after(() => dom.window.close());
  const card = dom.window.document.querySelector('.chat-pending-provision--payment');
  return { dom, card, arrow: card.querySelector('[data-action="toggle-pending-provision-attachments"]') };
}

for (const sourceKind of ['provision-description', 'legacy']) test(`supplier is above the due date and appears once (${sourceKind})`, t => {
  const { dom, card } = render(t, { sourceKind });
  const supplier = card.querySelector('.chat-pending-provision__amounts [data-field="supplier"]');
  assert.ok(supplier, 'supplier belongs to the colored heading');
  assert.equal(supplier.textContent, 'FORNECEDOR FICTÍCIO');
  assert.ok(supplier.compareDocumentPosition(card.querySelector('[data-field="dueDate"]')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(card.querySelectorAll('[data-field="supplier"]').length, 1);
  assert.equal(card.textContent.split('FORNECEDOR FICTÍCIO').length - 1, 1);
  assert.doesNotMatch(card.querySelector('.chat-pending-provision__supplier-info').textContent, /FORNECEDOR FICTÍCIO/);
});

test('supplier heading and print show the confirmed paid amount for a grouped provision', t => {
  const { dom, card } = render(t, { values: { amountDueDisplay: 'R$ 50,00', amountPaidDisplay: 'R$ 100,00' } });
  const supplier = 'FORNECEDOR FICTÍCIO (R$ 100,00 PAGOS)';
  assert.equal(card.querySelector('[data-field="supplier"]').textContent, supplier);
  const blocks = captureFilteredReport(dom.window.document.querySelector('[data-pending-provisions-dialog]')).pages[0].blocks;
  assert.ok(blocks.some(block => block.runs?.map(run => run.text).join('').includes(supplier)));
});

test('legacy rows never append a grouped paid amount', t => {
  const { card } = render(t, { sourceKind: 'legacy', values: { amountPaidDisplay: 'R$ 100,00' } });
  assert.equal(card.querySelector('[data-field="supplier"]').textContent, 'FORNECEDOR FICTÍCIO');
});

for (const [values, expected] of [
  [{}, '004 - OBRA A (TORRE B)'],
  [{ branch: '', property: '' }, '—'],
  [{ branch: '004 - OBRA A', property: undefined }, '004 - OBRA A'],
  [{ branch: null, property: 'TORRE B' }, '— (TORRE B)'],
  [{ branch: '<img src=x onerror=alert(1)>', property: '<script>teste</script>' }, '<img src=x onerror=alert(1)> (<script>teste</script>)'],
]) test(`one always-visible FILIAL field safely combines location: ${expected}`, t => {
  const { card } = render(t, { values, expanded: '306' });
  const location = card.querySelector('.chat-pending-provision__supplier-info [data-field="branch"]');
  assert.ok(location); assert.equal(location.querySelector('span').textContent, 'FILIAL');
  assert.equal(location.querySelector('strong').textContent, expected);
  assert.equal(location.closest('[hidden]'), null);
  assert.equal(card.querySelectorAll('[data-field="branch"]').length, 1);
  assert.equal(card.querySelector('[data-field="property"]'), null);
  assert.equal(location.querySelector('img, script'), null);
});

const states = [
  { status: 'loading', items: [] }, { status: 'empty', items: [] }, { status: 'error', items: [] },
  { status: 'available', items: [] }, { status: 'available', items: null },
  { status: 'available', items: [{ fileName: '' }, { fileName: '   ' }, {}] },
  { status: 'available', items: [{ fileName: 123 }] },
];
for (const attachments of states) test(`tray disclosure requires successful lookup for ${JSON.stringify(attachments)}`, t => {
  const { card, arrow } = render(t, { attachments, expanded: '306' });
  const ready = ['available', 'empty'].includes(attachments.status);
  assert.equal(arrow.disabled, !ready);
  assert.equal(arrow.getAttribute('aria-expanded'), String(ready));
  assert.equal(arrow.hasAttribute('aria-controls'), ready);
  assert.equal(Boolean(card.querySelector('.chat-pending-provision__upload-tray')), ready);
  assert.equal(card.querySelector('.chat-pending-provision__attachments'), null);
  assert.equal(card.querySelector('[data-field="branch"]').closest('[hidden]'), null);
});

test('available named attachments alone enable disclosure and control only the attachment list', t => {
  for (const expanded of ['', '306']) {
    const { card, arrow } = render(t, { expanded,
      attachments: { status: 'available', items: [{ fileName: 'nota.pdf', mimeType: 'application/pdf', size: 120 }] } });
    assert.equal(arrow.disabled, false); assert.equal(arrow.getAttribute('aria-controls'), 'pending-provision-attachments-306');
    assert.equal(arrow.getAttribute('aria-expanded'), String(Boolean(expanded)));
    assert.doesNotMatch(arrow.getAttribute('aria-label'), /detalhes/);
    assert.equal(card.querySelector('.chat-pending-provision__attachments').hidden, !expanded);
    assert.equal(card.querySelector('[data-field="branch"]').closest('[hidden]'), null);
    assert.equal(commandFromTarget(arrow).paymentId, '306');
    assert.equal(card.querySelector('[data-action="share-pending-provision-attachment"]').dataset.fileName, 'nota.pdf');
  }
});

test('attachment lookup error has a separate retry action while its arrow stays disabled', t => {
  const { card, arrow } = render(t, { attachments: { status: 'error', items: [], error: 'Falha temporária' } });
  assert.equal(arrow.disabled, true);
  const retry = card.querySelector('[data-action="retry-pending-provision-attachments"]');
  assert.ok(retry); assert.equal(retry.disabled, false);
  assert.equal(commandFromTarget(retry).paymentId, '306');
  assert.equal(commandFromTarget(retry).type, 'retry-pending-provision-attachments');
});

test('a legacy row without ID cannot advertise an attachment disclosure', t => {
  const { arrow, card } = render(t, { values: { id: '' }, expanded: '306', pendingProvisionAttachments: {
    '': { status: 'available', items: [{ fileName: 'sem-origem.pdf' }] },
  } });
  assert.equal(arrow.disabled, true); assert.equal(arrow.hasAttribute('aria-controls'), false);
  assert.equal(card.querySelector('.chat-pending-provision__attachments'), null);
  assert.equal(card.querySelector('[data-field="branch"]').closest('[hidden]'), null);
});

test('printing includes the visible combined location without revealing separate hidden rows', t => {
  const { dom } = render(t);
  const report = captureFilteredReport(dom.window.document.querySelector('.chat-pending-provisions--payments'));
  const text = report.pages.flatMap(page => page.blocks).flatMap(block => block.runs || []).map(run => run.text).join(' ');
  assert.match(text, /FILIAL/); assert.match(text, /004 - OBRA A \(TORRE B\)/);
  assert.equal((text.match(/TORRE B/g) || []).length, 1);
});

test('Valor distinguishes the amount due from the description total in the card and PDF', t => {
  const { dom, card } = render(t, { values: { amountDueDisplay: 'R$ 21.600,00', totalDisplay: 'R$ 61.600,00' } });
  assert.equal(card.querySelector('[data-field="total"] strong').textContent, 'R$ 21.600,00 / R$ 61.600,00');
  const blocks = captureFilteredReport(dom.window.document.querySelector('[data-pending-provisions-dialog]')).pages[0].blocks;
  assert.ok(blocks.some(block => block.runs?.map(run => run.text).join('').includes('R$ 21.600,00 / R$ 61.600,00')));
});

test('Valor keeps a single total when all items fall due together or only one is linked', t => {
  for (const childCount of [1, 3]) {
    const { card } = render(t, { values: { childCount, totalDisplay: 'R$ 61.600,00' } });
    assert.equal(card.querySelector('[data-field="total"] strong').textContent, 'R$ 61.600,00');
  }
});

test('Valor distinguishes an unconfirmed subtotal from the confirmed total', t => {
  const { card } = render(t, { values: { amountDueDisplay: null, totalDisplay: 'R$ 61.600,00' } });
  assert.equal(card.querySelector('[data-field="total"] strong').textContent, '— / R$ 61.600,00');
});

test('shows each linked observation after its own product and preserves blank observations', t => {
  const { dom, card } = render(t, { values: {
    product: 'CONTABILIDADE / TAXAS',
    productDisplay: 'CONTABILIDADE (FOLHA & <REVISÃO>) / TAXAS',
  } });
  const field = card.querySelector('[data-field="product"]');
  const expected = 'CONTABILIDADE (FOLHA & <REVISÃO>) / TAXAS';
  assert.equal(field.querySelector('span').textContent, 'Produto');
  assert.equal(field.querySelector('strong').textContent, expected);
  assert.equal(field.querySelector('revisão'), null);
  const blocks = captureFilteredReport(dom.window.document.querySelector('[data-pending-provisions-dialog]')).pages[0].blocks;
  assert.ok(blocks.some(block => block.runs?.map(run => run.text).join('').includes(expected)));
});

test('shows only the product for snapshots without a display override', t => {
  const { card } = render(t);
  assert.equal(card.querySelector('[data-field="product"] strong').textContent, 'PRODUTO DE TESTE');
});
