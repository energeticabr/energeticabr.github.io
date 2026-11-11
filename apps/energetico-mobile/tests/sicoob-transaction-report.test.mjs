import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createSicoobOrderLink } from '../src/chat/sicoob-order-link.js';
import { createSicoobTransactionReportView } from '../src/ui/sicoob-transaction-report-view.js';
import { captureFilteredReport } from '../src/ui/report-print.js';

const reportStyles = readFileSync(new URL('../src/ui/dda-report.css', import.meta.url), 'utf8');

const payment = (id, fields = {}) => ({
  id: String(id),
  fields: {
    ORIGEMMOVIMENTACAO: 'SICOOB',
    DATAPAGAMENTO: '2026-10-01T12:00:00Z',
    RAZAOSOCIALRECEBEDOR: 'Comércio Exemplo Ltda. (Loja Exemplo)',
    DESCRICAO: 'PIX ENVIADO',
    OPERACAO: 'DÉBITO',
    CONTAPAGADORA: '00001-5',
    VALOR: '0,10',
    ...fields,
  },
});

test('summarizes bank descriptions in the report and PDF while retaining full-text search', async () => {
  const dom = new JSDOM('<main id="app"></main>');
  const examples = [
    ['PIX EMITIDO OUTRA IF | Pagamento Pix identificador-exemplo', 'Pix'],
    ['DÉB.TRANSF.CONTAS DIF.TIT. INTERCREDIS |@Transferência Pix|@Recebedor fictício', 'Pix'],
    ['DÉB.TRANSF.CONTAS DIF.TIT. INTERCREDIS', 'Transferência'],
    ['DÉB. PAGAMENTO DE BOLETO INTERCREDIS', 'Boleto'],
    ['DÉB.TIT.COMPE EFETIVADO', 'Boleto'],
    ['TED ENVIADA', 'TED'],
    ['TED ENVIADA | referência: reembolso de pagamento Pix', 'TED'],
    ['DÉB. PAGAMENTO DE BOLETO | referência: pagamento Pix anterior', 'Boleto'],
    ['DOC EMITIDO', 'DOC'],
    ['DÉB. AUTOMÁTICO', 'Débito automático'],
    ['COMPRA NO CARTÃO', 'Cartão'],
    ['PAGAMENTO CONVÊNIO', 'Convênio'],
    ['TRANSFERÊNCIA ENTRE CONTAS', 'Transferência'],
    ['PAGTO SERVIÇO', 'Pagamento'],
  ];
  const view = createSicoobTransactionReportView({
    document: dom.window.document,
    data: { async loadSnapshot() {
      return { rows: examples.map(([description], index) => payment(index + 1, { DESCRICAO: description })) };
    } },
  });
  try {
    await view.open();
    assert.deepEqual([...view.element.querySelectorAll('tbody tr')].map(row => row.cells[2].textContent),
      examples.map(([, label]) => label).reverse());
    const restore = await view.preparePrint();
    const pdf = captureFilteredReport(view.element);
    const table = pdf.pages.flatMap(page => page.blocks).find(block => block.type === 'table');
    assert.deepEqual(table.rows.filter(row => !row.header).map(row => row.cells[2].runs.map(run => run.text).join('')),
      examples.map(([, label]) => label).reverse());
    restore();
    const search = view.element.querySelector('input[type="search"]');
    search.value = 'identificador-exemplo';
    search.dispatchEvent(new dom.window.Event('input'));
    assert.equal(view.element.querySelectorAll('tbody tr').length, 1);
    assert.equal(view.element.querySelector('tbody tr').cells[2].textContent, 'Pix');
  } finally {
    view.destroy();
    dom.window.close();
  }
});

