import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildRhReport3, buildRhReport4, buildRhReport5 } from "../src/chat/rh-reports-model.js";
import { createRhReportsView } from "../src/ui/rh-reports-view.js";

test("relatório 5 detalha presenças pagas e pagamentos feitos em outro nome", async t => {
  const snapshot = {
    suppliers: [
      { id: "1", name: "Ana", contractor: true, branch: "Centro", profession: "Pedreiro", paymentType: "DIÁRIA", dailyValue: 120 },
      { id: "2", name: "Bia", contractor: true, branch: "Centro", profession: "Pintor", paymentType: "DIÁRIA", dailyValue: 90 },
    ],
    presences: [
      { id: "10", supplier: "Ana", date: "2026-10-01", branch: "Centro", presence: "PRESENTE", status: "PAGO", dailyValue: 120, paymentId: "22" },
      { id: "11", supplier: "Bia", date: "2026-10-01", branch: "Centro", presence: "PRESENTE", status: "PENDENTE PGTO", dailyValue: 90 },
    ],
    launches: [{ id: "22", supplier: "Bia", date: "2026-10-02", total: 120, advance: "NÃO" }],
  };
  const report = buildRhReport5(snapshot);
  assert.equal(report.pending.length, 1);
  assert.equal(report.details.length, 2);
  assert.equal(report.details.find(row => row.name === "Ana").linkedElsewhere[0].id, "22");
  const dom = new JSDOM("<main></main>", { url: "https://example.test" });
  const view = createRhReportsView({ document: dom.window.document, data: { async loadReport() { return snapshot; } } });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open(5);
  assert.match(view.element.textContent, /DETALHAMENTO GERAL/);
  assert.match(view.element.textContent, /PAGO EM NOME DE: Bia/);
  assert.match(view.element.textContent, /Ana/);
  assert.match(view.element.textContent, /PAGO/);
});

test("relatório 3 aplica filtro de etapa da presença sem confundir com etapa atual do fornecedor", () => {
  const result = buildRhReport3({
    suppliers: [{ id: "1", name: "Ana", contractor: true, branch: "Centro", property: "Obra A", profession: "Pedreiro", stage: "PINTURA", paymentType: "DIÁRIA", dailyValue: 120 }],
    presences: [{ id: "10", supplier: "Ana", date: "2026-10-01", branch: "Centro", property: "Obra A", stage: "ESTRUTURA", presence: "PRESENTE", dailyValue: 120 }],
  }, { startDate: "2026-10-01", endDate: "2026-10-01", stage: "ESTRUTURA" }, "2026-10-02");
  assert.equal(result.metrics.suppliers, 1);
  assert.equal(result.groups[0].properties[0].professions[0].suppliers[0].attendance.present, 1);
});

test("relatório 4 mostra o resumo financeiro de cada profissional dentro da profissão", async t => {
  const snapshot = { presences: [
    { id: "1", supplier: "Ana", profession: "PEDREIRO", date: "2026-10-01", branch: "Centro", presence: "PRESENTE", status: "PENDENTE PGTO", dailyValue: 120 },
    { id: "2", supplier: "Ana", profession: "PEDREIRO", date: "2026-10-02", branch: "Centro", presence: "PENDENTE", status: "PENDENTE PGTO", dailyValue: 80 },
    { id: "3", supplier: "Bia", profession: "PEDREIRO", date: "2026-10-02", branch: "Centro", presence: "PRESENTE", status: "PAGO", dailyValue: 90 },
  ] };
  const model = buildRhReport4(snapshot, { startDate: "2026-10-01", endDate: "2026-10-02" });
  assert.equal(model.professions[0].suppliers.find(row => row.name === "Ana").approvedValue, 120);
  assert.equal(model.professions[0].suppliers.find(row => row.name === "Ana").validationValue, 80);
  const dom = new JSDOM("<main></main>", { url: "https://example.test" });
  const view = createRhReportsView({ document: dom.window.document, data: { async loadReport() { return snapshot; } } });
  t.after(() => { view.destroy(); dom.window.close(); });
  await view.open(4);
  view.element.querySelector('[name="startDate"]').value = "2026-10-01";
  view.element.querySelector('[name="endDate"]').value = "2026-10-02";
  view.element.querySelector('[name="endDate"]').dispatchEvent(new dom.window.Event("change"));
  const profession = view.element.querySelector(".rh-reports-profession");
  assert.match(profession.textContent, /Ana/);
  assert.match(profession.textContent, /120,00/);
  assert.match(profession.textContent, /80,00/);
});
