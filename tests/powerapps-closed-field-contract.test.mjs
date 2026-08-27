import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ENTITIES from "../portal/catalog/entities.js";
import { resolvePowerAppsUiContract } from "../portal/catalog/powerapps-ui-contract.js";
import { mapSharePointColumns } from "../portal/data/column-mapper.js";
import { formMarkup } from "../portal/ui/dynamic-form.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POWERAPPS_SOURCE_DIR = process.env.POWERAPPS_SOURCE_DIR
  || resolve(ROOT, "..", "_tmp", "powerapps-ui-inventory-20260826-1501", "ENERGETICA-current", "Src");

function editableColumn(name, overrides = {}) {
  return Object.freeze({
    name,
    label: name,
    control: "text",
    choices: Object.freeze([]),
    hidden: false,
    editable: true,
    ...overrides,
  });
}

function resolvedField(entityId, column, options = {}) {
  const entity = ENTITIES.find(candidate => candidate.id === entityId);
  assert.ok(entity, `entidade ausente: ${entityId}`);
  const contract = resolvePowerAppsUiContract(entity, [column], options);
  const field = contract.formColumns.find(candidate => candidate.name === column.name);
  assert.ok(field, `campo ausente: ${entityId}.${column.name}`);
  return field;
}

test("FILIAL de LANCAMENTOS fecha o campo Title com a fonte relacional exata do Power Apps", () => {
  const field = resolvedField("lancamentos", editableColumn("Title"));

  assert.equal(field.label, "FILIAL");
  assert.equal(field.control, "select");
  assert.equal(field.searchable, true);
  assert.deepEqual(field.choices, []);
  assert.equal(field.powerApps.closed, true);
  assert.equal(field.powerApps.failClosed, true);
  assert.equal(field.powerApps.preserveCurrentValue, true);
  assert.deepEqual(field.powerApps.optionSources[0], {
    kind: "related",
    entityId: "filiais",
    listName: "FILIAIS",
    valueField: "FILIAL",
    formula: "=FILIAIS.FILIAL",
    displayFields: ["Title"],
    searchFields: ["Title"],
  });
});

