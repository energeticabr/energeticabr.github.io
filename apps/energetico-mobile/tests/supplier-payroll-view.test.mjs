import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import * as module from "../src/ui/supplier-payroll-view.js";

test('rubrica já paga fecha a semana sem exigir forma, etapa ou IDFOLHA', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  let weekly;
  const post = h.data.post;
  h.data.post = (draft, progress, report, options) => {
    weekly = options?.weekly;
    return post(draft, progress, report);
  };
  await openSuppliers(h);
  await h.click('[data-payroll-expand]');
  h.input('[name=salary-value]', '250');
  const doc = h.dom.window.document;
  await h.click('[name=salary-already-paid]');
  assert.equal(doc.querySelector('[name=salary-account]').required, false);
  assert.equal(doc.querySelector('[data-payroll-supplier]').dataset.payrollState, 'ready');
  assert.match(doc.querySelector('[data-payroll-summary-total]').textContent, /250,00/);
  await h.click('[data-payroll-post]');
  assert.equal(weekly, true);
  assert.equal(h.posts[0].lines[0].alreadyPaid, true);
  assert.equal(h.posts[0].sheet, null);
});

test('produto com estrela vem preenchido e os padrões resolvem a etapa e o IDFOLHA de cada fornecedor', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSuppliers = async () => [
    { id: '1', label: 'EDGAR', branch: 'OBRA A' },
    { id: '6', label: 'JOÃO', branch: 'OBRA B' },
  ];
  h.data.loadProducts = async supplier => [
    { id: '2', label: 'PEDREIRO', recommended: supplier.id === '1' },
    { id: '7', label: 'SERVENTE', recommended: supplier.id === '6' },
  ];
  h.data.loadStages = async supplier => [
    { id: supplier.id === '1' ? '4' : '40', label: 'FUNDAÇÃO' },
    { id: '9', label: 'ACABAMENTO' },
  ];
  h.data.loadSheets = async supplier => supplier.id === '1'
    ? [{ id: '5', label: '10/2026' }, { id: '8', label: '11/2026' }]
    : [{ id: '15', label: '2026-10-01T00:00:00Z' }, { id: '18', label: '11-2026' }];
  const doc = h.dom.window.document;
  const card = id => `[data-payroll-supplier="${id}"]`;
  const field = (id, name) => doc.querySelector(`${card(id)} [name="${name}"]`);
  await openSuppliers(h);
  const stage = doc.querySelector('[name=batch-stage]');
  assert.ok(stage?.compareDocumentPosition(doc.querySelector(card('1'))) & h.dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  h.input('[name=batch-stage]', 'FUNDACAO');
  h.input('[name=batch-period]', '2026-10');
  await h.click(`${card('1')} [data-payroll-expand]`);
  assert.equal(field('1', 'product').value, '2');
  assert.equal(field('1', 'stage').value, '4');
  assert.equal(field('1', 'sheet').value, '5');
  assert.equal(doc.querySelector(`${card('1')} [data-payroll-select]`).checked, false);
  assert.equal(doc.querySelector(card('1')).dataset.payrollState, 'empty');
  h.input(`${card('1')} [name=stage]`, '9');
  h.input(`${card('1')} [name=sheet]`, '8');
  h.input('[name=batch-stage]', 'ACABAMENTO');
  h.input('[name=batch-stage]', 'FUNDACAO');
  h.input('[name=batch-period]', '2026-11');
  h.input('[name=batch-period]', '2026-10');
  await h.click(`${card('6')} [data-payroll-expand]`);
  assert.equal(field('6', 'product').value, '7');
  assert.equal(field('6', 'stage').value, '40');
  assert.equal(field('6', 'sheet').value, '15');
  assert.equal(field('1', 'stage').value, '9');
  assert.equal(field('1', 'sheet').value, '8');
  h.input('[name=batch-stage]', '');
  h.input('[name=batch-period]', '');
  assert.equal(field('6', 'stage').value, '');
  assert.equal(field('6', 'sheet').value, '');
  assert.equal(field('1', 'stage').value, '9');
  assert.equal(field('1', 'sheet').value, '8');
  h.input('[name=batch-stage]', 'FUNDACAO');
  h.input('[name=batch-period]', '2026-10');
  for (const id of ['1', '6']) {
    h.input(`${card(id)} [name=salary-value]`, '100');
    h.input(`${card(id)} [name=salary-account]`, '3');
  }
  await h.click('[data-payroll-post]');
  assert.deepEqual(h.posts.map(({ supplier, product, stage, sheet }) =>
    [supplier.id, product.id, stage.id, sheet.id]), [['1', '2', '9', '8'], ['6', '7', '40', '15']]);
});

test('padrão sem etapa na filial ou com duas folhas do mesmo mês fica pendente', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSuppliers = async () => [
    { id: '1', label: 'EDGAR', branch: 'OBRA A' },
    { id: '6', label: 'JOÃO', branch: 'OBRA B' },
  ];
  h.data.loadStages = async supplier => supplier.id === '1'
    ? [{ id: '4', label: 'FUNDAÇÃO' }] : [{ id: '9', label: 'FUNDA-ÇÃO' }];
  h.data.loadSheets = async supplier => supplier.id === '1'
    ? [{ id: '5', label: '10/2026' }]
    : [{ id: '15', label: '10/2026' }, { id: '16', label: '2026-10' }];
  await openSuppliers(h);
  h.input('[name=batch-stage]', 'FUNDACAO');
  h.input('[name=batch-period]', '2026-10');
  const supplier = '[data-payroll-supplier="6"]';
  await h.click(supplier + ' [data-payroll-expand]');
  const card = h.dom.window.document.querySelector(supplier);
  assert.equal(card.querySelector('[name=stage]').value, '');
  assert.equal(card.querySelector('[name=sheet]').value, '');
  assert.match(card.textContent, /Etapa do lote indisponível nesta filial/);
  assert.match(card.textContent, /Mais de um IDFOLHA/);
  assert.equal(card.querySelector('[data-payroll-select]').checked, false);
});

