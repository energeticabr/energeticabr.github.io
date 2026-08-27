import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import { createEntityPage, entityGalleryMarkup, getEntityActions, loadEntityData } from "../portal/ui/entity-page.js";
import { formMarkup, renderDynamicForm } from "../portal/ui/dynamic-form.js";
import { createItemDetailPage, itemDetailMarkup } from "../portal/ui/item-detail.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const adminCss = fs.readFileSync(path.join(projectRoot, "portal/styles/admin.css"), "utf8");

const entity = Object.freeze({
  id: "clientes",
  moduleId: "comercial",
  title: "Clientes",
  siteKey: "personal",
  listNames: Object.freeze(["CADASTRO CLIENTE"]),
  capabilities: Object.freeze({ view: true, create: true, edit: true, delete: false }),
  searchFields: Object.freeze(["Title", "STATUS"]),
  statusFields: Object.freeze(["STATUS"]),
  uppercaseFields: Object.freeze(["Title"]),
  messageFields: Object.freeze([]),
});

const approvableEntity = Object.freeze({
  ...entity,
  id: "homologacao-comercial",
  title: "Homologação comercial",
  capabilities: Object.freeze({ ...entity.capabilities, approve: true }),
});

const columns = Object.freeze([
  { name: "Title", displayName: "Nome", required: true, text: {} },
  { name: "STATUS", displayName: "Status", choice: { choices: ["ATIVO", "INATIVO"] } },
]);

test("as acoes exigem permissao de usuario e capacidade explicita da entidade", () => {
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  access.permissions.comercial.delete = true;
  assert.deepEqual(getEntityActions(entity, access, can), { create: true, edit: true, delete: false, approve: false });
  assert.deepEqual(getEntityActions(approvableEntity, access, can), { create: true, edit: true, delete: false, approve: true });
  access.permissions.comercial.edit = false;
  access.permissions.comercial.approve = false;
  assert.deepEqual(getEntityActions(approvableEntity, access, can), { create: true, edit: false, delete: false, approve: false });
});

test("a consulta da entidade descobre colunas e carrega somente o lote solicitado", async () => {
  const calls = [];
  const readyRepository = {
    async resolveList() { return { status: "resolved", id: "clientes-list" }; },
    async getColumns() { return columns.map(column => ({ ...column, indexed: true })); },
    async getItemsPage(...args) {
      calls.push(args);
      return {
        items: [
        { id: "2", fields: { Title: "BRUNO", STATUS: "INATIVO" } },
        { id: "1", fields: { Title: "ANA", STATUS: "ATIVO" } },
        ],
        nextLink: "https://graph.microsoft.com/v1.0/sites/personal/lists/clientes-list/items?$skiptoken=2",
        hasMore: true,
        batchCount: 2,
      };
    },
  };
  const ready = await loadEntityData(readyRepository, entity, { pageSize: 10, pageNumber: 1 });
  assert.equal(ready.state, "ready");
  assert.equal(ready.items.items.length, 2);
  assert.equal(ready.items.hasMore, true);
  assert.equal(ready.columns[0].name, "Title");
  assert.equal(calls.length, 1);
  assert.equal(new URLSearchParams(calls[0][2]).get("$top"), "10");

  const missing = await loadEntityData({ async resolveList() { return { status: "missing" }; } }, entity);
  assert.equal(missing.state, "missing");
});

test("a camada de galeria tambem recusa um lote maior que o solicitado", async () => {
  const data = await loadEntityData({
    async resolveList() { return { status: "resolved", id: "clientes-list" }; },
    async getColumns() { return columns.map(column => ({ ...column, indexed: true })); },
    async getItemsPage() {
      return { items: Array.from({ length: 21 }, (_, index) => ({ id: String(index + 1), fields: { Title: `CLIENTE ${index + 1}` } })), nextLink: "", hasMore: false };
    },
  }, { ...entity, searchFields: ["Title"] }, { pageSize: 20 });

  assert.equal(data.rawItems.length, 0);
  assert.equal(data.availability, "error");
  assert.match(data.error.message, /mais registros.*lote|lote.*recusado/i);
});

