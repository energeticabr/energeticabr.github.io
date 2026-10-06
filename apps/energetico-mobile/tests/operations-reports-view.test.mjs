import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createOperationsReportsView } from "../src/ui/operations-reports-view.js";

const activity = (id, overrides = {}) => ({ id: String(id), activity: "ALVENARIA", property: "CASA", supplier: "JOÃO", start: "2026-09-01", end: "2026-09-08", status: "ATIVIDADE INICIADA", ...overrides });
const task = (id, overrides = {}) => ({ id: String(id), identified: "2026-09-20", due: "2026-10-05", responsible: "Ana", responsibleKey: "ANA", status: "ATIVIDADE CRIADA", difficulty: "ALTA", association: "OBRA", priority: "ATIVIDADE PRIORITÁRIA", task: "Conferir orçamento", ...overrides });
const snapshots = {
  6: { number: 6, stages: [
    { branch: "A", stage: "ESTRUTURA", start: "2026-09-01", end: "", status: "INICIADO", percent: 25, activities: [activity(21), activity(22, { activity: "PINTURA", supplier: "Maria", status: "ATIVIDADE FINALIZADA" })] },
    { branch: "B", stage: "ELÉTRICA", start: "2026-09-02", end: "2026-09-05", status: "FINALIZADO", percent: 100, activities: [activity(23, { activity: "FIOS" })] },
  ] },
  7: { number: 7, count: 2, rows: [{ id: "11", date: "2026-09-22", branch: "A", status: "PENDENTE" }, { id: "10", date: "2026-09-21", branch: "B", status: "PENDENTE" }] },
  8: { number: 8, summary: { pending: 2, completed: 1, total: 3 }, rows: [
    task(1), task(2, { due: "", responsible: "", responsibleKey: "SEM RESPONSÁVEL", status: "EM ATENDIMENTO", task: "Texto <script>malicioso</script>" }),
    task(3, { due: "2026-10-05", responsible: "Bia", responsibleKey: "BIA", status: "CONCLUÍDO", priority: "ATIVIDADE EMERGENCIAL" }),
  ] },
};

function setup(t, data = { async loadReport(number) { return snapshots[number]; } }) {
  const dom = new JSDOM("<main></main>", { url: "https://example.test" });
  const view = createOperationsReportsView({ document: dom.window.document, data });
  dom.window.document.querySelector("main").append(view.element);
  t.after(() => { view.destroy(); dom.window.close(); });
  return { dom, view, root: view.element };
}

test("relatório 6 apresenta etapas, atividades e filtros sem tabela horizontal", async t => {
  const { dom, view, root } = setup(t);
  assert.equal(root.tagName, "SECTION");
  await view.open(6);
  assert.match(root.textContent, /ETAPAS/);
  assert.match(root.textContent, /25%/);
  assert.equal(root.querySelectorAll(".or-stage-card").length, 2);
  assert.equal(root.querySelectorAll(".or-activity-card").length, 3);
  assert.equal(root.querySelector("table"), null);
  const branch = root.querySelector('[name="branch"]');
  branch.value = "A";
  branch.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".or-stage-card").length, 1);
  const activityFilter = root.querySelector('[name="activity"]');
  activityFilter.value = "PINTURA";
  activityFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".or-activity-card").length, 1);
  assert.match(root.textContent, /PINTURA/);
});

test("relatório 6 preserva o cabeçalho e as oito colunas visuais do Power Apps", async t => {
  const { view, root } = setup(t);
  await view.open(6);
  assert.deepEqual([...root.querySelectorAll('.or-stage-columns > span')].slice(0, 8).map(node => node.textContent),
    ['#', 'Atividade', 'Imóvel', 'Responsável', 'Início', 'Fim', 'Dias', 'Status']);
  const first = root.querySelector('.or-activity-card');
  assert.match(first.textContent, /ALVENARIA.*CASA.*JOÃO.*01\/09\/2026.*08\/09\/2026.*ATIVIDADE INICIADA/s);
  assert.match(root.querySelector('.or-stage-summary').textContent, /ESTRUTURA.*25%.*01\/09\/2026.*HOJE/s);
});

