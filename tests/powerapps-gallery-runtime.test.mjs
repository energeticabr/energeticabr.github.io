import assert from "node:assert/strict";
import test from "node:test";

import { buildPowerAppsGalleryUiContracts } from "../portal/catalog/powerapps-gallery-ui-contract.js";
import {
  powerAppsGalleryVariantLabel,
  resolvePowerAppsUiContract,
} from "../portal/catalog/powerapps-ui-contract.js";
import { entityGalleryMarkup, loadEntityData } from "../portal/ui/entity-page.js";

const entity = Object.freeze({
  id: "cadastro-de-grupos",
  moduleId: "suprimentos",
  title: "Cadastro de grupos",
  siteKey: "personal",
  listNames: Object.freeze(["CADASTROGRUPO"]),
  searchFields: Object.freeze(["Title"]),
  filterFields: Object.freeze(["STATUS"]),
  statusFields: Object.freeze([]),
  capabilities: Object.freeze({ view: true, create: true, edit: true }),
});

const columns = Object.freeze([
  { name: "Title", label: "Nome", control: "text", hidden: false, editable: true, indexed: true },
  { name: "GRUPO", label: "Grupo", control: "text", hidden: false, editable: true, indexed: true },
  { name: "STATUS", label: "Status", control: "select", hidden: false, editable: true, indexed: true, choices: ["ATIVO", "INATIVO"] },
  { name: "Modified", label: "Modificado", control: "datetime-local", hidden: false, editable: false, indexed: true },
]);

function gallery({
  fileName,
  screenName,
  galleryName,
  items,
  visibleFields,
}) {
  return {
    fileName,
    screenName,
    galleryName,
    formulas: { items: { status: "resolved", literal: items } },
    visibleFields,
    actions: [],
    primaryAction: { status: "unresolved", reason: "gallery-onselect-not-resolved" },
  };
}

function artifact(fileName) {
  return {
    artifact: fileName,
    moduleId: "suprimentos",
    actions: ["view", "edit"],
    operations: [{
      source: "CADASTROGRUPO",
      entityId: entity.id,
      actions: ["view", "edit"],
      evidence: ["DataSource", "formula-reference"],
    }],
  };
}

function catalogWith(...galleries) {
  return buildPowerAppsGalleryUiContracts({
    galleryCatalog: { schemaVersion: 1, galleries },
    artifacts: galleries.map(entry => artifact(entry.fileName)),
  });
}

const compactGallery = gallery({
  fileName: "G10- HISTORICO GRUPO.pa.yaml",
  screenName: "G10- HISTORICO GRUPO",
  galleryName: "GalleryCompacta",
  items: "=Sort(Filter(CADASTROGRUPO, IsBlank(SearchBox.Text) || StartsWith(GRUPO, SearchBox.Text), IsBlank(StatusBox.Selected.Value) || STATUS = StatusBox.Selected.Value), Modified, SortOrder.Descending)",
  visibleFields: ["STATUS", "GRUPO"],
});

const activeGallery = gallery({
  fileName: "G11- GRUPOS ATIVOS.pa.yaml",
  screenName: "G11- GRUPOS ATIVOS",
  galleryName: "GalleryAtivos",
  items: "=Sort(Filter(CADASTROGRUPO, STATUS = \"ATIVO\"), STATUS, SortOrder.Ascending)",
  visibleFields: ["GRUPO", "STATUS"],
});

test("uma unica Gallery comprovada e selecionada sem depender do modo do Form", () => {
  const galleryCatalog = catalogWith(compactGallery);
  const create = resolvePowerAppsUiContract(entity, columns, { mode: "create", galleryCatalog });
  const edit = resolvePowerAppsUiContract(entity, columns, { mode: "edit", galleryCatalog });

  assert.equal(create.galleryVariant.id, edit.galleryVariant.id);
  assert.deepEqual(create.galleryColumns.map(column => column.name), ["STATUS", "GRUPO"]);
  assert.deepEqual(edit.galleryColumns.map(column => column.name), ["STATUS", "GRUPO"]);
  assert.deepEqual(create.filterFields, ["STATUS"]);
  assert.deepEqual(create.searchFields, ["GRUPO"]);
  assert.deepEqual(create.gallerySort, { field: "Modified", direction: "desc" });
  assert.equal(create.requiresGallerySelection, false);
});