test("o formulario nasce fechado por quem o chama e usa controles acessiveis tipados", () => {
  const markup = formMarkup({ entity, columns, mode: "create", values: {} });
  assert.match(markup, /data-dynamic-form/);
  assert.match(markup, /<input[^>]+name="Title"[^>]+required/);
  assert.match(markup, /<select[^>]+name="STATUS"/);
  assert.match(markup, /Cancelar/);
  assert.doesNotMatch(markup, /data-form-delete/);
});

test("o cabecalho da tabela contem textos auxiliares sem ampliar a pagina", () => {
  assert.match(adminCss, /\.entity-table th\s*\{[^}]*position:\s*relative/i);
  assert.match(adminCss, /\.entity-table-wrap\s*\{[^}]*overflow-x:\s*auto/i);
});

test("campos de lookup e pessoa usam seletores nominais e ocultam o identificador interno", () => {
  const markup = formMarkup({
    entity,
    columns: [...columns, { name: "CLIENTE", displayName: "Cliente", required: true, lookup: { listId: "3f3da72d-4cbb-4d3c-96a6-90bcc9045e25", columnName: "Title" } }, { name: "RESPONSAVEL", displayName: "Responsável", personOrGroup: {} }],
    mode: "create",
    values: {},
  });
  assert.match(markup, /data-relation-search="CLIENTE"/);
  assert.match(markup, /data-relation-search="RESPONSAVEL"/);
  assert.match(markup, /type="hidden" name="CLIENTE"/);
  assert.match(markup, /type="hidden" name="RESPONSAVEL"/);
  assert.doesNotMatch(markup, /type="number" name="(?:CLIENTE|RESPONSAVEL)"/);
});

test("formulario mantem o valor e exibe a falha de gravacao quando precisa ser renderizado novamente", () => {
  const markup = formMarkup({ entity, columns, mode: "create", values: { Title: "ANA" }, error: "Falha ao gravar" });
  assert.match(markup, /value="ANA"/);
  assert.match(markup, /Falha ao gravar/);
  assert.doesNotMatch(markup, /data-form-errors[^>]+hidden/);
});

test("o detalhe mostra metadados, campos reais e reserva estavel para atividades futuras", () => {
  const markup = itemDetailMarkup({
    entity,
    item: { id: "7", createdDateTime: "2026-08-26T12:00:00Z", lastModifiedDateTime: "2026-08-26T13:00:00Z", fields: { Title: "ANA", STATUS: "ATIVO" } },
    columns,
    actions: { edit: true, delete: false },
  });
  assert.match(markup, /Registro #7/);
  assert.match(markup, /Atualizado/);
  assert.match(markup, /data-item-activity/);
  assert.match(markup, /data-item-edit/);
  assert.doesNotMatch(markup, /data-item-delete/);
  assert.doesNotMatch(markup, /data-item-approve/);
});

test("galeria e detalhe exibem aprovacao somente quando a acao esta autorizada", () => {
  const data = {
    columns: [{ name: "STATUS", label: "Status", control: "select", choices: ["PENDENTE", "APROVADO"], hidden: false }],
    rawItems: [{ id: "7", fields: { STATUS: "PENDENTE" } }],
    items: { items: [{ id: "7", fields: { STATUS: "PENDENTE" } }], total: 1, page: 1, pages: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1 },
  };
  const state = { search: "", page: 1, pageSize: 20, sort: { field: "Title", direction: "asc" }, filters: {}, message: "", error: "" };

  assert.match(entityGalleryMarkup(approvableEntity, data, state, { create: false, approve: true }), /data-entity-approve="7"/);
  assert.doesNotMatch(entityGalleryMarkup(approvableEntity, data, state, { create: false, approve: false }), /data-entity-approve/);
  assert.match(itemDetailMarkup({ entity: approvableEntity, item: data.rawItems[0], columns: data.columns, actions: { approve: true } }), /data-item-approve/);
  assert.doesNotMatch(itemDetailMarkup({ entity: approvableEntity, item: data.rawItems[0], columns: data.columns, actions: { approve: false } }), /data-item-approve/);
});

function createInteractiveRoot() {
  let markup = "";
  let controls = new Map();
  const control = (selector, dataset = {}) => {
    if (!controls.has(selector)) {
      const listeners = new Map();
      controls.set(selector, {
        dataset,
        value: "",
        addEventListener(name, listener) { listeners.set(name, listener); },
        removeEventListener(name) { listeners.delete(name); },
        trigger(name, value) { this.value = value ?? this.value; return listeners.get(name)?.({ target: this }); },
      });
    }
    return controls.get(selector);
  };
  return {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; controls = new Map(); },
    querySelector(selector) { return control(selector); },
    querySelectorAll(selector) {
      if (selector === "[data-entity-sort]") return [control("[data-entity-sort]", { entitySort: "Title" })];
      return [];
    },
    control,
  };
}

