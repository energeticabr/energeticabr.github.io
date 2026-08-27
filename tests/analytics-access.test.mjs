import assert from "node:assert/strict";
import test from "node:test";
import {
  analyticsEntitiesForAccess,
  analyticsModuleId,
  canViewAnalyticsPanel,
  visibleAnalyticsDefinitions,
} from "../portal/analytics/analytics-access.js";

const allowed = new Set(["comercial", "rh-obras"]);
const can = (_access, moduleId, action) => action === "view" && allowed.has(moduleId);

test("cada painel analitico herda a permissao do modulo proprietario", () => {
  assert.equal(analyticsModuleId("comercial"), "comercial");
  assert.equal(analyticsModuleId("etapa-obra"), "rh-obras");
  assert.equal(analyticsModuleId("desconhecido"), "");
  assert.equal(canViewAnalyticsPanel("comercial", {}, can), true);
  assert.equal(canViewAnalyticsPanel("financeiro", {}, can), false);
});

test("lista somente paineis e fontes permitidos para a conta", () => {
  const definitions = [{ id: "comercial" }, { id: "financeiro" }, { id: "etapa-obra" }];
  const entities = [
    { id: "clientes", moduleId: "comercial" },
    { id: "lancamentos", moduleId: "financeiro" },
    { id: "oculta", moduleId: "comercial", available: false },
  ];

  assert.deepEqual(visibleAnalyticsDefinitions(definitions, {}, can).map(item => item.id), ["comercial", "etapa-obra"]);
  assert.deepEqual(analyticsEntitiesForAccess(entities, {}, can).map(item => item.id), ["clientes"]);
});
