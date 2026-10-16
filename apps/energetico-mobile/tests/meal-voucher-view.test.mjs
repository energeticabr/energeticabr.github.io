import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { createMealVoucherView } from '../src/ui/meal-voucher-view.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('revisão do vale mostra cartões por colaborador, total, OBS e anexos sem postar antes da confirmação', async () => {
  const css = readFileSync(new URL('../src/ui/meal-voucher.css', import.meta.url), 'utf8');
  const dom = new JSDOM(`<!doctype html><style>${css}</style><body></body>`, { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const suppliers = [
    { id: '1', label: 'Ana Silva', branch: 'OBRA A', profession: 'PEDREIRO' },
    { id: '2', label: 'Bruno Souza', branch: 'OBRA A', profession: 'MESTRE DE OBRAS' },
  ];
  let posts = 0;
  const panel = createMealVoucherView({ documentRef: doc, data: {
    loadOptions: async () => ({ suppliers, accounts: [{ id: '8', label: 'CAIXA' }], stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }] }),
    loadOrders: async () => [],
    loadSheetAssignments: async () => ({ '1': { id: '11' }, '2': { id: '12' } }),
    post: async () => { posts++; return { orderId: '5', lines: [], total: 100 }; },
  } });
  const type = (selector, value) => { const input = doc.querySelector(selector); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  try {
    await panel.open();
    type('[data-meal-value="1"]', '20');
    doc.querySelector('[data-meal-next]').click(); await tick();
    doc.querySelector('[data-meal-order-new]').click();
    for (const [name, value] of [['meal-date', '2026-10-15'], ['meal-due-date', '2026-10-30'], ['meal-reference-month', '2026-10']]) type(`[name="${name}"]`, value);
    for (const [name, value] of [['meal-account', '8'], ['meal-stage', '7']]) {
      const select = doc.querySelector(`[name="${name}"]`); select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }
    doc.querySelector('[data-meal-next]').click(); await tick();
    type('[name="meal-obs"]', 'Semana com feriado');
    const file = new dom.window.File(['arquivo'], 'comprovante.pdf', { type: 'application/pdf' });
    Object.defineProperty(doc.querySelector('[name="meal-files"]'), 'files', { value: [file], configurable: true });
    doc.querySelector('[name="meal-files"]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    doc.querySelector('[data-meal-next]').click();

    const review = doc.querySelector('[data-meal-review]');
    assert.ok(review, 'a revisão deve usar o layout em cartões');
    assert.match(review.querySelector('[data-meal-order-card]').textContent, /Pedido novo/);
    assert.match(review.querySelector('[data-meal-order-card]').textContent, /Pagamento efetuado não informado/);
    assert.equal(review.querySelectorAll('[data-meal-person-card]').length, 1, 'só exibe fornecedores selecionados');
    assert.match(review.querySelector('[data-meal-person-card]').textContent, /Ana Silva/);
    assert.match(review.querySelector('[data-meal-person-card]').textContent, /IDFOLHA 11/);
    assert.match(review.querySelector('[data-meal-person-card]').textContent, /5/);
    assert.match(review.querySelector('[data-meal-person-card]').textContent, /R\$\s*20,00/);
    assert.match(review.querySelector('[data-meal-review-total]').textContent, /R\$\s*100,00/);
    assert.match(review.querySelector('[data-meal-review-total]').textContent, /5 dias/);
    assert.match(review.querySelector('[data-meal-review-notes]').textContent, /Semana com feriado/);
    assert.match(review.querySelector('[data-meal-review-files]').textContent, /comprovante\.pdf/);
    assert.ok(doc.querySelector('[data-meal-review-back]'), 'há Voltar no rodapé da revisão');
    assert.equal(posts, 0);
    doc.querySelector('[data-meal-review-back]').click();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /OBS ou anexos/);
    doc.querySelector('[data-meal-next]').click();
    assert.equal(posts, 0);
  } finally { panel.destroy(); dom.window.close(); }
});

