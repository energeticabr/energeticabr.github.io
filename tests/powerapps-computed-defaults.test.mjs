import assert from "node:assert/strict";
import test from "node:test";

import ENTITIES from "../portal/catalog/entities.js";
import { resolvePowerAppsUiContract } from "../portal/catalog/powerapps-ui-contract.js";
import { applyPowerAppsDefaultValues, evaluatePowerAppsDefaultExpression } from "../portal/forms/powerapps-defaults.js";
import { formMarkup } from "../portal/ui/dynamic-form.js";
import { extractPowerAppsFormControls } from "../scripts/generate-powerapps-form-controls.mjs";

function card(fieldName, controlName, controlType, defaultProperty, formula) {
  return `            - ${fieldName}Card:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="${fieldName}"
                  Update: =${controlName}.Value
                Children:
                  - ${controlName}:
                      Control: Classic/${controlType}@2.4.0
                      Properties:
                        ${defaultProperty}: ${formula}`;
}

function extractDefaults(cards) {
  const yaml = `Screens:
  Teste:
    Children:
      - Form1:
          Control: Form@2.4.4
          Properties:
            DataSource: =LANCAMENTOS
          Children:
${cards.join("\n")}
`;
  return extractPowerAppsFormControls([{ fileName: "defaults-computados.pa.yaml", content: yaml }], ENTITIES)
    .variants.lancamentos[0].fields;
}

test("extrator compila somente defaults calculados comprovaveis para uma AST segura", () => {
  const fields = extractDefaults([
    card("DATA", "DataValue", "DatePicker", "DefaultDate", "=Today()"),
    card("CRIADOEM", "CriadoValue", "DatePicker", "DefaultDate", "=Now()"),
    card("EMAIL", "EmailValue", "TextInput", "Default", "=Lower(User().Email)"),
    card("RESPONSAVEL", "ResponsavelValue", "TextInput", "Default", "=Upper(User().FullName)"),
    card("FILIAL", "FilialValue", "ComboBox", "DefaultSelectedItems", "=LookUp(FILIAIS,FILIAL=Gallery1.Selected.FILIAL)"),
    card("IMOVEL", "ImovelValue", "ComboBox", "DefaultSelectedItems", "=Filter('IMOVEL CADASTRADO',IMOVEL=ThisItem.IMOVEL)"),
    card("NOME", "NomeValue", "TextInput", "Default", "=Param(\"nome\")"),
    card("AUDITORIA", "AuditoriaValue", "TextInput", "Default", "=\"RESPONSAVEL: \" & Upper(User().FullName)"),
    card("COMPLEXO", "ComplexoValue", "TextInput", "Default", "=LookUp(FORNECEDORES, CADASTRO=ComboBox9.Selected.CADASTRO, FILIAL)"),
  ]);

  assert.deepEqual(fields.DATA.defaultSelection, {
    kind: "computed",
    formula: "=Today()",
    expression: { type: "today" },
  });
  assert.deepEqual(fields.CRIADOEM.defaultSelection.expression, { type: "now" });
  assert.deepEqual(fields.EMAIL.defaultSelection.expression, {
    type: "transform",
    operation: "lower",
    value: { type: "session", field: "email" },
  });
  assert.deepEqual(fields.RESPONSAVEL.defaultSelection.expression, {
    type: "transform",
    operation: "upper",
    value: { type: "session", field: "name" },
  });
  assert.deepEqual(fields.FILIAL.defaultSelection.expression, { type: "record", field: "FILIAL" });
  assert.deepEqual(fields.IMOVEL.defaultSelection.expression, { type: "record", field: "IMOVEL" });
  assert.deepEqual(fields.NOME.defaultSelection.expression, { type: "route", field: "nome" });
  assert.deepEqual(fields.AUDITORIA.defaultSelection.expression, {
    type: "concat",
    parts: [
      { type: "literal", value: "RESPONSAVEL: " },
      {
        type: "transform",
        operation: "upper",
        value: { type: "session", field: "name" },
      },
    ],
  });
  assert.equal(fields.COMPLEXO.defaultSelection.kind, "unresolved");
});

