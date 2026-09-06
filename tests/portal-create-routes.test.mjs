import assert from "node:assert/strict";
import test from "node:test";

import { buildSuperAdminAccess } from "../portal/access/access-model.js";
import { ENTITIES } from "../portal/catalog/entities.js";
import { MODULES } from "../portal/catalog/modules.js";
import { getPowerAppsUiContract } from "../portal/catalog/powerapps-ui-contract.js";
import { isRouteAllowed } from "../portal/app.js";
import { PORTAL_ROUTES, createRouter } from "../portal/core/router.js";

const EXPECTED_CREATE_IDS = Object.freeze([
  "lancamentos",
  "tipos-de-material",
  "unidades-de-medida",
  "funcoes-de-imobilizado",
  "despesas-recorrentes",
  "filiais",
  "fornecedores",
  "grupos-de-imobilizados",
  "imobilizados",
  "cadastro-de-imobilizados",
  "cadastro-de-grupos",
  "contas",
  "cidades",
  "familias",
  "cadastro-de-subfamilias",
  "produtos",
  "compras",
  "notas-pendentes",
  "homologacoes-de-fornecedor",
  "novas-cotacoes",
  "orcamentos",
  "tarefas-delegadas",
  "cadastro-de-tarefas",
  "lancamentos-de-tarefas",
  "tarefas-recorrentes",
  "receitas",
  "corretores",
  "apontamentos-comerciais",
  "tipos-de-marco",
  "provisoes-de-pagamento",
  "demonstrativos-de-etapa",
  "descricoes-de-medicao",
  "diarios-de-obras",
  "apontamentos-de-funcionarios",
  "descricoes-de-presenca",
  "empreiteiros",
  "lancamentos-de-obras",
  "profissoes",
  "atividades-executadas",
  "inconsistencias",
  "documentos-operacionais",
  "linhas-de-contrato",
  "linhas-de-medicao",
  "imoveis",
  "inquilinos",
  "grupos-de-imoveis",
  "cadastro-de-imoveis-locacao",
  "formas-de-pagamento-de-locacao",
  "fornecedores-de-locacao",
  "homologacoes-de-locacao",
  "lancamentos-de-aluguel",
  "produtos-de-locacao",
  "previsoes-de-locacao",
  "recorrencias-de-locacao",
  "responsaveis-por-pagamento",
  "tipos-de-homologacao-de-locacao",
  "tipos-de-auditoria",
  "tipos-de-documento",
  "grupos-de-documentos-por-filial",
]);

function windowDouble() {
  return { location: { hash: "#/dashboard" }, addEventListener() {}, removeEventListener() {} };
}

test("as 59 criacoes em escopo abrem o formulario publicado e respeitam autorizacao", () => {
  const actual = ENTITIES.filter(entity => {
    if (entity.available === false || entity.capabilities?.create !== true) return false;
    if (["clientes", "tickets", "movimentacoes-de-tickets"].includes(entity.id)) return false;
    const contract = getPowerAppsUiContract(entity.id, { mode: "create" });
    return contract.hasForm && !contract.readOnly && !contract.requiresVariantSelection && contract.formFields.length > 0;
  });
  assert.deepEqual(actual.map(entity => entity.id), EXPECTED_CREATE_IDS);

  const fullAccess = buildSuperAdminAccess("bernardonotini@energeticabr.com", "Bernardo", MODULES);
  const viewOnly = buildSuperAdminAccess("leitura@energeticabr.com", "Leitura", MODULES);
  for (const module of MODULES) viewOnly.permissions[module.id].create = false;
  const router = createRouter(PORTAL_ROUTES, { window: windowDouble() });

  for (const entity of actual) {
    const contract = getPowerAppsUiContract(entity.id, { mode: "create" });
    const hash = `#/entity/${encodeURIComponent(entity.id)}/new`;
    const route = router.parse(hash);
    assert.equal(route.name, "entity-create", entity.id);
    assert.equal(router.href("entity-create", { entityId: entity.id }), hash, entity.id);
    assert.equal(contract.hasForm, true, entity.id);
    assert.equal(contract.readOnly, false, entity.id);
    assert.equal(contract.requiresVariantSelection, false, entity.id);
    assert.ok(contract.formVariant || entity.id === "homologacoes-de-fornecedor", entity.id);
    assert.ok(contract.formFields.length > 0, entity.id);
    assert.equal(isRouteAllowed(route, { access: fullAccess, isSuperAdmin: true }), true, entity.id);
    assert.equal(isRouteAllowed(route, { access: viewOnly, isSuperAdmin: false }), false, entity.id);
    assert.equal(isRouteAllowed({ name: "entity", params: route.params }, { access: viewOnly, isSuperAdmin: false }), true, entity.id);
  }
});

test("cotacao, orcamento e presenca usam os formularios de criacao publicados", () => {
  const cotacao = getPowerAppsUiContract("novas-cotacoes", { mode: "create" }).formVariant;
  const orcamento = getPowerAppsUiContract("orcamentos", { mode: "create" }).formVariant;
  const presenca = getPowerAppsUiContract("descricoes-de-presenca", { mode: "create" }).formVariant;

  assert.equal(cotacao?.id, "Screen12.pa.yaml#Form36");
  assert.equal(cotacao?.dataSource, "NOVACOTACAO");
  assert.ok(cotacao?.submitEvidence?.evidence?.includes("SubmitForm:Form36"));
  assert.equal(orcamento?.id, "Screen12_1.pa.yaml#Form36_2");
  assert.equal(orcamento?.dataSource, "ORCAMENTOS");
  assert.ok(orcamento?.submitEvidence?.evidence?.includes("SubmitForm:Form36_2"));
  assert.equal(presenca?.id, "G17- HISTÓRICODEMONSTRATIVOPRESENCA.pa.yaml#Form20_2");
  assert.equal(presenca?.dataSource, "DESCRITIVOPRESENCA");
  assert.ok(presenca?.modes?.includes("create"));
});

test("clientes, tickets e movimentacoes permanecem fora do escopo desta entrega", () => {
  assert.equal(EXPECTED_CREATE_IDS.some(id => /^(clientes|tickets|movimentacoes-de-tickets)$/.test(id)), false);
});
