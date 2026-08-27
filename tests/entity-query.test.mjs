import assert from "node:assert/strict";
import test from "node:test";
import { ENTITIES } from "../portal/catalog/entities.js";
import {
  buildEntityGraphRequest,
  buildEntityFilters,
  createEntityBatchResult,
  createEntityQueryState,
  hasActiveEntityFilters,
  runEntityQuery,
  updateEntityQueryState,
} from "../portal/entities/entity-query.js";

const entity = Object.freeze({
  searchFields: Object.freeze(["Title", "CLIENTE", "FILIAL"]),
  statusFields: Object.freeze(["STATUS"]),
  filterFields: Object.freeze(["STATUS", "FILIAL"]),
});

const columns = Object.freeze([
  { name: "Title", label: "Titulo", control: "text" },
  { name: "STATUS", label: "Status", control: "select", choices: Object.freeze(["ATIVO", "INATIVO"]) },
  { name: "FILIAL", label: "Filial", control: "lookup" },
]);

const items = Object.freeze([
  Object.freeze({ id: "1", fields: Object.freeze({ Title: "PEDIDO 1", CLIENTE: "ANA", STATUS: "ATIVO", FILIALLookupValue: "OURO PRETO" }) }),
  Object.freeze({ id: "2", fields: Object.freeze({ Title: "PEDIDO 2", CLIENTE: "BRUNO", STATUS: "INATIVO", FILIALLookupValue: "DIVINOPOLIS" }) }),
  Object.freeze({ id: "3", fields: Object.freeze({ Title: "PEDIDO 3", CLIENTE: "CARLA", STATUS: "ATIVO", FILIALLookupValue: "DIVINOPOLIS" }) }),
]);

test("o estado de consulta normaliza pagina, tamanho e filtros sem mutar a versao anterior", () => {
  const initial = createEntityQueryState({ page: -2, pageSize: 999, filters: { STATUS: " ATIVO " } });
  assert.deepEqual(initial, {
    search: "",
    page: 1,
    pageSize: 20,
    sort: { field: "Title", direction: "asc" },
    filters: { STATUS: "ATIVO" },
  });

  const changed = updateEntityQueryState(initial, { search: "ana", page: 4 });
  assert.equal(changed.page, 1, "alterar busca deve voltar para a primeira pagina");
  assert.equal(changed.search, "ana");
  assert.equal(initial.search, "");
  assert.equal(Object.isFrozen(changed), true);
  assert.equal(Object.isFrozen(changed.filters), true);
});

test("a pagina e sempre normalizada para um inteiro positivo", () => {
  assert.equal(createEntityQueryState({ page: 2.9 }).page, 2);
  assert.equal(createEntityQueryState({ page: "4.8" }).page, 4);
  assert.equal(createEntityQueryState({ page: 0.9 }).page, 1);
  assert.equal(createEntityQueryState({ page: Number.POSITIVE_INFINITY }).page, 1);
  assert.equal(createEntityQueryState({ page: "invalida" }).page, 1);
});

test("a galeria combina busca e filtros independentes e preserva paginacao coerente", () => {
  const state = createEntityQueryState({
    search: "a",
    pageSize: 1,
    page: 2,
    filters: { STATUS: "ATIVO", FILIAL: "DIVINOPOLIS" },
  });
  const result = runEntityQuery(items, entity, state);

  assert.equal(result.total, 1);
  assert.equal(result.page, 1, "a pagina deve ser limitada ao total filtrado");
  assert.equal(result.items[0].id, "3");
  assert.equal(result.rangeStart, 1);
  assert.equal(result.rangeEnd, 1);
});

test("os filtros da entidade usam escolhas e valores reais sem duplicatas", () => {
  const filters = buildEntityFilters(items, entity, columns);
  assert.deepEqual(filters.map(filter => filter.name), ["STATUS", "FILIAL"]);
  assert.deepEqual(filters[0].options, ["ATIVO", "INATIVO"]);
  assert.deepEqual(filters[1].options, ["DIVINOPOLIS", "OURO PRETO"]);
});

test("colunas ocultas nunca viram filtros mesmo quando declaradas na entidade", () => {
  const hiddenColumns = columns.map(column => column.name === "STATUS" ? { ...column, hidden: true } : column);
  const filters = buildEntityFilters(items, entity, hiddenColumns);
  assert.deepEqual(filters.map(filter => filter.name), ["FILIAL"]);
});

test("detecta filtros ativos inclusive busca, mas ignora valores vazios", () => {
  assert.equal(hasActiveEntityFilters(createEntityQueryState()), false);
  assert.equal(hasActiveEntityFilters(createEntityQueryState({ filters: { STATUS: "" } })), false);
  assert.equal(hasActiveEntityFilters(createEntityQueryState({ search: "ana" })), true);
  assert.equal(hasActiveEntityFilters(createEntityQueryState({ filters: { STATUS: "ATIVO" } })), true);
});

