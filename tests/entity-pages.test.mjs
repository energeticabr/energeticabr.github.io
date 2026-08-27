import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import { ENTITIES } from "../portal/catalog/entities.js";
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

test("uma mutacao comprovada no Power Apps continua limitada pela permissao do modulo", () => {
  const supplier = ENTITIES.find(candidate => candidate.id === "fornecedores");
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "suprimentos" }]);
  access.permissions.suprimentos.create = false;
  access.permissions.suprimentos.approve = true;

  assert.deepEqual(
    getEntityActions(supplier, access, can),
    { create: false, edit: true, delete: true, approve: false },
  );
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

test("a galeria aplica a ordem inicial comprovada no Power Apps mesmo quando ela usa o ID do item", async () => {
  const requests = [];
  const groupEntity = ENTITIES.find(candidate => candidate.id === "cadastro-de-grupos");
  const data = await loadEntityData({
    async resolveList() { return { status: "resolved", id: "grupos-list" }; },
    async getColumns() { return [{ name: "Title", displayName: "Grupo", text: {}, indexed: true }]; },
    async getItemsPage(_siteKey, _listId, query) {
      requests.push(query);
      return { items: [], nextLink: "", hasMore: false, batchCount: 0 };
    },
  }, groupEntity, { pageSize: 20 });

  assert.equal(data.state, "ready");
  assert.equal(new URLSearchParams(requests[0]).get("$orderby"), "fields/ID desc");
});

