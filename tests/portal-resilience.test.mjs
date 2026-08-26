import assert from "node:assert/strict";
import test from "node:test";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import {
  classifyEntityAvailability,
  createAttachmentActions,
  createSharePointAttachmentTransport,
  validateAttachment,
} from "../portal/data/attachments.js";
import { attachmentPanelMarkup, createAttachmentPresenter, presentAttachment } from "../portal/ui/attachments-panel.js";
import { activityPanelMarkup, buildActivityHistory } from "../portal/ui/activity-panel.js";
import { loadEntityData } from "../portal/ui/entity-page.js";

const entity = Object.freeze({
  id: "clientes",
  moduleId: "comercial",
  title: "Clientes",
  siteKey: "personal",
  capabilities: Object.freeze({ view: true, edit: true }),
});

function file(overrides = {}) {
  return {
    name: "CONTRATO.pdf",
    type: "application/pdf",
    size: 1024,
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    ...overrides,
  };
}

test("classifica fontes por disponibilidade sem ocultar outras entidades", () => {
  assert.equal(classifyEntityAvailability({ status: "resolved" }), "available");
  assert.equal(classifyEntityAvailability({ status: "missing" }), "missing");
  assert.equal(classifyEntityAvailability({ status: 403, code: "accessDenied" }), "forbidden");
  assert.equal(classifyEntityAvailability(new Error("Falha de rede")), "error");
});

test("uma fonte sem permissao devolve estado proprio e nao quebra a entidade", async () => {
  const data = await loadEntityData({
    async resolveList() { throw { status: 403, code: "accessDenied", message: "Sem permissão" }; },
  }, entity);
  assert.equal(data.state, "forbidden");
  assert.equal(data.items.total, 0);
});

test("valida tamanho, tipo e nome do anexo antes de qualquer envio", () => {
  assert.equal(validateAttachment(file()).valid, true);
  assert.match(validateAttachment(file({ name: "../../SEGREDO.pdf" })).message, /nome/i);
  assert.match(validateAttachment(file({ type: "application/x-msdownload", name: "INSTALAR.exe" })).message, /tipo/i);
  assert.match(validateAttachment(file({ size: 26 * 1024 * 1024 })).message, /tamanho/i);
});

test("valida o par de extensao e MIME e aceita MIME vazio apenas para extensao permitida", () => {
  assert.equal(validateAttachment(file({ name: "CONTRATO.pdf", type: "" })).valid, true);
  assert.match(validateAttachment(file({ name: "RELATORIO.exe", type: "application/pdf" })).message, /tipo/i);
  assert.match(validateAttachment(file({ name: "RELATORIO.pdf.exe", type: "application/pdf" })).message, /tipo/i);
  assert.match(validateAttachment(file({ name: "PLANILHA.xlsx", type: "application/pdf" })).message, /tipo/i);
});

test("transporte aceita somente os dois hosts SharePoint configurados e devolve binario", async () => {
  const scopes = [];
  const urls = [];
  const transport = createSharePointAttachmentTransport({
    allowedHosts: ["energeticaltda-my.sharepoint.com", "energeticaltda.sharepoint.com"],
    tokenProvider: async requested => { scopes.push(requested); return "token"; },
    fetch: async url => {
      urls.push(url);
      return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array([7, 8]).buffer };
    },
  });
  const bytes = await transport.request({ host: "energeticaltda.sharepoint.com" }, "/_api/web/lists", { responseType: "arrayBuffer" });
  assert.deepEqual([...new Uint8Array(bytes)], [7, 8]);
  await transport.request({ host: "energeticaltda-my.sharepoint.com" }, "/_api/web/lists", { responseType: "arrayBuffer" });
  await assert.rejects(transport.request({ host: "evil.sharepoint.com" }, "/_api/web/lists"), /destino/i);
  assert.equal(scopes.length, 2);
  assert.equal(urls.length, 2);
});

test("envio e exclusao revalidam catalogo e permissao antes de tocar na rede", async () => {
  let networkCalls = 0;
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  access.permissions.comercial.edit = false;
  access.permissions.comercial.view = false;
  const actions = createAttachmentActions({
    repository: {
      async listAttachments() { networkCalls += 1; },
      async uploadAttachment() { networkCalls += 1; },
      async deleteAttachment() { networkCalls += 1; },
    },
    entity,
    access,
    can,
    listId: "clientes-list",
    itemId: "42",
  });

  await assert.rejects(actions.listAttachments(), /permiss[aã]o/i);
  await assert.rejects(actions.uploadAttachment(file()), /permiss[aã]o/i);
  await assert.rejects(actions.deleteAttachment("CONTRATO.pdf"), /permiss[aã]o/i);
  assert.equal(networkCalls, 0);
});