test('atualizar IDFOLHA resolve o mês do lote para os demais fornecedores', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSuppliers = async () => [
    { id: '1', label: 'EDGAR', branch: 'OBRA A' },
    { id: '6', label: 'JOÃO', branch: 'OBRA B' },
    { id: '7', label: 'MARIA', branch: 'OBRA A' },
  ];
  let added = false;
  h.data.loadSheets = async supplier => {
    if (supplier.id === '7') return [{ id: '20', label: '10/2026' }];
    return added ? [{ id: supplier.id === '1' ? '5' : '15', label: '10/2026' }] : [];
  };
  await openSuppliers(h);
  h.input('[name=batch-period]', '2026-10');
  const first = '[data-payroll-supplier="1"]';
  const second = '[data-payroll-supplier="6"]';
  await h.click(first + ' [data-payroll-expand]');
  await h.click(second + ' [data-payroll-expand]');
  added = true;
  await h.click(first + ' [data-payroll-reload-sheet]');
  const doc = h.dom.window.document;
  assert.equal(doc.querySelector(first + ' [name=sheet]').value, '5');
  assert.equal(doc.querySelector(second + ' [name=sheet]').value, '15');
});

test('lote exige campos válidos, mantém exclusão manual e soma apenas os selecionados', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSuppliers = async () => [
    { id: '1', label: 'EDGAR', branch: 'OBRA A' },
    { id: '6', label: 'JOÃO', branch: 'OBRA B' },
  ];
  const doc = h.dom.window.document;
  const supplier = id => `[data-payroll-supplier="${id}"]`;
  const card = id => doc.querySelector(supplier(id));
  const check = id => card(id).querySelector('[data-payroll-select]');
  const input = (id, name, value) => h.input(`${supplier(id)} [name="${name}"]`, value);
  h.input('[name=date]', '2026-10-02');
  await h.click('[data-payroll-next]');
  assert.equal(doc.querySelectorAll('[data-payroll-supplier]').length, 2);
  assert.equal(card('1').dataset.payrollState, 'empty');
  await h.click(`${supplier('1')} [data-payroll-expand]`);
  await h.click(`${supplier('6')} [data-payroll-expand]`);
  assert.equal(check('1').checked, false);
  check('1').click();
  assert.equal(card('1').dataset.payrollState, 'pending');
  input('6', 'salary-value', '50');
  assert.equal(check('6').checked, true);
  assert.equal(card('6').dataset.payrollState, 'pending');
  for (const [id, value] of [['1', '101,25'], ['6', '50']]) {
    input(id, 'product', '2');
    input(id, 'salary-value', value);
    input(id, 'salary-account', '3');
    input(id, 'stage', '4');
    input(id, 'sheet', '5');
    assert.equal(card(id).dataset.payrollState, 'ready');
    if (id === '1') {
      await h.click('[data-payroll-post]');
      assert.match(doc.querySelector('[role=alert]').textContent, /JOÃO/);
      assert.equal(h.posts.length, 0);
    }
  }
  assert.match(card('1').querySelector('[data-payroll-total]').textContent, /101,25/);
  assert.match(doc.querySelector('[data-payroll-batch-total]').textContent, /151,25/);
  check('6').click();
  assert.equal(card('6').dataset.payrollState, 'pending');
  assert.match(doc.querySelector('[data-payroll-batch-total]').textContent, /101,25/);
  await h.click('[data-payroll-post]');
  assert.deepEqual(h.posts.map(p => [p.supplier.id, p.total, p.sheet.id]), [['1', 101.25, '5']]);
});

test('um clique posta todos os marcados mesmo com filtro e retoma só o fornecedor que falhou', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSuppliers = async () => [
    { id: '1', label: 'EDGAR', branch: 'OBRA A' },
    { id: '6', label: 'JOÃO', branch: 'OBRA B' },
    { id: '7', label: 'MARIA', branch: 'OBRA C' },
  ];
  const finish = h.data.post;
  const attempts = [];
  h.data.post = async (draft, progress) => {
    attempts.push({ id: draft.supplier.id, operation: progress.operationId });
    if (attempts.length === 2) {
      progress.fingerprint = 'postagem iniciada';
      throw new Error('Vínculo temporariamente indisponível.');
    }
    return finish(draft, progress);
  };
  const doc = h.dom.window.document;
  await openSuppliers(h);
  for (const id of ['1', '6', '7']) {
    const card = '[data-payroll-supplier="' + id + '"]';
    await h.click(card + ' [data-payroll-expand]');
    for (const [name, value] of [['product', '2'], ['salary-value', '100'], ['salary-account', '3'], ['stage', '4'], ['sheet', '5']]) {
      h.input(card + ' [name="' + name + '"]', value);
    }
  }
  h.input('.supplier-payroll-search', 'Maria');
  assert.equal(doc.querySelector('[data-payroll-supplier="6"]').hidden, true);
  assert.match(doc.querySelector('[data-payroll-batch-total]').textContent, /300,00/);
  await h.click('[data-payroll-post]');
  assert.deepEqual(attempts.map(attempt => attempt.id), ['1', '6', '7']);
  assert.deepEqual(h.posts.map(post => post.supplier.id), ['1', '7']);
  assert.match(doc.querySelector('[role=alert]').textContent, /JOÃO.*Vínculo/);
  assert.equal(doc.querySelector('[data-payroll-supplier="6"] [data-payroll-select]').disabled, true);
  await h.click('[data-payroll-post]');
  assert.deepEqual(h.posts.map(post => post.supplier.id), ['1', '7', '6']);
  assert.deepEqual(attempts[3], attempts[1]);
  assert.equal(doc.querySelector('[data-payroll-post]').disabled, true);
});
const flush = () => new Promise((r) => setTimeout(r, 5));
test('fundo dos comprovantes cancela download sem vincular e restaura a folha e o foco', async t => {
  const h = await harness(); t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  const doc = h.dom.window.document;
  const file = new File(['a'], 'recibo.pdf', { type: 'application/pdf' });
  h.tray.push({ id: 'a', fileName: file.name, file });
  let release; h.receipts.readReceiptAttachment = () => new Promise(resolve => { release = resolve; });
  await h.click('[data-payroll-receipts="salary"]');
  const overlay = doc.querySelector('[data-receipt-picker]');
  overlay.querySelector('h2').click(); assert.equal(overlay.isConnected, true);
  doc.querySelector('[data-receipt-id="a"]').checked = true;
  await h.click('[data-receipt-confirm]');
  overlay.click(); assert.equal(overlay.isConnected, false);
  release(file); await flush();
  assert.equal(doc.querySelector('.supplier-payroll-file-list').children.length, 0);
  assert.equal(doc.querySelector('.supplier-payroll-body').inert, undefined);
  assert.equal(doc.activeElement.dataset.payrollReceipts, 'salary');
  assert.equal(h.closed, 0);
});
test("comprovante oferece bandeja atual, cancela sem vínculo e seleciona por rubrica", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  const doc = h.dom.window.document;
  assert.equal(doc.querySelector('input[type=file]'), null);
  await h.click('[data-payroll-receipts="salary"]');
  assert.match(doc.querySelector('[data-receipt-picker]').textContent, /bandeja.*vazia/i);
  assert.equal(doc.querySelector('[data-receipt-confirm]').disabled, true);
  await h.click('[data-receipt-cancel]');
  const file = new File(["pdf"], "recibo & <img>.pdf", { type: "application/pdf" });
  h.tray.push({ id: "one", fileName: file.name, file });
  await h.click('[data-payroll-receipts="salary"]');
  assert.equal(doc.querySelector('[data-receipt-picker] img'), null);
  doc.querySelector('[data-receipt-id="one"]').checked = true;
  await h.click('[data-receipt-cancel]');
  assert.deepEqual(h.reads, []);
  assert.equal(doc.querySelector('.supplier-payroll-file-list').children.length, 0);
  await h.click('[data-payroll-receipts="salary"]');
  doc.querySelector('[data-receipt-id="one"]').checked = true;
  await h.click('[data-receipt-confirm]');
  assert.equal(doc.querySelector('[data-receipt-picker]'), null);
  assert.equal(doc.querySelector('[data-payroll-rubric=salary] .supplier-payroll-file-list').textContent, file.name + "×");
  assert.equal(doc.querySelector('[data-payroll-rubric=allowance] .supplier-payroll-file-list').textContent, "");
  assert.equal(h.tray.length, 1);
  await h.click('[data-payroll-receipts="salary"]');
  assert.equal(doc.querySelector('[data-receipt-id="one"]').disabled, true);
  doc.querySelector('[data-receipt-picker]').dispatchEvent(new h.dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(h.closed, 0);
  assert.equal(doc.activeElement.dataset.payrollReceipts, "salary");
});

