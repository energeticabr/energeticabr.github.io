import assert from "node:assert/strict";
import test from "node:test";
import {
  DASHBOARD_METRIC_GROUPS,
  DASHBOARD_METRIC_DEFINITIONS,
  buildDashboardMetrics,
  loadDashboardSources,
} from "../portal/dashboard/dashboard-model.js";

const TODAY = "2026-08-26";

function item(id, fields = {}, metadata = {}) {
  return {
    id: String(id),
    fields,
    createdDateTime: metadata.createdDateTime || `${TODAY}T10:00:00Z`,
    lastModifiedDateTime: metadata.lastModifiedDateTime || `${TODAY}T10:00:00Z`,
    createdBy: metadata.createdBy || { user: { displayName: "ANA", email: "ana@energeticabr.com" } },
    lastModifiedBy: metadata.lastModifiedBy || { user: { displayName: "ANA", email: "ana@energeticabr.com" } },
  };
}

test("o catálogo do painel cobre as doze medidas comprovadas do Power Apps", () => {
  assert.deepEqual(DASHBOARD_METRIC_DEFINITIONS.map(metric => metric.id), [
    "vencimentos-hoje",
    "vencidos",
    "auditoria",
    "cotacoes",
    "documentos",
    "tarefas",
    "tarefas-delegadas",
    "contratos",
    "valores-pendentes",
    "diarios",
    "documentacao-comercial",
    "patologias",
  ]);
  assert.ok(DASHBOARD_METRIC_DEFINITIONS.every(metric => metric.entityIds.length > 0));
  assert.deepEqual(
    Object.fromEntries(DASHBOARD_METRIC_DEFINITIONS.map(metric => [metric.id, metric.entityIds])),
    {
      "vencimentos-hoje": ["provisoes-de-pagamento"],
      vencidos: ["provisoes-de-pagamento"],
      auditoria: ["notas-pendentes"],
      cotacoes: ["novas-cotacoes"],
      documentos: ["documentos-operacionais"],
      tarefas: ["lancamentos-de-tarefas"],
      "tarefas-delegadas": ["tarefas-delegadas"],
      contratos: ["empreiteiros"],
      "valores-pendentes": ["descricoes-de-presenca"],
      diarios: ["diarios-de-obras"],
      "documentacao-comercial": ["imoveis"],
      patologias: ["patologias-sac"],
    },
  );
  assert.deepEqual(DASHBOARD_METRIC_GROUPS.map(group => [group.id, group.color, group.metricIds]), [
    ["financeiro-compras", "#001060", ["vencimentos-hoje", "vencidos", "auditoria", "cotacoes"]],
    ["documentos", "#88A0D1", ["documentos"]],
    ["tarefas", "#638B2C", ["tarefas", "tarefas-delegadas"]],
    ["obras-rh", "#CB6666", ["contratos", "valores-pendentes", "diarios"]],
    ["comercial", "#AC3E0B", ["documentacao-comercial", "patologias"]],
  ]);
});

test("calcula as medidas com as mesmas fontes e condições do resumo do Power Apps", () => {
  const sources = [
    {
      entityId: "provisoes-de-pagamento",
      title: "Programação de pagamentos",
      state: "ready",
      items: [
        item(1, { "DATA PREVISTO PGTO": TODAY, "DATA PGTO EFETUADO": "" }),
        item(2, { "DATA PREVISTO PGTO": "2026-08-20", "DATA PGTO EFETUADO": "" }),
        item(3, { "DATA PREVISTO PGTO": "2026-08-20", "DATA PGTO EFETUADO": TODAY }),
      ],
    },
    { entityId: "notas-pendentes", title: "Notas pendentes", state: "ready", items: [item(4, { STATUS: "PENDENTE AUDITORIA" }), item(5, { STATUS: "SUBMETIDO" })] },
    { entityId: "novas-cotacoes", title: "Cotações", state: "ready", items: [item(6, { STATUS: "ATIVA" }), item(7, { STATUS: "FINALIZADA" })] },
    { entityId: "documentos-operacionais", title: "Documentos", state: "ready", items: [item(8, { STATUS: "PENDENTE" }), item(9, { STATUS: "SUBMETIDO" })] },
    { entityId: "empreiteiros", title: "Empreiteiros", state: "ready", items: [item(10, { STATUS: "ATIVO" }), item(11, { STATUS: "INATIVO" })] },
    {
      entityId: "descricoes-de-presenca",
      title: "Descrições de presença",
      state: "ready",
      items: [
        item(12, { PRESENCA: "PRESENTE", STATUS: "PENDENTE", VLORDIARIO: "1.234,50" }),
        item(13, { PRESENCA: "PRESENTE", STATUS: "PAGO", VLORDIARIO: 500 }),
        item(14, { PRESENCA: "AUSENTE", STATUS: "PENDENTE", VLORDIARIO: 300 }),
      ],
    },
    { entityId: "diarios-de-obras", title: "Diários", state: "ready", items: [item(15, { STATUS: "PENDENTE" }), item(16, { STATUS: "SUBMETIDO" })] },
    {
      entityId: "imoveis",
      title: "Imóveis",
      state: "ready",
      items: [
        item(17, { FILIAL: "001", IMOVEL: "101", SEGURO: "OK", IDPROPOSTA: "", IDCONTRATOCAIXA: "", IDESCRITURA: "", IDDOCUMENTOCORRETAGEM: "", IDDOCFISCAL: "" }),
        item(18, { FILIAL: "001", IMOVEL: "TODOS" }),
      ],
    },
    { entityId: "patologias-sac", title: "Patologias", state: "ready", items: [item(19, { STATUS: "ATIVO" }), item(20, { STATUS: "INATIVO" })] },
    { entityId: "lancamentos-de-tarefas", title: "Tarefas", state: "ready", items: [item(21, { "CONCLUÍDO": "ATIVIDADE CRIADA" }), item(22, { "CONCLUÍDO": "CONCLUÍDO" })] },
    { entityId: "tarefas-delegadas", title: "Delegadas", state: "ready", items: [item(23, { CONCLU_x00cd_DO: "EM ATENDIMENTO" })] },
  ];

  const metrics = buildDashboardMetrics(sources, { today: TODAY });
  const byId = Object.fromEntries(metrics.map(metric => [metric.id, metric]));

  assert.equal(byId["vencimentos-hoje"].value, 1);
  assert.equal(byId.vencidos.value, 1);
  assert.equal(byId.auditoria.value, 1);
  assert.equal(byId.cotacoes.value, 1);
  assert.equal(byId.documentos.value, 1);
  assert.equal(byId.contratos.value, 1);
  assert.equal(byId["valores-pendentes"].value, 1234.5);
  assert.equal(byId.diarios.value, 1);
  assert.equal(byId["documentacao-comercial"].value, 5);
  assert.equal(byId.patologias.value, 1);
  assert.equal(byId.tarefas.value, 1);
  assert.equal(byId["tarefas-delegadas"].value, 1);
});

