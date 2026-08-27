import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ENTITIES from "../portal/catalog/entities.js";
import {
  getPowerAppsUiContract,
  resolvePowerAppsUiContract,
} from "../portal/catalog/powerapps-ui-contract.js";
import { mapSharePointColumns } from "../portal/data/column-mapper.js";
import { formMarkup } from "../portal/ui/dynamic-form.js";
import { generatedTextMatches } from "../scripts/generated-text-normalization.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const POWERAPPS_SOURCE_DIR = process.env.POWERAPPS_SOURCE_DIR
  || resolve(ROOT, "..", "_tmp", "powerapps-ui-inventory-20260826-1501", "ENERGETICA-current", "Src");
const EXPLICIT_FORM_EXCLUSIONS = Object.freeze([
  "G1- HISTÓRICO LANÇAMENTOS.pa.yaml#Form7",
  "G31- HISTÓRICO CONTRATOS.pa.yaml#Form7_1",
  "G44- HISTÓRICO LANÇAMENTOS COMERCIAL.pa.yaml#Form7_2",
  "G6- HISTÓRICO DESCRITIVO MEDIÇÃO.pa.yaml#Form7_3",
  "GALERIA TICKETS.pa.yaml#Form43_2",
  "MOVIMENTAÇÃO TICKETS.pa.yaml#Form43_1",
  "Screen5.pa.yaml#Form1_51",
]);

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

