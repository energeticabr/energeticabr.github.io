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
  assert.match(markup, /data-entity-form-panel/);
  assert.match(markup, /data-entity-form/);
  assert.doesNotMatch(markup, /data-entity-gallery-variant/);
  assert.doesNotMatch(markup, /Selecione a visualização/);
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

test("opcoes dos filtros usam todas as paginas da lista e nao apenas o lote exibido", async () => {
  const galleryCatalog = catalogWith(compactGallery);
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
    async getItemsPage() {
      return { items: [{ id: "1", fields: { GRUPO: "GRUPO A", STATUS: "ATIVO" } }], nextLink: "cursor", hasMore: true };
    },
    async getFilterOptionValues(_siteKey, _listId, fields) {
      assert.deepEqual(fields, ["STATUS"]);
      return { STATUS: ["ATIVO", "INATIVO", "ARQUIVADO"] };
    },
  }, entity, { galleryCatalog, pageSize: 20 });

  const markup = entityGalleryMarkup(entity, data, {
    search: "", page: 1, pageSize: 20, sort: { field: "Title", direction: "asc" }, filters: {},
    formOpen: false, formMode: "create", formVariantIds: { create: "", edit: "" }, message: "", error: "",
  }, { create: true, edit: true });

  assert.match(markup, /<option value="ARQUIVADO">ARQUIVADO<\/option>/);
  assert.match(markup, /<option value="INATIVO">INATIVO<\/option>/);
});

test("consulta bloqueada preserva as opcoes globais ja carregadas", async () => {
  const galleryCatalog = { galleries: [] };
  let optionLoads = 0;
  const data = await loadEntityData({
    async resolveList() { return { status: "resolved", id: "cadastro-grupo-list" }; },
    async getColumns() {
      return [
        { name: "Title", displayName: "Nome", indexed: false, text: {} },
        { name: "GRUPO", displayName: "Grupo", indexed: false, text: {} },
        { name: "STATUS", displayName: "Status", indexed: false, choice: { choices: ["ATIVO", "INATIVO"] } },
      ];
    },
    async getFilterOptionValues() {
      optionLoads += 1;
      return { STATUS: ["ATIVO", "INATIVO", "ARQUIVADO"] };
    },
    async getItemsPage() { throw new Error("consulta bloqueada não deve ler o lote"); },
  }, entity, { galleryCatalog, filters: { STATUS: "ATIVO" }, pageSize: 20 });

  assert.equal(data.query.blocked, true);
  assert.equal(optionLoads, 1);
  assert.deepEqual(data.filterOptionValues, { STATUS: ["ATIVO", "INATIVO", "ARQUIVADO"] });
});

test("contrato conserva a semantica de pesquisa por trecho da Gallery", () => {
  const containsGallery = gallery({
    fileName: "G16- PESQUISA POR TRECHO.pa.yaml",
    screenName: "G16- PESQUISA POR TRECHO",
    galleryName: "GalleryContains",
    items: '=Search(CADASTROGRUPO, Pesquisa.Text, GRUPO)',
    visibleFields: ["GRUPO", "STATUS"],
  });
  const contract = resolvePowerAppsUiContract(entity, columns, {
    galleryCatalog: catalogWith(containsGallery),
  });

  assert.deepEqual(contract.gallerySearch, [{ kind: "contains", field: "GRUPO" }]);
});

test("pesquisa por trecho comprovada consulta a lista completa e pagina o resultado local", async () => {
  const containsGallery = gallery({
    fileName: "G17- PESQUISA LOCAL.pa.yaml",
    screenName: "G17- PESQUISA LOCAL",
    galleryName: "GalleryContainsLocal",
    items: '=Search(CADASTROGRUPO, Pesquisa.Text, GRUPO)',
    visibleFields: ["GRUPO", "STATUS"],
  });
  let fullLoads = 0;
  const data = await loadEntityData({
    async resolveList() { return { status: "resolved", id: "cadastro-grupo-list" }; },
    async getColumns() {
      return [
        { name: "Title", displayName: "Nome", indexed: true, text: {} },
        { name: "GRUPO", displayName: "Grupo", indexed: true, text: {} },
        { name: "STATUS", displayName: "Status", indexed: true, choice: { choices: ["ATIVO"] } },
      ];
    },
    async getItems(_siteKey, _listId, query, options) {
      fullLoads += 1;
      assert.equal(query, "$expand=fields");
      assert.ok(options.signal instanceof AbortSignal);
      return [
        { id: "1", fields: { GRUPO: "ALFA CENTRAL", STATUS: "ATIVO" } },
        { id: "2", fields: { GRUPO: "BETA", STATUS: "ATIVO" } },
      ];
    },
    async getItemsPage() { throw new Error("pesquisa contains não deve usar o lote por prefixo"); },
  }, entity, {
    galleryCatalog: catalogWith(containsGallery),
    search: "central",
    pageSize: 20,
    signal: new AbortController().signal,
  });

  assert.equal(fullLoads, 1);
  assert.equal(data.query.mode, "bounded-client-query");
  assert.equal(data.items.totalKnown, true);
  assert.deepEqual(data.rawItems.map(item => item.id), ["1"]);
});

