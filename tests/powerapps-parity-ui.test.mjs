import assert from "node:assert/strict";
import test from "node:test";

import {
  getPowerAppsUiContract,
  resolvePowerAppsUiContract,
} from "../portal/catalog/powerapps-ui-contract.js";
import {
  formatGalleryValue,
  matchesGallerySearchTerms,
  normalizeGallerySearchTerms,
} from "../portal/gallery/gallery-model.js";
import { createMultiEntryQueue } from "../portal/forms/multi-entry.js";
import { persistEntityRecord } from "../portal/forms/entity-submit.js";
import { entityGalleryMarkup, loadEntityData } from "../portal/ui/entity-page.js";

const entity = Object.freeze({
  id: "lancamentos",
  moduleId: "suprimentos",
  title: "Lançamentos",
  siteKey: "personal",
  searchFields: Object.freeze(["Title", "FORNECEDOR", "DESCRICAO"]),
  statusFields: Object.freeze(["STATUS"]),
  capabilities: Object.freeze({ view: true, create: true, edit: true }),
});

const columns = Object.freeze([
  { name: "ID", label: "ID", control: "number", hidden: false, editable: false },
  { name: "Title", label: "Título", control: "text", hidden: false, editable: true, indexed: true },
  { name: "FILIAL", label: "Filial", control: "select", choices: ["001", "002"], hidden: false, editable: true, indexed: true },
  { name: "DATA", label: "Data", control: "date", hidden: false, editable: true, indexed: true },
  { name: "FORNECEDOR", label: "Fornecedor", control: "lookup", hidden: false, editable: true, indexed: true },
  { name: "DESCRICAO", label: "Descrição", control: "textarea", hidden: false, editable: true, indexed: true },
  { name: "STATUS", label: "Status", control: "select", choices: ["PENDENTE", "CONCLUÍDO"], hidden: false, editable: true, indexed: true },
  { name: "Created", label: "Criado", control: "datetime-local", hidden: false, editable: false },
  { name: "Editor", label: "Modificado por", control: "person", hidden: false, editable: false },
]);

test("o contrato Power Apps define formulario, galeria, filtros e lancamento multiplo sem campos tecnicos", () => {
  const declared = getPowerAppsUiContract(entity.id);
  const contract = resolvePowerAppsUiContract(entity, columns);

  assert.equal(declared.multiple, true);
  assert.deepEqual(contract.formColumns.map(column => column.name), ["Title", "FILIAL", "DATA", "FORNECEDOR", "DESCRICAO", "STATUS"]);
  assert.deepEqual(contract.galleryColumns.map(column => column.name), ["Title", "FILIAL", "DATA", "FORNECEDOR", "DESCRICAO", "STATUS"]);
  assert.deepEqual(contract.filterFields, ["FILIAL", "STATUS"]);
  assert.deepEqual(contract.searchFields, ["Title", "FORNECEDOR", "DESCRICAO"]);
  assert.equal(contract.multiple, true);
  assert.equal(contract.formColumns.some(column => ["ID", "Created", "Editor"].includes(column.name)), false);
});

test("a galeria mostra datas curtas pt-BR e pesquisa todos os termos em campos diferentes", () => {
  assert.equal(formatGalleryValue({ DATA: "2026-08-26T18:45:00Z" }, { name: "DATA", control: "datetime-local" }), "26/08/2026");
  assert.equal(formatGalleryValue({ DATA: "2026-08-26T01:00:00Z" }, { name: "DATA", control: "datetime-local" }), "25/08/2026");
  assert.equal(formatGalleryValue({ DATA: "2026-08-26" }, { name: "DATA", control: "date" }), "26/08/2026");
  assert.deepEqual(normalizeGallerySearchTerms("  ana   bandeirante ANA  "), ["ANA", "BANDEIRANTE"]);
  assert.equal(matchesGallerySearchTerms(
    { Title: "ANA SILVA", EMPREENDIMENTO: "CONDOMÍNIO BANDEIRANTE" },
    ["Title", "EMPREENDIMENTO"],
    ["ANA", "BANDEIRANTE"],
  ), true);
  assert.equal(matchesGallerySearchTerms(
    { Title: "ANA SILVA", EMPREENDIMENTO: "CONDOMÍNIO BANDEIRANTE" },
    ["Title", "EMPREENDIMENTO"],
    ["ANA", "OURO PRETO"],
  ), false);
});