test("todo controle fechado dos Forms create e edit permanece fechado no contrato do portal", () => {
  let variants = 0;
  let fields = 0;
  for (const entity of ENTITIES) {
    for (const mode of ["create", "edit"]) {
      const declared = getPowerAppsUiContract(entity.id, { mode });
      for (const variant of declared.formVariants) {
        variants += 1;
        const columns = Object.entries(variant.fields)
          .filter(([name]) => name !== "{Attachments}")
          .map(([name, field]) => editableColumn(name, { label: field.displayName || name }));
        const resolved = resolvePowerAppsUiContract(entity, columns, {
          mode,
          formVariantId: variant.id,
        });

        assert.equal(resolved.formVariant?.id, variant.id, `${entity.id}:${mode} não selecionou ${variant.id}`);
        for (const [name, field] of Object.entries(variant.fields)) {
          if (name === "{Attachments}") continue;
          fields += 1;
          const column = resolved.formColumns.find(candidate => candidate.name === name);
          assert.ok(column, `${entity.id}:${mode}:${variant.id}:${name} não foi exposto`);
          if (field.closed === true) {
            assert.ok(
              ["select", "lookup", "person"].includes(column.control),
              `${entity.id}:${mode}:${variant.id}:${name} virou ${column.control}`,
            );
            const hasRemoteOptions = (field.optionSources || []).some(source => (
              source.kind === "related" || source.kind === "filtered-list" || source.kind === "dependent"
            ));
            if (hasRemoteOptions) {
              assert.equal(
                column.searchable,
                true,
                `${entity.id}:${mode}:${variant.id}:${name} tem fonte remota, mas não permite pesquisar e selecionar`,
              );
              const markup = formMarkup({ entity, mode, values: {}, columns: [column] });
              assert.match(
                markup,
                new RegExp(`data-searchable-field="${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
                `${entity.id}:${mode}:${variant.id}:${name} não montou o seletor remoto`,
              );
            }
          }
          if (field.powerAppsControl === "DatePicker") {
            assert.equal(column.control, "date", `${entity.id}:${mode}:${variant.id}:${name} deixou de ser data`);
          }
        }
      }
    }
  }
  assert.equal(variants, 158, `o conjunto ativo mudou para ${variants} variantes`);
  assert.equal(fields, 1155, `o conjunto ativo mudou para ${fields} campos`);
});

test("todo campo fechado de edicao preserva o valor atual como opcao pre-selecionada", () => {
  const currentValue = "VALOR_ATUAL_AUDITADO";
  let checked = 0;
  for (const entity of ENTITIES) {
    const declared = getPowerAppsUiContract(entity.id, { mode: "edit" });
    for (const variant of declared.formVariants) {
      for (const [name, field] of Object.entries(variant.fields)) {
        if (name === "{Attachments}" || field.closed !== true) continue;
        const resolved = resolvePowerAppsUiContract(
          entity,
          [editableColumn(name, { label: field.displayName || name })],
          { mode: "edit", formVariantId: variant.id },
        );
        const column = resolved.formColumns.find(candidate => candidate.name === name);
        assert.ok(column, `${entity.id}:edit:${variant.id}:${name} não foi exposto`);
        const markup = formMarkup({
          entity,
          mode: "edit",
          values: { [name]: currentValue },
          columns: [column],
        });
        assert.match(
          markup,
          /value="VALOR_ATUAL_AUDITADO" selected/,
          `${entity.id}:edit:${variant.id}:${name} perdeu o valor atual`,
        );
        checked += 1;
      }
    }
  }
  assert.equal(checked, 304, `o conjunto de edição mudou para ${checked} campos fechados`);
});

test("DropDown remoto continua fechado mas recebe pesquisa segura no portal", () => {
  const field = resolvedField("lancamentos", editableColumn("field_14", { label: "CONTA" }));

  assert.equal(field.powerApps.powerAppsControl, "DropDown");
  assert.equal(field.powerApps.searchable, false);
  assert.equal(field.control, "select");
  assert.equal(field.searchable, true);
  assert.equal(field.powerApps.optionSources[0].listName, "CADASTROCONTA");
});

test("Distinct calculado conserva o campo real gravado e o rotulo exibido pelo ComboBox", async () => {
  const { POWERAPPS_FORM_VARIANTS } = await import("../portal/catalog/powerapps-form-controls.generated.js");
  const contract = POWERAPPS_FORM_VARIANTS["linhas-de-medicao"]
    .find(variant => variant.id === "F47- ADICIONAR LINHA MEDIÇÃO.pa.yaml#Form25")
    .fields.NUMEROCONTRATO;
  const source = contract.optionSources[0];

  assert.equal(source.valueField, "ID");
  assert.deepEqual(source.computedFields.find(field => field.fieldName === "Result")?.parts, [
    { kind: "field", fieldName: "ID" },
    { kind: "literal", value: " - " },
    { kind: "field", fieldName: "FORNECEDOR" },
  ]);
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

test("formula Items comprovada substitui a origem generica do Lookup fisico", () => {
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
  assert.equal(field.searchable, true);
  assert.deepEqual(field.choices, []);
  assert.equal(field.powerApps.optionSources[0].kind, "dependent");
  assert.deepEqual(field.powerApps.optionSources[0].fixedFilters, [
    { fieldName: "STATUS", operator: "eq", value: "ATIVIDADE INICIADA" },
  ]);
  assert.deepEqual(field.powerApps.optionSources[0].dependsOn, [{
    controlName: "DataCardValue453_1",
    fieldName: "FORNECEDOR",
    targetField: "FORNECEDOR",
  }]);
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

test("extrator reconhece ComboBox visual hospedado em outro cartao do mesmo Form", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =EMPREITEIRO
          Children:
            - StatusCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="STATUS"
                  Update: =StatusDrop.Selected.Value
                Children:
                  - StatusDrop:
                      Control: Classic/DropDown@2.3.1
                      Properties:
                        Items: =["ATIVO","INATIVO"]
                  - ContratoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Filter(DOCUMENTOS_1, TIPODOCUMENTO="CONTRATO ASSINADO")
                        DisplayFields: =["EXIBICAO"]
                        SearchFields: =["EXIBICAO"]
                        SelectMultiple: =false
            - ContratoIdCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="IDCONTRATO"
                  Update: =ContratoCombo.Selected.ID
                  Width: =0
                Children:
                  - ContratoIdText:
                      Control: Classic/TextInput@2.3.2
                      Properties:
                        Default: =Parent.Default
`;
  const result = extractPowerAppsFormControls([{ fileName: "controle-externo.pa.yaml", content: yaml }], ENTITIES);
  const field = result.variants.empreiteiros[0].fields.IDCONTRATO;

  assert.equal(field.closed, true);
  assert.equal(field.powerAppsControl, "ComboBox");
  assert.equal(field.controlVariants[0].control.controlName, "ContratoCombo");
  assert.equal(field.optionSources[0].listName, "DOCUMENTOS_1");
  assert.equal(field.optionSources[0].valueField, "ID");
});

test("extrator conserva selecao multipla comprovada por SelectedItems", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =FORNECEDORES
          Children:
            - AtividadeCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="field_2"
                  Update: =Concat(AtividadeCombo.SelectedItems, 'ATIVIDADE EXECUTADA' & " ")
                Children:
                  - AtividadeCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =CADASTROATIVIDADE.'ATIVIDADE EXECUTADA'
                        DisplayFields: =["ATIVIDADE EXECUTADA"]
                        SearchFields: =["ATIVIDADE EXECUTADA"]
                        SelectMultiple: =true
`;
  const result = extractPowerAppsFormControls([{ fileName: "selecao-multipla.pa.yaml", content: yaml }], ENTITIES);
  const field = result.variants.fornecedores[0].fields.field_2;

  assert.equal(field.closed, true);
  assert.equal(field.allowMultipleValues, true);
  assert.equal(field.controlVariants[0].allowMultipleValues, true);
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
  assert.equal(fields.field_7.optionSources[0].kind, "filtered-list");
  assert.deepEqual(fields.field_7.optionSources[0].fixedFilters, [
    { fieldName: "STATUS", operator: "starts-with", value: "A" },
  ]);
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

test("extrator traduz dependencia comprovada de TextInput em filtro fechado", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - FornecedorCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="FORNECEDOR"
                  Update: =FornecedorInput.Text
                Children:
                  - FornecedorInput:
                      Control: Classic/TextInput@2.3.2
                      Properties:
                        Default: =Parent.Default
            - DemonstrativoCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="DEMONSTRATIVOETAPA"
                  Update: =DemonstrativoCombo.Selected.ID
                Children:
                  - DemonstrativoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Filter(DEMONSTRATIVOETAPA, FORNECEDOR = FornecedorInput.Text, STATUS = "ATIVIDADE INICIADA")
                        DisplayFields: =["ID"]
                        SearchFields: =["ID"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "textinput-dependency.pa.yaml", content: yaml }], ENTITIES);
  const source = result.variants.lancamentos[0].fields.DEMONSTRATIVOETAPA.optionSources[0];

  assert.equal(source.kind, "dependent");
  assert.deepEqual(source.dependsOn, [{
    controlName: "FornecedorInput",
    fieldName: "FORNECEDOR",
    targetField: "FORNECEDOR",
  }]);
  assert.deepEqual(source.fixedFilters, [{ fieldName: "STATUS", operator: "eq", value: "ATIVIDADE INICIADA" }]);
});

test("extrator traduz dependencia selecionada envolvida por Text", async () => {
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
                  DataField: ="IDCONTRATO"
                  Update: =ContratoCombo.Selected.ID
                Children:
                  - ContratoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =EMPREITEIRO.ID
                        DisplayFields: =["ID"]
                        SearchFields: =["ID"]
            - LinhaCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="LINHACONTRATO"
                  Update: =LinhaCombo.Selected.ID
                Children:
                  - LinhaCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Filter(LINHACONTRATO, IDCONTRATO = Text(ContratoCombo.Selected.ID))
                        DisplayFields: =["ID"]
                        SearchFields: =["ID"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "text-selected-dependency.pa.yaml", content: yaml }], ENTITIES);
  const source = result.variants.lancamentos[0].fields.LINHACONTRATO.optionSources[0];

  assert.equal(source.kind, "dependent");
  assert.deepEqual(source.dependsOn, [{
    controlName: "ContratoCombo",
    fieldName: "IDCONTRATO",
    targetField: "IDCONTRATO",
  }]);
});

test("extrator resolve controle global unico como dependencia do campo local equivalente", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const sourceYaml = `Screens:
  Origem:
    Children:
      - FormOrigem:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - FilialCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="FILIAL"
                  Update: =FiltroFilialGlobal.Selected.FILIAL
                Children:
                  - FiltroFilialGlobal:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =FILIAIS.FILIAL
`;
  const targetYaml = `Screens:
  Destino:
    Children:
      - FormDestino:
          Control: Form@2.4.4
          Properties:
            DataSource: =SACPATOLOGIAS
          Children:
            - FilialCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="FILIAL"
                  Update: =FilialLocal.Selected.FILIAL
                Children:
                  - FilialLocal:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =FILIAIS.FILIAL
            - ClienteCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="CLIENTE"
                  Update: =ClienteCombo.Selected.NOME
                Children:
                  - ClienteCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Filter('CADASTRO CLIENTE_1', FILIAL = FiltroFilialGlobal.Selected.FILIAL)
                        DisplayFields: =["NOME"]
                        SearchFields: =["NOME"]
`;
  const result = extractPowerAppsFormControls([
    { fileName: "origem.pa.yaml", content: sourceYaml },
    { fileName: "destino.pa.yaml", content: targetYaml },
  ], ENTITIES);
  const source = result.variants["patologias-sac"][0].fields.CLIENTE.optionSources[0];

  assert.equal(source.kind, "dependent");
  assert.deepEqual(source.dependsOn, [{
    controlName: "FiltroFilialGlobal",
    fieldName: "FILIAL",
    targetField: "FILIAL",
  }]);
});

test("extrator preserva campo calculado com Coalesce vazio", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - OrcamentoCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="ORCAMENTO"
                  Update: =OrcamentoCombo.Selected.ID
                Children:
                  - OrcamentoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =AddColumns(ORCAMENTOS, EXIBICAO, Text(ID) & " - " & Coalesce(FORNECEDOR, "") & " (" & Coalesce(ETAPA, "") & ")")
                        DisplayFields: =["EXIBICAO"]
                        SearchFields: =["EXIBICAO"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "coalesce-label.pa.yaml", content: yaml }], ENTITIES);
  const source = result.variants.lancamentos[0].fields.ORCAMENTO.optionSources[0];

  assert.equal(source.kind, "related");
  assert.deepEqual(source.computedFields, [{
    fieldName: "EXIBICAO",
    parts: [
      { kind: "field", fieldName: "ID" },
      { kind: "literal", value: " - " },
      { kind: "field", fieldName: "FORNECEDOR" },
      { kind: "literal", value: " (" },
      { kind: "field", fieldName: "ETAPA" },
      { kind: "literal", value: ")" },
    ],
  }]);
});

test("extrator reduz GroupBy e DropColumns a lista distinta comprovada", async () => {
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
                  DataField: ="FILIAL"
                  Update: =FilialCombo.Selected.FILIAL
                Children:
                  - FilialCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Sort(DropColumns(GroupBy(Filter(FILIAIS, STATUS = "ATIVO"), FILIAL, tmp), tmp), FILIAL, SortOrder.Ascending)
                        DisplayFields: =["FILIAL"]
                        SearchFields: =["FILIAL"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "grouped-source.pa.yaml", content: yaml }], ENTITIES);
  const source = result.variants.lancamentos[0].fields.FILIAL.optionSources[0];

  assert.equal(source.kind, "filtered-list");
  assert.equal(source.listName, "FILIAIS");
  assert.equal(source.valueField, "FILIAL");
  assert.deepEqual(source.fixedFilters, [{ fieldName: "STATUS", operator: "eq", value: "ATIVO" }]);
});

test("extrator ignora comentario Power Fx fora de strings", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - EtapaCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="ETAPA"
                  Update: =EtapaCombo.Selected.Exibir
                Children:
                  - EtapaCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: |+
                          =AddColumns(
                            Distinct(Filter(DEMONSTRATIVOETAPA, STATUS = "ATIVO"), ETAPA),
                            Exibir,
                            Value // Result = valor distinto
                          )
                        DisplayFields: =["Exibir"]
                        SearchFields: =["Exibir"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "comment.pa.yaml", content: yaml }], ENTITIES);
  const source = result.variants.lancamentos[0].fields.ETAPA.optionSources[0];

  assert.equal(source.kind, "filtered-list");
  assert.deepEqual(source.computedFields, [{
    fieldName: "Exibir",
    parts: [{ kind: "field", fieldName: "ETAPA" }],
  }]);
});

test("extrator preserva filtro fixo StartsWith como predicado estruturado", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - FornecedorCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="FORNECEDOR"
                  Update: =FornecedorCombo.Selected.CADASTRO
                Children:
                  - FornecedorCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Filter(FORNECEDORES, StartsWith(TELEFONE, "55"))
                        DisplayFields: =["CADASTRO"]
                        SearchFields: =["CADASTRO"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "startswith-filter.pa.yaml", content: yaml }], ENTITIES);
  const source = result.variants.lancamentos[0].fields.FORNECEDOR.optionSources[0];

  assert.equal(source.kind, "filtered-list");
  assert.deepEqual(source.fixedFilters, [{ fieldName: "TELEFONE", operator: "starts-with", value: "55" }]);
});

test("extrator preserva fallback literal de campo calculado", async () => {
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
                  DataField: ="CONTRATO"
                  Update: =ContratoCombo.Selected.ID
                Children:
                  - ContratoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =AddColumns(LANCAMENTOCOMPRAS, Exibir, Text(ID) & " - " & If(IsBlank(MOTIVOBAIXA), "CONTRATO ATIVO", MOTIVOBAIXA))
                        DisplayFields: =["Exibir"]
                        SearchFields: =["Exibir"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "fallback-label.pa.yaml", content: yaml }], ENTITIES);
  const source = result.variants.lancamentos[0].fields.CONTRATO.optionSources[0];

  assert.equal(source.kind, "related");
  assert.deepEqual(source.computedFields[0].parts.at(-1), {
    kind: "field-fallback",
    fieldName: "MOTIVOBAIXA",
    value: "CONTRATO ATIVO",
  });
});

test("extrator preserva grupos booleanos fixos unidos por ou", async () => {
  const { extractPowerAppsFormControls } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
            - ReferenteCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="REFERENTE"
                  Update: =ReferenteCombo.Selected.CADASTRO
                Children:
                  - ReferenteCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Filter(FORNECEDORES, (FILIAL = "000 - ESCRITÓRIO CENTRAL" && TIPO = "MÃO DE OBRA" && STATUS = "ATIVO") || CADASTRO = "BERNARDO").CADASTRO
                        DisplayFields: =["CADASTRO"]
                        SearchFields: =["CADASTRO"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "or-filter.pa.yaml", content: yaml }], ENTITIES);
  const source = result.variants.lancamentos[0].fields.REFERENTE.optionSources[0];

  assert.equal(source.kind, "filtered-list");
  assert.deepEqual(source.fixedFilterGroups, [
    [
      { fieldName: "FILIAL", operator: "eq", value: "000 - ESCRITÓRIO CENTRAL" },
      { fieldName: "TIPO", operator: "eq", value: "MÃO DE OBRA" },
      { fieldName: "STATUS", operator: "eq", value: "ATIVO" },
    ],
    [{ fieldName: "CADASTRO", operator: "eq", value: "BERNARDO" }],
  ]);
});

test("extrator traduz If com dependencia opcional e mesma fonte", async () => {
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
                  DataField: ="IDCONTRATO"
                  Update: =ContratoCombo.Selected.ID
                Children:
                  - ContratoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =EMPREITEIRO.ID
                        DisplayFields: =["ID"]
                        SearchFields: =["ID"]
            - MedicaoCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="IDMEDICAO"
                  Update: =MedicaoCombo.Selected.ID
                Children:
                  - MedicaoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =AddColumns(If(IsBlank(ContratoCombo.Selected.ID), Filter(DESCRICAOMEDICOES, STATUS = "ATIVO"), Filter(DESCRICAOMEDICOES, NUMEROCONTRATO = Text(ContratoCombo.Selected.ID), STATUS = "ATIVO")), Display, ID & " - " & FORNECEDOR)
                        DisplayFields: =["Display"]
                        SearchFields: =["Display"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "optional-dependency.pa.yaml", content: yaml }], ENTITIES);
  const source = result.variants.lancamentos[0].fields.IDMEDICAO.optionSources[0];

  assert.equal(source.kind, "dependent");
  assert.deepEqual(source.dependsOn, [{
    controlName: "ContratoCombo",
    fieldName: "IDCONTRATO",
    targetField: "NUMEROCONTRATO",
    optional: true,
  }]);
  assert.deepEqual(source.fixedFilters, [{ fieldName: "STATUS", operator: "eq", value: "ATIVO" }]);
});

test("extrator traduz dependencia com First Split limitado", async () => {
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
                  DataField: ="IDCONTRATO"
                  Update: =ContratoCombo.Selected.Result
                Children:
                  - ContratoCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =EMPREITEIRO.ID
                        DisplayFields: =["ID"]
                        SearchFields: =["ID"]
            - LinhaCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="LINHACONTRATO"
                  Update: =LinhaCombo.Selected.ID
                Children:
                  - LinhaCombo:
                      Control: Classic/ComboBox@2.4.0
                      Properties:
                        Items: =Filter(LINHACONTRATO, IDCONTRATO = First(Split(ContratoCombo.Selected.Result, " - ")).Value)
                        DisplayFields: =["ID"]
                        SearchFields: =["ID"]
`;
  const result = extractPowerAppsFormControls([{ fileName: "split-dependency.pa.yaml", content: yaml }], ENTITIES);
  const source = result.variants.lancamentos[0].fields.LINHACONTRATO.optionSources[0];

  assert.equal(source.kind, "dependent");
  assert.deepEqual(source.dependsOn, [{
    controlName: "ContratoCombo",
    fieldName: "IDCONTRATO",
    targetField: "IDCONTRATO",
    transform: { kind: "split-first", separator: " - " },
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

test("catalogo de controles esta sincronizado com todos os YAMLs atuais", {
  skip: !existsSync(POWERAPPS_SOURCE_DIR),
}, async () => {
  const {
    extractPowerAppsFormControlsFromDirectory,
    renderPowerAppsFormControls,
  } = await import("../scripts/generate-powerapps-form-controls.mjs");
  const result = await extractPowerAppsFormControlsFromDirectory(POWERAPPS_SOURCE_DIR, ENTITIES);
  const expected = renderPowerAppsFormControls(result);
  const actual = await readFile(resolve(ROOT, "portal", "catalog", "powerapps-form-controls.generated.js"), "utf8");

  assert.equal(generatedTextMatches(actual, expected), true);
});

test("todo Form bruto esta catalogado ou possui exclusao nominal comprovada", {
  skip: !existsSync(POWERAPPS_SOURCE_DIR),
}, async () => {
  const { POWERAPPS_FORM_CONTROL_EVIDENCE } = await import("../portal/catalog/powerapps-form-controls.generated.js");
  const fileNames = (await readdir(POWERAPPS_SOURCE_DIR))
    .filter(fileName => fileName.endsWith(".pa.yaml"))
    .sort((left, right) => left.localeCompare(right, "pt-BR"));
  const rawForms = [];
  for (const fileName of fileNames) {
    const lines = (await readFile(resolve(POWERAPPS_SOURCE_DIR, fileName), "utf8")).split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!/Control:\s*Form@/.test(lines[index])) continue;
      const ownerLine = lines.slice(Math.max(0, index - 4), index)
        .reverse()
        .find(line => /^\s*-\s+[^:]+:\s*$/.test(line));
      const formName = ownerLine?.match(/^\s*-\s+([^:]+):\s*$/)?.[1]?.trim();
      assert.ok(formName, `${fileName}:${index + 1} não possui identidade de Form`);
      rawForms.push(`${fileName}#${formName}`);
    }
  }
  const generatedForms = new Set(POWERAPPS_FORM_CONTROL_EVIDENCE.forms.map(form => `${form.fileName}#${form.formName}`));
  const missing = rawForms.filter(identity => !generatedForms.has(identity));

  assert.equal(rawForms.length, 183);
  assert.equal(generatedForms.size, 176);
  assert.deepEqual(missing, EXPLICIT_FORM_EXCLUSIONS);
  assert.equal([...generatedForms].every(identity => rawForms.includes(identity)), true);
});

test("todos os controles fechados ativos possuem fonte de opcoes classificada", async () => {
  const {
    POWERAPPS_FORM_CONTROL_EVIDENCE,
    POWERAPPS_FORM_VARIANTS,
  } = await import("../portal/catalog/powerapps-form-controls.generated.js");
  const closedControls = POWERAPPS_FORM_CONTROL_EVIDENCE.forms
    .flatMap(form => form.fields.flatMap(field => field.controls.map(control => ({
        fileName: form.fileName,
        formName: form.formName,
        control,
      }))))
    .filter(({ control }) => control.powerAppsControl === "ComboBox" || control.powerAppsControl === "DropDown");
  const uniqueClosedControls = new Set(closedControls.map(({ fileName, formName, control }) => (
    `${fileName}#${formName}#${control.controlName}`
  )));
  const fields = Object.values(POWERAPPS_FORM_VARIANTS)
    .flatMap(variants => variants)
    .flatMap(variant => Object.values(variant.fields));
  const sources = fields.flatMap(field => field.optionSources || []);
  const unresolved = sources.filter(source => source.kind === "unresolved");
  const dependentWithoutTarget = sources.filter(source => (
    source.kind === "dependent"
    && (!source.dependsOn?.length || source.dependsOn.some(dependency => !dependency.targetField))
  ));

  assert.equal(uniqueClosedControls.size, 709);
  assert.ok(unresolved.length > 0);
  assert.equal(unresolved.every(source => source.formula && source.reason), true);
  assert.deepEqual(dependentWithoutTarget, []);
  assert.equal(fields.filter(field => field.optionSources?.some(source => source.kind === "unresolved"))
    .every(field => field.closed === true && field.failClosed === true), true);
});
