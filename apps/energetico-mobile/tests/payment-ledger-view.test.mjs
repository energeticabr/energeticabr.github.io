import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const { createPaymentLedgerView } = await import('../src/ui/payment-ledger-view.js').catch(() => ({}));
const row = { id: '3498', paymentDate: '2026-10-02', supplier: 'Alfa', branch: 'Xavante', product: '<img src=x onerror=alert(1)>', order: '358', disbursement: 'SIM', account: 'Caixa', description: 'Observação', unit: 11, quantity: 3, freight: 0, total: 33 };
function setup(t, loadSnapshot = async () => ({ launches: [row] }), portrait = false) {
  assert.equal(typeof createPaymentLedgerView, 'function');
  const dom = new JSDOM('<main id="app"><button>Relatório</button></main>');
  let orientation = portrait;
  dom.window.matchMedia = () => ({ get matches() { return orientation; } });
  const view = createPaymentLedgerView({ document: dom.window.document, data: { loadPaymentsSnapshot: loadSnapshot } });
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: view.element, rotate(value) { orientation = value; dom.window.dispatchEvent(new dom.window.Event('resize')); } };
}
test('portrait opens warning without fetching, rotation loads report, outside click closes', async t => {
  let calls = 0;
  const { view, root, rotate, dom } = setup(t, async () => { calls++; return { launches: [row] }; }, true);
  await view.open(); assert.equal(calls, 0);
  assert.match(root.textContent, /PARA VER O RELATÓRIO FAVOR POSICIONAR O TELEFONE NA HORIZONTAL/);
  assert.equal(root.querySelector('.pl-report').hidden, true);
  rotate(false); await new Promise(r => setImmediate(r));
  assert.equal(calls, 1); assert.equal(root.querySelectorAll('tbody tr').length, 1);
  root.querySelector('tbody td').click(); assert.equal(root.hidden, false);
  root.click(); assert.equal(root.hidden, true);
  assert.equal(dom.window.document.body.style.overflow, '');
});
test('renders reference table, grouped totals, safe text, filters and date validation', async t => {
  const { view, root, dom } = setup(t, async () => ({ launches: [row, { ...row, id: '3502', total: 510.23, order: '359' }] }));
  await view.open();
  assert.deepEqual([...root.querySelectorAll('thead th')].map(n => n.textContent), ['DATA PGTO', 'PEDIDO', 'ID', 'FORNECEDOR', 'FILIAL', 'CONTA', 'PRODUTO', 'VU', 'QTD', 'FRETE', 'TOTAL', 'TOTAL FORN. DIA']);
  assert.equal(root.querySelector('[data-column="supplierTotal"]').rowSpan, 2);
  assert.match(root.querySelector('[data-column="supplierTotal"]').textContent, /543,23/);
  assert.equal(root.querySelector('tbody img'), null);
  const filter = root.querySelector('[name="supplier"]'); filter.value = 'Alfa'; filter.dispatchEvent(new dom.window.Event('change'));
  assert.equal(root.querySelectorAll('tbody tr').length, 2);
  root.querySelector('[name="startDate"]').value = '2026-10-03';
  root.querySelector('[name="endDate"]').value = '2026-10-02';
  root.querySelector('[name="startDate"]').dispatchEvent(new dom.window.Event('change'));
  assert.equal(root.querySelectorAll('tbody tr').length, 0);
  assert.match(root.querySelector('.pl-notice').textContent, /data inicial/i);
});
test('close aborts loading and ignores stale response; error offers refresh without stale totals', async t => {
  let done, signal;
  const { view, root } = setup(t, options => { signal = options.signal; return new Promise(r => { done = r; }); });
  const pending = view.open(); view.close(); assert.equal(signal.aborted, true);
  done({ launches: [row] }); await pending;
  assert.equal(root.hidden, true); assert.equal(root.querySelectorAll('tbody tr').length, 0);
  const failed = setup(t, async () => { throw new Error('Falha 503'); });
  await failed.view.open(); assert.match(failed.root.querySelector('.pl-notice').textContent, /Falha 503/);
  assert.equal(failed.root.querySelectorAll('tbody tr').length, 0);
});

test('rotation to portrait returns focus to a visible control', async t => {
  const { view, root, dom, rotate } = setup(t);
  await view.open(); root.querySelector('.sfs-search').focus();
  rotate(true);
  assert.equal(root.querySelector('.pl-report').hidden, true);
  assert.equal(dom.window.document.activeElement, root.querySelector('.pl-close'));
});

test('narrowing date range retries the query even after a pagination limit error', async t => {
  const calls = [];
  const { view, root, dom } = setup(t, async options => {
    calls.push(options.filters);
    if (!options.filters?.startDate) throw new Error('Reduza o período');
    return { launches: [row] };
  });
  await view.open(); assert.equal(root.querySelectorAll('tbody tr').length, 0);
  root.querySelector('[name="startDate"]').value = '2026-10-02';
  root.querySelector('[name="startDate"]').dispatchEvent(new dom.window.Event('change'));
  await new Promise(r => setImmediate(r));
  assert.equal(root.querySelectorAll('tbody tr').length, 1);
  assert.equal(calls.at(-1).startDate, '2026-10-02');
});