test("extrator traduz aritmetica simples de datas e rejeita condicional dependente de controle", () => {
  const fields = extractDefaults([
    card("AMANHA", "AmanhaValue", "DatePicker", "DefaultDate", "=Today()+1"),
    card("PROXIMASEMANA", "SemanaValue", "DatePicker", "DefaultDate", "=DateAdd(Today(), 7, TimeUnit.Days)"),
    card("CONDICIONAL", "CondicionalValue", "DatePicker", "DefaultDate", "=If(Checkbox1.Value,Today(),Blank())"),
  ]);

  assert.deepEqual(fields.AMANHA.defaultSelection.expression, {
    type: "date-add",
    base: { type: "today" },
    amount: 1,
    unit: "days",
  });
  assert.deepEqual(fields.PROXIMASEMANA.defaultSelection.expression, {
    type: "date-add",
    base: { type: "today" },
    amount: 7,
    unit: "days",
  });
  assert.equal(fields.CONDICIONAL.defaultSelection.kind, "unresolved");
});

test("extrator traduz fallback literal de edicao somente para o mesmo campo do registro", () => {
  const fields = extractDefaults([
    card(
      "PRIORITÁRIA",
      "PrioridadeValue",
      "ComboBox",
      "DefaultSelectedItems",
      '=If(ThisItem.PRIORITÁRIA=Blank(),"NÃO PRIORITÁRIA",ThisItem.PRIORITÁRIA)',
    ),
    card(
      "OUTRO",
      "OutroValue",
      "ComboBox",
      "DefaultSelectedItems",
      '=If(ThisItem.CAMPO=Blank(),"PADRÃO",ThisItem.CAMPO)',
    ),
  ]);

  assert.deepEqual(fields.PRIORITÁRIA.defaultSelection.expression, {
    type: "record-blank-fallback",
    field: "PRIORITÁRIA",
    fallback: "NÃO PRIORITÁRIA",
  });
  assert.equal(fields.OUTRO.defaultSelection.kind, "unresolved");
});

test("extrator traduz status de conclusao condicionado aos campos e anexos do mesmo formulario", () => {
  const yaml = `Screens:
  Teste:
    Children:
      - FormDiario:
          Control: Form@2.4.4
          Properties:
            DataSource: ='DIÁRIO DE OBRAS'
          Children:
            - AtividadesCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="ATIVIDADES"
                Children:
                  - AtividadesInput:
                      Control: Classic/TextInput@2.3.2
            - FilialCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="FILIAL"
                Children:
                  - FilialCombo:
                      Control: Classic/ComboBox@2.4.0
            - DataCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="DATA"
                Children:
                  - DataInput:
                      Control: Classic/DatePicker@2.6.0
            - ClimaCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="CLIMA"
                Children:
                  - ClimaCombo:
                      Control: Classic/DropDown@2.3.1
            - OcorrenciasCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="OCORRENCIAS"
                Children:
                  - OcorrenciasInput:
                      Control: Classic/TextInput@2.3.2
            - AnexosCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="{Attachments}"
                Children:
                  - AnexosInput:
                      Control: Attachments@2.3.0
            - StatusCard:
                Control: TypedDataCard@1.0.7
                Properties:
                  DataField: ="STATUS"
                  Update: =StatusCombo.Selected.Value
                Children:
                  - StatusCombo:
                      Control: Classic/DropDown@2.3.1
                      Properties:
                        Items: =["PENDENTE","CONCLUÍDO"]
                        DefaultSelectedItems: =If(ThisItem.STATUS="CONCLUÍDO",ThisItem.STATUS,If(!IsBlank(AtividadesInput.Text) && CountRows(AnexosInput.Attachments)>0 && !IsBlank(ClimaCombo.Selected.Value) && !IsBlank(FilialCombo.Selected.FILIAL) && !IsBlank(DataInput.SelectedDate) && !IsBlank(OcorrenciasInput.Text),"CONCLUÍDO","PENDENTE"))
`;
  const result = extractPowerAppsFormControls([{ fileName: "diario.pa.yaml", content: yaml }], ENTITIES);
  const expression = result.variants["diarios-de-obras"][0].fields.STATUS.defaultSelection.expression;

  assert.deepEqual(expression, {
    type: "completion-status",
    field: "STATUS",
    requiredFields: ["ATIVIDADES", "CLIMA", "FILIAL", "DATA", "OCORRENCIAS"],
    requiresAttachments: true,
    preserveCompleted: true,
    completeValue: "CONCLUÍDO",
    incompleteValue: "PENDENTE",
  });
});