function createApprovalRoot() {
  let markup = "";
  let controls = new Map();
  const attachmentsRoot = {
    innerHTML: "",
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  const control = (selector, dataset = {}) => {
    const key = `${selector}:${JSON.stringify(dataset)}`;
    if (!controls.has(key)) {
      const listeners = new Map();
      controls.set(key, {
        dataset,
        value: "",
        addEventListener(name, listener) { listeners.set(name, listener); },
        removeEventListener(name) { listeners.delete(name); },
        trigger(name, value) {
          this.value = value ?? this.value;
          return listeners.get(name)?.({ target: this, currentTarget: this });
        },
      });
    }
    return controls.get(key);
  };
  const hasSelector = selector => markup.includes(selector.slice(1, -1).split("=")[0]);
  return {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; controls = new Map(); },
    querySelector(selector) {
      if (selector === "[data-item-attachments]") return hasSelector(selector) ? attachmentsRoot : null;
      return hasSelector(selector) ? control(selector) : null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-entity-approve]") {
        return [...markup.matchAll(/data-entity-approve="([^"]+)"/g)].map(match => control(selector, { entityApprove: match[1] }));
      }
      if (selector === "[data-entity-sort]" && hasSelector(selector)) return [control(selector, { entitySort: "Title" })];
      return [];
    },
  };
}

test("a galeria confirma e autoriza remotamente antes de refletir a aprovacao sem recarregar a lista", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const original = { id: "7", eTag: '"1,1"', fields: { Title: "ANA", STATUS: "PENDENTE" } };
  const approved = { ...original, eTag: '"2,1"', fields: { ...original.fields, STATUS: "APROVADO" } };
  const events = [];
  let itemLoads = 0;
  let resolveApproval;
  const approval = new Promise(resolve => { resolveApproval = resolve; });
  const page = createEntityPage(root, {
    entity: approvableEntity,
    access,
    can,
    confirmApprove(item) { events.push(`confirm:${item.id}`); return true; },
    repository: {
      async resolveList() { return { status: "resolved", id: "homologacao-list" }; },
      async getColumns() { return columns; },
      async getItemsPage() { itemLoads += 1; return { items: [original], nextLink: "", hasMore: false, batchCount: 1 }; },
      async approveItem(...args) { events.push("repository"); assert.deepEqual(args, ["personal", "homologacao-list", "7", { STATUS: "APROVADO" }, { eTag: '"1,1"' }]); return approval; },
    },
  });
  await page.ready;

  const submission = root.querySelectorAll("[data-entity-approve]")[0].trigger("click");
  await Promise.resolve();
  assert.deepEqual(events, ["confirm:7", "repository"]);
  assert.match(root.innerHTML, /PENDENTE/);
  assert.equal(itemLoads, 1);

  resolveApproval(approved);
  await submission;
  assert.match(root.innerHTML, /APROVADO/);
  assert.match(root.innerHTML, /Registro aprovado com sucesso/);
  assert.equal(itemLoads, 1, "aprovar nao deve recarregar toda a galeria");
  page.cleanup();
});

