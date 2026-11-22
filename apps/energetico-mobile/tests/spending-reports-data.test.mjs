import test from "node:test";
import assert from "node:assert/strict";
import { buildSpendingReport9 } from "../src/chat/spending-reports-model.js";

const { createSpendingReportsData } = await import("../src/chat/spending-reports-data.js").catch(() => ({}));

function fixture(overrides = {}) {
  const calls = [];
  const repository = {
    async resolveList(site, aliases) { assert.equal(site, "personal"); calls.push(["resolve", aliases[0]]); return { status: "resolved", id: aliases[0] }; },
    async getColumns(_site, list) { calls.push(["columns", list]); return list === "LANCAMENTOS"
      ? [{ name: "field_9", displayName: "VALOR UNITÁRIO" }, { name: "field_8", displayName: "QUANTIDADE" }]
      : [{ name: "field_1", displayName: "PRODUTO" }, { name: "field_2", displayName: "TIPODESPESA" }]; },
    async getItemsPage(_site, list, query, options) {
      calls.push(["page", list, options.pageNumber, options.cursor, query]);
      if (list === "DESPESASRECORRENTES") return { items: [{ id: "7", fields: { STATUS: "ATIVO", FORNECEDOR: "VIVO" } }], hasMore: false, nextLink: "" };
      if (list === "PROVISÃO PGTOS") return { items: [{ id: "41", fields: { IDRECORRENCIA: "7", STATUS: "PAGAMENTO PREVISTO",
        FORNECEDOR: "VIVO", PRODUTO: "INTERNET", DATAPGTOPREVISTO: "2026-10-04", PGTOAGENDADO: "PENDENTE",
        VALORTOTAL: "89,99", FILIAL: "004 - EDIFÍCIO XAVANTE" } }], hasMore: false, nextLink: "" };
      if (list === "CADASTROPRODUTO") return { items: [{ id: "3", fields: { field_1: "Cimento", field_2: "Material", GERADESEMBOLSO: "SIM" } }], hasMore: false, nextLink: "" };
      if (options.pageNumber === 1) return { items: [{ id: "1", fields: { field_9: 10, field_8: 2 } }], hasMore: true, nextLink: "next" };
      return { items: [{ id: "2", fields: { field_9: 30, field_8: 1 } }], hasMore: false, nextLink: "" };
    }, ...overrides,
  };
  return { repository, calls };
}

test('new home provision report loads complete lists with quantity, freight, scheduling and inactive metadata', async () => {
  const {repository,calls}=fixture({
    async getColumns(){return [];},
    async getItemsPage(_site,list,_query,options){
      calls.push(['new-page',list,options.pageNumber]);
      if(list==='DESPESASRECORRENTES')return {items:[{id:'7',fields:{STATUS:'INATIVO',IMOVEL:'Sala',DATAINICIO:'2026-01-05',Modified:'2026-10-01T12:00:00Z'}}],hasMore:false};
      return {items:[{id:String(options.pageNumber),fields:{IDRECORRENCIA:'7',VALORTOTAL:10,QTD:2,FRETE:5,OBS:'Conferir',IMOVEL:'Sala',DATAPGTOAGENDADO:'2026-10-06',DATAEXECUCAOAGENDAMENTO:'2026-10-07'}}],hasMore:options.pageNumber===1,nextLink:options.pageNumber===1?'next':''};
    }
  });
  const data=createSpendingReportsData({repository});assert.equal(typeof data.loadProvisionReportSnapshot,'function');
  const result=await data.loadProvisionReportSnapshot();
  assert.equal(result.provisions.length,2);assert.equal(result.provisions[0].total,25);
  assert.equal(result.provisions[0].observation,'Conferir');assert.equal(result.provisions[0].executionDate,'2026-10-07');
  assert.equal(result.recurrences[0].property,'Sala');assert.equal(Date.parse(result.recurrences[0].modified),Date.parse('2026-10-01T12:00:00Z'));
  assert.equal(calls.some(call=>call[1]==='LANCAMENTOS'),false);
});

test("payment ledger queries only launches, follows pagination and preserves payment fields", async () => {
  const { repository, calls } = fixture();
  const data = createSpendingReportsData({ repository });
  assert.equal(typeof data.loadPaymentsSnapshot, 'function');
  const result = await data.loadPaymentsSnapshot();
  assert.deepEqual(result.launches.map(r => r.id), ['1', '2']);
  assert.equal(result.launches[0].total, 20);
  assert.equal(calls.some(c => c[1] === 'CADASTROPRODUTO'), false);
});

