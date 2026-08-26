import assert from "node:assert/strict";
import test from "node:test";
import {
  buildEntityFilters,
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
