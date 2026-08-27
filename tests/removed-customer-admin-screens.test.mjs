import assert from "node:assert/strict";
import test from "node:test";

import { ENTITIES, entitiesForModule } from "../portal/catalog/entities.js";

const REMOVED_ENTITY_IDS = Object.freeze([
  "tickets-clientes",
  "movimentacoes-de-ticket",
  "comunicacoes-clientes",
  "movimentacoes-de-comunicacao",
  "fonte-teste-legada",
]);

const REMAINING_DEMAND_ENTITY_IDS = Object.freeze([
  "mensagens-programadas",
  "tarefas-delegadas",
  "cadastro-de-tarefas",
  "lancamentos-de-tarefas",
  "dificuldades",
  "impactos",
  "tarefas-recorrentes",
]);

test("o catalogo nao expoe as telas administrativas de tickets e comunicacoes de clientes", () => {
  for (const entityId of REMOVED_ENTITY_IDS) {
    assert.equal(ENTITIES.some(entity => entity.id === entityId), false, entityId);
  }
});

test("Demandas preserva somente as demais entidades depois da remocao", () => {
  assert.deepEqual(
    entitiesForModule("demandas").map(entity => entity.id),
    REMAINING_DEMAND_ENTITY_IDS,
  );
});