test("paginacao local reutiliza a lista completa sem nova varredura", async () => {
  const containsGallery = gallery({
    fileName: "G17B- PAGINACAO LOCAL.pa.yaml",
    screenName: "G17B- PAGINACAO LOCAL",
    galleryName: "GalleryContainsPages",
    items: '=Search(CADASTROGRUPO, Pesquisa.Text, GRUPO)',
    visibleFields: ["GRUPO", "STATUS"],
  });
  let fullLoads = 0;
  const repository = {
    async resolveList() { return { status: "resolved", id: "cadastro-grupo-list" }; },
    async getColumns() {
      return [
        { name: "Title", displayName: "Nome", indexed: true, text: {} },
        { name: "GRUPO", displayName: "Grupo", indexed: true, text: {} },
        { name: "STATUS", displayName: "Status", indexed: true, choice: { choices: ["ATIVO"] } },
      ];
    },
    async getItems() {
      fullLoads += 1;
      return [
        { id: "1", fields: { GRUPO: "CENTRAL A", STATUS: "ATIVO" } },
        { id: "2", fields: { GRUPO: "CENTRAL B", STATUS: "ATIVO" } },
      ];
    },
  };
  const options = {
    galleryCatalog: catalogWith(containsGallery), search: "central", pageSize: 1,
  };

  const first = await loadEntityData(repository, entity, { ...options, pageNumber: 1 });
  const second = await loadEntityData(repository, entity, {
    ...options,
    pageNumber: 2,
    clientItems: first.clientItems,
  });

  assert.equal(fullLoads, 1);
  assert.deepEqual(first.rawItems.map(item => item.id), ["1"]);
  assert.deepEqual(second.rawItems.map(item => item.id), ["2"]);
});

test("Gallery vinculada sem Filter nao recebe filtros genericos da entidade", () => {
  const plainGallery = gallery({
    fileName: "G18- LISTA SIMPLES.pa.yaml",
    screenName: "G18- LISTA SIMPLES",
    galleryName: "GalleryPlain",
    items: "=CADASTROGRUPO",
    visibleFields: ["GRUPO", "STATUS"],
  });
  const contract = resolvePowerAppsUiContract(entity, columns, {
    galleryCatalog: catalogWith(plainGallery),
  });

  assert.deepEqual(contract.filterFields, []);
  assert.deepEqual(contract.galleryFilters, []);
  assert.deepEqual(contract.searchFields, ["Title"]);
});

test("filtros comprovados continuam disponiveis quando outra clausula da Gallery e parcial", () => {
  const partialGallery = gallery({
    fileName: "G12- FILTROS PARCIAIS.pa.yaml",
    screenName: "G12- FILTROS PARCIAIS",
    galleryName: "GalleryParcial",
    items: "=Filter(CADASTROGRUPO, IsBlank(GrupoBox.Selected.GRUPO) || GRUPO = GrupoBox.Selected.GRUPO, FormulaNaoSuportada(ThisItem))",
    visibleFields: ["GRUPO", "STATUS"],
  });
  const contract = resolvePowerAppsUiContract(entity, columns, { galleryCatalog: catalogWith(partialGallery) });

  assert.deepEqual(contract.filterFields, ["GRUPO"]);
});

test("intervalo de data comprovado na Gallery gera os dois filtros de data", () => {
  const dateColumns = Object.freeze([
    ...columns,
    { name: "DATA", label: "Data", control: "date", hidden: false, editable: true, indexed: true },
  ]);
  const dateGallery = gallery({
    fileName: "G13- FILTRO DATA.pa.yaml",
    screenName: "G13- FILTRO DATA",
    galleryName: "GalleryData",
    items: "=Filter(CADASTROGRUPO, (IsBlank(DataInicial.SelectedDate) || DateValue(DATA) >= DataInicial.SelectedDate) && (IsBlank(DataFinal.SelectedDate) || DateValue(DATA) <= DataFinal.SelectedDate))",
    visibleFields: ["GRUPO", "DATA"],
  });
  const contract = resolvePowerAppsUiContract(entity, dateColumns, { galleryCatalog: catalogWith(dateGallery) });

  assert.deepEqual(contract.galleryFilters, [{ kind: "date-range", field: "DATA" }]);
  const markup = entityGalleryMarkup(entity, {
    columns: dateColumns,
    uiContract: contract,
    rawItems: [],
    filterOptionValues: {},
    items: { items: [], totalKnown: false, page: 1, pageSize: 20, rangeStart: 0, rangeEnd: 0, batchCount: 0, loadedCount: 0, hasMore: false },
    query: { limitations: [], notices: [] },
  }, {
    search: "", page: 1, pageSize: 20, sort: { field: "Title", direction: "asc" }, filters: {},
    formOpen: false, formMode: "create", formVariantIds: { create: "", edit: "" }, message: "", error: "",
  }, { create: true, edit: true });

  assert.match(markup, /data-entity-filter="DATA__gte"[^>]*type="date"/);
  assert.match(markup, /data-entity-filter="DATA__lte"[^>]*type="date"/);
});