test("runtime avalia defaults sem acesso global e sem executar Power Fx", () => {
  const context = {
    now: new Date("2026-08-27T14:35:00-03:00"),
    session: { email: "Bernardo@Notini.Com", name: "Bernardo Notini" },
    record: { FILIAL: "001 - OURO PRETO", IMOVEL: "740A" },
    route: { nome: "CLIENTE TESTE" },
  };

  assert.equal(evaluatePowerAppsDefaultExpression({ type: "today" }, context), "2026-08-27");
  assert.equal(evaluatePowerAppsDefaultExpression({ type: "now" }, context), "2026-08-27T14:35");
  assert.equal(evaluatePowerAppsDefaultExpression({ type: "record", field: "FILIAL" }, context), "001 - OURO PRETO");
  assert.equal(evaluatePowerAppsDefaultExpression({ type: "route", field: "nome" }, context), "CLIENTE TESTE");
  assert.equal(evaluatePowerAppsDefaultExpression({
    type: "transform",
    operation: "lower",
    value: { type: "session", field: "email" },
  }, context), "bernardo@notini.com");
  assert.equal(evaluatePowerAppsDefaultExpression({ type: "unknown", formula: "alert(1)" }, context), undefined);
});

test("runtime aplica calculados somente no create e preserva qualquer valor atual no edit", () => {
  const columns = [
    { name: "FILIAL", defaultExpression: { type: "record", field: "FILIAL" } },
    { name: "DATA", defaultExpression: { type: "today" } },
    { name: "STATUS", defaultValue: "ATIVO", defaultExpression: { type: "literal", value: "IGNORAR" } },
  ];
  const context = {
    now: new Date("2026-08-27T09:00:00-03:00"),
    record: { FILIAL: "001 - OURO PRETO" },
  };

  assert.deepEqual(applyPowerAppsDefaultValues(columns, {}, { mode: "create", context }), {
    FILIAL: "001 - OURO PRETO",
    DATA: "2026-08-27",
    STATUS: "ATIVO",
  });
  assert.deepEqual(applyPowerAppsDefaultValues(columns, {
    FILIAL: "002 - CENTRO",
    DATA: "2026-08-20",
    STATUS: "INATIVO",
  }, { mode: "edit", context }), {
    FILIAL: "002 - CENTRO",
    DATA: "2026-08-20",
    STATUS: "INATIVO",
  });
});

test("runtime aplica fallback de edicao apenas quando o valor atual esta vazio", () => {
  const columns = [{
    name: "PRIORIT_x00c1_RIA",
    defaultExpression: {
      type: "record-blank-fallback",
      field: "PRIORITÁRIA",
      fallback: "NÃO PRIORITÁRIA",
    },
  }];

  assert.deepEqual(applyPowerAppsDefaultValues(columns, {
    PRIORIT_x00c1_RIA: "",
  }, {
    mode: "edit",
    context: { record: { PRIORITÁRIA: "" } },
  }), {
    PRIORIT_x00c1_RIA: "NÃO PRIORITÁRIA",
  });

  assert.deepEqual(applyPowerAppsDefaultValues(columns, {
    PRIORIT_x00c1_RIA: "ATIVIDADE EMERGENCIAL",
  }, {
    mode: "edit",
    context: { record: { PRIORITÁRIA: "ATIVIDADE EMERGENCIAL" } },
  }), {
    PRIORIT_x00c1_RIA: "ATIVIDADE EMERGENCIAL",
  });
});

