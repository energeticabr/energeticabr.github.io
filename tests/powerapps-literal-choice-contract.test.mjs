import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ENTITIES from "../portal/catalog/entities.js";
import POWERAPPS_FORM_FIELDS from "../portal/catalog/powerapps-form-contracts.generated.js";
import POWERAPPS_FORM_CONTROLS from "../portal/catalog/powerapps-form-controls.generated.js";
import { resolvePowerAppsUiContract } from "../portal/catalog/powerapps-ui-contract.js";
import { formMarkup } from "../portal/ui/dynamic-form.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POWERAPPS_SOURCE_DIR = process.env.POWERAPPS_SOURCE_DIR
  || resolve(ROOT, "..", "_tmp", "powerapps-ui-inventory-20260826-1501", "ENERGETICA-current", "Src");

function editableColumn(name, overrides = {}) {
  return Object.freeze({
    name,
    label: name,
    control: "text",
    choices: Object.freeze(["OPCAO DO SHAREPOINT"]),
    hidden: false,
    editable: true,
    ...overrides,
  });
}

function resolveField(entityId, name, overrides = {}, options = {}) {
  const entity = ENTITIES.find(candidate => candidate.id === entityId);
  assert.ok(entity, `entidade ausente no catalogo: ${entityId}`);
  const contract = resolvePowerAppsUiContract(entity, [editableColumn(name, overrides)], options);
  const field = contract.formColumns.find(column => column.name === name);
  assert.ok(field, `campo ${entityId}.${name} ausente do formulario resolvido`);
  return field;
}

test("STATUS literal fica isolado por entidade em vez de vazar pelo campo homonimo", () => {
  const withoutVariant = resolvePowerAppsUiContract(
    ENTITIES.find(candidate => candidate.id === "tipos-de-marco"),
    [editableColumn("STATUS")],
    { mode: "create" },
  );
  const tipoMarco = resolveField("tipos-de-marco", "STATUS", {}, {
    mode: "create",
    formVariantId: "F44- APONTAMENTOS COMERCIAIS.pa.yaml#Form44_1",
  });
  const apontamento = resolveField("apontamentos-de-funcionarios", "STATUS", {}, {
    formVariantId: "F17- CADASTRO INCONSISTÊNCIAS.pa.yaml#Form1_45",
  });

  assert.deepEqual(tipoMarco.choices, ["ATIVO", "BLOQUEADO"]);
  assert.deepEqual(apontamento.choices, ["CORRIGIDO OU NÃO CORRIGÍVEL", "PENDENTE DE CORREÇÃO"]);
  assert.equal(tipoMarco.control, "select");
  assert.equal(tipoMarco.searchable, false);
  assert.equal(apontamento.searchable, false);
  assert.equal(withoutVariant.requiresVariantSelection, true);
  assert.deepEqual(withoutVariant.formColumns, []);
});

test("AGRUPAR segue o TextInput do Update e ignora Dropdown auxiliar e choices fisicas", async () => {
  const created = resolveField("lancamentos", "AGRUPAR", {}, { mode: "create" });
  const edited = resolveField("lancamentos", "AGRUPAR", {}, { mode: "edit" });

  assert.deepEqual(created.choices, []);
  assert.deepEqual(edited.choices, []);
  assert.equal(created.control, "text");
  assert.equal(edited.control, "text");
  assert.equal(created.searchable, false);
  assert.equal(edited.searchable, false);
  assert.equal(Object.hasOwn(created, "powerApps"), false);
  assert.equal(Object.hasOwn(edited, "powerApps"), false);
  assert.equal(Object.hasOwn(POWERAPPS_FORM_CONTROLS.lancamentos, "AGRUPAR"), false);
});

test("FORMAPGTO literal de ComboBox vira select pesquisavel com escolhas exatas", () => {
  const field = resolveField("apontamentos-de-funcionarios", "FORMAPGTO", {}, {
    formVariantId: "F17- CADASTRO INCONSISTÊNCIAS.pa.yaml#Form1_45",
  });

  assert.equal(field.control, "select");
  assert.equal(field.searchable, true);
  assert.deepEqual(field.choices, ["MEDIÇÃO", "DIÁRIA", "VALOR GLOBAL"]);
});

test("CIDADE conserva a ordem de cada formulario sem unir telas divergentes", async () => {
  const screen1 = resolveField("cadastro-de-imoveis-locacao", "CIDADE", {}, {
    mode: "create",
    formVariantId: "Screen1.pa.yaml#Form3_10",
  });
  const screen3 = resolveField("cadastro-de-imoveis-locacao", "CIDADE", {}, {
    formVariantId: "Screen3.pa.yaml#Form3_9",
  });

  assert.deepEqual(screen1.choices, [
    "DIVINÓPOLIS",
    "LUZ",
    "BELO HORIZONTE",
    "CONGONHAS",
    "CARMO DA MATA",
    "CABO FRIO",
  ]);
  assert.deepEqual(screen3.choices, [
    "DIVINÓPOLIS",
    "LUZ",
    "BELO HORIZONTE",
    "CONGONHAS",
    "NOVA LIMA",
  ]);
  assert.equal(screen1.searchable, false);
  assert.equal(screen3.searchable, false);
  assert.equal(POWERAPPS_FORM_CONTROLS["cadastro-de-imoveis-locacao"].CIDADE.union, "same-entity-field");
});