test('shows all imported payments across pages and prepares all filtered rows for PDF', async () => {
  const dom = new JSDOM('<main id="app"><button>Início</button></main>');
  const { document } = dom.window;
  const opener = document.querySelector('button');
  opener.focus();
  const rows = Array.from({ length: 51 }, (_, index) => payment(index + 1));
  rows.push(payment(52, {
    DATAPAGAMENTO: '2026-11-09T12:00:00Z', RAZAOSOCIALRECEBEDOR: '',
    CONTAPAGADORA: '00002-3', DESCRICAO: 'TED', REFERENCIABANCARIA: 'ref-52', VALOR: '1.200,20',
  }));
  rows.push(payment(53, { ORIGEMMOVIMENTACAO: undefined, VALOR: 9000 }));
  const calls = [];
  const view = createSicoobTransactionReportView({
    document, data: { async loadSnapshot(options) { calls.push(options); return { rows }; } },
  });
  const root = view.element;
  const rowCount = () => root.querySelectorAll('tbody tr').length;
  try {
    await view.open();
    assert.equal(calls[0].refresh, true);
    assert.equal(rowCount(), 50);
    assert.match(root.querySelector('tbody tr').textContent, /09\/11\/2026.*N\/A.*TED.*ref-52/);
    assert.match(root.textContent, /1\.205,30/);
    root.querySelector('button[aria-label="Próxima página"]').click();
    assert.equal(rowCount(), 2);
    const restore = await view.preparePrint();
    assert.equal(rowCount(), 52);
    const pdf = captureFilteredReport(root);
    const table = pdf.pages.flatMap(page => page.blocks).find(block => block.type === 'table');
    assert.equal(table.rows.filter(row => !row.header).length, 52);
    assert.equal(table.rows[1].cells[2].runs.map(run => run.text).join(''), 'TED');
    restore();
    assert.equal(rowCount(), 2);
    const search = root.querySelector('input[type="search"]');
    search.value = 'comercio exemplo';
    search.dispatchEvent(new dom.window.Event('input'));
    assert.equal(rowCount(), 50);
    assert.match(root.textContent, /R\$\s*5,10/);
    const from = root.querySelector('input[name="from"]');
    from.value = '2026-11-09';
    from.dispatchEvent(new dom.window.Event('input'));
    assert.equal(rowCount(), 0);
    view.close();
    assert.equal(document.activeElement, opener);
  } finally {
    view.destroy();
    dom.window.close();
  }
});

