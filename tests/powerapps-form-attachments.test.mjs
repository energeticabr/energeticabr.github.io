import assert from "node:assert/strict";
import test from "node:test";

import {
  createFormAttachmentDraft,
  formAttachmentFieldMarkup,
  powerAppsFormDeclaresAttachments,
} from "../portal/forms/form-attachments.js";
import { persistEntityRecordWithAttachments } from "../portal/forms/entity-submit.js";
import { createMultiEntryQueue } from "../portal/forms/multi-entry.js";
import { bindFormAttachments, formMarkup, renderDynamicForm } from "../portal/ui/dynamic-form.js";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import { ENTITIES } from "../portal/catalog/entities.js";
import { createEntityPage } from "../portal/ui/entity-page.js";
import { createItemDetailPage } from "../portal/ui/item-detail.js";

function pdf(name, bytes = [1, 2, 3]) {
  return {
    name,
    size: bytes.length,
    type: "application/pdf",
    async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
  };
}

test("reconhece anexos somente na variante operacional selecionada do Power Apps", () => {
  assert.equal(powerAppsFormDeclaresAttachments({
    formVariant: { formFields: ["Title", "{Attachments}"] },
  }), true);
  assert.equal(powerAppsFormDeclaresAttachments({
    formVariant: { formFields: ["Title", "STATUS"] },
  }), false);
  assert.equal(powerAppsFormDeclaresAttachments({
    formVariant: null,
    formVariants: [{ formFields: ["{Attachments}"] }],
    requiresVariantSelection: true,
  }), false, "nao deve adivinhar uma variante ainda nao selecionada");
});

test("controle de Form exibe arquivos sem transformar Attachments em campo tecnico do item", () => {
  const markup = formAttachmentFieldMarkup({
    enabled: true,
    canView: true,
    canEdit: true,
    existingFiles: [{ name: "CONTRATO.pdf", size: 2048, type: "application/pdf" }],
  });

  assert.match(markup, /data-form-attachments/);
  assert.match(markup, /CONTRATO\.pdf/);
  assert.match(markup, /data-form-attachment-open/);
  assert.match(markup, /data-form-attachment-download/);
  assert.match(markup, /type="file"[^>]+multiple/);
  assert.doesNotMatch(markup, /name="(?:\{Attachments\}|Attachments|ATTACHMENTS)"/i);
  assert.equal(formAttachmentFieldMarkup({ enabled: false }), "");
});

test("formulario injeta o controle apenas quando a variante declara anexos", () => {
  const entity = { title: "Lancamentos" };
  const columns = [{ name: "Title", label: "Filial", control: "text", editable: true }];
  const withAttachments = formMarkup({ entity, columns, attachments: { enabled: true, canEdit: true, canView: true } });
  const withoutAttachments = formMarkup({ entity, columns, attachments: { enabled: false } });

  assert.match(withAttachments, /data-form-attachments/);
  assert.doesNotMatch(withoutAttachments, /data-form-attachments/);
  assert.doesNotMatch(withAttachments, /name="(?:\{Attachments\}|Attachments|ATTACHMENTS)"/i);
});

test("rascunho de criacao prepara varios anexos e permite navegar sem gravar campo tecnico", async () => {
  const draft = createFormAttachmentDraft();
  const first = pdf("NOTA-1.pdf");
  const second = pdf("NOTA-2.pdf", [4, 5]);

  assert.deepEqual(draft.addUploads([first, second]).map(file => file.name), ["NOTA-1.pdf", "NOTA-2.pdf"]);
  assert.equal((await draft.readFile(1)).byteLength, 2);
  assert.equal(draft.removeUpload("NOTA-1.pdf"), true);
  assert.deepEqual(draft.changes().uploads.map(file => file.name), ["NOTA-2.pdf"]);
  assert.deepEqual(draft.changes().deletions, []);
});

