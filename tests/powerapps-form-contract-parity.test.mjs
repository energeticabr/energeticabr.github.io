import assert from "node:assert/strict";
import test from "node:test";

import ENTITIES from "../portal/catalog/entities.js";
import { POWERAPPS_FORM_VARIANTS } from "../portal/catalog/powerapps-form-controls.generated.js";
import {
  getPowerAppsUiContract,
  resolvePowerAppsUiContract,
} from "../portal/catalog/powerapps-ui-contract.js";
import { extractPowerAppsFormFields } from "../scripts/generate-powerapps-form-contracts.mjs";

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

test("contrato Patch explicito restaura somente homologacoes de fornecedor", () => {
  const inventory = `### HOMOLOGARFORNECEDOR
- **Entidade no portal:** Homologações de fornecedor (\`homologacoes-de-fornecedor\`).
- **Evidência de gravação:** 0 formulário(s), 0 chamado(s) por \`SubmitForm\`; 2 ocorrência(s) de \`Patch\`.
- **Campos gravados por Patch:** \`APROVADO\`, \`DATA\`, \`FILIAL\`, \`FORNECEDOR\`.

### TICKETS
- **Entidade no portal:** Tickets (\`tickets\`).
- **Evidência de gravação:** 0 formulário(s), 0 chamado(s) por \`SubmitForm\`; 1 ocorrência(s) de \`Patch\`.
- **Campos gravados por Patch:** \`Title\`.
`;
  const contracts = extractPowerAppsFormFields(inventory, ENTITIES);

  assert.deepEqual(contracts["homologacoes-de-fornecedor"], ["APROVADO", "DATA", "FILIAL", "FORNECEDOR"]);
  assert.equal(Object.hasOwn(contracts, "tickets"), false);
});

test("rotas create comprovadas permanecem expostas pela evidência exata de modo", () => {
  const expectedVariants = {
    "cadastro-de-tarefas": "F1- CADASTRO ASSOCIAÇÃO.pa.yaml#CADASTROASSOCIAÇÃO",
    "tipos-de-auditoria": "I8- GERAL AUDITORIA.pa.yaml#Form28",
    "lancamentos-de-aluguel": "Screen2.pa.yaml#Form10",
    "homologacoes-de-locacao": "Screen4_1.pa.yaml#Form39_3",
  };
  for (const [entityId, variantId] of Object.entries(expectedVariants)) {
    const contract = getPowerAppsUiContract(entityId, { mode: "create" });
    assert.equal(contract.hasForm, true, `${entityId} perdeu a rota create`);
    assert.equal(contract.readOnly, false, `${entityId} bloqueou a rota create`);
    assert.equal(contract.formVariant?.id, variantId);
    assert.equal(contract.formVariant.modeEvidence.some(evidence => evidence.action === "create"), true);
  }

  const patchContract = getPowerAppsUiContract("homologacoes-de-fornecedor", { mode: "create" });
  assert.equal(patchContract.hasForm, true);
  assert.equal(patchContract.readOnly, false);
  assert.deepEqual(patchContract.formFields, [
    "APROVADO", "COBRAR", "COMPRIMIR", "DATA", "FILIAL", "FORNECEDOR", "STATUS", "TIPODOCUMENTO",
  ]);
  assert.equal(getPowerAppsUiContract("homologacoes-de-fornecedor", { mode: "edit" }).hasForm, false);
});

test("todo grupo com mais de um Form exige escolha e nunca usa o primeiro arbitrariamente", () => {
  const choices = [];
  for (const entity of ENTITIES) {
    for (const mode of ["create", "edit"]) {
      const contract = getPowerAppsUiContract(entity.id, { mode });
      if (contract.formVariants.length < 2) continue;
      choices.push(`${entity.id}:${mode}`);
      assert.equal(contract.formVariant, null, `${entity.id}:${mode} escolheu o primeiro Form`);
      assert.equal(contract.requiresVariantSelection, true, `${entity.id}:${mode} não exige seleção`);
      assert.deepEqual(contract.formFields, [], `${entity.id}:${mode} achatou campos antes da escolha`);
    }
  }
  assert.ok(choices.length >= 24, `esperadas ao menos 24 escolhas reais; encontradas ${choices.length}`);
});