test('rejects a partial snapshot and supports retry', async () => {
  const dom = new JSDOM('<main id="app"></main>');
  let calls = 0;
  const view = createSicoobTransactionReportView({
    document: dom.window.document,
    data: { async loadSnapshot() { return { rows: [payment(1)], hasMore: ++calls === 1 }; } },
  });
  try {
    await view.open();
    assert.match(view.element.querySelector('[role="alert"]').textContent, /Não foi possível/);
    await assert.rejects(view.preparePrint());
    view.element.querySelector('button[aria-label^="Atualizar"]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(view.element.querySelectorAll('tbody tr').length, 1);
  } finally {
    view.destroy();
    dom.window.close();
  }
});

test('opens the payment receipt for its own movement', async () => {
  const dom = new JSDOM('<main id="app"></main>');
  const receipt = 'Comprovante-Sicoob-1234567.pdf';
  const rows = [payment(1, { RAZAOSOCIALRECEBEDOR: 'N/A' }), {
    ...payment(2, { DESCRICAO: 'BOLETO | referência: pagamento Pix anterior', REFERENCIABANCARIA: '1234567' }), hasAttachments: true,
  }];
  let opened;
  const view = createSicoobTransactionReportView({
    document: dom.window.document,
    data: {
      async loadSnapshot() { return { rows }; },
      async listAttachments(id) {
        assert.equal(id, '2');
        return [{ fileName: 'Comprovante-Sicoob-7654321.pdf' }, { fileName: receipt }];
      },
      async downloadAttachment(id, name) { return [id, name]; },
    },
    async openMediaCollection(items) {
      opened = await Promise.all(items.map(item => item.source()));
    },
  });
  try {
    await view.open();
    const buttons = view.element.querySelectorAll('button[aria-label^="Abrir comprovante"]');
    assert.equal(buttons.length, 1);
    buttons[0].click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(opened, [['2', receipt]]);
  } finally {
    view.destroy();
    dom.window.close();
  }
});

test('Pix proof is matched to the movement ID because its bank reference can be generic', async () => {
  const dom = new JSDOM('<main id="app"></main>');
  const name = 'Comprovante-Sicoob-Pix-3.pdf';
  let opened;
  const view = createSicoobTransactionReportView({
    document: dom.window.document,
    data: {
      async loadSnapshot() { return { rows: [{ ...payment(3, { REFERENCIABANCARIA: 'Pix' }), hasAttachments: true }] }; },
      async listAttachments() { return [{ fileName: 'Comprovante-Sicoob-Pix-2.pdf' }, { fileName: name }]; },
    },
    async openMediaCollection(items) { opened = items.map(item => item.fileName); },
  });
  try {
    await view.open();
    view.element.querySelector('.sicoob-transaction-receipt').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(opened, [name]);
  } finally {
    view.destroy();
    dom.window.close();
  }
});

test('Pix without a confirmed recipient is presented as pending identification', async () => {
  const dom = new JSDOM('<main id="app"></main>');
  const view = createSicoobTransactionReportView({
    document: dom.window.document,
    data: { async loadSnapshot() {
      return { rows: [payment(1, { RAZAOSOCIALRECEBEDOR: undefined }), payment(2, { RAZAOSOCIALRECEBEDOR: 'N/A' })] };
    } },
  });
  try {
    await view.open();
    assert.deepEqual([...view.element.querySelectorAll('tbody .ddr-supplier-name')].map(node => node.textContent),
      ['Identificação pendente', 'Identificação pendente']);
  } finally {
    view.destroy();
    dom.window.close();
  }
});

const orders = [
  { id: '41', supplier: 'Outro fornecedor', amount: '1,00', label: '#41 · Outro fornecedor · Filial Norte' },
  { id: '42', supplier: 'Comércio Exemplo Ltda.', amount: '0,11', label: '#42 · Comércio Exemplo Ltda. · Filial Sul' },
  { id: '43', supplier: 'Fornecedor Diferente', amount: '0,10', label: '#43 · Fornecedor Diferente · Filial Leste' },
  { id: '44', supplier: 'Comércio Exemplo Ltda.', amount: '0,10', label: '#44 · Comércio Exemplo Ltda. · Filial Oeste' },
];
const settle = () => new Promise(resolve => setImmediate(resolve));

test('highlights linked payments on either stripe and preserves the original unlinked stripes', async t => {
  const dom = new JSDOM('<main id="app"></main>');
  const { document } = dom.window;
  const style = document.createElement('style');
  style.textContent = reportStyles;
  document.head.append(style);
  const view = createSicoobTransactionReportView({
    document,
    data: { async loadSnapshot() {
      return { rows: [payment(1, { IDPEDIDO: 525 }), payment(2, { IDPEDIDO: '526' }),
        payment(3), payment(4, { IDPEDIDO: '0' })] };
    } },
  });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open();
  assert.deepEqual([...view.element.querySelectorAll('tbody tr')].map(row => [
    row.cells[5].textContent,
    dom.window.getComputedStyle(row).backgroundColor,
  ]), [
    ['—', 'rgba(0, 0, 0, 0)'],
    ['—', 'rgb(239, 246, 250)'],
    ['ID 526', 'rgb(234, 248, 238)'],
    ['ID 525', 'rgb(234, 248, 238)'],
  ]);
});

function setupOrderLink(t, { initial, recipient, description, loadOptions = async () => orders, saveError } = {}) {
  const dom = new JSDOM('<main id="app"></main>');
  const { document, Event, KeyboardEvent } = dom.window;
  let orderId = initial;
  let receiptsOpened = 0;
  const writes = [];
  const view = createSicoobTransactionReportView({
    document,
    data: {
      async loadSnapshot() {
        return { rows: [payment(7, {
          IDPEDIDO: orderId,
          ...(recipient === undefined ? {} : { RAZAOSOCIALRECEBEDOR: recipient }),
          ...(description === undefined ? {} : { DESCRICAO: description }),
        })] };
      },
      orderLink: {
        loadOptions,
        async loadSuppliers(ids) {
          const suppliers = new Map(orders.filter(order => ids.includes(order.id)).map(order => [order.id, order.supplier]));
          return { suppliers, incomplete:false };
        },
        async save(change) {
          writes.push(change);
          if (saveError) throw saveError;
          orderId = Number(change.orderId);
          return { movementId: change.movementId, orderId: change.orderId,
            supplier: orders.find(order => order.id === change.orderId)?.supplier };
        },
      },
      async listAttachments() {
        receiptsOpened += 1;
        return [];
      },
    },
    async openMediaCollection() {},
  });
  t.after(() => { view.destroy(); dom.window.close(); });
  const root = view.element;
  const query = selector => root.querySelector(selector);
  const linkButton = () => query('tbody button[aria-label*="pedido"]');
  const picker = () => query('.dda-provision-dialog');
  const openPicker = async () => {
    assert.ok(linkButton(), 'O pagamento deve oferecer um lápis de vinculação.');
    linkButton().click();
    await settle();
  };
  const select = id => {
    const radio = picker().querySelector('input[value="' + id + '"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change', { bubbles: true }));
    picker().querySelector('.dda-provision-save').click();
    return document.querySelector('[data-edit-review]');
  };
  return { view, root, query, linkButton, picker, openPicker, select, writes, Event, KeyboardEvent,
    receiptsOpened: () => receiptsOpened };
}

