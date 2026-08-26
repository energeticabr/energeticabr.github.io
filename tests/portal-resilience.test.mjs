import assert from "node:assert/strict";
import test from "node:test";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import {
  classifyEntityAvailability,
  createAttachmentActions,
  validateAttachment,
} from "../portal/data/attachments.js";
import { attachmentPanelMarkup } from "../portal/ui/attachments-panel.js";
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
    },
    entity,
    access,
    can,
    listId: "clientes-list",
    itemId: "42",
  });

  await actions.uploadAttachment(file());
  await actions.deleteAttachment("CONTRATO.pdf");
  assert.deepEqual(calls.map(([operation, siteKey, listId, itemId]) => [operation, siteKey, listId, itemId]), [
    ["upload", "personal", "clientes-list", "42"],
    ["delete", "personal", "clientes-list", "42"],
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

test("painel lista metadados e historico deriva somente do item SharePoint", () => {
  const attachments = attachmentPanelMarkup({
    availability: "available",
    canEdit: true,
    files: [{ name: "CONTRATO.pdf", type: "application/pdf", size: 2048, author: "ANA", uploadedAt: "2026-08-26T12:00:00Z" }],
  });
  assert.match(attachments, /CONTRATO\.pdf/);
  assert.match(attachments, /ANA/);
  assert.match(attachments, /2 KB/);

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