test('dados do vale alimentação permitem filtrar conta e etapa digitando sem mudar a escolha até selecionar', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const panel = createMealVoucherView({ documentRef: doc, data: {
    loadOptions: async () => ({
      suppliers: [{ id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO' }],
      accounts: [{ id: '8', label: 'ENERGÉTICA CAIXA' }, { id: '9', label: 'BANCO OBRA' }],
      stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }, { id: '6', label: 'ALVENARIA', branch: 'OBRA A' }],
    }),
    loadOrders: async () => [],
    loadSheetAssignments: async () => ({ '1': { id: '11' } }),
  } });
  const type = (input, value) => { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  try {
    await panel.open();
    type(doc.querySelector('[data-meal-value="1"]'), '10');
    doc.querySelector('[data-meal-next]').click(); await tick();
    doc.querySelector('[data-meal-order-new]').click();

    const account = doc.querySelector('[name="meal-account"]');
    const stage = doc.querySelector('[name="meal-stage"]');
    assert.equal(account.hidden, true);
    assert.equal(stage.hidden, true);
    const accountSearch = account.nextElementSibling.querySelector('[role="combobox"]');
    accountSearch.focus(); type(accountSearch, 'banco');
    assert.equal(account.value, '', 'digitar não confirma uma opção');
    assert.deepEqual([...account.nextElementSibling.querySelectorAll('[role="option"]')].map(option => option.textContent), ['BANCO OBRA']);
    account.nextElementSibling.querySelector('[role="option"]').click();
    assert.equal(account.value, '9');

    const stageSearch = stage.nextElementSibling.querySelector('[role="combobox"]');
    stageSearch.focus(); type(stageSearch, 'fundacao');
    assert.equal(stage.value, '');
    assert.deepEqual([...stage.nextElementSibling.querySelectorAll('[role="option"]')].map(option => option.textContent), ['FUNDAÇÃO']);
    stage.nextElementSibling.querySelector('[role="option"]').click();
    assert.equal(stage.value, '7');

    for (const [name, value] of [['meal-date', '2026-10-15'], ['meal-due-date', '2026-10-30'], ['meal-reference-month', '2026-10']]) {
      type(doc.querySelector(`[name="${name}"]`), value);
    }
    doc.querySelector('[data-meal-next]').click(); await tick();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /OBS ou anexos/);
    doc.querySelector('.meal-voucher-navigation').click();
    assert.equal(doc.querySelector('[name="meal-account"]').value, '9');
    assert.equal(doc.querySelector('[name="meal-stage"]').value, '7');
  } finally { panel.destroy(); dom.window.close(); }
});