test('payment ledger lists only PDFs and downloads from the corresponding order or launch list', async () => {
  const reads = [];
  const bytes = new TextEncoder().encode('%PDF-1.7').buffer;
  const { repository } = fixture({
    async listAttachments(site, list, id, options) {
      assert.equal(site, 'personal');
      assert.equal(options.requireCollection, true);
      assert.equal(options.namesOnly, true);
      assert.equal(options.interactive, false);
      reads.push(['list', list, id]);
      return [{ name: 'Foto.jpg' }, { name: `${list}.PDF` }];
    },
    async downloadAttachment(site, list, id, name) {
      assert.equal(site, 'personal');
      reads.push(['download', list, id, name]);
      return bytes;
    },
  });
  const data = createSpendingReportsData({ repository });
  for (const [kind, list] of [['order', 'NOTASPENDENTES'], ['launch', 'LANCAMENTOS']]) {
    const files = await data.listPaymentLedgerPdfs(kind, '569');
    assert.deepEqual(files.map(file => file.fileName), [`${list}.PDF`]);
    const blob = await files[0].source();
    assert.equal(blob.type, 'application/pdf');
    assert.equal(await blob.text(), '%PDF-1.7');
  }
  assert.deepEqual(reads, [
    ['list', 'NOTASPENDENTES', '569'], ['download', 'NOTASPENDENTES', '569', 'NOTASPENDENTES.PDF'],
    ['list', 'LANCAMENTOS', '569'], ['download', 'LANCAMENTOS', '569', 'LANCAMENTOS.PDF'],
  ]);
  await assert.rejects(data.listPaymentLedgerPdfs('other', '569'), /inválid/);
});

test('payment period is constrained at SharePoint before paging, maps dates and boolean disbursement', async () => {
  const queries = [];
  const { repository } = fixture({
    async getColumns() { return [{ name: 'PaidAt', displayName: 'DATA PGTO EFETUADO', dateTime: { format: 'dateOnly' } }, { name: 'Debit', displayName: 'GERADESEMBOLSO' }]; },
    async getItemsPage(_site, _list, query) { queries.push(new URLSearchParams(query)); return { items: [{ id: '7', fields: { PaidAt: '2026-10-02T03:00:00Z', Debit: true, AGRUPAR: '358', FORNECEDOR: 'Alfa' } }], hasMore: false, nextLink: '' }; },
  });
  const result = await createSpendingReportsData({ repository }).loadPaymentsSnapshot({ filters: { startDate: '2026-10-02', endDate: '2026-10-05' } });
  assert.equal(queries[0].get('$filter'), "fields/PaidAt ge '2026-10-02T00:00:00Z' and fields/PaidAt le '2026-10-05T23:59:59.999Z'");
  assert.equal(result.launches[0].paymentDate, '2026-10-02');
  assert.equal(result.launches[0].disbursement, 'SIM');
  assert.equal(result.launches[0].order, '358');
});