test("carrega cada fonte de forma independente, pagina e preserva diagnóstico acionável", async () => {
  const calls = [];
  const entities = [
    { id: "auditorias", title: "Auditorias", siteKey: "personal", listNames: ["AUDITORIAS"] },
    { id: "novas-cotacoes", title: "Cotações", siteKey: "personal", listNames: ["COTACOES"] },
  ];
  const repository = {
    async resolveList(_siteKey, aliases) {
      if (aliases[0] === "COTACOES") throw Object.assign(new Error("Sem permissão"), { status: 403, code: "accessDenied" });
      return { status: "resolved", id: "lista-auditorias" };
    },
    async getItemsPage(_siteKey, listId, _query, options) {
      calls.push([listId, options.cursor]);
      if (!options.cursor) return { items: [item(1)], hasMore: true, nextLink: "cursor-seguro" };
      return { items: [item(2)], hasMore: false, nextLink: "" };
    },
  };

  const result = await loadDashboardSources(repository, entities, { batchSize: 100, maxPages: 3 });

  assert.equal(result[0].state, "ready");
  assert.equal(result[0].items.length, 2);
  assert.equal(result[0].pageCount, 2);
  assert.equal(result[1].state, "forbidden");
  assert.match(result[1].diagnostic, /permissão/i);
  assert.deepEqual(calls, [["lista-auditorias", ""], ["lista-auditorias", "cursor-seguro"]]);
});

test("o resumo percorre todas as páginas por padrão, sem o antigo corte de três páginas", async () => {
  const entities = [
    { id: "auditorias", title: "Auditorias", siteKey: "personal", listNames: ["AUDITORIAS"] },
  ];
  const repository = {
    async resolveList() {
      return { status: "resolved", id: "lista-auditorias" };
    },
    async getItemsPage(_siteKey, _listId, _query, options) {
      const pageNumber = options.cursor ? Number(options.cursor.split("-").at(-1)) : 1;
      assert.equal(options.maxPages, undefined);
      return {
        items: [item(pageNumber)],
        hasMore: pageNumber < 5,
        nextLink: pageNumber < 5 ? `cursor-${pageNumber + 1}` : "",
      };
    },
  };

  const [result] = await loadDashboardSources(repository, entities);

  assert.equal(result.state, "ready");
  assert.equal(result.pageCount, 5);
  assert.equal(result.items.length, 5);
});

test("o resumo percorre mais de cem páginas e contabiliza a fonte inteira", async () => {
  const entities = [
    { id: "auditorias", title: "Auditorias", siteKey: "personal", listNames: ["AUDITORIAS"] },
  ];
  let calls = 0;
  const repository = {
    async resolveList() {
      return { status: "resolved", id: "lista-auditorias" };
    },
    async getItemsPage(_siteKey, _listId, _query, options) {
      calls += 1;
      assert.equal(options.cursor, calls === 1 ? "" : `cursor-${calls}`);
      return {
        items: [item(calls)],
        hasMore: calls < 105,
        nextLink: calls < 105 ? `cursor-${calls + 1}` : "",
      };
    },
  };

  const [result] = await loadDashboardSources(repository, entities);

  assert.equal(result.state, "ready");
  assert.equal(result.pageCount, 105);
  assert.equal(result.items.length, 105);
  assert.equal(calls, 105);
});

test("uma fonte parcial mantém os registros carregados na métrica e sinaliza o limite", () => {
  const metrics = buildDashboardMetrics([{
    entityId: "notas-pendentes",
    title: "Notas pendentes",
    state: "partial",
    items: [item(1, { STATUS: "PENDENTE AUDITORIA" }), item(2, { STATUS: "PENDENTE AUDITORIA" })],
    diagnostic: "Consulta parcial: limite atingido.",
  }], { today: TODAY });
  const audit = metrics.find(metric => metric.id === "auditoria");

  assert.equal(audit.value, 2);
  assert.equal(audit.state, "partial");
  assert.match(audit.diagnostic, /limite/i);
});