test("rascunho de edicao preserva anexos atuais e registra inclusoes e exclusoes", () => {
  const draft = createFormAttachmentDraft({
    existingFiles: [
      { name: "ANTIGO.pdf", size: 50, type: "application/pdf" },
      { name: "MANTER.pdf", size: 60, type: "application/pdf" },
    ],
  });

  assert.equal(draft.removeExisting("ANTIGO.pdf"), true);
  draft.addUploads([pdf("NOVO.pdf")]);
  assert.deepEqual(draft.visibleFiles().map(file => file.name), ["MANTER.pdf", "NOVO.pdf"]);
  assert.deepEqual(draft.changes().deletions, ["ANTIGO.pdf"]);
  assert.deepEqual(draft.changes().uploads.map(file => file.name), ["NOVO.pdf"]);
  assert.throws(() => draft.addUploads([pdf("MANTER.pdf")]), /já existe/i);
});

test("criacao grava o item primeiro e usa as APIs existentes para anexar ao novo ID", async () => {
  const calls = [];
  const repository = {
    async createItem(siteKey, listId, fields) {
      calls.push(["createItem", siteKey, listId, fields]);
      return { id: "42", fields };
    },
    async uploadAttachment(siteKey, listId, itemId, file, name) {
      calls.push(["uploadAttachment", siteKey, listId, itemId, file, name]);
    },
  };
  const file = pdf("CONTRATO.pdf");

  const saved = await persistEntityRecordWithAttachments(repository, { siteKey: "personal" }, { id: "LISTA" }, {
    mode: "create",
    fields: { Title: "001" },
    attachments: { uploads: [file], deletions: [] },
  });

  assert.equal(saved.id, "42");
  assert.deepEqual(calls.map(call => call[0]), ["createItem", "uploadAttachment"]);
  assert.deepEqual(calls[0][3], { Title: "001" });
  assert.equal(calls[1][3], "42");
  assert.equal(calls[1][5], "CONTRATO.pdf");
  assert.equal(Object.hasOwn(calls[0][3], "{Attachments}"), false);
});

test("edicao usa ETag do item e aplica exclusoes e inclusoes pelas APIs protegidas", async () => {
  const calls = [];
  const repository = {
    async updateItem(siteKey, listId, itemId, fields, options) {
      calls.push(["updateItem", siteKey, listId, itemId, fields, options]);
      return { id: itemId, eTag: '"8,2"', fields };
    },
    async deleteAttachment(...args) { calls.push(["deleteAttachment", ...args]); },
    async uploadAttachment(...args) { calls.push(["uploadAttachment", ...args]); },
  };
  const item = { id: "8", eTag: '"8,1"', fields: { Title: "ANTES" } };
  const file = pdf("NOVO.pdf");

  await persistEntityRecordWithAttachments(repository, { siteKey: "company" }, { id: "LISTA" }, {
    mode: "edit",
    item,
    fields: { Title: "DEPOIS" },
    attachments: { deletions: ["ANTIGO.pdf"], uploads: [file] },
  });

  assert.deepEqual(calls.map(call => call[0]), ["updateItem", "deleteAttachment", "uploadAttachment"]);
  assert.deepEqual(calls[0][5], { eTag: '"8,1"' });
  assert.deepEqual(calls[1].slice(1), ["company", "LISTA", "8", "ANTIGO.pdf"]);
  assert.equal(calls[2][4], file);
  assert.equal(calls[2][5], "NOVO.pdf");
  assert.equal(Object.hasOwn(calls[0][4], "Attachments"), false);
});