test("anexos sao enviados e excluidos no item SharePoint exato", async () => {
  const calls = [];
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const actions = createAttachmentActions({
    repository: {
      async uploadAttachment(...args) { calls.push(["upload", ...args]); },
      async deleteAttachment(...args) { calls.push(["delete", ...args]); },
      async downloadAttachment(...args) { calls.push(["download", ...args]); return new Uint8Array([5]).buffer; },
    },
    entity,
    access,
    can,
    listId: "clientes-list",
    itemId: "42",
  });

  await actions.uploadAttachment(file());
  await actions.deleteAttachment("CONTRATO.pdf");
  await actions.downloadAttachment("CONTRATO.pdf");
  assert.deepEqual(calls.map(([operation, siteKey, listId, itemId]) => [operation, siteKey, listId, itemId]), [
    ["upload", "personal", "clientes-list", "42"],
    ["delete", "personal", "clientes-list", "42"],
    ["download", "personal", "clientes-list", "42"],
  ]);
});

test("falha no anexo conserva os valores locais e fornece status acionavel", async () => {
  const values = { note: "ANEXAR DOCUMENTO ASSINADO" };
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const actions = createAttachmentActions({
    repository: { async uploadAttachment() { throw new Error("SharePoint indisponivel"); } },
    entity,
    access,
    can,
    listId: "clientes-list",
    itemId: "42",
  });

  await assert.rejects(actions.uploadAttachment(file(), values), /SharePoint indisponivel/);
  assert.deepEqual(values, { note: "ANEXAR DOCUMENTO ASSINADO" });
  assert.match(actions.getState().error, /tente novamente/i);
});

test("falhas de fonte ficam genericas para usuario comum e detalhadas apenas para superadministrador", async () => {
  const access = buildSuperAdminAccess("admin@energeticabr.com", "Admin", [{ id: "comercial" }]);
  const repository = { async uploadAttachment() { throw { status: 500, code: "source_internal", message: "Caminho interno do SharePoint" }; } };
  const common = createAttachmentActions({ repository, entity, access, can, listId: "clientes-list", itemId: "42", isSuperAdmin: false });
  await assert.rejects(common.uploadAttachment(file()));
  assert.doesNotMatch(common.getState().error, /Caminho interno/);
  assert.equal(common.getState().diagnostic, "");
  assert.equal(common.getState().code, "source_internal");
  const admin = createAttachmentActions({ repository, entity, access, can, listId: "clientes-list", itemId: "42", isSuperAdmin: true });
  await assert.rejects(admin.uploadAttachment(file()));
  assert.match(admin.getState().diagnostic, /Caminho interno/);
});

test("painel lista metadados e historico deriva somente do item SharePoint", () => {
  const attachments = attachmentPanelMarkup({
    availability: "available",
    canEdit: true,
    files: [{ name: "CONTRATO.pdf", type: "application/pdf", size: 2048, author: "ANA", uploadedAt: "2026-08-26T12:00:00Z" }],
  });
  assert.match(attachments, /CONTRATO\.pdf/);
  assert.match(attachments, /ANA/);
  assert.match(attachments, /2 KB/);
  assert.match(attachments, /data-attachment-open/);
  assert.match(attachments, /data-attachment-download/);
  const diagnostic = attachmentPanelMarkup({ availability: "error", showDiagnostics: true });
  assert.match(diagnostic, /data-attachment-diagnostic/);

  const history = buildActivityHistory({
    id: "42",
    createdDateTime: "2026-08-20T12:00:00Z",
    createdBy: { user: { displayName: "ANA" } },
    lastModifiedDateTime: "2026-08-21T12:00:00Z",
    lastModifiedBy: { user: { displayName: "BRUNO" } },
  });
  const activity = activityPanelMarkup({ availability: "available", history });
  assert.match(activity, /Criado/);
  assert.match(activity, /Atualizado/);
  assert.match(activity, /ANA/);
  assert.match(activity, /BRUNO/);
});

test("abertura autenticada usa URL temporaria sem token e a revoga", () => {
  const anchors = [];
  const revoked = [];
  const presentation = presentAttachment({
    bytes: new Uint8Array([1, 2]).buffer,
    name: "CONTRATO.pdf",
    type: "application/pdf",
    mode: "download",
    urlApi: { createObjectURL: () => "blob:temporario", revokeObjectURL: url => revoked.push(url) },
    documentRef: { createElement: () => ({ click() { anchors.push(this); } }) },
  });
  assert.equal(anchors[0].href, "blob:temporario");
  assert.equal(anchors[0].download, "CONTRATO.pdf");
  assert.doesNotMatch(anchors[0].href, /token/i);
  presentation.revoke();
  assert.deepEqual(revoked, ["blob:temporario"]);
});

test("o ciclo de vida impede criar URL temporaria depois de fechar o painel", () => {
  let created = 0;
  const presenter = createAttachmentPresenter({
    urlApi: { createObjectURL: () => { created += 1; return "blob:tarde"; }, revokeObjectURL() {} },
    documentRef: { createElement: () => ({ click() {} }) },
  });
  presenter.cleanup();
  assert.equal(presenter.present({ bytes: new Uint8Array([1]).buffer, name: "CONTRATO.pdf" }), undefined);
  assert.equal(created, 0);
});