test("comprovantes falhos não vinculam lote parcial e cancelamento descarta download tardio", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  const doc = h.dom.window.document;
  h.tray.push({ id: "a", fileName: "a.pdf", file: new File(["a"], "a.pdf") },
    { id: "b", fileName: "b.pdf", file: new File(["b"], "b.pdf") });
  h.receipts.readReceiptAttachment = async id => {
    if (id === "b") throw new Error("Sem conexão");
    return h.tray[0].file;
  };
  await h.click('[data-payroll-receipts="salary"]');
  for (const cb of doc.querySelectorAll('[data-receipt-id]')) cb.checked = true;
  await h.click('[data-receipt-confirm]');
  assert.match(doc.querySelector('[data-receipt-error]').textContent, /Sem conexão/);
  assert.equal(doc.querySelector('.supplier-payroll-file-list').children.length, 0);
  let resolve;
  h.receipts.readReceiptAttachment = () => new Promise(r => { resolve = r; });
  doc.querySelector('[data-receipt-id="b"]').checked = false;
  await h.click('[data-receipt-confirm]');
  await h.click('[data-receipt-cancel]');
  resolve(h.tray[0].file);
  await flush();
  assert.equal(doc.querySelector('.supplier-payroll-file-list').children.length, 0);
  assert.equal(doc.querySelector('[data-receipt-picker]'), null);
});

test("fechar folha descarta comprovante tardio e nomes duplicados não vinculam lote", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  const doc = h.dom.window.document;
  h.tray.push({ id: "a", fileName: "igual.pdf", file: new File(["a"], "igual.pdf") },
    { id: "b", fileName: "igual.pdf", file: new File(["b"], "igual.pdf") });
  await h.click('[data-payroll-receipts="salary"]');
  for (const cb of doc.querySelectorAll('[data-receipt-id]')) cb.checked = true;
  await h.click('[data-receipt-confirm]');
  assert.match(doc.querySelector('[data-receipt-error]').textContent, /esse nome/);
  assert.equal(doc.querySelector('.supplier-payroll-file-list').children.length, 0);
  let resolve;
  h.receipts.readReceiptAttachment = () => new Promise(r => { resolve = r; });
  doc.querySelector('[data-receipt-id="b"]').checked = false;
  await h.click('[data-receipt-confirm]');
  h.view.close();
  await h.view.open();
  resolve(h.tray[0].file);
  await flush();
  assert.equal(doc.querySelector('[data-receipt-picker]'), null);
  assert.equal(doc.querySelector('.supplier-payroll-file-list').children.length, 0);
  assert.equal(doc.querySelector('.supplier-payroll-body').inert, undefined);
});
async function harness() {
  const dom = new JSDOM(
    '<button id="start">Abrir</button><main id="app"></main>',
  );
  const suppliers = [
      { id: "1", label: "EDGAR", branch: "OBRA A", profession: "PEDREIRO" },
    ],
    products = [{ id: "2", label: "PEDREIRO", recommended: true }],
    accounts = [{ id: "3", label: "PIX" }],
    stages = [{ id: "4", label: "FUNDAÇÃO" }];
  const posts = [];
  let closed = 0, home = 0;
  const data = {
    loadSuppliers: async () => suppliers,
    loadProducts: async () => products,
    loadAccounts: async () => accounts,
    loadStages: async () => stages,
    loadSheets: async () => [{ id: "5", label: "10/2026", recommended: true }],
    post: async (d, p) => {
      posts.push(d);
      return {
        ...d,
        lines: d.lines
          .filter((l) => l.unitValue)
          .map((l, i) => ({ ...l, id: String(10 + i) })),
      };
    },
  };
  const tray = [];
  const reads = [];
  const receipts = {
    getReceiptAttachments: () => tray,
    pickReceiptAttachments: async () => [],
    readReceiptAttachment: async id => {
      reads.push(id);
      return tray.find(item => item.id === id).file;
    },
  };
  const view = module.createSupplierPayrollView({
    documentRef: dom.window.document,
    data,
    getReceiptAttachments: () => receipts.getReceiptAttachments(),
    readReceiptAttachment: id => receipts.readReceiptAttachment(id),
    pickReceiptAttachments: kind => receipts.pickReceiptAttachments(kind),
    onClose: () => {
      closed++;
    },
    onHome: () => { home++; },
  });
  await view.open();
  const click = async (selector) => {
    dom.window.document.querySelector(selector).click();
    await flush();
  };
  const input = (selector, value) => {
    const element = dom.window.document.querySelector(selector);
    element.value = value;
    element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    element.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  };
  return {
    dom,
    view,
    data,
    posts,
    tray, reads, receipts,
    input,
    click,
    get closed() {
      return closed;
    },
    get home() { return home; },
  };
}
test("anexo removido enquanto outro baixa impede confirmação do lote", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  const files = [new File(["a"], "a.pdf"), new File(["b"], "b.pdf")];
  h.tray.push(...files.map((file, index) => ({id: String(index), fileName:file.name, file})));
  h.receipts.readReceiptAttachment = async id => {
    if (id === "1") h.tray.splice(0, 1);
    return files[Number(id)];
  };
  await h.click('[data-payroll-receipts="salary"]');
  const doc = h.dom.window.document;
  for (const cb of doc.querySelectorAll('[data-receipt-id]')) cb.checked = true;
  await h.click('[data-receipt-confirm]');
  assert.equal(doc.querySelector('.supplier-payroll-file-list').children.length, 0);
  assert.match(doc.querySelector('[data-receipt-error]').textContent, /bandeja/i);
});
async function fillToSheet(h) {
  await openRubrics(h);
  h.input('[name=salary-quantity]', '2');
  h.input('[name=salary-value]', '100,50');
  h.input('[name=salary-account]', '3');
  h.input('[name=stage]', '4');
  assert.match(h.dom.window.document.querySelector('[data-payroll-total]').textContent, /201,00/);
}

