import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createCommercialDocsRentReportsView } from "../src/ui/commercial-docs-rent-reports-view.js";

const property = (id, name, overrides = {}) => ({
  id: String(id), branch: "Centro", property: name, status: "À VENDA", fiscal: "NÃO DECLARADO",
  documents: [{ key: "SEGURO", label: "Seguro", value: "", pending: true }, { key: "IDPROPOSTA", label: "Proposta", value: "P1", pending: false }],
  stateChecks: [{ key: "FISCAL", label: "Fiscal declarado", value: "NÃO DECLARADO", pending: true }],
  otherFields: [{ key: "OBS FISCAL", label: "Observação fiscal", value: "", pending: true }],
  contracts: [{ id: "10", buyer: "Ana" }, { id: "11", buyer: "Bia" }],
  idPending: 2, fieldsPending: 1, totalPending: 3, ...overrides,
});
function rentSnapshot(rows) {
  return { todayKey: "2026-10-02", year: "2026", rows,
    sourceRows: rows.map(row => ({ id: row.id, property: row.property, tenant: row.tenant, dueDate: row.dueDate,
      paidDate: "", paymentMethod: row.paymentMethod, contractId: row.contractId, grossCents: row.amountCents })),
    contracts: rows.map(row => ({ id: row.contractId, property: row.property, tenant: row.tenant,
      paymentMethod: row.paymentMethod, status: "ATIVO", amountCents: row.amountCents,
      adjustmentDate: "", expiryDate: "", index: "" })) };
}
const snapshots = {
  16: { rows: [property(1, "Loja A"), property(2, "Loja B", { branch: "Norte", contracts: [{ id: "12", buyer: "Ana" }], documents: [{ key: "SEGURO", label: "Seguro", value: "S2", pending: false }], stateChecks: [], otherFields: [], idPending: 0, fieldsPending: 0, totalPending: 0 })], summary: { properties: 2, idPending: 2, fieldsPending: 1, totalPending: 3 } },
  17: rentSnapshot([
    { id: "10", property: "Loja A", tenant: "Ana", dueDate: "2026-09-28", paymentMethod: "PIX", contractId: "20", amountCents: 123450, dueState: "overdue", days: 4 },
    { id: "11", property: "Loja B", tenant: "Bia <script>x</script>", dueDate: "2026-10-02", paymentMethod: "Boleto", contractId: "21", amountCents: 20000, dueState: "today", days: 0 },
  ]),
};

function setup(t, data = { async loadReport(number) { return snapshots[number]; } }) {
  const dom = new JSDOM("<main></main>", { url: "https://example.test" });
  const view = createCommercialDocsRentReportsView({ document: dom.window.document, data });
  dom.window.document.querySelector("main").append(view.element);
  t.after(() => { view.destroy(); dom.window.close(); });
  return { view, root: view.element, dom };
}

test("relatório 16 inicia em resumo por filial e campo; seleção exata abre detalhe do imóvel", async t => {
  const { view, root, dom } = setup(t);
  await view.open(16);
  assert.equal(root.querySelectorAll(".cdr-property-card").length, 2);
  assert.equal(root.querySelectorAll(".cdr-branch-summary").length, 2);
  assert.match(root.textContent, /Seguro.*1/s);
  assert.equal(root.querySelectorAll(".cdr-branch-table tbody tr").length, 2);
  assert.equal(root.querySelector('[data-metric="totalMeasures"]').textContent, "2");
  const branch = root.querySelector('[name="branch"]');
  branch.value = "Norte";
  branch.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-branch-summary").length, 1);
  assert.equal(root.querySelector('[data-metric="totalMeasures"]').textContent, "0");
  const propertySelect = root.querySelector('[name="property"]');
  propertySelect.value = "Loja B";
  propertySelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-property-card").length, 1);
  assert.ok(root.querySelector(".cdr-detail-cards .cdr-property-card"));
  assert.match(root.textContent, /Loja B/);
});