test("filtro multisselecao da Gallery preserva todas as opcoes", () => {
  const multiColumns = Object.freeze([
    ...columns,
    { name: "CONCLUIDO", label: "Concluído", control: "select", hidden: false, editable: true, indexed: true, choices: ["SIM", "NAO"] },
  ]);
  const multiGallery = gallery({
    fileName: "G14- FILTRO MULTIPLO.pa.yaml",
    screenName: "G14- FILTRO MULTIPLO",
    galleryName: "GalleryMultipla",
    items: "=Filter(CADASTROGRUPO, If(IsEmpty(ConcluidoBox.SelectedItems), true, CONCLUIDO in ConcluidoBox.SelectedItems.Value))",
    visibleFields: ["GRUPO", "CONCLUIDO"],
  });
  const contract = resolvePowerAppsUiContract(entity, multiColumns, { galleryCatalog: catalogWith(multiGallery) });

  assert.deepEqual(contract.galleryFilters, [{ kind: "multiple", field: "CONCLUIDO" }]);
  const markup = entityGalleryMarkup(entity, {
    columns: multiColumns,
    uiContract: contract,
    rawItems: [],
    filterOptionValues: { CONCLUIDO: ["SIM", "NAO", "PARCIAL"] },
    items: { items: [], totalKnown: false, page: 1, pageSize: 20, rangeStart: 0, rangeEnd: 0, batchCount: 0, loadedCount: 0, hasMore: false },
    query: { limitations: [], notices: [] },
  }, {
    search: "", page: 1, pageSize: 20, sort: { field: "Title", direction: "asc" }, filters: { CONCLUIDO: '["SIM","PARCIAL"]' },
    formOpen: false, formMode: "create", formVariantIds: { create: "", edit: "" }, message: "", error: "",
  }, { create: true, edit: true });

  assert.match(markup, /data-entity-filter="CONCLUIDO"[^>]*multiple/);
  assert.match(markup, /<option value="PARCIAL" selected>PARCIAL<\/option>/);
  assert.match(markup, /<option value="SIM" selected>SIM<\/option>/);
});

test("checkbox da Gallery conserva o valor fixo do Power Apps", () => {
  const toggleColumns = Object.freeze([
    ...columns,
    { name: "APROVACAO", label: "Aprovação", control: "select", hidden: false, editable: true, indexed: true, choices: ["PENDENTE", "APROVADO"] },
  ]);
  const toggleGallery = gallery({
    fileName: "G15- FILTRO CHECKBOX.pa.yaml",
    screenName: "G15- FILTRO CHECKBOX",
    galleryName: "GalleryCheckbox",
    items: '=Filter(CADASTROGRUPO, !PendentesBox.Value || APROVACAO = "PENDENTE")',
    visibleFields: ["GRUPO", "APROVACAO"],
  });
  const contract = resolvePowerAppsUiContract(entity, toggleColumns, { galleryCatalog: catalogWith(toggleGallery) });

  assert.deepEqual(contract.galleryFilters, [{ kind: "fixed-toggle", field: "APROVACAO", value: "PENDENTE" }]);
  const markup = entityGalleryMarkup(entity, {
    columns: toggleColumns,
    uiContract: contract,
    rawItems: [],
    filterOptionValues: {},
    items: { items: [], totalKnown: false, page: 1, pageSize: 20, rangeStart: 0, rangeEnd: 0, batchCount: 0, loadedCount: 0, hasMore: false },
    query: { limitations: [], notices: [] },
  }, {
    search: "", page: 1, pageSize: 20, sort: { field: "Title", direction: "asc" }, filters: { APROVACAO: "PENDENTE" },
    formOpen: false, formMode: "create", formVariantIds: { create: "", edit: "" }, message: "", error: "",
  }, { create: true, edit: true });

  assert.match(markup, /type="checkbox"[^>]*data-entity-filter="APROVACAO"[^>]*checked/);
  assert.match(markup, /PENDENTE/);
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