test("relatórios 6–8 exibem o logo oficial e filtros com rótulos do Power Apps", async t => {
  const { view, root } = setup(t);
  for (const number of [6, 7, 8]) {
    await view.open(number);
    const logo = root.querySelector('.or-brand img[alt="Logo Energética"]');
    assert.ok(logo, `logo ausente no relatório ${number}`);
    assert.match(logo.src, /logo-energetica-oficial\.png/);
  }
  await view.open(6);
  assert.equal(root.querySelector('[name="supplier"]').closest('.or-filter').querySelector('.or-filter-label').textContent, 'COLABORADOR');
  await view.open(8);
  assert.match(root.textContent, /ETAPA OBRA/);
});

test("relatório 6 mostra etapa sem atividades como seção com zero registros", async t => {
  const snapshot = { stages: [{ branch: "A", stage: "LIMPEZA GERAL", status: "FINALIZADO", percent: 100, start: "2026-09-02", end: "2026-09-03", activities: [] }] };
  const { view, root } = setup(t, { async loadReport() { return snapshot; } });
  await view.open(6);
  assert.equal(root.querySelectorAll('.or-stage-card').length, 1);
  assert.match(root.querySelector('.or-stage-card').textContent, /LIMPEZA GERAL.*Total de registros nesta etapa: 0/s);
});

test("relatório 6 retira etapas sem correspondência ao filtrar atividade, status ou colaborador", async t => {
  const snapshot = { stages: [
    { branch: "A", stage: "ALVENARIA", status: "INICIADO", activities: [activity(1, { activity: "CONCRETO", supplier: "ANA" })] },
    { branch: "A", stage: "PINTURA", status: "INICIADO", activities: [activity(2, { activity: "TINTA", supplier: "BIA", status: "ATIVIDADE FINALIZADA" })] },
    { branch: "A", stage: "LIMPEZA GERAL", status: "FINALIZADO", activities: [] },
  ] };
  const { dom, view, root } = setup(t, { async loadReport() { return snapshot; } });
  await view.open(6);
  assert.equal(root.querySelectorAll(".or-stage-card").length, 3);
  const stageFilter = root.querySelector('[name="stage"]');
  stageFilter.value = "LIMPEZA GERAL";
  stageFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  assert.equal(root.querySelectorAll(".or-stage-card").length, 1);
  stageFilter.value = "";
  stageFilter.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  for (const [name, value] of [["activity", "TINTA"], ["status", "ATIVIDADE FINALIZADA"], ["supplier", "BIA"]]) {
    const control = root.querySelector(`[name="${name}"]`);
    control.value = value;
    control.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.deepEqual([...root.querySelectorAll(".or-stage-summary > .or-card-title")].map(node => node.textContent), ["📋 PINTURA"]);
    control.value = "";
    control.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  }
});

test("filtro de status da etapa encontra lançamento posterior e mostra seus dados", async t => {
  const mixed = { number: 6, stages: [{
    branch: "A", stage: "FUNDAÇÃO", start: "2026-09-30", end: "", status: "INICIADO", percent: 40,
    launches: [
      { id: "7", status: "INICIADO", startDate: "2026-09-30", endDate: "", percent: 40 },
      { id: "12", status: "FINALIZADO", startDate: "2026-10-01", endDate: "2026-10-04", percent: 100 },
    ],
    activities: [activity(21)],
  }] };
  const { dom, view, root } = setup(t, { async loadReport() { return mixed; } });
  await view.open(6);
  const status = root.querySelector('[name="stageStatus"]');
  assert.ok([...status.options].some(option => option.value === "FINALIZADO"));
  status.value = "FINALIZADO";
  status.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  const card = root.querySelector(".or-stage-card");
  assert.ok(card);
  assert.match(card.textContent, /100%/);
  assert.match(card.textContent, /01\/10\/2026/);
  assert.match(card.textContent, /FINALIZADO/);
});