test("renderDynamicForm entrega o rascunho de anexos junto da submissao validada", async () => {
  const selected = pdf("MEMORIAL.pdf");
  let submitted;
  let markup = "";
  const listeners = new Map();
  const field = { name: "Title", value: "001", disabled: false };
  const form = {
    elements: {
      namedItem(name) { return name === "Title" ? field : null; },
      *[Symbol.iterator]() { yield field; },
    },
    reportValidity() { return true; },
    setAttribute() {},
    querySelectorAll() { return []; },
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const button = { disabled: false, textContent: "", addEventListener() {}, removeEventListener() {} };
  const status = { textContent: "", hidden: true, classList: { toggle() {} } };
  const attachmentRoot = { querySelector() { return null; }, querySelectorAll() { return []; } };
  const root = {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; },
    querySelector(selector) {
      return ({
        "[data-dynamic-form]": form,
        "[data-form-save]": button,
        "[data-form-cancel]": button,
        "[data-form-errors]": status,
        "[data-form-attachments]": attachmentRoot,
      })[selector] || null;
    },
  };

  const controller = renderDynamicForm(root, {
    entity: { title: "Lancamentos" },
    columns: [{ name: "Title", label: "Filial", control: "text", editable: true }],
    attachments: { enabled: true, canEdit: true, canView: true, pendingFiles: [selected] },
    async onSubmit(fields, _raw, _labels, attachments) { submitted = { fields, attachments }; },
  });
  await listeners.get("submit")({ preventDefault() {} });

  assert.deepEqual(submitted.fields, { Title: "001" });
  assert.deepEqual(submitted.attachments.uploads.map(file => file.name), ["MEMORIAL.pdf"]);
  assert.deepEqual(submitted.attachments.deletions, []);
  controller.cleanup();
});

test("fila de lancamentos multiplos conserva anexos por item ate a gravacao", async () => {
  const queue = createMultiEntryQueue();
  const first = pdf("PRIMEIRO.pdf");
  const second = pdf("SEGUNDO.pdf");
  queue.add({ Title: "001" }, {}, {}, { uploads: [first], deletions: [] });
  queue.add({ Title: "002" }, {}, {}, { uploads: [second], deletions: [] });
  const received = [];

  await queue.submitAll(async row => {
    received.push([row.fields.Title, row.attachments.uploads[0].name]);
    return { id: row.fields.Title };
  });

  assert.deepEqual(received, [["001", "PRIMEIRO.pdf"], ["002", "SEGUNDO.pdf"]]);
});

function entityFormRoot() {
  let markup = "";
  let formMarkupValue = "";
  const control = () => ({
    value: "",
    dataset: {},
    classList: { toggle() {} },
    addEventListener() {},
    removeEventListener() {},
    removeAttribute() {},
    setAttribute() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
  });
  const attachmentRoot = { querySelector() { return null; }, querySelectorAll() { return []; } };
  const dynamicForm = {
    elements: { namedItem() { return null; }, *[Symbol.iterator]() {} },
    reportValidity() { return true; },
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll() { return []; },
  };
  const formHost = {
    get innerHTML() { return formMarkupValue; },
    set innerHTML(value) { formMarkupValue = value; },
    querySelector(selector) {
      return ({
        "[data-dynamic-form]": dynamicForm,
        "[data-form-save]": control(),
        "[data-form-cancel]": control(),
        "[data-form-errors]": control(),
        "[data-form-attachments]": attachmentRoot,
      })[selector] || null;
    },
    querySelectorAll() { return []; },
  };
  const queueHost = { innerHTML: "", querySelector() { return null; }, querySelectorAll() { return []; } };
  return {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; formMarkupValue = ""; },
    get formMarkup() { return formMarkupValue; },
    querySelector(selector) {
      if (selector === "[data-entity-form]") return markup.includes("data-entity-form") ? formHost : null;
      if (selector === "[data-multi-entry-host]") return markup.includes("data-multi-entry-host") ? queueHost : null;
      if (selector === ".entity-page") return control();
      return markup.includes(selector.replace(/[\[\]]/g, "").split("=")[0]) ? control() : null;
    },
    querySelectorAll() { return []; },
  };
}

test("pagina de entidade ativa anexos no Lancamento apenas porque o Form selecionado os declara", async () => {
  const root = entityFormRoot();
  const entity = ENTITIES.find(candidate => candidate.id === "lancamentos");
  const page = createEntityPage(root, {
    entity,
    access: buildSuperAdminAccess("admin@energeticabr.com", "Admin"),
    can,
    initialFormOpen: true,
    repository: {
      async resolveList() { return { status: "resolved", id: "lista-lancamentos" }; },
      async getColumns() { return [{ name: "FILIAL", displayName: "Filial", text: {}, indexed: true }]; },
      async getItemsPage() { return { items: [], nextLink: "", hasMore: false, batchCount: 0 }; },
    },
  });

  await page.ready;
  assert.match(root.formMarkup, /data-form-attachments/);
  assert.doesNotMatch(root.formMarkup, /name="(?:\{Attachments\}|Attachments|ATTACHMENTS)"/i);
  page.cleanup();
});