test("as galerias apresentam cada registro em uma faixa compacta, no padrão visual do Power Apps", () => {
  assert.match(adminCss, /\.entity-gallery-panel \.entity-table thead\s*\{\s*display:\s*none/i);
  assert.match(adminCss, /\.entity-gallery-panel \.entity-table tbody tr\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(112px, 1fr\)\)/i);
  assert.match(adminCss, /\.entity-gallery-panel \.entity-table td::before\s*\{[\s\S]*?content:\s*attr\(data-label\)/i);
  assert.match(adminCss, /\.gallery-metric-clusters\s*\{[\s\S]*?grid-template-columns:\s*repeat\(auto-fit, minmax\(150px, 1fr\)\)/i);
});

test("toda galeria oferece escolha de campo e direção de ordenação", () => {
  const data = {
    columns: [
      { name: "Title", label: "Nome", control: "text", indexed: true, hidden: false },
      { name: "STATUS", label: "Status", control: "select", indexed: true, hidden: false, choices: ["ATIVO"] },
    ],
    rawItems: [],
    items: { items: [], totalKnown: false, page: 1, pageSize: 20, rangeStart: 0, rangeEnd: 0, batchCount: 0, loadedCount: 0, hasMore: false },
    query: { limitations: [], notices: [] },
    uiContract: {
      hasForm: true,
      readOnly: false,
      formColumns: [],
      galleryColumns: [{ name: "Title", label: "Nome", control: "text", indexed: true, hidden: false }, { name: "STATUS", label: "Status", control: "select", indexed: true, hidden: false }],
      filterFields: [],
      searchFields: ["Title"],
      gallerySort: { field: "ID", direction: "desc" },
      multiple: false,
    },
  };
  const markup = entityGalleryMarkup(entity, data, {
    search: "", page: 1, pageSize: 20, sort: { field: "ID", direction: "desc" }, filters: {}, message: "", error: "", gallerySortOverride: false,
  }, { create: false });

  assert.match(markup, /data-entity-sort-field/);
  assert.match(markup, /data-entity-sort-direction/);
  assert.match(markup, /Ordem padrão do Power Apps/);
  assert.match(markup, /value="Title">Nome/);
  assert.match(markup, /title="Usar ordem crescente"/);
});

test("os comandos Galeria e Lancamento conservam identidade e largura no celular", () => {
  assert.match(adminCss, /\.entity-view-switch\s*\{[^}]*display:\s*(?:grid|inline-grid)/i);
  assert.match(adminCss, /\.entity-view-command\[aria-pressed="true"\]\s*\{[^}]*background:/i);
  assert.match(adminCss, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.entity-view-switch\s*\{[^}]*width:\s*100%/i);
  assert.match(adminCss, /@media\s*\(max-width:\s*760px\)[\s\S]*?\.entity-view-command\s*\{[^}]*width:\s*100%/i);
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

test("cada item oferece detalhe acessivel e mantem Editar como acao principal", () => {
  const routableEntity = { ...entity, id: "clientes especiais" };
  const item = { id: "7/8", fields: { Title: "ANA", STATUS: "ATIVO" } };
  const data = {
    columns: [
      { name: "Title", label: "Nome", control: "text", indexed: true, hidden: false },
      { name: "STATUS", label: "Status", control: "select", indexed: true, hidden: false, choices: ["ATIVO"] },
    ],
    rawItems: [item],
    items: { items: [item], totalKnown: false, page: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: false },
    query: { limitations: [], notices: [] },
    uiContract: {
      hasForm: true,
      readOnly: false,
      formColumns: [],
      galleryColumns: [
        { name: "Title", label: "Nome", control: "text", indexed: true, hidden: false },
        { name: "STATUS", label: "Status", control: "select", indexed: true, hidden: false, choices: ["ATIVO"] },
      ],
      filterFields: ["STATUS"],
      searchFields: ["Title"],
      multiple: false,
    },
  };
  const state = { search: "", page: 1, pageSize: 20, sort: { field: "Title", direction: "asc" }, filters: {}, message: "", error: "" };

  const editable = entityGalleryMarkup(routableEntity, data, state, { create: false, edit: true, delete: true, approve: false });
  assert.match(editable, /<button class="button-primary" type="button" data-entity-edit="7\/8" aria-label="Editar registro #7\/8">Editar<\/button>/);
  assert.match(editable, /<a class="button-secondary" href="#\/entity\/clientes%20especiais\/item\/7%2F8" aria-label="Abrir detalhes do registro #7\/8">Abrir detalhes<\/a>/);
  assert.doesNotMatch(editable, /data-entity-delete/);

  const viewOnly = entityGalleryMarkup(routableEntity, data, state, { create: false, edit: false, delete: false, approve: false });
  assert.match(viewOnly, /href="#\/entity\/clientes%20especiais\/item\/7%2F8"/);
  assert.doesNotMatch(viewOnly, /data-entity-edit/);
});

test("a galeria inicial ocupa o workspace sem montar formulario", () => {
  const item = { id: "7", fields: { Title: "ANA", STATUS: "ATIVO" } };
  const data = {
    columns: [
      { name: "Title", label: "Nome", control: "text", hidden: false },
      { name: "STATUS", label: "Status", control: "select", choices: ["ATIVO"], hidden: false },
    ],
    rawItems: [item],
    items: { items: [item], totalKnown: false, page: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: false },
    query: { limitations: [], notices: [] },
    uiContract: {
      hasForm: true,
      readOnly: false,
      formColumns: [{ name: "Title", label: "Nome", control: "text", hidden: false, editable: true }],
      galleryColumns: [{ name: "Title", label: "Nome", control: "text", hidden: false }],
      filterFields: ["STATUS"],
      searchFields: ["Title"],
      multiple: false,
    },
  };
  const markup = entityGalleryMarkup(entity, data, {
    search: "ANA",
    page: 1,
    pageSize: 20,
    sort: { field: "Title", direction: "asc" },
    filters: { STATUS: "ATIVO" },
    message: "",
    error: "",
    formOpen: false,
  }, { create: true, edit: true, delete: false, approve: false });

  assert.match(markup, /data-entity-gallery/);
  assert.match(markup, /data-entity-search value="ANA"/);
  assert.match(markup, /data-entity-filter="STATUS"[^>]*>[\s\S]*?<option value="ATIVO" selected>/);
  assert.match(markup, /data-gallery-metrics/);
  assert.match(markup, /data-gallery-metric="records"[\s\S]*?REGISTROS EXIBIDOS[\s\S]*?<strong>1<\/strong>/);
  assert.match(markup, /data-gallery-metric="attachments"[\s\S]*?COM ANEXOS[\s\S]*?<strong>0<\/strong>/);
  assert.doesNotMatch(markup, /data-entity-form-panel/);
  assert.doesNotMatch(markup, /data-entity-form/);
  assert.doesNotMatch(markup, /data-multi-entry-host/);
});

test("entidade sem Form ou readOnly nunca expoe cadastro nem edicao", () => {
  const item = { id: "7", fields: { Title: "ANA" } };
  const titleColumn = { name: "Title", label: "Nome", control: "text", hidden: false };
  const data = {
    columns: [titleColumn],
    rawItems: [item],
    items: { items: [item], totalKnown: false, page: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: false },
    query: { limitations: [], notices: [] },
    uiContract: {
      hasForm: false,
      readOnly: true,
      formColumns: [],
      galleryColumns: [titleColumn],
      filterFields: [],
      searchFields: ["Title"],
      multiple: true,
    },
  };
  const markup = entityGalleryMarkup(entity, data, {
    search: "",
    page: 1,
    pageSize: 20,
    sort: { field: "Title", direction: "asc" },
    filters: {},
    message: "",
    error: "",
    formOpen: true,
  }, { create: true, edit: true, delete: false, approve: false });

  assert.match(markup, /Abrir detalhes/);
  assert.match(markup, /data-entity-gallery-view/);
  assert.match(markup, />Galeria</);
  assert.doesNotMatch(markup, />Lan(?:c|ç)amento</i);
  assert.doesNotMatch(markup, /data-entity-create/);
  assert.doesNotMatch(markup, /data-entity-edit/);
  assert.doesNotMatch(markup, /data-entity-form-panel/);
  assert.doesNotMatch(markup, /data-multi-entry-host/);
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
      if (selector === "[data-entity-sort-field]") return [control("[data-entity-sort-field]")];
      if (selector === "[data-entity-sort-direction]") return [control("[data-entity-sort-direction]")];
      return [];
    },
    control,
  };
}

function createApprovalRoot(options = {}) {
  let markup = "";
  let formMarkup = "";
  let queueMarkup = "";
  let dynamicFormControls;
  let queueControls;
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
        classList: { toggle() {} },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        removeAttribute() {},
        setAttribute() {},
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
  const formControl = () => {
    const listeners = new Map();
    return {
      disabled: false,
      addEventListener(name, listener) { listeners.set(name, listener); },
      removeEventListener(name) { listeners.delete(name); },
      trigger(name) {
        const listener = listeners.get(name);
        if (!listener) throw new Error(`Evento ${name} não conectado no controle de teste.`);
        return listener({ preventDefault() {}, target: this, currentTarget: this });
      },
    };
  };
  const formHost = {
    get innerHTML() { return formMarkup; },
    set innerHTML(value) {
      formMarkup = value;
      const fields = new Map([...value.matchAll(/<(?:input|select|textarea)\b[^>]*name="([^"]+)"[^>]*>/g)].map(match => {
        const valueMatch = match[0].match(/\bvalue="([^"]*)"/);
        return [match[1], { name: match[1], value: valueMatch?.[1] || "", disabled: false }];
      }));
      const form = {
        ...formControl(),
        elements: {
          namedItem(name) { return fields.get(name) || null; },
          *[Symbol.iterator]() { yield* fields.values(); },
        },
        reportValidity() { return true; },
        setAttribute() {},
        querySelectorAll() { return []; },
      };
      dynamicFormControls = {
        form,
        fields,
        cancel: formControl(),
        save: { ...formControl(), textContent: "" },
        errors: { textContent: "", hidden: true },
      };
    },
    querySelector(selector) {
      return ({
        "[data-dynamic-form]": dynamicFormControls?.form,
        "[data-form-save]": dynamicFormControls?.save,
        "[data-form-cancel]": dynamicFormControls?.cancel,
        "[data-form-errors]": dynamicFormControls?.errors,
      })[selector] || null;
    },
    querySelectorAll() { return []; },
  };
  const queueHost = {
    get innerHTML() { return queueMarkup; },
    set innerHTML(value) {
      queueMarkup = value;
      queueControls = value.includes("data-multi-entry-submit")
        ? { submit: queueControls?.submit || formControl() }
        : undefined;
    },
    querySelector(selector) { return selector === "[data-multi-entry-submit]" ? queueControls?.submit || null : null; },
    querySelectorAll() { return []; },
  };
  const root = {
    get innerHTML() { return markup; },
    set innerHTML(value) {
      markup = value;
      formMarkup = "";
      queueMarkup = "";
      dynamicFormControls = undefined;
      queueControls = undefined;
      controls = new Map();
    },
    get formMarkup() { return formMarkup; },
    get queueMarkup() { return queueMarkup; },
    get resultsMarkup() { return this.querySelector("[data-entity-results]")?.innerHTML || ""; },
    cancelForm() { return dynamicFormControls?.cancel.trigger("click"); },
    submitForm(title) { return this.submitFormValues({ Title: title }); },
    submitFormValues(values) {
      Object.entries(values).forEach(([name, value]) => {
        const field = dynamicFormControls?.fields.get(name);
        if (field) field.value = value;
        else if (dynamicFormControls?.fields) dynamicFormControls.fields.set(name, { name, value, disabled: false });
      });
      return dynamicFormControls?.form.trigger("submit");
    },
    submitQueue() { return queueHost.querySelector("[data-multi-entry-submit]")?.trigger("click"); },
    querySelector(selector) {
      if (selector === ".entity-page") return markup.includes("entity-page") ? control(selector) : null;
      if (selector === "[data-item-attachments]") return hasSelector(selector) ? attachmentsRoot : null;
      if (selector === "[data-item-form]") return hasSelector(selector) ? formHost : null;
      if (selector === "[data-entity-form]") return hasSelector(selector) ? formHost : null;
      if (selector === "[data-multi-entry-host]") return hasSelector(selector) ? queueHost : null;
      return hasSelector(selector) ? control(selector) : null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-entity-edit]") {
        return [...markup.matchAll(/data-entity-edit="([^"]+)"/g)].map(match => control(selector, { entityEdit: match[1] }));
      }
      if (selector === "[data-entity-approve]") {
        return [...markup.matchAll(/data-entity-approve="([^"]+)"/g)].map(match => control(selector, { entityApprove: match[1] }));
      }
      if (selector === "[data-entity-sort]" && hasSelector(selector)) return [control(selector, { entitySort: "Title" })];
      if (selector === "[data-entity-sort-field]" && hasSelector(selector)) return [control(selector)];
      if (selector === "[data-entity-sort-direction]" && hasSelector(selector)) return [control(selector)];
      return [];
    },
  };
  if (options.stableGallery) root.ownerDocument = { createElement() { return {}; } };
  return root;
}