async function fill(h) {
  await fillToSheet(h);
  h.input('[name=sheet]', '5');
}

async function openSuppliers(h) {
  h.input('[name=date]', '2026-10-02');
  await h.click('[data-payroll-next]');
}

async function openRubrics(h) {
  await openSuppliers(h);
  await h.click('[data-payroll-expand]');
  h.input('[name=product]', '2');
}

test('folha só com INSS/FGTS vincula a competência anterior sem exigir folha salarial', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  const requests = [];
  h.data.loadSheets = async (supplier, options) => {
    requests.push(options.competence);
    return options.competence ? [{ id: '8', label: '09/2026' }] : [];
  };
  await openRubrics(h);
  for (const [rubric, value] of [['inss', '100'], ['fgts', '80']]) {
    h.input('[name=' + rubric + '-value]', value);
    h.input('[name=' + rubric + '-account]', '3');
  }
  h.input('[name=stage]', '4');
  await flush();
  const doc = h.dom.window.document;
  assert.equal(doc.querySelector('[name=taxCompetence]').value, '2026-09');
  assert.deepEqual(requests, [undefined, '2026-09']);
  assert.equal(doc.querySelector('[name=sheet]').closest('.supplier-payroll-field').hidden, true);
  h.input('[name=taxSheet]', '8');
  assert.match(doc.querySelector('[aria-label="Referência de INSS/FGTS"]').textContent, /Competência.*09\/2026.*IDFOLHA.*8/);
  await h.click('[data-payroll-post]');
  assert.equal(h.posts[0].sheet, null);
  assert.equal(h.posts[0].taxSheet.id, '8');
  assert.equal(h.posts[0].taxCompetence, '2026-09');
});

test('folha mista mantém IDFOLHA salarial e recarrega o ID de INSS da competência editada', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSheets = async (supplier, { competence }) => competence
    ? [{ id: competence === '2026-08' ? '8' : '9', label: competence === '2026-08' ? '08/2026' : '09/2026' }]
    : [{ id: '5', label: '10/2026' }];
  await fill(h);
  h.input('[name=inss-value]', '100');
  h.input('[name=inss-account]', '3');
  await flush();
  h.input('[name=taxSheet]', '9');
  h.input('[name=taxCompetence]', '2026-08');
  const doc = h.dom.window.document;
  assert.equal(doc.querySelector('[data-payroll-supplier]').dataset.payrollState, 'pending');
  await flush();
  h.input('[name=taxSheet]', '8');
  assert.match(doc.querySelector('[aria-label="Detalhes de INSS"]').textContent, /IDFOLHA8/);
  await h.click('[data-payroll-post]');
  assert.equal(h.posts[0].sheet.id, '5');
  assert.equal(h.posts[0].taxSheet.id, '8');
  assert.equal(h.posts[0].taxCompetence, '2026-08');
});

test('competência sem IDFOLHA cadastrado preserva a edição e bloqueia a postagem', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSheets = async () => [];
  await openRubrics(h);
  h.input('[name=fgts-value]', '80');
  h.input('[name=fgts-account]', '3');
  h.input('[name=stage]', '4');
  await flush();
  await h.click('[data-payroll-post]');
  const doc = h.dom.window.document;
  assert.match(doc.querySelector('[role=alert]').textContent, /competência.*IDFOLHA/i);
  assert.equal(doc.querySelector('[name=taxCompetence]').value, '2026-09');
  assert.equal(h.posts.length, 0);
});