test('destaca em verde somente linhas que serão incluídas no lançamento', async () => {
  const css = readFileSync(new URL('../src/ui/meal-voucher.css', import.meta.url), 'utf8');
  const dom = new JSDOM(`<!doctype html><style>${css}</style><body></body>`, { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const suppliers = [
    { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO' },
    { id: '2', label: 'Bruno', branch: 'OBRA A', profession: 'PEDREIRO' },
  ];
  const panel = createMealVoucherView({ documentRef: doc, data: {
    loadOptions: async () => ({ suppliers, accounts: [], stages: [] }),
  } });
  await panel.open();
  const row = doc.querySelector('[data-meal-supplier="2"]');
  const value = row.querySelector('[data-meal-value]');
  const quantity = row.querySelector('[data-meal-quantity]');
  const background = () => dom.window.getComputedStyle(row).backgroundColor;
  const plain = background();
  const type = (input, text) => { input.value = text; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };

  type(value, '10');
  const green = background().match(/\d+/g)?.map(Number);
  assert.ok(green && green[1] > green[0] && green[1] > green[2], 'a linha com valor deve ter fill verde');
  assert.notEqual(background(), plain, 'o verde deve vencer o preenchimento alternado da tabela');
  assert.notEqual(dom.window.getComputedStyle(doc.querySelector('[data-meal-supplier="1"]')).backgroundColor, background(), 'outras linhas não recebem o fill verde');

  type(quantity, '');
  assert.equal(background(), plain, 'quantidade vazia não será submetida');
  type(quantity, '5');
  assert.notEqual(background(), plain);
  type(value, '0');
  assert.equal(background(), plain, 'valor zero não será submetido');
  type(value, '');
  assert.equal(background(), plain, 'limpar o valor remove o destaque');
  panel.destroy(); dom.window.close();
});

test('vale alimentação inicia cada quantidade em 5 e preserva alterações manuais', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const suppliers = [
    { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO' },
    { id: '2', label: 'Bruno', branch: 'OBRA A', profession: 'PEDREIRO' },
  ];
  const panel = createMealVoucherView({ documentRef: doc, data: {
    loadOptions: async () => ({ suppliers, accounts: [], stages: [] }),
    loadOrders: async () => [],
  } });
  await panel.open();
  assert.equal(doc.querySelector('[data-meal-quantity="1"]').value, '5');
  assert.equal(doc.querySelector('[data-meal-quantity="2"]').value, '5');
  const quantity = doc.querySelector('[data-meal-quantity="1"]');
  quantity.value = '4';
  quantity.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const value = doc.querySelector('[data-meal-value="1"]');
  value.value = '10';
  value.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  doc.querySelector('[data-meal-next]').click();
  await tick();
  doc.querySelector('.meal-voucher-navigation').click();
  assert.equal(doc.querySelector('[data-meal-quantity="1"]').value, '4');
  assert.equal(doc.querySelector('[data-meal-quantity="2"]').value, '5');
  panel.destroy(); dom.window.close();
});
test('vale alimentação: lista fornecedores, soma valores e só posta depois da confirmação', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const supplier = { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO' };
  let posts = 0, postedPaymentDate;
  const panel = createMealVoucherView({ documentRef: doc, data: {
    loadOptions: async () => ({ suppliers: [supplier], accounts: [{ id: '8', label: 'CAIXA' }], stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }] }),
    loadOrders: async () => [],
    loadSheetAssignments: async () => ({ '1': { id: '11' } }),
    post: async draft => { posts++; postedPaymentDate = draft.paymentDate; return { orderId: '5', lines: [{ id: '9', supplier: 'Ana', sheetId: '11', payrollId: '31' }], total: Number(draft.lines[0].quantity) * Number(draft.lines[0].unitValue) }; },
  } });
  await panel.open(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Ana/);
  const value = doc.querySelector('[data-meal-value="1"]'); value.value = '10'; value.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  assert.match(doc.querySelector('[data-meal-total]').textContent, /50,00/);
  doc.querySelector('[data-meal-next]').click(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /pedido novo/i);
  doc.querySelector('[data-meal-order-new]').click(); await tick();
  const date = doc.querySelector('[name="meal-date"]'); date.value = '2026-10-15'; date.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const due = doc.querySelector('[name="meal-due-date"]'); due.value = '2026-10-30'; due.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const paid = doc.querySelector('[name="meal-payment-date"]'); assert.ok(paid, 'a data de pagamento efetuado é perguntada antes da confirmação'); paid.value = '2026-10-16'; paid.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  const month = doc.querySelector('[name="meal-reference-month"]'); month.value = '2026-10'; month.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  doc.querySelector('[name="meal-account"]').value = '8'; doc.querySelector('[name="meal-account"]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  doc.querySelector('[name="meal-stage"]').value = '7'; doc.querySelector('[name="meal-stage"]').dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  doc.querySelector('[data-meal-next]').click(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /OBS/i);
  doc.querySelector('[data-meal-next]').click(); await tick();
  assert.equal(posts, 0);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /PEDREIRO/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /2026-10/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /IDFOLHA 11/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Pagamento efetuado 2026-10-16/);
  doc.querySelector('[data-meal-confirm]').click(); await tick();
  assert.equal(posts, 1);
  assert.equal(postedPaymentDate, '2026-10-16');
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Pedido 5/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /50,00/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Vínculo 31/);
  panel.destroy(); dom.window.close();
});

