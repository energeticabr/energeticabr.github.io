import assert from "node:assert/strict";
import test from "node:test";
import { buildAuditSummary } from "../portal/audit/audit-model.js";
import {
  auditDetailsMarkup,
  createAuditCharts,
  loadAuditPageData,
} from "../portal/audit/audit-page.js";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import { MODULES } from "../portal/catalog/modules.js";
import { PORTAL_ROUTES, createRouter } from "../portal/core/router.js";
import { renderAppShell } from "../portal/ui/app-shell.js";

const DATE = "2026-08-26";

function record(id, sourceId, created, modified, creator, editor) {
  return {
    id,
    sourceId,
    sourceTitle: sourceId === "auditorias" ? "Auditorias" : "Contratos",
    createdDateTime: created,
    lastModifiedDateTime: modified,
    createdBy: { user: { displayName: creator, email: `${creator.toLowerCase()}@energeticabr.com` } },
    lastModifiedBy: { user: { displayName: editor, email: `${editor.toLowerCase()}@energeticabr.com` } },
  };
}

test("a auditoria detalhada expõe os IDs criados e editados sem retirar o resumo existente", () => {
  const summary = buildAuditSummary([
    record("10", "auditorias", `${DATE}T10:00:00Z`, `${DATE}T10:00:00Z`, "ANA", "ANA"),
    record("20", "contratos", "2026-08-20T10:00:00Z", `${DATE}T12:00:00Z`, "BRUNO", "CARLA"),
    record("30", "auditorias", `${DATE}T13:00:00Z`, `${DATE}T14:00:00Z`, "ANA", "CARLA"),
  ], { date: DATE, timeZone: "UTC" });

  assert.equal(summary.created, 2);
  assert.equal(summary.edited, 2);
  assert.deepEqual(summary.createdIds, ["10", "30"]);
  assert.deepEqual(summary.editedIds, ["20", "30"]);
  assert.equal(summary.events.length, 4);
  assert.deepEqual(summary.events.map(event => [event.action, event.recordId, event.sourceId, event.actor]), [
    ["created", "10", "auditorias", "ANA"],
    ["edited", "20", "contratos", "CARLA"],
    ["created", "30", "auditorias", "ANA"],
    ["edited", "30", "auditorias", "CARLA"],
  ]);
});

test("a consulta carrega somente entidades visíveis e limita a paginação Graph", async () => {
  const entities = [
    { id: "auditorias", moduleId: "auditoria-compliance", title: "Auditorias", siteKey: "personal", listNames: ["AUDITORIAS"] },
    { id: "contratos", moduleId: "financeiro", title: "Contratos", siteKey: "personal", listNames: ["CONTRATOS"] },
  ];
  const calls = [];
  const repository = {
    async resolveList(_siteKey, names) {
      calls.push(["resolve", names[0]]);
      return { status: "resolved", id: "lista-auditorias" };
    },
    async getItemsPage(_siteKey, _listId, query, options) {
      calls.push(["page", query, options.pageNumber, options.maxPages]);
      return {
        items: [record(String(options.pageNumber), "auditorias", `${DATE}T10:00:00Z`, `${DATE}T10:00:00Z`, "ANA", "ANA")],
        hasMore: true,
        nextLink: `https://graph.microsoft.com/v1.0/sites/site/lists/lista-auditorias/items?$skiptoken=${options.pageNumber}`,
      };
    },
  };
  const context = {
    entities,
    repository,
    access: {},
    can: (_access, moduleId) => moduleId === "auditoria-compliance",
  };

  const result = await loadAuditPageData(context, {
    date: DATE,
    timeZone: "UTC",
    batchSize: 999,
    maxPages: 999,
  });

  assert.deepEqual(result.entities.map(entity => entity.id), ["auditorias"]);
  assert.deepEqual(calls.filter(([kind]) => kind === "resolve"), [["resolve", "AUDITORIAS"]]);
  assert.equal(calls.filter(([kind]) => kind === "page").length, 50);
  assert.match(calls[1][1], /\$top=100/);
  assert.equal(calls.at(-1)[3], 50);
  assert.equal(result.partial, true);
  assert.equal(result.summary.created, 50);
});

test("a auditoria falha fechada quando o repositório não oferece paginação incremental", async () => {
  let unlimitedRead = false;
  const context = {
    entities: [{ id: "auditorias", moduleId: "auditoria-compliance", title: "Auditorias", siteKey: "personal", listNames: ["AUDITORIAS"] }],
    access: {},
    can: () => true,
    repository: {
      async resolveList() { return { status: "resolved", id: "auditorias" }; },
      async getItems() {
        unlimitedRead = true;
        return [];
      },
    },
  };

  await assert.rejects(loadAuditPageData(context, { date: DATE }), /paginação incremental/i);
  assert.equal(unlimitedRead, false);
});