test("a aprovacao reaplica o filtro ativo e remove o registro que deixou de corresponder", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const original = { id: "7", eTag: '"1,1"', fields: { Title: "ANA", STATUS: "PENDENTE" } };
  const page = createEntityPage(root, {
    entity: approvableEntity,
    access,
    can,
    initialQuery: { filters: { STATUS: "PENDENTE" } },
    confirmApprove: () => true,
    repository: {
      async resolveList() { return { status: "resolved", id: "homologacao-list" }; },
      async getColumns() { return columns.map(column => ({ ...column, indexed: true })); },
      async getItemsPage() { return { items: [original], nextLink: "", hasMore: false, batchCount: 1 }; },
      async approveItem() { return { ...original, eTag: '"2,1"', fields: { ...original.fields, STATUS: "APROVADO" } }; },
    },
  });
  await page.ready;

  await root.querySelectorAll("[data-entity-approve]")[0].trigger("click");

  assert.doesNotMatch(root.innerHTML, /<td[^>]*>ANA<\/td>/);
  assert.match(root.innerHTML, /Nenhum registro corresponde aos filtros selecionados/);
  assert.match(root.innerHTML, /Registro aprovado com sucesso/);
  page.cleanup();
});

test("o detalhe exige confirmacao e aprova o item sem nova leitura", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const original = { id: "7", eTag: '"1,1"', createdDateTime: "2026-08-26T12:00:00Z", lastModifiedDateTime: "2026-08-26T13:00:00Z", fields: { Title: "ANA", STATUS: "PENDENTE" } };
  let itemLoads = 0;
  let approvals = 0;
  let confirmed = false;
  const page = createItemDetailPage(root, {
    entity: approvableEntity,
    itemId: "7",
    access,
    can,
    confirmApprove() { return confirmed; },
    repository: {
      async resolveList() { return { status: "resolved", id: "homologacao-list" }; },
      async getColumns() { return columns; },
      async getItem() { itemLoads += 1; return original; },
      async approveItem(...args) {
        approvals += 1;
        assert.deepEqual(args, ["personal", "homologacao-list", "7", { STATUS: "APROVADO" }, { eTag: '"1,1"' }]);
        return { ...original, eTag: '"2,1"', fields: { ...original.fields, STATUS: "APROVADO" } };
      },
    },
  });
  await page.ready;

  await root.querySelector("[data-item-approve]").trigger("click");
  assert.equal(approvals, 0, "cancelar a confirmacao impede a mutacao");
  confirmed = true;
  await root.querySelector("[data-item-approve]").trigger("click");
  assert.equal(approvals, 1);
  assert.equal(itemLoads, 1, "aprovar nao deve recarregar o detalhe");
  assert.match(root.innerHTML, /APROVADO/);
  assert.match(root.innerHTML, /Registro aprovado com sucesso/);
  page.cleanup();
});

test("busca, ordenacao e paginacao nao tentam mutar o resultado congelado da consulta", async () => {
  const root = createInteractiveRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const page = createEntityPage(root, {
    entity,
    access,
    can,
    repository: {
      async resolveList() { return { status: "resolved", id: "clientes-list" }; },
      async getColumns() { return columns; },
      async getItemsPage() { return { items: [{ id: "2", fields: { Title: "BRUNO", STATUS: "ATIVO" } }, { id: "1", fields: { Title: "ANA", STATUS: "ATIVO" } }], nextLink: "", hasMore: false, batchCount: 2 }; },
    },
  });
  await page.ready;
  assert.doesNotThrow(() => root.control("[data-entity-search]").trigger("input", "ANA"));
  assert.doesNotThrow(() => root.control("[data-entity-sort]").trigger("click"));
  assert.doesNotThrow(() => root.control("[data-entity-next]").trigger("click"));
  page.cleanup();
});