test("a pagina de entidade nasce com a galeria aberta e o formulario fechado", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const page = createEntityPage(root, {
    entity,
    access,
    can,
    initialQuery: { search: "ANA", filters: { STATUS: "ATIVO" } },
    galleryCatalog: { galleries: [] },
    repository: {
      async resolveList() { return { status: "resolved", id: "clientes-list" }; },
      async getColumns() { return columns.map(column => ({ ...column, indexed: true })); },
      async getItemsPage() { return { items: [{ id: "7", fields: { Title: "ANA", STATUS: "ATIVO" } }], nextLink: "", hasMore: false, batchCount: 1 }; },
    },
  });

  await page.ready;

  assert.match(root.innerHTML, /data-entity-gallery/);
  assert.match(root.innerHTML, /data-entity-gallery-view[^>]+aria-pressed="true"/);
  assert.match(root.innerHTML, /data-entity-create[^>]+aria-pressed="false"/);
  assert.match(root.innerHTML, />Galeria</);
  assert.match(root.innerHTML, />Lan(?:c|ç)amento</i);
  assert.match(root.innerHTML, /data-entity-search value="ANA"/);
  assert.match(root.innerHTML, /data-entity-filter="STATUS"[^>]*>[\s\S]*?<option value="ATIVO" selected>/);
  assert.doesNotMatch(root.innerHTML, /data-entity-form-panel/);
  assert.doesNotMatch(root.innerHTML, /data-dynamic-form/);
  page.cleanup();
});