test("a busca com varios termos consulta pelo primeiro e refina o lote por todos", async () => {
  const searches = [];
  const data = await loadEntityData({
    async resolveList() { return { status: "resolved", id: "lancamentos-list" }; },
    async getColumns() { return columns.map(column => ({ ...column, indexed: true })); },
    async getItemsPage() { throw new Error("a busca contratada deve usar a pesquisa estruturada"); },
    async searchItemsPage(_siteKey, _listId, search) {
      searches.push(search);
      return {
        items: [
          { id: "1", fields: { Title: "ANA SILVA", FORNECEDOR: "BANDEIRANTE MATERIAIS", DESCRICAO: "CIMENTO" } },
          { id: "2", fields: { Title: "ANA COSTA", FORNECEDOR: "OUTRO", DESCRICAO: "CIMENTO" } },
        ],
        nextLink: "",
        hasMore: false,
      };
    },
  }, entity, { search: "ana bandeirante", pageSize: 20 });

  assert.equal(searches.length, 1);
  assert.equal(searches[0].term, "ANA");
  assert.deepEqual(data.rawItems.map(item => item.id), ["1"]);
});

test("a fila multipla adiciona, remove e conserva o resultado individual de cada linha", async () => {
  const queue = createMultiEntryQueue();
  const first = queue.add({ Title: "ITEM A" }, { Title: "ITEM A" });
  const removed = queue.add({ Title: "REMOVER" }, { Title: "REMOVER" });
  const second = queue.add({ Title: "ITEM B" }, { Title: "ITEM B" });
  queue.remove(removed.id);

  const result = await queue.submitAll(async row => {
    if (row.fields.Title === "ITEM B") throw new Error("Falha B");
    return { id: "101", fields: row.fields };
  });

  assert.deepEqual(result.map(row => [row.id, row.status, row.message]), [
    [first.id, "success", "Registro criado com sucesso."],
    [second.id, "error", "Falha B"],
  ]);
  assert.equal(queue.snapshot().length, 2);
});

test("a persistencia usa create para cadastro e update com ETag para edicao", async () => {
  const calls = [];
  const repository = {
    async createItem(...args) { calls.push(["create", ...args]); return { id: "8", fields: args[2] }; },
    async updateItem(...args) { calls.push(["edit", ...args]); return { id: args[2], eTag: '"2,1"', fields: args[3] }; },
  };
  await persistEntityRecord(repository, entity, { id: "list-1" }, { mode: "create", fields: { Title: "NOVO" } });
  await persistEntityRecord(repository, entity, { id: "list-1" }, {
    mode: "edit",
    item: { id: "7", eTag: '"1,1"', fields: { Title: "ANTIGO" } },
    fields: { Title: "EDITADO" },
  });

  assert.deepEqual(calls, [
    ["create", "personal", "list-1", { Title: "NOVO" }],
    ["edit", "personal", "list-1", "7", { Title: "EDITADO" }, { eTag: '"1,1"' }],
  ]);
});

test("o componente mantem formulario e galeria juntos e troca Abrir por Editar", () => {
  const data = {
    columns,
    rawItems: [{ id: "7", fields: { Title: "ANA", FILIAL: "001", DATA: "2026-08-26", FORNECEDOR: "ACME", DESCRICAO: "TESTE", STATUS: "PENDENTE" } }],
    items: { items: [{ id: "7", fields: { Title: "ANA", FILIAL: "001", DATA: "2026-08-26", FORNECEDOR: "ACME", DESCRICAO: "TESTE", STATUS: "PENDENTE" } }], totalKnown: false, page: 1, pageSize: 20, rangeStart: 1, rangeEnd: 1, batchCount: 1, loadedCount: 1, hasMore: false },
    query: { limitations: [], notices: [] },
  };
  const markup = entityGalleryMarkup(entity, data, {
    search: "", page: 1, pageSize: 20, sort: { field: "Title", direction: "asc" }, filters: {}, message: "", error: "",
  }, { create: true, edit: true, approve: false });

  assert.match(markup, /class="entity-split-workspace access-grid" data-entity-workspace/);
  assert.match(markup, /data-entity-form/);
  assert.match(markup, /data-entity-gallery/);
  assert.match(markup, /data-entity-edit="7"[^>]*>Editar</);
  assert.doesNotMatch(markup, />Abrir</);
});