test("16 mostra orientação, painel de IDs e filial na hierarquia do Power Apps", async t => {
  const { view, root } = setup(t);
  await view.open(16);
  assert.ok(root.querySelector('.cdr-filters .cdr-refresh'), 'atualização deve estar com filtros acima da marca');
  assert.match(root.querySelector(".cdr-detail-hint")?.textContent || "", /SELECIONE UM NÚMERO DE CONTRATO, COMPRADOR OU IMÓVEL/);
  assert.match(root.querySelector(".cdr-metrics-title")?.textContent || "", /PENDÊNCIAS POR CAMPO DE ID/);
  assert.ok(root.querySelector(".cdr-detail-hint").compareDocumentPosition(root.querySelector(".cdr-metrics-title")) & 4);
  assert.ok(root.querySelector(".cdr-metrics-title").compareDocumentPosition(root.querySelector(".cdr-branch-summary")) & 4);
  assert.match(root.querySelector(".cdr-branch-summary .cdr-summary-title")?.textContent || "", /FILIAL:/);
});

test("17 prioriza aluguéis em aberto e recolhe resumo adicional sem perder totais", async t => {
  const { view, root } = setup(t);
  await view.open(17);
  assert.equal(root.querySelector(".cdr-metrics-fold")?.open, false);
  assert.match(root.querySelector(".cdr-metrics-fold summary")?.textContent || "", /Resumo dos aluguéis/);
  assert.ok(root.querySelector(".cdr-open-section").compareDocumentPosition(root.querySelector(".cdr-metrics-fold")) & 4);
  assert.equal(root.querySelector('[data-metric="totalCents"]')?.textContent, "R$ 1.434,50");
});

