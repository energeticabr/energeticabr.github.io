import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { captureFilteredReport } from '../src/ui/report-print.js';
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
  assert.equal(dom.window.document.activeElement, root.querySelector('.pl-dialog'));
});

test('landscape is report-only, includes the logo and open-ended Brazilian date fields', async t => {
  const calls = [];
  const { view, root, dom } = setup(t, async options => { calls.push(options.filters); return { launches: [row, {...row, id:'3500',paymentDate:'2027-01-10'}] }; });
  await view.open();
  assert.equal(root.querySelector('.pl-heading'), null);
  assert.equal(root.querySelector('.pl-close'), null);
  assert.equal(root.querySelector('.pl-summary'), null);
  assert.equal(root.querySelector('.pl-scroll-hint'), null);
  assert.ok(root.querySelector('img[alt="Logo Energética"]').src.includes('logo-energetica-oficial'));
  assert.equal(calls[0].startDate, ''); assert.equal(calls[0].endDate, '');
  assert.equal(root.querySelectorAll('tbody tr').length, 2);
  const text = root.querySelector('[data-date-display="startDate"]');
  assert.equal(text.placeholder, 'Desde o início');
  assert.equal(root.querySelector('[data-date-display="endDate"]').placeholder, 'Até o fim');
  text.value = '02/10/2026'; text.dispatchEvent(new dom.window.Event('change'));
  await new Promise(r => setImmediate(r));
  assert.equal(calls.at(-1).startDate, '2026-10-02');
  text.value = ''; text.dispatchEvent(new dom.window.Event('change'));
  await new Promise(r => setImmediate(r)); assert.equal(calls.at(-1).startDate, '');
  text.value = '31/02/2026'; text.dispatchEvent(new dom.window.Event('change'));
  assert.equal(root.querySelectorAll('tbody tr').length, 0);
  assert.match(root.querySelector('.pl-notice').textContent, /data inválida/i);
  text.value = '02/13/2026'; text.dispatchEvent(new dom.window.Event('change'));
  const before=calls.length; root.querySelector('.pl-refresh').click();
  await new Promise(r => setImmediate(r));
  assert.equal(calls.length,before,'data inválida não deve consultar com o período anterior');
  assert.equal(root.querySelectorAll('tbody tr').length,0);
});