test('offers manual Sicoob order suggestions and keeps all orders searchable', async t => {
  const dates = { 42: '2026-02-30', 43: '01/11/2026', 44: '2026-11-09' };
  const { loadOptions } = createSicoobOrderLink({ repository: {
    async resolveList() { return { status: 'resolved', id: 'orders' }; },
    async getItems() {
      return orders.map(({ id, supplier, amount, label }) => ({ id: id === '41' ? '2026' : id, fields: {
        FORNECEDOR: supplier, VALORTOTAL: amount, FILIAL: label.split(' · ').at(-1), DATAPEDIDO: dates[id],
      } }));
    },
  } });
  const { view, query, picker, openPicker, writes, Event, KeyboardEvent, linkButton, receiptsOpened } = setupOrderLink(t, { loadOptions });
  await view.open();
  assert.equal(query('thead th:last-child').textContent, 'VINCULAÇÃO');
  await openPicker();
  const choices = () => [...picker().querySelectorAll('.dda-provision-option')];
  assert.deepEqual(choices().map(node => node.querySelector('input').value), ['44', '43', '42', '2026']);
  const labels = choices().map(node => node.querySelector('input + span').textContent);
  assert.match(labels[0], /^#44 · 09\/11\/2026 · Comércio Exemplo Ltda\./);
  assert.match(labels[1], /^#43 · 01\/11\/2026 · Fornecedor Diferente/);
  assert.match(labels[2], /^#42 · Sem data do pedido · Comércio Exemplo Ltda\./);
  assert.match(labels[3], /^#2026 · Sem data do pedido · Outro fornecedor/);
  assert.deepEqual(choices().map(node => Boolean(node.querySelector('.dda-provision-star'))), [true, true, true, false]);
  assert.match(choices()[0].textContent, /Valor igual.*Nome\/razão social semelhante/i);
  assert.match(choices()[1].textContent, /Valor igual/i);
  assert.match(choices()[2].textContent, /Nome\/razão social semelhante/i);
  assert.equal(picker().querySelector('input:checked'), null);
  assert.equal(picker().querySelector('.dda-provision-save').disabled, true);
  query('.sicoob-transaction-receipt').click();
  assert.equal(receiptsOpened(), 0);
  const search = picker().querySelector('input[type="search"]');
  search.value = 'Filial Norte';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  assert.deepEqual(choices().map(node => node.querySelector('input').value), ['2026']);
  search.value = '2026';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  assert.deepEqual(choices().map(node => node.querySelector('input').value), ['2026']);
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(picker(), null);
  assert.equal(view.element.hidden, false);
  assert.equal(view.element.ownerDocument.activeElement, linkButton());
  assert.deepEqual(writes, []);
});

test('shows amount-only recommendations when bank recipient identification is pending', async t => {
  const { view, picker, openPicker } = setupOrderLink(t, { recipient: 'N/A' });
  await view.open();
  await openPicker();
  const recommended = [...picker().querySelectorAll('.dda-provision-star')].map(star => star.parentElement);
  assert.deepEqual(recommended.map(node => node.querySelector('input').value).sort(), ['43', '44']);
  assert.ok(recommended.every(node => /Valor igual/i.test(node.textContent)));
});

test('uses the supplier of a confirmed link for a pending recipient and keeps it on refresh', async t => {
  const { view, query, picker, openPicker, select, Event } = setupOrderLink(t, { recipient: 'N/A' });
  const recipient = () => query('tbody .ddr-supplier-name').textContent;
  await view.open();
  assert.equal(recipient(), 'Identificação pendente');
  await openPicker();
  select('44').querySelector('[data-edit-review-confirm]').click();
  await settle();
  assert.equal(recipient(), orders[3].supplier);
  picker().querySelector('.gallery-record-dialog-buttons button').click();
  const search = query('input[name="search"]');
  search.value = orders[3].supplier;
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await openPicker();
  select('41').querySelector('[data-edit-review-confirm]').click();
  await settle();
  assert.equal(query('tbody tr'), null);
  assert.match(query('.ddr-empty').textContent, /Nenhuma transação/);
  picker().querySelector('.gallery-record-dialog-buttons button').click();
  view.close();
  await view.open();
  search.value = orders[0].supplier;
  search.dispatchEvent(new Event('input', { bubbles: true }));
  assert.equal(recipient(), orders[0].supplier);
});

test('appends the linked supplier after the boleto amount and preserves the bank recipient', async t => {
  const bankRecipient = 'Beneficiário informado pelo Sicoob';
  const { view, root, query, openPicker, select, picker } = setupOrderLink(t, {
    recipient: bankRecipient, description: 'PAGAMENTO BOLETO',
  });
  await view.open();
  assert.equal(query('tbody .ddr-money').textContent, 'R$\u00a00,10');
  await openPicker();
  select('41').querySelector('[data-edit-review-confirm]').click();
  await settle();
  assert.equal(query('tbody .ddr-supplier-name').textContent, bankRecipient);
  assert.match(query('tbody .ddr-money').textContent, /^R\$\s0,10\s*\(Outro fornecedor\)$/);
  picker().querySelector('.gallery-record-dialog-buttons button').click();
  view.close();
  await view.open();
  assert.match(query('tbody .ddr-money').textContent, /\(Outro fornecedor\)/);
  const restore = await view.preparePrint();
  const pdf = captureFilteredReport(root);
  const table = pdf.pages.flatMap(page => page.blocks).find(block => block.type === 'table');
  assert.match(table.rows[1].cells[4].runs.map(run => run.text).join(' '), /\(Outro fornecedor\)/);
  restore();
});

test('confirms a Sicoob order link, replaces it and retains it through refresh, reopen and PDF', async t => {
  const { view, root, query, linkButton, picker, openPicker, select, writes, Event } = setupOrderLink(t);
  const { ownerDocument: document } = root;
  const style = document.createElement('style');
  style.textContent = reportStyles;
  document.head.append(style);
  await view.open();
  const search = query('input[name="search"]');
  search.value = 'Comércio Exemplo';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  const scroll = query('.ddr-content');
  scroll.scrollTop = 95;
  const paymentRow = query('tbody tr');
  const originalPayment = [...paymentRow.cells].slice(0, 5).map(cell => cell.textContent);
  await openPicker();
  let review = select('44');
  assert.match(review.querySelector('thead').textContent, /AntesDepois/);
  assert.equal(review.querySelector('tbody td:nth-child(2)').textContent, '—');
  assert.match(review.querySelector('tbody td:nth-child(3)').textContent, /#44/);
  review.querySelector('[data-edit-review-cancel]').click();
  await settle();
  assert.deepEqual(writes, []);
  assert.equal(query('tbody td:last-child').textContent, '—');
  assert.equal(document.defaultView.getComputedStyle(paymentRow).backgroundColor, 'rgba(0, 0, 0, 0)');
  review = select('44');
  review.querySelector('[data-edit-review-confirm]').click();
  await settle();
  assert.equal(writes.length, 1);
  const { signal, ...change } = writes[0];
  assert.ok(signal instanceof AbortSignal);
  assert.deepEqual(change, { movementId: '7', orderId: '44', expectedOrderId: '' });
  assert.match(picker().querySelector('[role="status"]').textContent, /pedido #44/);
  assert.equal(query('tbody tr'), paymentRow);
  assert.equal(scroll.scrollTop, 95);
  assert.equal(search.value, 'Comércio Exemplo');
  assert.deepEqual([...paymentRow.cells].slice(0, 5).map(cell => cell.textContent), originalPayment);
  assert.equal(query('tbody td:last-child').textContent, 'ID 44');
  assert.equal(document.defaultView.getComputedStyle(paymentRow).backgroundColor, 'rgb(234, 248, 238)');
  picker().querySelector('.gallery-record-dialog-buttons button').click();
  assert.equal(root.ownerDocument.activeElement, linkButton());

  await openPicker();
  assert.equal(picker().querySelector('input:checked').value, '44');
  review = select('43');
  assert.equal(review.querySelector('tbody td:nth-child(2)').textContent, 'ID 44');
  review.querySelector('[data-edit-review-confirm]').click();
  await settle();
  assert.equal(writes[1].expectedOrderId, '44');
  assert.equal(query('tbody td:last-child').textContent, 'ID 43');
  picker().querySelector('.gallery-record-dialog-buttons button').click();

  query('button[aria-label^="Atualizar"]').click();
  await settle();
  assert.equal(query('tbody td:last-child').textContent, 'ID 43');
  view.close();
  await view.open();
  assert.equal(query('tbody td:last-child').textContent, 'ID 43');
  const restore = await view.preparePrint();
  const pdf = captureFilteredReport(root);
  const table = pdf.pages.flatMap(page => page.blocks).find(block => block.type === 'table');
  assert.equal(table.rows[1].cells[5].runs.map(run => run.text).join(''), 'ID 43');
  assert.deepEqual(table.rows[1].cells.map(cell => cell.background), Array(6).fill([234 / 255, 248 / 255, 238 / 255]));
  assert.equal(linkButton(), null);
  restore();
  assert.ok(linkButton());
});

test('a failed Sicoob order link write leaves the prior ID and reports the error', async t => {
  const { view, query, openPicker, select, picker } = setupOrderLink(t, { initial: 42, saveError: new Error('Conflict') });
  await view.open();
  await openPicker();
  select('43').querySelector('[data-edit-review-confirm]').click();
  await settle();
  assert.match(picker().querySelector('[role="alert"]').textContent, /Não foi possível/);
  assert.equal(query('tbody td:last-child').textContent, 'ID 42');
  assert.equal(picker().querySelector('.dda-provision-save').disabled, false);
});

test('closing the Sicoob report cancels a pending picker load', async t => {
  let pendingSignal;
  const { view, openPicker, picker } = setupOrderLink(t, {
    loadOptions: ({ signal }) => {
      pendingSignal = signal;
      return new Promise(resolve => signal.addEventListener('abort', () => resolve(orders), { once: true }));
    },
  });
  await view.open();
  await openPicker();
  view.close();
  await settle();
  assert.equal(pendingSignal.aborted, true);
  assert.equal(picker(), null);
});
