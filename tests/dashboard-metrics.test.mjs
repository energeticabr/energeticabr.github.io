import assert from "node:assert/strict";
import test from "node:test";
import {
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

test("o catálogo do painel cobre as onze medidas comprovadas do Power Apps", () => {
  assert.deepEqual(DASHBOARD_METRIC_DEFINITIONS.map(metric => metric.id), [
    "vencimentos-hoje",
    "vencidos",
    "auditoria",
    "cotacoes",
    "documentos",
    "contratos",
    "valores-pendentes",
    "diarios",
    "documentacao-comercial",
    "patologias",
    "tarefas",
  ]);
  assert.ok(DASHBOARD_METRIC_DEFINITIONS.every(metric => metric.entityIds.length > 0));
});

test("calcula contagens, vencimentos e valor pendente sem misturar fontes indisponíveis", () => {
  const sources = [
    {
      entityId: "lancamentos",
      title: "Lançamentos",
      state: "ready",
      items: [
        item(1, { STATUS: "PENDENTE", "DATA PGTO PREVISTO": TODAY, VALOR: "1.234,50" }),
        item(2, { STATUS: "PENDENTE", "DATA PGTO PREVISTO": "2026-08-20", VALOR: 300 }),
        item(3, { STATUS: "CONCLUÍDO", "DATA PGTO PREVISTO": "2026-08-20", VALOR: 900 }),
      ],
    },
    { entityId: "auditorias", title: "Auditorias", state: "ready", items: [item(4), item(5)] },
    { entityId: "novas-cotacoes", title: "Cotações", state: "forbidden", items: [], diagnostic: "Acesso negado pelo SharePoint." },
    { entityId: "documentos-operacionais", title: "Documentos", state: "ready", items: [item(6)] },
  ];

  const metrics = buildDashboardMetrics(sources, { today: TODAY });
  const byId = Object.fromEntries(metrics.map(metric => [metric.id, metric]));

  assert.equal(byId["vencimentos-hoje"].value, 1);
  assert.equal(byId.vencidos.value, 1);
  assert.equal(byId["valores-pendentes"].value, 1534.5);
  assert.equal(byId.auditoria.value, 2);
  assert.equal(byId.documentos.value, 1);
  assert.equal(byId.cotacoes.state, "forbidden");
  assert.equal(byId.cotacoes.diagnostic, "Acesso negado pelo SharePoint.");
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

test("uma fonte parcial mantém os registros carregados na métrica e sinaliza o limite", () => {
  const metrics = buildDashboardMetrics([{
    entityId: "auditorias",
    title: "Auditorias",
    state: "partial",
    items: [item(1), item(2)],
    diagnostic: "Consulta parcial: limite atingido.",
  }], { today: TODAY });
  const audit = metrics.find(metric => metric.id === "auditoria");

  assert.equal(audit.value, 2);
  assert.equal(audit.state, "partial");
  assert.match(audit.diagnostic, /limite/i);
});