test('envio interrompido retoma com o mesmo token após recriar a tela e mostra os IDs já salvos', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document, cache = new Map(), attempts = [];
  const storage = { getItem: key => cache.get(key) || null, setItem: (key, value) => cache.set(key, value), removeItem: key => cache.delete(key) };
  const supplier = { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO' };
  const data = {
    loadOptions: async () => ({ suppliers: [supplier], accounts: [{ id: '8', label: 'CAIXA' }], stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }] }),
    loadOrders: async () => [], loadSheetAssignments: async () => ({ '1': { id: '11' } }),
    post: async (draft, progress, onProgress) => {
      attempts.push(progress.operationId);
      if (attempts.length === 1) { progress.signature = 'iniciada'; progress.orderId = '5'; progress.lines = { '1': '9' }; onProgress(); throw new Error('rede interrompida'); }
      return { orderId: '5', lines: [{ id: '9', supplier: 'Ana', sheetId: '11', payrollId: '31' }], total: Number(draft.lines[0].quantity) * Number(draft.lines[0].unitValue) };
    },
  };
  const panel = createMealVoucherView({ documentRef: doc, data, sessionKey: 'account-1', storage });
  await panel.open(); await tick();
  const value = doc.querySelector('[data-meal-value="1"]'); value.value = '10'; value.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  doc.querySelector('[data-meal-next]').click(); await tick();
  doc.querySelector('[data-meal-order-new]').click(); await tick();
  for (const [name, value] of [['meal-date','2026-10-15'],['meal-due-date','2026-10-30'],['meal-reference-month','2026-10']]) {
    const input = doc.querySelector(`[name="${name}"]`); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  }
  for (const [name, value] of [['meal-account','8'],['meal-stage','7']]) {
    const input = doc.querySelector(`[name="${name}"]`); input.value = value; input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  }
  doc.querySelector('[data-meal-next]').click(); await tick();
  doc.querySelector('[data-meal-next]').click(); await tick();
  doc.querySelector('[data-meal-confirm]').click(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Pedido 5|pedido 5/);
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Lançamento 9/);
  panel.destroy();
  const resumed = createMealVoucherView({ documentRef: doc, data, sessionKey: 'account-1', storage });
  await resumed.open(); await tick();
  assert.match(doc.querySelector('.meal-voucher-page').textContent, /Retomar envio/);
  doc.querySelector('[data-meal-confirm]').click(); await tick();
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0], attempts[1]);
  assert.equal(cache.size, 0);
  resumed.destroy(); dom.window.close();
});

test('seta volta à pergunta anterior após falha no envio sem fechar o vale-alimentação', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document;
  const supplier = { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO' };
  let homeCalls = 0;
  const panel = createMealVoucherView({ documentRef: doc, onHome: () => { homeCalls++; }, data: {
    loadOptions: async () => ({ suppliers: [supplier], accounts: [{ id: '8', label: 'CAIXA' }], stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }] }),
    loadOrders: async () => [],
    loadSheetAssignments: async () => ({ '1': { id: '11' } }),
    post: async (_draft, progress, onProgress) => { progress.signature = 'envio-iniciado'; onProgress(); throw new Error('General exception while processing'); },
  } });
  const type = (selector, value) => { const input = doc.querySelector(selector); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  try {
    await panel.open();
    type('[data-meal-value="1"]', '10');
    doc.querySelector('[data-meal-next]').click(); await tick();
    doc.querySelector('[data-meal-order-new]').click();
    for (const [name, value] of [['meal-date', '2026-10-15'], ['meal-due-date', '2026-10-30'], ['meal-reference-month', '2026-10']]) type(`[name="${name}"]`, value);
    for (const [name, value] of [['meal-account', '8'], ['meal-stage', '7']]) {
      const select = doc.querySelector(`[name="${name}"]`); select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }
    doc.querySelector('[data-meal-next]').click(); await tick();
    type('[name="meal-obs"]', 'feriado');
    doc.querySelector('[data-meal-next]').click();
    doc.querySelector('[data-meal-confirm]').click(); await tick();
    assert.match(doc.querySelector('.meal-voucher-error').textContent, /General exception/);

    doc.querySelector('[aria-label="Voltar"]').click();
    assert.equal(doc.querySelector('.meal-voucher-page').hidden, false);
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /OBS ou anexos/);
    assert.equal(doc.querySelector('[name="meal-obs"]').value, 'feriado');
    assert.equal(doc.querySelector('[name="meal-obs"]').disabled, true, 'lote iniciado é somente para revisão');
    doc.querySelector('[aria-label="Voltar"]').click();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /Informe os dados/);
    assert.equal(doc.querySelector('[name="meal-date"]').value, '2026-10-15');
    assert.equal(doc.querySelector('[name="meal-date"]').disabled, true);
    doc.querySelector('[aria-label="Voltar"]').click();
    assert.match(doc.querySelector('.meal-voucher-content').textContent, /Pedido escolhido: novo/);
    doc.querySelector('[aria-label="Voltar"]').click();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /Vale-alimentação dos fornecedores/);
    assert.equal(doc.querySelector('[data-meal-value="1"]').value, '10');
    assert.equal(doc.querySelector('[data-meal-value="1"]').disabled, true);
    for (let index = 0; index < 3; index++) doc.querySelector('[data-meal-next]').click();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /OBS ou anexos/);
    doc.querySelector('[data-meal-next]').click();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /Confirme os lançamentos/);
    assert.match(doc.querySelector('[data-meal-confirm]').textContent, /Retomar envio/);
    doc.querySelector('[aria-label="Início"]').click();
    assert.equal(doc.querySelector('.meal-voucher-page').hidden, true);
    assert.equal(homeCalls, 1);
  } finally { panel.destroy(); dom.window.close(); }
});