test("clicar no cabecalho refaz a consulta com orderby remoto e alterna a direcao", async () => {
  const root = createInteractiveRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const queries = [];
  const page = createEntityPage(root, {
    entity: { ...entity, searchFields: ["Title"], filterFields: [] },
    access,
    can,
    searchDebounceMs: 0,
    repository: {
      async resolveList() { return { status: "resolved", id: "clientes-list" }; },
      async getColumns() { return columns.map(column => ({ ...column, indexed: column.name === "Title" })); },
      async getItemsPage(_siteKey, _listId, query) {
        queries.push(query);
        return { items: [], nextLink: "", hasMore: false, batchCount: 0 };
      },
    },
  });
  await page.ready;

  await root.control("[data-entity-sort]").trigger("click");

  assert.equal(queries.length, 2);
  assert.equal(new URLSearchParams(queries[0]).get("$orderby"), "fields/Title asc");
  assert.equal(new URLSearchParams(queries[1]).get("$orderby"), "fields/Title desc");
  page.cleanup();
});

test("a tabela nao anuncia ordenacao quando a consulta filtrada nao suporta orderby remoto", () => {
  const filteredEntity = { ...entity, searchFields: ["Title"], filterFields: ["STATUS"] };
  const data = {
    columns: [
      { name: "Title", label: "Nome", control: "text", indexed: true, hidden: false },
      { name: "STATUS", label: "Status", control: "select", indexed: true, hidden: false, choices: ["ATIVO"] },
    ],
    rawItems: [],
    items: { items: [], totalKnown: false, page: 1, pageSize: 20, rangeStart: 0, rangeEnd: 0, batchCount: 0, loadedCount: 0, hasMore: false },
    query: { limitations: [], notices: [] },
  };
  const markup = entityGalleryMarkup(filteredEntity, data, {
    search: "",
    page: 1,
    pageSize: 20,
    sort: { field: "Title", direction: "asc" },
    filters: { STATUS: "ATIVO" },
    message: "",
    error: "",
  }, { create: false });

  assert.match(markup, /data-entity-sort="Title" disabled/);
  assert.doesNotMatch(markup, /aria-sort="ascending"/);
});

test("a galeria avanca pelo nextLink, conta o ultimo lote e volta pelo cache sem nova leitura", async () => {
  const root = createInteractiveRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const calls = [];
  const nextLink = "https://graph.microsoft.com/v1.0/sites/personal/lists/clientes-list/items?$skiptoken=2";
  const page = createEntityPage(root, {
    entity: { ...entity, searchFields: ["Title"] },
    access,
    can,
    repository: {
      async resolveList() { return { status: "resolved", id: "clientes-list" }; },
      async getColumns() { return columns.map(column => ({ ...column, indexed: true })); },
      async getItemsPage(_siteKey, _listId, _query, options) {
        calls.push(options);
        if (options.pageNumber === 1) return { items: [{ id: "1", fields: { Title: "ANA", STATUS: "ATIVO" } }], nextLink, hasMore: true, batchCount: 1 };
        return { items: [{ id: "2", fields: { Title: "BRUNO", STATUS: "ATIVO" } }], nextLink: "", hasMore: false, batchCount: 1 };
      },
    },
  });
  await page.ready;

  await root.control("[data-entity-next]").trigger("click");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].cursor, nextLink);
  assert.equal(calls[1].pageNumber, 2);
  assert.match(root.innerHTML, /Página 2/);
  assert.match(root.innerHTML, /Último lote: 1 registro/);
  assert.match(root.innerHTML, /fim da lista/i);

  await root.control("[data-entity-prev]").trigger("click");
  assert.equal(calls.length, 2, "a pagina anterior conhecida deve vir do cache incremental");
  assert.match(root.innerHTML, /Página 1/);
  page.cleanup();
});

