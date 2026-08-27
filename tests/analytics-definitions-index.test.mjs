import assert from "node:assert/strict";
import test from "node:test";
import { ANALYTICS_DEFINITIONS, analyticsDefinitionById } from "../portal/analytics/definitions/index.js";

test("registro analitico disponibiliza os seis paineis sem IDs repetidos", () => {
  assert.deepEqual(ANALYTICS_DEFINITIONS.map(definition => definition.id), [
    "comercial",
    "financeiro",
    "recursos-humanos",
    "etapa-obra",
    "imobilizado",
    "auditoria",
  ]);
  assert.equal(new Set(ANALYTICS_DEFINITIONS.map(definition => definition.id)).size, 6);
  assert.equal(Object.isFrozen(ANALYTICS_DEFINITIONS), true);
});

test("consulta de painel e fechada para identificadores desconhecidos", () => {
  assert.equal(analyticsDefinitionById("financeiro")?.title, "FINANCEIRO");
  assert.equal(analyticsDefinitionById("desconhecido"), undefined);
  assert.equal(analyticsDefinitionById(""), undefined);
});
