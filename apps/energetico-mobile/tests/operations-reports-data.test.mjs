import test from "node:test";
import assert from "node:assert/strict";
import { createOperationsReportsData } from "../src/chat/operations-reports-data.js";

const item = (id, fields) => ({ id: String(id), fields });
const definitions = {
  DEMONSTRATIVOETAPA: ["FILIAL", "ETAPA", "ATIVIDADEEXECUTADA", "STATUS", "FORNECEDOR", "IMOVEL", "DATAEXECUTADO", "DATAPREVISTO"],
  LANCAMENTOOBRA: ["FILIAL", "ETAPA", "INÍCIO", "FIM", "STATUS", "PERCENTUALEFETUADO"],
  "DIÁRIO DE OBRAS": ["DATA", "FILIAL", "STATUS"],
  TAREFASDELEGADAS: ["DATAIDENTIFICACAO", "DATA FATAL", "RESPONSÁVEL", "CONCLUÍDO", "DIFICULDADE", "ASSOCIAÇÃO", "PRIORITÁRIA", "TAREFA"],
};

function repositoryWith(records, overrides = {}) {
  const calls = [];
  return {
    calls,
    repository: {
      async resolveList(site, aliases) {
        assert.equal(site, "personal");
        const name = aliases[0];
        calls.push(["resolve", name]);
        return { status: "resolved", id: name };
      },
      async getColumns(_site, list) {
        return definitions[list].map((displayName, index) => ({ name: `field_${index + 1}`, displayName }));
      },
      async getItemsPage(_site, list, query, options) {
        calls.push(["page", list, options.pageNumber, query]);
        const rows = records[list] || [];
        const offset = (options.pageNumber - 1) * 100;
        const items = rows.slice(offset, offset + 100);
        const hasMore = offset + 100 < rows.length;
        return { items, hasMore, nextLink: hasMore ? `cursor-${options.pageNumber}` : "" };
      },
      ...overrides,
    },
  };
}

test("relatório 6 reúne atividades apenas com a etapa da mesma filial", async () => {
  const { repository } = repositoryWith({
    LANCAMENTOOBRA: [
      item(1, { field_1: "A", field_2: "ALVENARIA", field_3: "2026-09-01", field_4: "", field_5: "INICIADO", field_6: 0.25 }),
      item(2, { field_1: "B", field_2: "ALVENARIA", field_3: "2026-09-02", field_4: "2026-09-04", field_5: "FINALIZADO", field_6: 1 }),
    ],
    DEMONSTRATIVOETAPA: [
      item(21, { field_1: "A", field_2: "ALVENARIA", field_3: "PAREDE", field_4: "ATIVIDADE INICIADA", field_5: "João", field_6: "Casa", field_7: "2026-09-03", field_8: "2026-09-08" }),
      item(22, { field_1: "B", field_2: "ALVENARIA", field_3: "REBOCO", field_4: "ATIVIDADE FINALIZADA", field_5: "Maria", field_6: "Loja", field_7: "2026-09-04", field_8: "2026-09-05" }),
    ],
  });
  const result = await createOperationsReportsData({ repository }).loadReport(6);
  assert.equal(result.stages.length, 2);
  assert.deepEqual(result.stages.map(stage => [stage.branch, stage.percent, stage.activities[0].activity]), [["B", 100, "REBOCO"], ["A", 25, "PAREDE"]]);
});

test("relatório 7 usa somente pendentes e os 2.000 IDs mais recentes", async () => {
  const rows = Array.from({ length: 2002 }, (_, index) => item(index + 1, {
    field_1: "2026-09-21", field_2: "FILIAL", field_3: index === 100 ? "FINALIZADO" : "PENDENTE",
  }));
  const { repository, calls } = repositoryWith({ "DIÁRIO DE OBRAS": rows });
  const result = await createOperationsReportsData({ repository }).loadReport(7);
  assert.equal(result.count, 2001, "A contagem indica todos os diários pendentes, mesmo com limite visual de 2.000");
  assert.equal(result.rows.length, 2000);
  assert.equal(result.limited, true);
  assert.equal(result.rows[0].id, "2002");
  assert.equal(result.rows.at(-1).id, "2");
  assert.ok(calls.some(call => call[1] === "DIÁRIO DE OBRAS" && call[2] === 21));
});

test("relatório 8 calcula o resumo sobre a lista inteira antes do limite do detalhe", async () => {
  const rows = Array.from({ length: 2002 }, (_, index) => item(index + 1, {
    field_1: "2026-09-21", field_2: index % 2 ? "2026-10-05" : "",
    field_3: index % 2 ? " Ana " : "", field_4: index === 0 ? "CONCLUÍDO" : index === 1 ? "EM ATENDIMENTO" : "ATIVIDADE CRIADA",
    field_5: "ALTA", field_6: "OBRA", field_7: index === 0 ? "ATIVIDADE EMERGENCIAL" : "ATIVIDADE PRIORITÁRIA", field_8: `Tarefa ${index + 1}`,
  }));
  const { repository } = repositoryWith({ TAREFASDELEGADAS: rows });
  const result = await createOperationsReportsData({ repository }).loadReport(8);
  assert.deepEqual(result.summary, { pending: 2001, completed: 1, total: 2002 });
  assert.equal(result.rows.length, 2002);
  assert.equal(result.rows.find(row => row.id === "1").responsibleKey, "SEM RESPONSÁVEL");
  assert.equal(result.rows.find(row => row.id === "2").responsibleKey, "ANA");
});

test("página sem cursor aborta a consulta sem devolver contagem parcial", async () => {
  const { repository } = repositoryWith({}, { async getItemsPage() { return { items: [item(1, {})], hasMore: true, nextLink: "" }; } });
  await assert.rejects(createOperationsReportsData({ repository }).loadReport(7), /paginação|página/i);
});

test("ID inválido não é descartado para aparentar total completo", async () => {
  const { repository } = repositoryWith({ TAREFASDELEGADAS: [item("sem-id", { field_4: "ATIVIDADE CRIADA" })] });
  await assert.rejects(createOperationsReportsData({ repository }).loadReport(8), /ID inválido/i);
});

test("coluna STATUS ausente não produz contagem zero falsa", async () => {
  const { repository } = repositoryWith({ "DIÁRIO DE OBRAS": [item(1, { field_3: "PENDENTE" })] }, {
    async getColumns() { return [{ name: "field_1", displayName: "DATA" }, { name: "field_2", displayName: "FILIAL" }]; },
  });
  await assert.rejects(createOperationsReportsData({ repository }).loadReport(7), /STATUS/);
});

test("sinal cancelado impede consulta e número fora do grupo é recusado", async () => {
  const { repository, calls } = repositoryWith({});
  const data = createOperationsReportsData({ repository });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(data.loadReport(6, { signal: controller.signal }), /abort|cancelad/i);
  await assert.rejects(data.loadReport(9), /6, 7 ou 8/);
  assert.equal(calls.length, 0);
});