test("uma nova busca cancela o lote anterior e a troca de rota cancela a leitura ativa", async () => {
  const root = createInteractiveRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  let callCount = 0;
  let searchAbort = false;
  let routeAbort = false;
  let markSearchStarted;
  let markRouteStarted;
  const searchStarted = new Promise(resolve => { markSearchStarted = resolve; });
  const routeStarted = new Promise(resolve => { markRouteStarted = resolve; });
  const page = createEntityPage(root, {
    entity: { ...entity, searchFields: ["Title"], filterFields: [] },
    access,
    can,
    searchDebounceMs: 0,
    repository: {
      async resolveList() { return { status: "resolved", id: "clientes-list" }; },
      async getColumns() { return columns.map(column => ({ ...column, indexed: true })); },
      async getItemsPage(_siteKey, _listId, _query, options) {
        callCount += 1;
        const currentCall = callCount;
        if (currentCall === 1) return { items: [], nextLink: "", hasMore: false, batchCount: 0 };
        if (currentCall === 2 || currentCall === 4) {
          if (currentCall === 2) markSearchStarted();
          else markRouteStarted();
          return new Promise((resolve, reject) => options.signal.addEventListener("abort", () => {
            if (currentCall === 2) searchAbort = true;
            else routeAbort = true;
            reject(new DOMException("cancelada", "AbortError"));
          }, { once: true }));
        }
        return { items: [{ id: "1", fields: { Title: "ANA" } }], nextLink: "", hasMore: false, batchCount: 1 };
      },
    },
  });
  await page.ready;

  const search = root.control("[data-entity-search]");
  const first = search.trigger("input", "A");
  await searchStarted;
  const second = search.trigger("input", "AN");
  await Promise.allSettled([first, second]);
  assert.equal(searchAbort, true);
  assert.match(root.innerHTML, /ANA/);

  const routePending = search.trigger("input", "ANA");
  await routeStarted;
  page.cleanup();
  await Promise.allSettled([routePending]);
  assert.equal(routeAbort, true);
});

test("consulta Graph multi-campo usa pesquisa estruturada sem varrer a lista", async () => {
  let regularCalls = 0;
  let searchCalls = 0;
  const multiEntity = { ...entity, searchFields: ["Title", "CLIENTE"] };
  const data = await loadEntityData({
    async resolveList() { return { status: "resolved", id: "clientes-list" }; },
    async getColumns() { return [...columns, { name: "CLIENTE", displayName: "Cliente", indexed: true, text: {} }].map(column => ({ ...column, indexed: true })); },
    async getItemsPage() { regularCalls += 1; throw new Error("nao deveria usar consulta generica"); },
    async searchItemsPage(_siteKey, _listId, search) {
      searchCalls += 1;
      assert.deepEqual(search.fields, ["Title", "CLIENTE"]);
      assert.equal(search.term, "ANA");
      return { items: [{ id: "1", fields: { Title: "ANA" } }], nextLink: "", hasMore: false };
    },
  }, multiEntity, { search: "ANA" });

  assert.equal(data.state, "ready");
  assert.equal(data.query.blocked, false);
  assert.equal(regularCalls, 0);
  assert.equal(searchCalls, 1);
  assert.equal(data.rawItems[0].fields.Title, "ANA");
});