test("Lancamento mostra somente o formulario e alternar preserva a consulta", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  let loads = 0;
  const page = createEntityPage(root, {
    entity,
    access,
    can,
    initialQuery: { search: "ANA", filters: { STATUS: "ATIVO" } },
    galleryCatalog: { galleries: [] },
    repository: {
      async resolveList() { return { status: "resolved", id: "clientes-list" }; },
      async getColumns() { return columns.map(column => ({ ...column, indexed: true })); },
      async getItemsPage() {
        loads += 1;
        return { items: [{ id: "7", fields: { Title: "ANA", STATUS: "ATIVO" } }], nextLink: "", hasMore: false, batchCount: 1 };
      },
    },
  });
  await page.ready;
  const loadsBeforeModeSwitch = loads;

  root.querySelector("[data-entity-create]").trigger("click");

  assert.match(root.innerHTML, /data-entity-form-panel/);
  assert.match(root.innerHTML, /data-entity-form/);
  assert.doesNotMatch(root.innerHTML, /<section class="entity-gallery-panel" data-entity-gallery>/);
  assert.match(root.innerHTML, /data-entity-gallery-view[^>]+aria-pressed="false"/);
  assert.match(root.innerHTML, /data-entity-create[^>]+aria-pressed="true"/);

  root.querySelector("[data-entity-gallery-view]").trigger("click");

  assert.doesNotMatch(root.innerHTML, /data-entity-form-panel/);
  assert.match(root.innerHTML, /data-entity-gallery-view[^>]+aria-pressed="true"/);
  assert.match(root.innerHTML, /data-entity-create[^>]+aria-pressed="false"/);
  assert.match(root.innerHTML, /data-entity-search value="ANA"/);
  assert.match(root.innerHTML, /data-entity-filter="STATUS"[^>]*>[\s\S]*?<option value="ATIVO" selected>/);
  assert.equal(loads, loadsBeforeModeSwitch);
  page.cleanup();
});

test("Lancamento abre diretamente o Form padrão sem misturar a galeria", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "suprimentos" }]);
  const productEntity = ENTITIES.find(candidate => candidate.id === "produtos");
  const rawColumns = [
    "Title",
    "field_1",
    "TIPODESPESA",
    "UNIDADE",
    "SATUS",
    "TIPO",
    "GERADESEMBOLSO",
  ].map(name => ({ name, displayName: name, indexed: true, text: {} }));
  const page = createEntityPage(root, {
    entity: productEntity,
    access,
    can,
    repository: {
      async resolveList() { return { status: "resolved", id: "produtos-list" }; },
      async getColumns() { return rawColumns; },
      async getItemsPage() { return { items: [], nextLink: "", hasMore: false, batchCount: 0 }; },
    },
  });
  await page.ready;

  root.querySelector("[data-entity-create]").trigger("click");

  assert.doesNotMatch(root.innerHTML, /data-entity-form-variant/);
  assert.doesNotMatch(root.innerHTML, /data-entity-gallery>/);
  assert.match(root.formMarkup, /name="TIPODESPESA"/);
  assert.match(root.formMarkup, /name="UNIDADE"/);
  page.cleanup();
});

test("rota new abre inicialmente o painel de Lancamento", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "suprimentos" }]);
  const cityEntity = ENTITIES.find(candidate => candidate.id === "cidades");
  const page = createEntityPage(root, {
    entity: cityEntity,
    access,
    can,
    initialFormOpen: true,
    repository: {
      async resolveList() { return { status: "resolved", id: "cidades-list" }; },
      async getColumns() { return [{ name: "Title", displayName: "Cidade", indexed: true, text: {} }]; },
      async getItemsPage() { return { items: [], nextLink: "", hasMore: false, batchCount: 0 }; },
    },
  });
  await page.ready;

  assert.match(root.innerHTML, /data-entity-form-panel/);
  assert.match(root.innerHTML, /data-entity-create[^>]+aria-pressed="true"/);
  assert.match(root.formMarkup, /Novo registro/);
  page.cleanup();
});

test("Editar abre somente o formulario com os valores atuais", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const editableEntity = { ...entity, id: "cidades", title: "Cidades", searchFields: ["Title"], statusFields: [] };
  const page = createEntityPage(root, {
    entity: editableEntity,
    access,
    can,
    galleryCatalog: { galleries: [] },
    initialQuery: { search: "SAO" },
    repository: {
      async resolveList() { return { status: "resolved", id: "cidades-list" }; },
      async getColumns() { return [{ name: "Title", displayName: "Nome", indexed: true, text: {} }]; },
      async getItemsPage() { return { items: [{ id: "7", eTag: '"1,1"', fields: { Title: "SAO PAULO" } }], nextLink: "", hasMore: false, batchCount: 1 }; },
    },
  });
  await page.ready;

  root.querySelectorAll("[data-entity-edit]")[0].trigger("click");

  assert.match(root.innerHTML, /data-entity-form-panel/);
  assert.doesNotMatch(root.innerHTML, /<section class="entity-gallery-panel" data-entity-gallery>/);
  assert.match(root.formMarkup, /Editar registro/);
  assert.match(root.formMarkup, /name="Title"[^>]+value="SAO PAULO"/);
  page.cleanup();
});