test("mantem compatibilidade com o filtro de status usado pelas galerias anteriores", () => {
  const result = runEntityQuery(items, entity, { status: "INATIVO" });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, "2");
});

test("traduz um filtro exato indexado e uma busca unica em prefixo para o Graph", () => {
  const graphColumns = [
    { name: "Title", label: "Titulo", control: "text", indexed: true },
    { name: "STATUS", label: "Status", control: "select", indexed: true, choices: ["ATIVO", "INATIVO"] },
  ];
  const filtered = buildEntityGraphRequest(entity, graphColumns, createEntityQueryState({
    pageSize: 50,
    filters: { STATUS: "ATIVO" },
  }));
  assert.equal(filtered.blocked, false);
  assert.equal(new URLSearchParams(filtered.query).get("$top"), "50");
  assert.equal(new URLSearchParams(filtered.query).get("$filter"), "fields/STATUS eq 'ATIVO'");

  const searchableEntity = { ...entity, searchFields: ["Title"], filterFields: [] };
  const searched = buildEntityGraphRequest(searchableEntity, graphColumns, createEntityQueryState({ search: "O'HARA" }));
  assert.equal(searched.blocked, false);
  assert.equal(new URLSearchParams(searched.query).get("$filter"), "startswith(fields/Title,'O''HARA')");
});

test("nao percorre a lista quando a busca ou os filtros nao sao seguros no Graph", () => {
  const graphColumns = [
    { name: "Title", label: "Titulo", control: "text", indexed: true },
    { name: "STATUS", label: "Status", control: "select", indexed: true, choices: ["ATIVO"] },
    { name: "FILIAL", label: "Filial", control: "text", indexed: true },
  ];
  const multiSearch = buildEntityGraphRequest(entity, graphColumns, createEntityQueryState({ search: "ANA" }));
  assert.equal(multiSearch.blocked, false);
  assert.equal(multiSearch.mode, "bounded-multi-field-search");
  assert.deepEqual(multiSearch.search.fields, ["Title", "FILIAL"]);
  assert.equal(multiSearch.search.term, "ANA");
  assert.match(multiSearch.notices.join(" "), /resultado completo.*lote|refine/i);

  const multiFilter = buildEntityGraphRequest(entity, graphColumns, createEntityQueryState({ filters: { STATUS: "ATIVO", FILIAL: "CENTRO" } }));
  assert.equal(multiFilter.blocked, true);
  assert.match(multiFilter.limitations.join(" "), /um campo indexado/i);

  const unindexed = buildEntityGraphRequest(
    { ...entity, searchFields: ["Title"] },
    graphColumns.map(column => column.name === "Title" ? { ...column, indexed: false } : column),
    createEntityQueryState({ search: "ANA" }),
  );
  assert.equal(unindexed.blocked, true);
  assert.match(unindexed.limitations.join(" "), /indexad/i);
});

test("traduz intervalo de data da Gallery para um unico campo indexado", () => {
  const request = buildEntityGraphRequest({
    searchFields: [],
    filterDefinitions: [{ kind: "date-range", field: "DATA" }],
  }, [
    { name: "DATA", label: "Data", control: "date", indexed: true },
  ], createEntityQueryState({
    filters: { DATA__gte: "2026-08-01", DATA__lte: "2026-08-31" },
  }));

  assert.equal(request.blocked, false);
  assert.equal(
    new URLSearchParams(request.query).get("$filter"),
    "fields/DATA ge '2026-08-01' and fields/DATA le '2026-08-31'",
  );
});

test("traduz multisselecao da Gallery como alternativas do mesmo campo", () => {
  const request = buildEntityGraphRequest({
    searchFields: [],
    filterDefinitions: [{ kind: "multiple", field: "STATUS" }],
  }, [
    { name: "STATUS", label: "Status", control: "select", indexed: true },
  ], createEntityQueryState({
    filters: { STATUS: '["ATIVO","PENDENTE"]' },
  }));

  assert.equal(request.blocked, false);
  assert.equal(
    new URLSearchParams(request.query).get("$filter"),
    "(fields/STATUS eq 'ATIVO' or fields/STATUS eq 'PENDENTE')",
  );
});

