import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const { createCommercialProgressReportsView } = await import("../src/ui/commercial-progress-reports-view.js").catch(() => ({}));

const snapshot = {
  properties: [{ id: "1", branch: "Centro", property: "Casa 1", visualStatus: "ATIVO", saleStatus: "VENDIDO", brokerage: "", invoice: "", fiscal: "DECLARADO" }],
  contracts: [{ id: "10", branch: "Centro", property: "Casa 1", buyer: "Ana", status: "VENDIDO", total: 100, saleDate: "2026-09-01", broker: "" }],
  clients: [{ id: "1", branch: "Centro", property: "Casa 1", name: "Ana", definitive: "SIM" }],
  receipts: [{ id: "1", branch: "Centro", property: "Casa 1", contractId: "10", buyer: "Ana", amount: 100, paidDate: "", dueDate: "2026-10-10", directBroker: "", description: "Saldo" }],
  milestones: [{ id: "2", branch: "Centro", property: "Casa 1", contractId: "10", buyer: "Ana", type: "Assinatura", description: "Último", startDate: "2026-09-30", endDate: "2026-10-04", dueDate: "2026-10-03", status: "ATIVIDADE INICIADA" }],
};

test("visualização alterna relatórios 14 e 15 e filtra imóveis com dados da fonte", async () => {
  assert.equal(typeof createCommercialProgressReportsView, "function");
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: { async loadSnapshot() { return snapshot; } } });
  dom.window.document.body.append(view.element);
  await view.open(14);
  assert.match(view.element.textContent, /INDICADORES|RESUMO POR IMÓVEL/i);
  assert.match(view.element.textContent, /Casa 1/);
  assert.match(view.element.textContent, /R\$\s*100,00/);
  const propertyFilter = view.element.querySelector('[name="property"]');
  assert.ok([...propertyFilter.options].some(option => option.value === "Casa 1"));
  propertyFilter.value = "Casa 1"; propertyFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.match(view.element.textContent, /PAGAMENTOS PREVISTOS/i);
  await view.open(15);
  assert.match(view.element.textContent, /ÚLTIMO ANDAMENTO POR IMÓVEL/i);
  assert.match(view.element.textContent, /Assinatura/);
  assert.match(view.element.textContent, /HISTÓRICO COMPLETO/i);
  view.close();
  assert.equal(view.element.hidden, true);
  view.destroy();
  assert.equal(view.element.isConnected, false);
});

test("histórico mostra ID e DATA FIM e filtro de STATUS do marco altera o último apontamento", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  const completed = { ...snapshot.milestones[0], id: "3", type: "Entrega", status: "ATIVIDADE FINALIZADA", endDate: "2026-10-05" };
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: {
    async loadSnapshot() { return { ...snapshot, milestones: [...snapshot.milestones, completed] }; },
  } });
  await view.open(15);
  const status = view.element.querySelector('[name="milestoneStatus"]');
  assert.ok(status);
  assert.deepEqual([...status.options].map(option => option.value), ["", "ATIVIDADE FINALIZADA", "ATIVIDADE INICIADA"]);
  view.element.querySelector('[name="property"]').value = "Casa 1";
  view.element.querySelector('[name="property"]').dispatchEvent(new dom.window.Event("change"));
  status.value = "ATIVIDADE INICIADA"; status.dispatchEvent(new dom.window.Event("change"));
  assert.match(view.element.querySelector(".cpr-property").textContent, /Assinatura/);
  assert.match(view.element.querySelector(".cpr-detail").textContent, /ID DO REGISTRO\s*2/);
  assert.match(view.element.querySelector(".cpr-detail").textContent, /DATA FIM\s*04\/10\/2026/);
  assert.doesNotMatch(view.element.querySelector(".cpr-detail").textContent, /Entrega/);
});

test("falha na fonte impede exibir totais antigos e oferece nova tentativa", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  let calls = 0;
  const view = createCommercialProgressReportsView({ document: dom.window.document, data: {
    async loadSnapshot() { calls++; if (calls === 1) return snapshot; throw new Error("Página incompleta"); },
  } });
  await view.open(14);
  view.element.querySelector(".cpr-refresh").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(view.element.textContent, /Página incompleta/);
  assert.equal(view.element.querySelectorAll(".cpr-property").length, 0);
  assert.ok(view.element.querySelector(".cpr-retry"));
});