test("BUSCAR oferece foto e arquivo, pré-seleciona comprovantes e envia só na rubrica confirmada", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  const doc = h.dom.window.document;
  const remote = new File(["tray"], "bandeja.pdf", { type: "application/pdf" });
  const photo = new File(["photo"], "foto.png", { type: "image/png" });
  const pdf = new File(["device"], "telefone.pdf", { type: "application/pdf" });
  h.tray.push({ id: "remote", fileName: remote.name, file: remote });
  const sources = [];
  h.receipts.pickReceiptAttachments = async kind => {
    sources.push(kind);
    return kind === "photo" ? [photo] : [pdf];
  };
  await h.click('[data-payroll-receipts="salary"]');
  assert.deepEqual([...doc.querySelector('.payroll-receipt-actions').children].map(n => n.textContent), ["Cancelar", "BUSCAR", "Continuar"]);
  doc.querySelector('[data-receipt-id="remote"]').checked = true;
  for (const kind of ["photo", "file"]) {
    await h.click("[data-receipt-search]");
    assert.match(doc.querySelector("[data-receipt-sources]").textContent, /foto.*arquivo/i);
    await h.click('[data-receipt-source="' + kind + '"]');
  }
  assert.deepEqual(sources, ["photo", "file"]);
  assert.equal(doc.querySelectorAll('[data-receipt-id]:checked').length, 3);
  assert.equal(doc.querySelector('[data-payroll-rubric=salary] .supplier-payroll-file-list').textContent, "");
  assert.equal(h.posts.length, 0);
  await h.click("[data-receipt-confirm]");
  assert.equal(doc.querySelector("[data-receipt-picker]"), null);
  assert.equal(doc.querySelector('[data-payroll-rubric=salary] .supplier-payroll-file-list').textContent, "bandeja.pdf×foto.png×telefone.pdf×");
  assert.equal(doc.querySelector('[data-payroll-rubric=allowance] .supplier-payroll-file-list').textContent, "");
  assert.deepEqual(h.reads, ["remote"]);
  h.input("[name=salary-value]", "100");
  h.input("[name=salary-account]", "3");
  h.input('[name=stage]', '4');
  h.input('[name=sheet]', '5');
  await h.click("[data-payroll-post]");
  const files = h.posts[0].lines.find(line => line.rubric === "salary").files;
  assert.deepEqual(files.map(f => f.name), [remote.name, photo.name, pdf.name]);
  assert.deepEqual(await Promise.all(files.map(f => f.text())), ["tray", "photo", "device"]);
  assert.equal(h.tray.length, 1);
});

test("BUSCAR funciona com bandeja vazia e cancelamento da busca preserva a seleção", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  const doc = h.dom.window.document;
  const file = new File(["pdf"], "novo.pdf", { type: "application/pdf" });
  h.receipts.pickReceiptAttachments = async () => [file];
  await h.click('[data-payroll-receipts="salary"]');
  assert.equal(doc.querySelector("[data-receipt-search]").disabled, false);
  await h.click("[data-receipt-search]");
  await h.click('[data-receipt-source="file"]');
  assert.equal(doc.querySelectorAll('[data-receipt-id]:checked').length, 1);
  assert.doesNotMatch(doc.querySelector(".payroll-receipt-options").textContent, /vazia/);
  h.receipts.pickReceiptAttachments = async () => [];
  await h.click("[data-receipt-search]");
  await h.click('[data-receipt-source="photo"]');
  assert.equal(doc.querySelectorAll('[data-receipt-id]:checked').length, 1);
  assert.equal(doc.querySelector("[data-receipt-error]").hidden, true);
  await h.click("[data-receipt-confirm]");
  await h.click('[data-payroll-receipts="salary"]');
  const linked = doc.querySelector("[data-receipt-id]");
  assert.equal(linked.disabled, true);
  assert.match(linked.parentElement.textContent, /novo.pdf.*já vinculado/);
});

test("BUSCAR valida o lote inteiro e mantém arquivos escolhidos após erro ou nomes duplicados", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  const doc = h.dom.window.document;
  await h.click('[data-payroll-receipts="salary"]');
  for (const result of [
    [new File(["ok"], "valido.pdf"), new File(["bad"], "invalido.exe")],
    [new File(["a"], "igual.pdf"), new File(["b"], "igual.pdf")],
  ]) {
    h.receipts.pickReceiptAttachments = async () => result;
    await h.click("[data-receipt-search]");
    await h.click('[data-receipt-source="file"]');
    assert.equal(doc.querySelector("[data-receipt-error]").hidden, false);
    assert.equal(doc.querySelectorAll("[data-receipt-id]").length, 0);
    assert.equal(doc.querySelector("[data-receipt-confirm]").disabled, true);
  }
  h.receipts.pickReceiptAttachments = async () => [new File(["ok"], "escolhido.pdf")];
  await h.click("[data-receipt-search]");
  await h.click('[data-receipt-source="file"]');
  h.receipts.pickReceiptAttachments = async () => { throw new Error("Permissão negada"); };
  await h.click("[data-receipt-search]");
  await h.click('[data-receipt-source="photo"]');
  assert.match(doc.querySelector("[data-receipt-error]").textContent, /Permissão negada/);
  assert.equal(doc.querySelectorAll('[data-receipt-id]:checked').length, 1);
  await h.click("[data-receipt-confirm]");
  assert.match(doc.querySelector(".supplier-payroll-file-list").textContent, /escolhido.pdf/);
});

test("BUSCAR não abre duas buscas nem confirma enquanto aguarda e descarta resultado após fechar", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  const doc = h.dom.window.document;
  let resolve, count = 0;
  h.receipts.pickReceiptAttachments = () => { count++; return new Promise(r => { resolve = r; }); };
  for (const close of ["cancel", "view"]) {
    await h.click('[data-payroll-receipts="salary"]');
    await h.click("[data-receipt-search]");
    await h.click('[data-receipt-source="file"]');
    assert.equal(doc.querySelector("[data-receipt-confirm]").disabled, true);
    doc.querySelector('[data-receipt-source="photo"]').click();
    assert.equal(count, close === "cancel" ? 1 : 2);
    if (close === "cancel") await h.click("[data-receipt-cancel]");
    else { h.view.close(); await h.view.open(); }
    resolve([new File(["late"], "tardio.pdf")]);
    await flush();
    assert.equal(doc.querySelector("[data-receipt-picker]"), null);
    assert.equal(doc.querySelector(".supplier-payroll-file-list").textContent, "");
  }
});

test('payment account can be searched in its original payroll field', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  h.input('[name=salary-value]', '100');
  const row = h.dom.window.document.querySelector('[data-payroll-rubric=salary]');
  const input = row.querySelector('[role=combobox]');
  assert.ok(input, 'payment selector itself must accept typing');
  input.focus(); input.value = 'pix';
  input.dispatchEvent(new h.dom.window.Event('input', { bubbles: true }));
  assert.equal(row.querySelector('.sfs-popup input'), null);
  assert.equal(row.querySelector('[name=salary-account]').value, '');
  row.querySelector('[role=option]').click();
  assert.equal(row.querySelector('[name=salary-account]').value, '3');
  assert.equal(row.dataset.payrollCompletion, 'complete');
  h.input('[name=salary-value]', '');
  await flush();
  assert.equal(input.disabled, true);
  assert.equal(input.closest('.supplier-payroll-field').hidden, true);
  assert.equal(row.querySelector('.sfs-popup').hidden, true);
});