test("relatório 7 mostra contagem, ID, data, filial e status", async t => {
  const { view, root } = setup(t);
  await view.open(7);
  assert.match(root.textContent, /DIÁRIOS PENDENTES/);
  assert.equal(root.querySelector('.or-diary-footer [data-metric="diaries"]').textContent, "2");
  assert.equal(root.querySelectorAll(".or-diary-card").length, 2);
  assert.match(root.querySelector(".or-diary-card").textContent, /#11.*22\/09\/2026.*A.*PENDENTE/s);
  assert.equal(root.querySelector('.or-diary-footer [data-metric="diaries"]').textContent, '2');
  assert.equal(root.querySelectorAll('.or-diary-card [data-tone="danger"]').length, 2);
});

test("relatório 7 exibe faixa de cabeçalhos alinhada aos diários", async t => {
  const { view, root } = setup(t);
  await view.open(7);
  assert.deepEqual([...root.querySelectorAll('.or-diary-columns > span')].map(node => node.textContent),
    ['ID', 'DATA', 'FILIAL', 'STATUS']);
  assert.equal(root.querySelectorAll('.or-diary-card').length, 2);
  assert.match(root.querySelector('.or-diary-footer').textContent, /CONTAGEM DE PENDENTES:.*2/s);
});

test("relatório 7 distingue total de pendentes do limite visível", async t => {
  const data = { async loadReport() { return { ...snapshots[7], count: 2001, limited: true }; } };
  const { view, root } = setup(t, data);
  await view.open(7);
  assert.match(root.textContent, /2\.000 mais recentes de 2\.001 pendentes/);
});

test("relatório 8 mantém resumo completo após filtro e escapa texto da lista", async t => {
  const { dom, view, root } = setup(t);
  await view.open(8);
  assert.equal(root.querySelector('[data-metric="pending"]').textContent, "2");
  assert.equal(root.querySelector('[data-metric="completed"]').textContent, "1");
  assert.equal(root.querySelector('[data-metric="total"]').textContent, "3");
  assert.equal(root.querySelectorAll(".or-task-card").length, 3);
  assert.equal(root.querySelector("script"), null);
  assert.match(root.textContent, /Texto <script>malicioso<\/script>/);
  const search = root.querySelector('[name="search"]');
  search.value = "orçamento";
  search.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  assert.equal(root.querySelectorAll(".or-task-card").length, 2);
  assert.equal(root.querySelector('[data-metric="total"]').textContent, "3");
  assert.equal(root.querySelectorAll(".or-due-card").length, 1);
  assert.match(root.querySelector('.or-due-summary').textContent, /DATA FATAL.*TOTAL: 2/s);
});

test("relatório 8 mantém colunas e faixas de data fatal do Power Apps sem omitir atributos", async t => {
  const { view, root } = setup(t);
  await view.open(8);
  assert.deepEqual([...root.querySelectorAll('.or-task-columns > span')].slice(0, 6).map(node => node.textContent),
    ['RESPONSÁVEL', 'ID', 'DATA', 'ASSOCIAÇÃO', 'TAREFA', 'PRIORIDADE']);
  const due = root.querySelector('.or-due-card');
  assert.match(due.querySelector('.or-due-summary').textContent, /DATA FATAL.*05\/10\/2026.*TOTAL: 2/s);
  assert.match(due.textContent, /ANA.*Conferir orçamento.*ALTA.*ATIVIDADE CRIADA/s);
});

test("painéis 6 e 8 mantêm os ícones de contexto dos indicadores originais", async t => {
  const { view, root } = setup(t);
  await view.open(6);
  assert.match(root.querySelector('.or-stage-summary .or-card-title').textContent, /📋/u);
  await view.open(8);
  assert.deepEqual([...root.querySelectorAll('.or-metric dt')].map(node => node.textContent),
    ['⏳ ATIVIDADES PENDENTES', '✅ ATIVIDADES CONCLUÍDAS', '📊 TOTAL DE ATIVIDADES']);
  assert.match(root.querySelector('.or-due-summary .or-card-title').textContent, /📅/u);
});

test("relatório 8 aceita múltiplos status simultâneos como o filtro Power Apps", async t => {
  const { dom, view, root } = setup(t);
  await view.open(8);
  const status = root.querySelector('select[name="status"]');
  assert.equal(status.multiple, true);
  assert.equal([...status.options].filter(option => option.value).length, 3);
  const input = status.nextElementSibling.querySelector('.sfs-trigger');
  input.click();
  for (const value of ["ATIVIDADE CRIADA", "CONCLUÍDO"]) {
    [...status.nextElementSibling.querySelectorAll('[role="option"]')].find(option => option.textContent === value).click();
  }
  assert.equal(root.querySelectorAll('.or-task-card').length, 2);
  assert.deepEqual([...status.selectedOptions].map(option => option.value), ["ATIVIDADE CRIADA", "CONCLUÍDO"]);
  assert.match(input.value, /ATIVIDADE CRIADA.*CONCLUÍDO/);
  assert.equal(root.querySelector('[data-metric="total"]').textContent, '3');
});

test("filtro de status do relatório 8 permanece recolhido e mostra a seleção", async t => {
  const { dom, view, root } = setup(t);
  await view.open(8);
  const status = root.querySelector('select[name="status"]');
  const picker = status.nextElementSibling;
  const input = picker.querySelector('.sfs-trigger');
  const popup = picker.querySelector('.sfs-popup');
  assert.equal(popup.hidden, true);
  input.click();
  [...picker.querySelectorAll('[role="option"]')].find(option => option.textContent === 'ATIVIDADE CRIADA').click();
  input.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  assert.equal(popup.hidden, true);
  assert.equal(input.value, 'ATIVIDADE CRIADA');
});

test("relatório 8 só marca prazo vencido quando há atividade criada ou em atendimento", async t => {
  const data = { async loadReport() { return { number: 8, summary: { pending: 0, completed: 0, total: 1 }, rows: [task(1, { due: "2020-01-01", status: "CANCELADA" })] }; } };
  const { view, root } = setup(t, data);
  await view.open(8);
  assert.equal(root.querySelector(".or-due-card").dataset.tone, "success");
  assert.match(root.textContent, /TODAS AS ATIVIDADES CONCLUÍDAS/);
});

test("fechar cancela consulta e resposta antiga não reaparece ao abrir outro relatório", async t => {
  let finish;
  const signals = [];
  const data = { loadReport(number, { signal }) {
    signals.push(signal);
    if (number === 6) return new Promise(resolve => { finish = resolve; });
    return Promise.resolve(snapshots[number]);
  } };
  const { view, root } = setup(t, data);
  const pending = view.open(6);
  view.close();
  assert.equal(signals[0].aborted, true);
  await view.open(7);
  finish(snapshots[6]);
  await pending;
  assert.equal(root.querySelectorAll(".or-stage-card").length, 0);
  assert.equal(root.querySelectorAll(".or-diary-card").length, 2);
  assert.equal(root.hidden, false);
});

test("falha de consulta mostra erro sem métricas parciais", async t => {
  const { view, root } = setup(t, { async loadReport() { throw new Error("SharePoint indisponível"); } });
  await view.open(8);
  assert.match(root.textContent, /SharePoint indisponível/);
  assert.equal(root.querySelectorAll(".or-task-card").length, 0);
  assert.equal(root.querySelector('[data-metric="total"]')?.textContent, "—");
});