test("todo contrato do catalogo elimina o curinga e declara se existe Form Power Apps", () => {
  const entitiesWithForm = new Set(FORM_ENTITY_IDS);
  const entitiesWithPatchForm = new Set(["homologacoes-de-fornecedor"]);

  for (const entity of ENTITIES) {
    const expectedHasForm = entitiesWithForm.has(entity.id) || entitiesWithPatchForm.has(entity.id);
    assert.equal(Boolean(POWERAPPS_FORM_VARIANTS[entity.id]?.length), entitiesWithForm.has(entity.id), `${entity.id} tem classificacao de Form incorreta`);
    for (const mode of ["create", "edit"]) {
      const contract = getPowerAppsUiContract(entity.id, { mode });
      assert.equal(contract.formFields.includes("*"), false, `${entity.id} ainda usa curinga em ${mode}`);
      assert.equal(
        contract.readOnly,
        !contract.hasForm || (contract.formVariants.length > 0 && !contract.formVariant),
        `${entity.id} tem modo ${mode} incoerente`,
      );
      if (contract.formVariantConflict) {
        assert.equal(contract.formVariant, null, `${entity.id} nao deve escolher arbitrariamente uma variante ${mode}`);
        assert.equal(contract.requiresVariantSelection, true, `${entity.id} deveria exigir selecao da variante ${mode}`);
        assert.ok(contract.formVariants.length > 1, `${entity.id} deveria expor variantes ${mode}`);
      }
      if (!expectedHasForm) assert.deepEqual(contract.formFields, [], `${entity.id} deveria ficar sem formulario`);
    }
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

test("contrato de lancamentos expoe Title somente como FILIAL fechado e relacional", () => {
  const declared = getPowerAppsUiContract("lancamentos");
  const resolved = resolvePowerAppsUiContract(
    ENTITIES.find(entity => entity.id === "lancamentos"),
    [editableColumn("Title"), editableColumn("FILIAL"), editableColumn("DATA")],
  );
  const filial = resolved.formColumns.find(column => column.name === "Title");

  assert.equal(declared.formFields.includes("Title"), true);
  assert.equal(filial.control, "select");
  assert.equal(filial.powerApps.optionSources[0].entityId, "filiais");
});

test("produto usa nomes internos do Form F37 e rejeita campo estranho", () => {
  const variant = "F37- CADASTRO PRODUTO.pa.yaml#Form1_5";
  const declared = getPowerAppsUiContract("produtos", { mode: "create", formVariantId: variant });
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
  ], { mode: "create", formVariantId: variant });

  assert.deepEqual(declared.formFields, [
    "Title",
    "field_1",
    "TIPODESPESA",
    "UNIDADE",
    "SATUS",
    "TIPO",
    "GERADESEMBOLSO",
  ]);
  assert.deepEqual(resolved.formColumns.map(column => column.name), declared.formFields);
});

test("produto expoe Forms create comprovados sem unir o conjunto menor de F44", () => {
  const defaultContract = getPowerAppsUiContract("produtos", { mode: "create" });
  const revenueContract = getPowerAppsUiContract("produtos", {
    mode: "create",
    formVariantId: "F44- LANÇAMENTO RECEITA.pa.yaml#Form1_44",
  });

  assert.equal(defaultContract.formVariant, null);
  assert.equal(defaultContract.formVariantConflict, true);
  assert.equal(defaultContract.requiresVariantSelection, true);
  assert.deepEqual(defaultContract.formFields, []);
  assert.deepEqual(defaultContract.formVariants.map(variant => variant.id), [
    "F37- CADASTRO PRODUTO.pa.yaml#Form1_5",
    "F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml#Form1_34",
    "F44- LANÇAMENTO RECEITA.pa.yaml#Form1_44",
  ]);
  assert.deepEqual(revenueContract.formFields, [
    "Title",
    "field_1",
    "TIPO",
    "GERADESEMBOLSO",
    "SATUS",
  ]);
  assert.equal(revenueContract.formFields.includes("TIPODESPESA"), false);
  assert.equal(revenueContract.formFields.includes("UNIDADE"), false);
});

test("galeria generica preserva a ordem dos controles visiveis da Gallery Power Apps", () => {
  const variant = "F37- CADASTRO PRODUTO.pa.yaml#Form1_5";
  const entity = ENTITIES.find(candidate => candidate.id === "produtos");
  const resolved = resolvePowerAppsUiContract(entity, [
    editableColumn("CAMPO_FORA_DO_POWERAPPS"),
    editableColumn("GERADESEMBOLSO"),
    Object.freeze({ ...editableColumn("field_1"), label: "SUBFAMÍLIA" }),
    Object.freeze({ ...editableColumn("SATUS"), label: "STATUS" }),
    Object.freeze({ ...editableColumn("Title"), label: "PRODUTO" }),
    editableColumn("TIPO"),
    editableColumn("TIPODESPESA"),
    editableColumn("UNIDADE"),
  ], { mode: "create", formVariantId: variant });

  assert.equal(resolved.galleryColumns.some(column => column.name === "CAMPO_FORA_DO_POWERAPPS"), false);
  assert.deepEqual(resolved.galleryColumns.map(column => column.name), [
    "Title",
    "field_1",
    "SATUS",
    "TIPO",
    "GERADESEMBOLSO",
    "TIPODESPESA",
  ]);
});