test("Cancelar fecha o formulario sem perder a galeria nem a busca", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const editableEntity = { ...entity, id: "cidades", title: "Cidades", searchFields: ["Title"], statusFields: [] };
  const page = createEntityPage(root, {
    entity: editableEntity,
    access,
    can,
    galleryCatalog: { galleries: [] },
    initialQuery: { search: "SAO" },
    repository: {
      async resolveList() { return { status: "resolved", id: "cidades-list" }; },
      async getColumns() { return [{ name: "Title", displayName: "Nome", indexed: true, text: {} }]; },
      async getItemsPage() { return { items: [{ id: "7", fields: { Title: "SAO PAULO" } }], nextLink: "", hasMore: false, batchCount: 1 }; },
    },
  });
  await page.ready;
  root.querySelector("[data-entity-create]").trigger("click");

  root.cancelForm();

  assert.doesNotMatch(root.innerHTML, /data-entity-form-panel/);
  assert.match(root.innerHTML, /data-entity-gallery/);
  assert.match(root.innerHTML, /data-entity-search value="SAO"/);
  assert.match(root.innerHTML, /SAO PAULO/);
  page.cleanup();
});

test("Salvar fecha o formulario e atualiza a galeria sem perder a busca", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const editableEntity = { ...entity, id: "cidades", title: "Cidades", searchFields: ["Title"], statusFields: [] };
  let item = { id: "7", eTag: '"1,1"', fields: { Title: "SAO PAULO" } };
  let loads = 0;
  const page = createEntityPage(root, {
    entity: editableEntity,
    access,
    can,
    galleryCatalog: { galleries: [] },
    initialQuery: { search: "SAO" },
    repository: {
      async resolveList() { return { status: "resolved", id: "cidades-list" }; },
      async getColumns() { return [{ name: "Title", displayName: "Nome", indexed: true, text: {} }]; },
      async getItemsPage() { loads += 1; return { items: [item], nextLink: "", hasMore: false, batchCount: 1 }; },
      async updateItem(siteKey, listId, itemId, fields, options) {
        assert.deepEqual([siteKey, listId, itemId, fields, options], ["personal", "cidades-list", "7", { Title: "CAMPINAS" }, { eTag: '"1,1"' }]);
        item = { id: "7", eTag: '"2,1"', fields: { Title: fields.Title } };
        return item;
      },
    },
  });
  await page.ready;
  root.querySelectorAll("[data-entity-edit]")[0].trigger("click");

  await root.submitForm("CAMPINAS");

  assert.equal(loads, 1, "a edicao deve atualizar o lote atual sem uma leitura redundante");
  assert.doesNotMatch(root.innerHTML, /data-entity-form-panel/);
  assert.match(root.innerHTML, /data-entity-gallery/);
  assert.match(root.innerHTML, /data-entity-search value="SAO"/);
  assert.match(root.innerHTML, /CAMPINAS/);
  assert.match(root.innerHTML, /Registro atualizado com sucesso/);
  page.cleanup();
});

test("editar invalida as opcoes globais para a proxima leitura", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const editableEntity = { ...entity, id: "cidades", title: "Cidades", searchFields: ["Title"], statusFields: [] };
  let item = { id: "7", eTag: '"1,1"', fields: { Title: "SAO PAULO" } };
  let optionLoads = 0;
  const page = createEntityPage(root, {
    entity: editableEntity,
    access,
    can,
    repository: {
      async resolveList() { return { status: "resolved", id: "cidades-list" }; },
      async getColumns() { return [{ name: "Title", displayName: "Nome", indexed: true, text: {} }]; },
      async getItemsPage() { return { items: [item], nextLink: "", hasMore: false, batchCount: 1 }; },
      async getFilterOptionValues() { optionLoads += 1; return { Title: [item.fields.Title] }; },
      async updateItem() {
        item = { id: "7", eTag: '"2,1"', fields: { Title: "CAMPINAS" } };
        return item;
      },
    },
  });
  await page.ready;
  root.querySelectorAll("[data-entity-edit]")[0].trigger("click");
  await root.submitForm("CAMPINAS");
  assert.equal(optionLoads, 2, "a edição deve renovar as opções globais antes de renderizar");
  assert.match(root.innerHTML, /<option value="CAMPINAS">CAMPINAS<\/option>/);

  await page.refresh();

  assert.equal(optionLoads, 2, "a leitura seguinte deve reutilizar as opções já renovadas");
  page.cleanup();
});

