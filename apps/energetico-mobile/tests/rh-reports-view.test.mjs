import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRhReportsView } from "../src/ui/rh-reports-view.js";

const supplier = { id: "1", name: "Ana", contractor: true, branch: "CENTRO", property: "OBRA A", profession: "PEDREIRO", status: "ATIVO", paymentMethod: "DIÁRIA", dailyValue: 120 };
const presence = { id: "7", supplier: "Ana", date: "2026-10-01", branch: "CENTRO", property: "OBRA A", profession: "PEDREIRO", presence: "PRESENTE", status: "PENDENTE PGTO", dailyValue: 120, activity: "Alvenaria" };
const snapshot = { suppliers: [supplier], presences: [presence] };
function setup(t, loadSnapshot = async () => snapshot) {
  const dom = new JSDOM("<main></main>", { url: "https://example.test" });
  const view = createRhReportsView({ document: dom.window.document, data: { loadSnapshot } });
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: view.element };
}

test("abre relatórios 3, 4 e 5 sob demanda em cartões sem tabelas", async t => {
  const { view, root } = setup(t);
  assert.equal(root.tagName, "SECTION"); assert.equal(root.hidden, true);
  await view.open(3); assert.match(root.textContent, /FORNECEDORES/); assert.match(root.textContent, /OBRA A/);
  await view.open(4); assert.match(root.textContent, /PRESENÇAS E AUSÊNCIAS/); assert.match(root.textContent, /PEDREIRO/);
  await view.open(5); assert.match(root.textContent, /PAGAMENTOS PENDENTES/); assert.match(root.textContent, /120,00/);
  assert.equal(root.querySelector("table"), null);
});

test("filtros recalculam o relatório 5 e valores do SharePoint aparecem como texto", async t => {
  const { view, root, dom } = setup(t, async () => ({ suppliers: [{ ...supplier, name: "<img src=x onerror=alert(1)>" }], presences: [{ ...presence, supplier: "<img src=x onerror=alert(1)>" }] }));
  await view.open(5);
  assert.equal(root.querySelectorAll("img").length, 1, "só o logo oficial deve ser imagem");
  assert.match(root.textContent, /<img src=x/);
  const filter = root.querySelector('[name="branch"]'); filter.value = "OUTRA";
  filter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".rh-reports-supplier").length, 0);
});

test("relatórios RH exibem logo oficial e hierarquia visual própria", async t => {
  const { view, root } = setup(t);
  await view.open(3);
  assert.match(root.querySelector(".rh-reports-brand img")?.src || "", /logo-energetica-oficial\.png/);
  assert.equal(root.dataset.report, "3");
  assert.ok(root.querySelector(".rh-reports-profession-summary"));
  assert.match(root.textContent, /50|100%|FREQUÊNCIA/);
  await view.open(4);
  assert.equal(root.dataset.report, "4");
  assert.ok(root.querySelector('.rh-reports-metric[data-tone="present"]'));
  assert.ok(root.querySelector(".rh-reports-profession-total"));
  await view.open(5);
  assert.equal(root.dataset.report, "5");
  assert.ok(root.querySelector(".rh-reports-pending-total"));
});

test("relatório 3 distingue diária sem valor de medição conforme contrato", async t => {
  const { view, root } = setup(t, async () => ({ suppliers: [
    { ...supplier, name: "Medição", paymentMethod: "MEDIÇÃO", dailyValue: null },
    { ...supplier, name: "Diária", paymentMethod: "DIÁRIA", dailyValue: null },
  ], presences: [] }));
  await view.open(3);
  const cards = [...root.querySelectorAll('.rh-reports-supplier')];
  assert.match(cards.find(card => card.textContent.includes("Medição")).textContent, /CONFORME MEDIÇÃO/);
  assert.match(cards.find(card => card.textContent.includes("Diária")).textContent, /PREENCHER/);
});

test("relatório 4 mostra o intervalo filtrado no cabeçalho do resumo", async t => {
  const { view, root, dom } = setup(t);
  await view.open(4);
  const start = root.querySelector('[name="startDate"]');
  const end = root.querySelector('[name="endDate"]');
  start.value = "2026-09-28"; end.value = "2026-10-02";
  end.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.match(root.querySelector(".rh-reports-head").textContent, /28\/09\/2026 até 02\/10\/2026/);
});

test("relatório 5 exibe horas indisponíveis sem falso alerta de jornada", async t => {
  const { view, root } = setup(t, async () => ({
    suppliers: [{ ...supplier, hours: 8 }],
    presences: [{ ...presence, entry1: "08:00", exit1: "12:00" }],
  }));
  await view.open(5);
  const timeline = root.querySelector(".rh-reports-entry[data-presence]");
  const hours = [...timeline.querySelectorAll(".rh-reports-field")].find(field => field.querySelector(".rh-reports-label")?.textContent === "HORAS");
  assert.equal(hours.querySelector(".rh-reports-value").textContent, "HORAS INCOMPLETAS");
  assert.doesNotMatch(timeline.textContent, /CONFERIR JORNADA\/VALOR|0,00h/);
});

test("fechar aborta carregamento e resposta tardia não aparece", async t => {
  let resolver; let signal;
  const { view, root } = setup(t, (_number, options) => { signal = options.signal; return new Promise(resolve => { resolver = resolve; }); });
  const loading = view.open(3); view.close();
  assert.equal(signal.aborted, true); assert.equal(root.hidden, true);
  resolver(snapshot); await loading;
  assert.equal(root.querySelectorAll(".rh-reports-supplier").length, 0);
});

test("erro de consulta remove métricas anteriores e oferece nova tentativa", async t => {
  let calls = 0;
  const { view, root } = setup(t, async () => { if (++calls === 2) throw new Error("Falha 503"); return snapshot; });
  await view.open(3); assert.match(root.textContent, /OBRA A/);
  await view.open(3);
  assert.equal(root.querySelectorAll(".rh-reports-supplier").length, 0);
  assert.match(root.querySelector('[role="alert"]').textContent, /Falha 503/);
  root.querySelector(".rh-reports-retry").click();
  await new Promise(resolve => setImmediate(resolve));
  assert.match(root.textContent, /OBRA A/);
});
