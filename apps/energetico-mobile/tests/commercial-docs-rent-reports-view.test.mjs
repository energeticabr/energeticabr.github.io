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
const snapshots = {
  16: { rows: [property(1, "Loja A"), property(2, "Loja B", { branch: "Norte", contracts: [{ id: "12", buyer: "Ana" }], documents: [{ key: "SEGURO", label: "Seguro", value: "S2", pending: false }], stateChecks: [], otherFields: [], idPending: 0, fieldsPending: 0, totalPending: 0 })], summary: { properties: 2, idPending: 2, fieldsPending: 1, totalPending: 3 } },
  17: { rows: [
    { id: "10", property: "Loja A", tenant: "Ana", dueDate: "2026-09-28", paymentMethod: "PIX", contractId: "20", amountCents: 123450, dueState: "overdue", days: 4 },
    { id: "11", property: "Loja B", tenant: "Bia <script>x</script>", dueDate: "2026-10-02", paymentMethod: "Boleto", contractId: "21", amountCents: 20000, dueState: "today", days: 0 },
  ], summary: { open: 2, overdue: 1, today: 1, upcoming: 0, totalCents: 143450 } },
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
  assert.equal(root.querySelectorAll(".cdr-property-card").length, 0);
  assert.equal(root.querySelectorAll(".cdr-branch-summary").length, 2);
  assert.match(root.textContent, /Seguro.*1/s);
  assert.equal(root.querySelector("table"), null);
  assert.equal(root.querySelector('[data-metric="totalPending"]').textContent, "3");
  const branch = root.querySelector('[name="branch"]');
  branch.value = "Norte";
  branch.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-branch-summary").length, 1);
  assert.equal(root.querySelector('[data-metric="totalPending"]').textContent, "0");
  const propertySelect = root.querySelector('[name="property"]');
  propertySelect.value = "Loja B";
  propertySelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-property-card").length, 1);
  assert.match(root.textContent, /Loja B/);
});

test("relatório 16 comprador e contrato selecionam o mesmo lançamento e exibem valores pendentes", async t => {
  const { view, root, dom } = setup(t);
  await view.open(16);
  const buyer = root.querySelector('[name="buyer"]');
  buyer.value = "Ana"; buyer.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  const contract = root.querySelector('[name="contract"]');
  contract.value = "10"; contract.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-property-card").length, 1);
  assert.match(root.querySelector(".cdr-property-card").textContent, /NÃO DECLARADO.*Pendente/s);
  assert.match(root.querySelector(".cdr-property-card").textContent, /Contrato #10.*Ana/s);
  contract.value = "11"; contract.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-property-card").length, 0);
  assert.equal(root.querySelector('[data-metric="totalPending"]').textContent, "0");
});

test("relatório 17 apresenta aluguel aberto, valor e vencimento e escapa campos externos", async t => {
  const { view, root } = setup(t);
  await view.open(17);
  assert.equal(root.querySelectorAll(".cdr-rent-card").length, 2);
  assert.equal(root.querySelector('[data-metric="totalCents"]').textContent, "R$ 1.434,50");
  assert.match(root.textContent, /Vencido há 4 dias/);
  assert.match(root.textContent, /Vence hoje/);
  assert.equal(root.querySelector("script"), null);
  assert.match(root.textContent, /Bia <script>x<\/script>/);
});

test("relatório 17 usa seletores independentes exatos e mantém total de todas as linhas filtradas ao paginar", async t => {
  const rows = Array.from({ length: 61 }, (_, index) => ({
    id: String(index + 1), property: index < 30 ? "Loja A" : "Loja AB", tenant: index % 2 ? "Ana" : "Anabela",
    dueDate: "2026-10-02", paymentMethod: "PIX", contractId: "10", amountCents: 10000, dueState: "today", days: 0,
  }));
  const { view, root, dom } = setup(t, { async loadReport() { return { rows }; } });
  await view.open(17);
  assert.equal(root.querySelectorAll(".cdr-rent-card").length, 25);
  assert.equal(root.querySelector('[data-metric="totalCents"]').textContent, "R$ 6.100,00");
  assert.match(root.textContent, /25 de 61/);
  root.querySelector(".cdr-more").click();
  assert.equal(root.querySelectorAll(".cdr-rent-card").length, 50);
  const propertySelect = root.querySelector('[name="property"]');
  propertySelect.value = "Loja A"; propertySelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-rent-card").length, 25);
  assert.equal(root.querySelector('[data-metric="totalCents"]').textContent, "R$ 3.000,00");
  const tenant = root.querySelector('[name="tenant"]');
  tenant.value = "Ana"; tenant.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-rent-card").length, 15);
  assert.equal(root.querySelector('[data-metric="totalCents"]').textContent, "R$ 1.500,00");
});

test("busca do aluguel espera pausa de digitação antes de atualizar os cartões", async t => {
  const { view, root, dom } = setup(t);
  await view.open(17);
  const search = root.querySelector('[name="search"]');
  search.value = "Loja A"; search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(root.querySelectorAll(".cdr-rent-card").length, 2);
  await new Promise(resolve => setTimeout(resolve, 220));
  assert.equal(root.querySelectorAll(".cdr-rent-card").length, 1);
  assert.equal(root.querySelector('[data-metric="totalCents"]').textContent, "R$ 1.234,50");
});

test("falha de carregamento remove valores antigos e permite tentar novamente", async t => {
  let fail = false;
  const { view, root } = setup(t, { async loadReport(number) { if (fail) throw new Error("SharePoint indisponível"); return snapshots[number]; } });
  await view.open(17);
  fail = true;
  await view.open(17);
  assert.match(root.textContent, /SharePoint indisponível/);
  assert.equal(root.querySelectorAll(".cdr-rent-card").length, 0);
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
  assert.equal(root.querySelectorAll(".cdr-rent-card").length, 2);
});