test("editar no segundo lote preserva pagina, filtro e selecao sem recarregar a primeira pagina", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const editableEntity = { ...entity, id: "cidades", title: "Cidades", searchFields: ["Title"], statusFields: ["STATUS"] };
  const first = { id: "1", eTag: '"1,1"', fields: { Title: "BELO HORIZONTE", STATUS: "ATIVO" } };
  let second = { id: "2", eTag: '"2,1"', fields: { Title: "DIVINOPOLIS", STATUS: "ATIVO" } };
  let loads = 0;
  const page = createEntityPage(root, {
    entity: editableEntity,
    access,
    can,
    galleryCatalog: { galleries: [] },
    initialQuery: { filters: { STATUS: "ATIVO" }, pageSize: 1 },
    repository: {
      async resolveList() { return { status: "resolved", id: "cidades-list" }; },
      async getColumns() {
        return [
          { name: "Title", displayName: "Nome", indexed: true, text: {} },
          { name: "STATUS", displayName: "Status", indexed: true, choice: { choices: ["ATIVO", "INATIVO"] } },
        ];
      },
      async getItemsPage(_siteKey, _listId, _query, options) {
        loads += 1;
        return options.cursor
          ? { items: [second], nextLink: "", hasMore: false, batchCount: 1 }
          : { items: [first], nextLink: "https://graph.microsoft.com/v1.0/sites/personal/lists/cidades-list/items?$skiptoken=2", hasMore: true, batchCount: 1 };
      },
      async updateItem(_siteKey, _listId, itemId, fields, options) {
        assert.deepEqual([itemId, fields, options], ["2", { Title: "ITAUNA" }, { eTag: '"2,1"' }]);
        second = { ...second, eTag: '"2,2"', fields: { ...second.fields, ...fields } };
        return second;
      },
    },
  });
  await page.ready;
  await root.querySelector("[data-entity-next]").trigger("click");
  root.querySelectorAll("[data-entity-edit]")[0].trigger("click");

  await root.submitForm("ITAUNA");

  assert.equal(loads, 2, "a edicao deve atualizar o lote em memoria sem voltar a consultar a primeira pagina");
  assert.match(root.innerHTML, /Página 2/);
  assert.match(root.innerHTML, /data-entity-filter="STATUS"[^>]*>[\s\S]*?<option value="ATIVO" selected>/);
  assert.match(root.innerHTML, /ITAUNA/);
  assert.match(root.innerHTML, /data-entity-selected="true"/);
  assert.match(adminCss, /\.entity-table tbody tr\.is-selected\s*\{[^}]*background:/i);
  page.cleanup();
});

test("busca estavel nao reexpoe Editar em entidade sem Form", async () => {
  const root = createApprovalRoot({ stableGallery: true });
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const readOnlyEntity = { ...entity, id: "fonte-sem-form", searchFields: ["Title"], statusFields: [] };
  const page = createEntityPage(root, {
    entity: readOnlyEntity,
    access,
    can,
    searchDebounceMs: 0,
    repository: {
      async resolveList() { return { status: "resolved", id: "read-only-list" }; },
      async getColumns() { return [{ name: "Title", displayName: "Nome", indexed: true, text: {} }]; },
      async getItemsPage() { return { items: [{ id: "7", fields: { Title: "ANA" } }], nextLink: "", hasMore: false, batchCount: 1 }; },
    },
  });
  await page.ready;
  assert.doesNotMatch(root.innerHTML, /data-entity-edit/);

  await root.querySelector("[data-entity-search]").trigger("input", "ANA");

  assert.match(root.resultsMarkup, /Abrir detalhes/);
  assert.doesNotMatch(root.resultsMarkup, /data-entity-edit/);
  page.cleanup();
});

test("fila multipla bloqueia campos ausentes no Form Power Apps comprovado", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "suprimentos" }]);
  const multiEntity = { ...ENTITIES.find(candidate => candidate.id === "lancamentos"), title: "Lancamentos", searchFields: ["Title"], statusFields: [] };
  const items = [];
  const page = createEntityPage(root, {
    entity: multiEntity,
    access,
    can,
    repository: {
      async resolveList(_siteKey, aliases) {
        return aliases.includes("NOTASPENDENTES") || aliases.includes("PROVISÃO PGTOS")
          ? { status: "missing" }
          : { status: "resolved", id: "lancamentos-list" };
      },
      async getColumns() {
        return [
          { name: "Title", displayName: "Filial", indexed: true, required: true, editable: true, text: {} },
          { name: "ETAPA", displayName: "Etapa", required: true, editable: true, text: {} },
          { name: "CONTA", displayName: "Conta", required: true, editable: true, text: {} },
          { name: "TIPO TRANSAÇÃO", displayName: "Tipo transação", required: true, editable: true, text: {} },
          { name: "QUANTIDADE", displayName: "Quantidade", required: true, editable: true, number: {} },
          { name: "FORNECEDOR", displayName: "Fornecedor", required: true, editable: true, text: {} },
          { name: "VALOR UNITÁRIO", displayName: "Valor unitário", required: true, editable: true, number: {} },
        ];
      },
      async getItemsPage() { return { items: [...items], nextLink: "", hasMore: false, batchCount: items.length }; },
      async createItem(siteKey, listId, fields) {
        assert.deepEqual([siteKey, listId, fields], ["personal", "lancamentos-list", { Title: "001", ETAPA: "FUNDAÇÃO", CONTA: "OBRA", "TIPO TRANSAÇÃO": "CUSTO", QUANTIDADE: 2, FORNECEDOR: "ACME", "VALOR UNITÁRIO": 100 }]);
        const item = { id: "8", fields: { ...fields } };
        items.push(item);
        return item;
      },
    },
  });
  await page.ready;
  assert.doesNotMatch(root.innerHTML, /data-multi-entry-host/);
  root.querySelector("[data-entity-create]").trigger("click");
  assert.match(root.queueMarkup, /data-multi-entry-queue/);

  await root.submitFormValues({ Title: "001", ETAPA: "FUNDAÇÃO", CONTA: "OBRA", "TIPO TRANSAÇÃO": "CUSTO", QUANTIDADE: "2", FORNECEDOR: "ACME", "VALOR UNITÁRIO": "100" });
  assert.match(root.queueMarkup, /001/);
  await root.submitQueue();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.match(root.innerHTML, /data-entity-form-panel/);
  assert.match(root.queueMarkup, /is-error/);
  assert.equal(items.length, 0);
  page.cleanup();
});