test("resumo associa contexto e valores a cabeçalhos de tabela sem alterar a postagem", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await fill(h);
  const doc = h.dom.window.document;
  const context = doc.querySelector('table[aria-label="Referência da folha"]');
  assert.ok(context, "etapa e referência devem estar estruturadas");
  assert.deepEqual([...context.rows].map(row => [...row.cells].map(cell => cell.textContent)), [
    ["Etapa", "FUNDAÇÃO"], ["IDFOLHA", "5"], ["Referência", "10/2026"],
  ]);
  const details = doc.querySelector('table[aria-label="Detalhes de Salário"]');
  assert.ok(details);
  assert.deepEqual([...details.rows].map(row => [...row.cells].map(cell => cell.textContent)), [
    ["Quantidade", "2"], ["Valor unitário", "R$\u00a0100,50"], ["Subtotal", "R$\u00a0201,00"],
    ["Forma de pagamento", "PIX"], ["Comprovantes", "Sem comprovantes"],
  ]);
  for (const table of [context, details]) {
    assert.ok([...table.rows].every(row => row.cells[0].tagName === "TH" && row.cells[0].scope === "row"));
  }
  const total = doc.querySelector('[data-payroll-summary-total]');
  assert.match(total.textContent, /Total pago.*201,00/);
  await h.click('[data-payroll-post]');
  assert.equal(h.posts[0].total, 201);
  assert.equal(h.posts[0].sheet.id, "5");
});

test("resumo separa rubricas ativas e lista comprovantes como texto seguro", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  h.input('[name=salary-value]', "3");
  h.input('[name=salary-account]', "3");
  h.input('[name=allowance-value]', "10,25");
  h.input('[name=allowance-quantity]', "2");
  h.input('[name=allowance-account]', "3");
  const names = ['salario & <img src=x>.pdf', 'comprovante-extra.pdf'];
  const files = names.map(name => new File(["a"], name, { type: "application/pdf" }));
  h.tray.push(...files.map((file, i) => ({ id: String(i), fileName: file.name, file })));
  await h.click('[data-payroll-receipts="salary"]');
  for (const checkbox of h.dom.window.document.querySelectorAll('[data-receipt-id]')) checkbox.checked = true;
  await h.click('[data-receipt-confirm]');
  h.input('[name=stage]', '4');
  h.input('[name=sheet]', '5');
  const doc = h.dom.window.document;
  assert.equal(doc.querySelectorAll('.supplier-payroll-summary article').length, 2);
  const table = doc.querySelector('table[aria-label="Detalhes de Salário"]');
  assert.ok(table);
  assert.deepEqual([...table.querySelectorAll('li')].map(el => el.textContent), names);
  assert.equal(table.querySelector('img'), null);
  assert.match(doc.querySelector('table[aria-label="Detalhes de Ajuda de custo"]').textContent, /20,50/);
  assert.match(doc.querySelector('[data-payroll-summary-total]').textContent, /23,50/);
});

test("painel mantém os quatro dados em tabela durante o preenchimento", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSuppliers = async () => [{ id: "1", label: "CLEITON CESAR NONATO",
    profession: "SERVENTE DE PEDREIRO", branch: "004 - EDIFÍCIO XAVANTE" }];
  h.data.loadProducts = async () => [{ id: "2", label: "OUTRO SERVIÇO" }];
  const check = () => {
    const table = h.dom.window.document.querySelector('table[aria-label="Dados da folha"]');
    assert.ok(table, "dados associados a cabeçalhos de linha, não texto corrido");
    assert.deepEqual([...table.rows].map(row => [...row.cells].map(cell => cell.textContent)), [
      ["Fornecedor", "CLEITON CESAR NONATO"],
      ["Profissão", "SERVENTE DE PEDREIRO"],
      ["Data", "02/10/2026"],
      ["Filial", "004 - EDIFÍCIO XAVANTE"],
    ]);
    assert.ok([...table.rows].every(row => row.cells[0].tagName === "TH" && row.cells[0].scope === "row"));
    assert.ok(table.closest("[data-payroll-supplier]"));
  };
  await openRubrics(h);
  check();
  h.input('[name="salary-value"]', "100");
  h.input('[name="salary-account"]', "3");
  h.input("[name=stage]", "4");
  check();
  h.input("[name=sheet]", "5");
  check();
});

test("tabela usa profissão escolhida quando cadastro não informa e mantém nomes como texto seguro", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSuppliers = async () => [{ id: "1", label: 'OFICINA & <img src=x onerror="alert(1)">', branch: "" }];
  await openRubrics(h);
  const table = h.dom.window.document.querySelector('table[aria-label="Dados da folha"]');
  assert.ok(table);
  assert.equal(table.rows[0].cells[1].textContent, 'OFICINA & <img src=x onerror="alert(1)">');
  assert.equal(table.rows[1].cells[1].textContent, "PEDREIRO");
  assert.equal(table.rows[3].cells[1].textContent, "—");
  assert.equal(table.querySelector("img"), null);
});

test("tabela trata campos com apenas espaços como ausentes", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSuppliers = async () => [{ id: "1", label: "  EDGAR  ", profession: "   ", branch: "   " }];
  await openRubrics(h);
  const table = h.dom.window.document.querySelector('table[aria-label="Dados da folha"]');
  assert.deepEqual([...table.rows].map(row => row.cells[1].textContent), ["EDGAR", "PEDREIRO", "02/10/2026", "—"]);
});

test('Postar fica abaixo dos fornecedores e do total agregado', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  const doc = h.dom.window.document;
  assert.equal(doc.querySelector('.supplier-payroll-footer [data-payroll-next]').textContent, 'Continuar');
  await openSuppliers(h);
  const total = doc.querySelector('[data-payroll-batch-total]');
  const post = doc.querySelector('[data-payroll-post]');
  assert.equal(total.previousElementSibling.className, 'supplier-payroll-empty');
  assert.equal(post.previousElementSibling.previousElementSibling, total);
  assert.equal(post.disabled, true);
  assert.equal(doc.querySelector('.supplier-payroll-footer').hidden, true);
  await h.click('[data-payroll-select]');
  assert.equal(post.disabled, false);
});