test("relatório 9 lê também as parcelas publicadas de Provisão Pgto e calcula o valor de cada vencimento", async () => {
  assert.equal(typeof createSpendingReportsData, "function");
  const { repository, calls } = fixture();
  const readPage = repository.getItemsPage;
  const fields = { FILIAL: "Filial A", FORNECEDOR: "Alfa", PRODUTO: "Cimento", ETAPA: "Fundação",
    VALORTOTAL: "30,00", QTD: "2", FRETE: "5,00", STATUS: "PAGAMENTO PREVISTO" };
  repository.getItemsPage = async (site, list, query, options) => {
    if (list !== "PROVISÃO PGTOS") return readPage(site, list, query, options);
    if (!options.cursor) return { hasMore: true, nextLink: "next-provision", items: [
      { id: "41", fields: { ...fields, DATAPREVISTOPGTO: "2026-11-01T03:00:00Z" } },
      { id: "42", fields: { ...fields, DATAPREVISTOPGTO: "2026-11-01T02:59:59Z" } },
      { id: "45", fields: { ...fields, DATAPREVISTOPGTO: "2026-11-01T00:00:00.000Z" } },
    ] };
    assert.equal(options.cursor, "next-provision");
    return { hasMore: false, items: [
      { id: "41", fields: { ...fields, DATAPREVISTOPGTO: "2026-11-01T03:00:00Z" } },
      { id: "43", fields: { ...fields, DATAPGTOPREVISTO: "30/11/2026" } },
      { id: "44", fields: { ...fields, DATAPREVISTOPGTO: "2026-11-28", NFELINHA: "oculta-1", DESCRITIVOPROVISAO: "5" } },
    ] };
  };
  repository.getItems = async (_site, list) => {
    assert.equal(list, "DESCRITIVOPROVISAO");
    return [];
  };
  const snapshot = await createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 9 });
  assert.deepEqual(snapshot.launches.map(item => item.id), ["1", "2"]);
  assert.equal(snapshot.productTypes[0].expenseType, "Material");
  assert.ok(calls.some(call => call[0] === "page" && call[1] === "LANCAMENTOS" && call[2] === 2 && call[3] === "next"));
  assert.deepEqual(snapshot.provisions.map(({ id, dueDate }) => [id, dueDate]), [
    ["41", "2026-11-01"], ["42", "2026-10-31"], ["45", "2026-11-01"], ["43", "2026-11-30"],
  ]);
  const report = buildSpendingReport9(snapshot, { year: "2026", month: "11", stage: "Fundação", supplier: "Alfa", disbursement: "SIM" });
  assert.deepEqual(report.expenseBranches[0].expenseTypes, [
    { name: "Material", paid: 0, forecast: 195, total: 195, percentage: 100, previousTotal:65, change:200,
      products: [{ name: "Cimento", paid: 0, forecast: 195, total: 195, percentage: 100, previousTotal:65, change:200 }] },
  ]);
});

test("relatório 9 falha se a Provisão Pgto estiver indisponível", async () => {
  const { repository } = fixture({ async resolveList(_site, [name]) {
    return name === "PROVISÃO PGTOS" ? { status: "missing" } : { status: "resolved", id: name };
  } });
  await assert.rejects(createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 9 }), /PROVISÃO PGTOS.*não está disponível/);
});

test("relatório 10 carrega recorrências e provisões vinculáveis sem consultar LANCAMENTOS", async () => {
  const { repository, calls } = fixture();
  const snapshot = await createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 10 });
  assert.ok(Array.isArray(snapshot.recurrences));
  assert.ok(Array.isArray(snapshot.provisions));
  assert.equal(snapshot.recurrences[0].status, "ATIVO");
  assert.equal(snapshot.provisions[0].recurrenceId, "7");
  assert.equal(snapshot.provisions[0].dueDate, "2026-10-04");
  assert.equal(snapshot.provisions[0].total, 89.99);
  assert.ok(calls.some(call => call[0] === "resolve" && call[1] === "DESPESASRECORRENTES"));
  assert.ok(calls.some(call => call[0] === "resolve" && call[1] === "PROVISÃO PGTOS"));
  assert.equal(calls.some(call => call[1] === "LANCAMENTOS"), false);
});

test("relatório 10 informa indisponibilidade quando a lista de provisões não existe", async () => {
  const { repository } = fixture({ async resolveList(_site, aliases) {
    return aliases.includes("PROVISÃO PGTOS") ? { status: "missing" } : { status: "resolved", id: aliases[0] };
  } });
  await assert.rejects(createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 10 }), /PROVISÃO PGTOS.*não está disponível/);
});

test("erro de paginação ou limite seguro impede qualquer resultado parcial", async () => {
  const { repository } = fixture({ async getItemsPage() { return { items: [], hasMore: true, nextLink: "" }; } });
  await assert.rejects(createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 10 }), /página|paginação/i);
});

test("resposta sem indicador de próxima página não pode encerrar o relatório como completo", async () => {
  const { repository } = fixture({ async getItemsPage() { return { items: [{ id: "1", fields: {} }], nextLink: "" }; } });
  await assert.rejects(createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 10 }), /página|paginação/i);
});

test("consulta cancelada não acessa o repositório", async () => {
  const { repository, calls } = fixture(); const abort = new AbortController(); abort.abort();
  await assert.rejects(createSpendingReportsData({ repository }).loadSnapshot({ reportNumber: 9, signal: abort.signal }), /abort|cancelad/i);
  assert.equal(calls.length, 0);
});