test("fila multipla preserva linhas invalidas para correcao antes do envio", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "suprimentos" }]);
  const multiEntity = { ...ENTITIES.find(candidate => candidate.id === "lancamentos"), title: "Lancamentos", searchFields: ["Title"], statusFields: [] };
  const items = [];
  let failedOnce = false;
  const page = createEntityPage(root, {
    entity: multiEntity,
    access,
    can,
    repository: {
      async resolveList(_siteKey, aliases) {
        return aliases.includes("NOTASPENDENTES") || aliases.includes("PROVISÃO PGTOS")
          ? { status: "missing" }
          : { status: "resolved", id: "lancamentos-list" };
      },
      async getColumns() {
        return [
          { name: "Title", displayName: "Filial", indexed: true, required: true, editable: true, text: {} },
          { name: "ETAPA", displayName: "Etapa", required: true, editable: true, text: {} },
          { name: "CONTA", displayName: "Conta", required: true, editable: true, text: {} },
          { name: "TIPO TRANSAÇÃO", displayName: "Tipo transação", required: true, editable: true, text: {} },
          { name: "QUANTIDADE", displayName: "Quantidade", required: true, editable: true, number: {} },
          { name: "FORNECEDOR", displayName: "Fornecedor", required: true, editable: true, text: {} },
          { name: "VALOR UNITÁRIO", displayName: "Valor unitário", required: true, editable: true, number: {} },
        ];
      },
      async getItemsPage() { return { items: [...items], nextLink: "", hasMore: false, batchCount: items.length }; },
      async createItem(_siteKey, _listId, fields) {
        if (fields.Title === "002" && !failedOnce) {
          failedOnce = true;
          throw new Error("Falha temporaria na linha 002");
        }
        const item = { id: String(items.length + 1), fields: { ...fields } };
        items.push(item);
        return item;
      },
    },
  });
  await page.ready;
  root.querySelector("[data-entity-create]").trigger("click");
  await root.submitFormValues({ Title: "001", ETAPA: "FUNDAÇÃO", CONTA: "OBRA", "TIPO TRANSAÇÃO": "CUSTO", QUANTIDADE: "2", FORNECEDOR: "ACME", "VALOR UNITÁRIO": "100" });
  await root.submitFormValues({ Title: "002", ETAPA: "FUNDAÇÃO", CONTA: "OBRA", "TIPO TRANSAÇÃO": "CUSTO", QUANTIDADE: "2", FORNECEDOR: "ACME", "VALOR UNITÁRIO": "100" });

  await root.submitQueue();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.match(root.queueMarkup, /001/);
  assert.match(root.queueMarkup, /002/);
  assert.match(root.queueMarkup, /is-error/);
  assert.doesNotMatch(root.queueMarkup, /is-success/);
  assert.equal(items.length, 0);
  page.cleanup();
});

test("detalhe usa datas curtas e ao editar limita os campos ao Form comprovado do Power Apps", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const detailEntity = { ...entity, id: "cidades", title: "Cidades", searchFields: ["Title"], statusFields: [] };
  const page = createItemDetailPage(root, {
    entity: detailEntity,
    itemId: "7",
    access,
    can,
    repository: {
      async resolveList() { return { status: "resolved", id: "cidades-list" }; },
      async getColumns() {
        return [
          { name: "Title", displayName: "Nome", text: {} },
          { name: "STATUS", displayName: "Status", choice: { choices: ["ATIVO", "INATIVO"] } },
          { name: "DATA", displayName: "Data de cadastro", dateTime: { format: "dateOnly" } },
        ];
      },
      async getItem() {
        return {
          id: "7",
          eTag: '"7,1"',
          createdDateTime: "2026-08-14T10:00:00Z",
          lastModifiedDateTime: "2026-08-15T10:00:00Z",
          fields: { Title: "DIVINOPOLIS", STATUS: "ATIVO", DATA: "2026-08-15T00:00:00Z" },
        };
      },
      async getItemVersions() {
        return [
          { lastModifiedDateTime: "2026-08-14T10:00:00Z", fields: { Title: "DIVINOPOLIS", STATUS: "ATIVO", DATA: "2026-08-14T00:00:00Z" } },
          { lastModifiedDateTime: "2026-08-15T10:00:00Z", fields: { Title: "DIVINOPOLIS", STATUS: "ATIVO", DATA: "2026-08-15T00:00:00Z" } },
        ];
      },
      async listAttachments() { return []; },
    },
  });
  await page.ready;

  assert.match(root.innerHTML, /Data de cadastro/);
  assert.match(root.innerHTML, /15\/08\/2026/);
  assert.doesNotMatch(root.innerHTML, /2026-08-15T00:00:00Z/);
  assert.match(root.innerHTML, /Antes[\s\S]*14\/08\/2026[\s\S]*Depois[\s\S]*15\/08\/2026/);

  root.querySelector("[data-item-edit]").trigger("click");

  assert.match(root.formMarkup, /name="Title"/);
  assert.doesNotMatch(root.formMarkup, /name="STATUS"/);
  assert.doesNotMatch(root.formMarkup, /name="DATA"/);
  page.cleanup();
});