test("campos SIM/NÃO usam somente o vocabulario literal da propria entidade", () => {
  const cases = [
    ["fornecedores", "HOMOLOGACAO", { mode: "edit", formVariantId: "E2- EDITAR FORNECEDOR.pa.yaml#EDITARFORNECEDOR" }],
    ["fornecedores", "WHATSAPP", { mode: "create", formVariantId: "F10- CADASTRO FORNECEDOR.pa.yaml#Form2" }],
    ["lancamentos", "GERADESEMBOLSO", { mode: "edit" }],
    ["atividades-executadas", "IMAGEM", { mode: "edit" }],
    ["tarefas-recorrentes", "COBRAR", { mode: "edit" }],
  ];

  for (const [entityId, fieldName, options] of cases) {
    const field = resolveField(entityId, fieldName, {}, options);
    assert.deepEqual(field.choices, ["SIM", "NÃO"], `${entityId}.${fieldName}`);
    assert.equal(field.control, "select", `${entityId}.${fieldName}`);
    assert.equal(field.searchable, false, `${entityId}.${fieldName}`);
  }
});

test("valor literal atual permanece pre-selecionado na edicao pesquisavel", () => {
  const field = resolveField("apontamentos-de-funcionarios", "FORMAPGTO", { auditMarker: "preservar" }, { mode: "edit" });
  const markup = formMarkup({
    entity: ENTITIES.find(candidate => candidate.id === "apontamentos-de-funcionarios"),
    mode: "edit",
    values: { FORMAPGTO: "DIÁRIA" },
    columns: [field],
  });

  assert.equal(field.auditMarker, "preservar");
  assert.match(markup, /data-searchable-field="FORMAPGTO"/);
  assert.match(markup, /value="DIÁRIA" selected/);
});

test("extrator considera apenas arrays literais dentro de DataCards de Forms mapeados", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - FormLancamentos:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - AgruparCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="AGRUPAR"
                Children:
                  - AgruparDropdown:
                      Control: Classic/DropDown@2.3.1
                      Properties:
                        Items: =["A","B"]
      - FormApontamentos:
          Control: Form@2.4.4
          Properties:
            DataSource: =APONTAMENTOSFUNCIONARIOS
          Children:
            - FormaPgtoCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="FORMAPGTO"
                Children:
                  - FormaPgtoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =["MEDIÇÃO","DIÁRIA"]
                        SearchFields: =["Value"]
                        SelectMultiple: =false
      - ControleSolto:
          Control: Classic/DropDown@2.3.1
          Properties:
            Items: =["NAO PODE ENTRAR"]
`;
  const secondYaml = yaml.replace('["A","B"]', '["B","C"]');
  const { contracts } = extractPowerAppsFormControls([
    { fileName: "a.pa.yaml", content: yaml },
    { fileName: "b.pa.yaml", content: secondYaml },
  ], ENTITIES);

  assert.deepEqual(contracts.lancamentos.AGRUPAR.choices, ["A", "B", "C"]);
  assert.equal(contracts.lancamentos.AGRUPAR.searchable, false);
  assert.equal(contracts.lancamentos.AGRUPAR.union, "same-entity-field");
  assert.deepEqual(contracts["apontamentos-de-funcionarios"].FORMAPGTO.choices, ["MEDIÇÃO", "DIÁRIA"]);
  assert.equal(contracts["apontamentos-de-funcionarios"].FORMAPGTO.searchable, true);
  assert.equal(Object.values(contracts).some(fields => Object.hasOwn(fields, "ControleSolto")), false);
});

test("catalogo literal gerado esta sincronizado com os YAMLs atuais", async () => {
  const {
    extractPowerAppsFormControlsFromDirectory,
    renderPowerAppsFormControls,
  } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const result = await extractPowerAppsFormControlsFromDirectory(POWERAPPS_SOURCE_DIR, ENTITIES);
  const expected = renderPowerAppsFormControls(result);
  const actual = await readFile(resolve(ROOT, "portal", "catalog", "powerapps-form-controls.generated.js"), "utf8");

  assert.equal(actual, expected);
});

test("entidade fonte-teste-legada nao permanece em nenhum catalogo gerado", async () => {
  assert.equal(Object.hasOwn(POWERAPPS_FORM_FIELDS, "fonte-teste-legada"), false);
  assert.equal(Object.hasOwn(POWERAPPS_FORM_CONTROLS, "fonte-teste-legada"), false);
});