test("a descoberta limita a quatro fontes simultâneas sem omitir entidades autorizadas", async () => {
  const entities = Array.from({ length: 10 }, (_, index) => ({
    id: `fonte-${index + 1}`,
    moduleId: "auditoria-compliance",
    title: `Fonte ${index + 1}`,
    siteKey: "personal",
    listNames: [`FONTE ${index + 1}`],
  }));
  let inFlight = 0;
  let maximumInFlight = 0;
  const repository = {
    async resolveList(_siteKey, names) { return { status: "resolved", id: names[0] }; },
    async getItemsPage() {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return { items: [], hasMore: false, nextLink: "" };
    },
  };

  const result = await loadAuditPageData({ entities, repository, access: {}, can: () => true }, { date: DATE });

  assert.equal(result.sources.length, 10);
  assert.equal(maximumInFlight, 4);
});

test("os gráficos de auditoria cruzam ação, base e usuário e filtram os IDs exibidos", () => {
  const summary = buildAuditSummary([
    record("10", "auditorias", `${DATE}T10:00:00Z`, `${DATE}T10:00:00Z`, "ANA", "ANA"),
    record("20", "contratos", "2026-08-20T10:00:00Z", `${DATE}T12:00:00Z`, "BRUNO", "CARLA"),
    record("30", "auditorias", `${DATE}T13:00:00Z`, `${DATE}T14:00:00Z`, "ANA", "CARLA"),
  ], { date: DATE, timeZone: "UTC" });
  const charts = createAuditCharts(summary.events);

  assert.match(charts.markup(), /Ação/);
  assert.match(charts.markup(), /Bases/);
  assert.match(charts.markup(), /Usuários/);
  charts.toggle("action", "edited");
  charts.toggle("sourceId", "auditorias");
  assert.deepEqual(charts.filtered().map(event => event.recordId), ["30"]);
  assert.deepEqual(charts.activeFilters(), { action: "edited", sourceId: "auditorias" });

  const html = auditDetailsMarkup(charts.filtered(), { date: DATE, pageSize: 1 });
  assert.match(html, /Total criado no recorte[\s\S]*0/);
  assert.match(html, /Total editado no recorte[\s\S]*1/);
  assert.match(html, /#30/);
  assert.doesNotMatch(html, /#20/);
});

test("o gráfico de usuários não funde contas distintas com o mesmo nome de exibição", () => {
  const first = record("41", "auditorias", `${DATE}T10:00:00Z`, `${DATE}T10:00:00Z`, "ALEX", "ALEX");
  const second = record("42", "auditorias", `${DATE}T11:00:00Z`, `${DATE}T11:00:00Z`, "ALEX", "ALEX");
  second.createdBy.user.email = "alex.segundo@energeticabr.com";
  const summary = buildAuditSummary([first, second], { date: DATE, timeZone: "UTC" });
  const charts = createAuditCharts(summary.events);

  assert.match(charts.markup(), /data-chart-dimension="actorId"/);
  assert.match(charts.markup(), /alex@energeticabr\.com/);
  assert.match(charts.markup(), /alex\.segundo@energeticabr\.com/);
  charts.toggle("actorId", "alex.segundo@energeticabr.com");
  assert.deepEqual(charts.filtered().map(event => event.recordId), ["42"]);
});

function shellRoot(routeIds) {
  const links = routeIds.map(shellRoute => {
    const classes = new Set();
    return {
      dataset: { shellRoute },
      classList: { toggle(name, active) { active ? classes.add(name) : classes.delete(name); } },
      addEventListener() {},
      setAttribute() {},
      removeAttribute() {},
      active() { return classes.has("is-active"); },
    };
  });
  const node = () => ({
    dataset: {},
    classList: { toggle() {} },
    addEventListener() {},
    setAttribute() {},
    textContent: "",
  });
  return {
    dataset: {},
    innerHTML: "",
    links,
    querySelector() { return node(); },
    querySelectorAll(selector) { return selector === "[data-shell-route]" ? links : []; },
  };
}

test("Detalhamento/Auditoria possui rota própria e item selecionável no menu lateral", () => {
  const router = createRouter(PORTAL_ROUTES, { window: { location: { hash: "#/audit" } } });
  assert.deepEqual(router.parse(), { name: "audit", params: {}, hash: "#/audit" });

  const root = shellRoot([...MODULES.map(module => module.id), "audit-details"]);
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", MODULES);
  const shell = renderAppShell(root, {
    account: { username: "admin@energeticabr.com", name: "Admin" },
    access,
    modules: MODULES,
    entities: [{ id: "auditorias", moduleId: "auditoria-compliance", available: true }],
    can,
    isSuperAdmin: true,
  });

  assert.match(root.innerHTML, /href="#\/audit"/);
  assert.match(root.innerHTML, /Detalhamento\/Auditoria/);
  shell.setActiveRoute({ name: "audit", params: {} });
  assert.equal(root.links.find(link => link.dataset.shellRoute === "audit-details").active(), true);
});