test("Editar abre diretamente o Form padrão e preserva os valores atuais", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "suprimentos" }]);
  const supplierEntity = ENTITIES.find(candidate => candidate.id === "fornecedores");
  const page = createItemDetailPage(root, {
    entity: supplierEntity,
    itemId: "7",
    access,
    can,
    repository: {
      async resolveList() { return { status: "resolved", id: "fornecedores-list" }; },
      async getColumns() {
        return [
          { name: "Title", displayName: "Fornecedor", text: {} },
          { name: "HOMOLOGACAO", displayName: "Homologacao", text: {} },
          { name: "MEDI_x00c7__x00c3_OATUAL", displayName: "Medicao atual", text: {} },
        ];
      },
      async getItem() {
        return {
          id: "7",
          eTag: '"7,1"',
          fields: { Title: "ACME", HOMOLOGACAO: "SIM", MEDI_x00c7__x00c3_OATUAL: "10" },
        };
      },
      async getItemVersions() { return []; },
      async listAttachments() { return []; },
    },
  });
  await page.ready;

  root.querySelector("[data-item-edit]").trigger("click");

  assert.doesNotMatch(root.innerHTML, /data-item-form-variant/);
  assert.match(root.formMarkup, /name="HOMOLOGACAO"[\s\S]*?<option value="SIM" selected>/);
  assert.match(root.formMarkup, /name="Title"[^>]+value="ACME"/);
  page.cleanup();
});

test("Cancelar a rota new solicita retorno para a galeria", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "suprimentos" }]);
  const cityEntity = ENTITIES.find(candidate => candidate.id === "cidades");
  let cancellations = 0;
  const page = createEntityPage(root, {
    entity: cityEntity,
    access,
    can,
    initialFormOpen: true,
    onFormCancel: () => { cancellations += 1; },
    repository: {
      async resolveList() { return { status: "resolved", id: "cidades-list" }; },
      async getColumns() { return [{ name: "Title", displayName: "Cidade", indexed: true, text: {} }]; },
      async getItemsPage() { return { items: [], nextLink: "", hasMore: false, batchCount: 0 }; },
    },
  });
  await page.ready;

  root.cancelForm();

  assert.equal(cancellations, 1);
  page.cleanup();
});

test("detalhe sem Form comprovado permanece somente para consulta", async () => {
  const root = createApprovalRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const page = createItemDetailPage(root, {
    entity: { ...entity, id: "fonte-sem-form", title: "Fonte sem Form" },
    itemId: "7",
    access,
    can,
    repository: {
      async resolveList() { return { status: "resolved", id: "somente-leitura" }; },
      async getColumns() { return [{ name: "Title", displayName: "Nome", text: {} }]; },
      async getItem() { return { id: "7", eTag: '"7,1"', fields: { Title: "CONSULTA" } }; },
      async getItemVersions() { return []; },
      async listAttachments() { return []; },
    },
  });
  await page.ready;

  assert.match(root.innerHTML, /CONSULTA/);
  assert.doesNotMatch(root.innerHTML, /data-item-edit/);
  page.cleanup();
});

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
  assert.equal(new URLSearchParams(queries[0]).get("$orderby"), "fields/ID desc");
  assert.equal(new URLSearchParams(queries[1]).get("$orderby"), "fields/Title asc");
  page.cleanup();
});

test("o seletor de ordenação aplica o campo escolhido e o ícone inverte a direção", async () => {
  const root = createInteractiveRoot();
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const queries = [];
  const page = createEntityPage(root, {
    entity: { ...entity, searchFields: ["Title"], filterFields: [] },
    access,
    can,
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

  await root.control("[data-entity-sort-field]").trigger("change", "Title");
  root.control("[data-entity-sort-field]").value = "Title";
  await root.control("[data-entity-sort-direction]").trigger("click");

  assert.equal(new URLSearchParams(queries[0]).get("$orderby"), "fields/ID desc");
  assert.equal(new URLSearchParams(queries[1]).get("$orderby"), "fields/Title asc");
  assert.equal(new URLSearchParams(queries[2]).get("$orderby"), "fields/Title desc");
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
    uiContract: {
      hasForm: true,
      readOnly: false,
      formColumns: [],
      galleryColumns: [
        { name: "Title", label: "Nome", control: "text", indexed: true, hidden: false },
        { name: "STATUS", label: "Status", control: "select", indexed: true, hidden: false, choices: ["ATIVO"] },
      ],
      filterFields: ["STATUS"],
      searchFields: ["Title"],
      multiple: false,
    },
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
    entity: { ...entity, id: "cidades", searchFields: ["Title"], filterFields: [] },
    access,
    can,
    galleryCatalog: { galleries: [] },
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
  }, multiEntity, { search: "ANA", galleryCatalog: { galleries: [] } });

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