test("quantidade padrão não ativa rubrica e pagamento só aparece com valor informado", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  const doc = h.dom.window.document;
  const row = doc.querySelector('[data-payroll-rubric="salary"]');
  const account = row.querySelector('[name=salary-account]');
  assert.equal(row.querySelector('[name=salary-quantity]').value, "1");
  assert.equal(row.dataset.payrollCompletion, "empty");
  assert.equal(account.closest('.supplier-payroll-field').hidden, true);
  assert.equal(account.disabled, true);
  assert.equal(account.required, false);
  h.input('[name=salary-value]', "100,50");
  assert.equal(account.closest('.supplier-payroll-field').hidden, false);
  assert.equal(account.disabled, false);
  assert.equal(account.required, true);
  assert.equal(row.dataset.payrollCompletion, "pending");
  assert.match(row.querySelector('[data-payroll-line-status]').textContent, /Pendente/);
  h.input('[name=salary-account]', "3");
  assert.equal(row.dataset.payrollCompletion, "complete");
  assert.match(row.querySelector('[data-payroll-line-status]').textContent, /Completa/);
  h.input('[name=salary-quantity]', "0");
  assert.equal(row.dataset.payrollCompletion, "pending");
  h.input('[name=salary-quantity]', "2");
  assert.equal(row.dataset.payrollCompletion, "complete");
  h.input('[name=salary-value]', "0,00");
  assert.equal(account.closest('.supplier-payroll-field').hidden, true);
  assert.equal(account.required, false);
  assert.equal(row.dataset.payrollCompletion, "pending");
  assert.match(row.querySelector('[data-payroll-line-status]').textContent, /Valor zero.*não será enviada/);
  h.input('[name=salary-value]', "150");
  assert.equal(account.closest('.supplier-payroll-field').hidden, false);
  assert.equal(account.required, true);
  assert.equal(row.dataset.payrollCompletion, "complete");
  h.input('[name=salary-value]', "abc");
  assert.equal(row.dataset.payrollCompletion, "pending");
  h.input('[name=salary-value]', "");
  assert.equal(account.closest('.supplier-payroll-field').hidden, true);
  assert.equal(account.required, false);
  assert.equal(row.dataset.payrollCompletion, "pending");
});

test('rubrica iniciada precisa de valor, rubricas em branco podem ficar fora da folha', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await fill(h);
  h.input('[name=allowance-quantity]', '3');
  await h.click('[data-payroll-post]');
  assert.equal(h.posts.length, 0);
  assert.match(h.dom.window.document.querySelector('[role=alert]').textContent, /valor unitário de Ajuda de custo/);
  h.input('[name=allowance-quantity]', '1');
  await h.click('[data-payroll-post]');
  assert.equal(h.posts[0].total, 201);
  assert.deepEqual(h.posts[0].lines.map(line => line.rubric), ['salary']);
});

test('IDFOLHA é escolhido no painel e enviado na postagem obrigatória', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await fillToSheet(h);
  const doc = h.dom.window.document;
  await h.click('[data-payroll-post]');
  assert.match(doc.querySelector('[role=alert]').textContent, /IDFOLHA.*obrigatório/);
  assert.equal(h.posts.length, 0);
  h.input('[name=sheet]', '5');
  assert.deepEqual([...doc.querySelector('table[aria-label="Referência da folha"]').rows].map(row => row.cells[1].textContent), ['FUNDAÇÃO', '5', '10/2026']);
  await h.click('[data-payroll-post]');
  assert.equal(h.posts[0].sheet.id, '5');
  assert.match(doc.querySelector('.supplier-payroll-card-result').textContent, /postada e vinculada.*IDFOLHA: 5/);
});

test('seta retorna à data e conserva os painéis preenchidos ao voltar à mesma data', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  const doc = h.dom.window.document;
  await fill(h);
  const nav = doc.querySelector('.supplier-payroll-header .screen-navigation');
  assert.equal(nav.firstElementChild.dataset.navigationIcon, '↩️');
  assert.equal(nav.lastElementChild.dataset.navigationIcon, '🏠');
  await h.click('[data-payroll-header-back]');
  assert.equal(doc.querySelector('[name=date]').value, '2026-10-02');
  await h.click('[data-payroll-next]');
  assert.equal(doc.querySelector('[name=salary-value]').value, '100,50');
  assert.equal(doc.querySelector('[name=sheet]').value, '5');
  assert.equal(doc.querySelector('[data-payroll-select]').checked, true);
});

test('casinha sai para o menu e descarta a folha não postada', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await fill(h);
  await h.click('[data-payroll-home]');
  assert.equal(h.home, 1);
  assert.equal(h.closed, 1);
  await h.view.open();
  assert.equal(h.dom.window.document.querySelector('[name=date]').value, '');
  assert.equal(h.posts.length, 0);
});

test('voltar à data cancela a consulta pendente de um painel', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  let resolveStages, signal;
  h.data.loadStages = (supplier, options) => new Promise(resolve => { resolveStages = resolve; signal = options.signal; });
  await openSuppliers(h);
  await h.click('[data-payroll-expand]');
  await h.click('[data-payroll-header-back]');
  assert.equal(signal.aborted, true);
  resolveStages([{ id: '4', label: 'FUNDAÇÃO' }]);
  await flush();
  assert.equal(h.dom.window.document.querySelector('[name=stage]'), null);
  assert.equal(h.dom.window.document.querySelector('[name=date]').value, '2026-10-02');
});