test("multiplas Galleries legitimas exigem escolha explicita e nunca escolhem a primeira", () => {
  const galleryCatalog = catalogWith(compactGallery, activeGallery);
  const unresolved = resolvePowerAppsUiContract(entity, columns, { galleryCatalog });

  assert.equal(unresolved.galleryVariant, null);
  assert.equal(unresolved.requiresGallerySelection, true);
  assert.equal(unresolved.galleryVariants.length, 2);
  assert.deepEqual(unresolved.galleryColumns.map(column => column.name), ["Title", "STATUS"]);

  const selectedId = unresolved.galleryVariants.find(variant => variant.identity.galleryName === "GalleryAtivos").id;
  const selected = resolvePowerAppsUiContract(entity, columns, { galleryCatalog, galleryVariantId: selectedId });
  assert.equal(selected.galleryVariant.identity.galleryName, "GalleryAtivos");
  assert.deepEqual(selected.galleryColumns.map(column => column.name), ["GRUPO", "STATUS"]);
  assert.deepEqual(selected.galleryFixedFilters, { STATUS: "ATIVO" });
  assert.deepEqual(selected.gallerySort, { field: "STATUS", direction: "asc" });
});

test("rotulo da Gallery e legivel e o markup mantem Galeria e Lancamento separados", () => {
  const galleryCatalog = catalogWith(compactGallery, activeGallery);
  const uiContract = resolvePowerAppsUiContract(entity, columns, { galleryCatalog });
  const data = {
    columns,
    uiContract,
    rawItems: [],
    items: { items: [], totalKnown: false, page: 1, pageSize: 20, rangeStart: 0, rangeEnd: 0, batchCount: 0, loadedCount: 0, hasMore: false },
    query: { limitations: [], notices: [] },
  };
  const state = {
    search: "",
    page: 1,
    pageSize: 20,
    sort: { field: "Title", direction: "asc" },
    filters: {},
    formOpen: true,
    formMode: "create",
    formVariantIds: { create: "", edit: "" },
    message: "",
    error: "",
  };
  const markup = entityGalleryMarkup(entity, data, state, { create: true, edit: true });

  assert.equal(powerAppsGalleryVariantLabel(uiContract.galleryVariants[0]), "Historico Grupo");
  assert.match(markup, /data-entity-gallery-view[^>]*>Galeria<\/button>/);
  assert.match(markup, /data-entity-create[^>]*>Lançamento<\/button>/);
  assert.match(markup, /data-entity-gallery-variant/);
  assert.match(markup, /Selecione a visualização/);
  assert.match(markup, /Historico Grupo/);
  assert.match(markup, /Grupos Ativos/);
});

test("consulta aplica filtro fixo e ordenacao seguros da Gallery selecionada", async () => {
  const galleryCatalog = catalogWith(activeGallery);
  const selected = resolvePowerAppsUiContract(entity, columns, { galleryCatalog });
  const queries = [];
  const data = await loadEntityData({
    async resolveList() { return { status: "resolved", id: "cadastro-grupo-list" }; },
    async getColumns() {
      return [
        { name: "Title", displayName: "Nome", indexed: true, text: {} },
        { name: "GRUPO", displayName: "Grupo", indexed: true, text: {} },
        { name: "STATUS", displayName: "Status", indexed: true, choice: { choices: ["ATIVO", "INATIVO"] } },
        { name: "Modified", displayName: "Modificado", indexed: true, dateTime: {} },
      ];
    },
    async getItemsPage(_siteKey, _listId, query) {
      queries.push(new URLSearchParams(query));
      return { items: [], nextLink: "", hasMore: false };
    },
  }, entity, { galleryCatalog, galleryVariantId: selected.galleryVariant.id, pageSize: 20 });

  assert.equal(data.uiContract.galleryVariant.identity.galleryName, "GalleryAtivos");
  assert.equal(queries[0].get("$filter"), "fields/STATUS eq 'ATIVO'");
  assert.equal(queries[0].get("$orderby"), "fields/STATUS asc");
});

test("Gallery nao comprovada conserva exatamente o fallback atual", () => {
  const galleryCatalog = catalogWith(gallery({
    ...compactGallery,
    fileName: "G99- OUTRA FONTE.pa.yaml",
    screenName: "G99- OUTRA FONTE",
    galleryName: "GalleryInvalida",
    items: "=OUTRA_FONTE",
  }));
  const fallback = resolvePowerAppsUiContract(entity, columns, { galleryCatalog });

  assert.equal(fallback.galleryVariant, null);
  assert.equal(fallback.requiresGallerySelection, false);
  assert.deepEqual(fallback.galleryColumns.map(column => column.name), ["Title", "STATUS"]);
  assert.deepEqual(fallback.searchFields, ["Title"]);
  assert.deepEqual(fallback.filterFields, ["STATUS"]);
});
