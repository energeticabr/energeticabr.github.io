import assert from "node:assert/strict";
import test from "node:test";
import { buildSuperAdminAccess, can } from "../portal/access/access-model.js";
import { getEntityActions, loadEntityData } from "../portal/ui/entity-page.js";
import { formMarkup } from "../portal/ui/dynamic-form.js";
import { itemDetailMarkup } from "../portal/ui/item-detail.js";

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