test('retomada com anexos mantém somente a reescolha dos mesmos arquivos disponível', async () => {
  const dom = new JSDOM('<!doctype html><body></body>', { url: 'https://example.invalid' });
  const doc = dom.window.document, cache = new Map();
  const storage = { getItem: key => cache.get(key) || null, setItem: (key, value) => cache.set(key, value), removeItem: key => cache.delete(key) };
  const supplier = { id: '1', label: 'Ana', branch: 'OBRA A', profession: 'PEDREIRO' };
  const data = {
    loadOptions: async () => ({ suppliers: [supplier], accounts: [{ id: '8', label: 'CAIXA' }], stages: [{ id: '7', label: 'FUNDAÇÃO', branch: 'OBRA A' }] }),
    loadOrders: async () => [], loadSheetAssignments: async () => ({ '1': { id: '11' } }),
    post: async (_draft, progress, onProgress) => { progress.signature = 'envio-iniciado'; onProgress(); throw new Error('rede interrompida'); },
  };
  const attachment = new dom.window.File(['comprovante'], 'comprovante.pdf', { type: 'application/pdf', lastModified: 1234 });
  const type = (selector, value) => { const input = doc.querySelector(selector); input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const original = createMealVoucherView({ documentRef: doc, data, storage, sessionKey: 'conta-anexo' });
  try {
    await original.open();
    type('[data-meal-value="1"]', '10');
    doc.querySelector('[data-meal-next]').click(); await tick();
    doc.querySelector('[data-meal-order-new]').click();
    for (const [name, value] of [['meal-date', '2026-10-15'], ['meal-due-date', '2026-10-30'], ['meal-reference-month', '2026-10']]) type(`[name="${name}"]`, value);
    for (const [name, value] of [['meal-account', '8'], ['meal-stage', '7']]) {
      const select = doc.querySelector(`[name="${name}"]`); select.value = value; select.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    }
    doc.querySelector('[data-meal-next]').click(); await tick();
    const firstFiles = doc.querySelector('[name="meal-files"]');
    Object.defineProperty(firstFiles, 'files', { value: [attachment], configurable: true });
    firstFiles.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    doc.querySelector('[data-meal-next]').click();
    doc.querySelector('[data-meal-confirm]').click(); await tick();
  } finally { original.destroy(); }

  const resumed = createMealVoucherView({ documentRef: doc, data, storage, sessionKey: 'conta-anexo' });
  try {
    await resumed.open(); await tick();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /OBS ou anexos/);
    assert.equal(doc.querySelector('[name="meal-obs"]').disabled, true);
    const files = doc.querySelector('[name="meal-files"]');
    assert.equal(files.disabled, false, 'os anexos pendentes podem ser selecionados novamente');
    doc.querySelector('[data-meal-next]').click();
    assert.match(doc.querySelector('.meal-voucher-error').textContent, /Selecione novamente/);
    Object.defineProperty(files, 'files', { value: [attachment], configurable: true });
    files.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    doc.querySelector('[data-meal-next]').click();
    assert.match(doc.querySelector('.meal-voucher-content h2').textContent, /Confirme os lançamentos/);
  } finally { resumed.destroy(); dom.window.close(); }
});