test("ETAPA de LANCAMENTOS conserva a formula dependente e aponta para o campo FILIAL do mesmo formulario", () => {
  const field = resolvedField("lancamentos", editableColumn("field_6", { label: "ETAPA" }));
  const source = field.powerApps.optionSources.find(candidate => (
    candidate.listName === "LANCAMENTOOBRA"
    && candidate.dependsOn?.some(dependency => dependency.controlName === "COMBOBOXFILIAL")
  ));

  assert.equal(field.control, "select");
  assert.equal(field.searchable, true);
  assert.equal(source.kind, "dependent");
  assert.equal(source.entityId, "lancamentos-de-obras");
  assert.equal(source.valueField, "ETAPA");
  assert.match(source.formula, /Distinct\s*\(/);
  assert.match(source.formula, /Filter\s*\(LANCAMENTOOBRA/);
  assert.deepEqual(source.dependsOn, [{
    controlName: "COMBOBOXFILIAL",
    fieldName: "Title",
    targetField: "FILIAL",
  }]);
});

test("LANCAMENTOS seleciona F4 no create e E1 no edit sem achatar fontes entre formularios", () => {
  const entity = ENTITIES.find(candidate => candidate.id === "lancamentos");
  const columns = [
    editableColumn("Title", { label: "FILIAL" }),
    editableColumn("field_6", { label: "ETAPA" }),
  ];
  const created = resolvePowerAppsUiContract(entity, columns, { mode: "create" });
  const edited = resolvePowerAppsUiContract(entity, columns, { mode: "edit" });

  assert.equal(created.formVariant.fileName, "F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml");
  assert.equal(created.formVariant.formName, "FORMULÁRIO LANÇAMENTO");
  assert.equal(edited.formVariant.fileName, "E1- EDITAR LANÇAMENTO COMPRA.pa.yaml");
  assert.equal(edited.formVariant.formName, "EDITARLANCAMENTO");
  assert.equal(created.formVariantConflict, false);
  assert.equal(edited.formVariantConflict, false);
  assert.deepEqual(created.formVariants.map(variant => variant.id), [
    "F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml#FORMULÁRIO LANÇAMENTO",
  ]);
  assert.deepEqual(edited.formVariants.map(variant => variant.id), [
    "E1- EDITAR LANÇAMENTO COMPRA.pa.yaml#EDITARLANCAMENTO",
  ]);
  assert.deepEqual(created.formVariant.submitEvidence.actions, ["create"]);
  assert.deepEqual(edited.formVariant.submitEvidence.actions, ["edit"]);

  for (const contract of [created, edited]) {
    const filial = contract.formColumns.find(column => column.name === "Title");
    const etapa = contract.formColumns.find(column => column.name === "field_6");
    assert.deepEqual(filial.powerApps.optionSources.map(source => source.kind), ["related"]);
    assert.equal(filial.powerApps.optionSources[0].listName, "FILIAIS");
    assert.equal(filial.powerApps.optionSources[0].valueField, "FILIAL");
    assert.equal(etapa.powerApps.optionSources.length, 1);
    assert.equal(etapa.powerApps.optionSources[0].kind, "dependent");
    assert.deepEqual(etapa.powerApps.optionSources[0].dependsOn.map(dependency => ({
      fieldName: dependency.fieldName,
      targetField: dependency.targetField,
    })), [{ fieldName: "Title", targetField: "FILIAL" }]);
  }
});

test("FILIAL preserva e pre-seleciona o valor atual quando as opcoes relacionadas estao carregadas", () => {
  const choices = Object.freeze(["MATRIZ", "OBRA 01"]);
  const entity = ENTITIES.find(candidate => candidate.id === "lancamentos");
  const field = resolvedField("lancamentos", editableColumn("Title", {
    label: "FILIAL",
    control: "select",
    choices,
  }));
  const markup = formMarkup({
    entity,
    mode: "edit",
    values: { Title: "MATRIZ" },
    columns: [field],
  });

  assert.equal(field.choices, choices);
  assert.match(markup, /data-searchable-field="Title"/);
  assert.match(markup, /value="MATRIZ" selected/);
});

test("default literal vale no create e nunca substitui o valor atual no edit", () => {
  const entity = ENTITIES.find(candidate => candidate.id === "lancamentos");
  const column = editableColumn("STATUS", {
    label: "STATUS",
    control: "select",
    choices: Object.freeze(["ATIVO", "INATIVO"]),
    defaultValue: "ATIVO",
  });
  const created = formMarkup({ entity, mode: "create", values: {}, columns: [column] });
  const edited = formMarkup({ entity, mode: "edit", values: { STATUS: "INATIVO" }, columns: [column] });

  assert.match(created, /value="ATIVO" selected/);
  assert.match(edited, /value="INATIVO" selected/);
  assert.doesNotMatch(edited, /value="ATIVO" selected/);
});

test("Choice nativo continua fechado e pesquisavel sem substituir as opcoes do SharePoint", () => {
  const choices = Object.freeze(["DIARIO", "SEMANAL", "MENSAL"]);
  const field = resolvedField("tarefas-recorrentes", editableColumn("RECORRENCIA", {
    control: "select",
    choices,
  }), { mode: "edit", formVariantId: "HISTORICOTAREFASRECORRENTES.pa.yaml#Form14_1" });

  assert.equal(field.control, "select");
  assert.equal(field.searchable, true);
  assert.equal(field.choices, choices);
  assert.equal(field.powerApps.optionSources.some(source => source.kind === "sharepoint-choice"), true);
});

test("Lookup e Person fisicos permanecem selecoes fechadas segundo os metadados SharePoint", () => {
  const [lookup, person] = mapSharePointColumns([
    {
      name: "CLIENTE",
      displayName: "Cliente",
      lookup: { listId: "clientes", columnName: "Title", allowMultipleValues: false },
    },
    {
      name: "RESPONSAVEL",
      displayName: "Responsavel",
      personOrGroup: { chooseFromType: "peopleOnly", allowMultipleSelection: false },
    },
  ]);

  assert.equal(lookup.control, "lookup");
  assert.equal(lookup.relation.resolvable, true);
  assert.equal(person.control, "person");
  assert.equal(person.relation.resolvable, true);
});

test("formula Items nao traduzivel bloqueia ate Lookup fisico em vez de usar origem generica", () => {
  const entity = ENTITIES.find(candidate => candidate.id === "descricoes-de-medicao");
  const contract = resolvePowerAppsUiContract(entity, [editableColumn("DEMONSTRATIVOETAPA", {
    control: "lookup",
    searchable: true,
    relation: Object.freeze({
      kind: "lookup",
      listId: "lista-generica",
      displayField: "Title",
      multiple: false,
      resolvable: true,
    }),
  })], {
    mode: "create",
    formVariantId: "G1- HISTÓRICO LANÇAMENTOS.pa.yaml#Form23_1",
  });
  const field = contract.formColumns.find(column => column.name === "DEMONSTRATIVOETAPA");

  assert.equal(field.control, "select");
  assert.equal(field.searchable, false);
  assert.deepEqual(field.choices, []);
  assert.equal(field.powerApps.optionSources[0].kind, "unresolved");
});

test("TextInput real permanece aberto quando o campo nao possui controle fechado", () => {
  const field = resolvedField("lancamentos", editableColumn("NOTA"));

  assert.equal(field.control, "text");
  assert.equal(Object.hasOwn(field, "powerApps"), false);
});

test("matriz registra por formulario o card FILIAL_DataCard1 e suas formulas literais", async () => {
  const { POWERAPPS_FORM_CONTROL_EVIDENCE } = await import("../portal/catalog/powerapps-form-controls.generated.js");
  const form = POWERAPPS_FORM_CONTROL_EVIDENCE.forms.find(candidate => (
    candidate.fileName === "F4 - CADASTRO LANCAMENTOS COMPRA.pa.yaml"
    && candidate.formName === "FORMULÁRIO LANÇAMENTO"
  ));
  assert.ok(form);
  const filial = form.fields.find(field => field.cardName === "FILIAL_DataCard1" && field.fieldName === "Title");
  assert.ok(filial);
  assert.equal(filial.update, "=COMBOBOXFILIAL.Selected.FILIAL");
  assert.equal(filial.mode, "closed");
  assert.deepEqual(filial.controls[0], {
    controlName: "COMBOBOXFILIAL",
    powerAppsControl: "ComboBox",
    lineNumber: 767,
    items: "=FILIAIS.FILIAL",
    defaultSelectedItems: "=Filter(FILIAIS.FILIAL, FILIAL = LookUp(FORNECEDORES, CADASTRO = ComboBox9.Selected.CADASTRO).FILIAL)",
    displayFields: ["Title"],
    searchFields: ["Title"],
    isSearchable: null,
    selectMultiple: false,
  });
});

test("extrator escolhe somente o controle citado pelo Update e preserva DisplayName", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - DataCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="field_2"
                  DisplayName: =DataSourceInfo([@LANCAMENTOS],DataSourceInfo.DisplayName,'DATA REAL')
                  Update: =DataControl.SelectedDate
                Children:
                  - DataControl:
                      Control: Classic/DatePicker@2.6.0
                      Properties:
                        DefaultDate: =Parent.Default
                  - MinuteAuxiliar:
                      Control: Classic/DropDown@2.3.1
                      Properties:
                        Items: =["00","30"]
            - ProdutoCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="field_7"
                  DisplayName: =DataSourceInfo([@LANCAMENTOS],DataSourceInfo.DisplayName,PRODUTO)
                  Update: =ProdutoCombo.Selected.PRODUTO
                Children:
                  - ProdutoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Filter(CADASTROPRODUTO,STATUS="ATIVO").PRODUTO
                        DisplayFields: =["field_1"]
                        SearchFields: =["field_1"]
                  - UnidadeAuxiliar:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Filter(CADASTROUNIDADEMEDIDA,STATUS="ATIVO")
                        DisplayFields: =["Title"]
                        SearchFields: =["Title"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "controle-update.pa.yaml", content: yaml }], ENTITIES);
  const variant = result.variants.lancamentos[0];

  assert.equal(variant.fields.field_2.closed, false);
  assert.equal(variant.fields.field_2.powerAppsControl, "DatePicker");
  assert.equal(variant.fields.field_2.displayName, "DATA REAL");
  assert.equal(variant.fields.field_7.closed, true);
  assert.equal(variant.fields.field_7.displayName, "PRODUTO");
  assert.deepEqual(variant.fields.field_7.optionSources.map(source => source.listName), ["CADASTROPRODUTO"]);
  assert.deepEqual(variant.fields.field_7.controlVariants[0].control.displayFields, ["field_1"]);
});