test('reference merges equal branch/account/order cells without merging distinct values', async t => {
  const { view, root } = setup(t, async () => ({launches:[row, {...row,id:'3500'}, {...row,id:'3501',account:'Outra',order:'359'}]}));
  await view.open();
  assert.equal(root.querySelectorAll('[data-column="branch"]').length, 1);
  assert.equal(root.querySelector('[data-column="branch"]').rowSpan, 3);
  assert.equal(root.querySelectorAll('[data-column="account"]').length, 2);
  assert.equal(root.querySelector('[data-column="account"]').rowSpan, 2);
  assert.equal(root.querySelectorAll('[data-column="order"]').length, 2);
  assert.equal(root.querySelector('[data-column="order"]').rowSpan, 2);
  assert.equal(root.querySelector('[data-column="product"] strong').textContent, row.product);
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

function reachEnd(root, dom) {
  const scroll = root.querySelector('.pl-table-scroll');
  Object.defineProperties(scroll, {
    clientHeight: { configurable: true, value: 300 },
    scrollHeight: { configurable: true, value: 2000 + Math.max(0, root.querySelectorAll('tbody tr').length - 200) * 10 },
  });
  scroll.scrollTop = scroll.scrollHeight - scroll.clientHeight;
  scroll.dispatchEvent(new dom.window.Event('scroll'));
}

const manyPayments = (count, supplier = 'Alfa') => Array.from({ length: count }, (_, i) => ({
  ...row, id: String(i + 1), supplier, product: 'Serviço', order: '358', unit: 1, quantity: 1, total: 1,
}));

test('starts at 200 payments even inside one group, appends 200 at each end and stops without duplicates', async t => {
  const { view, root, dom } = setup(t, async () => ({ launches: manyPayments(451) }));
  await view.open();
  assert.equal(root.querySelectorAll('tbody tr').length, 200);
  assert.equal(root.querySelector('.pl-pager'), null);
  const first = root.querySelector('tbody tr');
  assert.equal(root.querySelector('[data-column=supplier]').rowSpan, 200);
  assert.match(root.querySelector('[data-column=supplierTotal]').textContent, /451,00/);
  reachEnd(root, dom);
  assert.equal(root.querySelectorAll('tbody tr').length, 400);
  assert.equal(root.querySelector('tbody tr'), first, 'append keeps the existing rows and scroll anchor');
  assert.equal(root.querySelector('.pl-table-scroll').scrollTop, 1700);
  assert.equal(root.querySelector('[data-column=paymentDate]').rowSpan, 400);
  assert.equal(root.querySelector('[data-column=supplier]').rowSpan, 400);
  reachEnd(root, dom);
  assert.equal(root.querySelectorAll('tbody tr').length, 451);
  reachEnd(root, dom);
  assert.equal(new Set([...root.querySelectorAll('[data-column=id]')].map(n => n.textContent)).size, 451);
  assert.match(root.querySelector('.pl-load-status').textContent, /451.*451/);
});

test('every reference filter resets to the first 200 matching items, not 200 before filtering', async t => {
  const alfa = manyPayments(250), beta = manyPayments(250, 'Beta').map((item, i) => ({
    ...item, id: String(i + 251), branch: 'Outra filial', product: 'Outro produto', order: '359', disbursement: 'NÃO',
  }));
  const { view, root, dom } = setup(t, async () => ({ launches: [...alfa, ...beta] }));
  await view.open();
  for (const [name, value] of [['supplier', 'Beta'], ['branch', 'Outra filial'], ['product', 'Outro produto'], ['order', '359'], ['disbursement', 'NÃO']]) {
    for (const input of root.querySelectorAll('select[name]')) input.value = '';
    reachEnd(root, dom);
    const filter = root.querySelector(`[name=${name}]`); filter.value = value;
    filter.dispatchEvent(new dom.window.Event('change'));
    assert.equal(root.querySelectorAll('tbody tr').length, 200, name);
    assert.ok([...root.querySelectorAll('[data-column=id]')].every(n => Number(n.textContent) >= 251), name);
    assert.equal(root.querySelector('.pl-table-scroll').scrollTop, 0, name);
    reachEnd(root, dom);
    assert.equal(root.querySelectorAll('tbody tr').length, 250, name);
  }
});

test('print includes all filtered payments then restores the visible 200 and scroll position', async t => {
  const { view, root } = setup(t, async () => ({ launches: manyPayments(451) }));
  await view.open();
  const scroll = root.querySelector('.pl-table-scroll'); scroll.scrollTop = 120;
  assert.equal(typeof view.preparePrint, 'function');
  const restore = await view.preparePrint();
  const captured = captureFilteredReport(root);
  const table = captured.pages[0].blocks.find(block => block.type === 'table');
  assert.equal(table.rows.length, 452);
  assert.equal(table.rows.at(-1).cells.find(cell => cell.column === 2).runs[0].text, '1');
  restore();
  assert.equal(root.querySelectorAll('tbody tr').length, 200);
  assert.equal(scroll.scrollTop, 120);
  assert.equal(root.querySelector('[data-column=supplier]').rowSpan, 200);
});

test('loading and hidden reports cannot grow stale rows after close or invalid dates', async t => {
  const { view, root, dom } = setup(t, async () => ({ launches: manyPayments(451) }));
  await view.open(); view.close(); reachEnd(root, dom);
  assert.equal(root.querySelectorAll('tbody tr').length, 0);
  await view.open();
  const date = root.querySelector('[data-date-display=startDate]'); date.value = '31/02/2026';
  date.dispatchEvent(new dom.window.Event('change')); reachEnd(root, dom);
  assert.equal(root.querySelectorAll('tbody tr').length, 0);
});

test('a stale print restoration cannot expand or move a newly filtered batch', async t => {
  const { view, root, dom } = setup(t, async () => ({ launches: [
    ...manyPayments(451), ...manyPayments(231, 'Beta').map((item, i) => ({ ...item, id: String(452 + i) })),
  ] }));
  await view.open(); reachEnd(root, dom);
  const restore = view.preparePrint();
  const filter = root.querySelector('[name=supplier]'); filter.value = 'Beta'; filter.dispatchEvent(new dom.window.Event('change'));
  assert.equal(root.querySelectorAll('tbody tr').length, 200);
  restore();
  assert.equal(root.querySelectorAll('tbody tr').length, 200);
  assert.equal(root.querySelector('.pl-table-scroll').scrollTop, 0);
});
