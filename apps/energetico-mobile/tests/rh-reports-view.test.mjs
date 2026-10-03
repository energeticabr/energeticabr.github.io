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

test("relatório 3 organiza os mesmos dados em faixas de filial, imóvel, profissão e fornecedor", async t => {
  const { view, root } = setup(t);
  await view.open(3);
  assert.equal(root.querySelector(".rh-reports-head").hidden, true, "após o logo começa a filial, como no Power Apps");
  assert.equal(root.querySelector(".rh-reports-metrics").children.length, 0);
  assert.match(root.querySelector(".rh-reports-branch-footer")?.textContent || "", /TOTAL DE FORNECEDORES: 1/);
  const branch = root.querySelector(".rh-reports-branch");
  const property = branch.querySelector(".rh-reports-property");
  const profession = property.querySelector(".rh-reports-profession");
  const person = profession.querySelector(".rh-reports-supplier");
  assert.match(branch.querySelector(".rh-reports-branch-head")?.textContent || "", /🏢 FILIAL: CENTRO/);
  assert.match(property.querySelector(".rh-reports-property-head")?.textContent || "", /🏠 IMÓVEL: OBRA A/);
  assert.equal(property.querySelectorAll(":scope > .rh-reports-summary-strip .rh-reports-stat-pill").length, 5);
  assert.match(profession.querySelector(".rh-reports-profession-head")?.textContent || "", /PEDREIRO.*1 fornecedor/);
  assert.match(person.querySelector(".rh-reports-supplier-head")?.textContent || "", /Ana/);
  assert.match(person.textContent, /FORMA PGTO.*DIÁRIA/);
  assert.match(person.textContent, /FREQUÊNCIA · HISTÓRICO/);
  assert.match(person.textContent, /ATIVIDADE EXERCIDA/);
});

test("relatório 4 dispõe profissão e trabalhador como cartões com extrato financeiro", async t => {
  const { view, root } = setup(t);
  await view.open(4);
  const block = root.querySelector(".rh-reports-professions-block");
  const profession = block.querySelector(".rh-reports-profession");
  const person = profession.querySelector(".rh-reports-entry");
  assert.match(block.querySelector("h3")?.textContent || "", /PROFISSÕES TOTAIS/);
  assert.match(profession.querySelector(".rh-reports-profession-head")?.textContent || "", /PEDREIRO/);
  assert.match(profession.querySelector(".rh-reports-profession-meta")?.textContent || "", /1 profissional.*1 registro/i);
  assert.match(person.querySelector(".rh-reports-person-head")?.textContent || "", /Ana.*1X/);
  assert.match(person.querySelector(".rh-reports-financial-lines")?.textContent || "", /APROVADO PARA PGTO.*120,00/);
  assert.match(profession.querySelector(".rh-reports-profession-total")?.textContent || "", /RESUMO GERAL DA PROFISSÃO/);
});

test("relatório 5 mantém filial, fornecedor, diárias, datas e saldos em cada linha pendente", async t => {
  const { view, root } = setup(t);
  await view.open(5);
  assert.equal(root.querySelector(".rh-reports-head").hidden, true, "após o logo começa a tabela de pagamentos");
  assert.equal(root.querySelector(".rh-reports-metrics").children.length, 0);
  const pending = root.querySelector(".rh-reports-pending-block");
  const row = pending.querySelector(".rh-reports-pending-row");
  assert.match(pending.querySelector("h3")?.textContent || "", /PAGAMENTOS PENDENTES/);
  assert.match(row.querySelector(".rh-reports-pending-identity")?.textContent || "", /CENTRO.*Ana.*1/s);
  assert.match(row.querySelector(".rh-reports-pending-dates")?.textContent || "", /01\/10\/2026/);
  assert.match(row.querySelector(".rh-reports-pending-totals")?.textContent || "", /APROVADO.*120,00.*PENDENTE.*TOTAL/s);
  assert.match(pending.querySelector(".rh-reports-pending-overview")?.textContent || "", /APROVADO PENDENTE PGTO.*120,00.*PENDENTE VALIDAÇÃO.*TOTAL PENDENTE/s);
  assert.ok(root.querySelector(".rh-reports-detail-block"));
  assert.match(root.querySelector(".rh-reports-detail-block")?.textContent || "", /DETALHAMENTO GERAL.*Ana/s);
});

test("relatório 5 mostra cada data como linha de atividade, horas e valor, sem espalhar informações", async t => {
  const { view, root } = setup(t);
  await view.open(5);
  const entry = root.querySelector(".rh-reports-pending-dates .rh-reports-entry");
  const line = entry.querySelector(".rh-reports-date-line");
  assert.match(line?.textContent || "", /01\/10\/2026.*Alvenaria.*120,00/s);
  assert.match(entry.querySelector(".rh-reports-date-extra")?.textContent || "", /PRESENTE.*HORAS INCOMPLETAS.*OBRA A/s);
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
  assert.match(root.querySelector(".rh-reports-head").textContent, /RESUMO DE PRESENÇAS E AUSÊNCIAS — PERÍODO FILTRADO.*28\/09\/2026 até 02\/10\/2026/s);
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