test("runtime calcula status de conclusao e preserva registro ja concluido", () => {
  const expression = {
    type: "completion-status",
    field: "STATUS",
    requiredFields: ["ATIVIDADES", "CLIMA", "FILIAL", "DATA", "OCORRENCIAS"],
    requiresAttachments: true,
    preserveCompleted: true,
    completeValue: "CONCLUÍDO",
    incompleteValue: "PENDENTE",
  };
  const completeRecord = {
    STATUS: "PENDENTE",
    ATIVIDADES: "EXECUÇÃO",
    CLIMA: "SOL",
    FILIAL: "001",
    DATA: "2026-08-27",
    OCORRENCIAS: "SEM OCORRÊNCIAS",
  };

  assert.equal(evaluatePowerAppsDefaultExpression(expression, {
    record: completeRecord,
    attachments: { existingFiles: [{ name: "FOTO.jpg" }] },
  }), "CONCLUÍDO");

  for (const missing of expression.requiredFields) {
    assert.equal(evaluatePowerAppsDefaultExpression(expression, {
      record: { ...completeRecord, [missing]: "" },
      attachments: { existingFiles: [{ name: "FOTO.jpg" }] },
    }), "PENDENTE", missing);
  }

  assert.equal(evaluatePowerAppsDefaultExpression(expression, {
    record: { STATUS: "CONCLUÍDO" },
    attachments: { existingFiles: [] },
  }), "CONCLUÍDO");

  assert.deepEqual(applyPowerAppsDefaultValues([{ name: "STATUS", defaultExpression: expression }], completeRecord, {
    mode: "edit",
    context: { record: completeRecord, attachments: { pendingFiles: [{ name: "NOVA.jpg" }] } },
  }).STATUS, "CONCLUÍDO");
});

test("contrato compila com seguranca formula unresolved do catalogo ainda nao regenerado", () => {
  const entity = ENTITIES.find(candidate => candidate.id === "empreiteiros");
  const contract = resolvePowerAppsUiContract(entity, [{
    name: "DATA",
    label: "Data",
    control: "date",
    hidden: false,
    editable: true,
  }], { mode: "create" });

  assert.deepEqual(contract.formColumns[0].defaultExpression, { type: "today" });
});

test("formulario renderiza os calculados no create e conserva o registro no edit", () => {
  const entity = { title: "Teste" };
  const columns = [
    { name: "FILIAL", label: "Filial", control: "text", hidden: false, editable: true, defaultExpression: { type: "record", field: "FILIAL" } },
    { name: "DATA", label: "Data", control: "date", hidden: false, editable: true, defaultExpression: { type: "today" } },
  ];
  const defaultContext = {
    now: new Date("2026-08-27T09:00:00-03:00"),
    record: { FILIAL: "001 - OURO PRETO" },
  };

  const create = formMarkup({ entity, columns, mode: "create", values: {}, defaultContext });
  assert.match(create, /name="FILIAL" value="001 - OURO PRETO"/);
  assert.match(create, /name="DATA" value="2026-08-27"/);

  const edit = formMarkup({
    entity,
    columns,
    mode: "edit",
    values: { FILIAL: "002 - CENTRO", DATA: "2026-08-20" },
    defaultContext,
  });
  assert.match(edit, /name="FILIAL" value="002 - CENTRO"/);
  assert.match(edit, /name="DATA" value="2026-08-20"/);
  assert.doesNotMatch(edit, /001 - OURO PRETO/);
});
