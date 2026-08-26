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

const columns = Object.freeze([
  { name: "Title", displayName: "Nome", required: true, text: {} },
  { name: "STATUS", displayName: "Status", choice: { choices: ["ATIVO", "INATIVO"] } },
]);

test("as acoes exigem permissao de usuario e capacidade explicita da entidade", () => {
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  access.permissions.comercial.delete = true;
  assert.deepEqual(getEntityActions(entity, access, can), { create: true, edit: true, delete: false });
  access.permissions.comercial.edit = false;
  assert.deepEqual(getEntityActions(entity, access, can), { create: true, edit: false, delete: false });
});

test("a consulta da entidade descobre colunas, retorna ausencia estruturada e aplica filtros locais", async () => {
  const readyRepository = {
    async resolveList() { return { status: "resolved", id: "clientes-list" }; },
    async getColumns() { return columns; },
    async getItems() {
      return [
        { id: "2", fields: { Title: "BRUNO", STATUS: "INATIVO" } },
        { id: "1", fields: { Title: "ANA", STATUS: "ATIVO" } },
      ];
    },
  };
  const ready = await loadEntityData(readyRepository, entity, { status: "ATIVO", pageSize: 10 });
  assert.equal(ready.state, "ready");
  assert.equal(ready.items.items[0].fields.Title, "ANA");
  assert.equal(ready.columns[0].name, "Title");

  const missing = await loadEntityData({ async resolveList() { return { status: "missing" }; } }, entity);
  assert.equal(missing.state, "missing");
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

test("campos de lookup e pessoa exigem um identificador inteiro positivo", () => {
  const markup = formMarkup({
    entity,
    columns: [...columns, { name: "CLIENTE", displayName: "Cliente", required: true, lookup: {} }, { name: "RESPONSAVEL", displayName: "Responsável", personOrGroup: {} }],
    mode: "create",
    values: {},
  });
  assert.match(markup, /name="CLIENTE"[^>]+min="1"[^>]+step="1"/);
  assert.match(markup, /name="RESPONSAVEL"[^>]+min="1"[^>]+step="1"/);
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
        trigger(name, value) { this.value = value ?? this.value; listeners.get(name)?.({ target: this }); },
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
      async getItems() { return [{ id: "2", fields: { Title: "BRUNO", STATUS: "ATIVO" } }, { id: "1", fields: { Title: "ANA", STATUS: "ATIVO" } }]; },
    },
  });
  await page.ready;
  assert.doesNotThrow(() => root.control("[data-entity-search]").trigger("input", "ANA"));
  assert.doesNotThrow(() => root.control("[data-entity-sort]").trigger("click"));
  assert.doesNotThrow(() => root.control("[data-entity-next]").trigger("click"));
  page.cleanup();
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
    items: { items: [{ id: "1", fields: { Title: "ANA", STATUS: "ATIVO" } }], total: 2, page: 1, pages: 2, pageSize: 1, rangeStart: 1, rangeEnd: 1 },
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
  assert.match(markup, /Exibindo 1 a 1 de 2/);
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
