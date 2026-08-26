import assert from "node:assert/strict";
import test from "node:test";
import portalConfig from "../portal/config.js";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import { createPageLifecycle } from "../portal/core/page-lifecycle.js";
import { renderDashboard } from "../portal/ui/dashboard-page.js";
import { createAccessPage } from "../portal/ui/access-page.js";
import { createEntityPage } from "../portal/ui/entity-page.js";
import { createItemDetailPage } from "../portal/ui/item-detail.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function createRoot() {
  return {
    innerHTML: "",
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
}

const module = Object.freeze({ id: "suprimentos", title: "Suprimentos" });
const entity = Object.freeze({ id: "lancamentos", moduleId: "suprimentos", title: "Lançamentos", siteKey: "personal", listNames: Object.freeze(["LANCAMENTOS"]) });

test("o dashboard descartado nao sobrescreve a pagina nova quando sua consulta termina", async () => {
  const root = createRoot();
  const pendingList = deferred();
  const access = buildSuperAdminAccess(portalConfig.superAdminEmail, "Bernardo", [module]);
  const dashboard = renderDashboard(root, {
    access,
    modules: [module],
    entities: [entity],
    can,
    repository: {
      resolveList: () => pendingList.promise,
      async getItems() { return []; },
    },
  });
  const pages = createPageLifecycle();
  pages.activate(dashboard);
  pages.replace(() => {
    root.innerHTML = "NOVA_ROTA_MODULO";
    return undefined;
  });

  pendingList.resolve({ status: "resolved", id: "lancamentos" });
  await dashboard.ready;

  assert.equal(root.innerHTML, "NOVA_ROTA_MODULO");
});

test("a pagina de acessos descartada nao recria a ferramenta quando sua consulta termina", async () => {
  const root = createRoot();
  const pendingUsers = deferred();
  const page = createAccessPage(root, {
    repository: {
      listUsers: () => pendingUsers.promise,
      async getAccessListSecurity() { return { status: "secure" }; },
    },
    modules: [module],
    actorEmail: portalConfig.superAdminEmail,
    config: portalConfig,
  });
  assert.equal(typeof page.cleanup, "function");
  assert.ok(page.ready instanceof Promise);
  const pages = createPageLifecycle();
  pages.activate(page);
  pages.replace(() => {
    root.innerHTML = "NOVA_ROTA_DASHBOARD";
    return undefined;
  });

  pendingUsers.resolve([]);
  await page.ready;

  assert.equal(root.innerHTML, "NOVA_ROTA_DASHBOARD");
});

test("uma falha tardia da pagina de acessos descartada tambem nao altera a rota nova", async () => {
  const root = createRoot();
  const pendingUsers = deferred();
  const page = createAccessPage(root, {
    repository: { listUsers: () => pendingUsers.promise },
    modules: [module],
    actorEmail: portalConfig.superAdminEmail,
    config: portalConfig,
  });
  const pages = createPageLifecycle();
  pages.activate(page);
  pages.replace(() => {
    root.innerHTML = "NOVA_ROTA_ERRO";
    return undefined;
  });

  pendingUsers.reject(new Error("Falha tardia"));
  await page.ready;

  assert.equal(root.innerHTML, "NOVA_ROTA_ERRO");
});

test("uma galeria descartada nao renderiza dados atrasados sobre a nova rota", async () => {
  const root = createRoot();
  const pendingList = deferred();
  const access = buildSuperAdminAccess(portalConfig.superAdminEmail, "Bernardo", [module]);
  const page = createEntityPage(root, {
    entity: { ...entity, capabilities: { view: true, create: false, edit: false, delete: false }, searchFields: ["Title"], statusFields: [], uppercaseFields: [], messageFields: [] },
    access,
    can,
    repository: {
      resolveList: () => pendingList.promise,
      async getColumns() { return []; },
      async getItems() { return []; },
    },
  });
  const pages = createPageLifecycle();
  pages.activate(page);
  pages.replace(() => {
    root.innerHTML = "NOVA_ROTA_GALERIA";
    return undefined;
  });

  pendingList.resolve({ status: "resolved", id: "lancamentos" });
  await page.ready;

  assert.equal(root.innerHTML, "NOVA_ROTA_GALERIA");
});

test("um detalhe descartado ignora a ausencia ou resposta tardia da lista", async () => {
  const root = createRoot();
  const pendingList = deferred();
  const access = buildSuperAdminAccess(portalConfig.superAdminEmail, "Bernardo", [module]);
  const page = createItemDetailPage(root, {
    entity: { ...entity, capabilities: { view: true, create: false, edit: false, delete: false }, searchFields: ["Title"], statusFields: [], uppercaseFields: [], messageFields: [] },
    itemId: "1",
    access,
    can,
    repository: { resolveList: () => pendingList.promise },
  });
  const pages = createPageLifecycle();
  pages.activate(page);
  pages.replace(() => {
    root.innerHTML = "NOVA_ROTA_DETALHE";
    return undefined;
  });

  pendingList.reject(new Error("Falha tardia"));
  await page.ready;

  assert.equal(root.innerHTML, "NOVA_ROTA_DETALHE");
});