function itemDetailFormRoot() {
  let markup = "";
  let formMarkupValue = "";
  let controls = new Map();
  const control = selector => {
    if (!controls.has(selector)) {
      const listeners = new Map();
      controls.set(selector, {
        value: "",
        dataset: {},
        classList: { toggle() {} },
        addEventListener(name, listener) { listeners.set(name, listener); },
        removeEventListener(name) { listeners.delete(name); },
        trigger(name, value) { this.value = value ?? this.value; return listeners.get(name)?.({ target: this, currentTarget: this }); },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        removeAttribute() {},
        setAttribute() {},
      });
    }
    return controls.get(selector);
  };
  const dynamicForm = {
    elements: { namedItem() { return null; }, *[Symbol.iterator]() {} },
    reportValidity() { return true; },
    setAttribute() {}, addEventListener() {}, removeEventListener() {}, querySelectorAll() { return []; },
  };
  const attachmentFieldRoot = { querySelector() { return null; }, querySelectorAll() { return []; } };
  const formHost = {
    get innerHTML() { return formMarkupValue; },
    set innerHTML(value) { formMarkupValue = value; },
    querySelector(selector) {
      return ({
        "[data-dynamic-form]": dynamicForm,
        "[data-form-save]": control("save"),
        "[data-form-cancel]": control("cancel"),
        "[data-form-errors]": control("errors"),
        "[data-form-attachments]": attachmentFieldRoot,
      })[selector] || null;
    },
    querySelectorAll() { return []; },
  };
  const readOnlyAttachments = { innerHTML: "", querySelector() { return null; }, querySelectorAll() { return []; } };
  return {
    get innerHTML() { return markup; },
    set innerHTML(value) { markup = value; controls = new Map(); formMarkupValue = ""; },
    get formMarkup() { return formMarkupValue; },
    querySelector(selector) {
      if (selector === "[data-item-form]") return markup.includes("data-item-form") ? formHost : null;
      if (selector === "[data-item-attachments]") return markup.includes("data-item-attachments") ? readOnlyAttachments : null;
      return markup.includes(selector.replace(/[\[\]]/g, "").split("=")[0]) ? control(selector) : null;
    },
    querySelectorAll() { return []; },
  };
}

test("edicao no detalhe carrega anexos existentes no mesmo Form operacional", async () => {
  const root = itemDetailFormRoot();
  const entity = ENTITIES.find(candidate => candidate.id === "lancamentos");
  const page = createItemDetailPage(root, {
    entity,
    itemId: "7",
    access: buildSuperAdminAccess("admin@energeticabr.com", "Admin"),
    can,
    repository: {
      async resolveList() { return { status: "resolved", id: "lista-lancamentos" }; },
      async getColumns() { return [{ name: "FILIAL", displayName: "Filial", text: {} }]; },
      async getItem() { return { id: "7", eTag: '"7,1"', fields: { FILIAL: "001" } }; },
      async listAttachments() { return [{ name: "NOTA.pdf", size: 512, type: "application/pdf" }]; },
      async getItemVersions() { return []; },
    },
  });

  await page.ready;
  root.querySelector("[data-item-edit]").trigger("click");
  assert.match(root.formMarkup, /data-form-attachments/);
  assert.match(root.formMarkup, /NOTA\.pdf/);
  assert.doesNotMatch(root.formMarkup, /name="(?:\{Attachments\}|Attachments|ATTACHMENTS)"/i);
  page.cleanup();
});