test("seta e casinha não interrompem uma gravação de folha já em andamento", async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await fill(h);
  const complete = h.data.post;
  let finish;
  h.data.post = async (draft, progress) => { await new Promise(resolve => { finish = resolve; }); return complete(draft, progress); };
  await h.click('[data-payroll-post]');
  const doc = h.dom.window.document;
  assert.equal(doc.querySelector('[data-payroll-header-back]').disabled, true);
  assert.equal(doc.querySelector('[data-payroll-home]').disabled, true);
  await h.click('[data-payroll-header-back]');
  await h.click('[data-payroll-home]');
  assert.equal(h.closed, 0);
  assert.equal(h.home, 0);
  finish();
  await flush();
  assert.match(doc.querySelector('.supplier-payroll-card-result').textContent, /Folha postada/);
  assert.equal(doc.querySelector('[data-payroll-home]').disabled, false);
  await h.click('[data-payroll-home]');
  assert.equal(h.home, 1);
});
test('sem IDFOLHA cadastrado o painel explica a pendência e preserva os dados', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSheets = async () => [];
  await fillToSheet(h);
  const doc = h.dom.window.document;
  assert.equal(doc.querySelector('[name=sheet]').disabled, true);
  assert.match(doc.body.textContent, /Cadastre uma folha válida/);
  await h.click('[data-payroll-post]');
  assert.equal(h.posts.length, 0);
  assert.equal(doc.querySelector('[name=stage]').value, '4');
  h.data.loadSheets = async () => [{ id: '5', label: '10/2026' }];
  await h.click('[data-payroll-reload-sheet]');
  assert.equal(doc.querySelector('[name=stage]').value, '4');
  assert.equal(doc.querySelector('[name=salary-value]').value, '100,50');
  h.input('[name=sheet]', '5');
  await h.click('[data-payroll-post]');
  assert.equal(h.posts[0].sheet.id, '5');
});

test('falha ao carregar um fornecedor permite repetir a consulta no painel', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  h.data.loadSheets = async () => { throw new Error('sem rede para IDFOLHA'); };
  await openSuppliers(h);
  await h.click('[data-payroll-expand]');
  const doc = h.dom.window.document;
  assert.match(doc.querySelector('[data-payroll-supplier] [role=alert]').textContent, /sem rede/);
  h.data.loadSheets = async () => [{ id: '5', label: '10/2026' }];
  await h.click('[data-payroll-retry-options]');
  assert.equal(doc.querySelector('[name=sheet] option[value="5"]').value, '5');
});

test('formulário inválido conserva os valores e explica a forma de pagamento em falta', async t => {
  const h = await harness();
  t.after(() => { h.view.destroy(); h.dom.window.close(); });
  await openRubrics(h);
  h.input('[name=stage]', '4');
  h.input('[name=salary-value]', '10');
  await h.click('[data-payroll-post]');
  const doc = h.dom.window.document;
  assert.equal(h.posts.length, 0);
  assert.match(doc.querySelector('[role=alert]').textContent, /pagamento|conta/i);
  assert.equal(doc.querySelector('[name=salary-value]').value, '10');
});


test("envio duplo é bloqueado e erro preserva resumo para retentativa", async (t) => {
  const h = await harness();
  t.after(() => {
    h.view.destroy();
    h.dom.window.close();
  });
  await fill(h);
  let reject;
  h.data.post = async () => {
    h.posts.push({});
    return new Promise((_, r) => {
      reject = r;
    });
  };
  const button = h.dom.window.document.querySelector("[data-payroll-post]");
  button.click();
  button.click();
  await flush();
  assert.equal(h.posts.length, 1);
  reject(new Error("sem rede"));
  await flush();
  assert.match(
    h.dom.window.document.querySelector("[role=alert]").textContent,
    /sem rede/,
  );
  assert.ok(h.dom.window.document.querySelector("[data-payroll-post]"));
});
test("comprovantes ficam associados à rubrica e são descartados ao destruir", async (t) => {
  const h = await harness();
  t.after(() => h.dom.window.close());
  await fill(h);
  const file = new File(["a"], "salario.pdf", { type: "application/pdf" });
  h.tray.push({ id: "a", fileName: file.name, file });
  await h.click('[data-payroll-receipts="salary"]');
  h.dom.window.document.querySelector('[data-receipt-id="a"]').checked = true;
  await h.click('[data-receipt-confirm]');
  assert.match(h.dom.window.document.body.textContent, /salario.pdf/);
  h.input('[name=stage]', '4');
  h.input('[name=sheet]', '5');
  await h.click("[data-payroll-post]");
  assert.equal(h.posts[0].lines[0].files[0].name, "salario.pdf");
  h.view.destroy();
  assert.equal(
    h.dom.window.document.querySelector(".supplier-payroll-page"),
    null,
  );
});

test("consulta antiga não altera etapa ao fechar e reabrir página", async (t) => {
  const h = await harness();
  t.after(() => {
    h.view.destroy();
    h.dom.window.close();
  });
  let resolve;
  h.data.loadSuppliers = () =>
    new Promise((r) => {
      resolve = r;
    });
  h.input("[name=date]", "2026-10-02");
  await h.click("[data-payroll-next]");
  h.view.close();
  await h.view.open();
  resolve([{ id: "1", label: "EDGAR", branch: "OBRA A" }]);
  await flush();
  h.data.loadSuppliers = async () => [
    { id: "1", label: "EDGAR", branch: "OBRA A" },
  ];
  await h.click("[data-payroll-next]");
  assert.equal(
    h.dom.window.document.querySelectorAll("[data-payroll-expand]").length,
    1,
  );
});

test("erro no vínculo conserva o IDFOLHA e exige retomada antes da conclusão", async (t) => {
  const h = await harness();
  t.after(() => {
    h.view.destroy();
    h.dom.window.close();
  });
  await fill(h);
  const complete = h.data.post;
  h.data.post = async (draft, progress) => {
    progress.fingerprint = "postagem iniciada";
    throw new Error("não foi possível confirmar o vínculo ao IDFOLHA");
  };
  await h.click("[data-payroll-post]");
  const doc = h.dom.window.document;
  assert.match(doc.body.textContent, /Resumo da folha/);
  assert.equal(doc.querySelector('table[aria-label="Referência da folha"]').rows[1].cells[1].textContent, "5");
  assert.match(doc.querySelector("[data-payroll-post]").textContent, /Retomar/);
  assert.equal(doc.querySelector("[name=sheet]").matches(":disabled"), true);
  assert.ok(
    ![...doc.querySelectorAll("button")].some(
      (b) => b.textContent === "Concluir",
    ),
  );
  h.data.post = complete;
  await h.click("[data-payroll-post]");
  assert.equal(h.posts[0].sheet.id, "5");
  assert.match(doc.body.textContent, /postada e vinculada/);
});