test("extrator prioriza NewForm e EditForm exatos do mesmo artefato antes de Item", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Properties:
      OnVisible: =NewForm(CADASTROASSOCIAÇÃO)
    Children:
      - Editar:
          Control: Button@1.0.0
          Properties:
            OnSelect: =EditForm(CADASTROASSOCIAÇÃO)
      - CADASTROASSOCIAÇÃO:
          Control: Form@2.4.4
          Properties:
            DataSource: =CADASTROTAREFAS
            Item: =Gallery1.Selected
          Children:
            - TituloCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="Title"
                  Update: =TituloInput.Text
                Children:
                  - TituloInput:
                      Control: Classic/TextInput@2.3.2
`;
  const result = extractPowerAppsFormControls([{ fileName: "modos.pa.yaml", content: yaml }], ENTITIES);
  const variant = result.variants["cadastro-de-tarefas"][0];

  assert.deepEqual(variant.modes, ["create", "edit"]);
  assert.equal(variant.mode, "create");
  assert.deepEqual(variant.modeEvidence.map(evidence => evidence.action), ["create", "edit"]);
});

test("extrator distingue lista filtrada, dependencia e formula nao traduzivel", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - FilialCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="Title"
                  Update: =FilialCombo.Selected.FILIAL
                Children:
                  - FilialCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Filter(FILIAIS, STATUS="ATIVO")
                        DisplayFields: =["FILIAL"]
                        SearchFields: =["FILIAL"]
            - EtapaCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="field_6"
                  Update: =EtapaCombo.Selected.Value
                Children:
                  - EtapaCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Distinct(Filter(LANCAMENTOOBRA, STATUS="ATIVO" && FILIAL=FilialCombo.Selected.FILIAL), ETAPA)
                        DisplayFields: =["Value"]
                        SearchFields: =["Value"]
            - InseguroCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="field_7"
                  Update: =InseguroCombo.Selected.PRODUTO
                Children:
                  - InseguroCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Filter(CADASTROPRODUTO, StartsWith(STATUS,"A"))
                        DisplayFields: =["PRODUTO"]
                        SearchFields: =["PRODUTO"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "filtros.pa.yaml", content: yaml }], ENTITIES);
  const fields = result.variants.lancamentos[0].fields;

  assert.deepEqual(fields.Title.optionSources, [{
    kind: "filtered-list",
    entityId: "filiais",
    listName: "FILIAIS",
    valueField: "FILIAL",
    formula: '=Filter(FILIAIS, STATUS="ATIVO")',
    fixedFilters: [{ fieldName: "STATUS", operator: "eq", value: "ATIVO" }],
    displayFields: ["FILIAL"],
    searchFields: ["FILIAL"],
  }]);
  assert.equal(fields.field_6.optionSources[0].kind, "dependent");
  assert.deepEqual(fields.field_6.optionSources[0].fixedFilters, [
    { fieldName: "STATUS", operator: "eq", value: "ATIVO" },
  ]);
  assert.deepEqual(fields.field_6.optionSources[0].dependsOn, [{
    controlName: "FilialCombo",
    fieldName: "Title",
    targetField: "FILIAL",
  }]);
  assert.equal(fields.field_7.optionSources[0].kind, "unresolved");
  assert.match(fields.field_7.optionSources[0].reason, /Filter/i);
});

test("extrator preserva rotulo calculado simples de AddColumns", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - ContratoCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="field_3"
                  Update: =ContratoCombo.Selected.ID
                Children:
                  - ContratoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =AddColumns(LANCAMENTOCOMPRAS, Exibir, Text(ID) & " - " & NOME)
                        DisplayFields: =["Exibir"]
                        SearchFields: =["Exibir"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "rotulo.pa.yaml", content: yaml }], ENTITIES);
  const source = result.variants.lancamentos[0].fields.field_3.optionSources[0];

  assert.deepEqual(source.computedFields, [{
    fieldName: "Exibir",
    parts: [
      { kind: "field", fieldName: "ID" },
      { kind: "literal", value: " - " },
      { kind: "field", fieldName: "NOME" },
    ],
  }]);
});

test("extrator classifica defaults atuais, literais e nao traduziveis", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - StatusCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="STATUS"
                  Update: =StatusCombo.Selected.Value
                Children:
                  - StatusCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =["ATIVO","INATIVO"]
                        DefaultSelectedItems: =["ATIVO"]
            - FilialCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="Title"
                  Update: =FilialCombo.Selected.FILIAL
                Children:
                  - FilialCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =FILIAIS.FILIAL
                        DefaultSelectedItems: =Parent.Default
            - ProdutoCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="field_7"
                  Update: =ProdutoCombo.Selected.PRODUTO
                Children:
                  - ProdutoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =CADASTROPRODUTO.PRODUTO
                        DefaultSelectedItems: =LookUp(CADASTROPRODUTO,ID=1)
`;
  const result = extractPowerAppsFormControls([{ fileName: "defaults.pa.yaml", content: yaml }], ENTITIES);
  const fields = result.variants.lancamentos[0].fields;

  assert.deepEqual(fields.STATUS.defaultSelection, {
    kind: "literal",
    values: ["ATIVO"],
    formula: '=["ATIVO"]',
  });
  assert.deepEqual(fields.Title.defaultSelection, { kind: "current", formula: "=Parent.Default" });
  assert.equal(fields.field_7.defaultSelection.kind, "unresolved");
  assert.match(fields.field_7.defaultSelection.reason, /não traduzível/i);
});

