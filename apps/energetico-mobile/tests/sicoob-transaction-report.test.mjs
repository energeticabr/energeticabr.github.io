import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSicoobTransactionReportView } from '../src/ui/sicoob-transaction-report-view.js';
import { captureFilteredReport } from '../src/ui/report-print.js';

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
    assert.equal(table.rows[1].cells[2].runs.map(run => run.text).join(''), 'TED DÉBITO');
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
    ...payment(2, { DESCRICAO: 'BOLETO', REFERENCIABANCARIA: '1234567' }), hasAttachments: true,
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