test("relatório 16 comprador e contrato selecionam o mesmo lançamento e exibem valores pendentes", async t => {
  const { view, root, dom } = setup(t);
  await view.open(16);
  const buyer = root.querySelector('[name="buyer"]');
  buyer.value = "Ana"; buyer.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.ok(root.querySelector(".cdr-detail-cards .cdr-property-card"));
  const contract = root.querySelector('[name="contract"]');
  contract.value = "10"; contract.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.ok(root.querySelector(".cdr-detail-cards .cdr-property-card"));
  assert.equal(root.querySelectorAll(".cdr-property-card").length, 1);
  assert.match(root.querySelector(".cdr-property-card").textContent, /NÃO DECLARADO.*Pendente/s);
  assert.match(root.querySelector(".cdr-property-card").textContent, /Contrato #10.*Ana/s);
  contract.value = "11"; contract.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-property-card").length, 0);
  assert.equal(root.querySelector('[data-metric="totalMeasures"]').textContent, "0");
});

test("cores fiscal e comercial seguem os estados normalizados do modelo", async t => {
  const row = property(1, "Loja A", { fiscal: "declarado", status: "Vendido",
    stateChecks: [
      { key: "FISCAL", label: "Fiscal declarado", value: "declarado", pending: false },
      { key: "STATUS", label: "Imóvel vendido ou dispensado", value: "Vendido", pending: false },
    ] });
  const { view, root } = setup(t, { async loadReport() { return { rows: [row] }; } });
  await view.open(16);
  const cells = [...root.querySelectorAll(".cdr-branch-table tbody td")];
  assert.equal(cells[2].dataset.state, "clear");
  assert.equal(cells[5].dataset.state, "clear");
});

test("relatório 17 apresenta aluguel aberto, valor e vencimento e escapa campos externos", async t => {
  const { view, root } = setup(t);
  await view.open(17);
  assert.equal(root.querySelectorAll(".cdr-rent-table tbody tr").length, 2);
  assert.equal(root.querySelector('[data-metric="totalCents"]').textContent, "R$ 1.434,50");
  assert.match(root.textContent, /VENCIDO há 4 dias/);
  assert.match(root.textContent, /VENCE HOJE/);
  assert.equal(root.querySelector("script"), null);
  assert.match(root.textContent, /Bia <script>x<\/script>/);
});

test("relatório 17 usa seletores independentes exatos e mantém total de todas as linhas filtradas", async t => {
  const rows = Array.from({ length: 61 }, (_, index) => ({
    id: String(index + 1), property: index < 30 ? "Loja A" : "Loja AB", tenant: index % 2 ? "Ana" : "Anabela",
    dueDate: "2026-10-02", paymentMethod: "PIX", contractId: String(index + 10), amountCents: 10000, dueState: "today", days: 0,
  }));
  const { view, root, dom } = setup(t, { async loadReport() { return rentSnapshot(rows); } });
  await view.open(17);
  assert.equal(root.querySelectorAll(".cdr-rent-table tbody tr").length, 25);
  assert.equal(root.querySelector('[data-metric="totalCents"]').textContent, "R$ 6.100,00");
  assert.match(root.querySelector(".cdr-page-status")?.textContent || "", /25 de 61/);
  assert.equal(root.querySelectorAll(".cdr-open-section .cdr-data-card").length, 25);
  root.querySelector(".cdr-more").click();
  assert.equal(root.querySelectorAll(".cdr-rent-table tbody tr").length, 50);
  root.querySelector(".cdr-more").click();
  assert.equal(root.querySelectorAll(".cdr-rent-table tbody tr").length, 61);
  const propertySelect = root.querySelector('[name="property"]');
  propertySelect.value = "Loja A"; propertySelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-rent-table tbody tr").length, 25);
  assert.equal(root.querySelector('[data-metric="totalCents"]').textContent, "R$ 3.000,00");
  assert.match(root.querySelector(".cdr-page-status")?.textContent || "", /25 de 30/);
  const tenant = root.querySelector('[name="tenant"]');
  tenant.value = "Ana"; tenant.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-rent-table tbody tr").length, 15);
  assert.equal(root.querySelector('[data-metric="totalCents"]').textContent, "R$ 1.500,00");
});

test("opção vazia do ano informa que a matriz usa o ano atual", async t => {
  const { view, root, dom } = setup(t);
  await view.open(17);
  const year = root.querySelector('[name="year"]');
  year.value = "";
  year.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.match(year.selectedOptions[0].textContent, /ano atual/i);
  assert.match(root.querySelector(".cdr-annual-table").textContent, /R\$\s*1\.434,50/);
});

test("ano do pagamento pode ser selecionado quando difere do vencimento", async t => {
  const snapshot = rentSnapshot([]);
  snapshot.sourceRows = [{ id: "1", property: "Loja A", tenant: "Ana", dueDate: "2026-12-20",
    paidDate: "2027-01-03", paymentMethod: "PIX", contractId: "1", grossCents: 10000 }];
  snapshot.contracts = [{ id: "1", property: "Loja A", tenant: "Ana", paymentMethod: "PIX",
    status: "ATIVO", amountCents: 10000, adjustmentDate: "", expiryDate: "", index: "" }];
  const { view, root, dom } = setup(t, { async loadReport() { return snapshot; } });
  await view.open(17);
  const year = root.querySelector('[name="year"]');
  assert.ok([...year.options].some(option => option.value === "2027"));
  year.value = "2027";
  year.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.match(root.querySelector(".cdr-annual-table tbody").textContent, /R\$\s*100,00/);
});

test("busca do aluguel espera pausa de digitação antes de atualizar os cartões", async t => {
  const { view, root, dom } = setup(t);
  await view.open(17);
  const search = root.querySelector('[name="search"]');
  search.value = "Loja A"; search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-rent-table tbody tr").length, 2);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(root.querySelectorAll(".cdr-rent-table tbody tr").length, 1);
  assert.equal(root.querySelector('[data-metric="totalCents"]').textContent, "R$ 1.234,50");
});

test("falha de carregamento remove valores antigos e permite tentar novamente", async t => {
  let fail = false;
  const { view, root } = setup(t, { async loadReport(number) { if (fail) throw new Error("SharePoint indisponível"); return snapshots[number]; } });
  await view.open(17);
  fail = true;
  await view.open(17);
  assert.match(root.textContent, /SharePoint indisponível/);
  assert.equal(root.querySelectorAll(".cdr-rent-table tbody tr").length, 0);
  assert.equal(root.querySelector('[data-metric="totalCents"]').textContent, "—");
  assert.ok(root.querySelector(".cdr-retry"));
});

test("fechar cancela consulta antiga e não a mostra após trocar de relatório", async t => {
  let finish;
  const signals = [];
  const { view, root } = setup(t, { loadReport(number, { signal }) {
    signals.push(signal);
    return number === 16 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve(snapshots[17]);
  } });
  const pending = view.open(16);
  view.close();
  assert.equal(signals[0].aborted, true);
  await view.open(17);
  finish(snapshots[16]);
  await pending;
  assert.equal(root.querySelectorAll(".cdr-property-card").length, 0);
  assert.equal(root.querySelectorAll(".cdr-rent-table tbody tr").length, 2);
});