test("extrator cobre lista, Distinct/Filter, Choice e TextInput sem inferir pelo nome", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - FilialCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="Title"
                  Update: =FilialCombo.Selected.FILIAL
                Children:
                  - FilialCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =FILIAIS.FILIAL
                        DefaultSelectedItems: =Parent.Default
                        SearchFields: =["Title"]
                        SelectMultiple: =false
            - EtapaCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="field_6"
                Children:
                  - EtapaCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: |+
                          =Distinct(
                            Filter(LANCAMENTOOBRA, FILIAL = FilialCombo.Selected.FILIAL),
                            ETAPA
                          )
                        SearchFields: =["Value"]
                        SelectMultiple: =false
            - ChoiceCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="RECORRENCIA"
                Children:
                  - ChoiceCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Choices([@LANCAMENTOS].RECORRENCIA)
                        SearchFields: =["Value"]
                        SelectMultiple: =false
            - NotaCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="NOTA"
                Children:
                  - NotaInput:
                      Control: Classic/TextInput@2.3.2
                      Properties:
                        Default: =Parent.Default
            - UnknownCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="CAMPO_DESCONHECIDO"
                Children:
                  - UnknownCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =ColecaoLocalSemOrigem
                        SearchFields: =["Value"]
                        SelectMultiple: =false
`;
  const result = extractPowerAppsFormControls([{ fileName: "teste.pa.yaml", content: yaml }], ENTITIES);
  const fields = result.evidence.forms[0].fields;

  assert.equal(fields.find(field => field.fieldName === "Title").mode, "closed");
  assert.equal(fields.find(field => field.fieldName === "field_6").controls[0].items.includes("Filter(LANCAMENTOOBRA"), true);
  assert.deepEqual(result.contracts.lancamentos.field_6.optionSources[0].dependsOn, [{
    controlName: "FilialCombo",
    fieldName: "Title",
    targetField: "FILIAL",
  }]);
  assert.equal(result.contracts.lancamentos.RECORRENCIA.optionSources[0].kind, "sharepoint-choice");
  assert.equal(fields.find(field => field.fieldName === "NOTA").mode, "open-text");
  assert.equal(Object.hasOwn(result.contracts.lancamentos, "NOTA"), false);
  assert.equal(result.contracts.lancamentos.CAMPO_DESCONHECIDO.closed, true);
  assert.equal(result.contracts.lancamentos.CAMPO_DESCONHECIDO.failClosed, true);
  assert.deepEqual(result.contracts.lancamentos.CAMPO_DESCONHECIDO.choices, []);
  assert.equal(result.contracts.lancamentos.CAMPO_DESCONHECIDO.optionSources[0].kind, "unresolved");
});

test("catalogo de controles esta sincronizado com todos os YAMLs atuais", async () => {
  const {
    extractPowerAppsFormControlsFromDirectory,
    renderPowerAppsFormControls,
  } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const result = await extractPowerAppsFormControlsFromDirectory(POWERAPPS_SOURCE_DIR, ENTITIES);
  const expected = renderPowerAppsFormControls(result);
  const actual = await readFile(resolve(ROOT, "portal", "catalog", "powerapps-form-controls.generated.js"), "utf8");

  assert.equal(actual, expected);
});

test("todos os controles fechados ativos possuem fonte de opcoes classificada", async () => {
  const {
    POWERAPPS_FORM_CONTROL_EVIDENCE,
    POWERAPPS_FORM_VARIANTS,
  } = await import("../portal/catalog/powerapps-form-controls.generated.js");
  const closedControls = POWERAPPS_FORM_CONTROL_EVIDENCE.forms
    .flatMap(form => form.fields)
    .flatMap(field => field.controls)
    .filter(control => control.powerAppsControl === "ComboBox" || control.powerAppsControl === "DropDown");
  const fields = Object.values(POWERAPPS_FORM_VARIANTS)
    .flatMap(variants => variants)
    .flatMap(variant => Object.values(variant.fields));
  const sources = fields.flatMap(field => field.optionSources || []);
  const unresolved = sources.filter(source => source.kind === "unresolved");
  const dependentWithoutTarget = sources.filter(source => (
    source.kind === "dependent"
    && (!source.dependsOn?.length || source.dependsOn.some(dependency => !dependency.targetField))
  ));

  assert.equal(closedControls.length, 709);
  assert.ok(unresolved.length > 0);
  assert.equal(unresolved.every(source => source.formula && source.reason), true);
  assert.deepEqual(dependentWithoutTarget, []);
  assert.equal(fields.filter(field => field.optionSources?.some(source => source.kind === "unresolved"))
    .every(field => field.closed === true && field.failClosed === true), true);
});
