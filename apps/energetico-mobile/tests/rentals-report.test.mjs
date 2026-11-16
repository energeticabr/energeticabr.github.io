import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderChatMarkup } from '../src/ui/chat-view.js';
import { getReportNeighbors } from '../src/ui/report-navigation.js';

test('Aluguéis abre pelo menu principal e integra a navegação comercial', () => {
  const { window } = new JSDOM(renderChatMarkup({
    sessionStatus: 'authenticated', account: { name: 'Teste' }, pendingFiles: [],
    messages: [{ id: 'home', role: 'assistant', type: 'poll', question: 'QUAL ÁREA VOCÊ DESEJA ACESSAR?',
      options: [{ id: 'group_pending', label: 'PENDÊNCIAS' }, { id: 'group_supplies', label: 'SUPRIMENTOS' }] }],
  }));
  const action = 'open-rentals-report';
  const button = window.document.querySelector(`.chat-main-commercial-shortcuts [data-action="${action}"]`);
  assert.ok(button?.querySelector('img[src]'));
  assert.equal(button.textContent, 'Aluguéis');
  assert.deepEqual(getReportNeighbors(action), { previous: 'open-sac-pathologies', next: null });
});

test('os aluguéis em aberto atravessam anos e valores do contrato não viram valores recebidos', async () => {
  const { buildRentalsReport } = await import('../src/chat/rentals-report-data.js');
  const contract = { id: '7', property: 'Galpão A', tenant: 'Locatário A', status: 'ATIVO', amountCents: 230005,
    adjustmentDate: '2026-10-01', expiryDate: '2027-01-01', index: 'IPCA' };
  const launch = { property: contract.property, tenant: contract.tenant, paymentMethod: 'PIX', contractId: '7' };
  const source = { contracts: [contract], launches: [
    { ...launch, id: '40', dueDate: '2025-12-28', paidDate: '', grossCents: null },
    { ...launch, id: '41', dueDate: '2026-01-01', paidDate: '2026-02-01', grossCents: 210000 },
    { ...launch, id: '42', dueDate: '2026-01-02', paidDate: '', grossCents: null },
    { ...launch, id: '43', dueDate: '2026-03-01', paidDate: '', contractId: '8', grossCents: null },
  ] };
  const report = buildRentalsReport(source, { year: '2026', status: 'ATIVO' }, '2026-01-02');
  assert.deepEqual(report.open.map(r => [r.id, r.days, r.amountCents]), [
    ['40', -5, 230005], ['42', 0, 230005], ['43', 58, null],
  ]);
  assert.equal(report.annual[0].months[1].amountCents, 210000);
  assert.equal(report.annual[0].months[0].records[0].id, '42');
  assert.equal(report.totalCents, 210000);
  assert.equal(report.adjustments[0].days, 272);
  assert.equal(report.expirations[0].days, 364);
  const filtered = buildRentalsReport(source, { year: '2026', status: 'INATIVO', paymentMethod: 'PIX' }, '2026-01-02');
  assert.equal(filtered.open.length, 3);
  assert.equal(filtered.adjustments.length, 0);
  assert.equal(buildRentalsReport(source, { property: 'Outro' }, '2026-01-02').open.length, 0);
});

test('relatório mostra as quatro tabelas, mantém o imóvel no recarregamento e retorna ao atalho', async () => {
  const { createRentalsReportView } = await import('../src/ui/rentals-report-view.js');
  const { captureFilteredReport } = await import('../src/ui/report-print.js');
  const window = new JSDOM('<main id="app"><button>Aluguéis</button></main>', { pretendToBeVisual: true }).window;
  const document = window.document;
  const shortcut = document.querySelector('button');
  shortcut.focus();
  let requests = 0;
  const contract = { id: '7', property: 'Galpão A', tenant: 'Locatário A', status: 'ATIVO', amountCents: 250000,
    adjustmentDate: '2026-05-01', expiryDate: '2026-12-01', index: 'IPCA' };
  const source = { contracts: [contract], launches: [
    { id: '40', contractId: '7', property: 'Galpão A', tenant: 'Locatário A', paymentMethod: 'PIX',
      dueDate: '2026-01-01', paidDate: '', grossCents: null },
    { id: '41', contractId: '8', property: 'Galpão B', tenant: 'Locatário B', paymentMethod: 'PIX',
      dueDate: '2026-01-03', paidDate: '', grossCents: null },
  ] };
  const view = createRentalsReportView({
    document, loadSnapshot: async () => { requests++; return source; }, now: () => new Date('2026-01-02T12:00:00Z'),
  });
  try {
    await view.open();
    assert.equal(view.element.querySelectorAll('table').length, 4);
    assert.match(view.element.querySelector('table').textContent, /VENCIDO há 1 dia/);
    assert.equal(view.element.querySelector('select[name=status]').value, 'ATIVO');
    const pdf = captureFilteredReport(view.element);
    assert.deepEqual(pdf.filters.map(({ value }) => value), ['2026', 'Todos', 'Todos', 'Todos', 'ATIVO']);
    const openTable = pdf.pages[0].blocks.find(block => block.type === 'table');
    assert.match(openTable.rows[1].cells.at(-1).runs.map(run => run.text).join(''), /VENCIDO há 1 dia/);
    const property = view.element.querySelector('select[name=property]');
    property.value = 'Galpão A';
    property.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(view.element.querySelector('table tbody').children.length, 1);
    view.element.querySelector('button[aria-label^="Atualizar"]').click();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests, 2);
    assert.equal(property.value, 'Galpão A');
    assert.equal(view.element.querySelector('table tbody').children.length, 1);
    view.element.querySelector('.report-close-control').click();
    assert.equal(document.activeElement, shortcut);
  } finally {
    view.destroy();
    window.close();
  }
});

test('consulta percorre as duas listas e mantém o valor ausente em vez de gravar zero', async () => {
  const { createRentalsReportData } = await import('../src/chat/rentals-report-data.js');
  const launches = [
    { id: '100', fields: { DESCRICAO: 'Galpão A', INQUILINO: 'Locatário A', FORMAPGTO: 'PIX' } },
    { id: '101', fields: { DATAVENCIMENTO: '2026-01-02T03:00:00Z', VALORBRUTO: '1.230,05', NUM_x002e_CONTRATOALUGUEL: '10' } },
  ];
  const rentals = createRentalsReportData({ repository: {
    async getItemsPage(site, id, query, { cursor }) {
      assert.equal(site, 'personal');
      if (id === '02b3ceec-2b03-42e9-b87f-5fb02851caa8') return cursor
        ? { items: [launches[1]], hasMore: false }
        : { items: [launches[0]], hasMore: true, nextLink: 'next' };
      assert.equal(id, 'e6b7fbf3-b5ce-406a-8ec8-8d0e8eff7885');
      return { items: [{ id: '10', fields: { STATUS: 'ATIVO' } }], hasMore: false };
    },
  } });
  const result = await rentals.loadSnapshot();
  assert.deepEqual(result.launches.map(row => [row.id, row.dueDate, row.grossCents]), [['100', '', null], ['101', '2026-01-02', 123005]]);
  assert.equal(result.contracts[0].amountCents, null);
});
