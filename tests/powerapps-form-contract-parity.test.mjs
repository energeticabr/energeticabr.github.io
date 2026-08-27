import assert from "node:assert/strict";
import test from "node:test";

import ENTITIES from "../portal/catalog/entities.js";
import {
  getPowerAppsUiContract,
  resolvePowerAppsUiContract,
} from "../portal/catalog/powerapps-ui-contract.js";

const FORM_ENTITY_IDS = Object.freeze([
  "apontamentos-comerciais",
  "apontamentos-de-funcionarios",
  "atividades-executadas",
  "auditorias",
  "cadastro-de-grupos",
  "cadastro-de-imobilizados",
  "cadastro-de-imoveis-locacao",
  "cadastro-de-subfamilias",
  "cadastro-de-tarefas",
  "cadastros-de-aluguel",
  "cidades",
  "clientes",
  "compras",
  "contas",
  "corretores",
  "demonstrativos-de-etapa",
  "descricoes-de-medicao",
  "descricoes-de-presenca",
  "despesas-recorrentes",
  "diarios-de-obras",
  "documentos-operacionais",
  "empreiteiros",
  "familias",
  "filiais",
  "fonte-teste-legada",
  "formas-de-pagamento-de-locacao",
  "fornecedores",
  "fornecedores-de-locacao",
  "funcoes-de-imobilizado",
  "grupos-de-documentos-por-filial",
  "grupos-de-imobilizados",
  "grupos-de-imoveis",
  "homologacoes-de-locacao",
  "imobilizados",
  "imoveis",
  "inconsistencias",
  "inquilinos",
  "lancamentos",
  "lancamentos-de-aluguel",
  "lancamentos-de-obras",
  "lancamentos-de-tarefas",
  "linhas-de-contrato",
  "linhas-de-medicao",
  "mensagens-programadas",
  "notas-pendentes",
  "novas-cotacoes",
  "orcamentos",
  "patologias-sac",
  "previsoes-de-locacao",
  "produtos",
  "produtos-de-locacao",
  "profissoes",
  "provisoes-de-pagamento",
  "receitas",
  "recorrencias-de-locacao",
  "responsaveis-por-pagamento",
  "tarefas-delegadas",
  "tarefas-recorrentes",
  "tipos-de-auditoria",
  "tipos-de-documento",
  "tipos-de-homologacao-de-locacao",
  "tipos-de-marco",
  "tipos-de-material",
  "tipos-de-patologia",
  "unidades-de-medida",
]);

function editableColumn(name) {
  return Object.freeze({ name, label: name, control: "text", hidden: false, editable: true });
}

test("todo contrato do catalogo elimina o curinga e declara se existe Form Power Apps", () => {
  const entitiesWithForm = new Set(FORM_ENTITY_IDS);

  for (const entity of ENTITIES) {
    const contract = getPowerAppsUiContract(entity.id);
    const expectedHasForm = entitiesWithForm.has(entity.id);

    assert.equal(contract.formFields.includes("*"), false, `${entity.id} ainda usa curinga`);
    assert.equal(contract.hasForm, expectedHasForm, `${entity.id} tem classificacao de Form incorreta`);
    assert.equal(contract.readOnly, !expectedHasForm, `${entity.id} tem modo de escrita incorreto`);
    if (!expectedHasForm) assert.deepEqual(contract.formFields, [], `${entity.id} deveria ficar sem formulario`);
  }
});

test("entidade sem Form comprovado resolve sem nenhuma coluna editavel", () => {
  const entity = ENTITIES.find(candidate => candidate.id === "urgencias");
  const contract = resolvePowerAppsUiContract(entity, [
    editableColumn("Title"),
    editableColumn("STATUS"),
    editableColumn("CAMPO_FORA_DO_POWERAPPS"),
  ]);

  assert.equal(contract.hasForm, false);
  assert.equal(contract.readOnly, true);
  assert.deepEqual(contract.formColumns, []);
});

test("contrato manual de lancamentos nunca expoe Title no formulario", () => {
  const declared = getPowerAppsUiContract("lancamentos");
  const resolved = resolvePowerAppsUiContract(
    ENTITIES.find(entity => entity.id === "lancamentos"),
    [editableColumn("Title"), editableColumn("FILIAL"), editableColumn("DATA")],
  );

  assert.equal(declared.formFields.includes("Title"), false);
  assert.equal(resolved.formColumns.some(column => column.name === "Title"), false);
});

test("produto usa nomes internos inventariados e rejeita campo estranho ao Form", () => {
  const declared = getPowerAppsUiContract("produtos");
  const entity = ENTITIES.find(candidate => candidate.id === "produtos");
  const resolved = resolvePowerAppsUiContract(entity, [
    editableColumn("GERADESEMBOLSO"),
    editableColumn("field_1"),
    editableColumn("SATUS"),
    editableColumn("Title"),
    editableColumn("TIPO"),
    editableColumn("TIPODESPESA"),
    editableColumn("UNIDADE"),
    editableColumn("CAMPO_FORA_DO_POWERAPPS"),
    editableColumn("Attachments"),
  ]);

  assert.deepEqual(declared.formFields, [
    "GERADESEMBOLSO",
    "field_1",
    "SATUS",
    "Title",
    "TIPO",
    "TIPODESPESA",
    "UNIDADE",
  ]);
  assert.deepEqual(resolved.formColumns.map(column => column.name), declared.formFields);
});