test("controle do Form abre anexo autorizado em previa segura e permite navegar", async () => {
  const listeners = new Map();
  const button = (name, dataset = {}) => ({
    dataset,
    disabled: false,
    addEventListener(event, listener) { listeners.set(`${name}:${event}`, listener); },
    removeEventListener(event) { listeners.delete(`${name}:${event}`); },
    trigger(event) { return listeners.get(`${name}:${event}`)?.({ currentTarget: this, target: this }); },
  });
  const openFirst = button("open-first", { formAttachmentOpen: "A.pdf" });
  const downloadFirst = button("download-first", { formAttachmentDownload: "A.pdf" });
  const close = button("close");
  const previous = button("previous");
  const next = button("next");
  const previewDownload = button("preview-download");
  const dialog = {
    showModal() {},
    querySelector(selector) {
      return ({
        "[data-attachment-preview-close]": close,
        "[data-attachment-previous]": previous,
        "[data-attachment-next]": next,
        "[data-attachment-preview-download]": previewDownload,
      })[selector] || null;
    },
  };
  const viewerHost = {
    innerHTML: "",
    querySelector(selector) { return selector === "[data-attachment-viewer]" && this.innerHTML ? dialog : null; },
  };
  const mount = {
    querySelector(selector) {
      return ({
        "[data-form-attachment-input]": null,
        "[data-form-attachment-status]": { textContent: "", hidden: true, classList: { toggle() {} } },
        "[data-form-attachment-viewer-host]": viewerHost,
      })[selector] || null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-form-attachment-open]") return [openFirst];
      if (selector === "[data-form-attachment-download]") return [downloadFirst];
      return [];
    },
  };
  const root = { querySelector(selector) { return selector === "[data-form-attachments]" ? mount : null; } };
  const read = [];
  let sequence = 0;
  const revoked = [];
  const binding = bindFormAttachments(root, {
    enabled: true,
    canView: true,
    canEdit: true,
    existingFiles: [
      { name: "A.pdf", size: 1, type: "application/pdf" },
      { name: "B.pdf", size: 1, type: "application/pdf" },
    ],
    async readExisting(file) { read.push(file.name); return Uint8Array.of(file.name === "A.pdf" ? 1 : 2).buffer; },
    urlApi: {
      createObjectURL() { sequence += 1; return `blob:form-${sequence}`; },
      revokeObjectURL(url) { revoked.push(url); },
    },
  });

  await openFirst.trigger("click");
  assert.match(viewerHost.innerHTML, /A\.pdf/);
  await next.trigger("click");
  assert.match(viewerHost.innerHTML, /B\.pdf/);
  assert.deepEqual(read, ["A.pdf", "B.pdf"]);
  binding.cleanup();
  assert.deepEqual(revoked, ["blob:form-1", "blob:form-2"]);
});

test("selecionar e remover arquivo atualiza imediatamente a lista visivel do Form", () => {
  const listeners = new Map();
  const input = {
    files: [],
    addEventListener(name, listener) { listeners.set(`input:${name}`, listener); },
    removeEventListener(name) { listeners.delete(`input:${name}`); },
    trigger(name) { return listeners.get(`input:${name}`)?.({ currentTarget: this, target: this }); },
  };
  const list = {
    innerHTML: "",
    querySelectorAll() { return []; },
  };
  const status = { textContent: "", hidden: true, classList: { toggle() {} } };
  const mount = {
    querySelector(selector) {
      return ({
        "[data-form-attachment-input]": input,
        "[data-form-attachment-status]": status,
        "[data-form-attachment-list]": list,
        "[data-form-attachment-viewer-host]": null,
      })[selector] || null;
    },
    querySelectorAll() { return []; },
  };
  const root = { querySelector() { return mount; } };
  const binding = bindFormAttachments(root, { enabled: true, canView: true, canEdit: true });

  input.files = [pdf("SELECIONADO.pdf")];
  input.trigger("change");

  assert.match(list.innerHTML, /SELECIONADO\.pdf/);
  assert.match(list.innerHTML, /Será enviado ao salvar/);
  binding.cleanup();
});