test("a galeria oferece filtros independentes, tamanho da pagina e navegacao completa", () => {
  const data = {
    columns: [
      { name: "Title", label: "Nome", control: "text", hidden: false },
      { name: "STATUS", label: "Status", control: "select", choices: ["ATIVO", "INATIVO"], hidden: false },
    ],
    rawItems: [
      { id: "1", fields: { Title: "ANA", STATUS: "ATIVO" } },
      { id: "2", fields: { Title: "BRUNO", STATUS: "INATIVO" } },
    ],
    items: { items: [{ id: "1", fields: { Title: "ANA", STATUS: "ATIVO" } }], totalKnown: false, page: 1, pageSize: 1, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: true, isLastBatch: false },
  };
  const markup = entityGalleryMarkup(entity, data, {
    search: "",
    page: 1,
    pageSize: 1,
    sort: { field: "Title", direction: "asc" },
    filters: { STATUS: "" },
    message: "",
    error: "",
  }, { create: true });

  assert.match(markup, /data-entity-filter="STATUS"/);
  assert.match(markup, /data-entity-page-size/);
  assert.match(markup, /data-entity-first/);
  assert.match(markup, /data-entity-last/);
  assert.match(markup, /Último lote: 1 registro/);
  assert.match(markup, /há mais resultados/);
  assert.doesNotMatch(markup, /de 2/);
});

test("o centesimo lote informa o limite seguro e nao oferece uma leitura adicional", () => {
  const data = {
    columns: [{ name: "Title", label: "Nome", control: "text", hidden: false }],
    rawItems: [{ id: "100", fields: { Title: "ULTIMO LOTE SEGURO" } }],
    items: { items: [{ id: "100", fields: { Title: "ULTIMO LOTE SEGURO" } }], totalKnown: false, page: 100, pageSize: 20, rangeStart: 1981, rangeEnd: 1981, batchCount: 1, loadedCount: 1981, hasMore: true, isLastBatch: false },
    query: { limitations: [] },
  };
  const markup = entityGalleryMarkup(entity, data, {
    search: "",
    page: 100,
    pageSize: 20,
    sort: { field: "Title", direction: "asc" },
    filters: {},
    message: "",
    error: "",
  }, { create: false });

  assert.match(markup, /limite seguro de 100 páginas/i);
  assert.match(markup, /data-entity-next disabled/);
});

test("o vazio filtrado permite limpar filtros sem expor formulario", () => {
  const data = {
    columns: [{ name: "Title", label: "Nome", control: "text", hidden: false }],
    rawItems: [{ id: "1", fields: { Title: "ANA" } }],
    items: { items: [], total: 0, page: 1, pages: 1, pageSize: 20, rangeStart: 0, rangeEnd: 0 },
  };
  const markup = entityGalleryMarkup(entity, data, {
    search: "ZZZ",
    page: 1,
    pageSize: 20,
    sort: { field: "Title", direction: "asc" },
    filters: {},
    message: "",
    error: "",
  }, { create: true });

  assert.match(markup, /Nenhum registro corresponde/);
  assert.match(markup, /data-entity-clear-filters/);
  assert.doesNotMatch(markup, /data-dynamic-form/);
});

test("um lote posterior vazio nao afirma que a lista inteira esta vazia", () => {
  const data = {
    columns: [{ name: "Title", label: "Nome", control: "text", hidden: false }],
    rawItems: [],
    items: { items: [], totalKnown: false, page: 2, pageSize: 20, rangeStart: 0, rangeEnd: 0, batchCount: 0, loadedCount: 20, hasMore: false, hasPrevious: true },
    query: { limitations: [], notices: [] },
  };
  const markup = entityGalleryMarkup(entity, data, {
    search: "",
    page: 2,
    pageSize: 20,
    sort: { field: "Title", direction: "asc" },
    filters: {},
    message: "",
    error: "",
  }, { create: false });

  assert.match(markup, /não há itens neste lote/i);
  assert.match(markup, /data-entity-prev(?![^>]*disabled)/);
  assert.doesNotMatch(markup, /Nenhum registro foi cadastrado nesta lista/);
});

test("o formulario sinaliza salvamento e bloqueia novo envio enquanto aguarda", () => {
  const markup = formMarkup({ entity, columns, mode: "edit", values: { Title: "ANA" }, submitting: true });
  assert.match(markup, /aria-busy="true"/);
  assert.match(markup, /data-form-cancel[^>]+disabled/);
  assert.match(markup, /name="Title"[^>]+disabled/);
  assert.match(markup, /name="STATUS"[^>]+disabled/);
  assert.match(markup, /data-form-save[^>]+disabled/);
  assert.match(markup, /Salvando/);
});

