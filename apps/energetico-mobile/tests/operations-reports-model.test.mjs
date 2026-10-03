import test from "node:test";
import assert from "node:assert/strict";
import { buildStageReport, buildTaskReport } from "../src/chat/operations-reports-model.js";

test("etapas separa filiais iguais, filtra status da obra e ordena atividades", () => {
  const snapshot = {
    activities: [
      { id: "2", stage: "Fundação", branch: "A", activity: "Concreto", executionDate: "2026-10-03", status: "ATIVIDADE FINALIZADA" },
      { id: "1", stage: "Fundação", branch: "A", activity: "Escavação", executionDate: "2026-10-01", status: "ATIVIDADE INICIADA" },
      { id: "3", stage: "Fundação", branch: "B", activity: "Outra", executionDate: "2026-10-02", status: "ATIVIDADE INICIADA" },
    ],
    launches: [
      { id: "7", stage: "Fundação", branch: "A", startDate: "2026-09-30", status: "INICIADO", percent: 40 },
      { id: "8", stage: "Fundação", branch: "B", startDate: "2026-09-20", status: "FINALIZADO", percent: 100 },
    ],
  };
  const report = buildStageReport(snapshot, { launchStatus: "INICIADO" }, "2026-10-05");
  assert.equal(report.stages.length, 1);
  assert.equal(report.stages[0].branch, "A");
  assert.equal(report.stages[0].percent, 40);
  assert.deepEqual(report.stages[0].rows.map(row => row.id), ["1", "2"]);
  assert.equal(report.stages[0].days, 5);
});

test("etapa aceita qualquer lançamento do status filtrado e exibe o início mais recente, desempate por maior ID", () => {
  const snapshot = {
    activities: [{ id: "1", branch: "A", stage: "Fundação", activity: "Concreto", executionDate: "2026-10-02" }],
    launches: [
      { id: "7", branch: "A", stage: "Fundação", status: "INICIADO", startDate: "2026-09-30", percent: 40 },
      { id: "10", branch: "A", stage: "Fundação", status: "FINALIZADO", startDate: "2026-10-01", endDate: "2026-10-03", percent: 80 },
      { id: "12", branch: "A", stage: "Fundação", status: "FINALIZADO", startDate: "2026-10-01", endDate: "2026-10-04", percent: 100 },
      { id: "99", branch: "B", stage: "Fundação", status: "FINALIZADO", startDate: "2026-10-05", percent: 90 },
    ],
  };
  const finalized = buildStageReport(snapshot, { launchStatus: "FINALIZADO" }, "2026-10-05");
  assert.equal(finalized.stages.length, 1);
  assert.equal(finalized.stages[0].status, "FINALIZADO");
  assert.equal(finalized.stages[0].percent, 100);
  assert.equal(finalized.stages[0].startDate, "2026-10-01");
  assert.equal(finalized.stages[0].days, 3);
  assert.deepEqual(finalized.stages[0].launches.map(row => row.id), ["12", "10", "7"]);

  const started = buildStageReport(snapshot, { launchStatus: "INICIADO" }, "2026-10-05");
  assert.equal(started.stages[0].status, "INICIADO");
  assert.equal(started.stages[0].percent, 40);
  assert.equal(buildStageReport(snapshot, {}, "2026-10-05").stages[0].status, "FINALIZADO");
});

test("relatório 6 mantém etapa lançada sem atividades com total zero", () => {
  const snapshot = {
    activities: [{ id: "1", branch: "A", stage: "ALVENARIA", executionDate: "2026-10-01" }],
    launches: [
      { id: "10", branch: "A", stage: "ALVENARIA", status: "INICIADO", startDate: "2026-09-01", percent: 20 },
      { id: "11", branch: "A", stage: "LIMPEZA GERAL", status: "FINALIZADO", startDate: "2026-09-02", endDate: "2026-09-03", percent: 100 },
    ],
  };
  const report = buildStageReport(snapshot, {}, "2026-10-02");
  assert.deepEqual(report.stages.map(stage => [stage.stage, stage.rows.length]), [["LIMPEZA GERAL", 0], ["ALVENARIA", 1]]);
  assert.equal(report.count, 1);
});

test("relatório 6 exclui etapas sem atividade correspondente ao filtro", () => {
  const snapshot = {
    activities: [
      { id: "1", branch: "A", stage: "ALVENARIA", activity: "CONCRETO", status: "ATIVIDADE INICIADA", supplier: "ANA" },
      { id: "2", branch: "A", stage: "PINTURA", activity: "TINTA", status: "ATIVIDADE FINALIZADA", supplier: "BIA" },
    ],
    launches: [
      { id: "10", branch: "A", stage: "ALVENARIA" },
      { id: "11", branch: "A", stage: "PINTURA" },
      { id: "12", branch: "A", stage: "LIMPEZA GERAL" },
    ],
  };
  assert.deepEqual(buildStageReport(snapshot, { stage: "LIMPEZA GERAL" }).stages.map(stage => stage.stage), ["LIMPEZA GERAL"]);
  for (const filters of [{ activity: "TINTA" }, { status: "ATIVIDADE FINALIZADA" }, { supplier: "BIA" }]) {
    const report = buildStageReport(snapshot, filters);
    assert.deepEqual(report.stages.map(stage => stage.stage), ["PINTURA"]);
    assert.equal(report.count, 1);
  }
});

test("tarefas agrupa por prazo e responsável e mantém resumo sem filtros", () => {
  const snapshot = {
    summary: { pending: 2, completed: 1, total: 3 }, limited: false,
    rows: [
      { id: "1", task: "Urgente", status: "ATIVIDADE CRIADA", priority: "ATIVIDADE EMERGENCIAL", dueDate: "2026-09-30", identifiedDate: "2026-09-29", responsible: "ana", association: "A" },
      { id: "2", task: "Concluída", status: "CONCLUÍDO", priority: "", dueDate: "2026-09-30", identifiedDate: "2026-09-28", responsible: "Ana", association: "A" },
      { id: "3", task: "Sem data", status: "EM ATENDIMENTO", priority: "", dueDate: "", identifiedDate: "2026-09-27", responsible: "", association: "B" },
    ],
  };
  const report = buildTaskReport(snapshot, { search: "Urgente" }, "2026-10-02");
  assert.deepEqual(report.summary, { pending: 2, completed: 1, total: 3 });
  assert.equal(report.groups.length, 1);
  assert.equal(report.groups[0].dueDate, "2026-09-30");
  assert.equal(report.groups[0].tone, "danger");
  assert.equal(report.groups[0].responsibles[0].name, "ANA");
  assert.deepEqual(report.groups[0].responsibles[0].rows.map(row => row.id), ["1"]);
});
