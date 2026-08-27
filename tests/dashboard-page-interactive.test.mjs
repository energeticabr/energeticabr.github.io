import assert from "node:assert/strict";
import test from "node:test";
import { loadDashboardSummary, renderDashboard } from "../portal/ui/dashboard-page.js";

function root() {
  return {
    innerHTML: "",
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
  };
}

const entities = [
  { id: "auditorias", moduleId: "auditoria-compliance", title: "Auditorias", siteKey: "personal", listNames: ["AUDITORIAS"] },
  { id: "novas-cotacoes", moduleId: "suprimentos", title: "Cotações", siteKey: "personal", listNames: ["COTACOES"] },
];

test("painel integrado expõe métricas, auditoria, gráficos e diagnóstico por fonte", async () => {
  const repository = {
    async resolveList(_siteKey, names) {
      if (names[0] === "COTACOES") throw Object.assign(new Error("sem acesso"), { status: 403 });
      return { status: "resolved", id: "auditorias" };
    },
    async getItemsPage() {
      return {
        items: [{
          id: "1",
          fields: { STATUS: "PENDENTE", Title: "AUDITORIA 1" },
          createdDateTime: "2026-08-26T12:00:00Z",
          lastModifiedDateTime: "2026-08-26T13:00:00Z",
          createdBy: { user: { displayName: "ANA" } },
          lastModifiedBy: { user: { displayName: "BRUNO" } },
        }],
        hasMore: false,
        nextLink: "",
      };
    },
  };
  const context = {
    repository,
    entities,
    modules: [
      { id: "auditoria-compliance", title: "Auditoria" },
      { id: "suprimentos", title: "Suprimentos" },
    ],
    access: {},
    can: () => true,
  };

  const summary = await loadDashboardSummary(context, { today: "2026-08-26", timeZone: "UTC" });
  assert.equal(summary.metrics.find(metric => metric.id === "auditoria").value, 1);
  assert.equal(summary.sources.find(source => source.entityId === "novas-cotacoes").state, "forbidden");
  assert.equal(summary.audit.created, 1);
  assert.equal(summary.audit.edited, 1);

  const container = root();
  const page = renderDashboard(container, { ...context, dashboardOptions: { today: "2026-08-26", timeZone: "UTC" } });
  await page.ready;
  assert.match(container.innerHTML, /Vencimentos hoje/);
  assert.match(container.innerHTML, /Valores pendentes/);
  assert.match(container.innerHTML, /Auditoria por data/);
  assert.match(container.innerHTML, /Limpar filtros/);
  assert.match(container.innerHTML, /Saúde das fontes/);
  assert.match(container.innerHTML, /permissão/i);
});