function createDynamicFormRoot() {
  const listeners = new Map();
  const attributes = new Map();
  const title = { name: "Title", value: "ANA", disabled: false };
  const status = { name: "STATUS", value: "ATIVO", disabled: true };
  const cancel = {
    disabled: false,
    addEventListener(name, listener) { listeners.set(`cancel:${name}`, listener); },
    removeEventListener(name) { listeners.delete(`cancel:${name}`); },
  };
  const save = { disabled: false, textContent: "Salvar alterações" };
  const errors = { textContent: "", hidden: true };
  const controls = [title, status, cancel, save];
  const form = {
    elements: {
      namedItem(name) { return controls.find(control => control.name === name) || null; },
      [Symbol.iterator]() { return controls[Symbol.iterator](); },
    },
    reportValidity() { return true; },
    setAttribute(name, value) { attributes.set(name, value); },
    addEventListener(name, listener) { listeners.set(`form:${name}`, listener); },
    removeEventListener(name) { listeners.delete(`form:${name}`); },
  };
  const root = {
    innerHTML: "",
    querySelector(selector) {
      return ({
        "[data-dynamic-form]": form,
        "[data-form-save]": save,
        "[data-form-cancel]": cancel,
        "[data-form-errors]": errors,
      })[selector] || null;
    },
  };
  return {
    root,
    controls,
    attributes,
    submit() { return listeners.get("form:submit")?.({ preventDefault() {} }); },
    cancel() { return listeners.get("cancel:click")?.(); },
  };
}

test("durante o salvamento bloqueia campos e cancelamento e restaura seus estados depois da falha", async () => {
  const fixture = createDynamicFormRoot();
  let rejectSave;
  let cancellations = 0;
  const pendingSave = new Promise((resolve, reject) => { rejectSave = reject; });
  const controller = renderDynamicForm(fixture.root, {
    entity,
    columns,
    mode: "edit",
    onCancel() { cancellations += 1; },
    onSubmit() { return pendingSave; },
  });

  const submission = fixture.submit();
  assert.equal(fixture.attributes.get("aria-busy"), "true");
  assert.equal(fixture.controls.every(control => control.disabled), true);
  fixture.cancel();
  assert.equal(cancellations, 0, "cancelamento programatico tambem deve ser ignorado durante o envio");

  rejectSave(new Error("Falha ao salvar"));
  await assert.rejects(submission, /Falha ao salvar/);
  assert.equal(fixture.attributes.get("aria-busy"), "false");
  assert.equal(fixture.controls[0].disabled, false);
  assert.equal(fixture.controls[1].disabled, true, "controle previamente desabilitado deve continuar desabilitado");
  assert.equal(fixture.controls[2].disabled, false);
  assert.equal(fixture.controls[3].disabled, false);
  controller.cleanup();
});

test("uma falha de carregamento da galeria oferece tentativa direta sem abrir formulario", async () => {
  const root = createInteractiveRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const page = createEntityPage(root, {
    entity,
    access,
    can,
    repository: { async resolveList() { throw new Error("Falha de rede"); } },
  });
  await page.ready;
  assert.match(root.innerHTML, /data-entity-retry/);
  assert.match(root.innerHTML, /Tentar novamente/);
  assert.doesNotMatch(root.innerHTML, /data-dynamic-form/);
  page.cleanup();
});

test("uma falha de carregamento do detalhe preserva a volta e oferece nova tentativa", async () => {
  const root = createInteractiveRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const page = createItemDetailPage(root, {
    entity,
    itemId: "7",
    access,
    can,
    repository: { async resolveList() { throw new Error("Falha de rede"); } },
  });
  await page.ready;
  assert.match(root.innerHTML, /data-item-retry/);
  assert.match(root.innerHTML, /Voltar à lista/);
  assert.equal(typeof page.refresh, "function");
  page.cleanup();
});