test("filtros comprovados de lookup e pesquisa por trecho usam avaliacao local completa", () => {
  const provenEntity = {
    searchFields: ["OBS"],
    searchDefinitions: [{ kind: "contains", field: "OBS" }],
    searchDefinitionsProven: true,
    filterFields: ["FORNECEDOR"],
    filterDefinitions: [{ kind: "equals", field: "FORNECEDOR" }],
    filterDefinitionsProven: true,
    statusFields: [],
  };
  const provenColumns = [
    { name: "OBS", label: "Observação", control: "text", indexed: true },
    { name: "FORNECEDOR", label: "Fornecedor", control: "lookup", indexed: true },
  ];
  const state = createEntityQueryState({
    search: "trecho central",
    filters: { FORNECEDOR: "ACME" },
  });

  const request = buildEntityGraphRequest(provenEntity, provenColumns, state);

  assert.equal(request.blocked, false);
  assert.equal(request.mode, "bounded-client-query");
  const result = runEntityQuery([
    { id: "1", fields: { OBS: "UM TRECHO CENTRAL DA OBSERVAÇÃO", FORNECEDOR: { LookupValue: "ACME" } } },
    { id: "2", fields: { OBS: "TRECHO CENTRAL", FORNECEDOR: { LookupValue: "OUTRO" } } },
    { id: "3", fields: { OBS: "SEM CORRESPONDÊNCIA", FORNECEDOR: { LookupValue: "ACME" } } },
  ], provenEntity, state);
  assert.deepEqual(result.items.map(item => item.id), ["1"]);
});

test("avaliacao local preserva faixa de data e multisselecao comprovadas", () => {
  const provenEntity = {
    searchFields: [],
    filterDefinitions: [
      { kind: "date-range", field: "DATA" },
      { kind: "multiple", field: "STATUS" },
    ],
    statusFields: [],
  };
  const state = createEntityQueryState({
    filters: {
      DATA__gte: "2026-08-01",
      DATA__lte: "2026-08-31",
      STATUS: '["ATIVO","PENDENTE"]',
    },
  });

  const result = runEntityQuery([
    { id: "1", fields: { DATA: "2026-08-15", STATUS: "ATIVO" } },
    { id: "2", fields: { DATA: "2026-09-01", STATUS: "ATIVO" } },
    { id: "3", fields: { DATA: "2026-08-20", STATUS: "INATIVO" } },
  ], provenEntity, state);

  assert.deepEqual(result.items.map(item => item.id), ["1"]);
});

test("restaura orderby remoto somente para coluna indexada e compativel", () => {
  const graphColumns = [
    { name: "Title", label: "Titulo", control: "text", indexed: true },
    { name: "STATUS", label: "Status", control: "select", indexed: false },
  ];
  const ordered = buildEntityGraphRequest(
    { ...entity, searchFields: ["Title"], filterFields: [] },
    graphColumns,
    createEntityQueryState({ sort: { field: "Title", direction: "desc" } }),
  );
  assert.equal(new URLSearchParams(ordered.query).get("$orderby"), "fields/Title desc");

  const unsupported = buildEntityGraphRequest(
    { ...entity, searchFields: ["Title"], filterFields: [] },
    graphColumns,
    createEntityQueryState({ sort: { field: "STATUS", direction: "asc" } }),
  );
  assert.equal(new URLSearchParams(unsupported.query).has("$orderby"), false);
  assert.match(unsupported.notices.join(" "), /ordenação.*SharePoint/i);
});

test("preserva a ordem natural quando o Power Apps não declara Sort e aceita o ID como ordem segura", () => {
  const natural = createEntityQueryState({ sort: { field: "", direction: "asc" } });
  assert.equal(natural.sort.field, "");
  const request = buildEntityGraphRequest(
    { searchFields: [], filterFields: [] },
    [{ name: "Title", label: "Título", control: "text", indexed: true }],
    createEntityQueryState({ sort: { field: "ID", direction: "desc" } }),
  );
  assert.equal(new URLSearchParams(request.query).get("$orderby"), "fields/ID desc");
});

test("as 45 entidades remanescentes com varios searchFields conservam uma estrategia Graph segura", () => {
  const multiFieldEntities = ENTITIES.filter(candidate => candidate.searchFields.length > 1);
  assert.equal(multiFieldEntities.length, 45);
  for (const candidate of multiFieldEntities) {
    const searchableColumns = candidate.searchFields.map(name => ({ name, label: name, control: "text", indexed: true }));
    const request = buildEntityGraphRequest(candidate, searchableColumns, createEntityQueryState({ search: "TESTE" }));
    assert.equal(request.blocked, false, candidate.id);
    assert.equal(request.mode, "bounded-multi-field-search", candidate.id);
    assert.deepEqual(request.search.fields, candidate.searchFields, candidate.id);
  }
});

test("o resultado incremental conta apenas o ultimo lote sem inventar total global", () => {
  const result = createEntityBatchResult(items.slice(0, 2), createEntityQueryState({ pageSize: 2 }), {
    pageNumber: 3,
    loadedBefore: 4,
    hasMore: true,
  });
  assert.equal(result.batchCount, 2);
  assert.equal(result.loadedCount, 6);
  assert.equal(result.rangeStart, 5);
  assert.equal(result.rangeEnd, 6);
  assert.equal(result.hasMore, true);
  assert.equal(result.isLastBatch, false);
  assert.equal(result.totalKnown, false);
  assert.equal(result.total, undefined);
});
